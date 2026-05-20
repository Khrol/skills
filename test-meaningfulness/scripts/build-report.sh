#!/usr/bin/env bash
set -euo pipefail
# Usage: build-report.sh <work-dir>
# Reads per-test folders and prints the mutation report markdown table to stdout.
WORK_DIR="${1:?Usage: build-report.sh <work-dir>}"

echo "| # | Test | Mutation | Result |"
echo "|---|------|----------|--------|"

while IFS= read -r dir; do
  num=$(basename "$dir" | grep -oE '[0-9]+' | head -1)
  name=$(cat "$dir/name.txt"          2>/dev/null || echo "unknown")
  outcome=$(cat "$dir/outcome.txt"    2>/dev/null || echo "?")
  desc=$(cat "$dir/mutation-desc.txt" 2>/dev/null || echo "—")

  case "$outcome" in
    OK)   result="Only \`$name\` failed ✓" ;;
    *)    result="**${outcome}**" ;;
  esac

  printf "| %s | \`%s\` | %s | %s |\n" "$num" "$name" "$desc" "$result"
done < <(find "$WORK_DIR" -maxdepth 1 -name 'test-*' -type d | sort -V)
