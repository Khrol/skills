#!/usr/bin/env bash
set -euo pipefail
# Usage: apply-patch.sh <patch-file>
# Run from the project root.
patch -p1 < "${1:?Usage: apply-patch.sh <patch-file>}"
