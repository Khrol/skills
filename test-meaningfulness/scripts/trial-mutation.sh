#!/usr/bin/env bash
# Usage: trial-mutation.sh <work-dir> <test-num> <target-test-id> <run-all-cmd> [fail-grep] [fail-field]
#
# One complete, deterministic mutation trial. Call it from the project root
# AFTER editing the source. It performs, in fixed order:
#   1. capture the current edit as <work-dir>/test-<num>/mutation.patch
#   2. run the suite (log: suite.log)
#   3. classify which tests failed vs the target
#   4. revert ALL tracked modifications (git restore .)
#   5. re-run the suite to verify the tree is green again (log: verify.log)
# and prints a machine-readable verdict block:
#   verdict=TARGET_ONLY|TARGET_NOT_FAILED|TARGET_PLUS_OTHERS|OTHERS_ONLY|NO_MUTATION|SUITE_ERROR
#   others=<space-separated failed test ids, excluding the target>
#   green_after=yes|no
#
# fail-grep  (default '^FAILED'): grep -E pattern selecting failure lines in the log.
# fail-field (default 2):         awk field of the test id on those lines.
# Defaults fit pytest ("FAILED tests/test_x.py::test_y - ..."). Override for
# other frameworks.
set -u
WORK_DIR="${1:?Usage: trial-mutation.sh <work-dir> <test-num> <target-test-id> <run-all-cmd> [fail-grep] [fail-field]}"
NUM="${2:?}"
TARGET="${3:?}"
CMD="${4:?}"
FAIL_GREP="${5:-^FAILED}"
FAIL_FIELD="${6:-2}"
DIR="$WORK_DIR/test-$NUM"
mkdir -p "$DIR"

git diff > "$DIR/mutation.patch"
if [ ! -s "$DIR/mutation.patch" ]; then
  echo "verdict=NO_MUTATION"
  echo "others="
  echo "green_after=yes"
  exit 0
fi

eval "$CMD" > "$DIR/suite.log" 2>&1
SUITE_CODE=$?

FAILED=$(grep -E "$FAIL_GREP" "$DIR/suite.log" | awk -v f="$FAIL_FIELD" '{print $f}' | sort -u)
TARGET_FAILED=no
printf '%s\n' "$FAILED" | grep -qxF "$TARGET" && TARGET_FAILED=yes
OTHERS=$(printf '%s\n' "$FAILED" | grep -vxF "$TARGET" | tr '\n' ' ' | sed 's/ *$//')

git restore .

eval "$CMD" > "$DIR/verify.log" 2>&1
VERIFY_CODE=$?
GREEN=no
[ $VERIFY_CODE -eq 0 ] && GREEN=yes

if [ $SUITE_CODE -eq 0 ]; then
  VERDICT=TARGET_NOT_FAILED
elif [ -z "$FAILED" ]; then
  VERDICT=SUITE_ERROR            # suite exited non-zero but no parsable failures (crash/collection error)
elif [ "$TARGET_FAILED" = yes ] && [ -z "$OTHERS" ]; then
  VERDICT=TARGET_ONLY
elif [ "$TARGET_FAILED" = yes ]; then
  VERDICT=TARGET_PLUS_OTHERS
else
  VERDICT=OTHERS_ONLY
fi

echo "--- suite log tail ---"
tail -15 "$DIR/suite.log"
echo "--- end ---"
echo "verdict=$VERDICT"
echo "others=$OTHERS"
echo "green_after=$GREEN"
