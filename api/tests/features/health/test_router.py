from fastapi.testclient import TestClient
from sqlmodel import Session, select

from meetwrite.db.models import Preferences, User


def test_startup_is_ready_and_bootstraps_owned_state(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    request_id = response.headers["x-request-id"]
    assert len(request_id) == 32
    int(request_id, 16)

    with Session(client.app.state.runtime.engine) as session:
        users = session.exec(select(User)).all()
        assert [(user.id, user.name) for user in users] == [(1, None)]
        assert session.get(Preferences, 1) is not None
