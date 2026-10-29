# Robots industriales y logísticos

Investigación y contrato de implementación, 26 de octubre de 2026. Los modelos de este proyecto son diseños propios para enseñanza, configurables y expresados en metros, segundos y kilogramos. Las prestaciones iniciales son valores didácticos: no representan un modelo comercial ni sustituyen el cálculo de una celda industrial.

## Taxonomía verificada

Conviene separar **estructura mecánica**, **movilidad**, **herramienta** y **aplicación**. Un robot de paletizado puede ser articulado o cartesiano; uno colaborativo puede compartir una arquitectura de seis ejes con otro convencional. La IFR clasifica las estructuras industriales en cartesiana, SCARA, articulada, paralela, cilíndrica y polar. La colaboración describe las condiciones de interacción con personas y las funciones de la aplicación, no solamente su forma. [IFR: definición y clasificación](https://ifr.org/industrial-robots).

| Familia | Principio y aplicaciones | Representación del simulador |
| --- | --- | --- |
| Articulado | Eslabones en serie con ejes rotativos; manipulación, atención de máquinas y procesos. | Seis ejes, brazo y muñeca, recogida/entrega y variante de proceso. |
| SCARA | Dos ejes rotativos paralelos en el plano horizontal, eje vertical y orientación de herramienta. Adecuado para ensamblaje y manipulación ligera. | Cuatro ejes; J3 es prismático y permite subir/bajar. No se limita el robot al plano XY. |
| Delta / paralelo | Cadenas mecánicas cerradas que sostienen una plataforma móvil desde arriba. Picking y packaging de productos ligeros. | Tres cadenas y giro de herramienta; volumen alcanzable comprobado por cinemática. |
| Cartesiano / pórtico | Guías ortogonales y carrera lineal; carga/descarga, montaje y manipulación. | XYZ, tres ejes prismáticos con carrera editable. |
| Paletizador | Arquitectura especializada que mantiene la herramienta nivelada. Existen modelos de cuatro, cinco y otros números de ejes. | Variante de cuatro ejes; entrega a la cola de pallets, que gobierna el patrón de apilado. |
| AMR | Misiones de transporte con navegación flexible, percepción y planificación de rutas en robots comerciales. | Plataforma móvil y misiones; comprobar el alcance de navegación implementado más abajo. |
| AGV | Vehículo con rutas guiadas y estaciones de transferencia. Puede equiparse con plataforma, remolque u horquillas. | Plataforma guiada por puntos; la aplicación conserva el recorrido definido. |
| Shuttle | Carro restringido a carril o a niveles de rack; almacenamiento temporal y secuenciación. | Carro de transferencia sobre carril lineal; no se presenta como un almacén multinivel completo. |

La selección de articulados, SCARA, Delta y paletizadores se corresponde con familias reales del catálogo [KUKA](https://www.kuka.com/en-us/products/robotics-systems/industrial-robots/). Los SCARA tienen varios alcances y capacidades según el modelo; no se asigna una velocidad o carga universal a toda la familia. [Epson: SCARA](https://epson.ca/For-Work/Robots/SCARA/c/w810).

El Delta de referencia de ABB combina picking y opciones específicas de seguimiento de transportador. Esas capacidades dependen de su controlador y de la aplicación. Una secuencia de recoger un producto detenido no equivale a implementar seguimiento continuo a velocidad de banda. [ABB: IRB 360, ficha técnica](https://library.e.abb.com/public/f03878770fef4c2c93757953373aed9b/IRB%20360_datasheet_20220829.pdf).

La familia cartesiana real también incluye combinaciones de dos ejes, brazos móviles y pórticos; aquí se implementa el pórtico XYZ. Las guías, carros y gestión visual de cables proceden de ese principio, sin copiar un CAD de fabricante. [Yamaha: XY-X](https://global.yamaha-motor.com/business/robot/lineup/xyx/).

La serie comercial M-410 de FANUC muestra por qué «paletizador» no significa siempre cuatro ejes: incluye modelos de cuatro y cinco. La arquitectura de cuatro usada aquí conserva la orientación nivelada para depositar cajas; no reproduce la carga, aceleración ni exactitud de esa serie. [FANUC: M-410](https://www.fanuc.eu/eu-en/m-410-series).

Para móviles, MiR distingue el guiado por rutas de los AMR capaces de planificar alternativas. Los modelos comerciales pueden integrar percepción y gestión de flotas; animar ruedas sobre puntos no demuestra SLAM. [MiR: AMR y AGV](https://mobile-industrial-robots.com/blog/agv-vs-amr-whats-the-difference). Las plataformas y sensores de la [serie LD de OMRON](https://robotics.omron.com/products/mobile-robots/ld-series/) sirven como referencia del tipo de equipo, no como ficha de nuestras plataformas.

Un shuttle real puede formar parte de un AS/RS con elevadores, ubicaciones y secuenciación. Eso requiere un modelo de almacén adicional. [Daifuku: Shuttle Rack M](https://www.daifuku.com/es/solution/intralogistics/products/automated-warehouse/multi-shuttle-asrs/). En logística también existen AMR de transporte de contenedores para clasificación y preparación; la arquitectura de transporte y la función de clasificación deben configurarse por separado. [Dematic: AMR](https://www.dematic.com/en-us/solutions/amr/).

La ampliación incorpora también cilíndricos RPP, polares RRP, manipuladores móviles y clasificadores móviles. Siguen fuera del alcance los brazos redundantes de siete ejes, doble brazo, transelevadores AS/RS completos y robots con patas, aéreos, submarinos o humanoides. Los vehículos con horquillas y de arrastre tienen un catálogo separado de los manipuladores industriales.

### Familias ampliadas

El cilíndrico combina giro de columna, elevación y extensión radial; el polar combina dos giros y extensión. La selección RPP/RRP es una decisión de arquitectura concreta del simulador dentro de las definiciones de [IFR](https://ifr.org/industrial-robots). Sus límites producen envolventes diferentes: no se deben intercambiar los alcances de un prisma rectangular, cilindro y volumen polar.

Un manipulador móvil integra un brazo sobre una base que transporta y se aproxima a estaciones. La solución MoMa de OMRON combina brazo TM y plataforma LD; la página describe integración por proveedores especializados, no un paquete universal que ya incluya cualquier aplicación. [OMRON: Mobile Manipulator](https://industrial.omron.eu/en/solutions/product-solutions/omron-mobile-manipulator-solution). La secuencia didáctica acopla base y brazo: navegar, estacionar, manipular, retraer y volver a navegar. No representa manipulación dinámica mientras la base circula.

Geekplus documenta robots de clasificación S-series coordinados por su sistema de gestión. [Geekplus: Sorting](https://www.geekplus.com/solutions/sorting). Las variantes con cinta transversal y bandeja inclinable del simulador son diseños propios para estudiar reserva de destino, identificación del producto y descarga; no se les asignan las cifras de rendimiento ni una ficha comercial de Geekplus. Una regla de clasificación debe seleccionar el destino antes de descargar y conservar la misma carga si el receptor está ocupado.

## Qué se puede configurar

`modules/logistica-industrial/functions/robots/schema/robots.js` es el contrato serializable común para editor, servidor y simulador. `modules/logistica-industrial/functions/robots/schema/robot-equipment.js` añade catálogo, componentes, perfiles de producto, acciones y referencias. Una instancia conserva su propia configuración y estado.

- Arquitectura, variante, dimensiones, alcance, altura de base y herramienta.
- Operación: recoger/depositar, proceso, entrega a paletizado o transporte. Preparación inicial, tiempo mínimo de ciclo y tiempo de proceso.
- Alimentación, marcha, pausa, emergencia y modo automático/manual; panel opcional.
- Origen de recogida `sourceId`, receptor `outputId` y objetivo de proceso opcional `targetId`.
- Masa máxima simulada, gálibo de producto y admisión de individuales, cajas o pallets. Se acepta la masa ya presente en los productos (`mass`); también `massKg` y `weightKg` para compatibilidad.
- Rutas locales de AMR/AGV de hasta 48 puntos, cada uno `{x,y,z,speed?}`, a un máximo de 250 m del origen. Son recorridos sobre el piso, con Y local igual a cero; la velocidad opcional limita cada tramo. El campo no ejecuta código.
- Límites por articulación `{id,min,max,home?}`. Los límites personalizados pueden reducir el recorrido del modelo, nunca ampliarlo más allá de su envolvente inicial.
- Colores independientes para carcasa, juntas/protecciones y herramienta; acabado pintado, acero, aluminio o polímero. Desgaste, detalle, redondeo de carcasas, chaflán de placas y perforaciones visuales.

La capacidad de un robot real depende también del peso de la herramienta, centro de gravedad, momentos, orientación, aceleración y montaje. El filtro de masa y dimensiones del simulador no es una validación dinámica. Si falta la masa, el resultado señala que no pudo comprobarla; `requireKnownMass` permite impedir esas cargas. El peso declarado de un pallet debe ser el de la carga completa.

## Coordenadas y articulaciones

El mundo es Y arriba. El robot se coloca sobre el piso en su origen local; los puntos de ruta se transforman con su objeto. Las distancias son metros y los límites angulares internos son radianes.

| Familia | Ejes, en orden | Convenciones |
| --- | --- | --- |
| Articulado | Y, Z, Z, X, Z, X | Hombro a `baseHeight`; eslabones principales de 0,52 y 0,48 del alcance. |
| SCARA | Y, Y, Y prismático, Y | J3 aumenta al bajar el husillo. |
| Delta | Tres actuadores paralelos y giro Y | Los ángulos de brazos superiores aumentan hacia abajo; el solver mantiene el cierre de las cadenas. |
| Cartesiano | X prismático, Z prismático, Y prismático | J3 positivo hacia arriba; carreras X/Z centradas. |
| Paletizador | Y, Z, Z, Y | Compensación de plataforma para conservar nivelada la herramienta. |
| AMR / AGV | Pose del chasis | La traslación del vehículo no se representa como seis articulaciones de un brazo. |
| Shuttle | X prismático | Carrera ±0,35 de la longitud del carril. |
| Cilíndrico | Y rotativo, Y prismático, X radial prismático | Columna, elevación y extensión con límites separados. |
| Polar | Y rotativo, Z rotativo, X radial prismático | Giro, inclinación y extensión telescópica. |
| Manipulador móvil | Pose del chasis y seis ejes del brazo | El brazo se acciona después del estacionamiento de la base. |
| Clasificador móvil | Pose del chasis y mecanismo de descarga | La cinta transversal o inclinación actúa frente al receptor reservado. |

La geometría y la simulación deben usar la misma cinemática directa/inversa de `modules/logistica-industrial/functions/robots/schema/robot-kinematics.js`. Una pose fuera de alcance se notifica; no se estira un eslabón para fingir que llegó. Las cadenas cerradas de Delta y la compensación del paletizador no son simples interpolaciones entre dos puntos.

## Escala, proporciones y postura de reposo

Las referencias de fabricante muestran que la escala debe elegirse por aplicación y carga. Un manipulador compacto para cajas pequeñas tiene otra envolvente que un paletizador pesado o una plataforma móvil. Valores consultados en documentación primaria:

| Referencia real | Alcance y carga publicados | Implicación de diseño |
| --- | --- | --- |
| [KUKA KR 10 R1100 WP](https://my.kuka.com/s/product/kr-10-r1100-wp/01t58000004l73ZAAQ?language=en_US) | 1,101 m; 10 kg; seis ejes | Una célula compacta no necesita un brazo de cinco metros. |
| [ABB IRB 1200 Gen2](https://www.abb.com/global/en/areas/robotics/products/robots/articulated-robots/small-robots/irb-1200-next-generation) | Variantes de 0,7/0,9 m; 5–9 kg | Alcance y capacidad pertenecen a una variante concreta. |
| [FANUC M-10iD/12](https://www.fanucamerica.com/products/robot/m-10id-12) | 1,441 m; 12 kg; seis ejes | Orden de magnitud para el nuevo manipulador genérico. |
| [UR10e, especificaciones del manual](https://www.universal-robots.com/manuals/EN/HTML/SW5_23/Content/prod-usr-man/complianceUR10e/H_g5_sections/appendix_g5/tech_spec_sheet.htm) | 1,3 m; 10/12,5 kg; huella Ø0,19 m | Una carcasa colaborativa puede tener una base estrecha; su seguridad no procede de la forma. |
| [FANUC M-410iC](https://www.fanuc.co.jp/en/product/robot/f_r_palletizing2.html) | Cuatro ejes; 110–500 kg; recorridos X de 2,403/3,143 m según variante | Se mantienen paletizadores y configuraciones industriales grandes cuando el proceso los requiere. |
| [OMRON MoMa](https://robotics.omron.com/products/mobile-robots/mobile-manipulator/) | Combina AMR y brazos TM; por ejemplo TM12S: 12 kg/1,3 m | El chasis, la capacidad del brazo y el montaje son componentes distintos; OMRON describe integración mediante partners. |
| [MiR250, especificaciones del fabricante](https://www.mobile-industrial-robots.com.cn/zh/products/robots/mir250/specifications) | 0,8 × 0,58 × 0,3 m; 250 kg | La capacidad de transporte de una plataforma no es la capacidad de la muñeca de un brazo. |

El preset propio `articulated-general` y el de proceso insertan ahora un brazo de **1,4 m**, capacidad simulada de **12 kg** y hombro a **0,45 m** del piso. Sus dimensiones de autoría son 0,8 × 0,8 × 1,6 m. El colaborativo conserva 1,3 m/8 kg con base de 0,35 m. El paletizador conserva 2,6 m/60 kg y no se convierte en un brazo ligero. Estos valores forman modelos didácticos propios; no reproducen una ficha ni una curva de carga de los fabricantes anteriores.

`reach` conserva el contrato de los documentos existentes: suma de los eslabones principales, repartidos 0,52/0,48 hasta la muñeca. La herramienta añade el desplazamiento previo de 0,20 m; la extensión recta máxima del TCP del articulado es, por tanto, `reach + 0,20`. No se cambian escalas, ejes ni longitudes para ocultar un destino fuera de alcance. Los valores explícitos guardados de alcance, base, capacidad, dimensiones y homes articulares se conservan, incluidos brazos grandes personalizados.

La postura genérica de reposo pliega hombro y codo: J2=1,4 rad, J3=−2,4 rad y J5≈−0,5708 rad, con la herramienta hacia abajo. En el preset de 1,4 m el TCP queda a unos 0,487 m de la base y 0,402 m del piso; el codo queda a 1,167 m. La postura anterior extendía el TCP horizontalmente a unos 1,84 m en el modelo de 2,2 m. En la integración anterior del laboratorio, pedir un único brazo para todas las posiciones de cuatro estibas elevaba el alcance hasta 5,5 m y su home calculado hasta 4,425 m: era una elección de disposición, no un fallo de conversión entre milímetros y metros.

Las carcasas de fundición perfiladas, el estrechamiento del antebrazo, las tapas y las conexiones del paralelogramo son geometría propia. Su organización visual toma como referencia arquitecturas industriales como [KUKA KR CYBERTECH nano](https://www.kuka.com/en-se/products/robotics-systems/industrial-robots/kr-cybertech-nano) y [ABB IRB 4600](https://new.abb.com/products/robotics/robots/articulated-robots/irb-4600); no incorpora logotipos ni atribuye sus prestaciones a nuestros modelos. La prueba dimensional verifica compactación, extensión real del TCP, IK y conservación de configuraciones guardadas; la prueba de diseño industrial comprueba las conexiones y sus presupuestos geométricos.

## Integración de flujo y límites

La secuencia necesita un producto existente en un equipo de origen, un robot disponible y un receptor compatible. El robot puede retener una carga y debe conservar su identidad, unidades, calidad y trazabilidad al transferirla. Una salida ocupada mantiene la carga retenida; una parada o emergencia no la elimina. El almacén de pallets mantiene su capacidad y patrón de apilado propios.

La boquilla de proceso funciona **in situ**: reserva el producto en su estación, aproxima, ejecuta el tiempo de proceso, registra la operación y se retira. No toma la caja con una boquilla ni cambia su propietario. El flujo normal de la estación continúa al liberar esa reserva. La herramienta y la operación de proceso se seleccionan juntas; pinzas y plataformas se usan para manipulación.

Un móvil necesita una estación de transferencia a la altura de su plataforma o un módulo elevador explícito. No debe presentarse una recogida abstracta entre una mesa de 1 m y una plataforma de 0,4 m como transferencia mecánica realista. Los ejemplos incluidos usan brazos y superficies a alturas compatibles; las misiones móviles mantienen ese límite de modelado documentado.

Las funciones son cinemática y eventos discretos en el navegador. No hay simulación de torsión, vibración, presión neumática, fricción de ventosas, deformación, colisiones de cada eslabón o PLC/ROS físico. La navegación móvil no es un gemelo de un LiDAR ni un sistema de SLAM: sus rutas y comprobaciones geométricas deben describirse como tales. El consumo de batería por distancia es un indicador didáctico, sin curva eléctrica, estación de carga ni calibración comercial.

La variante «apariencia colaborativa» modifica carcasas y consigna inicial. No habilita contacto humano seguro ni control de fuerza certificado. El botón de emergencia virtual es parte de la simulación; no es un dispositivo de seguridad industrial.

## Diseño paramétrico y coste gráfico

El objetivo es editar piezas seleccionadas con parámetros comprensibles: radios, chaflanes, dimensiones y perforaciones. Se construyen mallas acotadas para bases, eslabones, juntas, bridas y herramientas. No se integra un núcleo B-Rep, historial de restricciones, análisis de tensiones o ensamblaje de fabricación tipo Fusion/Inventor.

Los redondeos se reservan para siluetas y piezas observables. Tornillos, ventilación, juntas, etiquetas y desgaste deben compartir materiales y geometrías; los detalles pequeños se resuelven preferentemente con textura/normal y no miles de piezas únicas. El acabado por parte mantiene los metales, gomas y protecciones diferenciados.

La opción de detalle es una solicitud de autoría; los perfiles de rendimiento de móvil/Quest y la distancia pueden limitar el detalle realmente dibujado. No se debe asumir un presupuesto universal por robot: se mide el modelo construido, las llamadas de dibujo, texturas y FPS en el dispositivo. La apariencia realista depende también de la iluminación, sombras, materiales y composición del escenario.

## Verificación

En **Biblioteca → Equipos industriales → Robots y vehículos** están las quince variantes y los filtros por arquitectura. En **Escenas → Robótica industrial** se pueden crear variantes editables de «Manipulación y expedición» y «SCARA y clasificación». El inspector empieza por Transformación y Configuración del equipo; incluye postura inicial de ejes, herramienta, origen/receptor, parámetros de piezas y acabados independientes.

`npm run test:robots` verifica esquema, cinemática, persistencia, flujo, monitor, escenarios con colisiones, checkpoints y controles WebXR. `node tooling/qa/qa-robots-browser.js` usa Chrome, la aplicación compilada y una base temporal para revisar representaciones, edición paramétrica y líneas completas de seis cargas. No mide el rendimiento de un visor físico.

La prueba de geometría verifica las cuarenta y cinco combinaciones de variante/detalle y limita cada conjunto mecánico a menos de 18.000 triángulos. El rediseño de carcasas usa lofts indexados de sección curva variable, hombro volumétrico, reductores laterales y tapas de servicio estrechas. Los apoyos del paralelogramo siguen las articulaciones y las etiquetas se proyectan sobre la superficie real. Se conservan los centros de los ejes, el TCP y los materiales editables por pieza.

Los máximos medidos para detalle ligero/equilibrado/alto son 5.064/9.588/14.360 triángulos y aproximadamente 0,21/0,36/0,61 MiB de buffers geométricos. Tornillos y aletas repetidos usan instancias. El panel, los materiales y el entorno se miden por separado; estos límites no predicen FPS. `test-robot-industrial-design.js` comprueba curvatura transversal, estrechamiento real, apoyos mecánicos, etiquetas y conservación del TCP; `test-robot-dimensions.js` comprueba las proporciones y las poses guardadas.

`node tests/legacy/test-robot-schema.js` comprueba presets de las familias, límites articulares, rutas acotadas, referencias de objeto y admisión por masa/gálibo. Las pruebas de cinemática y de flujo deben comprobar además alcance, cierre del Delta, reservas de salida, conservación de productos al parar y funcionamiento de cada familia. La revisión visual y la prueba física en Quest son comprobaciones separadas de esas pruebas numéricas.

La biblioteca incluye «Robótica · Manipulación y expedición» y «Robótica · SCARA y clasificación». Sus recetas utilizan tres formatos, Sources, bandas y almacenes con panel y monitor comunes. `tests/legacy/test-robot-study-scenes.js` verifica 60 segundos con el mundo de colisión y el entorno CEDI completo: seis cargas en expedición y reparto cuatro/dos por calidad en clasificación. `tests/legacy/test-robot-checkpoint.js` verifica reanudar el movimiento y la pausa, las mordazas, el setup, una ruta móvil, el proceso in situ y la presentación de un observador compartido sin separar la carga de la herramienta.

Las nuevas instancias de «CEDI · Clasificación y consolidación», «CEDI · Packing y transferencias» y el laboratorio industrial completo integran tres células de manipulación sobre conexiones existentes: carga desde Source/FIFO, transferencia entre equipos y descarga a almacén. La pinza reserva, levanta y deposita la misma entidad; no genera copias ni cambia sus unidades o atributos. La selección excluye tramos manuales, rodillos por gravedad y líneas de pallets. Las máquinas originales conservan posición, dimensiones e identificadores. Cada célula comprueba apoyo en piso y alcance de sus contactos, aproximaciones y alturas de apilado; si no cabe, la integración informa de la omisión.

La acción «Integrar robótica» adapta explícitamente un nivel guardado. Usa `refitRobotCells: true` para recolocar las células generadas antiguas y recalcular alcance, base y reposo con objetivos reales y apoyo en piso. Conserva los identificadores, conexiones, colores, herramienta y consignas personalizadas. Si una arquitectura fue personalizada o no cabe una solución válida, conserva esa célula y muestra un aviso. Repetirla no duplica las células, incluso si el laboratorio añadió prefijos numéricos a sus nombres. En niveles de la integración anterior reutiliza el identificador del robot de proceso y conserva la posición y personalización del montacargas existente. Los pallets ya editados por el usuario no se reemplazan. No se modifican automáticamente proyectos privados.

La expedición tiene su propio Source de pallets completos de doce unidades, cadenas con paro de salida enclavado y bahías de recepción a nivel del piso. El montacargas transporta esa entidad completa entre ambos, con sus huecos físicos, tara y contadores. La recogida y entrega son manuales: tras retirar las uñas se rearma la cadena con Marcha local; dos bahías llenas requieren retirar o despachar una carga antes de recibir más. No se agregan cajas sueltas de otros almacenes sobre un pallet ficticio.

`tests/legacy/test-cedi-robotics.js` ejecuta cien segundos de cada uno de los tres escenarios con geometría y colisiones reales, exige completados de carga, transferencia y descarga, conserva masa/unidades y verifica restauración e idempotencia. `tests/legacy/test-cedi-robotics-placement.js` cubre piso rotado, paredes, falta de espacio y migración de la integración anterior. La prueba de logística recorre el Source, paro real de cadenas, inserción de uñas, retirada y entrega mediante el vehículo; estas pruebas no sustituyen la validación con un visor físico.
