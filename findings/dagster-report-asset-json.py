# dagster-io/dagster at ab2572e6. Copy to python_modules/dagster-webserver/dagster_webserver_tests/, then run:
#   pytest python_modules/dagster-webserver/dagster_webserver_tests/test_refuzz_27d052f677.py

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient
from dagster_webserver.external_assets import handle_report_asset_materialization_request

async def _refuzz_route(request):
    return await handle_report_asset_materialization_request(None, request)

_app = Starlette(routes=[Route("/report_asset_materialization", _refuzz_route, methods=["POST"])])
_client = TestClient(_app)

def test_refuzz_27d052f677_truncated_json_body():
    truncated = b'{"asset_key": ["my_asset", "part'
    response = _client.post("/report_asset_materialization", content=truncated, headers={"content-type": "application/json"})
    assert response.status_code == 400
