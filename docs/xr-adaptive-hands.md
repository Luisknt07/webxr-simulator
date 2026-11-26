# Manos y agarres WebXR

El visor público y el Workspace usan la misma piel articulada local de 25
articulaciones, con 2.314 triángulos y una llamada de dibujo por mano. Las
posturas de mandos se calculan en `packages/render-three/src/XRHandPose.js`.

Con seguimiento de manos, las matrices medidas por WebXR gobiernan directamente
la piel. No se sustituye el movimiento real por una postura prefijada al tocar
un control. La pérdida de seguimiento oculta las partes sin medición y cancela
las interacciones existentes. Esta separación sigue los espacios de
articulaciones de [WebXR Hand Input](https://www.w3.org/TR/webxr-hand-input-1/).

Con mandos, el gatillo controla el índice y el agarre lateral controla los otros
dedos. El pulgar se opone al índice para la pinza; el contacto capacitivo de los
botones modifica su apoyo. Los cambios de postura se interpolan con el tiempo
real del fotograma, también a 72, 90 y 120 Hz. El origen visual coloca el centro
del agarre cerca de `gripSpace`; no desplaza ese espacio ni el rayo de selección.

Hay posturas `generic`, `controller`, `pinch`, `pingpong`, `bowling`, `drawer`,
`joystick`, `plate`, `pole`, `relax`, `stick`, `flat`, `tweak`, `knob`, `clip` y
`point`. Las referencias de posiciones facilitadas por el usuario orientan estas
variantes; no se incorpora su modelo de guante.

Los volantes proporcionan un aro con radio y eje propios; las palancas usan el
pomo real y los botones una postura de índice extendido. Las cargas sujetas y
las baquetas nativas también proporcionan el objeto a la mano. Sin un perfil
explícito, se deduce un agarre a partir de la forma y las dimensiones locales.
Soltar o cancelar retira el contexto del agarre junto con la interacción.

Para una nueva interacción, se puede proporcionar un contexto efímero:

```js
controller.userData.xrHeldObject = {object: mesh, held: true, profile: 'knob'};
// Al soltar o cancelar:
delete controller.userData.xrHeldObject;
```

Un objeto también puede definir `object.userData.handGrab` con un `profile` de
la lista y una envolvente `shape: 'box' | 'sphere' | 'torus'`. Para una esfera se
admite `radius`; para un aro, `radius`, `tube`, `axis` y `center` en coordenadas
locales. El contexto de la interacción tiene prioridad sobre estos valores.

El cierre se limita por dedo usando segmentos de falanges y una holgura de
piel de 6 mm. Las envolventes se construyen al adquirir el objeto; el cálculo
de contacto se limita a 30 Hz y la animación continúa a la frecuencia del visor.
No hace consultas de triángulos ni crea geometría durante los fotogramas. Las
envolventes son aproximaciones conservadoras: un objeto cóncavo puede necesitar
un punto de agarre o una envolvente explícita. Una mano real conserva siempre
su postura medida, incluso cuando la persona atraviesa una superficie virtual.

Las tres palancas del montacargas eléctrico de cuatro ruedas tienen 95 mm
entre centros, pomos de 40 mm de diámetro y el agarre 30 mm más cerca del
operador. Se conserva la jerarquía del equipo y el recorrido hidráulico.
En manos medidas se acepta rodear un pomo con pulgar e índice en lados
opuestos: no es necesario cerrar la pinza dentro de su superficie. El agarre
tolera pequeñas variaciones de apertura, conserva la palanca adquirida y
rechaza una selección equidistante entre dos pomos. Soltar, perder tracking o
abrir un menú devuelve la palanca a neutro. Este reconocimiento es local a
las palancas; la pinza general de rayos, teletransporte y carga no cambia.

Verificación:

```powershell
node --test tests/framework/xr-adaptive-hand-pose.test.mjs tests/framework/xr-hand-interaction.test.mjs tests/framework/vehicle-physical-controls.test.mjs
node tests/legacy/test-xr-pointer-visuals.js
node tests/legacy/test-vehicle-cab.js
node tests/legacy/test-xr-contact-buttons.js
node tests/legacy/test-product-grip-xr.js
node --test tests/framework/vehicle-lever-grasp.test.mjs tests/framework/vehicle-hydraulic-bank.test.mjs
node tooling/qa/vehicle-lever-grasp.cjs <sha256-del-viewer>
node tooling/qa/xr-adaptive-hands.cjs <sha256-del-viewer>
node tooling/qa/public-xr-hands.cjs <sha256-del-viewer>
```

Las pruebas de Chrome usan el bundle compilado y guardan capturas en
`data/qa-studio/xr-adaptive-hands/`. Las pruebas automáticas verifican poses,
contactos, transformaciones y controles reales con entradas XR emuladas. La
comodidad del agarre, la calibración física y el rendimiento final en Quest
requieren comprobarse en el visor.
