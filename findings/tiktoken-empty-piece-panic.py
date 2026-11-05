# openai/tiktoken at 4e71bbe. Copy to tests/, then run:
#   pytest tests/test_refuzz_c34e41d9c9.py

import tiktoken


def test_encode_ordinary_empty_regex_match():
    encoding = tiktoken.Encoding(
        name="refuzz_c34e41d9c9",
        pat_str=r"(?s)(?:)",
        mergeable_ranks={b"a": 0},
        special_tokens={},
    )

    encoding.encode_ordinary("")
