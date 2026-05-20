#!/usr/bin/env bash
# Usage: sbt-stop.sh <project-dir>
PROJECT_DIR="${1:?Usage: sbt-stop.sh <project-dir>}"
cd "$PROJECT_DIR"

SBT_KEY=$(echo "$PWD" | cksum | cut -d' ' -f1)
PID_FILE="/tmp/sbt-pid-${SBT_KEY}"
FIFO="/tmp/sbt-fifo-${SBT_KEY}"

sbt -client shutdown 2>/dev/null || true
if [ -f "$PID_FILE" ]; then
  while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$PID_FILE"
fi
rm -f "$PID_FILE" "$FIFO"
echo "Stopped."
