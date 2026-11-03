# Revisión de controles, arquitectura y seguridad de prácticas

Fecha: 3 de noviembre de 2026. La revisión usa datos, cuentas y documentos temporales. No modifica credenciales ni proyectos privados del usuario.

## Fallos corregidos

| Fallo observado en código | Corrección y evidencia |
| --- | --- |
| Los campos de layout usaban el centro de la tabla del documento; el compilador esperaba coordenadas X/Z centradas. Cambiar un eje desplazaba también el otro por media instalación. | Un conversor común usa `layoutBindings.sourceCenter`. Al configurar un montaje activo conserva `actualPose`, incluyendo los ajustes técnicos y el giro, siempre que correspondan a la misma práctica y modalidad. El formulario identifica el sistema de coordenadas. |
| Cambiar de modalidad desde RV conservaba equipos y posiciones de la modalidad anterior. | La selección de automatización limpia esas alternativas, reinicia sus índices y mantiene el contrato canónico del nuevo montaje. Los ajustes repetidos permanecen dentro de ±250 m y ±360°. |
| Un error al iniciar la práctica se borraba inmediatamente durante el `finally` del formulario. | El mensaje se conserva hasta la siguiente edición. Un número de posición inválido bloquea el inicio y no inicia silenciosamente con el valor anterior. |
| Una compilación o petición de progreso pendiente podía volver después de retirar el anfitrión de prácticas. | `dispose()` es idempotente, revoca el contexto e invalida la generación asíncrona. Una respuesta tardía no puede reemplazar la escena ni repoblar el catálogo retirado. |
| El mismo agarre manual usado para una caja permitía levantar un pallet cargado completo. | En prácticas configurables de la sala activa, el agarre rechaza pallets cargados y cargas individuales mayores de 25 kg. Las cajas ligeras y pallets vacíos siguen disponibles para picking. El montacargas conserva su custodia y controles nativos. Es una política didáctica acotada, no un cálculo ergonómico certificado. |
| Los archivos glTF/OBJ/FBX importados podían solicitar recursos auxiliares en una dirección externa aunque el archivo principal estuviera restringido a `/api/assets/<hash>`. | El gestor de recursos rechaza protocolos externos, direcciones relativas a otro host, formas codificadas y escapes del directorio de decodificadores. Conserva los archivos declarados del mismo lote, datos/blob locales y cinco archivos exactos de Draco/Basis propiedad de la aplicación. No era una petición del servidor: el riesgo observado era una petición del navegador a un tercero. |

Las reglas de transporte manual afectan al mismo comando usado por ratón, táctil y gatillo/agarre XR. No se ha cambiado retroactivamente el comportamiento de niveles industriales anteriores.

## Fronteras comprobadas

Los endpoints de prácticas siguen detrás de la sesión y la identidad esperada del host. Las escrituras mantienen comprobación de origen/CSRF, cuotas de intentos y cuerpos acotados. Intentos, checkpoints y progreso se consultan por propietario. Los recibos se contrastan con el lote, configuración, actores y seis etapas canónicos; no se desbloquea la campaña con una casilla del formulario. Esta validación educativa recibe evidencias del cliente: no es un servidor físico autoritativo ni un sistema antitrampas.

El paquete público mantiene una sola demostración. Los manifiestos y hashes verifican los recursos publicados; archivos privados, esquemas de prácticas, base SQLite, rutas fuera de la distribución y campos públicos desconocidos se rechazan. Los contenidos DOCX/TXT son texto inerte y las referencias a imágenes se restringen a recursos locales declarados.

El núcleo, contratos y SDK genéricos conservan independencia del renderer y de los sectores. Las composiciones seleccionan funciones y preservan datos de módulos desactivados. El editor industrial sigue usando el adaptador `logistics.workspace`, con imports heredados del sector y ciclo de vida de página; desactivar un módulo no elimina mágicamente su código del bundle industrial ni lo convierte en desmontable en caliente. Una función importada es código local confiable, no un plugin hostil dentro de un sandbox. Véase [módulos del framework](framework-modules.md).

## Evidencia automatizada

- Arquitectura, módulos por proyecto, paquetes, API de prácticas y fronteras de publicación: **50 pruebas aprobadas y una omitida** por disponibilidad de enlaces simbólicos en Windows.
- Interfaz de configuración y controles XR: **20 pruebas aprobadas**, con entradas reales de formulario, teclado de controlador, coordenadas y regiones de pulsación dentro de la textura.
- Anfitrión y registros nativos de recepción: **8 pruebas aprobadas**, incluyendo retirada durante compilación y petición de progreso pendientes.
- Manipulación manual: **3 pruebas aprobadas** con geometría, productos y runtime nativos. El rechazo conserva matriz, cantidad de objetos y custodia.
- Diez scripts legacy de controles aprobados: dispositivos, conducción, mando/volante externo, agarre XR, sesión XR, locomoción, aislamiento de menú, salida XR, distribución de panel de cabina y menú inmersivo.
- Importaciones: `test-editor-assets.js` conserva la carga real de recursos glTF, imágenes y referencias hash, y rechaza direcciones externas auxiliares, variantes codificadas y escapes de decodificadores.
- Una prueba de fronteras gráficas comprueba API, documento, materiales de equipos, entorno y CAD con cadenas `rgb(`/`hsl(` incompletas de 50.000 espacios: se rechazan antes de `Three.Color.setStyle`. Es evidencia de esos caminos concretos, no una corrección de la dependencia vulnerable.
- Quince regresiones de bancos de dibujo conservan geometría, UV, colores, materiales, rayos, identificadores y movimiento de articulaciones. Comprueban retirada ante cambio de holograma/visibilidad, movimiento de un ancestro o deformación de un buffer; color lineal, pulsadores independientes, cambio de padre de un producto, instalación restaurada desde disco y liberación sólo de los buffers/materiales privados. Si falla esta optimización opcional, continúa el runtime con dibujo individual.

Los logs de esta revisión permanecen fuera de Git, en `output/practice-facility-audit-2026-11-03/`. El sondeo de navegador de instalaciones tiene un informe separado en `data/qa-studio/practice-facilities/` al ejecutarlo contra los artefactos finales. Una prueba de controlador simulado no sustituye la comprobación física de Quest 3, teléfono, mando o volante/pedales; tampoco establece FPS o consumo real de GPU en esos dispositivos.

### Recepción de materias primas SF-01

La prueba nativa de la configuración **manual, caso A, baseline** traslada los dos pallets originales desde el camión hasta dos niveles distintos del rack. Envía dirección, pedales, elevación y comandos G/K; no escribe transformaciones de actores, articulaciones ni pertenencia del inventario. Recorre 97,10 m en 41.874 actualizaciones de 1/60 s, sin contactos bloqueados. Los mismos pallets conservan 12 cuerpos, 12 tapas y 48 tornillos, con 33,92 kg por pallet. Las seis evidencias se aceptan en `PracticeSession` y el intento termina aprobado.

El recorrido rodea físicamente la zona de cuarentena. Para el segundo nivel, el operador se detiene en el pasillo libre y eleva antes de entrar al rack: aproximarse con carga baja toca correctamente el pallet ya almacenado debajo. No se han desactivado colisiones ni ampliado tolerancias para hacer pasar el ensayo. La evidencia queda en `data/qa-studio/configurable-practices/raw-receiving-two-pallets.json`; otras modalidades, alternativas de equipo y layouts editados conservan su estado de validación independiente.

## Dependencias pendientes

`npm audit --json` consultó el registro el 3 de noviembre de 2026, sin instalación ni `audit fix`: **77 avisos** (14 críticos, 45 altos, 12 moderados y 6 bajos). El reporte completo se guarda localmente en `data/qa-studio/practice-facilities/dependency-audit.json`.

El conteo incluye herramientas de desarrollo y compilación; la API de producción no usa `webpack-dev-server` como servidor. Entre las dependencias directas señaladas figuran Three.js, Webpack, webpack-cli, webpack-dev-server y troika-3d-text. El [aviso de Three.js](https://github.com/advisories/GHSA-fq6p-x6j3-cmmq) y los enlaces del informe permiten estudiar sus condiciones concretas. La migración del motor y de la cadena de compilación permanece pendiente; no se aplican actualizaciones mayores sin validar los modelos, WebXR, materiales y controles existentes.

### Alcance real de los avisos

La instalación consultada resuelve Three **0.112.1**, webpack-dev-server **3.10.1**, Babel traverse **7.6.3**, pbkdf2 **3.0.17** y url-parse **1.4.7**. `fsevents` y `tar` figuran en la resolución auditada, pero no se resuelven como paquetes instalados en este árbol de Windows. El registro contiene avisos graves, incluido el de una versión antigua de fsevents; que una dependencia sea opcional o de compilación no convierte su instalación ni una futura cadena de suministro en segura.

| Superficie comprobada | Resultado y límite |
| --- | --- |
| Motor que llega al navegador | Three está afectado por el [ReDoS de colores CSS incompletos, corregido en 0.125.0](https://github.com/advisories/GHSA-fq6p-x6j3-cmmq). Los validadores nativos exigen `#RRGGBB`; las pruebas cubren esos canales. Los importadores actuales admiten GLB/glTF/OBJ/FBX, con componentes numéricos en sus caminos de color. La biblioteca permanece antigua y no se afirma haber auditado cada camino de sus parsers. |
| API y contraseñas | `npm start` ejecuta `apps/api/index.cjs`, basado en HTTP/HTTPS nativos. La sesión usa `node:crypto.scrypt` y `timingSafeEqual`; no usa el paquete pbkdf2 señalado por el audit para derivar contraseñas. Esta lectura no prueba la ausencia de otras vulnerabilidades de ejecución. |
| Subida y publicación | Se mantienen validadores de árbol, rutas, identidad, límites de contenido y recursos hash; no se evalúa el texto de DOCX/TXT, XML o JavaScript subido. SVG no se interpreta como código por un parser del servidor; los recursos activos se entregan con política de contenido y disposición restrictivas. Los modelos auxiliares externos ahora se bloquean también en el navegador. |
| Herramientas de desarrollo | Webpack/Babel y el servidor de desarrollo siguen en la instalación. Babel procesa código de compilación; webpack-dev-server tiene sus propios avisos de exposición de fuentes. No deben presentarse como servicios del despliegue de API por el solo hecho de aparecer en `dependencies`, ni ignorarse por esa misma razón. |

La siguiente intervención de seguridad debe separar herramientas de compilación de dependencias de servicio, actualizar primero la cadena de compilación y sus paquetes transitivos en una rama validada, y migrar Three/Troika con pruebas de GLB, materiales, raycast, XR y exportación. En particular, los bancos de dibujo utilizan el contrato comprobado de capas de Three r112: una migración debe adaptar ese contrato si Raycaster empieza a filtrar capas. Repetir `npm audit` y las pruebas de publicación después de cada actualización; no usar `audit fix --force` como validación funcional.

## Optimización medida de equipos

`RuntimeNativeRenderBanks` añade bancos de dibujo para descendientes estáticos bajo el mismo anclaje rígido, con un máximo de 2.048 superficies candidatas y 8 MiB de buffers privados. Conserva los originales como objetivos de física, estudio, exportación y selección. Respeta articulaciones, rigs y controles independientes; los aros fijos de un único pulsador sólo pueden compartir un banco exacto anclado al mismo pulsador. Pantallas vivas, piezas transparentes y tapas de botones mantienen sus dibujos. Una pieza o ancestro que anime su transformación local vuelve al dibujo individual hasta el siguiente ensayo, evitando reconstrucciones por fotograma.

Los clones con iguales propiedades de render, texturas y shader pueden compartir su representación; cada original conserva su material editable. Cuando materiales opacos Standard/Basic sin texturas sólo difieren en color, un material privado blanco usa RGB lineal por vértice. Cambiar un acabado reconstruye o separa el banco; detener o editar restaura las capas y libera sólo recursos privados. Los productos conservan su raíz móvil. Para la instalación, los IDs persistidos de `facility.objects` autorizan bancos bajo la sala actual: las particiones físicas de paredes permanecen separadas, incluyendo después de guardar y cargar.

La matriz de **30 configuraciones aprobadas** registra geometría autoral residente y todos los bancos realmente enviados, incluidos los compartidos bajo la sala. El presupuesto de regresión de **400 envíos no se elevó**. En cuatro montajes automáticos, las cuentas nativas pasan de 403 a 284 (CEDI-01), 441 a 338 (CEDI-04), 456 a 378 (SF-04) y 441 a 340 (SF-05), conservando exactamente los triángulos visibles. Diez configuraciones siguen por encima del objetivo de revisión de 250 envíos. El runtime incorpora además ayudas y material operativo; el informe final de navegador debe mostrar sus costos en vivo. Estas cuentas no certifican FPS de Quest 3.




## Diez operaciones materiales comprobadas: manual, caso A

Las diez regresiones de la tabla terminaron aprobadas con el montaje preparado del documento, equipos predeterminados y sin cambios de layout. Se usaron actores, inventario, colisiones, controles y tiempos de máquina nativos. Los formularios registran comprobaciones; no teletransportan ni generan material. Las pruebas de transporte envían pedales, dirección, elevación y agarre/depósito; las de manipulación envían el movimiento del controlador y liberan el producto sobre su soporte real. Ninguna prueba escribe poses o custodia para completar la tarea.

Los tiempos son segundos del reloj de simulación del ensayo completo, incluyendo maniobras del operador de prueba. No son tiempos industriales certificados ni tiempos de ejecución de Node. «Sin recibo temporal» significa que la prueba aprobada no exportó ese dato, no que la operación sea instantánea. Los archivos indicados son la evidencia ejecutable; los recibos JSON locales complementan esos resultados.

| Práctica | Material, máquinas y transporte realmente ejercitados | Conservación y resultado físico | Tiempo simulado | Prueba aprobada |
| --- | --- | --- | --- | --- |
| CEDI-01 · Recepción | Descarga de seis pallets desde el camión, inspección física, liberación y registro de cada lote; conducción hasta seis soportes de salida. | Los seis pallets originales de 60 kg conservan sus 48 cajas; origen 0, destino 48, cero contactos en 578,76 m. | 2.699,7 s | `tests/native/configurable-practice-receiving-native.test.mjs` |
| CEDI-02 · Almacenamiento y reposición | Seis pallets se asignan a dos racks y tres alturas; entrada, depósito y retirada con el retráctil. Después se repone con el mismo primer pallet. | 48 cajas originales; seis ubicaciones y posterior reposición comprobadas, sin crear una carga sustituta. | Sin recibo temporal | `tests/native/practice-putaway-native.test.mjs` |
| CEDI-03 · Picking y consolidación | Tres bultos físicos de cuatro cajas salen del rack por agarre y barridos del controlador, hasta tres posiciones de pedido distintas. | Pedido de 12 cajas cumplido; otras 12 permanecen en origen. El balance conserva las 24 cajas existentes. | Sin recibo temporal | `tests/framework/configurable-practice-material-fixtures.test.mjs` |
| CEDI-04 · Empaque y paletizado | Empaque BOM, ciclo de acabado e inspección, dos pallets físicos de seis cajas y traslado con la transpaleta a sus dos receptores. | 12 productos + 12 cartones + 12 etiquetas conservan sus 36 identidades de componente y masa; 12 cajas finales, dos pallets; cero contactos en 67,84 m. | 803,9 s | `tests/framework/practice-packing-native.test.mjs` · caso CEDI-04 |
| CEDI-05 · Expedición | Aseguramiento documental del muelle y conducción de dos pallets hasta dos posiciones reales sobre la cama del camión; retirada completa de horquillas. | Dos pallets originales, 12 cajas y custodia final en el camión; cero contactos en 155,69 m. | 815,1 s | `tests/framework/practice-dispatch-native.test.mjs` |
| SF-01 · Materias primas | Dos pallets multirreferencia desde la cama del camión a dos alturas del rack; inspección, lote y cierre. | 12 cuerpos, 12 tapas y 48 tornillos, 33,92 kg por pallet; cero contactos en 97,10 m. | 698,0 s | `tests/native/configurable-practice-raw-receiving-native.test.mjs` |
| SF-02 · Abastecimiento y kits | Nueve contenedores originales se extraen del rack y alimentan tres ciclos BOM; cada kit se lleva a su receptor real. | Tres kits de 4 cuerpos + 4 tapas + 16 tornillos cada uno; se conservan los 72 componentes y su masa. | 114,8 s | `tests/framework/practice-kit-native.test.mjs` |
| SF-03 · Transformación | Tres lotes de cuatro cuerpos pasan por sujeción, mecanizado, medición y tres posiciones WIP. Incluye rechazo y recuperación de un lote cargado inicialmente en la estación equivocada. | Los mismos 12 cuerpos; historial ordenado de las tres operaciones. La pausa detiene el ciclo real y cada nuevo ciclo necesita permiso explícito. | 148,7 s | `tests/native/practice-machining-native.test.mjs` |
| SF-04 · Ensamble y calidad | Alimentación de cuerpos/tapas/tornillos, 12 ciclos de ensamble, banco de prueba y 12 posiciones de salida reales. | 72 componentes originales se transforman en 12 conjuntos identificados; componentes y masa conservados, sin contar un conjunto como seis piezas terminadas. | 185,5 s | `tests/framework/practice-assembly-native.test.mjs` |
| SF-05 · Terminados y despacho | Empaque BOM de 12 cajas, paletización física de 12 unidades y conducción del pallet hasta el receptor CEDI interno. | Los 36 componentes originales permanecen en la genealogía de las 12 cajas; un pallet físico, cero contactos en 27,71 m. | 339,8 s | `tests/framework/practice-packing-native.test.mjs` · caso SF-05 |

Los recibos de CEDI-01, SF-01 y SF-03 están en `data/qa-studio/configurable-practices/`; los de CEDI-04, CEDI-05, SF-02, SF-04 y SF-05 están en `data/qa-studio/practice-facilities/`. Las pruebas CEDI-02 y CEDI-03 comprueban directamente los estados nativos; no se ha inventado un recibo externo para ellas. Las seis evidencias de misión se contrastan con alias, material y secuencia. La existencia de geometría o inventario inicial no otorga evidencia de trabajo completado.

Para evitar confundir pedido e inventario en CEDI-03, `totalUnits` e `initialUnits` conservan la escala del pedido de 12 para `PracticeSession`, mientras `materialBalance` comprueba las 24 cajas físicas. `stockSourceUnits` muestra el origen real, 24 al iniciar y 12 al terminar; `orderRemainingUnits` pasa de 12 a 0. El rótulo «En origen» utiliza el stock físico si está disponible y conserva el contador anterior para niveles heredados. Esta separación no modifica la puntuación, los umbrales de la sesión ni la custodia.

La tara de los pallets preparados se declara explícitamente en 20 kg donde corresponde al material de la guía; los pallets heredados sin declaración mantienen su tara automática anterior. Una prueba específica conserva geometría, ida/vuelta de documento y validación API, y contrasta 60 kg = 20 kg de pallet + 8 cajas de 5 kg.

`Recipes.VERIFIED_MATERIAL` enlaza estas diez pruebas. La disponibilidad evaluada se limita a **manual + caso A + equipos predeterminados + layout preparado sin overrides**. Modalidades semiautomáticas/automáticas, casos alternativos, sustituciones de equipo y posiciones editadas siguen disponibles como montajes de consulta o preparación, con evaluación pendiente de su propia prueba material completa. No heredan una aprobación por parecerse al baseline. La dificultad y las ayudas se configuran aparte; una ruta dibujada orienta al operador y no sustituye el barrido de colisiones ni obliga a recorrer puntos artificiales cuando existe un recorrido físico seguro.

Estas pruebas no certifican FPS, memoria ni comodidad física en Quest 3 o teléfonos. La verificación final de navegador y los dispositivos reales continúa siendo una capa distinta de esta evidencia del motor.
