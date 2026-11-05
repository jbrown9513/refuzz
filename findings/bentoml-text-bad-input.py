# bentoml/BentoML at 942344b. Copy to tests/unit/, then run:
#   pytest tests/unit/test_refuzz_43e6987c93_reach.py

import asyncio
from bentoml.io import Multipart, Text
from starlette.requests import Request


def test_refuzz_43e6987c93_reach_multipart_invalid_utf8():
    boundary = "BOUNDARY12345"
    raw = b"\xa9"
    prefix = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="data"; filename="a.txt"\r\n'
        "Content-Type: text/plain\r\n"
        "\r\n"
    ).encode("utf-8")
    suffix = f"\r\n--{boundary}--\r\n".encode("utf-8")
    body = prefix + raw + suffix
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/",
        "query_string": b"",
        "headers": [
            (b"content-type", f"multipart/form-data; boundary={boundary}".encode()),
            (b"content-length", str(len(body)).encode()),
        ],
        "client": ("127.0.0.1", 123),
        "server": ("testserver", 80),
    }
    request = Request(scope, receive)
    descriptor = Multipart(data=Text())
    asyncio.run(descriptor.from_http_request(request))
