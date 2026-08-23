"""Liveness endpoint."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """200 while the sidecar is up."""

    return {"status": "ok"}
