# Barra de navegación de experiencias

La demostración pública, los proyectos y las prácticas usaban reglas distintas en `viewer.css`, `studio.css` e `interface.css`. Además de las variantes oscura y clara, la práctica reemplazaba la barra por botones flotantes. Se retiraron esas reglas superpuestas de la barra; la presentación se concentra en `packages/navigation-ui/experience-header.css` y su adaptador `ExperienceHeader.js`.

La base compartida establece marca, altura, tipografía, botones de 44 px, orden de navegación y puntos de adaptación. Los controles existentes conservan sus manejadores y permisos. Realidad virtual, voz, micrófono, cuenta y asistente conservan el estado de sus propios módulos. El adaptador admite los controles que se añaden después y los textos que cambia WebXR; elimina sus observadores y escuchas al cerrar la aplicación.

El orden es Inicio, Escenarios, acciones del contexto, Realidad virtual, Menú, Voz, micrófono, asistente y cuenta. Las acciones de contexto solo aparecen cuando existen: la demostración tiene Vista general; los proyectos tienen Guía y Resultados. En pantallas pequeñas las acciones secundarias permanecen disponibles desde Menú. Los menús de entrada comparten posición lateral, separación de la barra, tamaño y desplazamiento interno. Las pantallas de cuenta, ajustes, catálogo y herramientas de edición conservan sus flujos actuales.

La publicación pública incorpora explícitamente la hoja compartida en su lista de archivos permitidos. No incorpora el editor ni acciones de cuenta privadas.

`node tooling/qa/experience-header.cjs` comprueba los artefactos de producción en Chrome con servidor y cuenta temporales: demostración, proyecto original y práctica CEDI-01, desde 320 hasta 2560 px. Revisa solapamientos, desbordamiento, tamaño de los botones, accesibilidad del menú y liberación del teclado al cerrarlo. Guarda capturas y un informe en `data/qa-studio/experience-header/`. No cambia cuentas ni proyectos personales.
