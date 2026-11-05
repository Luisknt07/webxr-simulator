# Controles de realidad virtual

El visor público y el editor comparten teletransporte, puntero y representación local de mandos. La entrada en RV se realiza desde el botón VR del navegador; los controles táctiles y de escritorio conservan sus propias entradas.

## Caminar y señalar

| Control de Quest Touch | Acción |
| --- | --- |
| Stick izquierdo | Desplazarse |
| Stick derecho hacia un lado | Girar por pasos |
| Stick derecho hacia arriba, mantener y soltar al centro | Apuntar el arco y confirmar el teletransporte |
| Gatillo | Pulsar el botón situado exactamente bajo la retícula; también permite seleccionar suelo válido |
| X o A, fuera del vehículo | Abrir o cerrar el menú de RV |

El arco distingue destinos válidos de destinos bloqueados. Sólo permite superficies de suelo autorizadas y comprueba paredes y espacio disponible. Se mueve el rig, conservando la pose local y la altura del visor. Conducción, menús y pérdida de seguimiento cancelan un teletransporte en curso.

La retícula corresponde al punto real de impacto y el rayo llega hasta él. Un botón no activa a otro por pertenecer a la misma máquina. Al agarrar una pieza de la cabina se oculta el rayo de esa mano; la mano libre sigue disponible para señalar.

## Montacargas

| Control | Acción |
| --- | --- |
| Agarre lateral mantenido junto al aro | Sujetar el volante; girar la mano para dirigir |
| Agarre lateral mantenido junto al pomo | Sujetar una palanca; desplazar la mano para accionar su canal |
| Gatillo sobre un pulsador de cabina | Pulsar el control |
| Stick izquierdo | Avance, retroceso y dirección alternativa |
| Stick derecho | Hidráulica alternativa según las capacidades del equipo |
| X izquierdo | Alternar el freno de estacionamiento P |
| A derecho | Tomar o depositar carga mediante las comprobaciones del equipo |
| B derecho | Bajar del vehículo |
| Y izquierdo | Abrir o cerrar el menú de RV |

Se puede mantener el agarre antes de acercarse al volante o la palanca. El control físico tiene prioridad sobre su alternativa de stick; una segunda mano no roba un volante ocupado. Tomar una palanca no toma un pallet. Las restricciones de capacidad, apoyo y custodia de carga permanecen en el runtime del equipo.

Al abrir un menú, perder seguimiento o desconectar un mando, se liberan los agarres y se neutralizan las órdenes. Antes de retomarlas se deben soltar botones y devolver los sticks al centro. Esto evita movimientos o pulsaciones pendientes al recuperar el foco.

## Manos y dedos

Con mandos se muestran manos animadas: el gatillo flexiona el índice y el agarre flexiona los otros dedos. Es una ayuda visual, no una medición de cada dedo. Si la sesión ofrece seguimiento de manos, se usan sus articulaciones reales; las articulaciones sin pose válida se ocultan. El seguimiento de manos es opcional, por lo que no impide iniciar RV con mandos. La implementación sigue [WebXR Hand Input](https://immersive-web.github.io/webxr-hand-input/) y la disposición estándar de [WebXR Gamepads](https://immersive-web.github.io/webxr-gamepads-module/).

Las pruebas automáticas emplean Three, colisiones y runtime reales con poses XR simuladas. La comodidad del alcance físico, el funcionamiento del navegador del visor y el rendimiento sostenido requieren validación final en un Quest 3 real.
