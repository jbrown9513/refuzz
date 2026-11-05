# simonw/llm at aebaca2. Copy to tests/, then run:
#   pytest tests/test_utils_refuzz_54120afa39.py

from llm.utils import mimetype_from_string


def test_mimetype_from_string_empty_input_refuzz_54120afa39():
    assert mimetype_from_string(b"") is None
