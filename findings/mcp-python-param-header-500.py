# modelcontextprotocol/python-sdk at d7845c0. Install that commit, then run:
#   python mcp-python-param-header-500.py

import anyio, httpx2 as httpx
from mcp.server.mcpserver import MCPServer
from mcp_types.version import LATEST_MODERN_VERSION

mcp = MCPServer("demo")

@mcp.tool()
def echo(text: str) -> str:
    return text

async def main():
    app = mcp.streamable_http_app()
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "echo", "arguments": {"text": "hi"},
                       "_meta": {"io.modelcontextprotocol/protocolVersion": LATEST_MODERN_VERSION,
                                 "io.modelcontextprotocol/clientCapabilities": {}}}}
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as c:
            for name in [b"echo", b"=?base64?ZWNobw==?=", b"=?base64?\xe9?="]:
                r = await c.post("/mcp", json=body, headers=[(b"mcp-protocol-version", LATEST_MODERN_VERSION.encode()),
                    (b"accept", b"application/json, text/event-stream"), (b"mcp-method", b"tools/call"), (b"mcp-name", name)])
                print(name, r.status_code, r.text[:200].replace("\n", " "))

anyio.run(main)
