# Estrategia por fases: estado y como usarla

Este documento mapea la estrategia "supermodelo local" (enjambre de modelos
especialistas orquestados por el Supervisor en n8n) con lo que ya esta implementado.

| Fase | Capacidad | Estado | Donde vive |
|------|-----------|--------|------------|
| 1 | Modelos actualizados por rol, con fallback automatico | Listo | `config/models.json`, `scripts/lib/models.js` |
| 2 | Agente 5 Terminal Coder (Aider / OpenCode) | Listo | `workflows/agente_terminal_coder.json`, `services/bridge/` |
| 3 | TTS, clonacion de voz y agente de voz (STT, LLM, TTS) | Listo (servidor de voz aparte) | `workflows/voz_tts.json`, `workflows/voz_agente.json`, `docker-compose.yml` |
| 4 | OCR / vision con Qwen3-VL | Listo | `workflows/ocr_vision.json` |
| 5 | Memoria persistente RAG (Qdrant + embeddings) | Listo | `scripts/lib/memory.js`, herramientas `buscar_memoria` / `guardar_memoria` |
| 6 | Dominios (videojuegos, salud, zelix.cl) | Playbooks en el Supervisor | `docs/DOMINIOS.md` |

## Fase 1: modelos

Cada rol tiene un modelo preferido y una lista de fallbacks. `n8n-tool` elige el primero
que Ollama tenga instalado, asi que una maquina con los modelos antiguos sigue funcionando.

```bat
n8n-team --models          # que modelo usa cada rol y que falta
n8n-team --pull-models     # ollama pull de los preferidos que falten (--all incluye vision/embeddings)
```

| Rol | Preferido | Fallbacks |
|-----|-----------|-----------|
| supervisor, devops | `qwen3.5:4b` | `qwen3:4b`, `mistral-small:latest` |
| analyst | `qwen3.5:35b-a3b` | `qwen3:30b-a3b`, `deepseek-r1:14b` |
| programmer | `qwen3-coder-next:latest` | `qwen3-coder:30b`, `deepseek-coder-v2:16b` |
| reviewer | `gemma4:26b` | `qwen3-coder:30b`, `deepseek-coder-v2:16b` |
| vision | `qwen3-vl:8b` | `qwen3-vl:4b`, `qwen2.5vl:7b`, `llama3.2-vision:11b` |
| embedding | `nomic-embed-text` | `qwen3-embedding:0.6b`, `mxbai-embed-large` |

> **Verifica los tags.** Los nombres exactos de modelos nuevos se escribieron sin acceso a
> `ollama.com`. Si un `pull` falla, busca el tag correcto en https://ollama.com/library y
> fuerzalo sin tocar el repo: `OLLAMA_MODEL_ANALYST=tag-real` en `.env`. Hay modelos que en
> Ollama solo existen como "cloud"; para uso 100% local necesitas una variante descargable.

El Supervisor y DevOps usan un modelo de 4B porque rutear no necesita un modelo grande. Si
notas malas delegaciones, sube el Supervisor (`OLLAMA_MODEL_SUPERVISOR=qwen3.6:27b`).

## Fase 2: Terminal Coder

n8n 2.x deshabilita el nodo *Execute Command* por defecto y ejecutar comandos desde un
workflow es un riesgo. En su lugar, un **bridge local** (`services/bridge/server.js`) corre
Aider u OpenCode y n8n lo llama por HTTP con un token (credencial "Bridge Token").

Reglas de seguridad del bridge:

- Escucha solo en `127.0.0.1` y exige `Authorization: Bearer <BRIDGE_TOKEN>`.
- Solo trabaja dentro de `TERMINAL_CODER_WORKSPACE` (rechaza `..`, rutas absolutas y symlinks que escapen).
- Los motores se lanzan sin shell: la tarea viaja como un unico argumento.
- Los tests solo pueden ser comandos de la lista `TERMINAL_CODER_ALLOWED_TESTS`.
- Una tarea a la vez, con timeout y salida acotada.

Instalacion de motores (en la maquina donde corre el bridge):

```bat
pip install aider-chat
:: opcional: OpenCode, copia config\opencode.example.json a opencode.json en tu proyecto
```

Uso:

```bat
n8n-team --agent 5 "En el proyecto mi-app agrega validacion de email en src/form.js y corre npm test"
n8n-tool "Implementa X en mi-app, revisa el diff y reportame"   :: el Supervisor encadena Terminal Coder y QA
```

Para trabajar sobre tus repos reales, apunta `TERMINAL_CODER_WORKSPACE` a la carpeta que
contiene tus proyectos. Aider hace commits automaticos en el repo del proyecto.

## Fase 3: voz

Los workflows hablan con cualquier servidor compatible con la API de OpenAI
(`/v1/audio/speech` y `/v1/audio/transcriptions`), por eso el motor es intercambiable:

- **Kokoro** (CPU, incluido en `docker compose --profile voice`): respuestas y notificaciones baratas.
- **Qwen3-TTS** (clonacion de voz con ~6 s de audio): levanta su servidor con API compatible y
  apunta `TTS_BASE_URL`, `TTS_MODEL` y `TTS_VOICE` a el. La voz clonada se registra en el
  servidor; si tu servidor necesita campos extra (audio de referencia), envialos en `extra`.
- **STT**: Whisper via `speaches` (incluido en el perfil `voice`).

```bat
n8n-team --tts "Hola, soy la voz de Zelix" --out saludo.mp3
n8n-team --voice pregunta.wav --out respuesta.mp3     :: STT -> LLM -> TTS
n8n-team --voice "Que hora es en Chile?"              :: tambien acepta texto
```

Webhooks: `POST /webhook/voz-tts` (`{text, voice?, model?, format?, speed?, extra?}`) y
`POST /webhook/voz-agente` (multipart con audio, o `{text}`).

## Fase 4: OCR y vision

```bat
n8n-team --ocr factura.png                       :: JSON con campos detectados
n8n-team --ocr receta.jpg --mode salud --json    :: formato clinico, sin interpretar
n8n-team --ocr captura.png --mode texto          :: solo transcripcion
```

`POST /webhook/ocr-vision` acepta JSON `{image_base64, mode?, prompt?}` o multipart con la imagen.
Todo se procesa en local: apto para documentos con datos de salud.

## Fase 5: memoria

```bat
docker compose up -d qdrant
ollama pull nomic-embed-text
n8n-team --memory-ingest .\docs          :: indexa documentacion, workflows, decisiones
n8n-team --memory-search "como se activa el bridge"
```

Todos los agentes reciben `buscar_memoria`; Analista, Programador y Revisor tambien
`guardar_memoria` (con su `source`), asi el equipo recuerda entre sesiones. Reingestar el
mismo contenido no duplica (los ids son deterministas). La coleccion fija la dimension del
primer modelo de embeddings usado: si lo cambias, usa otra `QDRANT_COLLECTION`.

## Fase 6: dominios

Ver `docs/DOMINIOS.md`.
