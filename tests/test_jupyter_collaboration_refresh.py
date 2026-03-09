from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import requests
from tests.support import jupyter_lab_command, skill_script_command

try:
    from playwright.sync_api import expect, sync_playwright
except ImportError:  # pragma: no cover - handled by skip guard
    expect = None
    sync_playwright = None


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py"
TOKEN = "testtoken"
RUN_BROWSER_INTEGRATION = os.environ.get("JLK_RUN_BROWSER_INTEGRATION") == "1"
ARTIFACT_DIR = os.environ.get("JLK_BROWSER_ARTIFACT_DIR")
HAS_PLAYWRIGHT = sync_playwright is not None
HAS_COLLABORATION = importlib.util.find_spec("jupyter_collaboration") is not None


@unittest.skipUnless(
    RUN_BROWSER_INTEGRATION and HAS_PLAYWRIGHT and HAS_COLLABORATION,
    "browser integration skipped (set JLK_RUN_BROWSER_INTEGRATION=1 and install playwright + jupyter-collaboration)",
)
class JupyterCollaborationRefreshTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root_dir = tempfile.TemporaryDirectory(prefix="codex-jupyter-collab.")
        log_fd, log_name = tempfile.mkstemp(prefix="codex-jupyter-collab.", suffix=".log")
        os.close(log_fd)
        cls.log_path = Path(log_name)
        cls.log_handle = cls.log_path.open("w", encoding="utf-8")
        cls.port = cls._find_free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.headers = {"Authorization": f"token {TOKEN}"}
        cls.proc = cls._start_server()
        cls._wait_for_server_ready()
        cls._put_notebook(
            "demo.ipynb",
            [
                {
                    "id": "md-1",
                    "cell_type": "markdown",
                    "metadata": {},
                    "source": "ORIGINAL_MARKDOWN_TEXT",
                }
            ],
        )

    @classmethod
    def tearDownClass(cls) -> None:
        try:
            if hasattr(cls, "proc") and cls.proc.poll() is None:
                cls.proc.terminate()
                try:
                    cls.proc.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    cls.proc.kill()
        finally:
            if hasattr(cls, "log_handle") and not cls.log_handle.closed:
                cls.log_handle.close()
            if hasattr(cls, "root_dir"):
                cls.root_dir.cleanup()
            if hasattr(cls, "log_path") and cls.log_path.exists():
                cls.log_path.unlink(missing_ok=True)

    @staticmethod
    def _find_free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            return int(sock.getsockname()[1])

    @classmethod
    def _start_server(cls) -> subprocess.Popen[str]:
        return subprocess.Popen(
            [
                *jupyter_lab_command(),
                "--no-browser",
                "--collaborative",
                "--LabApp.extension_manager=readonly",
                f"--IdentityProvider.token={TOKEN}",
                "--ServerApp.password=",
                f"--ServerApp.port={cls.port}",
                "--ServerApp.port_retries=0",
                f"--ServerApp.root_dir={cls.root_dir.name}",
            ],
            stdout=cls.log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )

    @classmethod
    def _wait_for_server_ready(cls) -> None:
        deadline = time.time() + 60
        while time.time() < deadline:
            if cls.proc.poll() is not None:
                cls.log_handle.flush()
                raise RuntimeError(cls.log_path.read_text(encoding="utf-8"))
            try:
                response = requests.get(
                    f"{cls.base_url}/api/contents",
                    params={"token": TOKEN},
                    headers=cls.headers,
                    timeout=1,
                )
                if response.status_code == 200:
                    return
            except requests.RequestException:
                pass
            time.sleep(0.25)
        raise RuntimeError(f"JupyterLab did not become ready.\n{cls.log_path.read_text(encoding='utf-8')}")

    @classmethod
    def _api_request(cls, method: str, path: str, **kwargs):
        params = dict(kwargs.pop("params", {}))
        params.setdefault("token", TOKEN)
        response = requests.request(
            method,
            f"{cls.base_url}{path}",
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
    def _put_notebook(cls, path: str, cells: list[dict[str, object]]) -> None:
        cls._api_request(
            "PUT",
            f"/api/contents/{path}",
            json={
                "type": "notebook",
                "format": "json",
                "content": {
                    "cells": cells,
                    "metadata": {},
                    "nbformat": 4,
                    "nbformat_minor": 5,
                },
            },
        )

    @classmethod
    def _create_session(cls, path: str) -> dict[str, object]:
        return cls._api_request(
            "POST",
            "/api/sessions",
            json={
                "path": path,
                "type": "notebook",
                "name": "",
                "kernel": {"name": "python3"},
            },
        )

    @staticmethod
    def _artifact_path(name: str) -> Path | None:
        if not ARTIFACT_DIR:
            return None
        target_dir = Path(ARTIFACT_DIR)
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / name

    def test_browser_updates_after_skill_edit_without_reload(self) -> None:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1440, "height": 1100})
                navigations: list[str] = []
                page.on(
                    "framenavigated",
                    lambda frame: navigations.append(frame.url) if frame == page.main_frame else None,
                )

                page.goto(
                    f"{self.base_url}/lab/tree/demo.ipynb?token={TOKEN}",
                    wait_until="domcontentloaded",
                    timeout=120000,
                )

                original = page.locator(".cm-content").filter(has_text="ORIGINAL_MARKDOWN_TEXT").first
                expect(original).to_contain_text("ORIGINAL_MARKDOWN_TEXT", timeout=30000)

                before_shot = self._artifact_path("collaboration-before.png")
                if before_shot is not None:
                    page.screenshot(path=str(before_shot), full_page=True)

                navs_after_load = list(navigations)

                edit = subprocess.run(
                    [
                        *skill_script_command(SCRIPT_PATH),
                        "edit",
                        "--port",
                        str(self.port),
                        "--path",
                        "demo.ipynb",
                        "replace-source",
                        "--cell-id",
                        "md-1",
                        "--source",
                        "UPDATED_MARKDOWN_TEXT",
                        "--compact",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertEqual(edit.returncode, 0, msg=edit.stderr or edit.stdout)

                payload = json.loads(edit.stdout)
                self.assertTrue(payload["changed"])

                updated = page.locator(".cm-content").filter(has_text="UPDATED_MARKDOWN_TEXT").first
                expect(updated).to_contain_text("UPDATED_MARKDOWN_TEXT", timeout=10000)

                after_shot = self._artifact_path("collaboration-after.png")
                if after_shot is not None:
                    page.screenshot(path=str(after_shot), full_page=True)

                self.assertEqual(navigations, navs_after_load)
            finally:
                browser.close()

    def test_browser_updates_after_restart_run_all_save_outputs_without_reload(self) -> None:
        path = "restart-run-all-save.ipynb"
        self._put_notebook(
            path,
            [
                {
                    "id": "seed-cell",
                    "cell_type": "code",
                    "execution_count": None,
                    "metadata": {},
                    "outputs": [],
                    "source": "seed = 41",
                },
                {
                    "id": "result-cell",
                    "cell_type": "code",
                    "execution_count": None,
                    "metadata": {},
                    "outputs": [],
                    "source": "seed + 1",
                },
            ],
        )
        session = self._create_session(path)

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1440, "height": 1100})
                navigations: list[str] = []
                page.on(
                    "framenavigated",
                    lambda frame: navigations.append(frame.url) if frame == page.main_frame else None,
                )

                page.goto(
                    f"{self.base_url}/lab/tree/{path}?token={TOKEN}",
                    wait_until="domcontentloaded",
                    timeout=120000,
                )

                source = page.locator(".cm-content").filter(has_text="seed + 1").first
                expect(source).to_contain_text("seed + 1", timeout=30000)

                navs_after_load = list(navigations)

                result = subprocess.run(
                    [
                        *skill_script_command(SCRIPT_PATH),
                        "restart-run-all",
                        "--port",
                        str(self.port),
                        "--path",
                        path,
                        "--session-id",
                        str(session["id"]),
                        "--save-outputs",
                        "--compact",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                self.assertEqual(result.returncode, 0, msg=result.stderr or result.stdout)

                payload = json.loads(result.stdout)
                self.assertEqual(payload["run_all"]["status"], "ok")
                self.assertTrue(payload["run_all"]["outputs_saved"])

                output = page.locator(".jp-OutputArea-output").filter(has_text="42").first
                expect(output).to_contain_text("42", timeout=15000)
                self.assertEqual(navigations, navs_after_load)
            finally:
                browser.close()
