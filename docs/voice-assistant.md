# Asistente de voz

El botón **Voz** abre la ayuda en la demostración pública y en el Workspace. El botón **🎙** permite preguntar directamente; también puedes escribir una pregunta. En RV aparece un botón espacial pequeño y el panel ofrece micrófono y consultas rápidas. Los ajustes de voz, velocidad y grabaciones están en **Voz y grabaciones de prueba**, para mantener una interfaz compacta. Las consultas incluyen «qué hago ahora», «dónde llevo este pallet», «cuál es mi objetivo», «qué me recomiendas», «explica este contenido» y «repite».

La guía local funciona con el estado real del simulador y las voces españolas del dispositivo. La selección automática prioriza voces naturales cuando existen; su calidad depende de las voces instaladas. También admite, de forma opcional, conversación con IA, voz neuronal y transcripción mediante un servidor configurado, desde el espacio con identidad de usuario conocida. La demostración pública utiliza la guía local, aunque exista una cookie de otra pestaña: para IA se abre el espacio privado. El panel distingue **Guía local** e **IA conectada** y avisa cuando se utiliza voz generada por IA. No se presenta una respuesta local como si proviniera de un modelo conectado.

La narración automática usa una instrucción breve del paso actual, espera a que el estado se estabilice y cancela instrucciones de una etapa anterior. No acumula una lista de diálogos, no vuelve a leer toda la misión y no narra cada cambio de puntuación. Detener mantiene en silencio esa etapa hasta un cambio real. Las explicaciones y el contenido completo se consultan deliberadamente. Una alerta crítica puede interrumpir la ayuda anterior. Los controles y las ubicaciones proceden del simulador; las respuestas del modelo nunca ejecutan equipos ni conceden puntos.

Las seis muestras son bienvenida, recogida, ruta, depósito, finalización y seguridad, generadas localmente con Microsoft Sabina (`es-MX`). [El inventario](../packages/voice-assistant/assets/manifest.json) contiene transcripciones, duración y SHA-256. El generador y la procedencia se documentan en [los recursos de voz](../packages/voice-assistant/assets/README.md). Los archivos se cargan al pedir reproducción; no se descargan modelos de voz al visor.

## Módulo reutilizable

`packages/voice-assistant` exporta un servicio sin Three.js ni dependencias del editor. El módulo opcional `shared.assistance`, función `assistant.voice`, recibe la capacidad `platform.voice` y publica `world.voice`. El puerto aporta `getSnapshot`, voces/muestras, acceso al audio y la fábrica de interfaz. Al retirar el módulo se cancelan voz, audio, micrófono, callbacks, listeners y recursos del panel; el motor central y los equipos conservan su estado.

El adaptador industrial de `modules/logistica-industrial/integrations/VoiceContext.js` produce un snapshot de solo lectura: guía física, misión actual, ubicación, contenido y controles. No sustituye `SimulationRuntime.onEvent`, no escribe inventario y no interpreta respuestas como comandos de máquinas. La finalización solo se anuncia cuando la misión real está completa y verificada; un depósito pendiente de retirar las horquillas no equivale a una misión terminada.

El usuario activa la voz con una interacción. Las preferencias de voz, volumen y velocidad se conservan localmente; el permiso de reproducción no se restaura automáticamente. Solo hay una reproducción activa, las etapas repetidas se deduplican y una alerta crítica puede interrumpir la ayuda anterior. El audio de máquinas reduce su volumen temporalmente durante la narración. Se reutiliza el contexto de audio existente sin suspenderlo ni cerrarlo. El cambio de sala, reinicio, pausa y desmontaje cancelan la reproducción anterior.

El micrófono se activa solo al pulsarlo. Con transcripción de servidor disponible, graba una pregunta breve y la envía tras detectar voz y aproximadamente un segundo de silencio, cuando el analizador compartido está disponible. También puedes pulsar otra vez para enviarla; el límite es de doce segundos y 2 MiB. **Detener** cancela y libera el micrófono. Si esa capacidad no está configurada, utiliza el reconocimiento del navegador cuando está disponible. Ese reconocimiento puede usar el servicio de su fabricante. El micrófono requiere permiso y HTTPS (o localhost); la compatibilidad debe comprobarse en el navegador del Quest. Siempre se puede escribir o utilizar los botones.

## Activar IA y voz natural en el servidor

Configura estas variables en el entorno privado del proceso API y reinícialo:

| Variable | Valor |
| --- | --- |
| `SMARTTWIN_VOICE_AI_ENABLED` | `true` |
| `SMARTTWIN_OPENAI_API_KEY` | Clave privada de la API; también admite `OPENAI_API_KEY` |
| `SMARTTWIN_VOICE_CHAT_MODEL` | Opcional; por defecto `gpt-4.1-mini` |
| `SMARTTWIN_VOICE_TTS_MODEL` | Opcional; por defecto `gpt-4o-mini-tts` |
| `SMARTTWIN_VOICE_NAME` | Opcional; por defecto `cedar` |
| `SMARTTWIN_VOICE_STT_MODEL` | Opcional; por defecto `gpt-4o-mini-transcribe` |

Se requiere una cuenta de API con acceso a esos modelos y cuota. No se reutiliza la sesión de ChatGPT/Codex y no se incluyen credenciales en Git, HTML o JavaScript público. Sin clave y activación explícita, el servidor mantiene disponibles las funciones locales y no realiza solicitudes al proveedor. La calidad de la voz neuronal no se ha verificado en vivo en una instalación sin credenciales.

Los endpoints `/api/assistant/ask`, `/speech` y `/transcribe` exigen sesión, mismo origen, límites por cuenta y revalidación de identidad tras operaciones asíncronas. El estado público de capacidades no contiene claves. Solo se envían la pregunta y datos acotados de la escena consultada: objetivo, instrucción, controles, contenido seleccionado, misión y vehículo. El servidor no busca otros proyectos. Se conserva como máximo un historial corto en memoria del navegador, separado por cuenta y escenario; no se escribe un registro de conversaciones ni se guardan grabaciones en disco. Las preguntas y el audio que se consultan sí se envían al proveedor configurado. `store:false` se utiliza para las respuestas; no equivale por sí solo a una política de retención cero del proveedor.

Las respuestas se limitan a 320 tokens; voz y transcripción tienen tiempo y tamaño máximos. Hay hasta dos solicitudes simultáneas por cuenta y ocho globales. Configura también los límites de gasto de tu cuenta de API. El asistente orienta: no es un sistema de conducción automática ni sustituye la verificación física del pallet.

Referencias oficiales utilizadas: [Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [voz neuronal](https://developers.openai.com/api/docs/guides/text-to-speech) y [transcripción](https://developers.openai.com/api/docs/guides/speech-to-text).

## Verificación

`npm run test:voice` verifica servicio, ciclo de vida modular, consultas, guía exacta, recursos XR y señal PCM real de los seis archivos. `node tooling/qa/voice-assistant.cjs` prueba los artefactos de producción con cuentas y bases de datos temporales, reproducción y decodificación reales, consultas contextualizadas, compatibilidad y desmontaje. Las comprobaciones XR de navegador simulan el estado inmersivo; no sustituyen la validación de micrófono, voz y rendimiento en un Quest físico.
