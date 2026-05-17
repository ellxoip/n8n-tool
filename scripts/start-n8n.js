#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...parts] = trimmed.split('=');
    if (!process.env[key]) process.env[key] = parts.join('=').trim();
  }
}

loadEnvFile(path.join(root, '.env'));

const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (/^[A-Za-z_][A-Za-z0-9_()]*$/.test(key)) env[key] = value;
}

if (!env.N8N_USER_FOLDER || env.N8N_USER_FOLDER.replace(/\\/g, '/') === './.n8n') {
  env.N8N_USER_FOLDER = './.runtime/n8n';
}

if (!env.N8N_DIAGNOSTICS_ENABLED) {
  env.N8N_DIAGNOSTICS_ENABLED = 'false';
}

env.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS = env.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS || 'false';

if (env.PYTHON_PATH) {
  const pythonPath = path.isAbsolute(env.PYTHON_PATH)
    ? env.PYTHON_PATH
    : path.resolve(root, env.PYTHON_PATH);
  const pythonDir = path.dirname(pythonPath);
  const pathKey = Object.prototype.hasOwnProperty.call(env, 'Path') ? 'Path' : 'PATH';
  env.PYTHON_PATH = pythonPath;
  env[pathKey] = `${pythonDir}${path.delimiter}${env[pathKey] || ''}`;
}

console.log(`Starting n8n with N8N_USER_FOLDER=${env.N8N_USER_FOLDER}`);

const localN8nCmd = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'n8n.cmd' : 'n8n');
const command = process.platform === 'win32'
  ? (process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'))
  : 'npx';
const args = process.platform === 'win32' ? ['/d', '/c', localN8nCmd] : ['n8n'];
const child = spawn(command, args, {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  console.error(`Failed to start n8n: ${err.message}`);
  console.error(`Command: ${command} ${args.join(' ')}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`n8n stopped by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code || 0);
});
