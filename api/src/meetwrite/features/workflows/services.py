"""The LeetCode starter: one folder, one getting-started note, idempotent."""

import logging

from sqlmodel import Session, func, select

from meetwrite.db.models import Entry, Folder
from meetwrite.features.folders.services import create_folder

logger = logging.getLogger(__name__)

LEETCODE_FOLDER_NAME = "LeetCode"
STARTER_TITLE = "Getting Started"
STARTER_NOTE_MD = """\
# LeetCode

Every new note in this folder starts from the problem template — frontmatter
on top, review sections below. This page explains the system.

## The loop

1. **Solve** the problem in the browser, take notes here as you go.
2. Fill the frontmatter: number, title, url, difficulty, topics, patterns,
   language, status.
3. Set `confidence` honestly:
   - `got-it` — you could re-solve it from memory right now.
   - `shaky` — you would stumble; review soon.
   - `stuck` — you needed help; review often.
4. Set `next_review`: +1 day after solving, then +1 week, then +1 month.
   Fail the recall on a review and the next one is +1 day again.

## Tags

Tags live in the note's Tag editor (⌘K → Edit tags) and mirror the
frontmatter, so folder filters can find everything:

- `difficulty-easy` / `difficulty-medium` / `difficulty-hard`
- `pattern-…`: two-pointers, sliding-window, binary-search, hash-map, stack,
  queue, heap, tree, graph, union-find, backtracking, greedy, dp, intervals,
  linked-list, bit-manipulation, math, trie, monotonic-stack, prefix-sum,
  divide-and-conquer
- `status-todo` → `status-attempted` → `status-solved` → `status-review`
- `confidence-got-it` / `confidence-shaky` / `confidence-stuck`

## Review

Folder view → filter `status-review` or a `confidence-…` tag to get the
day's queue. Keep every note reviewable in under a minute: the key trick
and the mistakes are worth more than the code.
"""


def setup_leetcode(session: Session, user_id: int) -> tuple[Folder, bool, bool]:
    """Make the LeetCode folder and its starter note. Running twice is a
    no-op for both: the folder already exists, so nothing is added — one
    defined outcome per state, never duplicates."""
    folder = session.exec(
        select(Folder).where(
            Folder.user_id == user_id,
            func.lower(Folder.name) == LEETCODE_FOLDER_NAME.lower(),
        )
    ).first()
    folder_created = folder is None
    if folder is None:
        folder = create_folder(session, user_id, LEETCODE_FOLDER_NAME)
    assert folder.id is not None

    starter_created = False
    if folder_created:
        starter = Entry(
            user_id=user_id,
            folder_id=folder.id,
            title=STARTER_TITLE,
            note_md=STARTER_NOTE_MD,
        )
        session.add(starter)
        session.commit()
        session.refresh(starter)
        starter_created = True
        logger.info(
            "workflow.leetcode_starter_created user_id=%s folder_id=%s entry_id=%s",
            user_id,
            folder.id,
            starter.id,
        )
    return folder, folder_created, starter_created
