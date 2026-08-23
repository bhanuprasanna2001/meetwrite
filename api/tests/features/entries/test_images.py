"""Note images: upload, serve, rename, delete — and their projections."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from meetwrite.db.models import EntryImage
from tests.conftest import create_entry

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"x" * 64


def upload_image(
    client: TestClient, entry_id: int, *, title: str | None = None
) -> dict:
    response = client.post(
        f"/entries/{entry_id}/images",
        files={"file": ("photo.png", PNG_BYTES, "image/png")},
        data={"title": title} if title is not None else {},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_image_roundtrip_serves_the_same_bytes(client: TestClient) -> None:
    entry_id = create_entry(client)["id"]
    image = upload_image(client, entry_id, title="Whiteboard")

    assert image["title"] == "Whiteboard"
    assert image["mime_type"] == "image/png"

    served = client.get(f"/entries/{entry_id}/images/{image['id']}")
    assert served.status_code == 200
    assert served.content == PNG_BYTES
    assert served.headers["content-type"] == "image/png"


def test_image_appears_in_entry_summary_and_outline(client: TestClient) -> None:
    entry_id = create_entry(client)["id"]
    image = upload_image(client, entry_id)

    summary = client.get("/entries").json()[0]
    assert summary["images"] == [{"id": image["id"], "title": None}]
    assert client.get(f"/entries/{entry_id}").json()["images"] == summary["images"]
    outline = client.get(f"/entries/{entry_id}/outline").json()
    assert outline["images"] == [{"id": image["id"], "title": None}]


def test_image_title_renames_and_clears(client: TestClient) -> None:
    entry_id = create_entry(client)["id"]
    image = upload_image(client, entry_id)

    renamed = client.patch(
        f"/entries/{entry_id}/images/{image['id']}",
        json={"title": "  sprint \n board "},
    )
    assert renamed.json()["title"] == "sprint board"

    cleared = client.patch(
        f"/entries/{entry_id}/images/{image['id']}", json={"title": "   "}
    )
    assert cleared.json()["title"] is None


def test_image_delete_and_missing_lookups(client: TestClient) -> None:
    entry_id = create_entry(client)["id"]
    image = upload_image(client, entry_id)

    assert client.delete(f"/entries/{entry_id}/images/{image['id']}").status_code == 204
    assert client.get(f"/entries/{entry_id}/images/{image['id']}").status_code == 404
    assert (
        client.patch(
            f"/entries/{entry_id}/images/{image['id']}", json={"title": "nope"}
        ).status_code
        == 404
    )
    assert client.get("/entries").json()[0]["images"] == []


def test_non_image_and_other_entries_images_are_rejected(
    client: TestClient,
) -> None:
    entry_id = create_entry(client)["id"]
    other_id = create_entry(client)["id"]

    response = client.post(
        f"/entries/{entry_id}/images",
        files={"file": ("notes.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 415

    image = upload_image(client, entry_id)
    # An image belongs to exactly one note.
    assert client.get(f"/entries/{other_id}/images/{image['id']}").status_code == 404


def test_deleting_the_entry_cascades_to_its_images(client: TestClient) -> None:
    entry_id = create_entry(client)["id"]
    upload_image(client, entry_id)

    assert client.delete(f"/entries/{entry_id}").status_code == 204

    with Session(client.app.state.runtime.engine) as session:
        assert session.exec(select(EntryImage)).all() == []
