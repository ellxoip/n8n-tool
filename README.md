# n8n AI Team

Plataforma local de agentes para construir proyectos end to end con n8n como orquestador visual, Ollama como runtime local y CLI `n8n-team` para usar el equipo desde CMD, PowerShell o VS Code.

## Componentes

- n8n local: `http://localhost:5678`
- Ollama local: `http://localhost:11434`
- CLI: `ai-team.js`, publicable como `n8n-team`
- Workflows: `workflows/*.json`
- Admin API: `scripts/n8n-admin.js`

## Agentes

- `0 Supervisor`: orquesta y enruta trabajo.
- `1 Analista`: requisitos, arquitectura, riesgos y criterios de aceptacion.
- `2 Programador`: implementacion mantenible.
- `3 Revisor QA`: bugs, seguridad, regresiones y pruebas.
- `4 DevOps Runtime`: instalacion, logs, health checks, webhooks, Ollama y n8n.

## Requisitos

- Node.js `>=22.16`
- Ollama corriendo
- n8n instalado por `npm install`
- Modelos Ollama esperados:
  - `mistral-small:latest`
  - `qwen3-coder:30b`
  - `deepseek-r1:14b`
  - `deepseek-coder-v2:16b`

## Instalacion

```bat
npm install
copy .env.example .env
```

Completa `N8N_API_KEY` en `.env` solo si vas a importar, actualizar o activar workflows por API. No pegues tokens en scripts ni workflows.

Para instalar Python local, sin tocar PATH global:

```bat
npm.cmd run python:install
```

## Ejecutar

```bat
npm start
```

Tambien:

```bat
iniciar_n8n.bat
```

Si PowerShell bloquea `npm`, usa `npm.cmd`.

## CLI

Desde la carpeta:

```bat
npm.cmd run team
npm.cmd run team:doctor
npm.cmd run team:test
node ai-team.js --agent 0 "Analiza este proyecto"
```

Desde cualquier carpeta:

```bat
npm link
n8n-team --doctor
n8n-team --agent 2 "Implementa la siguiente fase"
```

Si PowerShell bloquea el shim `.ps1`, usa:

```bat
n8n-team.cmd --doctor
```

## Workflows

Los workflows se administran por nombre, sin IDs quemados.

```bat
npm.cmd run workflows:list
npm.cmd run workflows:import
npm.cmd run workflows:upsert
npm.cmd run workflows:activate
npm.cmd run workflows:deactivate
npm.cmd run workflows:ensure-ollama
```

Wrappers BAT compatibles:

```bat
importar_workflows.bat
update_workflows.bat
activar_workflows.bat
api_test.bat
```

## Diagnostico

```bat
npm.cmd run team:doctor
```

Valida:

- Version de Node.
- n8n online.
- Ollama online.
- Modelos esperados.
- JSON de workflows locales.
- Presencia de `N8N_API_KEY` sin imprimirla.

## Estado y riesgos conocidos

- No hay repositorio Git inicializado.
- `.env` esta ignorado, pero debes regenerar cualquier API key que haya sido expuesta antes.
- Si n8n falla con `SQLITE_READONLY`, apunta `N8N_USER_FOLDER` a una carpeta limpia como `./.runtime/n8n`.
- Los workflows actuales conservan referencia a credencial local de Ollama; si importas en otra maquina, crea la credencial de Ollama en n8n o ajusta el workflow.
- `workflows:upsert` crea/reutiliza la credencial `Ollama Local` y actualiza los workflows antes de importarlos.
- En este paquete npm de n8n no viene `@n8n/task-runner-python`; por eso `N8N_PYTHON_ENABLED=false` evita que n8n falle intentando iniciar un runner Python incompleto. El runner JS queda activo.
- `team:doctor` puede fallar si n8n esta apagado; eso es esperado.

## Done operativo

1. `npm install`
2. `npm start`
3. `npm.cmd run team:doctor`
4. Configurar `N8N_API_KEY` si se usara API.
5. `npm.cmd run workflows:upsert`
6. `npm.cmd run workflows:activate`
7. `npm.cmd run team:test`
