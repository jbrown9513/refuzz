# langchain-ai/langgraph at 5c96bce. Copy to libs/prebuilt/tests/, then run:
#   pytest libs/prebuilt/tests/test_refuzz_validation_node.py

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt import ValidationNode
from pydantic import BaseModel


class AddArgs(BaseModel):
    a: int


def test_unknown_tool_is_reported_not_raised():
    message = AIMessage("", tool_calls=[{"name": "does_not_exist", "args": {}, "id": "c0"}])
    result = ValidationNode(schemas=[AddArgs]).invoke({"messages": [message]})
    assert isinstance(result["messages"][0], ToolMessage)
