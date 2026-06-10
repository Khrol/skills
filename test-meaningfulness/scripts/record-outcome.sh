#!/usr/bin/env bash
# Usage: record-outcome.sh <work-dir> <test-num> <OK|BASELINE|COUPLED|SUSPECT> <desc> [sibling-num ...]
#
# Deterministically writes the per-test outcome files:
#   outcome.txt        always
#   mutation-desc.txt  always (the <desc> argument, verbatim)
#   siblings.txt       BASELINE/COUPLED (space-separated sibling numbers)
#   role.txt           BASELINE: "root" here, "sibling of test-<num>" in each
#                      sibling's directory (created if missing)
set -euo pipefail
WORK_DIR="${1:?Usage: record-outcome.sh <work-dir> <test-num> <outcome> <desc> [sibling-num ...]}"
NUM="${2:?}"
OUTCOME="${3:?}"
DESC="${4:?}"
shift 4
SIBLINGS="$*"
DIR="$WORK_DIR/test-$NUM"
mkdir -p "$DIR"

case "$OUTCOME" in
  OK|BASELINE|COUPLED|SUSPECT) ;;
  *) echo "Invalid outcome: $OUTCOME (want OK|BASELINE|COUPLED|SUSPECT)" >&2; exit 1 ;;
esac
if [ "$OUTCOME" = "BASELINE" ] || [ "$OUTCOME" = "COUPLED" ]; then
  [ -n "$SIBLINGS" ] || { echo "$OUTCOME requires at least one sibling number" >&2; exit 1; }
fi

printf '%s\n' "$OUTCOME" > "$DIR/outcome.txt"
printf '%s\n' "$DESC"    > "$DIR/mutation-desc.txt"

if [ -n "$SIBLINGS" ]; then
  printf '%s\n' "$SIBLINGS" > "$DIR/siblings.txt"
fi

if [ "$OUTCOME" = "BASELINE" ]; then
  printf 'root\n' > "$DIR/role.txt"
  for s in $SIBLINGS; do
    mkdir -p "$WORK_DIR/test-$s"
    printf 'sibling of test-%s\n' "$NUM" > "$WORK_DIR/test-$s/role.txt"
  done
fi

echo "Recorded $OUTCOME for test-$NUM${SIBLINGS:+ (siblings: $SIBLINGS)}"
