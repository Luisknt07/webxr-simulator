# Proyectos, escenas y acceso de HELLO / STUDIO

El servidor mantiene los proyectos en SQLite y los archivos binarios en el directorio de datos. El navegador recibe únicamente los proyectos autorizados y las salas publicadas. Una URL de proyecto no concede acceso por sí sola.

## Primer acceso y migración

- En una instalación sin cuentas, configura el superadministrador con `npm.cmd run admin:init -- bootstrap --username administrador`. El perfil de producción rechaza el registro remoto hasta completar este paso; no habilita edición anónima. Consulta [la guía del servidor](../apps/api/README.md).
- En una instalación con cuentas anteriores, se conserva como superadministrador la cuenta local original. Las nuevas cuentas normales reciben permiso de creador; una invitación puede asignar permiso de explorador (`viewer`).
- Los proyectos anteriores sin propietario permanecen intactos y accesibles únicamente al superadministrador. La migración no los asigna automáticamente a una persona ni borra sus revisiones o archivos.
- Las cuentas existentes reciben un período inicial de gracia de 30 días para la política de inactividad.
- La migración añade tablas. No duplica los proyectos anteriores ni reescribe su contenido.

Las contraseñas se verifican mediante scrypt con sal individual. La sesión usa una cookie HttpOnly del mismo origen; los tokens se guardan como verificadores hash. Las respuestas de usuarios e informes excluyen contraseñas, sales y tokens. Esta versión no incluye recuperación por correo.

## Proyectos privados y cuotas

Cada cuenta normal comienza con **dos proyectos propios y 20 MiB**. El superadministrador puede ampliar ambos límites desde Usuarios y cuotas. Los proyectos compartidos de otras personas no aumentan el contador de proyectos propios.

El espacio contabiliza archivos importados, documentos de todas las revisiones, progreso, sesiones guardadas, datos de simulación, estados y eventos de salas alojadas y datos del perfil. Por ello, guardar repetidamente un documento grande puede aumentar el uso aunque no se importen modelos nuevos. El límite se comprueba en el servidor; una operación que supera la cuota no crea una revisión parcial.

Los binarios se deduplican por hash en el almacén global. Una cuenta que conserva su propia referencia autorizada a un binario recibe el cargo de ese archivo en su cuota. En `data/users/<id>/` se materializan metadatos de proyectos y referencias físicas a sus binarios: enlaces duros cuando el volumen los admite, con copia como alternativa. SQLite sigue siendo la fuente de verdad; no se replica el historial completo en esas carpetas.

El superadministrador puede consultar todos los proyectos y gestionar las cuotas. Los proyectos heredados y los ejemplos del sistema no se convierten en archivos de una cuenta normal durante la migración.

## Compartir y editar

Desde Compartir se introduce el nombre exacto de una cuenta de Studio y se elige:

| Permiso | Comportamiento |
| --- | --- |
| Visualizar (`viewer`) | Abrir el proyecto y sus archivos autorizados; ejecutar su simulación. |
| Editar (`editor`) | Además, guardar cambios en el mismo proyecto si la cuenta tiene permiso global de creador. |
| Propietario | Compartir, retirar permisos y eliminar su proyecto. |
| Superadministrador | Acceder y administrar todos los proyectos. |

Los cambios de un colaborador consumen la cuota del propietario del proyecto. El propietario o el superadministrador puede retirar el permiso. Los recursos privados usan respuestas `private, no-store`; conocer el hash de un archivo no autoriza su descarga.

La edición compartida usa **revisiones y control de concurrencia al guardar**. Si dos personas parten de la revisión 3, el primer guardado crea la 4; el segundo recibe un conflicto 409 y debe abrir la versión actual o guardar una copia para conservar su trabajo. No se mezclan silenciosamente cambios concurrentes ni se promete edición simultánea de geometría en tiempo real.

Las salas multiusuario de simulación son una función distinta: el código de sala concede consulta temporal del proyecto durante la participación activa. Salir de la sala retira ese acceso temporal; no crea un permiso permanente de edición.

Las pestañas de proyectos conservan espacios de trabajo del navegador para la misma cuenta. Únicamente el documento activo se incorpora al render y a la simulación. Cambiar de cuenta invalida esas pestañas y el portapapeles de objetos.

## Escenas públicas y biblioteca

En modo normal se muestran hasta **dos escenas públicas activas**, configurables por el superadministrador. Inicialmente son Transferencia rectangular a 90° e Inspección y clasificación. Temporalmente está activada la vista previa de **todos los ejemplos incluidos** del sistema: las plantillas registradas, el laboratorio completo y diez experiencias originales. Las cantidades se calculan desde el catálogo, incluyendo nuevas prácticas de vehículos. Cada ejemplo es una proyección independiente de sólo lectura; no se consulta ni se publica el contenido privado de ninguna cuenta. El catálogo no carga todas las salas en el navegador.

Administración → Escenas públicas permite desactivar la vista previa y recuperar la selección normal de dos salas sin borrarla. La API y las descargas directas de proyecciones adicionales exigen entonces una cuenta. Los proyectos de usuarios mantienen siempre sus permisos anteriores. La reversión de GitHub Pages requiere regenerar y desplegar la publicación estática; véase `docs/public-publication.md`.

Fuera de la vista previa, el catálogo completo requiere una cuenta. Sus entradas son documentos de consulta independientes; para modificarlas se crea una variante propia. Crear desde plantilla copia una configuración inicial al proyecto del usuario y queda sujeto a su cuota. Crear vacío produce un entorno inicial configurable sin copiar una línea de ejemplo.

Publicar una sala con modelos importados requiere seleccionar los recursos que necesita. Un proyecto con publicación activa debe despublicarse antes de eliminarse. El bloqueo de archivos JSON de ejemplos sin sesión complementa las rutas públicas; no constituye un mecanismo de DRM para el código o los modelos incluidos en el paquete web.

## Códigos y docencia

El superadministrador dispone de dos mecanismos diferentes:

- **Crear usuario con código de acceso:** crea una cuenta y devuelve una credencial aleatoria para iniciar sesión con su nombre de usuario. La credencial completa aparece únicamente en esa respuesta; el servidor conserva su verificador scrypt.
- **Código de registro:** permite registrar cuentas nuevas con el rol y grupo definidos. Tiene máximo de usos, fecha de vencimiento y opción de revocación. El código completo aparece sólo al generarlo; la lista posterior muestra una pista y su uso. Puede activarse la política que exige código para cualquier registro nuevo.

Los grupos reúnen participantes y prácticas con instrucciones, plantilla de referencia, proyecto opcional y vencimiento. Asignar una práctica que referencia un proyecto privado no lo comparte automáticamente: se conceden los permisos de proyecto por separado.

Cada alumno consulta sus grupos, prácticas y evaluaciones propias. El superadministrador consulta los recursos y avances de los participantes y puede registrar una calificación de 0 a 100 con comentarios. Los informes presentan proyectos, misiones registradas, porcentaje completado, sesiones guardadas y evaluaciones; el avance de la aplicación y la calificación docente son datos diferentes. Los informes se pueden descargar como JSON desde la consola.

## Inactividad y conservación

La política examina las cuentas normales con más de 30 días sin actividad y cuyo período de gracia también haya terminado. La revisión automática se programa para el futuro, cada hora; iniciar el servidor no ejecuta una purga inmediata.

Su alcance actual son los proyectos y recursos del editor SmartTwin. Los proyectos genéricos creados mediante la API del framework modular no se incluyen en esta limpieza automática, aunque sí cuentan para las cuotas de almacenamiento. Esta distinción no cambia la política ni elimina datos adicionales.

Se protegen:

- La cuenta superadministradora y los proyectos anteriores sin propietario.
- Los proyectos publicados.
- Los propietarios cuyos proyectos tienen colaboradores activos dentro del período de 30 días.
- Las salas con otros participantes activos; su anfitrión no se limpia mientras se usan.

Para una cuenta elegible se eliminan sus proyectos del editor y sus revisiones, archivos propios que dejan de estar referenciados, progreso, sesiones guardadas y salas alojadas inactivas. También se revocan sus sesiones de acceso. Se conserva la cuenta, su pertenencia a grupos y las evaluaciones docentes. Una práctica que apuntaba a un proyecto eliminado conserva sus instrucciones y notas, con la referencia de proyecto vacía.

Un binario todavía referenciado por otro proyecto o perfil no se elimina del almacén global. La limpieza valida que las rutas pertenezcan al espacio de usuarios antes de quitar carpetas. Existe un modo de inspección `maintenance({dryRun:true})` que informa candidatos sin borrar datos y un registro de las limpiezas efectuadas. Las pruebas usan exclusivamente bases temporales.

## Asistente para construir escenarios

La guía de escenarios interpreta parámetros compatibles con el catálogo integrado: cantidad y tipo de transportadores, disposición, productos, monitores y flujos admitidos. Puede sugerir una configuración y crear una variante de equipos ya disponibles. La ruta paramétrica funciona sin descargar un modelo lingüístico.

Esta guía **no es un LLM conversacional de propósito general**. Las instrucciones fuera de las configuraciones soportadas requieren aclarar o ajustar parámetros. La simulación y sus reglas de clasificación siguen siendo funciones deterministas del proyecto; no dependen de una respuesta generativa para operar.

## Rutas principales

| Ruta | Acceso |
| --- | --- |
| `GET /api/public/scenes` y `/:id` | Público, máximo dos salas activas. |
| `GET /api/library/scenes` y `/:id` | Cuenta autenticada; ejemplos de consulta. |
| `/api/projects` y `/:id` | Cuenta y permisos de proyecto. |
| `/api/projects/:id/shares` | Propietario o superadministrador. |
| `/api/assets/:hash` | Archivo propio, compartido autorizado o publicado. |
| `/api/publication/scenes` | Superadministrador. |
| `/api/studio/admin/*` | Superadministrador. |
| `GET /api/studio/classroom` | Grupos y evaluaciones de la cuenta actual. |

Verificación reproducible: `node tests/legacy/test-project-access.js`, `node tests/legacy/test-project-access-view.js`, `node tests/legacy/test-project-save-identity.js`, `node tests/legacy/test-studio-administration.js`, `node tests/legacy/test-project-client.js`, `node tests/legacy/test-sqlite-storage.js` y `node tests/legacy/test-studio-service.js`.
