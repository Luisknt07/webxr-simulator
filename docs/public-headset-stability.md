# Rendimiento y recuperación del recorrido público en gafas

La demostración activa los bancos nativos de dibujo que ya conserva el motor.
Las piezas rígidas comparten envíos sin sustituir los objetos originales usados
por colisiones, estudio, exportación y controles. El acabado microscópico
inmutable se comparte dentro de cada actor; los mapas de rodillos, cintas y
pantallas continúan independientes. Las articulaciones conservan sus anclajes.

El perfil automático de un navegador autónomo empieza en Economía y tiene
Equilibrado como techo. La preferencia explícita del usuario sigue disponible.
La foveación inicial es Equilibrada; no se cambia el framebuffer durante una
sesión de Three r112. El público elimina las sombras dinámicas y el relieve
adicional de paredes/suelo en gafas, mantiene la iluminación y prepara el
reflejo de la nave antes de entrar en RV. Los mensajes mantienen su resolución
adaptativa de hasta 2048 píxeles en gafas.

En el documento público inmutable se comparan directamente los campos de
materiales y sus colores, mapas y revisiones. El editor conserva la validación
completa de sus definiciones modificables. Esto evita serializar grafos de
materiales en cada fotograma del recorrido. Los cambios de geometría, matrices,
visibilidad y controles mantienen las comprobaciones originales del motor.

El host público detecta la pérdida de WebGL incluso antes del evento DOM y
suspende simulación, entradas y gráficos. Retira los manejadores GPU de Three
r112 conservando los datos CPU para recargarlos, acaba la sesión XR cuya capa
pertenece al contexto perdido y permite volver a entrar tras recuperarse.
El reloj se reinicia para no ejecutar de golpe el tiempo de la interrupción.

## Medición y límites

Chrome aislado con GPU D3D11, identificación de navegador Quest 3, misma vista
general a 1440 × 900, sin hardware de gafas:

| Métrica | Antes | Después |
| --- | ---: | ---: |
| Llamadas de dibujo de la vista | 777 | 505 |
| Texturas registradas por el renderizador | 392 | 105 |
| Pérdidas/restauraciones reales de WebGL verificadas | — | 3 |

Los tres ciclos recuperaron imagen con cero errores de GL y contadores estables
de 363 geometrías y 103 texturas. Los bancos propios usan aproximadamente
2,23 MiB de buffers adicionales. Los originales siguen disponibles en CPU.
Estos contadores no equivalen a VRAM física ni certifican 72 FPS, temperatura o
estabilidad en un visor. Hace falta completar esa medición en el dispositivo.

Resultados y capturas reproducibles en
`data/qa-studio/public-headset-performance/`:

```powershell
node tooling/qa/public-headset-performance.cjs <sha256-del-viewer>
node tooling/qa/public-xr-hands.cjs <sha256-del-viewer>
node tooling/qa/vehicle-lever-grasp.cjs <sha256-del-viewer>
npm.cmd run test:graphics
node --test tests/framework/browser-host-frame-errors.test.mjs tests/framework/native-render-banks.test.mjs
```

La prueba de rendimiento compara `baseline.json` con el bundle anterior,
comprueba una reducción mínima del 20 % de llamadas y ejerce el bucle nativo
durante la recuperación. Emula únicamente la sesión XR al comprobar su cierre;
la pérdida de contexto usa la extensión real `WEBGL_lose_context` del navegador.

Referencias: [pérdida de contexto WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost)
y [foveación opcional de XRWebGLLayer](https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/fixedFoveation).
