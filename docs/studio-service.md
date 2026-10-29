# Cuentas, sesiones y salas de Studio

La API se ejecuta en el servidor independiente `apps/api/index.cjs`, sin servidor de desarrollo ni compilador Webpack. Sirve un visor público limitado a `vr-robot-dispatch` y protege el espacio de trabajo y sus recursos mediante sesión. La persistencia usa SQLite y conserva los proyectos, revisiones, cuentas y archivos existentes. La instalación, TLS y configuración de proxy se describen en [apps/api/README.md](../apps/api/README.md).

## Autenticación

- `GET /api/studio/me`: cuenta actual, permisos y capacidades reales.
- `POST /api/studio/register`: `{username, password, displayName, code?}`. Usuario de 3–48 caracteres; contraseña de 12–256 caracteres. Requiere administrador previamente configurado y, por defecto, código de invitación.
- `POST /api/studio/login`: `{username, password}`.
- `POST /api/studio/logout`: `{}`.
- `PUT /api/studio/profile`: campos opcionales `displayName`, `avatar`, `profileImage`, `preferences`.

Las contraseñas usan scrypt y sal aleatoria. En producción, la API exige HTTPS y el navegador recibe una cookie opaca `HttpOnly`, `SameSite=Strict` y `Secure`; SQLite conserva solamente su hash. El inicio de sesión rota la cookie anterior. HTTP solo puede habilitarse de forma explícita en una escucha local de desarrollo. No se guardan credenciales en `localStorage`, proyectos o exportaciones. Registro, acceso y solicitudes de sala tienen límites de frecuencia; las escrituras rechazan orígenes ajenos.

Las solicitudes privadas del cliente incluyen `X-Studio-User` con la identidad que esa ventana espera. Si otra ventana cambió la cookie de cuenta, el servidor devuelve `session_changed` antes de escribir datos en una cuenta diferente. Este encabezado comprueba coherencia; los permisos siempre proceden de la sesión autenticada en el servidor.

La imagen de perfil puede ser nula o una imagen raster ya importada mediante `/api/assets/…`. El avatar 3D es independiente: `{version:1, base:'capsule'|'robot'|'explorer', bodyColor:'#rrggbb', accentColor:'#rrggbb', skinColor:'#rrggbb'}`. Preferencias: `{handedness:'left'|'right', locomotion:'teleport'|'smooth'}`. La API no incluye correo, recuperación de contraseña ni un proveedor de identidad externo; `me.capabilities.recovery` es `false`.

`StudioService.requireEditor(req)` exige una sesión autenticada con rol `creator`, incluso en una base nueva. El rol `viewer` no puede modificar proyectos ni archivos. Antes de crear el administrador local, el registro remoto devuelve `owner_setup_required`; ninguna primera solicitud de registro puede apropiarse de una instalación nueva.

La cuenta administradora se crea únicamente con `node apps/api/admin.cjs bootstrap --username USUARIO`, desde el servidor y sin contraseña en los argumentos. El programa solicita la contraseña de forma oculta y cierra el registro mediante invitación por defecto. Las invitaciones asignan `creator` o `viewer`; si la administradora abre expresamente el registro, el rol de las cuentas sin invitación es `creator`. Solo la administradora puede consultar `GET /api/studio/users` y cambiar permisos con `PUT /api/studio/users/:id/role`, cuerpo `{role:'creator'|'viewer'}`. El permiso de la propia administradora queda protegido. Estos permisos de autoría son independientes del rol de participante dentro de una sala compartida. Las cuentas y sesiones ya existentes se conservan; el bootstrap rechaza una instalación que ya tiene administradora.

## Proyectos del framework modular

La API genérica guarda documentos `smarttwin.project` y su estado modular en `framework_projects`, separados del formato anterior del editor. Todas sus rutas requieren sesión; solo la cuenta propietaria puede acceder al proyecto y solo un `creator` puede escribirlo. Una cuenta ajena recibe `404`, incluso si administra otras cuentas.

| Ruta | Datos o resultado |
| --- | --- |
| `GET /api/framework/projects` | Lista privada de metadatos. |
| `POST /api/framework/projects` | `{name, document, moduleState?}`. Crea revisión 1. |
| `GET /api/framework/projects/:id` | Documento, estado, revisión y `access.canEdit`. |
| `PUT /api/framework/projects/:id` | `{name, document, moduleState?, expectedRevision}`. Omitir `moduleState` conserva el estado anterior. |
| `DELETE /api/framework/projects/:id` | `{expectedRevision}`. Elimina el proyecto propio. |
| `GET /api/framework/projects/:id/commands` | Comandos de las funciones seleccionadas y su política declarada. |
| `POST /api/framework/projects/:id/commands` | `{command, payload?, expectedRevision?}`. La revisión es obligatoria para escrituras. |

Las escrituras usan una transacción SQLite y comparación de revisión; una revisión obsoleta devuelve `409` sin guardar cambios. Documentos, estado y nombres cuentan en la misma cuota que los proyectos anteriores. El documento y el estado admiten en conjunto hasta 16 MiB, sujetos también a validación estructural y a la cuota de la cuenta.

El catálogo se descubre en manifiestos JSON locales de sectores y funciones. Solo se carga implementación local validada de funciones seleccionadas. El JSON del proyecto no instala módulos, ejecuta código, concede permisos ni autoriza archivos importados. Los componentes y estados desconocidos se conservan como datos opacos sin ejecutarlos; los componentes conocidos activos se validan con su esquema.

Un comando de escritura necesita un `server-validator` de la función seleccionada con `validate`, `authorize` y sus permisos declarados en código local confiable. Sin autorizador se rechaza la escritura. Las lecturas necesitan un descriptor local `readOnly:true`; pueden ejecutarlas también las cuentas `viewer` sobre sus propios proyectos. Las lecturas no persisten cambios de estado ni aumentan la revisión. Ningún permiso enviado en el cuerpo del proyecto sustituye estas comprobaciones.

## Proyecto, progreso y ejecución

Son datos distintos:

- La API `/projects` guarda la configuración del editor.
- `GET/PUT /api/studio/progress` guarda el avance individual de una misión, con `projectId`, `missionId`, `missionVersion`, `value` y fecha confirmada por SQLite. GET necesita `?projectId=…`. Cambiar la versión requiere confirmación explícita mediante `replaceVersion:true`.
- `GET/POST /api/studio/checkpoints` lista o crea sesiones reanudables privadas. POST recibe `{version:1, projectId, projectRevision, name, roomId, state}`. `GET/DELETE /checkpoints/:id` recupera o elimina un guardado propio.

Los estados admiten hasta 4 MiB y se conservan los últimos 100 por cuenta. La revisión del proyecto debe coincidir; un cambio posterior marca la sesión como incompatible y devuelve `checkpoint_incompatible`. El progreso educativo procede del evaluador del cliente; este servicio no certifica resultados contra un evaluador independiente.

`captureSimulation(runtime)` de `modules/logistica-industrial/runtime/SimulationCheckpoint.js` conserva colas FIFO, identidades de cargas, cargas sueltas, posiciones, decisiones de clasificación, contadores, temporizadores, preparación y procesamiento parcialmente completados, reservas, estibas y modelos originales archivados por un combiner. No incorpora geometría ni texturas en el JSON. Hay que soltar las cargas sostenidas antes de guardar.

`restoreSimulation(runtime,state)` recrea los productos temporales y sus controladores de interacción reales. `restoreSimulation(runtime,state,{reuse:true})` conserva los objetos y recursos GPU de las cargas que siguen presentes, para actualizar una vista compartida. Detener la simulación después de reanudar restaura la configuración original del editor. La cámara del usuario y otros datos externos al simulador deben añadirse por separado al estado de ejecución de la interfaz.

Solo para una vista compartida de lectura, `captureSimulation(runtime,{allowHeld:true})` incluye la posición actual de una carga sostenida por el anfitrión. Al reproducir el snapshot queda sin autoridad de mando local; no restaura una mano ajena ni su agarre. Los guardados personales deben utilizar la opción predeterminada y pedir que se suelte la carga.

## Transporte de sala compartida

- `POST /api/studio/rooms`: `{projectId, projectRevision, roomId, name, state}`. Devuelve sala y código de invitación.
- `POST /api/studio/rooms/join`: `{code, role:'participant'|'observer'}`.
- `GET /api/studio/rooms/:id?after=N`: participantes, poses, permisos, bloqueos y eventos ordenados.
- `POST /rooms/:id/pose`: `{position:[x,y,z], quaternion:[x,y,z,w]}`; permite `left` y `right` opcionales con el mismo formato.
- `POST /rooms/:id/action`: acción admitida de la lista inferior.
- `PUT /rooms/:id/state`: `{state, expectedRevision, appliedSequence}`; solo el anfitrión.
- `POST /rooms/:id/leave`: `{}`. El anfitrión puede volver a entrar con su código.

Roles: anfitrión, participante y observador. Hasta 16 personas activas por sala. El anfitrión publica el estado autoritativo de la simulación. Los eventos transportan solicitudes; el cliente anfitrión debe validarlas y ejecutarlas en el simulador. La API no simula física en Node ni permite edición colaborativa de proyectos.

Acciones:

| Tipo | Datos | Regla |
| --- | --- | --- |
| `control` | `objectId`, `action`, `value` y `scope` opcionales | Anfitrión o participante; el anfitrión valida el mando concreto. Ámbitos: `module`, `segment`, `line`. |
| `grab` | `objectId` | Reserva exclusiva durante 6 segundos. |
| `pose-object` | `objectId`, `pose` | Requiere la reserva y renueva su duración. |
| `release` | `objectId`, `pose` opcional | Libera una reserva propia; el anfitrión también puede cancelar una reserva inválida. |
| `simulation` | `action:start/pause/resume/reset` | Solo anfitrión. |

Una colisión de reservas devuelve `object_locked`. La presencia caduca tras 45 segundos sin actividad; las reservas caducan y también se liberan al salir o cambiar a observador. El transporte permite sincronizar agarres cuando el cliente los conecta; tener estas rutas no demuestra que una interfaz determinada ya sincronice sus mandos XR.

Al recibir `needsSnapshot:true`, restaurar `state` y después aplicar `events`, que comienzan después de `stateSequence`. Solo entonces avanzar al cursor `sequence`. Al guardar, `appliedSequence` debe ser el último evento que el anfitrión **ya aplicó**, no simplemente el último recibido por el servidor. Esto evita perder acciones durante la entrada tardía. Los últimos 1000 eventos se conservan; si el checkpoint quedó demasiado antiguo, la sala exige una actualización del anfitrión mediante `room_snapshot_stale`.

`StudioRoomConnection` en `StudioClient.js` implementa consulta periódica, cursores, actualización de poses, cola ordenada de acciones, reconexión ante fallos transitorios y recuperación de snapshots. No guarda cookies en JavaScript.

`SharedGrabs` conecta las reservas con el agarre real del simulador. Ratón y mandos pasan por la misma función de recogida. Un participante solicita la reserva y manipula una vista previa local; el anfitrión mantiene la carga física y comprueba alcance, disponibilidad, obstáculos y colisiones antes de aceptar movimiento o depósito. La orientación de la carga se conserva. Las actualizaciones de snapshots del participante se aplazan mientras sostiene una carga y se recuperan al soltarla. La salida de una persona o el vencimiento de su reserva libera las manos temporales. Es una interacción de simulación compartida, sin edición simultánea del proyecto.

## Pruebas

Ejecutar:

```powershell
node tests/legacy/test-api-production.js
node --test tests/framework/framework-api.test.mjs
node tests/legacy/test-studio-service.js
node tests/legacy/test-studio-client.js
node tests/legacy/test-simulation-checkpoint.js
node tests/legacy/test-studio-experience.js
node tests/legacy/test-shared-grabs.js
node tests/legacy/test-remote-presentation.js
```

Las pruebas del servidor usan HTTP y SQLite temporales aislados para comprobar transporte seguro, bootstrap cerrado, aislamiento entre cuentas, cuotas, revisiones y políticas de comandos. Las pruebas del cliente y del simulador usan Three.js, incluyendo reutilización de recursos e interacción registrada para XR. La prueba de agarre conecta dos instancias reales del simulador con transporte controlado. Quedan pendientes la prueba con visor físico y la medición de latencia multiusuario entre dispositivos reales.
