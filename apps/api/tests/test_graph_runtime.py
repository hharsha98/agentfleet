"""Unit tests for the pure, LLM-free pieces of the LangGraph runtime
(services/graph_runtime.py): the conditional-routing function and the
tool-spec assembly. Deliberately does NOT run a live graph against a model
provider — that's covered by a manual smoke test, not CI.
"""

from langchain_core.messages import AIMessage
from langgraph.graph import END

from app.services.graph_runtime import route_after_model, tool_specs_for_agent
from app.tools import TOOLS


def test_route_after_model_with_tool_calls_goes_to_tools() -> None:
    state = {
        "messages": [
            AIMessage(
                content="",
                tool_calls=[{"name": "web_search", "args": {"query": "x"}, "id": "call_1"}],
            )
        ]
    }
    assert route_after_model(state) == "tools"


def test_route_after_model_without_tool_calls_goes_to_end() -> None:
    state = {"messages": [AIMessage(content="final answer")]}
    assert route_after_model(state) == END


def test_route_after_model_empty_tool_calls_list_goes_to_end() -> None:
    # Some providers send an explicit empty list rather than omitting the
    # field entirely — must not be mistaken for "has tool calls".
    state = {"messages": [AIMessage(content="", tool_calls=[])]}
    assert route_after_model(state) == END


def test_tool_specs_for_agent_merges_builtin_and_mcp() -> None:
    mcp_specs = [
        {
            "type": "function",
            "function": {"name": "mcp_search_lookup", "description": "", "parameters": {}},
        }
    ]
    specs = tool_specs_for_agent(["web_search"], mcp_specs)
    assert specs == [TOOLS["web_search"]["spec"], mcp_specs[0]]


def test_tool_specs_for_agent_filters_unknown_and_handles_empty() -> None:
    assert tool_specs_for_agent(["not_a_tool"], []) == []
    assert tool_specs_for_agent([], []) == []
    assert tool_specs_for_agent(None, []) == []
