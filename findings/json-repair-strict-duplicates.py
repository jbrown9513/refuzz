# mangiucugna/json_repair at f18ce67. Copy to tests/, then run:
#   pytest tests/test_refuzz_56f4c8f222_reach.py

import io
import sys

from src.json_repair.json_repair import cli


def test_cli_strict_rejects_duplicate_keys(monkeypatch):
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO('{"5b6034365d":0,"5b6034365d":1}'),
    )

    assert cli(["--strict", "--skip-json-loads"]) == 1
