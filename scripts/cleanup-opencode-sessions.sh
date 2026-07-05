#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# cleanup-opencode-sessions.sh
# ---------------------------------------------------------------------------
# Delete sessions from the local OpenCode backend that SpecForge spawned.
#
# Default behavior:
#   - Targets ONLY stage sessions (title contains the "⌁sf:" sentinel
#     written by app/utils/stageTitleEncoding.ts). These are the ones
#     hidden from the SpecForge sidebar and unreachable via normal UI.
#   - DRY RUN by default — prints what would be deleted and exits.
#     Pass --yes to actually delete.
#
# Flags:
#   --all             Delete EVERY session in the directory, not just stage
#                     sessions. Use with care.
#   --yes             Actually perform the DELETE requests (default is dry-run).
#   --dir <path>      Project directory (default: this repo's root).
#   --port <n>        OpenCode port (default: 13284, see electron/serverPool.ts).
#   --host <h>        OpenCode host (default: localhost).
#   -h, --help        Show this help.
#
# Requirements:
#   - curl
#   - python3 (for JSON parsing; jq works too but isn't assumed on Windows)
#
# Usage:
#   # Dry-run — list stage sessions that would be deleted
#   bash scripts/cleanup-opencode-sessions.sh
#
#   # Actually delete stage sessions
#   bash scripts/cleanup-opencode-sessions.sh --yes
#
#   # Nuke everything (including normal chat sessions)
#   bash scripts/cleanup-opencode-sessions.sh --all --yes
# ---------------------------------------------------------------------------

set -euo pipefail

# Defaults — resolve repo root from script location so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Pick whichever Python interpreter is available. Works on native Windows
# (python / py), WSL, and macOS (python3).
PYTHON=""
for candidate in python3 python py; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done
if [[ -z "$PYTHON" ]]; then
  echo "Error: no python interpreter found (tried python3, python, py)." >&2
  echo "Install Python or rewrite this script to use jq." >&2
  exit 1
fi

DIR="$REPO_ROOT"
PORT="13284"
HOST=""
ALL="false"
YES="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)    ALL="true"; shift ;;
    --yes)    YES="true"; shift ;;
    --dir)    DIR="$2"; shift 2 ;;
    --port)   PORT="$2"; shift 2 ;;
    --host)   HOST="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 2 ;;
  esac
done

# Default host: localhost on native Windows/MSYS, but inside WSL we need the
# Windows host IP (WSL2 doesn't bridge localhost to Windows services reliably).
# User-supplied --host always wins.
if [[ -z "$HOST" ]]; then
  if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    WIN_IP="$(grep -m1 nameserver /etc/resolv.conf 2>/dev/null | awk '{print $2}')"
    if [[ -n "$WIN_IP" ]]; then
      HOST="$WIN_IP"
    else
      HOST="localhost"
    fi
  else
    HOST="localhost"
  fi
fi

# URL-encode the directory (handles backslashes, colons, spaces).
# Convert POSIX-style paths back to Windows form (X:\...) — the OpenCode
# backend runs on Windows and matches directories against what it registered,
# which is always a Windows path. Handles both WSL (/mnt/x/...) and MSYS
# (/x/...) path conventions.
API_DIR="$DIR"
if [[ "$API_DIR" == /mnt/?/* ]]; then
  DRIVE="${API_DIR:5:1}"
  REST="${API_DIR:6}"
  API_DIR="${DRIVE^^}:${REST//\//\\}"
elif [[ "$API_DIR" == /[a-zA-Z]/* ]]; then
  DRIVE="${API_DIR:1:1}"
  REST="${API_DIR:2}"
  API_DIR="${DRIVE^^}:${REST//\//\\}"
fi

ENC_DIR="$(printf '%s' "$API_DIR" | "$PYTHON" -c "import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))")"
BASE="http://$HOST:$PORT"

echo "==> OpenCode backend: $BASE"
echo "==> Directory:        $API_DIR"
if [[ "$ALL" == "true" ]]; then
  echo "==> Mode:             ALL sessions"
else
  echo "==> Mode:             stage sessions only (title contains '⌁sf:')"
fi
if [[ "$YES" == "true" ]]; then
  echo "==> Action:           DELETE"
else
  echo "==> Action:           DRY RUN (pass --yes to actually delete)"
fi
echo

# Fetch all sessions. OpenCode returns { sessions: [...] }.
RESPONSE="$(curl -sS --fail-with-body "$BASE/session?directory=$ENC_DIR")" || {
  echo "Failed to fetch sessions. Is SpecForge running (so the OpenCode" >&2
  echo "backend on port $PORT is up)? Check connection in SpecForge settings." >&2
  exit 1
}

# Filter to ids+titles. If --all, keep everything; otherwise filter by sentinel.
if [[ "$ALL" == "true" ]]; then
  FILTER='True'
else
  FILTER='"⌁sf:" in (s.get("title") or "")'
fi

mapfile -t ROWS < <(printf '%s' "$RESPONSE" | "$PYTHON" -c "
import json, sys
data = json.load(sys.stdin)
sessions = data.get('sessions', data) if isinstance(data, dict) else data
rows = []
for s in sessions:
    if $FILTER:
        rows.append(s['id'] + '\t' + (s.get('title') or '(no title)'))
if rows:
    print('\n'.join(rows))
")

if [[ ${#ROWS[@]} -eq 0 ]]; then
  echo "No matching sessions."
  exit 0
fi

printf "%-12s  %s\n" "ID" "TITLE"
printf "%-12s  %s\n" "------------" "------------------------------------------------------------"
for row in "${ROWS[@]}"; do
  id="${row%%$'\t'*}"
  title="${row#*$'\t'}"
  # Truncate title for display; the actual stored title is unchanged.
  if [[ ${#title} -gt 60 ]]; then
    title="${title:0:57}..."
  fi
  printf "%-12s  %s\n" "${id:0:12}" "$title"
done
echo
echo "Total: ${#ROWS[@]} session(s)"

if [[ "$YES" != "true" ]]; then
  echo
  echo "Dry run only. Re-run with --yes to delete these."
  exit 0
fi

echo
echo "Deleting..."
for row in "${ROWS[@]}"; do
  id="${row%%$'\t'*}"
  if curl -sS -X DELETE "$BASE/session/$id?directory=$ENC_DIR" >/dev/null; then
    echo "  ✓ ${id:0:12}"
  else
    echo "  ✗ FAILED ${id:0:12}" >&2
  fi
done

echo
echo "Done."
