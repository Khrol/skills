#!/usr/bin/env bash
set -euo pipefail
# Usage: make-patch.sh <output-patch-file>
# Captures current unstaged changes as a unified diff.
# Must be run from the project root (git working tree).
OUTPUT="${1:?Usage: make-patch.sh <output-patch-file>}"
git diff > "$OUTPUT"
if [ ! -s "$OUTPUT" ]; then
  echo "No unstaged changes found — edit the source file first" >&2
  exit 1
fi
echo "Patch saved: $OUTPUT"
