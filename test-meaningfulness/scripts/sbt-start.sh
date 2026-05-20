#!/usr/bin/env bash
set -euo pipefail
# Usage: sbt-start.sh <project-dir>
# Starts the sbt server with a FIFO keeper. Idempotent.
PROJECT_DIR="${1:?Usage: sbt-start.sh <project-dir>}"
cd "$PROJECT_DIR"

SBT_KEY=$(echo "$PWD" | cksum | cut -d' ' -f1)
FIFO="/tmp/sbt-fifo-${SBT_KEY}"
LOG="/tmp/sbt-log-${SBT_KEY}.log"
PID_FILE="/tmp/sbt-pid-${SBT_KEY}"

if [ -f "$PID_FILE" ] && kill -0 "$(head -1 "$PID_FILE")" 2>/dev/null; then
  echo "sbt server already running (log: $LOG)"
  exit 0
fi

rm -f "$FIFO"
mkfifo "$FIFO"
# Start keeper BEFORE opening write-end; sbt (the reader) unblocks the keeper's open.
( while true; do sleep 10; done ) > "$FIFO" &
echo $! > "$PID_FILE"
sbt < "$FIFO" > "$LOG" 2>&1 &
echo $! >> "$PID_FILE"

echo "Waiting for sbt server..."
until [ -f "project/target/active.json" ]; do sleep 2; done
echo "Ready. Log: $LOG"
