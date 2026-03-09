from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


def uv_bin() -> str | None:
    return shutil.which("uv")


def skill_script_command(script_path: Path) -> list[str]:
    uv = uv_bin()
    if uv:
        return [uv, "run", str(script_path)]
    return [sys.executable, str(script_path)]


def jupyter_lab_command() -> list[str]:
    scripts_dir = Path(sys.executable).parent
    script_name = "jupyter-lab.exe" if os.name == "nt" else "jupyter-lab"
    candidate = scripts_dir / script_name
    if candidate.exists():
        return [str(candidate)]
    resolved = shutil.which("jupyter-lab")
    if resolved:
        return [resolved]
    return [sys.executable, "-m", "jupyterlab"]
