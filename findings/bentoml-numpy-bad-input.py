# bentoml/BentoML at 942344b. Copy to tests/unit/, then run:
#   pytest tests/unit/test_refuzz_1d44e497c4_reach.py

import asyncio
import numpy as np
from starlette.requests import Request
from bentoml._internal.io_descriptors.multipart import Multipart
from bentoml._internal.io_descriptors.numpy import NumpyNdarray


def _mk_multipart_request(field_name: str, field_value: str) -> Request:
    boundary = "refuzzboundary12345"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"\r\n'
        f"Content-Type: application/json\r\n"
        f"\r\n"
        f"{field_value}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    headers = [
        (b"content-type", f"multipart/form-data; boundary={boundary}".encode()),
        (b"content-length", str(len(body)).encode()),
    ]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/",
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(scope, receive)


def _make_multipart(np_desc):
    try:
        m = Multipart(arr=np_desc)
        inputs = getattr(m, "_inputs", None)
        if isinstance(inputs, dict) and "arr" in inputs:
            return m
    except Exception:
        pass
    try:
        m = Multipart({"arr": np_desc})
        inputs = getattr(m, "_inputs", None)
        if isinstance(inputs, dict) and "arr" in inputs:
            return m
    except Exception:
        pass
    m = Multipart.__new__(Multipart)
    m._inputs = {"arr": np_desc}
    return m


def test_refuzz_1d44e497c4_reach_uint8_negative_overflow():
    np_desc = NumpyNdarray(dtype=np.dtype("uint8"))
    multipart = _make_multipart(np_desc)
    req = _mk_multipart_request("arr", "-992")
    asyncio.run(multipart.from_http_request(req))
