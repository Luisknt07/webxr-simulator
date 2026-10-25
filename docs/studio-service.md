# Cuentas, sesiones y salas de Studio

La API se ejecuta junto al servidor HTTPS de la aplicación. La persistencia usa tablas `studio_*` adicionales en la misma base SQLite; no mueve proyectos, revisiones ni archivos existentes. No necesita un proveedor externo ni utiliza nombres de usuario simulados.

## Autenticación

- `GET /api/studio/me`: cuenta actual, permisos y capacidades reales.
- `POST /api/studio/register`: `{username, password, displayName}`. Usuario de 3–48 caracteres; contraseña de 12–256 caracteres.
- `POST /api/studio/login`: `{username, password}`.
- `POST /api/studio/logout`: `{}`.
- `PUT /api/studio/profile`: campos opcionales `displayName`, `avatar`, `profileImage`, `preferences`.

Las contraseñas usan scrypt y sal aleatoria. El navegador recibe una cookie opaca `HttpOnly`, `SameSite=Strict` y `Secure` cuando la conexión es HTTPS; SQLite conserva solamente su hash. El inicio de sesión rota la cookie anterior. No se guardan credenciales en `localStorage`, proyectos o exportaciones. Registro, acceso y solicitudes de sala tienen límites de frecuencia; las escrituras rechazan orígenes ajenos.

Las solicitudes privadas del cliente incluyen `X-Studio-User` con la identidad que esa ventana espera. Si otra ventana cambió la cookie de cuenta, el servidor devuelve `session_changed` antes de escribir datos en una cuenta diferente. Este encabezado comprueba coherencia; los permisos siempre proceden de la sesión autenticada en el servidor.

La imagen de perfil puede ser nula o una imagen raster ya importada mediante `/api/assets/…`. El avatar 3D es independiente: `{version:1, base:'capsule'|'robot'|'explorer', bodyColor:'#rrggbb', accentColor:'#rrggbb', skinColor:'#rrggbb'}`. Preferencias: `{handedness:'left'|'right', locomotion:'teleport'|'smooth'}`. La API no incluye correo, recuperación de contraseña ni un proveedor de identidad externo; `me.capabilities.recovery` es `false`.

`StudioService.requireEditor(req)` conserva el acceso local anterior mientras no haya cuentas configuradas. Una vez configuradas, exige una cuenta real con rol `creator`; el rol `viewer` no puede modificar proyectos. El servidor integrador debe aplicar este control a las escrituras de proyectos y archivos.

La primera cuenta registrada es la propietaria y creadora. Las cuentas siguientes son observadoras hasta que la propietaria las autorice. Solo esta cuenta puede consultar `GET /api/studio/users` y cambiar permisos con `PUT /api/studio/users/:id/role`, cuerpo `{role:'creator'|'viewer'}`. El permiso de la propia propietaria queda protegido. Estos permisos de autoría son independientes del rol de participante dentro de una sala compartida.

## Proyecto, progreso y ejecución

Son datos distintos:

- La API `/projects` guarda la configuración del editor.
- `GET/PUT /api/studio/progress` guarda el avance individual de una misión, con `projectId`, `missionId`, `missionVersion`, `value` y fecha confirmada por SQLite. GET necesita `?projectId=…`. Cambiar la versión requiere confirmación explícita mediante `replaceVersion:true`.
- `GET/POST /api/studio/checkpoints` lista o crea sesiones reanudables privadas. POST recibe `{version:1, projectId, projectRevision, name, roomId, state}`. `GET/DELETE /checkpoints/:id` recupera o elimina un guardado propio.

Los estados admiten hasta 4 MiB y se conservan los últimos 100 por cuenta. La revisión del proyecto debe coincidir; un cambio posterior marca la sesión como incompatible y devuelve `checkpoint_incompatible`. El progreso educativo procede del evaluador del cliente; este servicio no certifica resultados contra un evaluador independiente.

`captureSimulation(runtime)` de `src/studio/SimulationCheckpoint.js` conserva colas FIFO, identidades de cargas, cargas sueltas, posiciones, decisiones de clasificación, contadores, temporizadores, preparación y procesamiento parcialmente completados, reservas, estibas y modelos originales archivados por un combiner. No incorpora geometría ni texturas en el JSON. Hay que soltar las cargas sostenidas antes de guardar.

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
node scripts/test-studio-service.js
node scripts/test-studio-client.js
node scripts/test-simulation-checkpoint.js
node scripts/test-studio-experience.js
node scripts/test-shared-grabs.js
node scripts/test-remote-presentation.js
```

La primera prueba usa HTTP real y una base SQLite temporal aislada. Las otras prueban el cliente y el simulador con Three.js, incluyendo reutilización de recursos e interacción registrada para XR. La prueba de agarre conecta dos instancias reales del simulador con transporte controlado. Quedan pendientes la prueba con visor físico y la medición de latencia multiusuario entre dispositivos reales.
