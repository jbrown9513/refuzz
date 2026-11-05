# bentoml/BentoML at 942344b. Copy to tests/unit/, then run:
#   pytest tests/unit/test_refuzz_fileschema.py

from pathlib import Path

from _bentoml_sdk.validators import FileSchema


def test_string_input_is_decoded():
    assert Path(FileSchema().decode("hello")).read_bytes() == b"hello"
