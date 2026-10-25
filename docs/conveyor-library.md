# Biblioteca de transportadores

La biblioteca usa los modelos procedurales, Three.js r112, el documento de escenas, la simulación y WebXR del proyecto. No requiere Python. La definición compartida en `shared/conveyor-equipment.js` vincula identidad, versión, variante, parámetros, componentes, productos admitidos, acciones y ficha educativa. Las geometrías y las miniaturas proceden de las fábricas reales del proyecto.

## Elegir e insertar equipos

Abre `https://localhost:8080/editor` y sigue **Biblioteca → Equipos industriales → Transportadores**. La vista principal agrupa las variantes por familia. Abre una familia para ver sus equipos o utiliza **Variante** en la previsualización. Hay 25 variantes disponibles:

| Familia | Variantes |
| --- | --- |
| Rectos | Rodillos motorizados; banda continua; rodillos por gravedad; cadenas para pallets. |
| Curvos | Rodillos; banda continua; banda modular. |
| Inclinados | Banda; banda con tacos; banda modular. |
| Transferencias | Correas elevables; cadenas elevables para pallets; mesa giratoria de rodillos; mesa giratoria para pallets. |
| Uniones y desvíos | Empujador; ruedas orientables; unión angular coordinada; distribuidor de rutas. |
| Acumuladores | Rodillos por zonas; banda por zonas. |
| Elevadores | Cajas; pallets. |
| Carga y descarga | Mesa manual; estación con operario; estación automática. |

Selecciona una variante y arrástrala al escenario, haz doble clic en su tarjeta o pulsa **Añadir al escenario**. Cada instancia tiene identidad propia, datos independientes y referencias de sensores y paneles correspondientes. La colocación inicial busca piso y espacio libre; una línea de ejemplo se coloca como conjunto conservando la alineación entre sus equipos. Si no hay apoyo suficiente, la inserción se cancela completa.

**Favoritos** guarda referencias a variantes y archivos, sin duplicarlos. **Proyecto** contiene importaciones y plantillas. Los recursos originales y las instancias del escenario permanecen separados.

## Configurar una instancia

Selecciona el equipo y abre **Equipo / Variante** en el inspector. Consulta su identidad y versión, cambia de variante o comprueba la admisión de un perfil de producto. Los campos aplicables dependen del mecanismo: dimensiones, paso de rodillos, radio, ángulo, sentido de curva, desnivel, carga máxima configurada, altura libre, zonas, tiempos de actuación y disponibilidad de operario, entre otros.

Edita las dimensiones mediante estos parámetros para reconstruir el recorrido sin escalar los motores, sensores o pulsadores. Después de cambiar dimensiones o variante, revisa y vuelve a alinear las conexiones. Los equipos por gravedad no tienen motor ni panel eléctrico; las mesas manuales no incorporan transporte oculto.

Los escenarios anteriores conservan sus configuraciones y referencias. Consultar una ficha no migra un equipo antiguo. Elegir una nueva variante en sus propiedades aplica explícitamente la definición del catálogo.

Las acciones dependen de la selección: el inspector permite copiar, duplicar, desconectar y configurar el equipo; **Editar** permite agrupar y guardar como plantilla. **Escenario → Conectar equipos…** abre el asistente de puertos. El botón derecho del ratón mantiene la navegación orbital existente.

## Ensamblar y coordinar una línea

Arrastra un módulo con **Mover**. Amarillo identifica puertos compatibles y el imán alinea los extremos al acercarlos; verde identifica una unión. Alejar el equipo o usar **Desensamblar equipo** elimina su conexión funcional.

El sistema distingue proximidad, coincidencia geométrica e interfaz funcional. Comprueba dirección, ancho, altura, clase de carga y transición. Durante la marcha también comprueba ocupación y disponibilidad del receptor. Una conexión guardada no autoriza el paso a través de un espacio vacío o de una máquina detenida.

Una L utiliza una curva o una transferencia apropiada. Una T requiere el mecanismo de desvío y un ramal receptor. La unión angular admite dos entradas coordinadas; el ejemplo Y utiliza un ángulo real de 45° y una zona común reservada. Un circuito rectangular se cierra con cuatro curvas y tramos rectos. Las interfaces de pallets exigen una base y una masa compatibles.

Los sensores de presencia detectan ocupación y generan señales de entrada/salida. Los indicadores cambian con la detección real del volumen. Las zonas de acumulación retienen una carga cuando la siguiente está ocupada. La clasificación utiliza atributos del producto y reglas configuradas; el sensor de presencia no mide calidad por sí mismo.

## Operar el panel y su alcance

El panel negro conserva pantalla superior, textos, colores y distribución de sus nueve mandos:

| Izquierda | Centro | Derecha |
| --- | --- | --- |
| MARCHA | PARAR | EMERGENCIA |
| PAUSA | APAGAR | ENCENDER |
| − VELOCIDAD | INSERTAR CAJA | + VELOCIDAD |

Enciende y pulsa Marcha. Parar conserva las cargas; Pausa suspende el movimiento; Apagar retira la alimentación simulada. La emergencia queda enclavada y liberarla requiere una nueva orden de Marcha. Insertar caja solicita una carga mediante la ayuda de simulación existente; no representa un alimentador físico incorporado.

El alcance del panel se configura independientemente:

- **Módulo (`module`)**: únicamente el equipo vinculado.
- **Tramo (`segment`)**: equipos siguientes sin panel propio, hasta el siguiente panel.
- **Línea (`line`)**: conjunto conectado.

El visor muestra los nombres de los equipos incluidos en el alcance. Su pantalla y sus señales utilizan variables del runtime: estado, consigna, velocidad real, entradas, salidas, cargas, alimentación, ocupación y tiempos. Las transferencias internas no se cuentan como nuevas entradas de una línea.

## Productos, Source y estaciones

Los perfiles reutilizables incluyen cajas pequeñas, medianas y grandes, bandejas, contenedores y pallets. Comprueba dimensiones, masa, base, ancho útil, altura libre y capacidad configurada. Los rodillos necesitan longitud suficiente de apoyo; las cadenas requieren patines orientados. Curvas y pendientes añaden comprobaciones de envolvente y estabilidad didáctica. Un pallet es una unidad de manipulación con su estiba y procedencia, no una caja recoloreada.

**Herramientas de simulación → Generador de productos** contiene el Source lógico. Configura tipos, tamaños, atributos, intervalos y cola; conecta su flujo al equipo receptor. Las estaciones físicas de carga y descarga pertenecen a su familia de transportadores. Una estación automática coordina admisión y salida; no genera productos por sí sola.

El generador de respaldo y **Insertar caja** de una banda esperan mientras haya suministro externo conectado. El almacén con estibas es un equipo independiente que puede conectarse o desconectarse. Las bandas no añaden una mesa inicial ni un pallet final que interfiera con otros módulos.

## Explorar equipo

Pulsa **Explorar equipo** en la biblioteca o en las propiedades de una instancia. El visor abre un mundo independiente: conserva los parámetros de la instancia consultada y no modifica el escenario abierto. Presenta familias a la izquierda, modelo real al centro, variantes arriba y cinco pestañas contextuales:

- **Partes**: selecciona una ficha o haz clic en una pieza para resaltarla y consultar su función. Los detalles se renderizan desde las piezas del modelo.
- **Funcionamiento**: consulta la secuencia y los parámetros didácticos. Cambiar un parámetro reinicia la demostración.
- **Controles**: opera los nueve mandos HTML, comprueba cargas y consulta señales. Los pulsadores del panel 3D muestran su animación incluso con el tiempo pausado.
- **Conexiones**: consulta puertos, cotas, superficies, compatibilidad y módulos necesarios.
- **Aplicaciones**: abre líneas completas con equipos y enlaces funcionales.

**Ejecutar** inicia el reloj de la exploración; los equipos también necesitan sus órdenes de Marcha. **Paso 0,1 s** avanza el runtime por intervalos. **Reiniciar** recupera la demostración. **Recorridos y puertos** muestra sus trayectorias. El selector **Equipo activo** permite examinar otro módulo de un ejemplo.

El clic sobre el modelo 3D selecciona componentes; los mandos HTML operan el panel. El visor educativo se cierra al entrar en VR. En la experiencia WebXR principal permanecen los controles físicos y el agarre existentes.

Hay once ejemplos de líneas, además del equipo individual: recta conectada, carga manual, L con curva, L rectangular con transferencia a 90°, T con empujador, Y con unión de 45°, acumulación bloqueada, transferencia elevable, cambio de nivel con elevador, clasificación por calidad y circuito rectangular. **Añadir al escenario** crea instancias independientes; el recorrido se ubica conjuntamente y se conserva como grupo de la sala.

## Guardar, reabrir y validar

**Guardar** en el editor conserva el diseño: identidad y versión del equipo, transformación, parámetros, componentes, sensores, conexiones, paneles y reglas. Copiar, plantillas, deshacer, exportación JSON y revisiones SQLite mantienen estos datos.

Guardar una ejecución desde **Mi espacio → Sesiones guardadas** utiliza el checkpoint existente: productos y procedencia, posiciones, estados y temporizadores. Es distinto de guardar el diseño. Reanudar comprueba la revisión del proyecto; una ejecución de otra revisión no se aplica silenciosamente.

Las pruebas automatizadas usan las fábricas y los grafos reales para verificar mecanismos, rechazo de productos, contrapresión, conservación de cargas, guardado/reapertura, mandos y entradas de ambos controladores XR simulados. El harness del visor adapta DOM, OrbitControls y WebGL; no verifica píxeles ni un visor físico.

La verificación final aprobó `npm.cmd test` (97 programas de prueba), `npm.cmd run build` y `npm.cmd run test:browser`. Esta última ejecuta Chrome con WebGL/SwiftShader, HTTPS y una base SQLite temporal: comprueba las ocho familias, las cinco pestañas y su distribución visible, miniaturas renderizadas, los nueve mandos, emergencia, modelos representativos de cada familia, conexiones de ejemplo, aislamiento del escenario y liberación del renderizador. Las capturas se revisaron para corregir superposiciones de la interfaz y comprobar los soportes elevados. SwiftShader no mide el rendimiento del equipo ni sustituye una prueba con visor físico.

La inspección de las 25 fábricas, con sus parámetros predeterminados, registró un máximo de **132 mallas y 15 124 triángulos por equipo**. Son mediciones de complejidad geométrica al construir modelos en CPU; no son FPS, llamadas de dibujo medidas ni una garantía de rendimiento en dispositivos VR. Cambiar dimensiones o densidad de componentes también cambia esa complejidad. La cantidad de equipos, luces, texturas y productos afecta al resultado de una escena. Cada acumulador versionado admite hasta 32 zonas; para más zonas se conectan varios módulos.

## Límites actuales

- La simulación utiliza eventos, cinemática y comprobaciones geométricas. No valida dinámica de contacto, deformación, fricción real ni cálculos de ingeniería. Las masas, tiempos y capacidades configurables son valores didácticos.
- La estación robotizada con recogida y entrega queda pendiente de un robot con alcance, herramienta y señales coordinadas; no hay tarjeta funcional que simule su existencia.
- La configuración horizontal–inclinado–horizontal requiere transiciones físicas preparadas. Ese modelo no está habilitado: acercar superficies con pendientes diferentes no crea una transición.
- No hay vista explosionada preparada ni conexión a PLC industrial real.
- Se conservan el panel de nueve mandos, el flujo de ambos controladores WebXR y las unidades del proyecto. Se comprobaron entradas XR simuladas; falta validación con visor físico. No se afirma soporte nuevo para seguimiento de manos.

Para ampliar el catálogo, añade una definición versionada y completa modelo, mecanismo, puertos, inspector, ficha, miniatura y pruebas antes de habilitar su inserción. Las variantes incompletas no deben presentarse como máquinas funcionales.
