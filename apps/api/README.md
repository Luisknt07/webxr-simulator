# Servidor privado de SmartTwin

Requiere Node.js 24 o posterior. `node apps/api/index.cjs` inicia la API independiente y sirve los artefactos verificados de `artifacts/public-viewer` y `artifacts/workspace`. No inicia Webpack ni expone el directorio del repositorio. Cada artefacto necesita su `publication.json` con la lista de archivos y sus SHA-256.

El visor `/` es público y contiene únicamente `vr-robot-dispatch`. `/login` es público; `/editor`, `/workspace/*`, proyectos privados, catálogo completo e importaciones requieren sesión. Una entrada privada sin sesión redirige al login; un recurso privado sin sesión responde `401`. Una operación autenticada sin permiso responde `403`, y los proyectos genéricos de otra cuenta responden `404`.

## Administrador y datos existentes

Ejecutar una sola vez desde la raíz del repositorio, en el servidor:

```powershell
node apps/api/admin.cjs bootstrap --username administrador --display-name "Administrador"
```

La contraseña se solicita de forma oculta; no se acepta como argumento. Para automatización se admite entrada estándar o `SMARTTWIN_BOOTSTRAP_PASSWORD`, que se elimina del entorno del proceso inmediatamente después de leerse. No guardar contraseñas en scripts, archivos del repositorio ni historial de comandos.

El bootstrap crea la cuenta administradora con rol `creator` y habilita registro por invitación. Sin este paso, el registro HTTP devuelve `503 owner_setup_required`; el primer visitante no puede convertirse en administrador. Las invitaciones se gestionan mediante `/api/studio/admin/codes` y pueden asignar `creator` o `viewer`. La política se consulta o cambia en `/api/studio/admin/policy`. `--open-registration` es una opción local explícita para abrir el registro; las altas sin código reciben rol `creator`.

Los datos usan por defecto `data/` en la raíz. `SMARTTWIN_DATA_DIR` o `--data-dir` permiten elegir otra ubicación. Usar la misma ubicación en el bootstrap y en el servidor. Las tablas nuevas son aditivas: se conservan usuarios, sesiones, proyectos y archivos anteriores. El bootstrap rechaza una instalación con administrador ya configurado.

## HTTPS y arranque

Configuración de TLS directo en PowerShell; las rutas son ejemplos que deben apuntar a un certificado y clave existentes:

```powershell
$env:SMARTTWIN_TLS_KEY = 'C:\certificados\smarttwin.key'
$env:SMARTTWIN_TLS_CERT = 'C:\certificados\smarttwin.crt'
$env:SMARTTWIN_API_HOST = '127.0.0.1'
$env:SMARTTWIN_API_PORT = '8081'
$env:SMARTTWIN_DATA_DIR = 'C:\SmartTwin\data'
node apps/api/index.cjs
```

Configurar `SMARTTWIN_DATA_DIR` también antes del bootstrap si se cambia el directorio predeterminado. Las cookies de producción son `Secure`, `HttpOnly` y `SameSite=Strict`; una petición HTTP a la API o al espacio privado devuelve `426` antes de modificar datos.

Como alternativa, un proxy HTTPS puede terminar TLS y reenviar a una escucha privada. Declarar sus direcciones IP exactas en `SMARTTWIN_TRUSTED_PROXY_ADDRESSES`, separadas por comas, y mantener el puerto de origen inaccesible a clientes externos. El proxy debe sobrescribir `X-Forwarded-Proto` con `https` y `X-Forwarded-For` con una sola IP válida del cliente. Los encabezados de un emisor no confiable se ignoran; no se aceptan rangos ni confianza global en proxies.

Solo para desarrollo local sin TLS:

```powershell
$env:SMARTTWIN_ALLOW_INSECURE_LOCAL = 'true'
$env:SMARTTWIN_API_HOST = '127.0.0.1'
node apps/api/index.cjs
```

Esta excepción requiere escucha local explícita y no configura cookies `Secure`. No se habilita automáticamente. `SMARTTWIN_PUBLIC_DIR` y `SMARTTWIN_WORKSPACE_DIR` pueden seleccionar artefactos alternativos; nunca deben apuntar al repositorio completo ni a un directorio de datos privados. La política pública sigue exigiendo un solo escenario en el manifiesto del visor.

## API modular

`/api/framework/projects` conserva documentos `smarttwin.project` y su estado de funciones en SQLite, sin convertir ni sustituir los documentos del editor anterior. Requiere sesión y aplica propiedad por cuenta, rol, cuota conjunta y revisiones optimistas:

- `GET` lista metadatos propios; `POST` crea con `{name, document, moduleState?}`.
- `GET /:id` recupera documento y estado. `PUT /:id` guarda con `{name, document, moduleState?, expectedRevision}`. Omitir el estado conserva el anterior.
- `DELETE /:id` recibe `{expectedRevision}`.
- `GET /:id/commands` describe las acciones seleccionadas. `POST /:id/commands` recibe `{command, payload?, expectedRevision?}`; las escrituras requieren revisión y autorización local de servidor.

Una revisión obsoleta devuelve `409`; la transacción no guarda cambios parciales. `viewer` puede leer sus proyectos y comandos declarados de lectura, pero recibe `access.canEdit:false` y no puede escribir. Los campos, componentes y estados desconocidos se preservan como datos opacos; no conceden acceso a recursos ni activan código.

El servidor descubre sectores desde `modules/*/manifest.json` y paquetes desde `functions/*/function-manifest.json`, con rutas locales verificadas y sin enlaces simbólicos. Instalar un paquete es una acción del administrador del servidor; ningún JSON recibido por HTTP instala código ni carga URLs. Las funciones nuevas se pueden seleccionar sin añadir una lista manual de sectores al backend. Descubrir una función no la activa automáticamente en proyectos existentes.

Los comandos se ejecutan mediante `host.dispatch` del núcleo. Una lectura necesita descriptor local `{readOnly:true, validate, execute}`. Una escritura necesita un registro `server-validators` de la misma función con `validate`, `authorize` y `permissions` declaradas en código local confiable. Sin política de autorización se deniega la escritura. Las declaraciones de permisos o URLs incluidas en el proyecto no son autoridad del servidor. El almacenamiento modular representa datos lógicos; no valida cargas físicas ni certifica capacidades de equipos.

## Verificación

Desde la raíz:

```powershell
node tests/legacy/test-api-production.js
node --test tests/framework/framework-api.test.mjs
```

Estas pruebas usan servidores y bases de datos temporales. Comprueban bootstrap local, transporte, sesión, artefactos privados, propiedad, permisos, cuotas, persistencia, revisiones y descubrimiento de funciones sin modificar datos de producción. El detalle de sesiones, progreso y salas está en [docs/studio-service.md](../../docs/studio-service.md).
