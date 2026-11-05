# open-iscsi/targetcli-fb at a2a26e2. Copy to tests/, then run:
#   pytest tests/test_refuzz_919b2f683f_reach.py

import sys
from unittest.mock import Mock, patch, mock_open
from targetcli.targetcli_shell import main


def test_main_batch_mode_eof():
    shell = Mock()
    shell.prefs = {"auto_use_daemon": True, "daemon_use_batch_mode": True}
    with patch.object(sys, "argv", ["targetcli"]):
        with patch("targetcli.targetcli_shell.TargetCLI", return_value=shell):
            with patch("targetcli.targetcli_shell.try_op_lock"):
                with patch("builtins.open", mock_open()):
                    with patch("builtins.input", side_effect=EOFError):
                        main()
