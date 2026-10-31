# Asistente de voz

El botón **Voz** abre la ayuda en la demostración pública y en el Workspace. En RV aparece un botón espacial pequeño; el menú de configuración de sonido también permite abrirla. El panel ofrece instrucciones, objetivo, controles, lectura del contenido, repetición, subtítulos, volumen y velocidad. El micrófono se activa expresamente con **Hablar** y únicamente cuando el navegador ofrece reconocimiento. Las consultas reconocidas incluyen «qué hago ahora», «dónde llevo este pallet», «cuál es mi objetivo», «lee el cartel» y «repite».

La implementación es una ayuda contextual con consultas definidas y estado real del simulador. No incluye una cuenta ni un modelo conversacional externo. Usa las voces españolas que el dispositivo publica mediante Web Speech, con seis grabaciones locales de prueba como alternativa. Una instrucción dinámica conserva su texto exacto en los subtítulos; si el dispositivo no ofrece voz española, la grabación alternativa contiene una orientación general. **Audios de prueba** permite escuchar cada muestra deliberadamente, sin ejecutar operaciones ni modificar el progreso.

Las seis muestras son bienvenida, recogida, ruta, depósito, finalización y seguridad, generadas localmente con Microsoft Sabina (`es-MX`). [El inventario](../packages/voice-assistant/assets/manifest.json) contiene transcripciones, duración y SHA-256. El generador y la procedencia se documentan en [los recursos de voz](../packages/voice-assistant/assets/README.md). Los archivos se cargan al pedir reproducción; no se descargan modelos de voz al visor.

## Módulo reutilizable

`packages/voice-assistant` exporta un servicio sin Three.js ni dependencias del editor. El módulo opcional `shared.assistance`, función `assistant.voice`, recibe la capacidad `platform.voice` y publica `world.voice`. El puerto aporta `getSnapshot`, voces/muestras, acceso al audio y la fábrica de interfaz. Al retirar el módulo se cancelan voz, audio, micrófono, callbacks, listeners y recursos del panel; el motor central y los equipos conservan su estado.

El adaptador industrial de `modules/logistica-industrial/integrations/VoiceContext.js` produce un snapshot de solo lectura: guía física, misión actual, ubicación, contenido y controles. No sustituye `SimulationRuntime.onEvent`, no escribe inventario y no interpreta respuestas como comandos de máquinas. La finalización solo se anuncia cuando la misión real está completa y verificada; un depósito pendiente de retirar las horquillas no equivale a una misión terminada.

El usuario activa la voz con una interacción. Las preferencias de voz, volumen y velocidad se conservan localmente; el permiso de reproducción no se restaura automáticamente. Solo hay una reproducción activa, las etapas repetidas se deduplican y una alerta crítica puede interrumpir la ayuda anterior. El audio de máquinas reduce su volumen temporalmente durante la narración. Se reutiliza el contexto de audio existente sin suspenderlo ni cerrarlo. El cambio de sala, reinicio, pausa y desmontaje cancelan la reproducción anterior.

En dispositivos compatibles, **Hablar** usa el reconocimiento del navegador para una consulta. Su disponibilidad y procesamiento dependen de ese navegador; puede requerir conexión. El micrófono necesita consentimiento y un contexto seguro. Si no está disponible, las consultas por botones y los audios siguen funcionando. Esta integración no incorpora claves de proveedores al cliente ni publica proyectos privados.

## Verificación

`npm run test:voice` verifica servicio, ciclo de vida modular, consultas, guía exacta, recursos XR y señal PCM real de los seis archivos. `node tooling/qa/voice-assistant.cjs` prueba los artefactos de producción con cuentas y bases de datos temporales, reproducción y decodificación reales, consultas contextualizadas, compatibilidad y desmontaje. Las comprobaciones XR de navegador simulan el estado inmersivo; no sustituyen la validación de micrófono, voz y rendimiento en un Quest físico.
