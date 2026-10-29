# Seguridad y despliegue del framework

El perfil público contiene un escenario de solo lectura. El editor, el catálogo adicional, los proyectos y la administración requieren sesión y permisos comprobados por el servidor. El código público y el historial del repositorio pueden inspeccionarse; esta arquitectura protege los datos privados mediante autorización, no mediante ofuscación.

## Fronteras implementadas

- `apps/api/index.cjs` sirve únicamente archivos de artefactos incluidos en sus manifiestos y verifica sus hashes. No publica carpetas del repositorio, bases de datos, `.env`, pruebas ni source maps. Rechaza rutas fuera de la distribución y enlaces simbólicos.
- `/editor` y `/workspace/` requieren sesión. Sus bundles y recursos también requieren sesión; una cuenta observadora no obtiene permiso de escritura por cargar la interfaz. La API verifica autorización en cada operación.
- El catálogo anónimo contiene `vr-robot-dispatch`. El catálogo completo requiere autenticación. La proyección pública elimina imports y metadatos globales privados; el verificador de Pages rechaza archivos adicionales y campos globales desconocidos.
- El alta del propietario se hace localmente con `node apps/api/admin.cjs bootstrap --username USUARIO`. Una petición remota no puede apropiarse del primer administrador de una base vacía. La CLI no acepta la contraseña como argumento de proceso; usa solicitud oculta, entrada estándar o una variable efímera.
- Las sesiones usan cookies opacas `HttpOnly`, `SameSite=Strict` y `Secure` en el perfil de producción. Las contraseñas usan scrypt y sal aleatoria. Los límites de acceso, comprobaciones de origen y autorización se ejecutan en el servidor.
- El servidor exige TLS o un proxy HTTPS declarado por IP exacta. No confía en encabezados reenviados de cualquier cliente. El modo HTTP local se habilita explícitamente y solo permite escucha en loopback.
- Los documentos genéricos tienen almacenamiento propio y revisiones optimistas. No ejecutan código recibido, no conceden permisos mediante JSON y no habilitan automáticamente funciones desconocidas. Los permisos de comandos se obtienen de las implementaciones locales confiables.
- Discovery y copia aceptan paquetes locales con rutas y archivos declarados. Rechazan enlaces, escapes de directorio, versiones incompatibles y proveedores duplicados. Las funciones siguen siendo código confiable del desarrollador: no son un sandbox para plugins hostiles.

## Operación

Conserva `data/` fuera del directorio web. Incluye la base SQLite y los archivos asociados en una copia de seguridad consistente antes de actualizar. Usa el mismo `SMARTTWIN_DATA_DIR` para la CLI de administración y el servidor. Las migraciones son aditivas y no convierten documentos industriales antiguos en documentos genéricos.

No incluyas claves, certificados privados, tokens ni datos reales en `projects/`, `modules/`, modelos o recursos exportables. `.gitignore` excluye datos locales, variables de entorno, claves, bases y salidas temporales. Un archivo ya publicado o presente en el historial no se vuelve secreto al moverlo.

GitHub Pages aloja solo el visor estático. Para edición real hay que desplegar la API en un servidor HTTPS y configurar la URL privada en `apps/public-viewer/config.js` antes de empaquetar. Este repositorio no aporta un alojamiento privado ni un proveedor externo de identidad. Consulta [la guía del servidor](../apps/api/README.md).

## Riesgos conocidos y alcance de las pruebas

El árbol de dependencias heredado conserva Webpack 4 y Three.js r112 por compatibilidad. La auditoría de dependencias previa a esta reorganización registró **71 avisos: 13 críticos, 43 altos, 10 moderados y 5 bajos**. No se han resuelto todos con esta migración. El servidor de desarrollo heredado no se expone como servidor de producción. La actualización de esos componentes requiere una migración y validación específicas; no corresponde afirmar que el sistema está libre de vulnerabilidades.

Las funciones nuevas tienen pruebas de contratos, permisos, composición, copia y limpieza. El navegador se verifica con servidores y cuentas temporales, incluidos HTTPS, cookies, acceso anónimo, guardado, reapertura y restauración de WebGL. Estas pruebas no sustituyen una auditoría externa de seguridad ni una prueba física de Quest 3.

El Workspace conserva un adaptador de compatibilidad con ciclo de vida de página. Bloquea su retirada y pausa completas a través del SDK porque aún mantiene UI, listeners y recursos propios. Sus funciones industriales se conservan; su aislamiento interno completo requiere trabajo adicional. Los sectores nuevos son funciones iniciales, no aplicaciones completas de cada industria.
