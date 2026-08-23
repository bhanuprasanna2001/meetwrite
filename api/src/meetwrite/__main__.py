"""PyInstaller entry point: `python -m meetwrite` runs the bundled sidecar.

`uvicorn meetwrite.main:app` stays for development; the shipped app starts
this instead, through the `make sidecar` PyInstaller build.
"""

from meetwrite.main import main

if __name__ == "__main__":
    main()
