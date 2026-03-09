---
name: hamelnb
description: Work against a live local Jupyter notebook kernel. Use this when an agent needs a Jupyter-like in-memory REPL, wants to inspect or edit a notebook while keeping the kernel alive, or needs an explicit verification pass at the end.
---

# hamelnb

Use this skill when a local notebook kernel already holds useful state and you do not want to rerun expensive setup.

## Core Loop

Run from the repo root.

```bash
SCRIPT=skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py
```

Prefer `uv` for this skill. The helper script declares its runtime dependencies inline, so the default invocation is:

```bash
uv run "$SCRIPT" --help
```

Because the script uses inline metadata, `uv run "$SCRIPT"` stays self-contained even when you launch it from inside this repo.

If the script is executable and `uv` is on `PATH`, direct execution also works:

```bash
"$SCRIPT" --help
```

Fallback:
- Use `python3 "$SCRIPT" ...` only if `uv` is unavailable and the required packages are already installed.
- If you need to add a new runtime dependency to the helper script, prefer `uv add --script "$SCRIPT" <package>`.

1. Discover reachable servers.
```bash
uv run "$SCRIPT" servers --compact
```

2. Find live notebooks.
```bash
uv run "$SCRIPT" notebooks --port 8899 --compact
```

3. Inspect the saved notebook.
```bash
uv run "$SCRIPT" contents --port 8899 --path demo.ipynb --compact
```

4. Execute code incrementally in the live kernel.
```bash
uv run "$SCRIPT" execute \
  --port 8899 \
  --path demo.ipynb \
  --code $'x = 41\nprint("hello")\nx + 1' \
  --compact
```

5. Edit saved notebook cells.
Use a real cell ID returned by `contents`.
```bash
uv run "$SCRIPT" edit \
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

## Target Selection And Ambiguity

Always make the live target explicit before edits or execution. Never guess when more than one live option exists.

Required behavior:
1. Resolve server first.
   - If multiple reachable servers are discovered, ask the user to choose one.
   - After selection, pass `--port` (or `--server-url`) on all follow-up commands.
2. Resolve notebook path second.
   - If the user already specified `--path`, use it.
   - Otherwise run `notebooks` for the selected server and collect candidates.
   - If there is exactly one live notebook, state it explicitly and proceed.
   - If there are multiple notebook candidates, ask the user to choose one.
3. Resolve session/kernel when needed.
   - If multiple live sessions exist for the chosen path, ask the user to choose a session.
   - Then pass `--session-id` on execute/restart/run-all/variables commands to pin the exact kernel.

Claude Code ambiguity flow:
- Use `AskUserQuestion` for each ambiguity point (server, notebook, session) as a picker.
- Keep each picker to one short question with a short header (`Server`, `Notebook`, `Session`).
- Option labels must include enough context to disambiguate:
  - Server: `port`, `base URL`.
  - Notebook: `path`, `port`.
  - Session: `session id`, `kernel id`, `path`.
- After selection, confirm in plain language (for example: `Using port 8888, notebook notebooks/tiny-demo.ipynb, session 1234...`), then continue.

Codex ambiguity flow:
- Ask a direct clarifying question in plain text listing candidates.
- Continue only after the user confirms a specific target.

Once selected, keep using the same `port + path` and, when applicable, `session_id` until the user asks to switch.

## Advanced

Inspect live Python-kernel variables:

```bash
uv run "$SCRIPT" variables --port 8899 --path demo.ipynb list --compact
uv run "$SCRIPT" variables --port 8899 --path demo.ipynb preview --name x --compact
```

Verification commands:

```bash
uv run "$SCRIPT" restart --port 8899 --path demo.ipynb --compact
uv run "$SCRIPT" run-all --port 8899 --path demo.ipynb --compact
uv run "$SCRIPT" restart-run-all --port 8899 --path demo.ipynb --compact
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

- Script: [jupyter_live_kernel.py](scripts/jupyter_live_kernel.py)
- Architecture notes: [jupyter-hooks.md](references/jupyter-hooks.md)
