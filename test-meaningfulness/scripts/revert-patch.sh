#!/usr/bin/env bash
set -euo pipefail
# Usage: revert-patch.sh <patch-file>
# Run from the project root.
patch -p1 -R < "${1:?Usage: revert-patch.sh <patch-file>}"
