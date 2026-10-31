# Asistente inteligente de SmartTwin

El Workspace privado incorpora **✦ Asistente**, con conversación, fuentes y visuales. La voz contextual existente sigue disponible en **Voz**; sus preguntas avanzadas abren el asistente. La demostración pública conserva la guía local y no carga las herramientas del editor.

## Arquitectura y proveedores

| Capa | Implementación | API opcional |
| --- | --- | --- |
| Razonamiento y elección de herramientas | Agente acotado por permisos y contratos | DeepSeek u OpenAI |
| Consulta de Internet | Búsqueda con texto recuperado y fuentes | DeepSeek Search; Tavily como alternativa |
| Voz natural | Una narración activa, cancelación y contexto de misión | ElevenLabs u OpenAI; voces del dispositivo como respaldo |
| Micrófono | Pregunta breve, envío por silencio o pulsación | ElevenLabs Scribe u OpenAI; reconocimiento del navegador como respaldo |
| Control del proyecto | Herramientas propias del framework y APIs del editor | No necesita otra API |
| Análisis visual | Tablas y gráficos SVG declarativos | No necesita otra API |
| Web y videos | Lector de fuentes y marcos aislados bajo petición | No requiere clave de YouTube para insertar videos públicos compatibles |

**DeepSeek + ElevenLabs es una combinación compatible con esta implementación.** La búsqueda nativa de DeepSeek permite reutilizar su clave; Tavily es opcional. El razonamiento usa llamadas a funciones en modo sin pensamiento para interacciones breves. Las voces y la transcripción pueden cambiarse sin reemplazar las herramientas del proyecto. Referencias: [herramientas de DeepSeek](https://api-docs.deepseek.com/guides/tool_calls/), [Search & Fetch](https://api-docs.deepseek.com/guides/search/), [voz de ElevenLabs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) y [transcripción de ElevenLabs](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).

No se ha incorporado escucha permanente ni conversación de audio simultánea en streaming: el micrófono existente recoge turnos breves, con permiso del usuario. Para una futura conversación de voz a voz por WebRTC puede añadirse otro adaptador, por ejemplo [OpenAI Realtime](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime). Ese transporte no forma parte de esta entrega.

## Activación privada

Configura las siguientes variables **en el entorno del proceso servidor**, fuera del repositorio y de los proyectos, y reinicia la API:

```text
SMARTTWIN_VOICE_AI_ENABLED=true
SMARTTWIN_AI_PROVIDER=deepseek
SMARTTWIN_DEEPSEEK_API_KEY=<clave privada>
SMARTTWIN_SEARCH_PROVIDER=deepseek
SMARTTWIN_TTS_PROVIDER=elevenlabs
SMARTTWIN_STT_PROVIDER=elevenlabs
SMARTTWIN_ELEVENLABS_API_KEY=<clave privada>
SMARTTWIN_ELEVENLABS_VOICE_ID=<voz elegida en tu cuenta>
```

Se necesitan acceso y cuota en las cuentas API. Selecciona una voz con buen español en ElevenLabs y proporciona su identificador; no se inventa un identificador ni se clona una persona. Sin estas credenciales, las funciones locales siguen operativas y las capacidades cloud se muestran como no configuradas. La calidad acústica final depende de la voz elegida y debe escucharse con esa cuenta.

Los modelos predeterminados son `deepseek-flash`, `eleven_multilingual_v2` y `scribe_v2`; pueden configurarse con `SMARTTWIN_AI_CHAT_MODEL`, `SMARTTWIN_VOICE_TTS_MODEL` y `SMARTTWIN_VOICE_STT_MODEL`. Para Tavily utiliza `SMARTTWIN_SEARCH_PROVIDER=tavily` y `SMARTTWIN_TAVILY_API_KEY`. DeepSeek Search limita la consulta a 128 caracteres Unicode; el servidor comunica ese límite. No se implementó un proxy para descargar URLs arbitrarias.

La configuración OpenAI anterior mantiene compatibilidad: `SMARTTWIN_AI_PROVIDER=openai`, `SMARTTWIN_TTS_PROVIDER=openai`, `SMARTTWIN_STT_PROVIDER=openai` y `SMARTTWIN_OPENAI_API_KEY`. Sus valores por defecto son `gpt-4.1-mini`, `gpt-4o-mini-tts` y `gpt-4o-mini-transcribe`. La sesión de ChatGPT no aporta una clave API al servidor.

## Qué puede hacer

El asistente recibe un resumen acotado del proyecto y nivel autorizado: selección, componentes, parámetros editables, misión, controles, vehículo y guía actual. Puede inspeccionar más información mediante herramientas. No observa otros proyectos ni conoce información ausente del contexto.

- Consultar contexto, niveles y componentes; seleccionar un equipo y abrir paneles.
- Abrir un nivel disponible del proyecto actual, sin cambiar silenciosamente de proyecto. Con un vehículo ocupado se pide salir antes de cambiar de nivel.
- Modificar nombre, visibilidad, color, posición, rotación, escala y parámetros numéricos permitidos de equipos, usando las mismas APIs del inspector. Cada edición es una transacción con deshacer y validación de rangos.
- Mostrar variables reales de una simulación activa. La tabla se actualiza cada dos segundos mientras la pestaña Visuales permanece visible, sin nuevas llamadas al modelo.
- Buscar información, presentar fuentes, resumir las recuperadas en esa conversación y crear gráficos declarativos.
- Preparar un video público de YouTube o Vimeo para reproducirlo expresamente.

Pruebas rápidas sin claves:

```text
Abre el panel de contenido
Selecciona Banda de salida
Renombra el seleccionado como Banda de expedición
Abre el nivel Recepción
Analiza las métricas de la simulación
```

Con IA y búsqueda configuradas:

```text
Inspecciona la banda seleccionada y cambia su velocidad a 0.25
Explícame el paso actual de la misión y qué debo revisar antes de recoger el pallet
Busca información sobre almacenamiento FIFO y resume las fuentes
Crea un gráfico ilustrativo comparando dos alternativas e indica tus supuestos
Muéstrame un video sobre preparación de pedidos
```

Los nombres deben corresponder al proyecto abierto. Las preguntas explicativas no habilitan edición. Para cambios, solicita la acción directamente; si una tarea necesita más de ocho herramientas, divídela. La navegación web no concede permisos sobre el editor. No hay automatización genérica del escritorio, ejecución de JavaScript del modelo, acceso al sistema de archivos ni control de maquinaria física. Las misiones y puntuaciones se verifican exclusivamente en la simulación.

## Fuentes, visuales y experiencia WebXR

Las fuentes aparecen como tarjetas con título, enlace y texto recuperado. **Leer** abre ese texto sin cargar el sitio. Abrir una web dentro del panel requiere una acción explícita y utiliza un iframe aislado sin acceso al origen de SmartTwin. Algunos sitios impiden el enmarcado; siempre se ofrece el enlace original. No se eluden sus restricciones.

Los videos no se reproducen automáticamente. Mostrar un reproductor no significa que el asistente haya visto o transcrito el video. Los resúmenes se basan en el texto recuperado; los gráficos distinguen mediciones reales, datos de fuentes y ejemplos ilustrativos. No se ejecuta HTML ni código generado para representar respuestas.

El panel visual es una pantalla complementaria de escritorio/móvil. Cierra la captura del mouse al abrirse y contiene sus eventos de teclado para que escribir no conduzca el vehículo. En una sesión XR se cierra el panel de investigación; la ayuda de voz y sus controles espaciales existentes permanecen disponibles. Esta entrega no coloca páginas ni videos flotantes en el mundo inmersivo. La compatibilidad y calidad de micrófono, voz y audio deben verificarse en el Quest físico.

## Carpetas y adaptación a otros sectores

```text
packages/assistant-core/
  contracts.js                  Herramientas, argumentos y autoridad del comando
  ActionRegistry.js             Registro, identidad y serialización de cambios
  AgentController.js            Bucle acotado, cancelación y resultados
  module.js                     Función opcional assistant.agent
packages/assistant-ui/
  AssistantWorkspacePanel.js    Conversación, lector, gráficos y videos
  assistant-workspace.css       Interfaz responsive
packages/voice-assistant/       Voz, micrófono y narración contextual reutilizables
modules/logistica-industrial/integrations/
  AssistantActionBridge.js      Adaptación a SceneEditor y simulación industrial
  AssistantExperience.js        Conexión del núcleo, voz, UI y ciclo de vida
apps/api/server/
  assistant-providers.cjs       Adaptadores cloud de cerebro, voz y transcripción
  assistant-research.cjs        Búsqueda y filtrado de fuentes
  assistant-agent.cjs           Planificación, contexto y fuentes por conversación
  assistant-service.cjs         Sesión, límites, cancelación y endpoints
```

El núcleo no importa Three.js, equipos ni editor. El módulo opcional `shared.intelligence` requiere `assistant.voice`, consume el puerto `platform.assistant` y publica `world.assistant`. El Workspace aporta el adaptador industrial. Al retirar esa función se cancelan consultas y actualizaciones, se elimina su interfaz y se restauran las conexiones previas de voz; no se borran niveles ni se detiene el mundo.

Para Agricultura, Turismo o Educación, reutiliza núcleo, UI y proveedores; implementa un adaptador sectorial que entregue el contexto autorizado y registre sus herramientas. Amplía los contratos compartidos cuando una función sea reutilizable. Mantén comandos sectoriales dentro de su módulo; no introduzcas imports de esos sectores en `assistant-core`. El puerto del host determina qué herramientas existen y los permisos reales vuelven a comprobarse al ejecutarlas.

## Límites y privacidad

Los endpoints `/api/assistant/status`, `/ask`, `/agent`, `/research`, `/speech` y `/transcribe` mantienen las protecciones del servidor. Las solicitudes pagadas requieren sesión, origen válido e identidad esperada; las herramientas de edición además verifican permiso del proyecto, nivel actual, estado del editor y transacciones. Se bloquean cambios durante carga/transición, sesiones compartidas y acciones incompatibles.

Las claves permanecen en el servidor, con destinos cloud fijos. No se incluyen en bundles, documentos, publicaciones ni respuestas de estado. Preguntas, audio y contexto acotado sí se envían al proveedor seleccionado. Las fuentes son datos no confiables, nunca instrucciones del sistema. Se descartan enlaces con credenciales, IP, destinos locales o esquemas ejecutables.

Hay hasta dos solicitudes simultáneas por cuenta y ocho globales, cuotas por minuto y plazo de 18 segundos por solicitud. El navegador cancela resultados obsoletos al cambiar de cuenta/proyecto/nivel. El historial corto vive en memoria; las fuentes del servidor tienen caducidad de diez minutos y están separadas por cuenta y conversación. No se guardan grabaciones ni conversaciones en el proyecto. Las políticas de retención del proveedor siguen aplicando.

## Verificación

`npm.cmd run test:assistant` ejecuta contratos, herramientas reales del editor, ciclo de vida, proveedores, investigación, HTTP autenticado y UI. `npm.cmd run test:framework`, `test:voice` y `test:vehicle-assistance` cubren regresiones. Las pruebas cloud usan transportes simulados, sin credenciales ni gasto. `node tooling/qa/assistant-agent.cjs` prueba la integración en el editor con cuentas/proyectos temporales; `node tooling/qa/assistant-responsive.cjs` verifica cuatro tamaños de pantalla sin abrir fuentes externas.

La verificación de proveedores simulados no certifica latencia, cuota ni calidad de una voz real. Configura las claves y una voz elegida para validar esos puntos en tu instalación.
