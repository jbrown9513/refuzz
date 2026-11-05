# PrefectHQ/prefect at acc006a. Copy to tests/, then run:
#   pytest tests/test_refuzz_07e2133bc8_reach.py

import pytest
from prefect.cli.server import start


def test_refuzz_07e2133bc8_reach_markup_host_crashes_error_handler():
    """Invalid host with markup should exit cleanly, not crash error reporting."""
    with pytest.raises(SystemExit):
        start(host="[/t]")
