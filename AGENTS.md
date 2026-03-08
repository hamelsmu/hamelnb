# AGENTS.md

This repo contains a shared skill for working against a live local Jupyter notebook kernel without rerunning whole scripts.

Canonical doc:
- [SKILL.md](./skills/jupyter-live-kernel/SKILL.md) is the source of truth for command semantics and limits.

Primary files:
- [SKILL.md](./skills/jupyter-live-kernel/SKILL.md)
- [jupyter_live_kernel.py](./skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py)
- [test_jupyter_live_kernel.py](./tests/test_jupyter_live_kernel.py)

## Fastest Test Path

```bash
python3 -m pytest tests/test_jupyter_live_kernel.py -v
```

This runs the default fast suite (unit + non-slow integration) and skips expensive verification scenarios.

## Full Coverage Test Path

```bash
JLK_RUN_SLOW_INTEGRATION=1 python3 -m pytest tests/test_jupyter_live_kernel.py -v
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
jupyter lab \
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
python3 "$SCRIPT" servers --compact
python3 "$SCRIPT" notebooks --port 8899 --compact
python3 "$SCRIPT" contents --port 8899 --path demo.ipynb --compact
python3 "$SCRIPT" execute --port 8899 --path demo.ipynb --code $'x = 41\nx + 1' --compact
python3 "$SCRIPT" variables --port 8899 --path demo.ipynb list --compact
python3 "$SCRIPT" run-all --port 8899 --path demo.ipynb --compact
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
- `run-all` and `restart-run-all` do not persist outputs into the notebook.
- variable preview is bounded and avoids arbitrary `repr(...)` calls for non-scalar objects.
