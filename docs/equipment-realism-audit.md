# Auditoría y mejora de los equipos nativos

## Diagnóstico

El taller separado de Anatomy construía ilustraciones mediante sus propias
plantillas. Esas piezas no eran los eslabones, mecanismos y controles del robot
o montacargas de la simulación. Por tanto, editar esa plantilla no mejoraba el
equipo funcional. Se retira del catálogo y de los archivos distribuidos al editor.
Se conservan la lectura de diseños ya guardados y las pequeñas matemáticas de
proyección MIT que sí utiliza el monitor técnico de los objetos nativos.

La falta de realismo no se resuelve aumentando polígonos de forma indiscriminada.
Se identificaron defectos concretos:

| Área | Defecto | Corrección |
| --- | --- | --- |
| Hombro del robot | Pedestal, yugo y tapas ocupaban la misma zona de la articulación. | Carcasas separadas, alojamiento de rodamientos y tapas exteriores; se conservan los centros cinemáticos. |
| Carrocería del montacargas | Bloques extruidos con biseles repetidos y transición poco natural. | Perfiles de fundición redondeados, contrapeso de sección variable, ventilación y juntas de servicio. |
| Neumáticos | Orientación incorrecta de tacos respecto a la tangente de la rueda. | Rodadura orientada y distribuida sobre el neumático. |
| Paneles | Botones grandes, etiquetas próximas y colocación automática dentro del espacio de trabajo. | Distribución por máquina, relieve respecto a la puerta real, consola inclinada y panel del robot detrás y al lado de su base. |
| Entrepaños | Superficie gris y parte superior del larguero coincidían. | Apoyo del larguero bajo el espesor del entrepaño; la altura del pallet permanece igual. |
| Largueros curvos | Los tramos de perfil se alargaban para tapar uniones, superponiendo caras. | Uniones a inglete y eliminación de cobertura repetida donde se comparte un tramo. |

## Modelo visual, mecanismo y funcionamiento

Las mejoras se aplican a las fábricas nativas existentes. No se inserta un modelo
alternativo para sustituir la simulación. Permanecen los puntos de conexión,
articulaciones, TCP, horquillas, asiento, mandos, identidad de las cargas y
propiedades del proyecto. Los componentes llevan identificadores semánticos para
relacionar una superficie con su función y su documentación.

En robots se comprueban los núcleos de los brazos frente a sí mismos y frente a
superficies sólidas. Las uniones y rodamientos tienen contactos intencionales:
no se clasifican como fallos por una simple intersección de cajas envolventes.
El control no es una certificación de colisión de cada tornillo, cable o montaje
imaginable. Una celda antigua físicamente incompatible puede requerir recolocar
su mesa o receptor; no se mueve automáticamente el contenido de un usuario.

## Estudio y programación

**Estudiar equipo** abre el objeto que existe en el escenario. Permite consultar
ficha y telemetría, resaltar y aislar componentes, orbitar, separar piezas y pasar
a proyección 2D. La ficha distingue piezas presentes en la geometría de contenidos
conceptuales, por ejemplo electrónica interna que aún no tiene una malla propia.

Se explican mecánica, energía, sensores, señales, control, software, diagnóstico
y prácticas. Los valores configurados proceden del documento o del runtime,
sin presentarlos como especificaciones certificadas de Toyota, CAT o un robot
OEM. La configuración usa el inspector y los validadores existentes. La
programación incorpora reglas JSON de automatización con previsualización,
validación, permisos y deshacer. No ejecuta JavaScript recibido de Internet ni
código destinado directamente a un controlador industrial real.

La consulta pública no concede edición. En RV inmersiva se mantienen los mandos
espaciales; esta ficha de estudio se abre antes o después de la sesión inmersiva.

## Flujo de modelado avanzado

Blender 5.2 actúa como herramienta de autoría fuera del navegador. La ficha puede
exportar el GLB del equipo actual o un paquete de geometría nativa. El flujo
`tooling/modeling/` también exporta directamente las mismas fábricas del motor.

```powershell
node --openssl-legacy-provider tooling/modeling/export-native.cjs --kind vehicle --variant forklift-electric-4w --output machine.json
node tooling/modeling/build.cjs --input machine.json --output machine-web.glb --profile quest
node tooling/modeling/validate-glb.cjs machine-web.glb quest
```

El paquete JSON conserva jerarquía, geometría, normales, UV y factores de material;
no contiene todas las imágenes de textura. Para trasladar las imágenes se utiliza
el GLB exportado desde la ficha. Un mapa de altura `bumpMap` del motor no equivale
automáticamente a una normal tangente glTF: debe convertirse o cocinarse en la
herramienta de autoría antes de exigir ese mismo detalle en otra aplicación.

La conversión conserva pivotes y nombres, consolida únicamente superficies rígidas
hermanas del mismo componente, elimina alias de materiales que crearían llamadas
de dibujo adicionales y escribe un recibo de auditoría. Los perfiles establecen
35.000 triángulos por equipo y texturas de 512 px para Quest; escritorio permite
70.000 y 1.024 px. Son presupuestos de autoría, no garantías de FPS de una escena.
La reducción LOD es explícita; se protegen componentes de contacto. No se
sustituye automáticamente un equipo operativo por un archivo estático.

Antes de importar un GLB, el validador rechaza dependencias externas, referencias
de buffers inválidas, accesores que salgan de su propio `bufferView`, matrices
mal formadas e imágenes sin cabeceras PNG/JPEG válidas. Comprueba las dimensiones
antes de decodificar: la entrada admite hasta 4.096 px por lado, 64 millones de
píxeles acumulados y 64 MiB; la salida debe cumplir el tamaño del perfil elegido.
Esto limita recursos; no sustituye un decodificador ni certifica todos los campos
del estándar glTF. Las superficies de distintos `robotJointId` nunca se consolidan
en el mismo lote. Los archivos de salida y sus informes deben tener destinos nuevos.
El paquete JSON nativo también se valida antes de lanzar Blender: los costes se
calculan por cada instancia de geometría, incluidos sus vértices no utilizados,
sin confiar en los recuentos declarados. Se rechazan identificadores repetidos,
referencias ausentes, ciclos y jerarquías excesivamente profundas. Este formato
no es un importador universal de archivos CAD o scripts externos.

## Fidelidad y evidencia

Las fotografías aportadas permiten una aproximación visual genérica. Una réplica
dimensional exacta, incluidos interiores, exige planos o CAD del modelo concreto,
medidas, materiales y calibración de articulaciones. No sería correcto deducir
de una sola fotografía la posición de todos los componentes ocultos.

Las fuentes técnicas consultadas son la [descripción de robots de Universal
Robots](https://docs.universal-robots.com/Universal_Robots_ROS2_Documentation/doc/ur_description/doc/index.html),
la [ficha oficial Toyota Core IC Pneumatic](https://www.toyotaforklift.com/content/dam/tmh/marketing/en/pdf/product-spec-brochures/2023_Core%20IC%20Pneumatic_Spec%20Sheet_Digital.pdf),
el [exportador glTF de Blender 5.2](https://docs.blender.org/manual/fr/5.2/addons/scene_gltf2.html),
las [normales ponderadas de Blender](https://docs.blender.org/manual/en/5.1/modeling/modifiers/normals/weighted_normal.html)
y el modelo de materiales [PBR de Khronos](https://www.khronos.org/gltf/pbr).
Se utilizan como referencias de estructura, flujo y materiales; no como permiso
para afirmar una réplica OEM o incorporar una marca al modelo genérico.

La validación debe combinar geometría, recorridos y cargas reales, cambios de
configuración con deshacer, guardado y reapertura, imágenes comparables y pruebas
del navegador con artefactos compilados. La prueba física en un visor Quest es una
validación adicional; no se infiere de una prueba de escritorio.

La comparación de cuatro equipos reales de la misma escena, conservando su
iluminación y configuración, produjo estos recuentos en el navegador:

| Equipo de la comparación | Triángulos anteriores | Triángulos nuevos | Draws nuevos |
| --- | ---: | ---: | ---: |
| Robot articulado con panel | 10.624 | 9.792 | 96 |
| Montacargas | 30.460 | 25.872 | 159 |
| Transportador | 15.120 | 15.120 | 123 |
| Estantería | 5.512 | 5.512 | 6 |

Estos números describen esos ejemplares y su nivel de detalle, no todos los
equipos posibles. Las 39 combinaciones de vehículo/calidad y los 45 perfiles de
robot tienen pruebas adicionales de presupuesto y geometría. El número de
llamadas de dibujo del montacargas crece respecto a la comparación anterior,
aunque permanece dentro del presupuesto: la reducción de triángulos no sustituye
una medición completa de rendimiento.

## Evidencia y límites de esta entrega

La ficha se verificó en las aplicaciones compiladas, con cuatro equipos del
escenario, seis articulaciones reales, cuatro exportaciones GLB y doce capturas
de escritorio y móvil. También se comprobaron el aislamiento de piezas, las
reglas con validación y deshacer, el cierre del contexto gráfico y la consulta
pública sin permiso de editar. El encabezado tiene estilos propios, los
controles se comprueban mediante hit testing y el plano 2D conserva la proporción
real de su contenedor.

La comparación de equipos probó ocho paneles y dieciséis monitores. Las tres
misiones de almacén se completaron con cargas reales y nueve ciclos de bajar y
volver a subir al vehículo. Las pruebas de migración usan poses históricas de
los cuatro paneles: sólo actualizan grupos automáticos reconocidos y conservan
posiciones, rotaciones, escalas, materiales y recursos personalizados.

La revisión amplia ejecutó 174 comandos de regresión: 173 aprobaron después de
corregir la migración de controles y actualizar dos recuentos de geometría que
incluían superficies retiradas. La prueba prolongada
`test-continuous-industrial-examples.js` fue interrumpida por el límite externo
de 600 segundos del lanzador; había avanzado 600 segundos simulados del
laboratorio sin un fallo de aserción. No se marca como aprobada la ejecución
completa de sus tres escenarios de 1.200 segundos. No queda ese proceso en
ejecución. Tampoco se realizó una prueba física en Quest 3.

Las pruebas del framework que copian y retiran funciones temporales comparten
el árbol de módulos. Su comando se ejecuta en serie para evitar que un
descubrimiento lea una copia que otra prueba está retirando; se mantienen todas
las aserciones. Los informes locales de esta actividad se conservan en
`output/equipment-realism-2026-11-01/`, fuera de los archivos publicados.
