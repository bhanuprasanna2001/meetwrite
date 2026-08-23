import json
from pathlib import Path

from meetwrite.app import create_app


def test_openapi_matches_the_committed_desktop_contract() -> None:
    snapshot_path = Path(__file__).parents[1] / "openapi.json"
    expected = snapshot_path.read_text(encoding="utf-8")
    actual = json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n"

    assert actual == expected, (
        "OpenAPI changed. Coordinate the desktop contract, then run "
        "`uv run python scripts/export_openapi.py`."
    )
