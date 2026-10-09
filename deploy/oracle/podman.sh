#!/usr/bin/env bash
set -euo pipefail
export TMPDIR=/data/n8n-ai-team/tmp
mkdir -p "$TMPDIR"
exec podman --root /data/n8n-ai-team/containers --runroot /run/user/1000/n8n-containers "$@"
