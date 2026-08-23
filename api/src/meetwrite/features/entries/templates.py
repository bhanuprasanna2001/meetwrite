"""The note templates that seed new notes.

Two templates exist, one rule each:

- a new note in a folder named "LeetCode" (any casing) starts from the
  problem template — frontmatter on top, review sections below;
- today's daily note starts from the day template.

Every other note starts blank. The templates are plain markdown constants —
nothing renders or transforms them.
"""

LEETCODE_TEMPLATE = """\
---
# Fill once per problem; the preview shows this as a metadata card.
number: ""          # e.g. 1
title: ""           # e.g. Two Sum
url: ""             # https://leetcode.com/problems/two-sum/
difficulty: easy    # easy | medium | hard
topics: ""          # array, hash-table, … (comma list)
patterns: ""        # hash-map, two-pointers, … the techniques this trains
language: python    # the language you solved it in
status: todo        # todo → attempted → solved → review
confidence: ""      # got-it | shaky | stuck — how well you can recall it now
solution: ""        # explanation you studied (editorial / video / blog URL)
submission: ""      # your accepted submission (leetcode.com/submissions/detail/…)
last_reviewed: ""   # YYYY-MM-DD
next_review: ""     # YYYY-MM-DD — +1 day, then +1 week, then +1 month
tags: ""            # comma list — mirrors the note's tags (⌘K)
---

# 1. Two Sum

## Approach

The core idea in two or three sentences — why it works, not what you typed.

## Key trick

The one thing to remember when this pattern shows up again.

## Complexity

- **Time:** O(?)
- **Space:** O(?)

## Code

```python
# your accepted solution
```

## Edge cases & mistakes

- What tripped you up this time.

## Related problems

- [](https://leetcode.com/problems/) — same pattern, easier or harder

## Review log

- YYYY-MM-DD — solved in ? min, hints used: ? → next review: +1 day
"""


DAILY_TEMPLATE = """\
---
created: {date}
status:
tags:
---

# {date}

> [!NOTE]
> Keep this page small. Check the Core habits, choose one Growth task, add
> only today's project tasks, and write a Shutdown entry for each miss.
>
> ### Naming
>
> - **Project:** outcome — `Expense tracker v1 works`
> - **Task:** verb + object — `Implement expense creation`
> - **Growth:** verb + topic + finish — `Study LLD – design parking lot – finish class diagram`
> - **Shutdown:** `MISS / CAUSE / CHANGE`
>
> ### Do
>
> - **Core:** check the five boxes; no notes needed.
> - **Projects:** write an outcome, then only the subtasks for today.
> - **Growth:** choose one work, LLD, HLD, or system design task.
> - **Shutdown:** three short lines per miss.
>   - **Example:** `MISS: Run not done` / `CAUSE: Meeting ran late` / `CHANGE: Run at 17:30 before dinner`
> - **Avoid:** `MISS: I was lazy` — it gives you nothing to change.
>
> ### Avoid
>
> - `Work on the project`
> - `Study system design`
> - Turning a routine into subtasks

## Core

- Brush teeth
- Shower
- Run — 30 min
- Mindfulness — 30 min
- Read — 30 min

## Growth

- **Growth:**

## Projects

- **Project:** outcome

- Task

## Shutdown

- **Miss:**

- **Cause:**
- **Change:**
"""


def leetcode_template() -> str:
    """The problem template every new note in the LeetCode folder starts from."""
    return LEETCODE_TEMPLATE


def daily_note_template(date: str) -> str:
    """The day template, stamped with the client's local date."""
    return DAILY_TEMPLATE.format(date=date)


def is_leetcode_folder(name: str) -> bool:
    """The one folder name that seeds the problem template (any casing)."""
    return name.strip().lower() == "leetcode"
