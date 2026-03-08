---
name: jupyter-live-kernel
description: Work against a live local Jupyter notebook kernel. Use this when an agent needs a Jupyter-like in-memory REPL, wants to inspect or edit a notebook while keeping the kernel alive, or needs an explicit verification pass at the end.
---

# Jupyter Live Kernel

Use this skill when a local notebook kernel already holds useful state and you do not want to rerun expensive setup.

## Core Loop

Run from the repo root.

```bash
SCRIPT=skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py
```

1. Discover reachable servers.
```bash
python3 "$SCRIPT" servers --compact
```

2. Find live notebooks.
```bash
python3 "$SCRIPT" notebooks --port 8899 --compact
```

3. Inspect the saved notebook.
```bash
python3 "$SCRIPT" contents --port 8899 --path demo.ipynb --compact
```

4. Execute code incrementally in the live kernel.
```bash
python3 "$SCRIPT" execute \
  --port 8899 \
  --path demo.ipynb \
  --code $'x = 41\nprint("hello")\nx + 1' \
  --compact
```

5. Edit saved notebook cells.
Use a real cell ID returned by `contents`.
```bash
python3 "$SCRIPT" edit \
  --port 8899 \
  --path demo.ipynb \
  replace-source \
  --cell-id <cell-id> \
  --source $'x = 42\nx' \
  --compact
```

Core guidance:
- Prefer `--cell-id` over `--index` for existing cells.
- Use `execute` for the normal loop.
- Keep `restart`, `run-all`, and `restart-run-all` for explicit verification or reset requests, not routine iteration.

## Advanced

Inspect live Python-kernel variables:

```bash
python3 "$SCRIPT" variables --port 8899 --path demo.ipynb list --compact
python3 "$SCRIPT" variables --port 8899 --path demo.ipynb preview --name x --compact
```

Verification commands:

```bash
python3 "$SCRIPT" restart --port 8899 --path demo.ipynb --compact
python3 "$SCRIPT" run-all --port 8899 --path demo.ipynb --compact
python3 "$SCRIPT" restart-run-all --port 8899 --path demo.ipynb --compact
```

Advanced guidance:
- `variables` is Python-only.
- `run-all` and `restart-run-all` require a notebook-backed live session.
- `run-all` and `restart-run-all` exit non-zero when a cell fails.
- `run-all` and `restart-run-all` verify a saved snapshot loaded at the start.
- `run-all` and `restart-run-all` do not write outputs back into the notebook file.

## Transport

`execute`, `variables`, `run-all`, and `restart-run-all` default to `--transport auto`.

- `websocket`: use Jupyter Server kernel channels at `/api/kernels/<kernel_id>/channels`
- `zmq`: fall back to the local kernel connection file with `jupyter_client`
- `auto`: try websocket first, then use local ZMQ fallback only when the websocket request did not already reach the kernel

Prefer `auto` unless you are debugging transport behavior.

## Limits

- `contents` returns the saved notebook file, not unsaved browser edits.
- `edit` writes through the Contents API and changes the saved notebook on disk.
- The stale-write guard is best-effort, not atomic.
- Concurrent notebook edits can invalidate a verification run after it starts.
- Concurrent execution from other clients can affect kernel state during verification.
- Variable listing is bounded to `--limit <= 100`.
- Variable preview is bounded to `--max-chars <= 2000` and avoids arbitrary `repr(...)` calls for non-scalar objects.
- Workspace-derived notebook tabs are a persisted JupyterLab snapshot, not guaranteed real-time UI truth.
- Workspace-derived notebook tabs can include historical workspaces for the same relative path.
- The skill assumes local Jupyter runtime metadata is visible to the current user.

## Resources

- Script: [jupyter_live_kernel.py](/Users/hamel/git/hamelnb/skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py)
- Architecture notes: [jupyter-hooks.md](/Users/hamel/git/hamelnb/skills/jupyter-live-kernel/references/jupyter-hooks.md)
