# huggingface/smolagents at 96f33fa. Copy to tests/, then run:
#   pytest tests/test_refuzz_191a2cdff5_reach.py

import ast
from smolagents.local_python_executor import evaluate_unaryop


def test_refuzz_191a2cdff5_reach_via_unaryop():
    user_code = "-((((87 ** 87) ** 87) ** 87) ** 87)"
    node = ast.parse(user_code, mode="exec").body[0].value
    assert isinstance(node, ast.UnaryOp)
    evaluate_unaryop(node, {}, {}, {}, [])
