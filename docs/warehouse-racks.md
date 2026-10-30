# Estanterías configurables de almacén

La biblioteca incorpora la categoría **Estanterías de almacén**, con 14 sistemas. Cada instancia tiene estructura, ubicaciones, límites de carga e inventario propios. Comparte el contrato de conexiones, manipulación, robots, montacargas, analítica y sesiones del almacenamiento existente.

## Modelos incluidos

| Grupo | Sistemas |
| --- | --- |
| Paletización y cargas largas | Selectiva, doble profundidad, Drive-In, Drive-Through, Pallet Flow, Push-Back, bases móviles y cantilever |
| Picking y pasillos elevados | Carga ligera, media carga, Carton Flow y mezzanine |
| Almacenamiento automático | Elevador vertical de bandejas y Miniload |

Las estructuras admiten módulos, niveles, posiciones por nivel, fondo, separación vertical, altura del primer apoyo y holguras. El máximo por instancia es **128 posiciones**, sin generar mercancía al insertar el modelo. Las dimensiones útiles se muestran en el inspector; la recepción verifica las dimensiones reales, altura y masa de cada carga, además del peso acumulado por módulo/nivel.

## Crear y adaptar un almacén

1. Abre un proyecto editable y entra en **Biblioteca → Estanterías de almacén**. Los tres grupos permiten filtrar la categoría sin perder la búsqueda general.
2. Añade la variante y ajusta **Sistema y estructura** en el inspector. La capacidad se calcula con sus módulos, niveles y posiciones. **Anchos por módulo** permite frentes distintos: por ejemplo `2.4, 3.6` para dos módulos; vacío conserva el ancho común. La distribución de algunos sistemas tiene restricciones propias: doble profundidad usa dos fondos; un elevador vertical tiene una sola columna de extracción.
3. Configura **Carga y compatibilidad**. Las posiciones libres no garantizan que una carga quepa: se comprueban su envolvente real, holguras, altura y peso por posición y por nivel. Puedes mantener una referencia por calle o permitir mezcla de referencias.
4. En **Mecanismo y acceso**, configura pendiente, velocidad y, cuando corresponde, filas móviles, pasillo abierto y ubicación solicitada. El selector de posiciones muestra banco/módulo/nivel/posición/fondo.
5. Coloca y conecta los equipos mediante los mismos puertos de entrada/salida y herramientas de ensamble. Al cambiar dimensiones se reajusta el grafo conectado; deshacer restaura geometría, posiciones y enlaces. Comprueba la cota de apoyo de cada equipo al diseñar alturas de transferencia.
6. Guarda el proyecto. Copiar y duplicar conserva la variante y las dimensiones, asigna una fila sin códigos repetidos y deja las reservas vacías. Copiar a otro nivel limpia las referencias externas. Los proyectos anteriores se migran al abrirlos y no restauran los antiguos paneles físicos de las estanterías.

## Identificación y asignación de ubicaciones

En **Identificación del almacén**, configura el pasillo y la fila. Cada apoyo lleva un código, por ejemplo `A01-R01-B01-M02-N03-P01-F01`: pasillo, fila, banco, módulo, nivel, posición y fondo. Los letreros y etiquetas identifican la misma posición que el selector del inspector. Los códigos de fila no se repiten dentro del mismo pasillo y escenario.

**Ubicaciones y reservas** permite escoger un código y reservarlo para el ID único de una carga. El ID del pallet y el SKU tienen funciones diferentes: el primero distingue una unidad física y el segundo su referencia de producto. El plan queda en el proyecto; cambiar la identificación conserva las reservas equivalentes y eliminar una posición reservada exige liberarla primero.

En **Probar → Simulación · variables y datos**, selecciona la estantería. **Ubicaciones e inventario** muestra posiciones disponibles, reservadas y ocupadas, y permite asignar un pallet existente de la operación a un destino. La reserva no desplaza el pallet ni evita las comprobaciones físicas: recibir una carga en una ubicación distinta a la asignada se rechaza. La etiqueta de la carga conserva su ID y distingue su ubicación actual del destino reservado. Al retirarla se libera la ocupación real.

Los pallets generados en una nueva ejecución son unidades nuevas y reciben IDs nuevos. Para planificar antes de ejecutar pueden utilizarse los IDs estables de pallets creados en el diseño; durante la operación se eligen los IDs existentes desde el inventario. **Menú → Sesiones → Guardar ejecución actual** conserva los IDs, la ocupación y las reservas de esa ejecución; guardar solamente datos de analítica no sustituye ese estado. Los códigos son internos del simulador y no se presentan como identificadores GS1 o SSCC.

## Flujo y compatibilidad

- Los sistemas paletizados reciben **pallets completos**, incluyendo su carga y masa. Las baldas de picking y los automáticos de cajas reciben **cajas, piezas o bandejas**, y rechazan pallets completos. Cantilever valida cargas largas apoyadas en brazos. Compatibilidad significa trabajar en el mismo flujo con la herramienta y carga adecuadas.
- Un rack estático tiene un apoyo real para sus conexiones de alimentación/salida. Una banda no traslada automáticamente mercancía a niveles superiores o al fondo: esas posiciones se sirven físicamente con operario, robot o montacargas.
- Los robots utilizan las posiciones alcanzables y mantienen la misma carga. Los montacargas conservan las comprobaciones de ambas uñas, huecos reales del pallet, masa, altura, alcance y colisiones. La doble profundidad exige extensión suficiente; el pallet delantero bloquea al posterior.
- Pallet Flow y Carton Flow tienen reposición y retirada por caras opuestas. Las cargas avanzan físicamente al liberarse la posición delantera y respetan FIFO por calle.
- Push-Back utiliza carros y movimientos hacia atrás para preparar una nueva entrada. La retirada es LIFO por calle. Los carros vacíos retornan por un recorrido inferior limitado, sin sustituir ni duplicar cargas.
- Las bases móviles desplazan estructura y mercancía juntas. La apertura se bloquea si el pasillo está ocupado o una carga está agarrada/reservada. Un bloqueo de ocupación exige retirar el obstáculo y rearmar antes de continuar. Una banda exterior fija conserva el puerto de la disposición inicial: cambiar de pasillo requiere realineación o manipulación física.
- Elevador vertical y Miniload tienen recorridos diferentes. El primero extrae una bandeja en vertical; el Miniload se desplaza entre módulos y niveles. La carga se presenta en una ventana accesible antes de retirarla o transferirla.
- FIFO no equivale a selección por caducidad (FEFO).

## Mandos y sesiones

En **Probar → Variables y datos**, selecciona la estantería. Puedes elegir ubicación, pasillo y velocidad, y usar **Solicitar posición**, **Abrir pasillo solicitado**, **Preparar entrada de carga**, **Despachar carga accesible** y **Rearmar mecanismo**, según su tipología.

Ninguna variante de estantería incluye armario, pantalla o pulsadores de mando físicos. La configuración pertenece al inspector y la operación de mecanismos al panel de simulación. Los comandos siguen disponibles para reglas y equipos externos conectados.

Las sesiones guardadas conservan las mismas entradas, unidades y cargas, incluyendo posiciones de bancos, carros y extractores durante un movimiento. Se comprueba la reanudación de base móvil, elevador vertical y Miniload.

## Verificación y alcance

`npm run test:warehouse-racks` comprueba schema, geometría, funcionamiento, restricciones, integración, editor e identificación. Incluye las 14 familias, FIFO/LIFO, errores de tipo/peso/altura, interbloqueos, sesiones en movimiento, reservas y conservación de identidad.

Se verificaron transferencias reales **Source → rack por gravedad → banda**, tanto de pallets como de cajas; **Source → robot → estantería → segundo robot → receptor**; y recogida/retorno conducidos de un mismo pallet de cuatro cajas y 33 kg mediante montacargas, uñas reales y vigas del rack.

`node tooling/qa/rack-structure-locations.cjs` comprueba los artefactos de producción con una cuenta y base de datos temporales. Revisa el inspector, reserva, copia, guardado y reapertura, recepción de un pallet identificado y las 14 variantes por separado. Las capturas no son una prueba de FPS en Quest.

Los perfiles, uniones y tornillos se agrupan por materiales y las etiquetas comparten un atlas de texto para limitar las llamadas de dibujo. Las posiciones vacías no añaden mercancía. El comportamiento es una simulación cinemática de almacenamiento, sin cálculo estructural ni resolución de fuerzas de contacto; las capacidades son límites configurables de la simulación.

La [matriz de referencias](warehouse-rack-reference-matrix.md) relaciona cada sistema con documentación oficial y sus restricciones de carga/acceso.

## Práctica de almacén con misiones

En **Escenarios → Realidad virtual compacta → RV · Almacén, rutas y ubicaciones** (`vr-warehouse-missions`) hay ocho ubicaciones selectivas y tres pallets de cuatro cajas y 33 kg. Dos están almacenados y otro espera en ENTRADA E01. Las misiones retiran del nivel superior hacia SALIDA S01, reponen una ubicación superior concreta y llevan una devolución desde el primer nivel a DEVOLUCIÓN D01. No hay generación ilimitada de mercancía ni paneles físicos en las estanterías.

El conductor sigue flechas de pasillo y un holograma que utiliza el mismo apoyo físico que la recepción. **Shift+G** alterna el holograma; **C** activa la cámara de horquillas y **Shift+R** alterna el retrovisor. El plano y las medidas permanecen visibles. Una tarea exige el pallet correcto, todos los puntos recorridos conduciendo, el código/posición exactos, apoyo real y retirada de ambas horquillas. Los eventos `warehouse-task-completed` y `warehouse-training-completed` se emiten después de esas comprobaciones. Una orden de depósito por sí sola no completa una misión.

El parámetro `trainingTasksJson` del montacargas guarda el programa independiente: identificadores de pallet/origen/destino, `sourceLocationCode`, `locationCode` o `destinationSlot`, y rutas `pickupRoute`/`route` en coordenadas X/Z de la sala. Admite hasta ocho misiones y 24 puntos por ruta; los puntos corresponden al centro del chasis. Las flechas sirven de guía manual y comprueban obstáculos presentes, sin conducción automática ni búsqueda dinámica de desvíos. Las sesiones conservan el progreso junto a la custodia real. Sin programa de misiones, el vehículo conserva su funcionamiento habitual.

`node tests/legacy/test-warehouse-missions-training.js`, `node tests/legacy/test-vehicle-guided-route.js` y `node tooling/qa/warehouse-missions.cjs` verifican progreso, identidad, destinos, obstáculos y transferencias. La comprobación de navegador identifica expresamente los ajustes de precisión usados para preparar el atraque; el recorrido y la retirada se ejecutan con el vehículo y sus colisiones.
