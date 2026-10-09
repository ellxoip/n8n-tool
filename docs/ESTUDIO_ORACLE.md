# Viabilidad de migrar n8n AI Team a Oracle

Fecha: 9 de octubre de 2026. Inspección de solo lectura del servidor y del proyecto local; no se desplegó ni se detuvo ningún servicio.

Este es el estudio previo. La copia de prueba se desplegó después; su estado y las mediciones están en [MIGRACION_ORACLE.md](MIGRACION_ORACLE.md).

## Resultado

Es viable alojar n8n, el gateway, el puente de agentes, la memoria Qdrant, Ollama y la voz en el servidor inspeccionado. Hay RAM y almacenamiento suficientes para los modelos actuales con concurrencia controlada. La velocidad de conversación en CPU requiere una prueba real: no se puede trasladar la medición local de 2,65 segundos, obtenida con GPU, al servidor ARM.

## Recursos comprobados

Servidor `zelix-global-01`, región Ashburn, forma `VM.Standard.A1.Flex`, Oracle Linux 9.8, arquitectura AArch64.

| Recurso | Medición |
| --- | --- |
| CPU | 4 OCPU / 4 núcleos ARM Neoverse-N1 |
| RAM asignada por OCI | 24 GB |
| RAM que muestra Linux | Aproximadamente 22 GiB |
| RAM usada en la inspección | Aproximadamente 3,7 GiB |
| RAM disponible, incluida caché recuperable | Aproximadamente 18 GiB |
| Swap | 5 GiB, sin uso |
| Volumen de arranque | 46,6 GiB físicos |
| Sistema raíz `/` | 30 GiB, 6,1 GiB disponibles |
| Volumen de datos `/data` | 150 GiB, aproximadamente 149 GiB disponibles |
| GPU de cálculo | No detectada; el adaptador Virtio de pantalla no sustituye una GPU NVIDIA |

El disco más grande conectado a esta máquina es el de `/data`. Los tamaños de `df` están expresados en unidades binarias, mientras que las cuotas comerciales pueden usar GB. No se inventariaron otras regiones o compartimentos de la cuenta: la CLI remota no tiene configuración de autenticación.

Ya hay 13 contenedores de Zelix y sus bases de datos. Su carga era baja al medir, pero esta observación no representa necesariamente sus horas de mayor actividad. No conviene instalar modelos en `/`, que dispone de poco espacio; utilizar `/data/n8n-ai-team`.

## Modelos reales

| Modelo | Uso | Tamaño en disco medido |
| --- | --- | --- |
| Qwen 3.5 9B Q4_K_M | Supervisor, analista, programador, revisor, DevOps y visión | 6,55 GB |
| Qwen 2.5 7B Instruct | Alternativa instalada | 4,68 GB |
| Nomic Embed Text | Embeddings de memoria RAG | 0,274 GB |
| Faster Whisper Small | Transcripción de voz | Caché local de aproximadamente 464 MiB |
| Piper español Davefx Medium | Síntesis de voz | Directorio local de aproximadamente 61 MiB |

Los seis roles principales comparten Qwen 3.5. Esto permite reutilizar una instancia del modelo si se limita la ejecución simultánea; no implica seis copias obligatorias en RAM. Ollama permite cargar modelos diferentes bajo demanda. Qwen 2.5 es una alternativa, no una carga que deba mantenerse junto a Qwen 3.5.

El directorio de modelos de Ollama ocupa aproximadamente 11 GiB; `.runtime` del proyecto ocupa 2,8 GiB y el workspace 540 KiB. Reservar inicialmente entre 25 y 35 GiB para modelos, aplicación, entornos e imágenes, más espacio para respaldos, registros y crecimiento. Este presupuesto de instalación es una estimación, no un tamaño de despliegue medido.

## Presupuesto de RAM y CPU

Estimación conservadora para un usuario y una generación principal simultánea:

| Componente | Reserva orientativa |
| --- | --- |
| Qwen 3.5 9B, contexto y buffers | 8–12 GiB |
| n8n, gateway, bridge, Qdrant, embeddings y voz | 2–4 GiB |
| Sistema y aplicaciones existentes | Aproximadamente 4 GiB actuales |
| Total | 14–20 GiB |

El tamaño del archivo del modelo no equivale a su RAM total. El contexto, la visión, las solicitudes simultáneas y los buffers pueden aumentar el consumo. Estas reservas requieren validación al ejecutar en ARM. En la consulta local de Ollama no había modelos residentes, por lo que no se obtuvo una medición actual de memoria de inferencia.

Con 24 GB asignados, cabe una configuración controlada. Con 12 GB, el margen para Qwen 9B más voz y los servicios existentes sería muy estrecho: sería preferible evaluar un modelo de 4B o separar la inferencia. No utilizar swap como estrategia de rendimiento del modelo.

La limitación principal son los cuatro núcleos compartidos. Empezar con una generación simultánea (`OLLAMA_NUM_PARALLEL=1`), un modelo cargado (`OLLAMA_MAX_LOADED_MODELS=1`) y un contexto limitado. El proyecto utiliza 8192 tokens para los roles; probar 4096 si el flujo lo permite, sin dar por hecho que ambos consumos serán iguales. Establecer límites de recursos para el conjunto nuevo y dejar capacidad para Zelix. La voz tiene `cpu_threads=4` en el código actual: hacer este valor configurable para evitar que Whisper use todos los núcleos junto con Ollama.

No se realizó un benchmark de inferencia en Oracle. No hay evidencia para prometer tres segundos ni para asignar un número exacto de tokens por segundo. Se espera menor velocidad que con la RTX local; hay que medir preguntas escritas, voz y visión, incluyendo la latencia desde Chile hacia Ashburn.

## Compatibilidad y trabajo de migración

1. Respaldar consistentemente n8n, conservando base de datos, credenciales y clave de cifrado. Una copia de SQLite en uso sin un mecanismo consistente no basta. Mantener la misma versión de n8n durante la primera transferencia.
2. Respaldar Qdrant mediante snapshots y conservar el modelo de embeddings, sus dimensiones y las colecciones. Conservar workspace, archivos de trabajos e historial de conversación del bridge donde corresponda.
3. Reconstruir Node, dependencias y entorno Python para ARM64. Los pesos pueden trasladarse; `node_modules`, el entorno virtual y los binarios x86 no deben copiarse como instalación funcional ARM.
4. Instalar Ollama ARM64 y alojar modelos y datos en `/data`. Qwen, embeddings y voz se ejecutarían en CPU.
5. Para Whisper: `WHISPER_DEVICE=cpu` y `WHISPER_COMPUTE_TYPE=int8`; retirar las dependencias NVIDIA del entorno de Oracle. CTranslate2 publica ruedas para Linux AArch64. Verificar las versiones fijadas del resto de dependencias, especialmente Piper y ONNX Runtime, en un entorno ARM limpio.
6. Cambiar rutas absolutas de `/home/carlos`, direcciones locales y unidades systemd. El compose actual solo define Qdrant y servicios opcionales de voz; no constituye todavía un despliegue completo de esta plataforma.
7. Configurar HTTPS y acceso autenticado para n8n y la interfaz de voz. Mantener los puertos de Ollama, Qdrant, bridge y terminal internos. El micrófono del navegador requiere un contexto seguro.
8. Revisar los agentes de terminal: al trasladar el bridge, sus comandos y archivos operarían en Oracle. Determinar qué proyectos se trasladan al workspace remoto y ejecutar los agentes con permisos restringidos a ese workspace.
9. Probar en una instancia aislada del proyecto con límites de CPU/RAM: mismas preguntas y audios que el benchmark local, memoria RAG, historial, OCR y trabajos. Comprobar también la respuesta de los servicios existentes durante la prueba.
10. Hacer el cambio definitivo después de validar; apagar el stack local solo al comprobar que los datos y flujos están completos. Evitar que las dos instalaciones ejecuten a la vez las mismas automatizaciones con efectos externos.

## Opciones

| Opción | Libera el notebook | Valoración |
| --- | --- | --- |
| Todo en Oracle, mismos modelos, CPU | Sí, la inferencia y los servicios pasan al servidor | Viable por capacidad; velocidad por medir |
| Todo en Oracle con modelo principal de 4B | Sí | Candidato para mejorar velocidad; puede reducir calidad y exige nuevas pruebas |
| n8n en Oracle, modelos en la RTX local | Parcialmente | Aprovecha la velocidad local; depende del notebook encendido |
| n8n en Oracle con inferencia externa o una instancia GPU | Sí | Alternativa para baja latencia; requiere evaluar costos y proveedor |

Propuesta: trasladar primero una copia de prueba completa a `/data`, usando el mismo Qwen 9B con ejecución serializada, y medir antes de elegir entre mantener 9B, usar 4B o contratar inferencia. Esto permite evaluar el objetivo de liberar el equipo sin alterar las aplicaciones existentes.

## Recursos gratuitos y costos

La documentación pública actual de Always Free describe 1500 OCPU-horas y 9000 GB-horas al mes, equivalentes a 2 OCPU / 12 GB para tenancies Always Free. La lista de precios de Oracle también menciona 3000 OCPU-horas y 18000 GB-horas para tenancies de pago. El servidor inspeccionado tiene efectivamente 4 OCPU / 24 GB, pero eso no demuestra cuál es su franquicia ni su facturación. Revisar el tipo de cuenta, límites y consumo en OCI antes de garantizar gratuidad o aumentar recursos.

## Fuentes

- Recursos actuales de Oracle: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Lista de precios de Oracle: https://wwwcmsapi.oracle.com/cloud/price-list/
- Instalación de Ollama, incluida ARM64: https://docs.ollama.com/linux
- Instalación de CTranslate2, incluida Linux AArch64: https://opennmt.net/CTranslate2/installation.html
- Faster Whisper y benchmarks de CPU: https://github.com/SYSTRAN/faster-whisper
- Despliegue de n8n: https://docs.n8n.io/deploy/host-n8n/install-options/install-using-docker-compose.md
- Persistencia de n8n y claves de cifrado: https://docs.n8n.io/deploy/host-n8n/install-options/install-with-docker.md

Las cifras de recursos y almacenamiento proceden de SSH, metadata OCI y archivos/API locales consultados durante esta sesión. Las reservas de RAM y la propuesta de despliegue son estimaciones técnicas; no resultados de una instalación ni de un benchmark remoto.
