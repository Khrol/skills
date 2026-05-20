#!/usr/bin/env bash
# Detects whether the current working directory is associated with an open GitHub PR.
# Outputs structured data for the test-meaningfulness skill to consume.
# Exit 0 always — failures are reported as NO_PR so the skill can fall back gracefully.

set -euo pipefail

if ! command -v gh &>/dev/null; then
  echo "NO_PR reason=gh_not_installed"
  exit 0
fi

if ! gh auth status &>/dev/null 2>&1; then
  echo "NO_PR reason=gh_not_authenticated"
  exit 0
fi

pr_json=$(gh pr view --json number,title,url,headRefName,baseRefName,state 2>/dev/null) || {
  echo "NO_PR reason=no_pr_for_branch"
  exit 0
}

state=$(echo "$pr_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")
if [[ "$state" != "OPEN" ]]; then
  echo "NO_PR reason=pr_not_open state=$state"
  exit 0
fi

number=$(echo "$pr_json"  | python3 -c "import sys,json; print(json.load(sys.stdin)['number'])")
title=$(echo "$pr_json"   | python3 -c "import sys,json; print(json.load(sys.stdin)['title'])")
url=$(echo "$pr_json"     | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])")
head=$(echo "$pr_json"    | python3 -c "import sys,json; print(json.load(sys.stdin)['headRefName'])")
base=$(echo "$pr_json"    | python3 -c "import sys,json; print(json.load(sys.stdin)['baseRefName'])")

changed_files=$(gh pr diff --name-only 2>/dev/null) || changed_files="(could not fetch diff)"

echo "PR_DETECTED"
echo "number=$number"
echo "title=$title"
echo "url=$url"
echo "head=$head"
echo "base=$base"
echo "changed_files:"
echo "$changed_files"
