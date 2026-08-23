import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize(
    "origin",
    [
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    ],
)
def test_cors_allows_only_supported_webview_origins(
    client: TestClient, origin: str
) -> None:
    response = client.options(
        "/settings",
        headers={"Origin": origin, "Access-Control-Request-Method": "PUT"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_does_not_allow_an_unknown_origin(client: TestClient) -> None:
    response = client.options(
        "/settings",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert "access-control-allow-origin" not in response.headers
