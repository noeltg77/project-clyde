"""
Tool Adapter — converts claude_agent_sdk @tool() definitions into LangChain StructuredTool objects.

This module reads the tool list from tools.py (the same tools registered with the MCP server)
and wraps each one as a LangChain StructuredTool so that the Deep Agents framework can use them.
Both frameworks share a single source of truth for tool definitions.
"""

import asyncio
import inspect
from typing import Any, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model


# Type mapping from the simple {name: type} schema used by @tool() to Pydantic fields.
# All fields are Optional[str] with default None since the tools use args.get() with defaults.
_TYPE_MAP = {
    str: (Optional[str], None),
    int: (Optional[int], None),
    float: (Optional[float], None),
    bool: (Optional[bool], None),
}


def _extract_tool_metadata(tool_obj: Any) -> dict[str, Any] | None:
    """
    Extract name, description, schema, and callable from a claude_agent_sdk tool object.

    The @tool(name, desc, schema) decorator wraps the async function and stores
    metadata on the resulting object. We introspect common attribute patterns.
    """
    # SdkMcpTool objects have: name, description, input_schema, handler
    name = getattr(tool_obj, "name", None)
    description = getattr(tool_obj, "description", None)
    schema = getattr(tool_obj, "input_schema", None)
    func = getattr(tool_obj, "handler", None)

    if not name or not func:
        return None

    return {
        "name": name,
        "description": description or f"Tool: {name}",
        "schema": schema or {},
        "func": func,
    }


def _build_pydantic_model(tool_name: str, schema: dict[str, type]) -> type[BaseModel]:
    """
    Dynamically create a Pydantic model from the {param_name: type} dict
    used by the @tool() decorator.

    All fields are Optional with None defaults since the tool functions
    use args.get() with their own defaults internally.
    """
    if not schema:
        # Tool takes no parameters
        return create_model(f"{tool_name}_Args")

    fields = {}
    for param_name, param_type in schema.items():
        # param_type can be a class (str, int, dict) or sometimes a non-hashable
        # value. Use identity checks for safety.
        if param_type is str:
            field_type, default = Optional[str], None
        elif param_type is int:
            field_type, default = Optional[int], None
        elif param_type is float:
            field_type, default = Optional[float], None
        elif param_type is bool:
            field_type, default = Optional[bool], None
        else:
            # dict, list, or anything else — accept as Optional[str]
            # The tools parse their own args internally anyway
            field_type, default = Optional[str], None
        fields[param_name] = (field_type, Field(default=default))

    return create_model(f"{tool_name}_Args", **fields)


def _extract_text_from_response(response: dict[str, Any]) -> str:
    """
    Extract plain text from the MCP-format tool response.

    Tool functions return: {"content": [{"type": "text", "text": "..."}]}
    LangChain expects a string return.
    """
    if isinstance(response, str):
        return response

    if isinstance(response, dict):
        content = response.get("content", [])
        if isinstance(content, list):
            texts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    texts.append(block.get("text", ""))
            if texts:
                return "\n".join(texts)

        # Fallback: serialise the dict
        import json
        return json.dumps(response, indent=2, default=str)

    return str(response)


def _make_sync_wrapper(async_func):
    """
    Create a wrapper that calls the async tool function from a sync context.

    LangChain's StructuredTool.from_function expects either a sync func or
    an explicit coroutine. We provide both sync and async versions.
    """
    def sync_wrapper(**kwargs) -> str:
        """Sync wrapper that runs the async tool in the current event loop."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # We're already in an async context — this shouldn't happen
            # for the sync path, but just in case
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                result = pool.submit(asyncio.run, async_func(kwargs)).result()
        else:
            result = asyncio.run(async_func(kwargs))

        return _extract_text_from_response(result)

    return sync_wrapper


def _make_async_wrapper(async_func):
    """Create an async wrapper that adapts kwargs → args dict for the tool function."""
    async def async_wrapper(**kwargs) -> str:
        result = await async_func(kwargs)
        return _extract_text_from_response(result)
    return async_wrapper


def adapt_tools(tool_objects: list[Any]) -> list[StructuredTool]:
    """
    Convert a list of claude_agent_sdk tool objects into LangChain StructuredTools.

    Args:
        tool_objects: The tool objects from tools.py (e.g., create_agent_tool, list_agents_tool)

    Returns:
        List of LangChain StructuredTool instances ready for use with Deep Agents
    """
    langchain_tools = []

    for tool_obj in tool_objects:
        meta = _extract_tool_metadata(tool_obj)
        if meta is None:
            continue

        name = meta["name"]
        description = meta["description"]
        schema = meta["schema"]
        func = meta["func"]

        # Build the Pydantic args model
        args_model = _build_pydantic_model(name, schema)

        # Create LangChain tool with both sync and async implementations
        lc_tool = StructuredTool.from_function(
            func=_make_sync_wrapper(func),
            coroutine=_make_async_wrapper(func),
            name=name,
            description=description,
            args_schema=args_model,
            return_direct=False,
        )

        langchain_tools.append(lc_tool)

    return langchain_tools


def get_langchain_tools() -> list[StructuredTool]:
    """
    Get all Clyde tools as LangChain StructuredTool objects.

    Imports the tool list from tools.py and converts them.
    This is the main entry point for the Deep Agent manager.
    """
    # Import individual tool objects directly from tools.py
    from agents import tools as tools_module

    tool_objects = [
        getattr(tools_module, attr)
        for attr in dir(tools_module)
        if attr.endswith("_tool")
        and not attr.startswith("_")
        and hasattr(getattr(tools_module, attr), "name")
        and hasattr(getattr(tools_module, attr), "handler")
    ]

    return adapt_tools(tool_objects)
