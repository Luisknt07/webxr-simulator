# Avatares humanos y seguimiento en SMART-TWIN

Revisión del 27 de noviembre de 2026. El aspecto humano y la fidelidad del movimiento son problemas distintos: una cara realista no añade sensores al visor. Tampoco basta con añadir piernas a un modelo para conocer la posición real de los pies.

## Cómo lo maneja Meta

Meta combina un avatar personalizable, un esqueleto articulado y una solución de animación que recibe las entradas disponibles. Recomienda priorizar la precisión de la entrada en primera persona y la naturalidad de la animación en tercera persona. Eso permite una representación social convincente, pero no significa que todos los huesos se midan físicamente. Su guía también recomienda elección representativa, alternativas cuando se pierde seguimiento y evitar asignar una apariencia que el usuario no eligió. El SDK de avatares figura actualmente en fin de incorporación de funciones, con 40.0.1 como última versión funcional; no es un componente JavaScript intercambiable con Three.js. [Guía oficial de Meta Avatars](https://developers.meta.com/vr/documentation/unity/meta-avatars-best-practices/).

Los Hologram fotorealistas anunciados en Connect 2026 son otra tecnología: reconstruyen la apariencia a partir de captura con teléfono y se anunciaron para Meta VR Glasses en primavera de 2027. No constituyen un servicio de avatar WebXR disponible para incorporar directamente a esta instalación con Quest 3. [Anuncio oficial de Connect 2026](https://www.meta.com/blog/meta-connect-2026-everything-we-announced/).

La documentación de Horizon OS distingue datos más fiables en la parte superior del cuerpo y estimación de piernas y pies. Quest 3 y 3S no tienen hardware de seguimiento ocular. [Capacidades de los dispositivos](https://developers.meta.com/vr/essentials/horizon-os-immersive-features/). Quest 3 tampoco tiene cámaras interiores para capturar expresiones: el seguimiento facial que describe Movement para estos equipos estima movimiento a partir del audio. Esa capacidad de un SDK nativo no implica disponibilidad de captura facial en el navegador. [Movement SDK](https://developers.meta.com/vr/documentation/unity/move-overview/).

## Qué se puede reproducir en este proyecto

| Entrada | Qué se representa | Límite |
| --- | --- | --- |
| Pose del visor | Posición y orientación de la cabeza | No mide por sí sola la orientación del pecho o la cadera |
| Mandos | Pose de la mano y dedos animados según los controles | No son articulaciones de dedos medidas |
| WebXR Hand Input | Las 25 articulaciones de cada mano que ya usa la piel local | Oclusión, pérdida de datos y latencia de la conexión |
| WebXR Body Tracking opcional | Cadera, columna, hombros, codos y piernas disponibles en el dispositivo | Es experimental y puede incluir articulaciones emuladas |
| Escritorio o móvil | Posición y mirada del participante con una postura representada | El teclado y el ratón no capturan el cuerpo físico |

WebXR Hand Input define las articulaciones de la mano, no un avatar completo. [Especificación](https://www.w3.org/TR/webxr-hand-input-1/). El borrador de Body Tracking define `XRFrame.body`, 83 articulaciones y la emulación de articulaciones no soportadas. Por eso disponer de un objeto `body` no prueba seguimiento físico completo. La integración comprueba su presencia en cada fotograma; conserva la indicación `emulatedPosition` cuando existe y marca como desconocido cuando no existe. [Borrador de Body Tracking](https://immersive-web.github.io/body-tracking/).

La implementación de referencia reciente de Babylon consulta esos espacios con `getPose`/`fillPoses`. Aquí se implementa un adaptador propio pequeño, sin añadir Babylon al simulador. [Código oficial de Babylon](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/XR/features/WebXRBodyTracking.pure.ts).

## Decisión de diseño

Se retiran los personajes construidos con esferas y cilindros. Se incluyen cuatro humanos de Microsoft Rocketbox, con proporciones anatómicas, rostro, cabello, ropa texturizada y el esqueleto original de 80 huesos. La biblioteca ofrece modelos con distintas presentaciones; este catálogo inicial contiene dos de presentación femenina y dos masculina, intercalados. Son cuatro apariencias, no una representación exhaustiva de identidades, edades o cuerpos. La elección es libre y no se deduce del nombre, rol ni cuenta. Los perfiles antiguos conservan su compatibilidad de API, pero no vuelven a dibujar el muñeco anterior: muestran la identidad hasta que la persona elige su apariencia.

La biblioteca oficial usa licencia MIT. Los archivos revisados se conservan en el servidor del proyecto; se incluyen licencia, revisión de origen y SHA-256 de cada entrada y GLB. No se necesita una cuenta de Microsoft, Meta, Ready Player Me ni un servicio de generación de avatares. [Repositorio y licencia oficiales](https://github.com/microsoft/Microsoft-Rocketbox).

La personalización disponible permite escoger el humano, ver de cerca su rostro, girarlo, examinar el cuerpo y elegir el modo de representación y el color de identificación. El nombre visible sigue siendo editable. No se solicita una foto. El rostro no se anuncia como una reconstrucción biométrica del usuario: para eso haría falta añadir y validar un proceso de captura, modelado y consentimiento. No se ha añadido un generador facial, un editor independiente de cabello ni importación libre de archivos externos.

Se ofrecen tres modos:

1. **Torso y brazos adaptados:** recomendado para presencia social. El torso sigue la orientación de la cabeza cuando falta cuerpo; los codos usan una solución geométrica. Si hay datos corporales válidos se usan sus posiciones. Las manos conservan su objetivo medido. No se alargan los brazos para alcanzar objetivos imposibles.
2. **Cabeza y manos:** evita dibujar torso, brazos o piernas estimados. Es apropiado para comprobar fidelidad de entrada o cuando los usuarios prefieran no mostrar un cuerpo aproximado.
3. **Cuerpo completo cuando haya datos:** muestra piernas en RV cuando llegan articulaciones corporales válidas; sin ellas las oculta. Los datos del dispositivo pueden ser emulados. En escritorio el modelo tiene una postura de representación, sin afirmar captura corporal.

Se elimina el ciclo de caminar que se inventaba a partir del desplazamiento de la cabeza. La postura de los dedos se envía a la sala, no solo el punto de agarre. La captura de manos funciona también sin `gripSpace`. Al faltar una mano en la muestra se retira su representación anterior. El modelo se oculta cuando el visor comunica inactividad o pasan 2,5 segundos sin actualizaciones de presencia. La recuperación por HTTP todavía puede conservar la última pose hasta que expire la presencia del participante; no es un diagnóstico de conectividad instantáneo. El cartel diferencia RV, manos medidas, mandos y cuerpo estimado. El sistema no añade captura visual de rostro ni ojos, ni simula sincronización labial como si estuviera medida.

## Rendimiento y autonomía

Los humanos tienen entre 7.456 y 9.284 triángulos y entre 2,28 y 2,64 MiB por GLB. La cara usa textura de 1024 px, y cuerpo/cabello 512 px. Los archivos incluyen todas las texturas, sin peticiones externas. Se cargan al necesitarlos. Los participantes comparten geometrías y texturas, y cada uno tiene su propio esqueleto clonado correctamente. Al liberar la última instancia se retiran los recursos compartidos tras una espera corta que evita recargas al cambiar de vista.

La actualización de huesos remotos reduce frecuencia con la distancia; a más de 20 m se conserva el cartel. Las manos reutilizan matrices y el modelo no crea cuerpos de física ni colisionadores. Las poses se envían aproximadamente a 15 Hz, cuantizadas a cuatro decimales, con validación de tamaño, orientación, número de articulaciones y pertenencia a la sala. Los datos de cuerpo y dedos son efímeros; no se guardan como grabaciones corporales en SQLite.

No es posible garantizar una réplica exacta de cabeza, torso, piernas, cara y manos con el hardware y las entradas disponibles. Además intervienen la calibración del visor, la pérdida de seguimiento, las proporciones del modelo y el retardo de red. La apariencia más realista debe acompañarse de una indicación honesta de estas limitaciones.

## Validación

Pasaron 23 pruebas de presencia, seguimiento, servidor de medios y despliegue, además de 12 de interacción y poses de mano. También pasaron las comprobaciones de API de producción, perfiles, experiencia y menú inmersivo. Comprueban los GLB reales, huesos, pesos, licencias, hashes, manos en un rig desplazado/girado, rechazo de articulaciones inválidas, objetivos inmutables durante actualizaciones repetidas y retirada de seguimiento perdido.

La revisión visual en Chrome verificó los cuatro rostros y el guardado del perfil. La prueba final de sala utilizó diez conexiones al SFU local, nueve humanos remotos y 108 mallas, incluidos 16 modelos de mano con articulaciones recibidas por los canales de datos. Conservó voz moderada, chat, salida y revocación, sin errores de JavaScript o WebGL y sin peticiones a servicios externos. Un intento del acceso público en paralelo excedió el tiempo de espera; la comprobación aislada pasó y se reforzó su espera de inicialización antes de pulsar el botón. Los informes quedan en `data/qa-studio/room-access/report.json` y `data/qa-studio/autonomous-rooms/report.json`.

No se ha validado este cambio con un Quest 3 físico. Antes de usarlo en clase hay que comprobar el navegador concreto y sus permisos, probar ambas manos, oclusión, giro/agachado, montacargas, latencia y sesiones prolongadas con diez dispositivos. La prueba con fotogramas controlados no sustituye esa revisión.
