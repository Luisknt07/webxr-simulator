# CEDI compartido: instalación y preparación de prácticas

Las prácticas CEDI-01 a CEDI-05 usan la misma nave de 64 × 60 m, con cubierta y cuatro muelles frontales: dos de recepción y dos de despacho. Los camiones, las aperturas y los puentes de muelle conservan posiciones comunes. La operación sigue un flujo en U; el corredor frontal de cross-docking permite conectar recepción y despacho sin pasar por la reserva.

| Zona | Áreas y equipamiento |
| --- | --- |
| Recepción | Muelles REC-01/REC-02, transportadores de rodillos para pallets, espera y control de ingreso. |
| Calidad y cuarentena | Mesas de inspección, identificación, pesaje, rack de retención y posiciones segregadas en piso. |
| Almacén automático | Dos conjuntos de racks AS/RS con transelevador y transportadores de alimentación. |
| Reserva | Filas de racks con ocupación visible, clasificación ABC y almacenamiento especial con soportes adecuados al producto. |
| Picking | Entrepaños, extracción y reposición, posiciones de piso identificadas por SKU y consolidación de pedidos. |
| Packing | Puestos manuales protegidos, transportadores de cinta, sellado, etiquetado y embalajes de reposición. |
| Paletizado | Célula robotizada, salida de pallets y envoltura; el proceso activo conserva los controles nativos de la práctica. |
| Despacho | Posiciones de preembarque, control de salida y muelles DES-01/DES-02. |
| Servicios exteriores | Taller de mantenimiento con acceso al almacén y al patio; administración lateral de dos plantas, escaleras, baños y vestuario. |

## Preparar un intento

1. Selecciona una práctica y abre su configuración. El modal mantiene la previsualización y el botón de inicio visibles mientras se desplazan los controles.
2. Revisa **Misiones y guía**. **Usar ajustes sugeridos** recupera el caso base, la operación manual y la ayuda paso a paso sin sustituir tus productos y pedidos.
3. En **Productos y pedidos**, elige un conjunto preestablecido o selecciona las referencias. Cada referencia muestra una fotografía ilustrativa, presentación, embalaje, tratamiento y almacenamiento recomendado. Las fotografías son ejemplos genéricos generados por IA, identificados como tales.
4. Ajusta compras, inventario, pedidos y capacidad en los datos avanzados cuando sea necesario. El sistema comprueba cantidades, referencias y posiciones antes de preparar el intento.
5. Alterna **2D / 3D**, gira la vista 3D o consulta la cubierta. La vista utiliza la geometría y los parámetros nativos de la configuración; no es una imagen fija. No inicia otra simulación ni modifica el proyecto abierto.
6. Elige modo libre o recorrido progresivo e inicia. El modo libre permite repetir las prácticas; el progresivo exige las evidencias de la práctica anterior.

La dificultad modifica la ayuda y la tarea de análisis. La automatización cambia los equipos y responsabilidades indicados en la configuración. Una modalidad que todavía no dispone de un proceso completo evaluable se identifica como montaje de consulta; no concede resultados ni desbloqueos ficticios.

## Operación, inventario y rendimiento

Sólo la práctica seleccionada registra sus máquinas, cargas, controles y evidencias. Las demás áreas permanecen visibles como conjuntos nativos estáticos, agrupados por zona y acabado. Su stock de exposición no suma existencias al libro operativo ni produce pedidos. El libro y las cargas operativas mantienen sus SKU, lote, unidades, masa y custodia real.

La ampliación no reemplaza proyectos guardados ni mueve sus elementos automáticamente. Se obtiene al preparar un montaje nuevo de las prácticas. Los montajes guardados conservan su geometría, incluidas las superficies estáticas compactadas en Float32; la validación de tamaño, coordenadas y triángulos sigue activa.

Los recorridos físicos de recepción, almacenamiento, picking, packing y despacho se verifican con controles nativos. Las mediciones de geometría y las pruebas de navegador no equivalen a una prueba de rendimiento en un visor Quest físico.

## Recepción e inspección: tres puestos conectados

La recepción tiene tres entradas de rodillos para pallets, cada una terminada en una transferencia nativa a 90°. Las tres transferencias conectan con un colector longitudinal y una salida común a clasificación. Las superficies comparten la cota de apoyo de 1 m; los ocho enlaces comprueban posición y orientación de sus puertos. Las cintas no atraviesan los puestos de trabajo.

Entre las entradas se distribuyen los puestos QC-01 (conteo y estado), QC-02 (muestreo y medición) y QC-03 (identidad y registro). Cada puesto incluye mesa, estantería, útiles apoyados, iluminación de tarea representada, alfombra y cerramiento de protección frente al colector. Un paso posterior permite circular sin pisar los transportadores. Las entradas, el sentido de salida y la zona E04 de inspección del lote están señalizados.

En CEDI-01 la línea usa nueve transportadores operativos, sin fuentes automáticas ni pallets adicionales. En CEDI-02 a CEDI-05 conserva la misma distribución como contexto estático. La misión manual de recepción mantiene la inspección y registro en E04 y sus entregas o retenciones verificadas: usar la línea adicional no concede por sí solo una inspección, una entrega ni puntuación. La salida de E04 pasa por el corredor frontal antes de girar al pasillo este; el antiguo retorno posterior ahora contiene la línea de rodillos y no es una ruta de circulación.

El tablero de recepción consulta el libro de la práctica: carga pendiente de descargar, inspecciones, registros, entregas y retenciones, con seis filas de pallets, SKU y ubicación física. Preparar el muelle no se cuenta como descarga. Fuera de CEDI-01 indica que el proceso no está activo. Su pantalla se actualiza como máximo dos veces por segundo, omite lecturas fuera de vista y libera sus recursos al cerrar la práctica.

La distribución es una adaptación genérica de las vistas aportadas por el usuario, no una reproducción dimensional certificada de una instalación real. Para verla, prepara un nuevo intento CEDI-01 desde **Prácticas**. Los proyectos previamente guardados no se sustituyen.

Los archivos específicos son `CediReceivingLayout.cjs`, `runtime/CediReceivingConveyors.js` y `runtime/ReceivingAnalyticsBoard.js`, dentro de `modules/logistica-industrial/practices/configurable/`.

## Archivos comunes de la instalación

- `modules/logistica-industrial/practices/configurable/CediLayout.cjs`: distribución, zonas, subáreas, muelles y anexos.
- `modules/logistica-industrial/practices/configurable/runtime/CediFacility.js`: estructura, accesos, servicios y señalización.
- `modules/logistica-industrial/practices/configurable/runtime/CediSceneComposition.js`: equipos comunes, stock de exposición y montaje de la operación seleccionada.
- `modules/logistica-industrial/practices/configurable/CediOperatingData.cjs`: libro y validación de productos, compras, inventario, pedidos y capacidad.
- `modules/logistica-industrial/practices/ui/PracticeSetupForm.js`: configuración, guía y previsualización.
