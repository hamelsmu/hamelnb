# hamelnb

`hamelnb` gives Codex a practical live Jupyter notebook workflow against a running local kernel.

It is worth trying if you debug or iterate in stateful notebooks and do not want every small fix to trigger a full rerun.

Use it when:
- a notebook already holds expensive in-memory state and you do not want to rerun setup cells
- you need to inspect or edit a notebook while keeping the kernel alive
- you want an explicit end-of-task verification pass with `run-all` or `restart-run-all`

It provides:
- local Jupyter server and notebook-session discovery
- saved notebook inspection
- notebook cell edits through the Contents API
- incremental kernel execution
- saved-output clearing
- kernel restart
- notebook-wide verification without saving outputs back into the notebook
- bounded live variable inspection for Python kernels

Key limits:
- notebook reads come from the saved `.ipynb`, not unsaved browser edits in JupyterLab
- workspace-derived notebook tabs are a persisted JupyterLab snapshot and may include historical workspaces for the same relative path
- `run-all` and `restart-run-all` verify a saved snapshot loaded at the start and do not persist outputs
- variable inspection is Python-only and preview is intentionally bounded
- this project targets local Jupyter servers

Start here:
- [AGENTS.md](/Users/hamel/git/hamelnb/AGENTS.md) for the shortest operator path
- [SKILL.md](/Users/hamel/git/hamelnb/skills/jupyter-live-kernel/SKILL.md) for canonical command behavior and limits

## Claude Code

If you want to use this repo from Claude Code, install Claude Code first and then run the helper script from this repo directly.

Recommended install:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Other official install options:
- Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- Windows CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`
- Homebrew: `brew install --cask claude-code`
- WinGet: `winget install Anthropic.ClaudeCode`

Then start Claude Code and log in:

```bash
claude
```

Verify the install:

```bash
claude --version
```

Notes:
- Anthropic recommends the native installer. The npm install path is deprecated.
- Windows requires Git for Windows.
- Official docs: [Claude Code setup](https://code.claude.com/docs/en/setup) and [quickstart](https://code.claude.com/docs/en/quickstart)

## Project Layout

- `skills/jupyter-live-kernel/`: the Codex skill
- `skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py`: discovery, edit, execution, verification, and variable commands
- `skills/jupyter-live-kernel/references/jupyter-hooks.md`: Jupyter API and extension notes
- `tests/test_jupyter_live_kernel.py`: unit and end-to-end coverage

## Running Tests

```bash
python3 -m unittest -v tests/test_jupyter_live_kernel.py
```
