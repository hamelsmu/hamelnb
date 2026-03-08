# Jupyter Hooks

## Core server hooks

Use these server endpoints for the skill-first path:

- `GET /api/sessions`: list live notebook sessions and their kernels
- `GET /api/contents/<path>?type=notebook&content=1`: fetch saved notebook JSON
- `PUT /api/contents/<path>`: save an updated notebook JSON model
- `GET /lab/api/workspaces`: inspect persisted JupyterLab layout state
- `GET /api/kernels/<kernel_id>/channels` over WebSocket: execute code incrementally against a live kernel

The local helper script discovers running servers with `jupyter_server.serverapp.list_running_servers()` and then probes each server instead of trusting runtime records blindly.

## JupyterLab frontend hooks

If the server-side skill is not enough, the JupyterLab extension path is:

- `INotebookTracker`: enumerate notebook widgets, watch `currentWidget`, `currentChanged`, and `widgetAdded`
- `NotebookPanel.sessionContext`: access the notebook's current session and kernel connection
- `KernelConnection.requestExecute(...)`: submit code without restarting the kernel
- `ContentsManager.get(...)`: fetch the notebook model through the standard services client

That path gives the truest UI view, including which notebook tabs are open in the active Lab frontend.

## Recommended architecture

Start with the skill and helper script. It already covers the useful workflow:

1. discover local Jupyter servers
2. list live notebook sessions
3. inspect notebook contents
4. edit saved notebook cells through whole-notebook fetch/mutate/save
5. execute incremental snippets in an existing kernel

For notebook editing, prefer stable cell IDs over positional indices. Indices remain useful for inserts and moves, but existing cells should be targeted by ID when possible.

Because these edits use read-modify-write through the Contents API, add a stale-write guard. If the notebook's `last_modified` timestamp changes between load and save, abort and reload instead of silently overwriting newer content.

Only add a JupyterLab plugin if you specifically need:

- exact real-time browser tab state
- unsaved notebook document content
- a direct frontend bridge instead of polling server and workspace state

## Important limitations

- Workspace state is persisted UI state, not a hard guarantee of current browser reality.
- Saved notebook contents can lag behind unsaved edits in the browser.
- `jupyter console --existing ...` proves local attachment to an existing kernel is possible, but it is a different path from Jupyter Server kernel channels.

## Primary sources

- Jupyter Server REST API: https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html
- Jupyter Server WebSocket protocols: https://jupyter-server.readthedocs.io/en/latest/developers/websocket-protocols.html
- JupyterLab NotebookTracker API: https://jupyterlab.readthedocs.io/en/latest/api/classes/notebook.NotebookTracker.html
- JupyterLab SessionManager API: https://jupyterlab.readthedocs.io/en/stable/api/classes/services.SessionManager-1.html
- JupyterLab KernelConnection API: https://jupyterlab.readthedocs.io/en/latest/api/classes/services.KernelConnection.html
- JupyterLab Workspaces user docs: https://jupyterlab.readthedocs.io/en/4.3.x/user/workspaces.html
- Jupyter console docs: https://jupyter-console.readthedocs.io/en/stable/
- Jupyter Server sessions handler source: https://raw.githubusercontent.com/jupyter-server/jupyter_server/main/jupyter_server/services/sessions/handlers.py
- Jupyter Server kernels handler source: https://raw.githubusercontent.com/jupyter-server/jupyter_server/main/jupyter_server/services/kernels/handlers.py
- JupyterLab session REST client source: https://raw.githubusercontent.com/jupyterlab/jupyterlab/main/packages/services/src/session/restapi.ts
- JupyterLab notebook extension source: https://raw.githubusercontent.com/jupyterlab/jupyterlab/main/packages/notebook-extension/src/index.ts
