"""Recording hint snapshots: dictionary terms then title, deduped and capped."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from meetwrite.db.models import DictionaryTerm, Entry
from meetwrite.features.transcription.services import (
    MAX_HINTS_PER_RECORDING,
    keyword_hints,
)
from tests.conftest import create_entry


def load_entry(client: TestClient, entry_id: int) -> Entry:
    with Session(client.app.state.runtime.engine) as session:
        entry = session.get(Entry, entry_id)
        assert entry is not None
        session.expunge(entry)
        return entry


def test_hints_follow_dictionary_order_then_title_and_dedupe(
    client: TestClient,
) -> None:
    entry_id = create_entry(client, title="  Q3   planning  ")["id"]
    client.post("/dictionary", json={"values": ["Aarav Nair", "q3 planning", "SLA"]})
    entry = load_entry(client, entry_id)

    with Session(client.app.state.runtime.engine) as session:
        # The title duplicates an earlier dictionary term, so it doesn't
        # appear again after the saved words.
        assert keyword_hints(session, 1, entry) == [
            "Aarav Nair",
            "q3 planning",
            "SLA",
        ]


def test_hints_are_capped_before_the_title_is_reached(client: TestClient) -> None:
    entry_id = create_entry(client, title="Meeting title")["id"]
    client.post(
        "/dictionary",
        json={"values": [f"Term {index}" for index in range(60)]},
    )
    entry = load_entry(client, entry_id)

    with Session(client.app.state.runtime.engine) as session:
        hints = keyword_hints(session, 1, entry)

    assert len(hints) == MAX_HINTS_PER_RECORDING
    assert hints == [f"Term {index}" for index in range(MAX_HINTS_PER_RECORDING)]


def test_hints_skip_terms_the_api_would_never_store(client: TestClient) -> None:
    # The router refuses "<" and ">", but hint building filters them too so a
    # directly inserted bad row can't take down the whole session update.
    entry_id = create_entry(client, title="Weekly sync")["id"]
    client.post("/dictionary", json={"values": ["Good"]})
    with Session(client.app.state.runtime.engine) as session:
        session.add(
            DictionaryTerm(user_id=1, value="bad<tag", normalized_value="bad<tag")
        )
        session.commit()
    entry = load_entry(client, entry_id)

    with Session(client.app.state.runtime.engine) as session:
        assert keyword_hints(session, 1, entry) == ["Good", "Weekly sync"]
