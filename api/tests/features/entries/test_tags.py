"""Tag invariants: normalization, dedupe, scoping, and cleanup."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from meetwrite.db.models import EntryTag, Tag
from tests.conftest import acting_as, create_entry


def test_summaries_carry_tags_and_replace_is_normalized(client: TestClient) -> None:
    entry = create_entry(client, note_md="two sum")
    response = client.put(
        f"/entries/{entry['id']}/tags",
        json={
            "tags": ["  dp  ", "DP", "two-pointers", "", "  "],
        },
    )
    assert response.status_code == 200
    # First casing wins; blanks drop; duplicates collapse.
    assert response.json()["tags"] == ["dp", "two-pointers"]
    # The note's content is untouched by tagging.
    assert client.get(f"/entries/{entry['id']}").json()["note_md"] == "two sum"

    summary = client.get("/entries").json()[0]
    assert summary["tags"] == ["dp", "two-pointers"]


def test_replacing_tags_removes_old_ones_and_prunes_orphans(client: TestClient) -> None:
    entry = create_entry(client)
    other = create_entry(client)
    client.put(f"/entries/{entry['id']}/tags", json={"tags": ["dp"]})
    client.put(f"/entries/{other['id']}/tags", json={"tags": ["graph"]})

    client.put(f"/entries/{entry['id']}/tags", json={"tags": ["heap"]})
    assert client.get(f"/entries/{entry['id']}/tags").json() == {"tags": ["heap"]}
    assert client.put(f"/entries/{entry['id']}/tags", json={"tags": []}).json() == {
        "tags": []
    }

    with Session(client.app.state.runtime.engine) as session:
        values = [tag.value for tag in session.exec(select(Tag)).all()]
        # dp is gone: its only note dropped it, and orphans are pruned.
        assert values == ["graph"]
        joins = session.exec(select(EntryTag)).all()
        assert len(joins) == 1
        assert joins[0].entry_id == other["id"]
        assert joins[0].tag_id == session.exec(select(Tag)).first().id


def test_many_tags_are_all_kept(client: TestClient) -> None:
    entry = create_entry(client)
    values = [f"tag-{index}" for index in range(40)]
    result = client.put(f"/entries/{entry['id']}/tags", json={"tags": values}).json()
    assert result["tags"] == values


def test_tags_are_scoped_to_the_current_user(client: TestClient) -> None:
    entry = create_entry(client)
    client.put(f"/entries/{entry['id']}/tags", json={"tags": ["private"]})

    with acting_as(client, 2):
        assert client.get("/entries").json() == []
        assert (
            client.put(f"/entries/{entry['id']}/tags", json={"tags": ["x"]}).status_code
            == 404
        )


def test_deleting_an_entry_cascades_its_tag_joins(client: TestClient) -> None:
    entry_id = create_entry(client)["id"]
    client.put(f"/entries/{entry_id}/tags", json={"tags": ["dp"]})

    assert client.delete(f"/entries/{entry_id}").status_code == 204
    with Session(client.app.state.runtime.engine) as session:
        assert session.exec(select(EntryTag)).all() == []
        assert (
            session.exec(select(Tag)).all() == []
        )  # Orphan pruned with its owner gone
