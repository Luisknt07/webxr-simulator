# Controles de realidad virtual

El visor público y el editor comparten teletransporte, puntero y representación local de mandos. La entrada en RV se realiza desde el botón VR del navegador; los controles táctiles y de escritorio conservan sus propias entradas.

## Caminar y señalar

| Control de Quest Touch | Acción |
| --- | --- |
| Stick izquierdo | Desplazarse |
| Stick derecho hacia un lado | Girar por pasos |
| Apuntar al suelo y mantener el gatillo; soltar para confirmar | Teletransporte original |
| Gatillo sobre un botón | Pulsar el botón situado exactamente bajo la retícula |
| X o A, fuera del vehículo | Abrir o cerrar el menú de RV |

El teletransporte usa el puntero original y sólo permite superficies de suelo autorizadas con espacio libre para el usuario. Se mueve el rig, conservando la pose local y la altura del visor. Conducción, menús y pérdida de seguimiento cancelan un teletransporte en curso. El arco con stick queda disponible únicamente si la aplicación activa `ctx.xrTeleportArc = true`.

La retícula corresponde al punto real de impacto y el rayo llega hasta él. Un botón no activa a otro por pertenecer a la misma máquina. Al agarrar una pieza de la cabina se oculta el rayo de esa mano; la mano libre sigue disponible para señalar.

## Montacargas

| Control | Acción |
| --- | --- |
| Agarre lateral mantenido junto al aro | Sujetar el volante; girar la mano para dirigir |
| Agarre lateral mantenido junto al pomo | Sujetar una palanca; desplazar la mano para accionar su canal |
| Pinza de índice y pulgar junto al aro o pomo, con seguimiento de manos | Agarrar y manipular el mismo control físico; abrir la pinza lo suelta |
| Avanzar / Retroceder / Frenar del panel RV | Mantener el gatillo o la pinza sobre el botón; soltar cancela la orden |
| Gatillo sobre un pulsador de cabina | Pulsar el control |
| Stick izquierdo | Avance, retroceso y dirección alternativa |
| Stick derecho | Hidráulica alternativa según las capacidades del equipo |
| X izquierdo | Alternar el freno de estacionamiento P |
| A derecho | Tomar o depositar carga mediante las comprobaciones del equipo |
| B derecho | Bajar del vehículo |
| Y izquierdo | Abrir o cerrar el menú de RV |

Se puede mantener el agarre antes de acercarse al volante o la palanca. El control físico tiene prioridad sobre su alternativa de stick; una segunda mano no roba un volante ocupado. Tomar una palanca no toma un pallet. Las restricciones de capacidad, apoyo y custodia de carga permanecen en el runtime del equipo.

Las palancas se encuentran a la derecha del operador, junto al volante. Para empezar: Encender, Marcha y liberar Freno P. Tirar de la palanca de elevación hacia el cuerpo sube las horquillas; empujarla hacia delante las baja. Se puede dirigir con una mano y mover la palanca con la otra.

En la demostración pública, acércate al vehículo y selecciona «Subir al montacargas» con el gatillo o una pinza. El letrero está sobre la cabina y evita depender del menú de pantalla durante la sesión inmersiva.

Al abrir un menú, perder seguimiento o desconectar un mando, se liberan los agarres y se neutralizan las órdenes. Antes de retomarlas se deben soltar botones y devolver los sticks al centro. Esto evita movimientos o pulsaciones pendientes al recuperar el foco.

## Manos y dedos

Se usan las mallas articuladas locales de [WebXR Input Profiles, generic-hand](https://immersive-web.github.io/webxr-input-profiles/packages/assets/), con licencia MIT incluida. Cada mano tiene 25 articulaciones y 2.314 triángulos, sin descargas externas al entrar en RV. Con mandos, el gatillo flexiona el índice y el agarre los otros dedos; esa animación no mide los dedos. Con seguimiento de manos, la piel sigue las poses medidas de WebXR y la pinza acciona el agarre. Si faltan poses, no se mantiene un agarre antiguo; se oculta la piel completa y sólo se muestran las articulaciones válidas. La implementación sigue [WebXR Hand Input](https://www.w3.org/TR/webxr-hand-input-1/) y la disposición estándar de [WebXR Gamepads](https://immersive-web.github.io/webxr-gamepads-module/).

Las pruebas automáticas emplean Three, colisiones y runtime reales con poses XR simuladas. La comodidad del alcance físico, el funcionamiento del navegador del visor y el rendimiento sostenido requieren validación final en un Quest 3 real.
