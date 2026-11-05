# mangiucugna/json_repair at f13a96b. Copy to tests/, then run:
#   pytest tests/test_refuzz_trailing_backslash.py

from json_repair import repair_json


def test_truncated_object_keeps_backslash():
    assert repair_json('{"path": "C:\\\\"', return_objects=True) == {"path": "C:\\"}


def test_array_keeps_backslash():
    assert repair_json('["R\\\\"]', return_objects=True, skip_json_loads=True) == ["R\\"]
