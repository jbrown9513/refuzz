# PrefectHQ/prefect at acc006a. Copy to tests/, then run:
#   pytest tests/test_refuzz_5af7c9f545_reach.py

from unittest.mock import AsyncMock, patch
from prefect.cli.block import blocktype_inspect
from prefect.client.schemas.objects import BlockType
import asyncio


def test_refuzz_5af7c9f545_reach_empty_description():
    block_type = BlockType.model_construct(name="valid-block", slug="valid-slug", description="", id="11111111-1111-1111-1111-111111111111")
    fake_schema = type("FakeSchema", (), {"fields": {"properties": {}}})()
    mock_client = AsyncMock()
    mock_client.read_block_type_by_slug.return_value = block_type
    mock_client.get_most_recent_block_schema_for_block_type.return_value = fake_schema
    with patch("prefect.client.orchestration.get_client") as mock_get:
        mock_get.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_get.return_value.__aexit__ = AsyncMock(return_value=False)
        asyncio.run(blocktype_inspect("valid-slug"))
