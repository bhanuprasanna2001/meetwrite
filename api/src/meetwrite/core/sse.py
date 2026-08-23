"""Server-sent-events helpers, shared by chat and transcription."""

import json
from typing import Any


def sse_event(data: dict[str, Any]) -> str:
    """Serialize one event as an SSE `data:` frame."""

    return f"data: {json.dumps(data)}\n\n"
