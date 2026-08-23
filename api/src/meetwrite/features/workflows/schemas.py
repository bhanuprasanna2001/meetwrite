"""Request and response models for /workflows."""

from pydantic import BaseModel


class LeetCodeSetupRead(BaseModel):
    """What the LeetCode starter run did — the flags let a second run
    report \"nothing to do\" instead of duplicating anything."""

    folder_id: int
    folder_created: bool
    starter_created: bool
