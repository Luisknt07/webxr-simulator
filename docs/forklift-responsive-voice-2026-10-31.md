# Controles, plano y voz · 31 de octubre de 2026

La conducción utiliza ahora una consola compacta con pestañas Conducir, Carga, Visión y Seguridad. Solo se presenta una categoría por defecto. Todos permite desplegarla completa, el botón de reducción deja una barra mínima y la emergencia permanece disponible. La misión muestra objetivo y paso actual; Detalles abre sus instrucciones y opciones. En horizontal pequeño se utiliza una franja superior que deja libre el centro. Las acciones siguen utilizando los comandos y controles físicos existentes.

El plano permanece compacto mientras se conduce y se amplía con Ampliar. Aprovecha la relación de aspecto real de la instalación, mantiene una escala uniforme y gira la representación cuando una nave alargada lo necesita, con orientación norte explícita. Distingue estanterías, columnas, ocupación, pasillo/fila, equipos, pallets, vehículo, recogida, entrega y ruta. El suelo definido por el autor conserva sus límites; el fondo nativo genérico no obliga a encoger toda la instalación. El bitmap se ajusta al tamaño y densidad del contenedor, con límites de resolución y lecturas acotadas. La superficie del monitor de RV conserva sus dimensiones.

La voz automática utiliza una instrucción breve correspondiente al paso actual. Se estabilizan cambios transitorios, se cancela una instrucción anterior y no se acumulan diálogos ni se repite toda la misión. Las preguntas se pueden escribir o dictar desde el botón de micrófono; el panel distingue guía local y conexión de IA. El asistente recibe datos de solo lectura y no ejecuta operaciones ni otorga puntuación.

La conversación con IA, la voz neuronal y la transcripción son capacidades opcionales del servidor. Exigen activación explícita, clave de API y sesión. El cliente no contiene claves. Las respuestas y grabaciones están acotadas; los cambios de cuenta, escenario o etapa cancelan respuestas obsoletas. La activación o decodificación de audio tiene un tiempo máximo, con alternativa del dispositivo. Una voz del dispositivo elegida expresamente conserva prioridad sobre la síntesis remota. Los detalles de instalación y tratamiento de audio están en [Asistente de voz](voice-assistant.md).

## Validación

- 199 pruebas de framework aprobadas, incluidas nueve nuevas de API de voz: autenticación, mismo origen, límites, identidad, respuestas tardías y admisión concurrente tras recibir el cuerpo.
- 34 pruebas del paquete de voz aprobadas: instrucciones, prioridades, cancelación, voces, historial, reproducción, permisos, grabación, silencio, aislamiento de cuentas y liberación de recursos. Las nueve pruebas de API también forman parte de `test:voice` (43 en ese comando).
- Regresiones de asistencia del montacargas, misiones de almacén, contexto de voz e interfaz DOM/RV aprobadas.
- QA real de DOM con los dos estilos de producción: diez combinaciones de escritorio, móvil y horizontal, incluidas 844×390 y 667×375; sin desbordamiento ni bloqueo del centro por la misión predeterminada.
- Compilación de los dos visualizadores y empaquetado con integridad. La publicación pública mantiene un solo escenario.
- Recorrido del escenario 3D real en 1600×1000, 390×844 y 844×390: centro despejado, plano ampliable, pregunta escrita, consulta con micrófono de prueba, respuesta por servidor y audio decodificado en el contexto compartido. Las grabaciones locales también se reprodujeron realmente en la demostración y el Workspace; se comprobaron permisos denegados, alternativas sin TTS y el panel espacial con RV emulada.

Los recorridos de navegador utilizan cuentas, SQLite y perfiles Chrome temporales, sin escribir en los proyectos del usuario. La prueba de conexión conversacional utiliza un proveedor y un micrófono simulados de forma explícita; el servidor HTTP, el contexto de la misión, la decodificación y la reproducción son reales. Esto verifica la integración y no certifica la calidad acústica del proveedor ni el hardware físico del visor. La instalación actual no tiene una clave configurada; conserva la guía local.

Los informes y capturas locales están en `data/qa-forklift-responsive/`, `data/qa-forklift-experience/` y `data/qa-studio/voice-assistant/`. No forman parte de la publicación. La comprobación física de ergonomía, rendimiento y micrófono en Quest 3 sigue siendo necesaria.

Bundles verificados: Workspace `a7e23969cd55e31e2c4c2bc837e87b662ab2914acc6419b0115be289fe0864b4`; visor público `bfa38347980a56ae116bde4fcf51718ba17783b622e5655dcf8bde6c9524ba87`.
