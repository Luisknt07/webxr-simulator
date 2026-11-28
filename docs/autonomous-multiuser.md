# Salas propias de SMART-TWIN

Diseño para diez personas por sala, publicado el 27 de noviembre de 2026.
La aplicación conserva sus equipos industriales, documentos, cuentas y física.
No utiliza EOS, LiveKit Cloud, cuentas sociales ni CDN para las salas.

## Qué aprendimos de otras plataformas

| Plataforma | Cómo conecta a las personas | Qué se aprovecha aquí |
| --- | --- | --- |
| Hubs | Three.js/A-Frame en el navegador; Reticulum/Phoenix para estado; Dialog/mediasoup como SFU para audio y vídeo | Separar presencia, autoridad de objetos y audio; ejecutar los servicios en la institución |
| WorkAdventure | Servicios propios de mundo y usuarios; LiveKit y TURN propios para comunicación grupal | Utilizar un SFU instalado localmente para evitar una malla de conexiones entre diez equipos |
| Vircadia | Estado de entidades en PostgreSQL, API por WebSocket/HTTP e instalación propia | Mantener estado y permisos bajo control de la institución |

Fuentes primarias: [arquitectura de Hubs](https://docs.hubsfoundation.org/system-overview),
[WorkAdventure autoalojado](https://workadventu.re/open-source/),
[Vircadia](https://vircadia.com/).
Mozilla terminó su servicio Hubs el 31 de mayo de 2024; el proyecto pasó a Hubs
Foundation. No se requiere un servicio de Mozilla para este desarrollo.
[Anuncio de Mozilla](https://support.mozilla.org/en-US/kb/end-support-mozilla-hubs).

## Implementación

- Cuentas y salas mediante la API y SQLite existentes. El límite es diez miembros,
  incluido el instructor. Un observador puede hablar, pero no manipular cargas.
- El instructor crea la sala desde un proyecto guardado. Al abrir un ejemplo de
  consulta, se conserva una copia propia antes de crear la sala; requiere cuenta
  creadora y respeta la cuota de proyectos.
- LiveKit Server 1.13.11 de código abierto funciona en el mismo servidor universitario.
  El SDK de navegador 2.25.0 se conserva dentro del artefacto privado con su licencia
  y recibo de integridad; se carga al entrar a la sala y no se descarga de un CDN.
- Cabeza y manos medidas se transmiten a 15 Hz; se interpolan avatares ligeros
  con nombres e indicador de voz. No se modifican las matrices del visor local.
- Voz desactivada inicialmente. La sala usa turnos moderados: una sola persona
  puede publicar micrófono. Los participantes piden la palabra; el anfitrión
  concede o retira el turno y puede silenciar a todos. Conceder el turno nunca
  activa remotamente el micrófono: su dueño debe pulsar para hablar.
- El permiso se aplica en LiveKit mediante `UpdateParticipant`, conservando
  suscripciones y datos de presencia. Antes de conceder un turno se retiran
  los anteriores; los cambios concurrentes se serializan por sala. Los tokens
  de entrada siempre comienzan sin permiso de micrófono y el webhook firmado
  aplica el turno vigente tras entrar. El servidor conserva la política en SQLite.
- La barra inferior de una sesión reúne micrófono, pedir/devolver la palabra,
  escucha, participantes, chat, personalización del avatar y salida. El acceso
  **Sala grupal** permanece arriba; se retira su duplicado lateral.
- Cuatro humanos Rocketbox alojados localmente, con rostro y ropa texturizados,
  esqueleto de 80 huesos y elección libre de apariencia. La sala incluye las
  articulaciones de los dedos y el cuerpo opcional cuando el navegador lo
  expone. El torso y los codos pueden ser estimados; no se inventan pasos con
  la cabeza. Hay modos de cabeza/manos, torso o cuerpo disponible. Véase el
  [análisis de avatares y seguimiento](avatar-design-and-tracking.md).
  El cartel muestra nombre, rol, estado de voz y tipo de seguimiento.
- Poses visuales de vehículos y cargas del instructor se envían a 10 Hz.
  Colas, identidad, masa, custodia y controles conservan la autoridad de los
  eventos autenticados y los estados de Studio. Los datos visuales de un
  participante nunca tienen autoridad sobre el estado industrial.
- Los estados completos existentes siguen siendo el mecanismo de recuperación.
  La simulación continúa en el navegador del instructor: debe permanecer abierto.
  El servidor no ejecuta por sí solo la física industrial ni migra ese reloj
  automáticamente al desconectarse el instructor. Un participante tampoco recibe
  control remoto del puesto de conducción por el mero hecho de entrar a la sala.
- El webhook firmado del servicio local comprueba cada ingreso. Salir o cerrar
  sesión retira al participante; una conexión con un token anterior se comprueba
  otra vez contra la membresía vigente. Las claves privadas no se exportan.

## Instalación universitaria

Se prepara para Linux, Node.js 24, Caddy y LiveKit Server. No exige una GPU en el
servidor para dibujar el mundo: cada navegador renderiza su propia escena.
Las ocho CPU y ocho GB de RAM deben validarse con las salas realmente concurrentes;
las pruebas locales no establecen el rendimiento de la red universitaria ni del visor.

TI debe proporcionar tres nombres DNS, una IP pública o encaminamiento equivalente,
y certificados públicos válidos que cubran los tres nombres. El servicio media
recibe acceso de lectura al certificado y su clave; ninguna clave va al repositorio.
Se pueden usar certificados institucionales existentes, sin depender de una cuenta
de un proveedor de metaversos. Se necesita Internet y DNS para usuarios remotos.

Generar en el servidor, con los nombres y rutas reales:

```sh
node tooling/deploy/university/configure.cjs \
  --app-host simulador.universidad.edu \
  --media-host voz.universidad.edu \
  --turn-host turn.universidad.edu \
  --public-ip 203.0.113.10 \
  --directory /etc/smarttwin \
  --certificate /etc/smarttwin/tls/fullchain.pem \
  --private-key /etc/smarttwin/tls/privkey.pem
```

`203.0.113.10` es una dirección de documentación: sustituirla. El generador crea
`runtime.env`, `livekit.yaml` y `Caddyfile` con secretos aleatorios y no sobrescribe
archivos existentes. La carpeta y archivos deben ser privados del administrador
y los servicios. Copiar la aplicación y sus artefactos a `/opt/smarttwin`, preparar
`/var/lib/smarttwin` para el usuario `smarttwin`, instalar las dependencias fijadas
con `npm ci`, instalar el binario oficial de LiveKit 1.13.11 y verificar su hash.
Las unidades systemd de `tooling/deploy/university` permiten reiniciar ambos servicios
sin intervención. Usar el Caddyfile generado en el servicio Caddy de la institución.
Crear el administrador con la herramienta local documentada en `apps/api/README.md`.
El administrador debe asignar al usuario/grupo `smarttwin` la lectura de los
archivos privados de `/etc/smarttwin` y escritura solo en `/var/lib/smarttwin`.
El usuario de Caddy también necesita lectura del certificado y su clave. Mantener
las copias de seguridad de SQLite y archivos privados dentro de la institución.

Abrir desde Internet HTTPS 443/TCP, ICE 7881/TCP y 7882/UDP, TURN 3478/UDP y
5349/TCP. El puerto de administración 7880 y la API 8081 deben permanecer
bloqueados desde Internet. La API confía únicamente en el proxy local declarado.
El certificado también debe ser válido para `turn.universidad.edu`.

Esta configuración publica TURN/TLS en 5349. Si los participantes están en redes
que solo permiten 443, TI debe proporcionar un segundo IP para TURN/443 o un proxy
de capa 4 con enrutamiento SNI; un proxy HTTP normal no retransmite TURN.
No se soluciona este caso llamando a un TURN público externo.
[Referencia de puertos](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

## Uso

1. Abrir el dominio HTTPS de la universidad e iniciar sesión local.
2. Abrir un escenario y pulsar **Sala grupal** en la cabecera.
   El acceso de la demostración pública abre directamente este panel; si hace
   falta iniciar sesión, conserva el destino al finalizar el acceso.
3. Crear la sala o introducir el código. El enlace de invitación carga el visor
   y permite unirse antes de pedir el proyecto privado compartido.
4. Usar la mano de la barra para pedir la palabra. El anfitrión abre Participantes
   y turnos para concederla. Después, activar el micrófono; volver a pulsarlo
   devuelve el turno. En RV están disponibles los turnos, micrófono, escucha,
   chat y salida dentro del panel de Sala grupal.
5. El instructor conserva abierta la ejecución y comparte los controles admitidos.

GitHub Pages sigue siendo la demostración individual estática. Las salas se abren
en el dominio del servidor de la universidad. Suscripción y coste por minuto de
software: ninguno para esta instalación. Conectividad, equipos, administración,
integración y copias de seguridad siguen siendo recursos de la institución.

## Verificación realizada

La prueba `tooling/qa/autonomous-rooms.cjs` usa dos perfiles independientes de
Chrome con la aplicación compilada y ocho clientes WebRTC adicionales. Verificó
diez participantes en el SFU local, nueve avatares remotos, petición
y concesión del turno desde la interfaz, retirada del micrófono anterior,
recepción RTP de un único hablante y silencio general. También verificó chat
entre navegadores, movimiento visual compartido y expulsión al abandonar la sala. Los micrófonos
eran sintéticos y todas las solicitudes HTTP/WebSocket se dirigían a localhost.
No aparecieron errores de JavaScript ni WebGL. No sustituye la prueba de diez
visores físicos, redes remotas, reconexión prolongada o saturación del servidor.

Las pruebas de API comprueban autenticación, permisos de los tokens, rechazo de
un undécimo miembro y firma de los webhooks. Las pruebas de presentación y
restauración comprueban liberación de recursos, muestras fuera de orden,
reservas de objetos y referencias de los controles nativos entre clientes.

No se ha instalado nada en el servidor universitario desde esta sesión: faltan
acceso, sistema operativo, nombres DNS, IP y configuración de red reales.
