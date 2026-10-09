#!/usr/bin/env python3
"""Build a consistent private migration bundle; never print credentials."""
import json
import os
import shutil
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
stage = root / '.runtime/oracle-migration'
stage.mkdir(mode=0o700, parents=True, exist_ok=True)
state = stage / 'n8n/.n8n'
state.mkdir(mode=0o700, parents=True, exist_ok=True)
source = root / '.runtime/n8n/.n8n'
src = sqlite3.connect('file:' + str(source / 'database.sqlite') + '?mode=ro', uri=True)
dst = sqlite3.connect(state / 'database.sqlite')
src.backup(dst)
assert dst.execute('pragma integrity_check').fetchone()[0] == 'ok'
workflows = []
for name, nodes, active in dst.execute('select name,nodes,active from workflow_entity'):
    types = [n['type'] for n in json.loads(nodes)]
    assert not any('scheduleTrigger' in t or 'cron' in t for t in types), 'Scheduled automation must be disabled in trial'
    workflows.append({'name': name, 'active': bool(active)})
counts = {table: dst.execute('select count(*) from ' + table).fetchone()[0] for table in ['workflow_entity', 'credentials_entity', 'execution_entity']}
dst.close()
src.close()
shutil.copy2(source / 'config', state / 'config')
if (source / 'nodes').exists():
    shutil.copytree(source / 'nodes', state / 'nodes', dirs_exist_ok=True)
env = {}
for line in (root / '.env').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        env[key.strip()] = value.strip()
env.update({
    'N8N_USER_FOLDER': '/app/.runtime/n8n',
    'N8N_HOST': 'localhost', 'N8N_LISTEN_ADDRESS': '0.0.0.0', 'N8N_PORT': '5677',
    'N8N_PROTOCOL': 'https', 'N8N_EDITOR_BASE_URL': 'https://localhost:15678',
    'WEBHOOK_URL': 'https://localhost:15678/', 'N8N_BASE_URL': 'http://127.0.0.1:5677',
    'N8N_SECURE_COOKIE': 'true', 'N8N_CONCURRENCY_PRODUCTION_LIMIT': '1',
    'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS': 'true',
    'OLLAMA_BASE_URL': 'http://127.0.0.1:11434', 'BRIDGE_PORT': '8787',
    'TERMINAL_CODER_WORKSPACE': '/app/workspace', 'PROJECT_READ_ROOTS': '/app/workspace',
    'QDRANT_URL': 'http://127.0.0.1:6333',
    'TTS_BASE_URL': 'http://127.0.0.1:8000', 'STT_BASE_URL': 'http://127.0.0.1:8000',
    'PIPER_MODEL_PATH': '/app/.runtime/voice-models/es_ES-davefx-medium.onnx',
    'WHISPER_MODEL_PATH': '/app/.runtime/whisper-small',
    'WHISPER_DEVICE': 'cpu', 'WHISPER_COMPUTE_TYPE': 'int8', 'WHISPER_CPU_THREADS': '2', 'WHISPER_BEAM_SIZE': '5',
    'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '1', 'HF_HUB_OFFLINE': '1',
    'N8N_TEAM_TIMEOUT_MS': '300000', 'VOICE_LLM_TIMEOUT_MS': '300000', 'OLLAMA_CPU_THREADS': '2',
})
(stage / 'oracle.env').write_text('\n'.join(k + '=' + v for k, v in env.items()) + '\n')
for p in [stage / 'oracle.env', state / 'config', state / 'database.sqlite']:
    os.chmod(p, 0o600)
(stage / 'manifest.json').write_text(json.dumps({'counts': counts, 'workflows': workflows}, ensure_ascii=False, indent=2))
print(json.dumps({'stage': str(stage), 'counts': counts, 'integrity': 'ok'}))
