# meetwrite development and packaging commands

.DEFAULT_GOAL := help

API_DIR := api
DESKTOP_DIR := desktop
TAURI_DIR := $(DESKTOP_DIR)/src-tauri
TAURI_MANIFEST := $(TAURI_DIR)/Cargo.toml

HOST_TRIPLE = $(shell rustc --print host-tuple)
TARGET_TRIPLE ?= $(HOST_TRIPLE)
SIDECAR_BIN_DIR := $(TAURI_DIR)/binaries
SIDECAR_BIN = $(SIDECAR_BIN_DIR)/meetwrite-sidecar-$(TARGET_TRIPLE)
SIDECAR_RESOURCES := $(TAURI_DIR)/sidecar-runtime
SIDECAR_STAGE := $(TAURI_DIR)/.sidecar-runtime.stage
SIDECAR_BACKUP := $(TAURI_DIR)/.sidecar-runtime.previous
SIDECAR_LOCK := $(TAURI_DIR)/.sidecar-build.lock

WEBSITE_DIR := website
WEBSITE_DOWNLOADS := $(WEBSITE_DIR)/public/downloads
DMG := $(WEBSITE_DOWNLOADS)/meetwrite.dmg
DMG_DIR := $(TAURI_DIR)/target/release/bundle/dmg

# Apple code signing (optional; Tauri reads these from the environment).
# APPLE_SIGNING_IDENTITY signs with a Developer ID cert already in the
# keychain; Tauri notarizes when APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID
# are all set (APPLE_PASSWORD is an app-specific password).
#   make app APPLE_SIGNING_IDENTITY="Developer ID Application: You" \
#            APPLE_ID=you@example.com APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx \
#            APPLE_TEAM_ID=XXXXXXXXXX
APPLE_ID ?=
APPLE_PASSWORD ?=
APPLE_TEAM_ID ?=
APPLE_SIGNING_IDENTITY ?=
ifdef APPLE_ID
export APPLE_ID
endif
ifdef APPLE_PASSWORD
export APPLE_PASSWORD
endif
ifdef APPLE_TEAM_ID
export APPLE_TEAM_ID
endif
ifdef APPLE_SIGNING_IDENTITY
export APPLE_SIGNING_IDENTITY
endif

# Keep the packaging-only PyInstaller tool out of the API runtime dependencies
# while pinning the injected top-level tool version.
PYINSTALLER_VERSION := 6.22.2

.PHONY: help setup dev-api dev check check-api check-desktop check-rust check-website \
	icons sidecar _sidecar app site release clean-sidecar clean-api clean-desktop \
	clean-website clean-rust clean

help:
	@printf '%s\n' \
		'make setup          Install locked API, desktop, and Rust dependencies' \
		'make dev-api        Run the API sidecar in development' \
		'make dev            Run the Tauri app in development' \
		'make check          Run API, desktop, website, and Rust quality gates' \
		'make check-api      Run API format, lint, types, tests, and migrations' \
		'make check-desktop  Run desktop lint, tests, types, and build' \
		'make check-rust     Run Rust formatting, lint, and tests' \
		'make check-website  Run website lint and build' \
		'make icons          Regenerate every platform icon from the dark logo' \
		'make sidecar        Build the bundled Python sidecar' \
		'make app            Build the sidecar and packaged Tauri app' \
		'make site           Copy the built DMG and compile the landing page' \
		'make release        Publish the built DMG to GitHub Releases' \
		'make clean-sidecar  Remove generated sidecar artifacts' \
		'make clean          Remove generated build artifacts'

setup:
	uv sync --directory $(API_DIR) --locked
	npm --prefix $(DESKTOP_DIR) ci
	npm --prefix $(WEBSITE_DIR) ci
	cargo fetch --manifest-path $(TAURI_MANIFEST) --locked

dev-api:
	uv run --directory $(API_DIR) --locked uvicorn meetwrite.main:app --reload --port 8321

dev:
	npm --prefix $(DESKTOP_DIR) run tauri -- dev -- --locked

check: check-api check-desktop check-rust check-website

check-api:
	uv run --directory $(API_DIR) --locked ruff format --check src tests migrations scripts
	uv run --directory $(API_DIR) --locked ruff check src tests migrations scripts
	uv run --directory $(API_DIR) --locked mypy src
	uv run --directory $(API_DIR) --locked pytest -q
	@set -eu; \
		migration_dir="$$(mktemp -d /tmp/meetwrite-check.XXXXXX)"; \
		case "$$migration_dir" in /tmp/meetwrite-check.*) ;; *) exit 1 ;; esac; \
		trap 'rm -rf -- "$$migration_dir"' 0 1 2 15; \
		export MEETWRITE_DATABASE_URL="sqlite:///$$migration_dir/meetwrite.db"; \
		uv run --directory $(API_DIR) --locked alembic upgrade head; \
		uv run --directory $(API_DIR) --locked alembic check

check-desktop:
	npm --prefix $(DESKTOP_DIR) run check

check-rust:
	cargo fmt --manifest-path $(TAURI_MANIFEST) -- --check
	cargo clippy --manifest-path $(TAURI_MANIFEST) --all-targets --locked -- -D warnings
	cargo test --manifest-path $(TAURI_MANIFEST) --locked

check-website:
	npm --prefix $(WEBSITE_DIR) run lint
	npm --prefix $(WEBSITE_DIR) run build

# Tauri externalBin accepts one executable, while PyInstaller's onedir mode
# starts much faster than a self-extracting onefile binary. The small launcher
# resolves the embedded runtime beside the packaged executable. The staged
# copy dereferences framework symlinks because Tauri's resource walker cannot.
sidecar:
	@set -eu; \
		if ! mkdir "$(SIDECAR_LOCK)"; then \
			printf '%s\n' 'Another sidecar build is active (or run make clean-sidecar to remove a stale lock)' >&2; \
			exit 1; \
		fi; \
		cleanup() { \
			status=$$?; \
			trap - 0 1 2 15; \
			rmdir "$(SIDECAR_LOCK)" 2>/dev/null || true; \
			exit "$$status"; \
		}; \
		trap cleanup 0 1 2 15; \
		$(MAKE) --no-print-directory _sidecar TARGET_TRIPLE="$(TARGET_TRIPLE)"

_sidecar:
	@test -n "$(TARGET_TRIPLE)" || { printf '%s\n' 'Unable to determine TARGET_TRIPLE' >&2; exit 1; }
	@test "$(TARGET_TRIPLE)" = "$(HOST_TRIPLE)" || { \
		printf '%s\n' 'Cross-compiling the PyInstaller sidecar is unsupported; TARGET_TRIPLE must match the Rust host triple' >&2; \
		exit 1; \
	}
	uv run --directory $(API_DIR) --locked --isolated --no-default-groups \
		--with pyinstaller==$(PYINSTALLER_VERSION) -- \
		pyinstaller \
			--noconfirm --clean --onedir --name meetwrite-sidecar \
			--paths src \
			--collect-submodules uvicorn \
			--add-data "alembic.ini:." \
			--add-data "migrations:migrations" \
			--hidden-import keyring.backends.macOS \
			--exclude-module uvloop \
			--exclude-module watchfiles \
			--exclude-module httptools \
			src/meetwrite/__main__.py
	@set -eu; \
		if test ! -e "$(SIDECAR_RESOURCES)" && test -e "$(SIDECAR_BACKUP)"; then \
			mv "$(SIDECAR_BACKUP)" "$(SIDECAR_RESOURCES)"; \
		fi; \
		rm -rf "$(SIDECAR_STAGE)" "$(SIDECAR_BACKUP)"; \
		mkdir -p "$(SIDECAR_STAGE)" "$(SIDECAR_BIN_DIR)"; \
		cp -RL "$(API_DIR)/dist/meetwrite-sidecar/." "$(SIDECAR_STAGE)/"; \
		test -x "$(SIDECAR_STAGE)/meetwrite-sidecar"; \
		test -d "$(SIDECAR_STAGE)/_internal"; \
		test -f "$(SIDECAR_STAGE)/_internal/alembic.ini"; \
		test -d "$(SIDECAR_STAGE)/_internal/migrations"; \
		had_previous=0; \
		rollback() { \
			status=$$?; \
			trap - 0 1 2 15; \
			if test "$$had_previous" -eq 1 \
				&& test ! -e "$(SIDECAR_RESOURCES)" \
				&& test -e "$(SIDECAR_BACKUP)"; then \
				mv "$(SIDECAR_BACKUP)" "$(SIDECAR_RESOURCES)"; \
			fi; \
			exit "$$status"; \
		}; \
		trap rollback 0 1 2 15; \
		if test -e "$(SIDECAR_RESOURCES)"; then \
			had_previous=1; \
			mv "$(SIDECAR_RESOURCES)" "$(SIDECAR_BACKUP)"; \
		fi; \
		mv "$(SIDECAR_STAGE)" "$(SIDECAR_RESOURCES)"; \
		trap - 0 1 2 15; \
		rm -rf "$(SIDECAR_BACKUP)"
	@printf '#!/bin/sh\nexec "$$(dirname "$$0")/../Resources/sidecar-runtime/meetwrite-sidecar" "$$@"\n' > "$(SIDECAR_BIN).tmp"
	@chmod +x "$(SIDECAR_BIN).tmp"
	@mv "$(SIDECAR_BIN).tmp" "$(SIDECAR_BIN)"

app: sidecar
	npm --prefix $(DESKTOP_DIR) run tauri -- build -- --locked

# Tauri's icon command turns one squared PNG into every platform icon
# (icns, ico, pngs, Store logos, and the Android/iOS project assets).
icons:
	npm --prefix $(DESKTOP_DIR) run tauri -- icon src-tauri/meetwrite-dark.png

# The landing page ships the newest DMG as a plain static download.
# When a GitHub remote exists, the download button links to the GitHub
# Releases asset instead (stable URL, no binary in the site or in git).
site: $(DMG)
	@repo="$$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"; \
	if test -n "$$repo"; then \
		export VITE_DOWNLOAD_URL="https://github.com/$$repo/releases/latest/download/meetwrite-macos.dmg"; \
	fi; \
	npm --prefix $(WEBSITE_DIR) run build

# Publish the built DMG as the latest GitHub release. The asset keeps a
# fixed name so releases/latest/download/meetwrite-macos.dmg never moves.
release:
	@set -eu; \
		src="$$(ls -t $(DMG_DIR)/meetwrite_*.dmg 2>/dev/null | head -n 1)"; \
		test -n "$$src" || { printf '%s\n' 'No DMG built yet - run `make app` first.' >&2; exit 1; }; \
		version="$$(node -p "require('./$(TAURI_DIR)/tauri.conf.json').version")"; \
		asset="$(DMG_DIR)/meetwrite-macos.dmg"; \
		cp "$$src" "$$asset"; \
		gh release create "v$$version" "$$asset" --generate-notes

$(DMG):
	@set -eu; \
		src="$$(ls -t $(DMG_DIR)/meetwrite_*.dmg 2>/dev/null | head -n 1)"; \
		test -n "$$src" || { printf '%s\n' 'No DMG built yet - run `make app` first.' >&2; exit 1; }; \
		mkdir -p "$(WEBSITE_DOWNLOADS)"; \
		cp "$$src" "$@"; \
		printf 'Copied %s -> %s\n' "$$src" "$@"

clean-website:
	rm -rf $(WEBSITE_DIR)/dist $(WEBSITE_DOWNLOADS)

clean-sidecar:
	rm -rf "$(SIDECAR_RESOURCES)" "$(SIDECAR_STAGE)" "$(SIDECAR_BACKUP)" "$(SIDECAR_LOCK)"
	rm -f $(SIDECAR_BIN_DIR)/meetwrite-sidecar-* $(SIDECAR_BIN_DIR)/.meetwrite-sidecar-*.tmp

clean-api:
	rm -rf $(API_DIR)/dist $(API_DIR)/build $(API_DIR)/meetwrite-sidecar.spec

clean-desktop:
	rm -rf $(DESKTOP_DIR)/dist

clean-rust:
	cargo clean --manifest-path $(TAURI_MANIFEST)

clean: clean-sidecar clean-api clean-desktop clean-website clean-rust
