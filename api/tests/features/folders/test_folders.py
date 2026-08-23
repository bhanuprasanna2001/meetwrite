"""Folder invariants: Inbox defaulting, protection, name rules, and moves."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from meetwrite.db.models import Chat, TranscriptLine
from tests.conftest import acting_as, create_entry


def test_inbox_exists_and_receives_default_entries(client: TestClient) -> None:
    entry = client.post("/entries").json()

    folders = client.get("/folders").json()
    assert [folder["name"] for folder in folders] == ["Inbox"]
    assert folders[0]["is_inbox"] is True
    assert entry["folder_id"] == folders[0]["id"]
    assert client.get("/entries").json()[0]["folder_id"] == folders[0]["id"]


def test_create_folder_normalizes_and_rejects_duplicates(client: TestClient) -> None:
    folder = client.post("/folders", json={"name": "  LeetCode  "}).json()
    assert folder["name"] == "LeetCode"
    assert folder["is_inbox"] is False
    # Names are unique per user, ignoring case and whitespace.
    assert client.post("/folders", json={"name": "leetcode"}).status_code == 409
    assert client.post("/folders", json={"name": "   "}).status_code == 422


def test_folders_sort_inbox_first_then_by_name(client: TestClient) -> None:
    client.post("/folders", json={"name": "LeetCode"})
    client.post("/folders", json={"name": "journal"})

    names = [folder["name"] for folder in client.get("/folders").json()]
    assert names == ["Inbox", "journal", "LeetCode"]


def test_creating_an_entry_in_a_folder(client: TestClient) -> None:
    folder = client.post("/folders", json={"name": "LeetCode"}).json()
    entry = client.post("/entries", json={"folder_id": folder["id"]}).json()
    assert entry["folder_id"] == folder["id"]
    assert (
        client.get(f"/entries?folder_id={folder['id']}").json()[0]["id"] == entry["id"]
    )

    assert client.post("/entries", json={"folder_id": 999}).status_code == 404


def test_move_entry_between_folders(client: TestClient) -> None:
    entry = create_entry(client, note_md="two sum")
    folder = client.post("/folders", json={"name": "LeetCode"}).json()

    moved = client.patch(
        f"/entries/{entry['id']}", json={"folder_id": folder["id"]}
    ).json()
    assert moved["folder_id"] == folder["id"]
    assert moved["note_md"] == "two sum"  # A move never touches content.

    assert (
        client.get(f"/entries?folder_id={folder['id']}").json()[0]["id"] == entry["id"]
    )
    assert client.get("/entries?folder_id=999999").json() == []
    assert (
        client.patch(f"/entries/{entry['id']}", json={"folder_id": 999}).status_code
        == 404
    )


def test_inbox_is_protected(client: TestClient) -> None:
    inbox_id = client.get("/folders").json()[0]["id"]
    assert client.patch(f"/folders/{inbox_id}", json={"name": "X"}).status_code == 409
    assert client.delete(f"/folders/{inbox_id}").status_code == 409


def test_renaming_rejects_a_taken_name(client: TestClient) -> None:
    client.post("/folders", json={"name": "LeetCode"})
    other = client.post("/folders", json={"name": "Journal"}).json()
    assert (
        client.patch(f"/folders/{other['id']}", json={"name": "leetcode"}).status_code
        == 409
    )

    renamed = client.patch(f"/folders/{other['id']}", json={"name": "Daily"}).json()
    assert renamed["name"] == "Daily"


def test_deleting_a_folder_moves_its_entries_to_inbox(client: TestClient) -> None:
    inbox_id = client.get("/folders").json()[0]["id"]
    folder = client.post("/folders", json={"name": "LeetCode"}).json()
    entry = create_entry(client)
    client.patch(f"/entries/{entry['id']}", json={"folder_id": folder["id"]})

    assert client.delete(f"/folders/{folder['id']}").status_code == 204
    assert client.get(f"/entries/{entry['id']}").json()["folder_id"] == inbox_id


def test_folders_are_scoped_to_the_current_user(client: TestClient) -> None:
    folder = client.post("/folders", json={"name": "LeetCode"}).json()

    with acting_as(client, 2):
        # The other user gets their own Inbox, and only it.
        assert [f["name"] for f in client.get("/folders").json()] == ["Inbox"]
        assert (
            client.patch(f"/folders/{folder['id']}", json={"name": "X"}).status_code
            == 404
        )
        assert client.delete(f"/folders/{folder['id']}").status_code == 404
        assert (
            client.post("/entries", json={"folder_id": folder["id"]}).status_code == 404
        )


def test_outline_reports_transcript_and_chats(client: TestClient) -> None:
    entry_id = create_entry(client)["id"]
    assert client.get(f"/entries/{entry_id}/outline").json() == {
        "has_transcript": False,
        "chats": [],
        "images": [],
    }

    with Session(client.app.state.runtime.engine) as session:
        session.add(
            TranscriptLine(
                user_id=1, entry_id=entry_id, sequence=1, source="me", text="hi"
            )
        )
        chat = Chat(user_id=1, entry_id=entry_id, title="Q&A")
        session.add(chat)
        session.commit()
        assert chat.id is not None
        chat_id = chat.id

    outline = client.get(f"/entries/{entry_id}/outline").json()
    assert outline == {
        "has_transcript": True,
        "chats": [{"id": chat_id, "title": "Q&A"}],
        "images": [],
    }
