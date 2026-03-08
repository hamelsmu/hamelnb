from __future__ import annotations

import ast
import importlib.util
import json
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
import uuid
from pathlib import Path
from unittest import mock

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / 'skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py'
TOKEN = 'testtoken'
NOTEBOOK_PATH = 'demo.ipynb'
WORKSPACE_ID = f'codex-{uuid.uuid4().hex[:8]}'
TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z1ioAAAAASUVORK5CYII='

SPEC = importlib.util.spec_from_file_location('jupyter_live_kernel', SCRIPT_PATH)
assert SPEC and SPEC.loader
JUPYTER_LIVE_KERNEL = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = JUPYTER_LIVE_KERNEL
SPEC.loader.exec_module(JUPYTER_LIVE_KERNEL)


class JupyterLiveKernelUnitTests(unittest.TestCase):
    def test_sanitize_error_text_redacts_token(self) -> None:
        message = 'websocket failed for ws://127.0.0.1:9999/api/kernels/id/channels?token=secret-token'
        redacted = JUPYTER_LIVE_KERNEL._sanitize_error_text(message, server_token='secret-token')
        self.assertNotIn('secret-token', redacted)
        self.assertIn('token=[REDACTED]', redacted)

    def test_explicit_server_selection_requires_working_auth(self) -> None:
        server = JUPYTER_LIVE_KERNEL.ServerInfo(
            url='http://127.0.0.1:9999',
            base_url='/',
            root_dir='.',
            token='bad-token',
            port=9999,
        )
        with (
            mock.patch.object(JUPYTER_LIVE_KERNEL, '_running_server_infos', return_value=[server]),
            mock.patch.object(
                JUPYTER_LIVE_KERNEL,
                'probe_server',
                return_value=JUPYTER_LIVE_KERNEL.ProbeResult(
                    reachable=True,
                    auth_ok=False,
                    error='forbidden',
                ),
            ),
        ):
            with self.assertRaises(JUPYTER_LIVE_KERNEL.CommandError) as exc_info:
                JUPYTER_LIVE_KERNEL._select_server(server_url=None, port=9999, timeout=5)

        self.assertIn('authentication failed', str(exc_info.exception))

    def test_auto_transport_will_not_retry_after_unsafe_websocket_failure(self) -> None:
        server = JUPYTER_LIVE_KERNEL.ServerInfo(
            url='http://127.0.0.1:9999',
            base_url='/',
            root_dir='.',
            token='',
        )
        session = {'id': 'session-1', 'path': NOTEBOOK_PATH, 'kernel': {'id': 'kernel-1'}}

        with (
            mock.patch.object(JUPYTER_LIVE_KERNEL, '_resolve_session', return_value=session),
            mock.patch.object(
                JUPYTER_LIVE_KERNEL,
                '_execute_via_websocket',
                side_effect=JUPYTER_LIVE_KERNEL.TransportRetryUnsafeError(
                    'socket closed after send',
                    request_sent=True,
                ),
            ),
            mock.patch.object(JUPYTER_LIVE_KERNEL, '_execute_via_zmq') as execute_via_zmq,
        ):
            with self.assertRaises(JUPYTER_LIVE_KERNEL.CommandError) as exc_info:
                JUPYTER_LIVE_KERNEL.execute_code(
                    server,
                    path=NOTEBOOK_PATH,
                    session_id=None,
                    kernel_id=None,
                    code='print(1)',
                    transport='auto',
                    timeout=5,
                )

        execute_via_zmq.assert_not_called()
        self.assertIn('auto fallback was skipped', str(exc_info.exception))

    def test_message_must_match_parent_header(self) -> None:
        msg_id = 'expected-msg-id'
        self.assertTrue(
            JUPYTER_LIVE_KERNEL._belongs_to_execution(
                {'parent_header': {'msg_id': msg_id}},
                msg_id,
            )
        )
        self.assertFalse(
            JUPYTER_LIVE_KERNEL._belongs_to_execution(
                {'parent_header': {}},
                msg_id,
            )
        )

    def test_probe_server_distinguishes_auth_failure_from_unreachable(self) -> None:
        server = JUPYTER_LIVE_KERNEL.ServerInfo(
            url='http://127.0.0.1:9999',
            base_url='/',
            root_dir='.',
            token='bad-token',
        )
        with mock.patch.object(
            JUPYTER_LIVE_KERNEL.ServerClient,
            'request',
            side_effect=JUPYTER_LIVE_KERNEL.HTTPCommandError('forbidden', status_code=403),
        ):
            probe = JUPYTER_LIVE_KERNEL.probe_server(server)

        self.assertTrue(probe.reachable)
        self.assertFalse(probe.auth_ok)
        self.assertEqual(probe.error, 'forbidden')

    def test_save_notebook_rejects_stale_last_modified(self) -> None:
        server = JUPYTER_LIVE_KERNEL.ServerInfo(
            url='http://127.0.0.1:9999',
            base_url='/',
            root_dir='.',
            token='',
        )
        client = mock.Mock()
        client.request.return_value = {'last_modified': 'newer'}
        with mock.patch.object(JUPYTER_LIVE_KERNEL, 'ServerClient', return_value=client):
            with self.assertRaises(JUPYTER_LIVE_KERNEL.CommandError) as exc_info:
                JUPYTER_LIVE_KERNEL._save_notebook_content(
                    server,
                    'demo.ipynb',
                    {'cells': [], 'metadata': {}, 'nbformat': 4, 'nbformat_minor': 5},
                    expected_last_modified='older',
                )

        self.assertIn('Notebook changed since it was loaded', str(exc_info.exception))
        self.assertEqual(client.request.call_count, 1)


class JupyterLiveKernelIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root_dir = tempfile.TemporaryDirectory(prefix='codex-jupyter-skill.')
        cls.log_path = Path(tempfile.mkstemp(prefix='codex-jupyter-lab.', suffix='.log')[1])
        cls.log_handle = cls.log_path.open('w', encoding='utf-8')
        cls.port = cls._find_free_port()
        cls.base_url = f'http://127.0.0.1:{cls.port}'
        cls.headers = {'Authorization': f'token {TOKEN}'}
        cls.proc = cls._start_server()
        cls._wait_for_server_ready()
        cls._create_notebook()
        session = cls._create_session()
        cls.session_id = session['id']
        cls.kernel_id = session['kernel']['id']
        cls._seed_workspace()

    @classmethod
    def tearDownClass(cls) -> None:
        try:
            cls._delete_sessions()
        finally:
            if hasattr(cls, 'proc') and cls.proc.poll() is None:
                cls.proc.terminate()
                try:
                    cls.proc.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    cls.proc.kill()
            if hasattr(cls, 'log_handle') and not cls.log_handle.closed:
                cls.log_handle.close()
            if hasattr(cls, 'root_dir'):
                cls.root_dir.cleanup()
            if hasattr(cls, 'log_path') and cls.log_path.exists():
                cls.log_path.unlink(missing_ok=True)

    @classmethod
    def _start_server(cls) -> subprocess.Popen[str]:
        return subprocess.Popen(
            [
                'jupyter',
                'lab',
                '--no-browser',
                f'--IdentityProvider.token={TOKEN}',
                '--ServerApp.password=',
                f'--ServerApp.port={cls.port}',
                '--ServerApp.port_retries=50',
                f'--ServerApp.root_dir={cls.root_dir.name}',
            ],
            stdout=cls.log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )

    @staticmethod
    def _find_free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(('127.0.0.1', 0))
            sock.listen(1)
            return int(sock.getsockname()[1])

    @classmethod
    def _runtime_server(cls) -> dict[str, object] | None:
        for server in JUPYTER_LIVE_KERNEL.list_running_servers():
            root_dir = server.get('root_dir') or server.get('notebook_dir')
            server_pid = server.get('pid')
            if root_dir == cls.root_dir.name and (server_pid is None or server_pid == cls.proc.pid):
                return server
        return None

    @classmethod
    def _wait_for_server_ready(cls) -> None:
        deadline = time.time() + 60
        while time.time() < deadline:
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.log_path.read_text(encoding='utf-8'))
            runtime_server = cls._runtime_server()
            if runtime_server:
                cls.port = int(runtime_server['port'])
                cls.base_url = str(runtime_server['url']).rstrip('/')
            try:
                response = requests.get(
                    f'{cls.base_url}/api/contents',
                    params={'token': TOKEN},
                    headers=cls.headers,
                    timeout=1,
                )
                if response.status_code == 200:
                    return
            except requests.RequestException:
                pass
            time.sleep(0.25)
        raise RuntimeError(f'JupyterLab did not become ready.\n{cls.log_path.read_text(encoding="utf-8")}')

    @classmethod
    def _api_request(cls, method: str, path: str, **kwargs):
        params = dict(kwargs.pop('params', {}))
        params.setdefault('token', TOKEN)
        response = requests.request(
            method,
            f'{cls.base_url}{path}',
            headers=cls.headers,
            params=params,
            timeout=10,
            **kwargs,
        )
        response.raise_for_status()
        if response.text:
            return response.json()
        return None

    @classmethod
    def _notebook_payload(
        cls,
        cells: list[dict[str, object]],
        *,
        metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        return {
            'type': 'notebook',
            'format': 'json',
            'content': {
                'cells': cells,
                'metadata': metadata or {},
                'nbformat': 4,
                'nbformat_minor': 5,
            },
        }

    @classmethod
    def _put_notebook(
        cls,
        path: str,
        cells: list[dict[str, object]],
        *,
        metadata: dict[str, object] | None = None,
    ) -> None:
        cls._api_request('PUT', f'/api/contents/{path}', json=cls._notebook_payload(cells, metadata=metadata))

    @staticmethod
    def _code_cell(
        cell_id: str,
        source: str,
        *,
        execution_count: int | None = None,
        outputs: list[dict[str, object]] | None = None,
        metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        return {
            'id': cell_id,
            'cell_type': 'code',
            'execution_count': execution_count,
            'metadata': metadata or {},
            'outputs': outputs or [],
            'source': source,
        }

    @staticmethod
    def _markdown_cell(
        cell_id: str,
        source: str,
        *,
        attachments: dict[str, object] | None = None,
        metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        cell = {
            'id': cell_id,
            'cell_type': 'markdown',
            'metadata': metadata or {},
            'source': source,
        }
        if attachments:
            cell['attachments'] = attachments
        return cell

    @staticmethod
    def _raw_cell(
        cell_id: str,
        source: str,
        *,
        metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        return {
            'id': cell_id,
            'cell_type': 'raw',
            'metadata': metadata or {},
            'source': source,
        }

    @classmethod
    def _create_notebook(cls) -> None:
        cls._put_notebook(
            NOTEBOOK_PATH,
            [
                {
                    'id': 'demo-code',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'a = 40\na + 1',
                },
                {
                    'id': 'demo-markdown',
                    'cell_type': 'markdown',
                    'metadata': {},
                    'source': '# Demo notebook',
                },
            ],
        )

    @classmethod
    def _create_session(cls) -> dict[str, object]:
        payload = {
            'path': NOTEBOOK_PATH,
            'type': 'notebook',
            'name': '',
            'kernel': {'name': 'python3'},
        }
        return cls._api_request('POST', '/api/sessions', json=payload)

    @classmethod
    def _create_session_for_path(cls, path: str) -> dict[str, object]:
        payload = {
            'path': path,
            'type': 'notebook',
            'name': '',
            'kernel': {'name': 'python3'},
        }
        return cls._api_request('POST', '/api/sessions', json=payload)

    @classmethod
    def _seed_workspace(cls) -> None:
        payload = {
            'data': {
                'layout-restorer:data': {
                    'main': {
                        'dock': {'type': 'tab-area', 'widgets': [f'notebook:{NOTEBOOK_PATH}']},
                        'current': f'notebook:{NOTEBOOK_PATH}',
                    }
                }
            },
            'metadata': {'id': WORKSPACE_ID},
        }
        cls._api_request('PUT', f'/lab/api/workspaces/{WORKSPACE_ID}', json=payload)

    @classmethod
    def _delete_sessions(cls) -> None:
        sessions = cls._api_request('GET', '/api/sessions')
        for session in sessions:
            requests.delete(
                f'{cls.base_url}/api/sessions/{session["id"]}',
                params={'token': TOKEN},
                headers=cls.headers,
                timeout=10,
            )

    def _run_cli(self, *args: str) -> dict[str, object]:
        completed = self._run_cli_completed(*args)
        if completed.returncode != 0:
            self.fail(f'CLI failed\nstdout:\n{completed.stdout}\nstderr:\n{completed.stderr}')
        return json.loads(completed.stdout)

    def _run_cli_completed(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH), *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def _run_cli_error(self, *args: str) -> dict[str, object]:
        completed = self._run_cli_completed(*args)
        if completed.returncode == 0:
            self.fail(f'CLI unexpectedly succeeded\nstdout:\n{completed.stdout}\nstderr:\n{completed.stderr}')
        payload = completed.stdout.strip() or completed.stderr.strip()
        return json.loads(payload)

    @staticmethod
    def _execute_result_texts(payload: dict[str, object]) -> list[str]:
        events = payload.get('events') or []
        return [event['data']['text/plain'] for event in events if event['type'] == 'execute_result']

    @classmethod
    def _last_execute_result_value(cls, payload: dict[str, object]) -> object:
        results = cls._execute_result_texts(payload)
        if not results:
            raise AssertionError(f'No execute_result events found in payload: {payload}')
        return ast.literal_eval(results[-1])

    def test_servers_discovers_live_server(self) -> None:
        payload = self._run_cli('servers', '--compact')
        matches = [item for item in payload['servers'] if item['server'].get('port') == self.port]
        self.assertEqual(len(matches), 1)
        self.assertTrue(matches[0]['probe']['reachable'])
        self.assertTrue(matches[0]['probe']['lab_workspaces_available'])

    def test_notebooks_combines_sessions_and_workspaces(self) -> None:
        payload = self._run_cli('notebooks', '--port', str(self.port), '--compact')
        notebook = next(item for item in payload['open_notebooks'] if item['path'] == NOTEBOOK_PATH)
        self.assertTrue(notebook['live'])
        self.assertIn(self.session_id, notebook['session_ids'])
        self.assertIn(self.kernel_id, notebook['kernel_ids'])
        self.assertIn(WORKSPACE_ID, notebook['workspace_ids'])

    def test_contents_returns_saved_cells(self) -> None:
        payload = self._run_cli('contents', '--port', str(self.port), '--path', NOTEBOOK_PATH, '--compact')
        self.assertEqual(payload['path'], NOTEBOOK_PATH)
        self.assertEqual(len(payload['cells']), 2)
        self.assertEqual(payload['cells'][0]['cell_id'], 'demo-code')
        self.assertIn('a = 40', payload['cells'][0]['source'])
        self.assertEqual(payload['cells'][1]['cell_type'], 'markdown')

    def _contents(self, path: str) -> dict[str, object]:
        return self._run_cli('contents', '--port', str(self.port), '--path', path, '--compact')

    def _contents_with_outputs(self, path: str) -> dict[str, object]:
        return self._run_cli(
            'contents',
            '--port',
            str(self.port),
            '--path',
            path,
            '--include-outputs',
            '--compact',
        )

    def _raw_contents(self, path: str) -> dict[str, object]:
        return self._run_cli(
            'contents',
            '--port',
            str(self.port),
            '--path',
            path,
            '--raw',
            '--compact',
        )

    def test_edit_replace_source_by_cell_id(self) -> None:
        path = f'replace-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'replace-code',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'value = 1',
                },
                {
                    'id': 'replace-md',
                    'cell_type': 'markdown',
                    'metadata': {},
                    'source': 'keep me',
                },
            ],
        )

        payload = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'replace-source',
            '--cell-id',
            'replace-code',
            '--source',
            'value = 2\nvalue',
            '--compact',
        )
        self.assertTrue(payload['changed'])
        contents = self._contents(path)
        self.assertEqual(contents['cells'][0]['cell_id'], 'replace-code')
        self.assertEqual(contents['cells'][0]['source'], 'value = 2\nvalue')

    def test_legacy_notebook_without_ids_can_be_retargeted_by_reported_cell_id(self) -> None:
        path = f'legacy-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'cell_type': 'markdown',
                    'metadata': {},
                    'source': 'legacy',
                }
            ],
        )

        contents = self._contents(path)
        legacy_id = contents['cells'][0]['cell_id']
        self.assertTrue(legacy_id)

        payload = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'replace-source',
            '--cell-id',
            legacy_id,
            '--source',
            'modernized',
            '--compact',
        )
        self.assertTrue(payload['changed'])

        contents = self._contents(path)
        self.assertEqual(contents['cells'][0]['cell_id'], legacy_id)
        self.assertEqual(contents['cells'][0]['source'], 'modernized')

    def test_edit_insert_delete_and_move_cells(self) -> None:
        path = f'edit-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'cell-one',
                    'cell_type': 'markdown',
                    'metadata': {},
                    'source': 'one',
                },
                {
                    'id': 'cell-two',
                    'cell_type': 'markdown',
                    'metadata': {},
                    'source': 'two',
                },
                {
                    'id': 'cell-three',
                    'cell_type': 'markdown',
                    'metadata': {},
                    'source': 'three',
                },
            ],
        )

        inserted = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'insert',
            '--after',
            '0',
            '--cell-type',
            'code',
            '--source',
            'inserted = True',
            '--compact',
        )
        self.assertTrue(inserted['changed'])
        inserted_id = inserted['cell']['cell_id']

        moved = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'move',
            '--cell-id',
            'cell-three',
            '--to-index',
            '0',
            '--compact',
        )
        self.assertTrue(moved['changed'])

        deleted = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'delete',
            '--cell-id',
            inserted_id,
            '--compact',
        )
        self.assertTrue(deleted['changed'])

        contents = self._contents(path)
        self.assertEqual([cell['cell_id'] for cell in contents['cells']], ['cell-three', 'cell-one', 'cell-two'])
        self.assertEqual([cell['source'] for cell in contents['cells']], ['three', 'one', 'two'])

    def test_edit_clear_outputs_resets_saved_outputs(self) -> None:
        path = f'clear-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'code-cell',
                    'cell_type': 'code',
                    'execution_count': 7,
                    'metadata': {},
                    'outputs': [{'output_type': 'stream', 'name': 'stdout', 'text': 'stale\n'}],
                    'source': 'print("fresh")',
                },
                {
                    'id': 'markdown-cell',
                    'cell_type': 'markdown',
                    'metadata': {},
                    'source': 'keep',
                },
            ],
        )

        payload = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'clear-outputs',
            '--all',
            '--compact',
        )
        self.assertTrue(payload['changed'])
        self.assertEqual(payload['cleared_cell_count'], 1)

        contents = self._contents_with_outputs(path)
        self.assertEqual(contents['cells'][0]['outputs'], [])
        self.assertIsNone(contents['cells'][0]['execution_count'])
        self.assertEqual(contents['cells'][0]['source'], 'print("fresh")')

    def test_edit_operations_preserve_messy_notebook_structure(self) -> None:
        path = f'messy-{uuid.uuid4().hex[:8]}.ipynb'
        notebook_metadata = {
            'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'},
            'language_info': {'name': 'python', 'version': '3.14'},
            'codex_demo': {'scenario': 'messy-notebook', 'audience': 'back-row'},
        }
        rich_html = (
            '<table><thead><tr><th>region</th><th>revenue</th></tr></thead>'
            '<tbody><tr><td>north</td><td>100</td></tr><tr><td>south</td><td>90</td></tr></tbody></table>'
        )
        self._put_notebook(
            path,
            [
                self._markdown_cell(
                    'intro-md',
                    '## Live notebook demo\n![hero](attachment:hero.png)',
                    attachments={'hero.png': {'image/png': TINY_PNG_BASE64}},
                    metadata={'tags': ['intro']},
                ),
                self._code_cell(
                    'setup-summary',
                    'summary = {"rows": 2, "regions": ["north", "south"]}\nsummary',
                    execution_count=3,
                    outputs=[
                        {
                            'output_type': 'execute_result',
                            'execution_count': 3,
                            'data': {
                                'text/plain': "{'rows': 2, 'regions': ['north', 'south']}",
                                'application/json': {'rows': 2, 'regions': ['north', 'south']},
                            },
                            'metadata': {},
                        }
                    ],
                    metadata={'tags': ['setup', 'expensive']},
                ),
                self._code_cell(
                    'df-preview',
                    'sales_df.head()',
                    execution_count=4,
                    outputs=[
                        {
                            'output_type': 'display_data',
                            'data': {
                                'text/plain': '  region  revenue\n0  north      100\n1  south       90',
                                'text/html': rich_html,
                            },
                            'metadata': {},
                        }
                    ],
                    metadata={'tags': ['table']},
                ),
                self._code_cell(
                    'plot-output',
                    'plot_sales()',
                    execution_count=5,
                    outputs=[
                        {
                            'output_type': 'display_data',
                            'data': {
                                'text/plain': '<Figure size 640x480 with 1 Axes>',
                                'image/png': TINY_PNG_BASE64,
                            },
                            'metadata': {},
                        }
                    ],
                    metadata={'tags': ['plot']},
                ),
                self._raw_cell(
                    'speaker-notes',
                    'Do not show this raw notes cell to the audience.',
                    metadata={'format': 'text/plain'},
                ),
                self._markdown_cell(
                    'analysis-md',
                    'The next cell contains a bug we will patch live.',
                    metadata={'tags': ['narrative']},
                ),
                self._code_cell(
                    'buggy-analysis',
                    'metric = profit / cost\nmetric',
                    metadata={'tags': ['bug']},
                ),
            ],
            metadata=notebook_metadata,
        )

        fixed_source = 'metric = profit / revenue\nmetric'
        replaced = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'replace-source',
            '--cell-id',
            'buggy-analysis',
            '--source',
            fixed_source,
            '--compact',
        )
        self.assertTrue(replaced['changed'])

        inserted = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'insert',
            '--after',
            '3',
            '--cell-type',
            'markdown',
            '--source',
            '### Patch applied\nUse the live kernel state for fast iteration.',
            '--compact',
        )
        inserted_id = inserted['cell']['cell_id']
        self.assertEqual(inserted['cell']['cell_type'], 'markdown')

        moved = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'move',
            '--cell-id',
            inserted_id,
            '--to-index',
            '5',
            '--compact',
        )
        self.assertTrue(moved['changed'])

        deleted = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'delete',
            '--cell-id',
            'speaker-notes',
            '--compact',
        )
        self.assertTrue(deleted['changed'])

        cleared = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'clear-outputs',
            '--cell-id',
            'df-preview',
            '--compact',
        )
        self.assertTrue(cleared['changed'])
        self.assertEqual(cleared['cleared_cell_count'], 1)

        raw_contents = self._raw_contents(path)
        content = raw_contents['content']
        cells_by_id = {cell['id']: cell for cell in content['cells']}
        ordered_ids = [cell['id'] for cell in content['cells']]

        self.assertEqual(content['metadata']['codex_demo']['scenario'], 'messy-notebook')
        self.assertEqual(cells_by_id['intro-md']['attachments']['hero.png']['image/png'], TINY_PNG_BASE64)
        self.assertEqual(cells_by_id['plot-output']['outputs'][0]['data']['image/png'], TINY_PNG_BASE64)
        self.assertEqual(cells_by_id['plot-output']['outputs'][0]['data']['text/plain'], '<Figure size 640x480 with 1 Axes>')
        self.assertEqual(cells_by_id['df-preview']['outputs'], [])
        self.assertIsNone(cells_by_id['df-preview']['execution_count'])
        self.assertEqual(cells_by_id['setup-summary']['outputs'][0]['data']['application/json']['rows'], 2)
        self.assertEqual(cells_by_id['buggy-analysis']['source'], fixed_source)
        self.assertNotIn('speaker-notes', cells_by_id)
        self.assertIn(inserted_id, cells_by_id)
        self.assertIn('Patch applied', cells_by_id[inserted_id]['source'])
        self.assertLess(ordered_ids.index(inserted_id), ordered_ids.index('analysis-md'))

    def test_demo_workflow_reuses_live_kernel_state_after_patching_a_buggy_cell(self) -> None:
        path = f'demo-workflow-{uuid.uuid4().hex[:8]}.ipynb'
        setup_source = textwrap.dedent(
            """
            import sqlite3
            import time
            import uuid

            cold_setup_runs = globals().get("cold_setup_runs", 0) + 1
            setup_id = globals().get("setup_id") or uuid.uuid4().hex[:8]
            time.sleep(0.05)

            conn = sqlite3.connect(":memory:")
            cur = conn.cursor()
            cur.execute("create table sales(region text, revenue real, cost real)")
            cur.executemany(
                "insert into sales values (?, ?, ?)",
                [
                    ("north", 100.0, 80.0),
                    ("south", 90.0, 60.0),
                    ("west", 120.0, 50.0),
                ],
            )
            conn.commit()
            """
        ).strip()
        baseline_source = textwrap.dedent(
            """
            row_count = cur.execute("select count(*) from sales").fetchone()[0]
            row_count
            """
        ).strip()
        buggy_source = textwrap.dedent(
            """
            totals = cur.execute("select sum(revenue), sum(cost) from sales").fetchone()
            margin = round((totals[0] - totals[1]) / totals[1], 3)
            margin
            """
        ).strip()
        fixed_source = textwrap.dedent(
            """
            totals = cur.execute("select sum(revenue), sum(cost) from sales").fetchone()
            margin = round((totals[0] - totals[1]) / totals[0], 3)
            margin
            """
        ).strip()
        validation_source = textwrap.dedent(
            """
            {
                "margin": margin,
                "cold_setup_runs": cold_setup_runs,
                "row_count": cur.execute("select count(*) from sales").fetchone()[0],
                "setup_id": setup_id,
            }
            """
        ).strip()

        self._put_notebook(
            path,
            [
                self._markdown_cell(
                    'demo-intro',
                    '# Demo\nPatch the downstream metric without rebuilding the in-memory database.',
                    metadata={'tags': ['intro']},
                ),
                self._code_cell('expensive-setup', setup_source, metadata={'tags': ['setup', 'expensive']}),
                self._code_cell('baseline-check', baseline_source, metadata={'tags': ['baseline']}),
                self._code_cell('buggy-margin', buggy_source, metadata={'tags': ['bug']}),
            ],
            metadata={'codex_demo': {'scenario': 'live-kernel-iteration'}},
        )
        self._create_session_for_path(path)

        initial_contents = self._contents(path)
        self.assertEqual([cell['cell_id'] for cell in initial_contents['cells']], ['demo-intro', 'expensive-setup', 'baseline-check', 'buggy-margin'])

        self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            '--code',
            setup_source,
            '--compact',
        )

        variables = self._run_cli(
            'variables',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            'list',
            '--compact',
        )
        variable_names = {item['name'] for item in variables['variables']}
        self.assertIn('cur', variable_names)
        self.assertIn('setup_id', variable_names)
        self.assertIn('cold_setup_runs', variable_names)

        setup_id_preview = self._run_cli(
            'variables',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            'preview',
            '--name',
            'setup_id',
            '--compact',
        )
        self.assertEqual(setup_id_preview['variable']['type'], 'str')
        self.assertIsInstance(setup_id_preview['variable']['preview'], str)
        self.assertTrue(setup_id_preview['variable']['preview'])

        cursor_preview = self._run_cli(
            'variables',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            'preview',
            '--name',
            'cur',
            '--compact',
        )
        self.assertEqual(cursor_preview['variable']['type'], 'Cursor')
        self.assertEqual(cursor_preview['variable']['preview'], '<sqlite3.Cursor>')

        baseline = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            '--code',
            baseline_source,
            '--compact',
        )
        self.assertEqual(self._last_execute_result_value(baseline), 3)

        buggy = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            '--code',
            buggy_source,
            '--compact',
        )
        self.assertEqual(self._last_execute_result_value(buggy), 0.632)

        replaced = self._run_cli(
            'edit',
            '--port',
            str(self.port),
            '--path',
            path,
            'replace-source',
            '--cell-id',
            'buggy-margin',
            '--source',
            fixed_source,
            '--compact',
        )
        self.assertTrue(replaced['changed'])

        edited_contents = self._contents(path)
        updated_bug_cell = next(cell for cell in edited_contents['cells'] if cell['cell_id'] == 'buggy-margin')
        self.assertEqual(updated_bug_cell['source'], fixed_source)

        fixed = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            '--code',
            updated_bug_cell['source'],
            '--compact',
        )
        self.assertEqual(self._last_execute_result_value(fixed), 0.387)

        validation = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            '--code',
            validation_source,
            '--compact',
        )
        self.assertEqual(
            self._last_execute_result_value(validation),
            {
                'margin': 0.387,
                'cold_setup_runs': 1,
                'row_count': 3,
                'setup_id': setup_id_preview['variable']['preview'],
            },
        )

        verification = self._run_cli(
            'restart-run-all',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            '--compact',
        )
        self.assertEqual(verification['run_all']['status'], 'ok')

        post_verify = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            '--code',
            '{"margin": margin, "cold_setup_runs": cold_setup_runs}',
            '--compact',
        )
        self.assertEqual(self._last_execute_result_value(post_verify), {'margin': 0.387, 'cold_setup_runs': 1})

    def test_execute_over_websocket(self) -> None:
        payload = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            NOTEBOOK_PATH,
            '--transport',
            'websocket',
            '--code',
            'value = 100\nprint("ws ok")\nvalue + 23',
            '--compact',
        )
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['transport'], 'websocket')
        texts = [event['text'] for event in payload['events'] if event['type'] == 'stream']
        results = [event['data']['text/plain'] for event in payload['events'] if event['type'] == 'execute_result']
        self.assertIn('ws ok\n', texts)
        self.assertIn('123', results)

    def test_execute_over_zmq(self) -> None:
        payload = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            NOTEBOOK_PATH,
            '--transport',
            'zmq',
            '--code',
            'value = 7\nprint("zmq ok")\nvalue * 6',
            '--compact',
        )
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['transport'], 'zmq')
        texts = [event['text'] for event in payload['events'] if event['type'] == 'stream']
        results = [event['data']['text/plain'] for event in payload['events'] if event['type'] == 'execute_result']
        self.assertIn('zmq ok\n', texts)
        self.assertIn('42', results)

    def test_restart_clears_live_kernel_state(self) -> None:
        path = f'restart-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'restart-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'baseline = 1',
                }
            ],
        )
        self._create_session_for_path(path)

        self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--code',
            'survivor = 99',
            '--compact',
        )
        self._run_cli('restart', '--port', str(self.port), '--path', path, '--compact')
        payload = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--code',
            '"survivor" in globals()',
            '--compact',
        )
        results = [event['data']['text/plain'] for event in payload['events'] if event['type'] == 'execute_result']
        self.assertIn('False', results)

    def test_run_all_executes_cells_in_order_without_persisting_outputs(self) -> None:
        path = f'run-all-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'cell-one',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'base = 10',
                },
                {
                    'id': 'cell-two',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'derived = base + 5',
                },
                {
                    'id': 'cell-three',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'derived * 2',
                },
            ],
        )
        self._create_session_for_path(path)

        payload = self._run_cli('run-all', '--port', str(self.port), '--path', path, '--compact')
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['executed_cell_count'], 3)
        self.assertIsNone(payload['failed_cell'])

        execution = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--code',
            'derived',
            '--compact',
        )
        results = [event['data']['text/plain'] for event in execution['events'] if event['type'] == 'execute_result']
        self.assertIn('15', results)

        contents = self._contents_with_outputs(path)
        self.assertEqual(contents['cells'][2]['outputs'], [])
        self.assertIsNone(contents['cells'][2]['execution_count'])

    def test_restart_run_all_rebuilds_notebook_state(self) -> None:
        path = f'restart-run-all-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'seed-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'seed = 1',
                },
                {
                    'id': 'check-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'seed',
                },
            ],
        )
        self._create_session_for_path(path)

        self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--code',
            'seed = 999',
            '--compact',
        )
        payload = self._run_cli('restart-run-all', '--port', str(self.port), '--path', path, '--compact')
        self.assertEqual(payload['run_all']['status'], 'ok')

        execution = self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--code',
            'seed',
            '--compact',
        )
        results = [event['data']['text/plain'] for event in execution['events'] if event['type'] == 'execute_result']
        self.assertIn('1', results)

    def test_run_all_returns_nonzero_when_a_cell_fails(self) -> None:
        path = f'run-all-fail-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'ok-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'before = 3',
                },
                {
                    'id': 'fail-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'raise RuntimeError("boom")',
                },
            ],
        )
        self._create_session_for_path(path)

        payload = self._run_cli_error('run-all', '--port', str(self.port), '--path', path, '--compact')
        self.assertEqual(payload['status'], 'error')
        self.assertEqual(payload['failed_cell']['cell_id'], 'fail-cell')

    def test_restart_run_all_returns_nonzero_when_a_cell_fails(self) -> None:
        path = f'restart-run-all-fail-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'seed-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'seed = 1',
                },
                {
                    'id': 'fail-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'raise ValueError("nope")',
                },
            ],
        )
        self._create_session_for_path(path)

        payload = self._run_cli_error('restart-run-all', '--port', str(self.port), '--path', path, '--compact')
        self.assertEqual(payload['run_all']['status'], 'error')
        self.assertEqual(payload['run_all']['failed_cell']['cell_id'], 'fail-cell')

    def test_variables_list_and_preview(self) -> None:
        path = f'variables-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            path,
            [
                {
                    'id': 'vars-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'placeholder = None',
                }
            ],
        )
        self._create_session_for_path(path)

        self._run_cli(
            'execute',
            '--port',
            str(self.port),
            '--path',
            path,
            '--code',
            (
                'demo_numbers = [0, 1, 2, 3]\n'
                'demo_label = "abc"\n'
                'class Dangerous:\n'
                '    def __repr__(self):\n'
                '        raise RuntimeError("repr should not run")\n'
                'danger = Dangerous()'
            ),
            '--compact',
        )

        variables = self._run_cli(
            'variables',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            'list',
            '--compact',
        )
        names = {item['name'] for item in variables['variables']}
        self.assertIn('demo_numbers', names)
        self.assertIn('demo_label', names)
        self.assertNotIn('get_ipython', names)

        preview = self._run_cli(
            'variables',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            'preview',
            '--name',
            'demo_numbers',
            '--max-chars',
            '20',
            '--compact',
        )
        self.assertEqual(preview['variable']['type'], 'list')
        self.assertEqual(preview['variable']['preview']['kind'], 'list')
        self.assertEqual(preview['variable']['preview']['length'], 4)
        self.assertEqual(preview['variable']['preview']['items'], [0, 1, 2, 3])

        preview = self._run_cli(
            'variables',
            '--port',
            str(self.port),
            '--path',
            path,
            '--transport',
            'zmq',
            'preview',
            '--name',
            'danger',
            '--max-chars',
            '20',
            '--compact',
        )
        self.assertEqual(preview['variable']['type'], 'Dangerous')
        self.assertEqual(preview['variable']['preview'], '<__main__.Dangerous>')

    def test_conflicting_live_target_flags_fail_fast(self) -> None:
        other_path = f'conflict-{uuid.uuid4().hex[:8]}.ipynb'
        self._put_notebook(
            other_path,
            [
                {
                    'id': 'other-cell',
                    'cell_type': 'code',
                    'execution_count': None,
                    'metadata': {},
                    'outputs': [],
                    'source': 'other = 1',
                }
            ],
        )
        other_session = self._create_session_for_path(other_path)

        payload = self._run_cli_error(
            'execute',
            '--port',
            str(self.port),
            '--path',
            NOTEBOOK_PATH,
            '--session-id',
            str(other_session['id']),
            '--code',
            '1 + 1',
        )
        self.assertIn('Conflicting live target selectors', payload['error'])

    def test_kernel_id_must_match_a_live_session(self) -> None:
        payload = self._run_cli_error(
            'execute',
            '--port',
            str(self.port),
            '--kernel-id',
            'missing-kernel-id',
            '--code',
            '1 + 1',
        )
        self.assertIn('No live session matched kernel id', payload['error'])

    def test_variables_enforce_bounded_limits(self) -> None:
        payload = self._run_cli_error(
            'variables',
            '--port',
            str(self.port),
            '--path',
            NOTEBOOK_PATH,
            'list',
            '--limit',
            '-1',
        )
        self.assertIn('limit must be at least 1', payload['error'])

        payload = self._run_cli_error(
            'variables',
            '--port',
            str(self.port),
            '--path',
            NOTEBOOK_PATH,
            'preview',
            '--name',
            'a',
            '--max-chars',
            '5000',
        )
        self.assertIn('max-chars must be at most 2000', payload['error'])


if __name__ == '__main__':
    unittest.main()
