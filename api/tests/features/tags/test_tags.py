"""Deleting a tag leaves every note and removes the tag row itself."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from meetwrite.db.models import EntryTag, Tag
from tests.conftest import acting_as, create_entry


def test_deleting_a_tag_removes_it_from_every_note(client: TestClient) -> None:
    first = create_entry(client)
    second = create_entry(client)
    client.put(f"/entries/{first['id']}/tags", json={"tags": ["dp", "graph"]})
    client.put(f"/entries/{second['id']}/tags", json={"tags": ["dp", "two pointers"]})

    assert client.delete("/tags/dp").status_code == 204
    # Spaced names match on their normalized value, same as on save.
    assert client.delete("/tags/two%20pointers").status_code == 204

    assert client.get(f"/entries/{first['id']}/tags").json() == {"tags": ["graph"]}
    assert client.get(f"/entries/{second['id']}/tags").json() == {"tags": []}
    with Session(client.app.state.runtime.engine) as session:
        values = [tag.value for tag in session.exec(select(Tag)).all()]
        assert values == ["graph"]
        joins = session.exec(select(EntryTag)).all()
        assert len(joins) == 1


def test_deleting_a_missing_tag_is_a_no_op(client: TestClient) -> None:
    assert client.delete("/tags/nope").status_code == 204
    assert client.delete("/tags/nope").status_code == 204


def test_renaming_a_tag_updates_every_note(client: TestClient) -> None:
    first = create_entry(client)
    second = create_entry(client)
    client.put(f"/entries/{first['id']}/tags", json={"tags": ["dp"]})
    client.put(f"/entries/{second['id']}/tags", json={"tags": ["dp", "graph"]})

    response = client.patch("/tags/dp", json={"value": "dynamic programming"})

    assert response.status_code == 204
    assert client.get(f"/entries/{first['id']}/tags").json() == {
        "tags": ["dynamic programming"]
    }
    assert client.get(f"/entries/{second['id']}/tags").json() == {
        "tags": ["dynamic programming", "graph"]
    }


def test_renaming_onto_an_existing_tag_merges_them(client: TestClient) -> None:
    entry = create_entry(client)
    client.put(f"/entries/{entry['id']}/tags", json={"tags": ["leet", "leetcode"]})

    assert client.patch("/tags/leet", json={"value": "leetcode"}).status_code == 204

    # One tag, one join — no duplicates survive the merge.
    assert client.get(f"/entries/{entry['id']}/tags").json() == {"tags": ["leetcode"]}
    with Session(client.app.state.runtime.engine) as session:
        assert [tag.value for tag in session.exec(select(Tag)).all()] == ["leetcode"]
        assert len(session.exec(select(EntryTag)).all()) == 1


def test_rename_requires_a_name_and_the_tag_to_exist(client: TestClient) -> None:
    entry = create_entry(client)
    client.put(f"/entries/{entry['id']}/tags", json={"tags": ["dp"]})

    assert client.patch("/tags/dp", json={"value": "  "}).status_code == 400
    assert client.patch("/tags/nope", json={"value": "x"}).status_code == 404
    assert client.get(f"/entries/{entry['id']}/tags").json() == {"tags": ["dp"]}


def test_deleting_a_tag_is_scoped_to_the_current_user(client: TestClient) -> None:
    entry = create_entry(client)
    client.put(f"/entries/{entry['id']}/tags", json={"tags": ["private"]})

    with acting_as(client, 2):
        # Another user's delete resolves the same way and touches nothing.
        assert client.delete("/tags/private").status_code == 204

    assert client.get(f"/entries/{entry['id']}/tags").json() == {"tags": ["private"]}
