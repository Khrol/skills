#!/usr/bin/env bash
set -euo pipefail
# Usage: init-work-dir.sh <work-dir>
# Reads <work-dir>/test-names.txt (one test name per line, blank lines skipped),
# creates test-001/ … test-NNN/ directories, and writes name.txt into each.
# Write test-names.txt with the Write tool before calling this script.
WORK_DIR="${1:?Usage: init-work-dir.sh <work-dir>}"
NAMES_FILE="$WORK_DIR/test-names.txt"
[ -f "$NAMES_FILE" ] || { echo "Not found: $NAMES_FILE — create it with the Write tool first" >&2; exit 1; }

mkdir -p "$WORK_DIR"
N=0
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  N=$((N + 1))
  DIR="$(printf '%s/test-%03d' "$WORK_DIR" "$N")"
  mkdir -p "$DIR"
  printf '%s\n' "$line" > "$DIR/name.txt"
done < "$NAMES_FILE"
echo "Initialised $N test directories in $WORK_DIR"
