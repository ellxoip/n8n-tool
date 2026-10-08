# Playbooks por dominio

El Supervisor ya conoce estos flujos (ver su prompt en `workflows/supervisor.json`).
Aqui estan las instrucciones para operarlos.

## Videojuegos (Godot)

1. `n8n-tool "Disena un prototipo de plataformas 2D en Godot con salto y monedas"`
   El Analista define mecanicas y criterios; el Terminal Coder crea escenas y scripts GDScript.
2. Verificacion headless: agrega a `.env` el comando que quieras permitir, por ejemplo
   `TERMINAL_CODER_ALLOWED_TESTS=godot --headless --quit;npm test`, y pide al agente
   que lo use como `test`.
3. El Revisor QA audita el diff (tipado de GDScript, señales, acoplamiento entre escenas).

Consejo: una responsabilidad por tarea ("sistema de salto", "HUD de monedas") rinde mucho
mas con modelos locales que pedir el juego completo.

## Salud (formulacion de proyectos y documentos clinicos)

- Todo corre en local (Ollama + Qdrant + OCR); nada sale de tu red. Es la base para cumplir
  privacidad de datos de salud, pero la configuracion de tu red y tu equipo sigue siendo tu responsabilidad.
- Indexa normativa y literatura en tu memoria: `n8n-team --memory-ingest .\normativa`.
- Documentos escaneados: `n8n-team --ocr receta.jpg --mode salud --json`. El modo `salud`
  transcribe sin interpretar y lista lo ilegible.
- Los agentes no emiten diagnosticos y deben citar la fuente de memoria usada. Cualquier
  resultado clinico requiere validacion profesional.
- No uses `guardar_memoria` con datos personales de pacientes.

## zelix.cl (mejora continua)

1. Analista: auditar el sitio (SEO, UX, rendimiento) con `consultar_fuentes` y priorizar.
2. Terminal Coder: implementar cada mejora en el repo del sitio (`workspace`) con su test.
3. Revisor QA: revisar el diff; DevOps: verificar el despliegue.
4. `guardar_memoria` registra decisiones para la siguiente iteracion.

Voz de marca: registra la voz clonada en tu servidor TTS, define `TTS_VOICE` y usa
`n8n-team --tts "..." --out audio.mp3` para generar locuciones.
