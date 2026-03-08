const path = require('path');
const {chromium} = require('@playwright/test');

const baseUrl = process.argv[2];
const outputDir = process.argv[3];

if (!baseUrl || !outputDir) {
  console.error('Usage: node capture_real_jupyter_seq.cjs <url> <outputDir>');
  process.exit(1);
}

(async () => {
  const clip = {x: 520, y: 24, width: 1040, height: 860};
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1600, height: 900}});
  const page = await context.newPage();
  const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  const shot = async (index) => {
    await page.screenshot({path: path.join(outputDir, `state-${index}.png`), clip});
  };

  await page.goto(baseUrl, {waitUntil: 'networkidle'});
  await page.waitForSelector('.jp-Notebook .jp-CodeCell');
  await page.waitForTimeout(1200);

  const codeCell = page.locator('.jp-CodeCell').first();
  const codeEditor = codeCell.locator('.cm-content').first();
  const valueCell = page.locator('.jp-CodeCell').nth(1);
  const valueEditor = valueCell.locator('.cm-content').first();

  await valueEditor.click();
  await page.waitForTimeout(220);
  await shot(1);

  await codeCell.click();
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(280);
  await shot(2);

  await page.waitForFunction(() => {
    const first = document.querySelectorAll('.jp-CodeCell')[0];
    if (!first) return false;
    const prompt = first.querySelector('.jp-InputPrompt');
    const text = prompt?.textContent?.replace(/\s+/g, '') ?? '';
    return /\[\d+\]:/.test(text);
  });
  await page.waitForFunction(() => {
    const value = document.querySelectorAll('.jp-CodeCell')[1];
    return Boolean(value);
  });
  await valueCell.click();
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => {
    const value = document.querySelectorAll('.jp-CodeCell')[1];
    if (!value) return false;
    const output = value.querySelector('.jp-OutputArea-output');
    return Boolean(output?.textContent?.trim().endsWith('1'));
  });
  await page.waitForTimeout(140);
  await shot(3);

  await codeEditor.click();
  await page.keyboard.press(selectAllKey);
  await page.keyboard.type('import time\ntime.sleep(1.6)\nvalue = 2');
  await page.keyboard.press('Escape');
  await valueCell.click();
  await page.waitForTimeout(240);
  await shot(4);

  await codeCell.click();
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(280);
  await shot(5);

  await page.waitForFunction(() => {
    const first = document.querySelectorAll('.jp-CodeCell')[0];
    if (!first) return false;
    const prompt = first.querySelector('.jp-InputPrompt');
    const text = prompt?.textContent?.replace(/\s+/g, '') ?? '';
    return /\[\d+\]:/.test(text);
  });
  await valueCell.click();
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => {
    const value = document.querySelectorAll('.jp-CodeCell')[1];
    if (!value) return false;
    const output = value.querySelector('.jp-OutputArea-output');
    return Boolean(output?.textContent?.trim().endsWith('2'));
  });
  await page.waitForTimeout(140);
  await shot(6);

  const secondCell = page.locator('.jp-CodeCell').nth(1);

  await secondCell.click();
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(150);
  const thirdCell = page.locator('.jp-CodeCell').nth(2);
  const thirdEditor = thirdCell.locator('.cm-content').first();
  await thirdEditor.click();
  await page.keyboard.type('value * 5');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  await shot(7);

  await thirdCell.click();
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(10);
  await shot(8);

  await page.waitForFunction(() => {
    const cells = Array.from(document.querySelectorAll('.jp-CodeCell'));
    const third = cells[2];
    if (!third) return false;
    const output = third.querySelector('.jp-OutputArea-output');
    return Boolean(output?.textContent?.trim().endsWith('10'));
  });
  await page.waitForTimeout(120);
  await shot(9);

  await browser.close();
})();
