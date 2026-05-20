#!/usr/bin/env bash
set -euo pipefail
# Usage: init-work-dir.sh <work-dir> <count>
# Creates work-dir/test-001 … test-NNN directories.
WORK_DIR="${1:?Usage: init-work-dir.sh <work-dir> <count>}"
COUNT="${2:?}"
mkdir -p "$WORK_DIR"
for i in $(seq 1 "$COUNT"); do
  mkdir -p "$(printf '%s/test-%03d' "$WORK_DIR" "$i")"
done
echo "Created $COUNT test directories in $WORK_DIR"
