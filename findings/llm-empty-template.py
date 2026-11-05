# simonw/llm at aebaca2. Copy to tests/, then run:
#   pytest tests/test_refuzz_fdfc05ff4d.py

import pytest

from llm.cli import LoadTemplateError
from llm.cli import load_template


def test_load_template_empty_yaml_refuzz_fdfc05ff4d(tmp_path):
    template_path = tmp_path / "empty.yaml"
    template_path.write_text("", encoding="utf-8")

    with pytest.raises(LoadTemplateError):
        load_template(str(template_path))
