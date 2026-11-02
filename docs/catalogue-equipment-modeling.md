# Modelos nativos del catálogo industrial

La biblioteca reutiliza los actores, puertos, mecanismos y custodia del simulador. No introduce otro taller de modelos ilustrativos. La identidad de cada equipo es `catalogueEquipmentId`; una selección de herramienta utiliza `catalogueToolId`. Los códigos abreviados de las dos ediciones documentales pertenecen a espacios de nombres distintos y no prueban que una capacidad esté implementada.

## Geometría y materiales

`functions/equipamiento/runtime/EquipmentGeometry.cjs` contiene recetas paramétricas específicas para máquinas, embalaje, transporte, auxiliares, productos y herramientas. Consume el mismo `layout` que el runtime. Conserva las piezas y actores nativos cuando ya existe un mecanismo válido; los cuerpos nuevos sustituyen únicamente las ranuras mecánicas previstas y liberan los buffers anteriores. El panel, los descendientes de control y los IDs operacionales permanecen en su lugar.

Los equipos existentes reciben perfiles huecos o bordes de chapa, clasificación de materiales, componentes semánticos y color lineal. Pintura, acero, aluminio, caucho, plástico, madera y cartón tienen propiedades PBR diferentes. El microacabado usa mapas pequeños propios de cada material. Las identificaciones y advertencias se proyectan con el sistema existente sobre caras reales: no son planos opacos flotantes ni carcasas duplicadas. Se conservan las asignaciones de acabado realizadas por el usuario.

Las recetas nuevas incluyen, entre otras, husillo/plato/mordazas y bancada del torno, cabezal de mecanizado, columnas y molde de inyección, punzón/matriz, dosificación, encintado con bobina hueca y plegadores, mesa de envoltura apoyada sobre pedestal, mecanismos de picking y transporte helicoidal. Los buffers de entrada y salida tienen apoyos visibles en sus posiciones autoritativas; el cuerpo conserva su tamaño configurado aunque el área total incorpore esos buffers.

## Movimiento y contacto

`animateEquipment` recibe el progreso y estado reales del procesador desde `IndustrialVisuals`. Mueve componentes separados, no toda la carcasa. Una pausa, emergencia, falta de alimentación o espera de operario detiene la pose. No hay un reloj paralelo que complete operaciones por su cuenta. Los movimientos de prensa, husillo, bobina o dosificación son representaciones de un ciclo educativo; no calculan corte, deformación, temperatura, presión ni fluidos continuos.

El almacenamiento cúbico usa pilas apoyadas en la base, guías de columna y un extractor que sujeta el borde superior del bin. El carro espera por encima de la entrada. La altura de las guías y la del puente superior son contratos distintos para que la carga viaje sobre las columnas y bajo el puente. El carrusel implementado es **horizontal, de bandejas niveladas**, con dirección y códigos solidarios con cada bandeja; no se presenta como réplica de un carrusel vertical del documento ni de un producto OEM.

Las 32 herramientas acoplables utilizan la muñeca y TCP del robot existente. Sus marcos de brida/contacto convierten el eje de aproximación del modelo al eje nativo sin cambiar FK/IK. Las pinzas tienen dedos y superficies de contacto propios; los rieles se adaptan al movimiento. Las horquillas mantienen el apoyo inferior, profundidad y adaptador estructural del rig nativo. El imán contacta en la cara superior sin la inserción lateral de 40 mm de una pinza; las agujas utilizan una penetración acotada de 8 mm. Los permisos de carga y materiales se validan por separado. La estación de herramientas es un producto pasivo apoyado en el piso, no una herramienta colgada de la muñeca.

## Comprobaciones y límites

- `test-catalogue-equipment-geometry.js`: 140 cuerpos específicos actuales, atributos finitos, normales, UV, identidades, reemplazo sin duplicados, liberación de recursos y superficie de apoyo de la espiral compartida con el flujo. Máximo observado de cuerpo nuevo: 5.460 triángulos y 19 bancos de material, antes del panel nativo.
- `test-catalogue-equipment-motion.js`: 23 cuerpos de procesador animados, cinco poses del ciclo, pausa/emergencia/espera, carcasas e IDs fijos, piso, apoyos de buffers, anclajes de identificación y los contratos de extractor/carrusel.
- `test-catalogue-robot-tools.js`: 32 acoples, 21 conjuntos geométricos distintos, 96 muestras de FK/IK/TCP invariable y guardia nativa de autocolisión, apertura/cierre de las mordazas reales. Máximo observado del útil: 1.472 triángulos.
- Continúan pasando las regresiones de 25 transportadores nativos, fuentes, procesadores, 14 sistemas de estanterías anteriores, custodia robótica, contacto de pinzas y caché cinemática.

Estos son presupuestos y poses muestreadas, no una certificación mecánica ni una garantía de FPS. Los límites de un modelo independiente no sustituyen la medición del escenario completo en Quest. No se demuestra con estas pruebas que cualquier combinación arbitraria de tamaños, cargas, piezas o recorridos sea válida. El perfil del pipeline conserva el límite de 35.000 triángulos por equipo en Quest y 70.000 en escritorio, y el runtime mantiene sus guardias físicas.

## Referencias de forma y principio

Se consultaron fuentes primarias para interpretar componentes y proporciones; no se copiaron imágenes comerciales ni mallas de fabricantes. Los modelos son aproximaciones educativas genéricas:

- [Interroll MCP: módulos de transporte](https://www.interroll.com/products/mcp).
- [Dorner 2200 Precision Move](https://www.dornerconveyors.com/products/2200-series/2200-precision-move-conveyor) y [manual de los transportadores 2200/2700](https://www.dornerconveyors.com/wp-content/uploads/2017/10/Dorner_2200_2700series_US_Man_1022F.pdf).
- [Mecalux: bastidores, largueros y componentes de estantería](https://www.mecalux.com/warehouse-racking-and-shelving/pallet-racking?v=155748).
- [SICK: montaje y conexiones de una fotocélula](https://www.sick.com/media/docs/6/96/696/operating_instructions_wtb4sl_3v_photoelectric_proximity_sensor_de_en_fr_pt_it_es_ja_zh_im0048696.pdf).
- [Kardex Shuttle: bandejas, extractor y acceso](https://www.kardex.com/en-us/products/vertical-lift-module/kardex-shuttle).
- [Robopac Robotape: encintado por correas laterales](https://www.robopac.com/en/robotape-cfa-hd-p328) y [Rotoplat: envoltura sobre mesa giratoria](https://www.robopac.com/en/rotoplat-std-p1229).
- [Haas VF-2: distribución de un centro de mecanizado](https://www.haascnc.com/machines/vertical-mills/vf-series/models/small/vf-2.html).
- [Krones Modulfill: depósito, válvulas y dosificación](https://www.krones.com/en/products/filling-and-packing-technology/single-machines/filling-technology/modulfill-vfs-with-pfr-valves/).
- [Meta: flujo de medición de rendimiento WebXR](https://developers.meta.com/vr/documentation/web/webxr-perf-workflow/) y [prácticas de rendimiento](https://developers.meta.com/vr/documentation/web/webxr-perf-bp/).

Los paquetes y renders offline se exportan desde la fábrica real con `tooling/modeling/export-native.cjs`, en un proceso Blender separado. Los paquetes JSON conservan geometría, jerarquía y factores PBR, pero omiten mapas de imagen; una captura con esas limitaciones no reemplaza la evaluación del navegador compilado.
