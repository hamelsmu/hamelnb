# hamelnb

[![Fast Tests](https://github.com/hamelsmu/hamelnb/actions/workflows/fast-tests.yml/badge.svg)](https://github.com/hamelsmu/hamelnb/actions/workflows/fast-tests.yml)
[![Full Tests](https://github.com/hamelsmu/hamelnb/actions/workflows/full-tests.yml/badge.svg)](https://github.com/hamelsmu/hamelnb/actions/workflows/full-tests.yml)

Coding agents write entire scripts in one shot, then debug from the top when something breaks. That's backwards. A good developer tinkers -- try a small piece, check the output, build up from there. Notebooks exist for exactly this reason.

`hamelnb` gives your coding agent a live Jupyter notebook kernel. Instead of generating a 200-line script and hoping it works, the agent can explore an API interactively, check return values, fix one thing at a time, and build up working code cell by cell -- the same way you would.

It works with Claude Code and Codex.

## Use it when

- You're hitting an unfamiliar API and want the agent to actually try things before writing the final code
- A data pipeline takes minutes to run and you don't want every small fix to start from scratch
- You want the agent to inspect live variables -- DataFrames, model outputs, intermediate results -- not just guess at what they look like
- You want to build something up incrementally in a notebook, then clean it up into a script once it works

## How it works

The agent connects to your local Jupyter server, finds running notebook sessions, and sends code to the live kernel. Think of it as giving the agent the same notebook workflow you already use:

1. **Explore:** run small snippets, check outputs, inspect variables
2. **Build up:** edit cells, re-run just what changed, keep accumulated state
3. **Verify:** restart and run everything from the top when you're ready for a clean check

The agent reads the saved `.ipynb` file and executes code against the running kernel. It can edit cells, inspect Python variables, and restart the kernel when you ask for a fresh run.

## Install

### Codex

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo hamelsmu/hamelnb \
  --path skills/jupyter-live-kernel
```

Then restart Codex.

### Claude Code

Clone the repo and point Claude Code at it:

```bash
git clone https://github.com/hamelsmu/hamelnb.git ~/.agent-skills/hamelnb
claude --add-dir ~/.agent-skills/hamelnb
```

Already in a session? Run `/add-dir ~/.agent-skills/hamelnb`.

To make the skill available in every project without `--add-dir`:

```bash
git clone https://github.com/hamelsmu/hamelnb.git ~/.agent-skills/hamelnb
mkdir -p ~/.claude/skills
ln -s ~/.agent-skills/hamelnb/.claude/skills/jupyter-live-kernel ~/.claude/skills/jupyter-live-kernel
```

See the [Claude Code skills docs](https://code.claude.com/docs/en/slash-commands) for more on how skills work.

## Docs

- [AGENTS.md](AGENTS.md) -- quickstart for agents working on this repo
- [SKILL.md](skills/jupyter-live-kernel/SKILL.md) -- full command reference, limits, and transport details

## Project layout

- `skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py` -- the main script
- `skills/jupyter-live-kernel/references/jupyter-hooks.md` -- Jupyter API notes
- `tests/test_jupyter_live_kernel.py` -- test suite
- `.claude/skills/jupyter-live-kernel/` -- Claude Code entrypoint

## Running tests

Fast/default suite:

```bash
uv run --group dev pytest tests/test_jupyter_live_kernel.py -v
```

Full suite (includes slow live-kernel verification scenarios):

```bash
JLK_RUN_SLOW_INTEGRATION=1 uv run --group dev pytest tests/test_jupyter_live_kernel.py -v
```

Browser collaboration smoke test:

```bash
uv run --group dev --group browser playwright install chromium
JLK_RUN_BROWSER_INTEGRATION=1 uv run --group dev --group browser pytest tests/test_jupyter_collaboration_refresh.py -v
```

Manual collaborative JupyterLab launch for browser-refresh debugging:

```bash
mkdir -p /tmp/jupyter-live-kernel-collab
uv run --with jupyterlab --with jupyter-collaboration jupyter lab \
  --no-browser \
  --collaborative \
  --LabApp.extension_manager=readonly \
  --IdentityProvider.token=testtoken \
  --ServerApp.password= \
  --ServerApp.port=8899 \
  --ServerApp.port_retries=0 \
  --ServerApp.root_dir=/tmp/jupyter-live-kernel-collab
```

To keep before/after screenshots from the Playwright run:

```bash
JLK_BROWSER_ARTIFACT_DIR=/tmp/jlk-browser-artifacts \
JLK_RUN_BROWSER_INTEGRATION=1 \
uv run --group dev --group browser pytest tests/test_jupyter_collaboration_refresh.py -v
```
