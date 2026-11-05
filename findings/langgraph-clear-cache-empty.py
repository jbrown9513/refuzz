# langchain-ai/langgraph at 5c96bce. Copy to libs/langgraph/tests/, then run:
#   pytest libs/langgraph/tests/test_refuzz_206404e946.py

from typing import TypedDict
from langgraph.cache.memory import InMemoryCache
from langgraph.graph import END, START, StateGraph


class CacheState(TypedDict):
    x: int


def _my_node(state: CacheState) -> dict:
    return {"x": state.get("x", 0) + 1}


def test_refuzz_206404e946_clear_cache_empty_list_clears_nothing():
    builder = StateGraph(CacheState)
    builder.add_node("mynode", _my_node)
    builder.add_edge(START, "mynode")
    builder.add_edge("mynode", END)
    graph = builder.compile(cache=InMemoryCache())
    seen = {}
    orig_clear = graph.cache.clear

    def spy(namespaces):
        seen["namespaces"] = list(namespaces)
        return orig_clear(namespaces)

    graph.cache.clear = spy
    result = graph.clear_cache([])
    assert result is None
    assert seen["namespaces"] == []
