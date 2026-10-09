# Copia de prueba de n8n en Oracle

Fecha: 9 de octubre de 2026.

La copia está instalada en `/data/n8n-ai-team` del servidor `zelix-global-01`, usando la VM existente de 4 núcleos ARM y 24 GB. No se crearon máquinas o volúmenes ni se ampliaron recursos de OCI. La instalación local se conserva para recuperación; este despliegue es una copia de prueba, no una sustitución irreversible.

## Acceso

- Editor: https://localhost:15678
- Conversación: https://localhost:15678/webhook/voz
- Trabajos: https://localhost:15678/trabajos
- Terminal: https://localhost:15678/terminal

El puerto remoto escucha exclusivamente en `127.0.0.1`. El servicio local `n8n-oracle-tunnel.service` abre el túnel SSH al iniciar sesión. El cómputo ocurre en Oracle; el túnel solo transporta tráfico. Desde otro equipo se necesita un túnel propio con acceso SSH. La publicación con dominio público no forma parte de esta prueba.

El certificado de prueba tiene SAN para localhost y 127.0.0.1. Fue copiado por SSH y verificado con curl usando su CA explícita. El navegador puede pedir aceptar el certificado de prueba. El certificado público local está en `.runtime/oracle-migration/oracle.crt`. La autenticación del editor conserva los usuarios de la instalación original; trabajos y terminal conservan la credencial configurada previamente. No se imprimieron ni publicaron claves.

## Datos y servicios

- SQLite copiado mediante la API de backup, con `integrity_check=ok`.
- 11 workflows activos; todos se disparan por chat o webhook, sin cron ni disparadores de calendario que dupliquen automatizaciones.
- 2 credenciales y la clave de cifrado original conservadas.
- 38 ejecuciones existentes en el respaldo inicial; los benchmarks agregaron actividad nueva a la copia.
- Memoria Qdrant restaurada por snapshot: 23 puntos. Búsqueda semántica comprobada con el mismo modelo de embeddings.
- Código con los cambios locales, workspace, trabajos guardados y repositorio Git copiados. Los agentes de terminal solo ven el workspace remoto; no se copiaron otros proyectos arbitrarios del notebook.
- Pesos de Whisper Small y Piper copiados. Los entornos binarios se reconstruyeron para ARM.

Servicios del pod `n8n-oracle-trial`: Ollama, Qdrant, voz CPU, bridge, n8n, gateway y terminal. Las imágenes, los modelos, los respaldos y el almacenamiento de esta copia están en `/data`. La raíz del sistema conserva el espacio que tenía antes del despliegue.

Versiones comprobadas: n8n 2.20.9, Ollama 0.32.0, Qdrant 1.19.2 y Aider 0.86.2. Los tres modelos de Ollama conservan los identificadores originales: Qwen 3.5 9B `56671c2ab938`, Nomic `0a109f422b47` y Qwen 2.5 7B `845dbda0ea48`. La API de Ollama confirmó `size_vram=0`: inferencia en CPU.

El servicio remoto `n8n-oracle-trial.service` inicia la copia al arrancar el gestor de servicios del usuario. La prueba usa un límite agregado de 14 GiB y cero swap para el pod. El gestor de usuario de Oracle delega memoria y procesos pero no el controlador CPU; por eso se aplicó afinidad a los núcleos 0 y 1 para los procesos de los contenedores. Los otros dos núcleos quedan fuera de la afinidad del stack de prueba. Esto limita la carga de la copia, pero no reserva núcleos exclusivamente ni modifica la asignación o facturación de OCI.

Los scripts reproducibles están en `deploy/oracle/`. `start.sh` permite iniciar los servicios existentes y aplica las restricciones. Los cambios de código habilitan configurar los hilos de Whisper, los hilos de las llamadas de voz a Ollama y su timeout para CPU; los valores por defecto locales se mantienen.

## Validación y rendimiento

Pasaron las 78 pruebas del proyecto dentro de Oracle. Se verificaron salud de n8n, bridge, voz, Qdrant y gateway; 11 workflows activos; memoria restaurada y búsqueda; página de conversación; síntesis y transcripción; respuesta de hora y clima. El acceso HTTPS desde el notebook por túnel responde. Trabajos rechazó acceso sin autenticación con HTTP 401. Aider respondió con su versión. Los 13 contenedores anteriores de Zelix continuaron activos durante las comprobaciones.

Primeras mediciones desde el propio servidor, desde el envío de la pregunta hasta recibir el audio final:

| Consulta | Tiempo | Observación |
| --- | --- | --- |
| Explicación de red neuronal, entrada por audio | 29,78 s | Medición inicial antes de fijar todos los procesos a dos núcleos |
| Ada Lovelace, entrada escrita y respuesta hablada | 35,48 s | La afinidad de CPU se ajustó durante la serie inicial |
| Clima de Valdivia para mañana, entrada escrita | 1,30 s | Datos actuales y respuesta determinista de clima |
| Hora de Chile, entrada escrita | 1,18 s | Hora validada con formato de reloj y localidad |
| Hora de Chile, entrada por audio | 5,36 s | «Dime qué hora es en Chile», transcripción y hora correctas |

La primera pregunta sintetizada «Qué hora es en Chile» se transcribió como «Quedó ahora es en Chile» y produjo una respuesta incorrecta en 112,42 s. Se registra como fallo de reconocimiento, no como éxito del reloj. La repetición con «Dime qué hora es en Chile» pasó la validación semántica. La precisión debe evaluarse también con voz humana real.

Una repetición posterior de la explicación con afinidad a dos núcleos terminó con un error de conexión. Se ajustaron los hilos de Ollama a dos para evitar exceso de hilos sobre dos núcleos. La evidencia de esa comprobación y su repetición se conserva en los registros de la copia. No se garantiza baja latencia ni equivalencia con los 2,65 s de la RTX local. Las mediciones del servidor tampoco incluyen el transporte desde Chile.

Tras ajustar los hilos a dos, la explicación completa por audio respondió en **54,41 s**. La consulta de hora por audio volvió a mostrar una confusión entre «hora» y «ahora». Se aumentó el beam de Whisper de 1 a 5 únicamente en Oracle: la prueba final reconoció correctamente el término «hora» tanto en «Dime qué hora es en Chile» como en «Qué hora es en Chile», y reconoció la pregunta sobre una red neuronal. Las transcripciones tardaron 4,37, 4,18 y 4,45 s respectivamente. Esto mejora los casos medidos; no garantiza reconocimiento perfecto de voces, ruido o acentos diferentes. Los registros previos de fallos se conservan.

La comprobación final de extremo a extremo con beam 5 y los procesos fijados a dos núcleos validó la hora por texto en **0,47 s** y por audio en **4,75 s**. La palabra inicial «Dime» tuvo una variación en el reconocimiento, pero se reconoció la pregunta de hora y la respuesta utilizó el reloj real. La copia quedó con los siete servicios activos, los 13 contenedores anteriores activos, aproximadamente 10 GiB de RAM disponibles, swap sin uso y 130 GiB libres en `/data`.

Observaciones durante las pruebas: el host alcanzó alrededor de 12 GiB de RAM usada, con unos 10 GiB disponibles y swap sin uso. `/data` quedó en aproximadamente 21 GiB usados y 130 GiB disponibles. El consumo cambia con los contextos, los modelos residentes, el caché y los otros servicios.

## Los 24 GB y la franquicia gratuita

Está confirmado mediante metadata OCI que esta VM tiene 24 GB y 4 OCPU, y están disponibles técnicamente. La cuenta fue identificada por el usuario como Always Free. La identidad del servidor permitió consultar la tenancy y su región principal IAD, pero negó acceso a suscripciones, cuotas e inventario de máquinas con `NotAuthorizedOrNotFound`. No se pudo verificar la facturación ni una excepción aplicable a esta cuenta.

La documentación vigente de Always Free indica 1500 OCPU-horas y 9000 GB-horas al mes, equivalentes a 2 OCPU/12 GB. La lista de precios de Oracle distingue 3000 OCPU-horas y 18000 GB-horas para tenancies de pago. Con 31 días de operación, 4 OCPU y 24 GB representan 2976 OCPU-horas y 17856 GB-horas: encajan en esa segunda franquicia, no en la primera.

Es posible que una asignación anterior tenga condiciones particulares, pero disponer de 24 GB no prueba esa cobertura. No se redujo la VM, no se cambió el plan de cuenta ni se amplió su capacidad. Añadir procesos a una VM ya asignada no incrementa por sí mismo sus OCPU o GB provisionados. Esto no garantiza ausencia de cargos o de medidas de reclamación aplicables a la cuenta.

Para cerrar la duda se necesita comprobar la franquicia efectiva y el consumo/costo de Ampere A1 en la consola del propietario o una confirmación de Oracle para esta tenancy. La comparación debe considerar todas las instancias A1 y servicios que compartan la franquicia, no solo esta máquina. Limitar los contenedores a 12 GB no transforma una VM asignada con 24 GB en una VM de 12 GB para su cuota.

Fuentes oficiales consultadas el 9 de octubre de 2026:

- Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Precio y franquicia A1 de cuentas de pago: https://www.oracle.com/cloud/price-list/

## Registros y recuperación

- Respaldo original privado: `/data/n8n-ai-team/backup`.
- Registros de construcción y pruebas: `/data/n8n-ai-team/logs`.
- Estado y resultados de la copia: `/data/n8n-ai-team/app/.runtime`.
- Respaldo local de traslado: `.runtime/oracle-migration`.

Para detener solo la copia: `systemctl --user stop n8n-oracle-trial.service` en Oracle. Para iniciarla: `systemctl --user start n8n-oracle-trial.service`. Estos comandos no administran los contenedores de Zelix, que usan un almacenamiento Podman separado.
