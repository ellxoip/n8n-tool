#!/usr/bin/env bash
set -euo pipefail
base=/data/n8n-ai-team
app="$base/app"
pm="$app/deploy/oracle/podman.sh"
if "$pm" pod exists n8n-oracle-trial; then
  "$pm" pod start n8n-oracle-trial
else
  # Trial reuses the existing VM. These caps do not change OCI billing or its assigned shape.
  "$pm" pod create --name n8n-oracle-trial --cpus 2 --memory 14g --memory-swap 14g --publish 127.0.0.1:15678:5678
fi
trial_id=$("$pm" pod inspect --format '{{.Id}}' n8n-oracle-trial)
systemctl --user set-property --runtime "user-libpod_pod_${trial_id}.slice" CPUQuota=200% MemoryMax=14G MemorySwapMax=0
ensure() {
  local name="$1"
  shift
  if "$pm" container exists "$name"; then
    "$pm" start "$name"
  else
    "$pm" run -d --pod n8n-oracle-trial --name "$name" "$@"
  fi
  # OCI's user manager delegates memory/pids but not CPU. Affinity enforces
  # two cores even where a rootless cpu.max quota cannot be applied.
  "$pm" top "$name" hpid | tail -n +2 | while read -r trial_pid; do
    taskset --all-tasks --pid --cpu-list 0,1 "$trial_pid" >/dev/null
  done
}
ensure n8n-oracle-ollama --env OLLAMA_HOST=0.0.0.0:11434 --env OLLAMA_KEEP_ALIVE=-1 --env OLLAMA_NUM_PARALLEL=1 --env OLLAMA_MAX_LOADED_MODELS=1 --volume "$base/ollama:/root/.ollama:Z" docker.io/ollama/ollama:0.32.0
ensure n8n-oracle-qdrant --env QDRANT__SERVICE__HOST=0.0.0.0 --volume "$base/qdrant:/qdrant/storage:Z" docker.io/qdrant/qdrant:v1.19.2
ensure n8n-oracle-voice --env-file "$base/oracle.env" --volume "$app:/app:z" localhost/n8n-oracle-runtime:trial uvicorn server:app --app-dir /app/services/voice --host 0.0.0.0 --port 8000 --workers 1
ensure n8n-oracle-bridge --env-file "$base/oracle.env" --volume "$app:/app:z" localhost/n8n-oracle-runtime:trial node services/bridge/server.js
ensure n8n-oracle-n8n --user 0 --env-file "$base/oracle.env" --volume "$app:/app:z" docker.io/n8nio/n8n:2.20.9
ensure n8n-oracle-gateway --env-file "$base/oracle.env" --volume "$app:/app:z" localhost/n8n-oracle-runtime:trial node services/gateway/server.js
ensure n8n-oracle-terminal --env-file "$base/oracle.env" --volume "$app:/app:z" localhost/n8n-oracle-runtime:trial bash -c 'exec ttyd --interface 0.0.0.0 --port 7681 --base-path /terminal --credential "$TERMINAL_WEB_CREDENTIAL" --writable --check-origin --max-clients 2 /bin/bash'
