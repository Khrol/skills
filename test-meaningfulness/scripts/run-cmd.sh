#!/usr/bin/env bash
# Usage: run-cmd.sh <log-file> <shell-command>
# Runs the shell command, captures stdout+stderr to log-file.
# Prints the last 30 lines of the log followed by exit_code=N to stdout,
# so the caller can read results without a separate cat/tail call.
LOG="${1:?Usage: run-cmd.sh <log-file> <shell-command>}"
CMD="${2:?}"
eval "$CMD" > "$LOG" 2>&1
CODE=$?
echo "--- log tail ---"
tail -30 "$LOG"
echo "--- end ---"
echo "exit_code=$CODE"
exit $CODE
