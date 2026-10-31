# Validación de proyectos, Content y niveles · 30 de octubre de 2026

Base revisada: `42dc2bf`. Los proyectos privados se conservaron en su almacenamiento existente; las pruebas utilizaron SQLite, carpetas y perfiles de navegador temporales.

Se incorporó un formato independiente con `project.stproject`, Content/Maps, Content/Assets y Config. El editor reconoce paquetes y carpetas, muestra la ubicación autorizada del proyecto, permite organizar niveles y conserva sus identificadores al renombrarlos. La eliminación tiene confirmación, deshacer/rehacer, protección del último nivel y reutilización de espacios eliminados.

Los perfiles de módulos tienen disponibilidad independiente para autor y visitante, selección mixta o especializada y asociación con niveles. El catálogo se genera desde los paquetes locales y difiere su código hasta activarlos. El intercambio de código se realiza mediante `.stmodule`, con inspección, integridad, límites y aceptación explícita; nunca se instala JavaScript porque aparezca una URL en un proyecto.

Un proyecto que declara una función visual puede guardarse en la API sin ejecutar su runtime de navegador en Node. Las funciones que requieren capacidades no instaladas en ese servidor permanecen como datos; no reciben comandos ni permisos implícitos. Los validadores y comandos lógicos compatibles conservan sus controles de autorización.

También se corrigió una pérdida de estado reproducida al normalizar Studio durante un cambio de nivel: perfiles semánticamente idénticos ya no recrean el host con un estado anterior. La prueba registra ocho unidades de cosecha, cambia nombres y asignaciones, exporta y reabre, y comprueba las ocho unidades. Las cargas gráficas pertenecen a una capa de contenido oculta durante transiciones; el renderer y el reloj siguen siendo compartidos.

El estado modular se incorpora antes de comprobar cambios pendientes, guardar localmente, exportar JSON o capturar una pestaña. Las acciones del autor marcan cambios pendientes; las del visitante no alteran el documento del autor. Guardar inmediatamente después de deshacer respeta el estado restaurado y no lo sustituye por el de un host anterior. Las respuestas tardías de otra cuenta o proyecto no se vuelcan en el contexto actual.

Verificaciones:

- **190 pruebas de framework aprobadas**, incluidas las nuevas pruebas de formato, carpetas, descubrimiento, almacenamiento, perfiles, persistencia, UI e intercambio de paquetes.
- **13 programas de regresión del editor y persistencia aprobados**, incluyendo eliminación de niveles, permisos, concurrencia de documentos, importaciones e identidad de guardado.
- Compilación de las aplicaciones y workers aprobada. Manifiestos y recursos de publicación verificados; un solo escenario público.
- Recorrido real en Chrome: creación, ubicación de carpeta, renombrado, importación de una imagen, activación de Agricultura, asignación de módulo a un nivel, exportación, copia independiente con recursos y estado, eliminación con deshacer/rehacer y disponibilidad del visitante. El visitante no pudo modificar la configuración del autor.
- Presentación comprobada visualmente en escritorio y móvil; el panel y su cabecera permanecen dentro de sus límites, sin desplazamiento horizontal ni superposición de la cabecera.
- Recorrido estándar de producción con autenticación, creación, guardado y reapertura de proyectos y niveles.

Bundle de Workspace comprobado:
`cd703cffb668594959e828b277c251208d3b96de27831fc98482140ea21cebc3`.

Los informes locales están en `data/qa-project-content/` y `data/qa-studio/workspace-production/`. No se incluyen en Git ni en el visor público.

SQLite continúa siendo la fuente de verdad. La carpeta del servidor refleja la revisión actual y conserva cambios manuales externos con advertencia; no se reemplaza silenciosamente por un guardado. Los proyectos antiguos sin propietario no reciben una carpeta atribuida a otra cuenta. Los paquetes no contienen el motor ni transfieren cuentas o permisos.

El editor industrial conserva sus diez espacios de nivel y su ciclo de vida de página. Las funciones portables sí tienen gestión independiente; no se declara que todo el editor se pueda desmontar en caliente. Las dependencias de npm pendientes siguen documentadas en la auditoría anterior. Las pruebas de escritorio y RV emulada no certifican el rendimiento físico de Quest 3.
