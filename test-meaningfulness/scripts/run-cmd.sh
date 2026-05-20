#!/usr/bin/env bash
# Usage: run-cmd.sh <log-file> <shell-command>
# Runs the shell command, captures stdout+stderr to log-file.
# Prints the exit code on the last line of stdout so the caller can check it.
LOG="${1:?Usage: run-cmd.sh <log-file> <shell-command>}"
CMD="${2:?}"
eval "$CMD" > "$LOG" 2>&1
CODE=$?
echo "exit_code=$CODE"
exit $CODE
