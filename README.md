# n8n AI Team

Plataforma local de agentes para construir proyectos end to end con n8n como orquestador visual, Ollama como runtime local y CLI `n8n-team` / `n8n-tool` para usar el equipo desde CMD, PowerShell o VS Code.

Es un enjambre de modelos especialistas (MoE donde conviene) coordinados por el Supervisor, con voz, vision, memoria persistente y un agente de programacion por terminal. Todo local.

## Componentes

- n8n local: `http://localhost:5678`
- Ollama local: `http://localhost:11434`
- Bridge local (Terminal Coder + memoria): `http://127.0.0.1:8787`
- Qdrant (memoria RAG, opcional, Docker): `http://127.0.0.1:6333`
- Servidores de voz TTS/STT (opcionales, Docker o propios)
- CLI: `ai-team.js` (`n8n-team`) y `scripts/n8n-tool.js` (`n8n-tool`)
- Workflows: `workflows/*.json`
- Modelos por rol: `config/models.json`
- Admin API: `scripts/n8n-admin.js`

## Agentes y workflows

| Id | Agente | Rol de modelo | Funcion |
|----|--------|---------------|---------|
| 0 | Supervisor | `supervisor` | Orquesta y delega al resto (analista, programador, terminal coder, QA, devops, memoria). |
| 1 | Analista | `analyst` | Requisitos, arquitectura, riesgos y criterios de aceptacion. |
| 2 | Programador | `programmer` | Diseno y codigo dentro de la conversacion. |
| 3 | Revisor QA | `reviewer` | Bugs, seguridad, regresiones y pruebas (modelo distinto al programador). |
| 4 | DevOps Runtime | `devops` | Instalacion, logs, health checks, webhooks, Ollama y n8n. |
| 5 | Terminal Coder | `programmer` | Edita archivos reales y corre tests con Aider/OpenCode via el bridge. |
| - | OCR Vision | `vision` | `POST /webhook/ocr-vision`: imagen a texto/JSON estructurado. |
| - | Voz TTS | - | `POST /webhook/voz-tts`: texto a audio (voz propia / clonada). |
| - | Agente de Voz | `supervisor` | `POST /webhook/voz-agente`: audio a Whisper a LLM a TTS. |

La estrategia completa por fases, con comandos, esta en [`docs/FASES.md`](docs/FASES.md) y los flujos por dominio (videojuegos, salud, zelix.cl) en [`docs/DOMINIOS.md`](docs/DOMINIOS.md).

## Requisitos

- Node.js `>=22.16`
- Ollama corriendo
- n8n instalado por `npm install`
- Modelos Ollama: ver `n8n-team --models`. Cada rol tiene un modelo preferido y fallbacks (incluidos los modelos anteriores `mistral-small`, `qwen3-coder:30b`, `deepseek-r1:14b`, `deepseek-coder-v2:16b`), asi que una maquina con la configuracion antigua sigue funcionando. Descarga los preferidos con `n8n-team --pull-models`.
- Opcional: Docker (Qdrant, voz), `pip install aider-chat` y/o OpenCode (Terminal Coder).

## Instalacion

```bat
npm install
copy .env.example .env
```

Completa `N8N_API_KEY` en `.env` solo si vas a importar, actualizar o activar workflows por API. No pegues tokens en scripts ni workflows. `BRIDGE_TOKEN` se genera solo la primera vez que ejecutas `n8n-tool`.

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
n8n-tool --doctor
n8n-tool "Construye un proyecto end to end"
n8n-team --doctor
n8n-team --agent 2 "Implementa la siguiente fase"
```

`n8n-tool` es el comando autonomo: levanta n8n si esta apagado, verifica Ollama, inicia el bridge local, crea/reutiliza las credenciales (Ollama y Bridge Token), importa/actualiza workflows adaptandolos a tus modelos instalados, los activa y abre el equipo.

```bat
n8n-tool "Construye un proyecto end to end"
n8n-tool --list
n8n-tool --doctor
n8n-tool --no-sync          :: abrir sin sincronizar workflows
```

En PowerShell puede bloquearse el shim `.ps1`; usa `n8n-tool.cmd` / `n8n-team.cmd`.

### Modelos, vision, voz y memoria

```bat
n8n-team --models                        :: modelo elegido por rol
n8n-team --pull-models                   :: descarga los preferidos que falten
n8n-team --agent 5 "En mi-app agrega validacion de email y corre npm test"
n8n-team --ocr factura.png               :: OCR a JSON  (--mode texto|documento|salud, --json)
n8n-team --tts "Hola" --out saludo.mp3   :: texto a voz
n8n-team --voice pregunta.wav            :: audio a respuesta hablada
n8n-team --memory-ingest .\docs          :: indexar en la memoria
n8n-team --memory-search "decision sobre auth"
```

Servicios opcionales:

```bat
npm.cmd run services:up       :: Qdrant
npm.cmd run services:voice    :: TTS Kokoro (CPU) + STT Whisper (CPU)
```

Para cambiar el modelo de un rol sin editar archivos: `OLLAMA_MODEL_ANALYST=otro:tag` en `.env`.

## Workflows

Los workflows se administran por nombre/webhook, sin IDs quemados. Al importar, `n8n-admin` reemplaza el modelo de cada workflow por el resuelto para su rol, ajusta `numCtx`, las credenciales y las URLs de servicios (`OLLAMA_BASE_URL`, `BRIDGE_PORT`, `TTS_*`, `STT_*`).

```bat
npm.cmd run workflows:list
npm.cmd run workflows:import
npm.cmd run workflows:upsert
npm.cmd run workflows:activate
npm.cmd run workflows:deactivate
npm.cmd run workflows:ensure-ollama
npm.cmd run workflows:ensure-bridge     :: agrega --force si rotaste BRIDGE_TOKEN
```

Wrappers BAT compatibles:

```bat
importar_workflows.bat
update_workflows.bat
activar_workflows.bat
api_test.bat
```

## Diagnostico y pruebas

```bat
npm.cmd run team:doctor     :: estado real del entorno
npm.cmd test                :: pruebas automaticas (no requieren n8n ni Ollama)
```

`team:doctor` valida: version de Node, n8n y Ollama online, modelo elegido por rol (ok / fallback / faltante), JSON de workflows locales y su coherencia con `config/models.json`, servicios opcionales (bridge, Qdrant, TTS, STT) y presencia de `N8N_API_KEY`/`BRIDGE_TOKEN` sin imprimirlos.

`npm test` cubre la resolucion de modelos, la estructura de todos los workflows (conexiones, nombres de tools, sin secretos), el parcheo de workflows, el chunking/ingesta/busqueda de memoria contra servidores simulados y el bridge (auth, aislamiento de workspace, motores, tests permitidos, git diff). Hay un ejemplo de CI para GitHub Actions en `docs/ci.example.yml` (copialo a `.github/workflows/ci.yml`).

## Seguridad

- Secretos solo en `.env` (ignorado por Git) o en credenciales de n8n. Los workflows no contienen tokens.
- El bridge ejecuta comandos: escucha solo en loopback, exige token, limita el workspace y la lista de tests. No lo expongas a la red (`BRIDGE_HOST` distinto de loopback exige `BRIDGE_ALLOW_REMOTE=true`).
- Datos sensibles (salud): todo el pipeline es local; no uses `guardar_memoria` con datos personales.

## Estado y riesgos conocidos

- `.env` esta ignorado, pero debes regenerar cualquier API key que haya sido expuesta antes.
- Los nombres de modelos nuevos (Qwen3.5, Qwen3-Coder-Next, Gemma 4, Qwen3-VL...) se configuraron sin poder consultar `ollama.com` desde el entorno de desarrollo. Si un `pull` falla, corrige el tag con `OLLAMA_MODEL_<ROL>` en `.env`; los fallbacks mantienen el equipo operativo mientras tanto.
- Los workflows nuevos (Terminal Coder, OCR, voz) se validaron contra el esquema de los nodos de n8n 2.20 y con pruebas automaticas, pero no se ejecutaron contra una instancia real de n8n/Ollama/servidor TTS en este entorno: haz una primera prueba manual con `n8n-team --test`, `--ocr` y `--tts`.
- Las herramientas `ejecutar_*`/`procesar_datos`/`test_codigo` (nodo Code Tool) de los agentes heredados son marcadores: no ejecutan el codigo que escribe el modelo. Para ejecutar de verdad usa el Terminal Coder.
- Si n8n falla con `SQLITE_READONLY`, apunta `N8N_USER_FOLDER` a una carpeta limpia como `./.runtime/n8n`.
- Los workflows conservan una referencia a la credencial local de Ollama; `workflows:upsert` crea/reutiliza `Ollama Local` y la reemplaza al importar.
- `python:install` instala Python 3.11 local en `.runtime/python311`. En este paquete npm de n8n no viene `@n8n/task-runner-python`; por eso `N8N_PYTHON_ENABLED=false` evita que n8n falle intentando iniciar un runner Python incompleto. El runner JS queda activo.
- `team:doctor` puede fallar si n8n esta apagado; eso es esperado.

## Done operativo

1. `npm install`
2. `copy .env.example .env`
3. `npm start` (o directamente `n8n-tool`)
4. Configurar `N8N_API_KEY` si se usara API.
5. `n8n-team --pull-models`
6. `npm.cmd run workflows:upsert` y `npm.cmd run workflows:activate` (o `n8n-tool`, que lo hace solo)
7. `npm.cmd run team:doctor`
8. `npm.cmd run team:test`
9. `npm.cmd test`
