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

## Bloqueos al subir al montacargas en Quest 3

La medición específica de entrada encontró unos 887 ms de trabajo síncrono,
incluyendo varias ejecuciones del planificador de rutas en el mismo montaje.
La cabina pública ahora prepara sus etiquetas, paneles, plano y shaders durante
la carga inicial y los reutiliza al subir. Los controles permanecen desactivados
hasta que el operador ocupa el asiento. Se liberan al abandonar la aplicación.

En visores autónomos, el plano de navegación es 2D y no solicita otra pasada de
toda la nave. Las cámaras auxiliares y sus acciones se omiten en este perfil:
la prueba del retrovisor detectó otro bloqueo largo en su primera pasada. La
vista directa del visor, los controles físicos y las verificaciones reales de
colisión, apoyo, carga y descarga se conservan. Las cámaras de escritorio y RV
conectada al PC mantienen su comportamiento anterior.

La ruta de orientación no se calcula en el hilo de un visor autónomo. Se mantienen
los destinos y el progreso de misión del runtime, sin mostrar un corredor como
validado si no lo verificó el planificador. El holograma de componentes sólo
crea sus aristas cuando se solicita. Los intervalos de actualización se cuentan
desde el final del cálculo para impedir repeticiones inmediatas tras un pico.

En Chrome aislado D3D11 con UA de Quest 3, la entrada pasó de 887 ms a unos
62 ms (93 % menos); las siguientes tres subidas/bajadas costaron entre 15 y
19 ms y conservaron el mismo atlas. Mirar el plano y solicitar el retrovisor
generaron cero pasadas auxiliares y cero asignaciones de cámaras. Es una
comparación de software en PC; no certifica los FPS de un Quest físico.

```powershell
# Medir el bundle anterior antes de reconstruir:
node tooling/qa/vehicle-xr-performance.cjs <sha-anterior> --baseline
# Comparar el bundle corregido con esa línea base:
node tooling/qa/vehicle-xr-performance.cjs <sha-corregido>
node --test tests/framework/vehicle-quest-cab-budget.test.mjs
npm.cmd run test:vehicle-assistance
```

Los informes y capturas quedan en `data/qa-studio/vehicle-xr-performance/`.
