# huggingface/smolagents at 96f33fa. Copy to tests/, then run:
#   pytest tests/test_refuzz_625e49b0f4.py

from smolagents._function_type_hints_utils import get_json_schema


def test_refuzz_625e49b0f4_integer_choices_become_enum():
    def select_number(value: int) -> int:
        """
        Select a number.

        Args:
            value: The number to select (choices: [1, 2, 3])

        Returns:
            Selected number.
        """
        return value

    schema = get_json_schema(select_number)
    assert schema["function"]["parameters"]["properties"]["value"]["enum"] == [1, 2, 3]
