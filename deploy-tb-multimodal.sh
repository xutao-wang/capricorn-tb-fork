#!/usr/bin/env bash
# Prepare a reviewable upgrade. This wrapper never performs cloud mutations.
set -euo pipefail
cd "$(dirname "$0")"
exec "${PYTHON:-python3}" deploy/prepare.py "$@"
