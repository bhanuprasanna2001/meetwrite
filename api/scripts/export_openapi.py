import json
from pathlib import Path

from meetwrite.app import create_app


def main() -> None:
    destination = Path(__file__).resolve().parents[1] / "openapi.json"
    snapshot = json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n"
    destination.write_text(snapshot, encoding="utf-8")


if __name__ == "__main__":
    main()
