# langchain-ai/langgraph at 5c96bce. Copy to libs/langgraph/tests/, then run:
#   pytest libs/langgraph/tests/test_refuzz_0040ea9f4b.py

from langgraph.channels.last_value import LastValue
from langgraph.pregel.main import NodeBuilder, Pregel


def test_refuzz_0040ea9f4b_get_graph_empty_tasks():
    outer = Pregel(
        nodes={"a": NodeBuilder().subscribe_only("inp").do(lambda _: "v").write_to("out")},
        channels={"inp": LastValue(str), "out": LastValue(str)},
        input_channels=["inp"],
        output_channels=["out"],
    )
    graph = outer.get_graph()
    assert graph is not None
