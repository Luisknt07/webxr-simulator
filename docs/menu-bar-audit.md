# Barra de navegación de experiencias

Los controles comparten su implementación en `ExperienceHeader.js` y sus estilos en `experience-header.css`, con dos presentaciones explícitas según la experiencia. Las reglas de navegación se mantienen fuera de `viewer.css`, `studio.css` e `interface.css` para evitar sobrescrituras accidentales.

**Juego:** las prácticas con controlador nativo activan `data-practice-game`. La marca aparece como una placa oscura flotante; RV y Menú son botones circulares. El centro queda libre para los indicadores existentes de progreso, puntuación y tiempo; se conservan la barra de misión, las herramientas laterales y la guía. El menú usa la misma paleta oscura. El adaptador observa el estado de la práctica y cambia solo cuando este cambia, sin procesar el diseño en cada fotograma.

**Recorrido:** la demostración, los proyectos originales y las vistas de consulta conservan la barra clara completa. En los proyectos muestra Prácticas, Guía, Resultados, RV, Menú, Voz, micrófono, asistente y cuenta, según sus capacidades. Las opciones secundarias de pantallas pequeñas siguen accesibles desde Menú. Al salir de una práctica, su controlador retira el estado de juego y vuelve la presentación de recorrido, también al cambiar de proyecto sin recargar la página.

Ambos modos conservan los manejadores, permisos y estados de sus módulos. No se duplican los indicadores ni se inventan puntuaciones para los recorridos. Las superficies de edición, cuenta, ajustes y catálogo conservan sus flujos. El adaptador elimina observadores y escuchas al cerrar la aplicación.

La publicación pública incorpora explícitamente la hoja compartida en su lista de archivos permitidos. No incorpora el editor ni acciones de cuenta privadas.

`node tooling/qa/experience-header.cjs` comprueba los artefactos de producción en Chrome con servidor y cuenta temporales: demostración, proyecto original y práctica CEDI-01, desde 320 hasta 2560 px. Revisa el modo activo, los controles del HUD, solapamientos, desbordamiento, menús claros/oscuros y liberación del teclado al cerrarlos. También sustituye una práctica real por un recorrido en la misma página y verifica que no persista la presentación de juego. Guarda capturas y un informe en `data/qa-studio/experience-header/`. No cambia cuentas ni proyectos personales.
