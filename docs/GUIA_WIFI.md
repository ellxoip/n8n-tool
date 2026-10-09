# Uso local y por Wi-Fi

## Desde un celular o computador de la casa

Conecta el dispositivo a la misma red Wi-Fi y abre:

- Conversación con micrófono y respuesta hablada: `https://192.168.100.62:5678/webhook/voz`
- Terminal real del notebook: `https://192.168.100.62:5678/terminal/`
- Preparar, autorizar y revisar trabajos: `https://192.168.100.62:5678/trabajos`
- Chat principal con archivos e imágenes: `https://192.168.100.62:5678/webhook/agente-supervisor/chat`
- Editor y administración de n8n: `http://192.168.100.62:5678`

Todos utilizan el mismo puerto 5678. Para habilitar el micrófono del navegador, instala y confía en el certificado local antes de abrir HTTPS:

1. Descarga `http://192.168.100.62:5678/local-ca.crt` desde el celular.
2. En Android, instala el archivo como certificado CA desde Ajustes → Seguridad → Cifrado y credenciales → Instalar certificado (los nombres varían según el fabricante).
3. En iPhone, instala el perfil descargado desde Ajustes y activa su confianza en Ajustes → General → Información → Ajustes de confianza de certificados.
4. Abre el enlace HTTPS de voz y concede el permiso de micrófono. Si el navegador no permite grabar, la página admite subir una grabación y usar el dictado del teclado.

La terminal y el panel de trabajos solicitan usuario y contraseña. Consulta las credenciales únicamente en el notebook:

```bash
cat /home/carlos/Documentos/n8n-tool/.runtime/terminal-access.txt
```

La terminal utiliza GNU Screen: la sesión `n8n-mobile` y los comandos siguen activos si se corta el Wi-Fi. Se puede compartir la misma sesión desde la terminal física con `screen -xRR -S n8n-mobile`. Salir con `exit` termina la shell; para dejarla funcionando utiliza Ctrl+A, D o cierra la pestaña.

En **Trabajos**, preparar una tarea no ejecuta comandos. Primero revisa la instrucción y el proyecto; pulsa **Autorizar** para iniciar. El panel muestra estado, registros, cambios de Git y pruebas solicitadas. Al terminar, puedes aceptar el resultado o pedir cambios. Pedir cambios registra la revisión; debes preparar y autorizar una nueva tarea con las correcciones. Los trabajos sobreviven al cierre del navegador. Si se reinicia el puente durante una ejecución, queda marcada como interrumpida y no se repite automáticamente.

Los trabajos del agente escriben en proyectos relativos a `/home/carlos/Documentos/n8n-tool/workspace`. La terminal directa permite navegar a otros proyectos del notebook y ejecutar tus propios comandos. Sus comandos manuales se ejecutan inmediatamente; el circuito de autorización corresponde al panel y a las tareas preparadas por el agente Terminal Coder.

La voz usa Whisper Small en la GPU con INT8/FP16 y Piper en CPU; el modelo conversacional usa la GPU. Pulsa **Activar conversación** una vez: el teléfono detecta actividad de voz, conserva un pequeño inicio de la frase y envía automáticamente después de 1,1 segundos de silencio. Ajustes permite cambiar la sensibilidad y la pausa a 1,7 o 2,3 segundos. Descarta sonidos muy breves, limita cada mensaje a 45 segundos y pausa el micrófono mientras procesa o reproduce la respuesta. Al terminar de hablar la IA vuelve a escuchar. **Interrumpir respuesta** cancela la espera o la reproducción; **Pausar conversación** apaga el micrófono. Salir de la pantalla también lo apaga. El detector es ligero y funciona en el teléfono; no descarga otro modelo ni consume la GPU del notebook.

Los bloques de grabación se liberan al enviar y la referencia al archivo adjunto se elimina al finalizar la petición, incluyendo errores. La URL y el audio de respuesta se liberan al terminar o interrumpir la reproducción. El servidor cierra los archivos temporales después de transcribir. Los flujos de voz no guardan datos de ejecuciones exitosas, fallidas ni manuales. La pantalla muestra como máximo 30 entradas. No se conserva un historial de audios.

La memoria conserva texto acotado por conversación: seis mensajes completos recientes, hasta 18 notas de intercambios anteriores y ocho preferencias explícitas, además del tema, ubicación y día consultado. Recupera notas pertinentes al tema para responder y resuelve referencias como «¿y cuándo nació?» antes de buscar. Mantiene hasta 50 conversaciones; las que llevan siete días sin actividad se eliminan al procesar una nueva petición. Se guarda en los datos estáticos del flujo, sin una ejecución ni grabación por cada turno. El navegador conserva solamente el identificador de conversación para continuar después de recargar o volver a abrir la página. **Nueva charla** crea otra conversación; las anteriores expiran según ese límite. La pantalla muestra tema, lugar y cantidad de intercambios retenidos. Esta memoria es acotada: no garantiza recordar todo indefinidamente ni sustituye una fuente actual verificable.

La conversación consulta Internet automáticamente para preguntas informativas; puedes elegir **Buscar en cada pregunta** o **Sin Internet**. Usa Bing RSS para búsquedas personales y Wikipedia como fuente complementaria, y muestra enlaces junto a la respuesta. Los resultados son extractos, no una lectura completa de cada página. Las consultas de texto se envían a esos proveedores; el audio se procesa localmente. Si no hay resultados relevantes, debe comunicar que no pudo verificar la información. No existe una API universal ni una garantía del 98 % de exactitud para todas las preguntas.

La hora y la fecha se calculan con el reloj sincronizado del notebook y zonas IANA, incluyendo cambios de horario. La hora en Chile se identifica como Santiago/Chile continental; Punta Arenas e Isla de Pascua tienen sus propias zonas. Para países o nombres ambiguos pide ciudad. El clima usa Open-Meteo y geocodificación mundial: indica la ciudad al preguntar o escríbela en Ajustes. Conserva esa ubicación para preguntas como «¿y mañana?» o «¿necesito paraguas?». Ofrece datos de los últimos siete días y un pronóstico de siete días, indicando fechas y estimaciones. Las cifras y códigos meteorológicos se convierten directamente a texto, sin pedir al modelo que los adivine. La caché meteorológica dura dos minutos y la de ubicación una hora, ambas en memoria y limitadas. Los pronósticos pueden cambiar y los datos pasados no son observaciones certificadas de una estación.

Para inspeccionar proyectos o solicitar trabajos usa el enlace al supervisor. La latencia depende de la transcripción, las fuentes y los trabajos simultáneos; hora y clima evitan generar una respuesta con el modelo cuando basta con datos estructurados.

Para reducir la espera después de una pausa, el puente precarga Qwen al iniciarse y Ollama mantiene el modelo en memoria sin caducidad por inactividad. Reserva memoria de la GPU, pero no genera respuestas ni consume cómputo de inferencia cuando está quieto. Se conserva el límite de un modelo y una inferencia simultánea. La búsqueda tiene un límite de tres segundos para Bing y 1,8 para Wikipedia; si una fuente tarda demasiado, se comunica la falta de verificación. Las respuestas habladas suelen tener una frase de hasta 25 palabras; puedes pedir detalle para ampliarlas. Sin Internet no se hace una llamada adicional al modelo para preparar búsquedas de seguimiento; la respuesta usa directamente la memoria. Whisper omite marcas temporales que la interfaz no necesita.

Medición previa a la aceleración CUDA del 9 de octubre de 2026, desde el envío hasta recibir el audio: hora por audio 3,23 segundos, explicación por audio 6,93 segundos y consulta web escrita con respuesta hablada 3,70 segundos. La carga inicial de Qwen después de estar descargado tardaba aproximadamente 21 segundos; la precarga la adelanta al arranque del servicio. Estos son ejemplos medidos, no tiempos garantizados: influyen la duración de la grabación, Internet y otras tareas. Para repetir sin guardar audios: `node scripts/benchmark-voice.js`.

El chat acepta imágenes y archivos de texto, código, Markdown, JSON, XML, CSV y YAML de hasta 32 MB. Para OCR estructurado también está disponible `POST /webhook/ocr-vision` con un archivo multipart en el campo `file` y `mode=texto`, `documento` o `salud`.

La dirección `192.168.100.62` proviene por DHCP. Para conservarla permanentemente, reserva esa IP para este ThinkPad en la configuración DHCP del router.

## Desde la terminal del ThinkPad

```bash
cd /home/carlos/Documentos/n8n-tool
npm run tool -- "Escribe aquí tu tarea"
```

Pruebas y diagnóstico:

```bash
cd /home/carlos/Documentos/n8n-tool
npm run team:test
npm run team:status
systemctl --user is-active n8n-tool n8n-tool-bridge n8n-tool-gateway n8n-tool-terminal n8n-tool-voice ollama qdrant
```

Reiniciar toda la capa local:

```bash
systemctl --user restart ollama qdrant n8n-tool-bridge n8n-tool n8n-tool-gateway n8n-tool-terminal n8n-tool-voice
```

## Seguridad y persistencia

El gateway es el servicio expuesto a la red local, en el puerto 5678, y acepta HTTP y HTTPS. n8n (5677), la terminal (7681), la voz (8000), Ollama, Qdrant y el puente de ejecución permanecen en `127.0.0.1`. Los siete servicios se inician automáticamente mediante systemd y el usuario tiene `linger` habilitado, por lo que siguen disponibles sin una terminal abierta. La voz de Piper se copió al disco del notebook y Whisper reutiliza la caché local, sin depender del disco externo.

El certificado HTTPS incluye la IP actual y vence al año; si cambia la IP, debes actualizar el certificado. Reserva la dirección del notebook en el router para conservar los enlaces.


Después de activar Whisper Small en CUDA y respuestas breves, la misma explicación por audio bajó de 6,93 a 2,65 segundos; hora por audio: 0,66 segundos; búsqueda escrita con respuesta hablada: 2,93 segundos. Perfil por etapas de la explicación: transcripción 0,22 s, modelo 1,73 s y Piper 0,63 s. Qwen y Whisper siguen siendo los mismos modelos; solo cambia la ejecución del transcriptor y la longitud por defecto. Puedes pedir más detalle para ampliar. El uso observado de GPU fue aproximadamente 6,9 GB de 8 GB, con ambos modelos residentes. No se garantiza ese tiempo para grabaciones largas, preguntas que requieren varias búsquedas ni tareas simultáneas.
