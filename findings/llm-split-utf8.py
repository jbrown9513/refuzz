# simonw/llm at aebaca2. Copy to tests/, then run:
#   pytest tests/test_utils_refuzz_283d47e9cb.py

from llm.utils import _LogResponse


def test_iter_bytes_rejects_undecodable_chunk():
    response = _LogResponse(status_code=200, content=b"\xaa")

    list(response.iter_bytes(chunk_size=1))
