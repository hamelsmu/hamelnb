const path = require('path');
const {chromium} = require('@playwright/test');

const baseUrl = process.argv[2];
const outputDir = process.argv[3];

if (!baseUrl || !outputDir) {
  console.error('Usage: node capture_real_jupyter_seq.cjs <url> <outputDir>');
  process.exit(1);
}

const parseTarget = (urlString) => {
  const url = new URL(urlString);
  const marker = '/lab/tree/';
  const idx = url.pathname.indexOf(marker);
  if (idx === -1) {
    throw new Error('URL must include /lab/tree/<notebook-path>');
  }

  const notebookPath = decodeURIComponent(url.pathname.slice(idx + marker.length));
  if (!notebookPath) {
    throw new Error('Notebook path missing in URL');
  }

  return {
    origin: url.origin,
    token: url.searchParams.get('token') || '',
    notebookPath,
  };
};

const encodeNotebookPath = (notebookPath) =>
  notebookPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

const appendToken = (urlString, token) => {
  if (!token) {
    return urlString;
  }
  const url = new URL(urlString);
  url.searchParams.set('token', token);
  return url.toString();
};

const codeCell = (source) => ({
  cell_type: 'code',
  execution_count: null,
  metadata: {},
  outputs: [],
  source,
});

const prepareNotebook = async ({origin, token, notebookPath}) => {
  const encoded = encodeNotebookPath(notebookPath);
  const notebookApi = appendToken(`${origin}/api/contents/${encoded}?content=1`, token);
  const sessionsApi = appendToken(`${origin}/api/sessions`, token);

  const sessionsResp = await fetch(sessionsApi);
  if (sessionsResp.ok) {
    const sessions = await sessionsResp.json();
    const targets = Array.isArray(sessions)
      ? sessions.filter((session) => session?.path === notebookPath)
      : [];
    for (const session of targets) {
      if (!session?.id) continue;
      await fetch(appendToken(`${origin}/api/sessions/${encodeURIComponent(session.id)}`, token), {
        method: 'DELETE',
      });
    }
  }

  const readResp = await fetch(notebookApi);
  if (!readResp.ok) {
    throw new Error(`Failed to fetch notebook: ${readResp.status} ${readResp.statusText}`);
  }
  const readJson = await readResp.json();
  const existing = readJson.content || {};
  const metadata = existing.metadata || {};
  const nbformat = existing.nbformat || 4;
  const nbformatMinor = existing.nbformat_minor || 5;

  const payload = {
    type: 'notebook',
    format: 'json',
    content: {
      cells: [codeCell('multiplier = 5'), codeCell('base = 1'), codeCell('base')],
      metadata,
      nbformat,
      nbformat_minor: nbformatMinor,
    },
  };

  const writeResp = await fetch(appendToken(`${origin}/api/contents/${encoded}`, token), {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  if (!writeResp.ok) {
    const body = await writeResp.text();
    throw new Error(
      `Failed to reset notebook: ${writeResp.status} ${writeResp.statusText}\n${body}`,
    );
  }
};

(async () => {
  const clip = {x: 520, y: 24, width: 1040, height: 860};
  const target = parseTarget(baseUrl);
  await prepareNotebook(target);

  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1600, height: 900}});
  const page = await context.newPage();
  const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

  const waitForPromptAtLeast = async (index, minCount) => {
    await page.waitForFunction(
      ({index: cellIndex, minCount: min}) => {
        const cell = document.querySelectorAll('.jp-CodeCell')[cellIndex];
        if (!cell) return false;
        const prompt = cell.querySelector('.jp-InputPrompt');
        const text = (prompt?.textContent || '').replace(/\s+/g, '');
        const match = text.match(/\[(\d+)\]:/);
        return Boolean(match && Number(match[1]) >= min);
      },
      {index, minCount},
      {timeout: 10000},
    );
  };

  const waitForOutputValue = async (index, expectedText) => {
    await page.waitForFunction(
      ({index: cellIndex, expectedText: expected}) => {
        const cell = document.querySelectorAll('.jp-CodeCell')[cellIndex];
        if (!cell) return false;
        const output = cell.querySelector('.jp-OutputArea-output');
        return output?.textContent?.trim() === expected;
      },
      {index, expectedText},
      {timeout: 10000},
    );
  };

  const shot = async (index) => {
    await page.screenshot({path: path.join(outputDir, `state-${index}.png`), clip});
  };
  const dismissDialogsIfPresent = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const dialog = page.locator('.jp-Dialog').first();
      if ((await dialog.count()) === 0) {
        return;
      }

      const candidate = dialog
        .locator(
          'button:has-text("Reload"), button:has-text("Revert"), button:has-text("Cancel"), button:has-text("Close"), button:has-text("OK"), button:has-text("Dismiss"), button',
        )
        .first();

      if ((await candidate.count()) > 0) {
        await candidate.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(180);
    }
  };
  const ensureKernelSelected = async () => {
    const kernelDialog = page.locator('.jp-Dialog:has-text("Select Kernel")').first();
    if ((await kernelDialog.count()) === 0) {
      return;
    }

    const kernelSelect = kernelDialog.locator('select').first();
    if ((await kernelSelect.count()) > 0) {
      const options = await kernelSelect.locator('option').all();
      let pythonValue = null;
      for (const option of options) {
        const label = (await option.textContent()) || '';
        if (/python/i.test(label)) {
          pythonValue = await option.getAttribute('value');
          break;
        }
      }
      if (pythonValue) {
        await kernelSelect.selectOption(pythonValue);
      }
    }

    const selectButton = kernelDialog.locator('button:has-text("Select")').first();
    if ((await selectButton.count()) > 0) {
      await selectButton.click();
      await page.waitForTimeout(700);
    }
  };
  const codeCellLocator = (index) => page.locator('.jp-Notebook .jp-CodeCell').nth(index);
  const editorLocator = (index) =>
    codeCellLocator(index).locator('.jp-InputArea-editor .cm-content').first();
  const runCell = async (index, runningShotIndex) => {
    await codeCellLocator(index).click();
    await page.keyboard.press('Shift+Enter');
    if (runningShotIndex) {
      try {
        await page.waitForFunction(
          ({index: cellIndex}) => {
            const cell = document.querySelectorAll('.jp-CodeCell')[cellIndex];
            if (!cell) return false;
            const prompt = cell.querySelector('.jp-InputPrompt');
            const text = (prompt?.textContent || '').replace(/\s+/g, '');
            return text === '[*]:';
          },
          {index},
          {timeout: 1200},
        );
      } catch (_err) {
        // Fast cells can skip directly past [*]. We still capture a frame.
      }
      await shot(runningShotIndex);
    }
  };

  await page.goto(baseUrl, {waitUntil: 'networkidle'});
  await ensureKernelSelected();
  await dismissDialogsIfPresent();
  await page.waitForFunction(() => document.querySelectorAll('.jp-Notebook .jp-CodeCell').length >= 3);
  await page.waitForTimeout(800);

  await editorLocator(2).click();
  await page.waitForTimeout(160);
  await shot(1);

  await runCell(0, 2);
  await waitForPromptAtLeast(0, 1);
  await runCell(1);
  await waitForPromptAtLeast(1, 2);
  await runCell(2);
  await waitForPromptAtLeast(2, 3);
  await waitForOutputValue(2, '1');
  await page.waitForTimeout(120);
  await shot(3);

  await codeCellLocator(2).click();
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => document.querySelectorAll('.jp-Notebook .jp-CodeCell').length >= 4);
  await editorLocator(3).click();
  await page.keyboard.type('base * multiplier');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(160);
  await shot(4);

  await runCell(3, 5);
  await waitForPromptAtLeast(3, 4);
  await waitForOutputValue(3, '5');
  await page.waitForTimeout(120);
  await shot(6);

  await editorLocator(1).click();
  await page.keyboard.press(selectAllKey);
  await page.keyboard.type('base = 2');
  await page.keyboard.press('Escape');
  await shot(7);

  await runCell(1);
  await waitForPromptAtLeast(1, 5);
  await runCell(2);
  await waitForPromptAtLeast(2, 6);
  await runCell(3, 8);
  await waitForPromptAtLeast(3, 7);
  await waitForOutputValue(3, '10');
  await waitForOutputValue(2, '2');
  await page.waitForTimeout(120);
  await shot(9);

  await browser.close();
})();
