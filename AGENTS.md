# AGENTS.md

This repo contains a shared skill for working against a live local Jupyter notebook kernel without rerunning whole scripts.

Canonical doc:
- [SKILL.md](./skills/jupyter-live-kernel/SKILL.md) is the source of truth for command semantics and limits.

Primary files:
- [SKILL.md](./skills/jupyter-live-kernel/SKILL.md)
- [jupyter_live_kernel.py](./skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py)
- [test_jupyter_live_kernel.py](./tests/test_jupyter_live_kernel.py)

## Test Plan

Use this order unless the change is obviously docs-only:

```bash
uv run --group dev pytest tests/test_jupyter_live_kernel.py -v
JLK_RUN_SLOW_INTEGRATION=1 uv run --group dev pytest tests/test_jupyter_live_kernel.py -v
uv run --group dev --group browser playwright install chromium
JLK_RUN_BROWSER_INTEGRATION=1 uv run --group dev --group browser pytest tests/test_jupyter_collaboration_refresh.py -v
```

- Run the fast suite for normal script or parser changes.
- Add the slow suite when server/session/transport behavior changes.
- Add the Playwright test when notebook save, collaboration, or browser refresh behavior changes.

## Fastest Test Path

```bash
uv run --group dev pytest tests/test_jupyter_live_kernel.py -v
```

This runs the default fast suite (unit + non-slow integration) and skips expensive verification scenarios.

## Full Coverage Test Path

```bash
JLK_RUN_SLOW_INTEGRATION=1 uv run --group dev pytest tests/test_jupyter_live_kernel.py -v
```

This additionally covers:
- server discovery
- notebook/session listing
- contents fetch
- cell edits and output clearing
- execute over `websocket` and `zmq`
- `restart`, `run-all`, and `restart-run-all`
- variable listing and preview
- target validation, auth handling, stale-write protection, and transport safety guards

## Manual Smoke Test

Start a disposable JupyterLab:

```bash
mkdir -p /tmp/jupyter-live-kernel-demo
uv run --with jupyterlab jupyter lab \
  --no-browser \
  --IdentityProvider.token=testtoken \
  --ServerApp.password= \
  --ServerApp.port=8899 \
  --ServerApp.port_retries=0 \
  --ServerApp.root_dir=/tmp/jupyter-live-kernel-demo
```

Then run:

```bash
SCRIPT=skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py
uv run "$SCRIPT" servers --compact
uv run "$SCRIPT" notebooks --port 8899 --compact
uv run "$SCRIPT" contents --port 8899 --path demo.ipynb --compact
uv run "$SCRIPT" execute --port 8899 --path demo.ipynb --code $'x = 41\nx + 1' --compact
uv run "$SCRIPT" variables --port 8899 --path demo.ipynb list --compact
uv run "$SCRIPT" run-all --port 8899 --path demo.ipynb --compact
```

For collaboration/browser-refresh validation, launch a collaborative Lab instead:

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

## Operating Order

Use this order unless you have a reason not to:
1. `servers`
2. `notebooks`
3. `contents`
4. `edit` and `execute`
5. `variables` when you need live kernel state
6. `restart`, `run-all`, or `restart-run-all` only when the user explicitly wants a fresh run or verification pass

## Important Limits

- `contents` shows the saved notebook, not unsaved browser edits.
- workspace-derived notebook tabs are a persisted JupyterLab snapshot and can include historical workspaces for the same relative path.
- `edit` changes the saved notebook on disk.
- `edit clear-outputs` clears saved outputs on disk only.
- `execute`, `restart`, `variables`, `run-all`, and `restart-run-all` target live notebook sessions.
- `run-all` and `restart-run-all` exit non-zero when a cell fails.
- `run-all` and `restart-run-all` do not persist outputs into the notebook unless `--save-outputs` is passed.
- variable preview is bounded and avoids arbitrary `repr(...)` calls for non-scalar objects.
