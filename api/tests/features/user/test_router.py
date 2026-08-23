from fastapi.testclient import TestClient
from sqlmodel import Session, select

from meetwrite.db.models import User


def test_onboarding_updates_the_bootstrapped_profile(client: TestClient) -> None:
    assert client.get("/me").status_code == 404

    created = client.put("/me", json={"name": "  Ada  "})
    updated = client.put("/me", json={"name": "Grace"})

    assert created.status_code == 200
    assert created.json() == {"id": 1, "name": "Ada"}
    assert updated.json() == {"id": 1, "name": "Grace"}
    assert client.get("/me").json() == updated.json()

    with Session(client.app.state.runtime.engine) as session:
        assert len(session.exec(select(User)).all()) == 1


def test_blank_name_does_not_replace_the_profile(client: TestClient) -> None:
    client.put("/me", json={"name": "Ada"})

    assert client.put("/me", json={"name": "   "}).status_code == 422
    assert client.get("/me").json()["name"] == "Ada"
