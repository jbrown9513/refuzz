# mem0ai/mem0 at 26cdefb. Copy to cli/python/, then run:
#   pytest cli/python/test_refuzz_f61f79e555.py

from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, "/src/mem0/cli/python/src")
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
import json
from io import StringIO
from unittest.mock import MagicMock, patch
import pytest
from rich.console import Console
from mem0_cli.commands.utils import cmd_import

def _make_console():
    buf = StringIO()
    return Console(file=buf, force_terminal=False, no_color=True, width=120), buf

def _make_err_console():
    buf = StringIO()
    return Console(file=buf, force_terminal=False, no_color=True, width=120), buf

@pytest.fixture
def mock_backend():
    backend = MagicMock()
    backend.add.return_value = {"id": "x"}
    return backend

def test_refuzz_f61f79e555_import_int_entry(mock_backend, tmp_path):
    file_path = tmp_path / "import.json"
    file_path.write_text(json.dumps([123]))
    console, _buf = _make_console()
    err_console, _err_buf = _make_err_console()
    with (
        patch("mem0_cli.commands.utils.console", console),
        patch("mem0_cli.commands.utils.err_console", err_console),
    ):
        cmd_import(mock_backend, str(file_path), user_id="alice", agent_id=None)
