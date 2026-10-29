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
2. Añade la variante y ajusta **Sistema y estructura** en el inspector. La capacidad se calcula con sus módulos, niveles y posiciones. La distribución de algunos sistemas tiene restricciones propias: doble profundidad usa dos fondos; un elevador vertical tiene una sola columna de extracción.
3. Configura **Carga y compatibilidad**. Las posiciones libres no garantizan que una carga quepa: se comprueban su envolvente real, holguras, altura y peso por posición y por nivel. Puedes mantener una referencia por calle o permitir mezcla de referencias.
4. En **Mecanismo y acceso**, configura pendiente, velocidad y, cuando corresponde, filas móviles, pasillo abierto y ubicación solicitada. El selector de posiciones muestra banco/módulo/nivel/posición/fondo.
5. Coloca y conecta los equipos mediante los mismos puertos de entrada/salida y herramientas de ensamble. Al cambiar dimensiones se reajusta el grafo conectado; deshacer restaura geometría, posiciones y enlaces. Comprueba la cota de apoyo de cada equipo al diseñar alturas de transferencia.
6. Guarda el proyecto. Copiar, duplicar, crear plantillas, exportar JSON y reabrir conservan la variante y sus parámetros. Las copias tienen mandos propios; copiar a otro nivel limpia las referencias externas.

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

El panel físico conserva sus mandos de marcha, paro y pausa. El cuarto pulsador se adapta: **PASILLO** en bases móviles, **PREPARAR** en Push-Back, **SOLICITAR** en automáticos y **DESPACHAR** en los demás. Los mandos siguen apuntando a su propia instancia después de copiarla. Los comandos también están disponibles en controles y reglas existentes.

Las sesiones guardadas conservan las mismas entradas, unidades y cargas, incluyendo posiciones de bancos, carros y extractores durante un movimiento. Se comprueba la reanudación de base móvil, elevador vertical y Miniload.

## Verificación y alcance

`npm run test:warehouse-racks` ejecuta seis suites: schema, geometría, funcionamiento, restricciones, integración y editor. Incluye las 14 familias, FIFO/LIFO con varias cargas, errores de tipo/peso/altura, interbloqueos, sesiones en movimiento y conservación de identidad.

Se verificaron transferencias reales **Source → rack por gravedad → banda**, tanto de pallets como de cajas; **Source → robot → estantería → segundo robot → receptor**; y recogida/retorno conducidos de un mismo pallet de cuatro cajas y 33 kg mediante montacargas, uñas reales y vigas del rack.

`node tooling/qa/qa-warehouse-rack-browser.js --expected <SHA256-del-bundle>` prueba el navegador compilado con cuenta/base de datos temporales. Comprueba categoría, inspector, copia, guardado y reapertura, y genera capturas de los 14 modelos sin cargarlos simultáneamente en un almacén grande. Las capturas no son una prueba de FPS en Quest.

La estructura específica se agrupa en lotes de materiales: normalmente 4–8 mallas, hasta 16 en bases móviles, además del HMI. Las posiciones vacías no añaden mercancía. El comportamiento es una simulación cinemática de almacenamiento, sin cálculo estructural ni resolución de fuerzas de contacto; las capacidades son límites configurables de la simulación.

La [matriz de referencias](warehouse-rack-reference-matrix.md) relaciona cada sistema con documentación oficial y sus restricciones de carga/acceso.
