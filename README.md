# hamelnb

`hamelnb` lets a coding agent work with a live local notebook.

It helps when part of your workflow takes a long time to run and you do not want every small fix to start over.

Notebooks are useful for data analysis, debugging, and exploratory work. This skill brings that workflow into a coding agent without asking you to leave the tools you already use.

Use it when:
- some notebook steps are slow and you want to keep that work alive
- you want your coding agent to inspect or edit notebook cells
- you want to test a change against the live notebook state instead of rerunning everything
- you want an explicit reset or verification pass at the end

What it does:
- finds local notebook sessions
- reads saved notebook contents
- edits notebook cells
- runs code in the live notebook kernel
- inspects live Python variables
- clears saved outputs
- restarts and verifies notebooks when you ask for it

Start here:
- [AGENTS.md](/Users/hamel/git/hamelnb/AGENTS.md) for the shortest operator path
- [SKILL.md](/Users/hamel/git/hamelnb/skills/jupyter-live-kernel/SKILL.md) for command behavior and limits

## How It Works

The skill connects to a local Jupyter server, finds live notebook sessions, reads the saved notebook file, and sends code to the running kernel.

That gives an agent two useful modes:
- the normal loop: inspect, edit, run a small change, inspect variables, repeat
- the verification loop: restart and run the notebook from the top when you explicitly want a fresh check

Key limits:
- notebook reads come from the saved `.ipynb`, not unsaved browser edits in JupyterLab
- workspace-derived notebook tabs are a persisted JupyterLab snapshot and may include historical workspaces for the same relative path
- `run-all` and `restart-run-all` verify a saved snapshot loaded at the start and do not persist outputs
- variable inspection is Python-only and preview is intentionally bounded
- this project targets local Jupyter servers

This skill works with both Codex and Claude Code. The install steps differ only because each tool uses a different skills directory.

## Install the Skill

### Codex

Codex has a built-in GitHub skill installer. Install the skill directly from this repo:

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo hamelsmu/hamelnb \
  --path skills/jupyter-live-kernel
```

Then restart Codex.

### Claude Code

Claude Code loads skills from `.claude/skills/`, including repos you add with `--add-dir`.

Clone this repo somewhere stable, then add it when you start Claude Code:

```bash
git clone https://github.com/hamelsmu/hamelnb.git ~/.agent-skills/hamelnb
claude --add-dir ~/.agent-skills/hamelnb
```

If you are already in a Claude Code session, run `/add-dir ~/.agent-skills/hamelnb`.

If you want the skill available in every project without `--add-dir`, symlink it into `~/.claude/skills/`:

```bash
git clone https://github.com/hamelsmu/hamelnb.git ~/.agent-skills/hamelnb
mkdir -p ~/.claude/skills
ln -s ~/.agent-skills/hamelnb/.claude/skills/jupyter-live-kernel ~/.claude/skills/jupyter-live-kernel
```

Reference:
- [Claude Code skills docs](https://code.claude.com/docs/en/slash-commands)

## Project Layout

- `.claude/skills/jupyter-live-kernel/`: Claude Code entrypoint for the shared skill
- `skills/jupyter-live-kernel/`: the shared skill files
- `skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py`: discovery, edit, execution, verification, and variable commands
- `skills/jupyter-live-kernel/references/jupyter-hooks.md`: Jupyter API and extension notes
- `tests/test_jupyter_live_kernel.py`: unit and end-to-end coverage

## Running Tests

```bash
python3 -m unittest -v tests/test_jupyter_live_kernel.py
```
