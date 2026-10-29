# Agarre y separación de los robots

La regresión se reprodujo en `vr-robot-dispatch`: después de entregar el primer pallet, el robot volvía a una postura de catálogo cuyo desplazamiento crecía con el alcance de 3,2 m. La muñeca quedaba sobre la entrada de las cadenas y el antebrazo atravesaba las cajas. La revisión del bundle anterior detectó 19 piezas del robot dentro de los cartones en esa postura de espera; las capturas de las fases de agarre y entrega por sí solas no mostraban el fallo.

Los tres escenarios compactos de RV guardan ahora una postura plegada junto a la base. Se conserva el alcance de 3,2 m, el desplazamiento muñeca–TCP de 0,20 m y el pallet original de cuatro cajas y 33 kg. Los límites articulares siguen siendo los del mismo modelo.

La celda de manipulación utiliza un pedestal de 0,65 m: su altura anterior de 0,45 m dejaba el antebrazo demasiado cerca de la carga mediana durante la elevación. El cambio modifica la estructura real del robot, sin escalar el brazo ni desplazar las cajas para ocultar el contacto.

La columna de la celda SCARA pasa de 1,60 a 1,80 m y conserva su carrera vertical de 0,50 m. Esto permite retirar las ventosas y pasar por encima de la siguiente caja disponible. Su aproximación nominal respeta la carrera real; la altura necesaria para librar una carga no se recorta para forzar una transferencia.

Los brazos articulados y SCARA retiran la herramienta verticalmente antes del retorno y mantienen su orientación mediante trayectorias del TCP con cinemática inversa. El traslado tiene en cuenta la altura de las cargas cercanas y de la carga transportada. Si falta alcance para aproximarse con separación, el controlador informa del bloqueo en lugar de sustituir esa trayectoria por una entrada directa.

La pinza paralela usa una profundidad de contacto lateral de hasta 40 mm, limitada a la mitad de la altura de la caja. La geometría de sus dedos y la posición de la carga comparten ese contacto; las ventosas y los apoyos inferiores conservan sus planos de contacto propios.

Las piezas rígidas del robot disponen de envolventes orientadas calculadas a partir de sus mallas reales. La caché no añade geometría renderizable ni sustituye el modelo por una caja global que incluya los huecos entre eslabones.

Las coincidencias cercanas se contrastan con triángulos y contención antes de bloquear el movimiento. Solo se admite el contacto de las superficies de agarre con la carga correspondiente; las cajas vecinas también bloquean mordazas y ventosas. Al detectar una ocupación se conserva la última postura válida y la propiedad de la carga. Esta comprobación complementa las colisiones existentes de la carga transportada; no es un planificador universal del brazo frente a toda la arquitectura.

## Verificación reproducible

- `npm run test:robot-clearance` comprueba geometría, contacto, posturas y movimiento.
- `npm run test:robots` incluye las comprobaciones anteriores junto con las pruebas existentes de robots.
- `node scripts/qa-robot-grasp-clearance-browser.js --expected-bundle-sha256 <SHA256> --all --cycles 6 --label corrected` revisa el bundle compilado en Chrome con una cuenta y base de datos temporales. Cubre el primer pallet de los tres escenarios compactos de RV y los seis productos de las líneas de manipulación y SCARA. El pallet de RV espera después la recogida manual con montacargas.

El análisis de navegador compara los triángulos del robot con el interior de cada cartón real del pallet, dejando una tolerancia de contacto de 5 mm. Inspecciona cada paso de simulación de 1/60 s de los ciclos revisados, además de capturar las fases de aproximación, recogida, elevación, traslado, depósito y espera. La revisión visual y geométrica de escritorio no mide los FPS de un Quest 3 físico.
