# Escenarios compactos de realidad virtual

Se añaden tres prácticas a la categoría **Realidad virtual compacta**. En un navegador identificado como Quest, Oculus Browser o Wolvic, esta categoría queda seleccionada inicialmente en la biblioteca. **Todas las categorías** conserva el acceso al catálogo completo de 34 escenarios. Los 31 anteriores conservan su contenido.

| Escenario | ID / parámetro `?scene=` | Equipos principales |
| --- | --- | --- |
| RV · Robot, banda y montacargas | `vr-robot-dispatch` | Un robot, una banda y un montacargas |
| RV · Transferencia entre dos bandas | `vr-robot-transfer` | Un robot, dos bandas cortas y un montacargas |
| RV · Giro y expedición compacta | `vr-robot-turn` | Un robot, una mesa de giro, una banda y un montacargas |

Cada práctica conecta un Source, un robot articulado, los transportadores, un montacargas eléctrico manual y dos bahías de entrega. La carga conserva su objeto, entrada de inventario, masa y unidades a lo largo de la transferencia; no se sustituye por una animación independiente.

## Límites de carga

- Máximo de **dos pallets**, con **cuatro cajas** cada uno: ocho unidades en toda la práctica.
- Cada pallet pesa 33 kg: 25 kg de tara y cuatro cajas de 2 kg.
- El Source conserva ese límite incluso si el creador solicita producción continua.
- Cada transportador admite un pallet. El último tramo se detiene automáticamente al llegar la carga a su extremo.
- Un solo robot y un solo montacargas; sin producción de fondo, filas de racks ni luces puntuales adicionales. Se mantienen materiales, colisiones, huecos reales de las horquillas y controles de cabina existentes.
- Once o doce objetos principales, incluida la capa de pasillos y textos editables, además de los hijos de control y los marcadores del entorno. Esa cifra no representa el número de mallas o llamadas de dibujo.

## Recorrido de la práctica

1. Entrar en **Menú → Escenarios → Realidad virtual compacta** y abrir una de las tres prácticas.
2. Observar el traslado del pallet desde el Source hasta el extremo de salida. Esperar el paro de la última banda.
3. Subir al montacargas y liberar **Freno P** desde sus mandos. Ajustar altura y separación, introducir ambas uñas en los huecos y tomar la carga con el mando de toma/depósito.
4. Retirarse, transportar con la carga baja y depositar en una bahía libre. Las validaciones físicas de alineación y apoyo siguen activas.
5. Retirar completamente las uñas y pulsar **Marcha** en el panel de salida para el segundo pallet. La misión se completa con dos entregas del montacargas.

La guía de cabina y sus modalidades RV se encuentran en [vehicle-cab-controls.md](vehicle-cab-controls.md). Para repetir un lote completo se vuelve a cargar la práctica; el límite evita que una sesión prolongada acumule productos.

## Validación

`npm run test:vr-compact` comprueba el límite finito, las conexiones, la validez del documento y el recorrido físico: robot → banda(s) → recogida con uñas reales → maniobras conducidas → depósito. Conserva la misma carga y verifica cuatro unidades y 33 kg en la entrega.

`node scripts/qa-compact-vr-browser.js` prueba la aplicación compilada en un servidor HTTPS temporal con el identificador de navegador de Quest. Comprueba las tres cargas de escenario, el filtro inicial y el acceso a los 34 ejemplos. No modifica cuentas ni proyectos guardados.

La aplicación compilada se midió en Chrome de escritorio con GPU por software, lienzo de 960 × 640 y política equilibrada fija:

| Escenario | Llamadas de dibujo por fotograma | Triángulos por fotograma |
| --- | ---: | ---: |
| Robot, banda y montacargas | 330 | 48.143 |
| Transferencia entre dos bandas | 370 | 52.304 |
| Giro y expedición compacta | 370 | 52.471 |

Son muestras con la cámara inicial y la capa editable de piso; no son máximos para cualquier posición, fase del ciclo o número de ojos. La auditoría previa del laboratorio completo registró aproximadamente 2.356 llamadas con la misma política de escritorio. No hubo errores de JavaScript, consola o WebGL en las tres cargas nuevas. Las estimaciones de texturas conocidas variaron entre 17,3 y 37,2 MiB por la carga diferida; no equivalen a la memoria total del visor.

Un identificador de navegador de Quest y Chrome con GPU por software no sustituyen la prueba en el visor: quedan pendientes FPS, memoria total y estabilidad de sesión en un Quest 3 físico. Los cambios están preparados localmente; este trabajo no publica en GitHub Pages.
