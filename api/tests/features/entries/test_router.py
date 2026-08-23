from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from meetwrite.db.models import Chat, EnhancedVersion, Entry, Message, TranscriptLine
from tests.conftest import acting_as, create_entry


def test_entry_lifecycle_preserves_partial_updates(client: TestClient) -> None:
    assert client.get("/entries").json() == []
    created = client.post("/entries")
    entry = created.json()

    assert created.status_code == 201
    assert entry["title"] is None
    assert entry["note_md"] is None
    assert entry["transcript"] is None
    assert entry["created_at"].endswith("Z")
    assert entry["updated_at"].endswith("Z")

    note = "  first line\nsecond line  "
    saved = client.patch(f"/entries/{entry['id']}", json={"note_md": note}).json()
    titled = client.patch(
        f"/entries/{entry['id']}", json={"title": "Design review"}
    ).json()

    assert saved["note_md"] == note
    assert titled["note_md"] == note
    assert client.get(f"/entries/{entry['id']}").json() == titled
    # The preview is the note's own text, even when it has a title.
    assert client.get("/entries").json()[0]["preview"] == "first line second line"

    cleared = client.patch(f"/entries/{entry['id']}", json={"title": " \n "}).json()
    assert cleared["title"] is None
    assert cleared["note_md"] == note
    assert client.get("/entries").json()[0]["preview"] == "first line second line"

    # With no content written, the title is the only preview available.
    client.patch(
        f"/entries/{entry['id']}", json={"title": "Only title", "note_md": None}
    ).json()
    assert client.get("/entries").json()[0]["preview"] == "Only title"

    assert client.delete(f"/entries/{entry['id']}").status_code == 204
    assert client.get(f"/entries/{entry['id']}").status_code == 404
    assert client.get("/entries").json() == []


def test_history_has_a_stable_tie_breaker(client: TestClient) -> None:
    first = create_entry(client)
    second = create_entry(client)
    same_time = datetime(2026, 1, 1, tzinfo=UTC)

    with Session(client.app.state.runtime.engine) as session:
        for entry_id in (first["id"], second["id"]):
            entry = session.get(Entry, entry_id)
            assert entry is not None
            entry.updated_at = same_time
            session.add(entry)
        session.commit()

    assert [entry["id"] for entry in client.get("/entries").json()] == [
        second["id"],
        first["id"],
    ]


def test_entries_are_scoped_to_the_current_user(client: TestClient) -> None:
    local = create_entry(client, note_md="local note")

    with acting_as(client, 2):
        assert client.get("/entries").json() == []
        assert client.get(f"/entries/{local['id']}").status_code == 404
        other = create_entry(client, note_md="other note")

    assert [entry["id"] for entry in client.get("/entries").json()] == [local["id"]]
    assert client.get(f"/entries/{other['id']}").status_code == 404


def test_deleting_an_entry_cascades_to_all_database_children(
    client: TestClient,
) -> None:
    entry_id = create_entry(client)["id"]
    engine = client.app.state.runtime.engine

    with Session(engine) as session:
        chat = Chat(user_id=1, entry_id=entry_id)
        session.add(chat)
        session.flush()
        assert chat.id is not None
        children = [
            Message(user_id=1, chat_id=chat.id, role="user", content="hello"),
            TranscriptLine(
                user_id=1, entry_id=entry_id, sequence=1, source="me", text="hello"
            ),
            EnhancedVersion(
                user_id=1, entry_id=entry_id, title="Summary", content="clean"
            ),
        ]
        session.add_all(children)
        session.commit()
        chat_id = chat.id

    assert client.delete(f"/entries/{entry_id}").status_code == 204

    with Session(engine) as session:
        assert session.get(Entry, entry_id) is None
        assert session.get(Chat, chat_id) is None
        assert session.exec(select(Message)).all() == []
        assert session.exec(select(TranscriptLine)).all() == []
        assert session.exec(select(EnhancedVersion)).all() == []
