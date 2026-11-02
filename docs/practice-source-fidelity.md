# Montajes NEXUS: trazabilidad y límites de ejecución

Las dos rutas contienen L01–L32 (CEDI) e I01–I32 (Smart Factory). No se guardan 64 proyectos: cada ensayo se construye en un documento independiente y sólo hay una copia activa.

## Fuente y coordenadas

Se leyeron completos los XML y las tablas de los dos DOCX originales en modo de sólo lectura. Las 64 tablas de distribución contienen **392 elementos**, además de los 384 pasos. El fixture independiente `tests/fixtures/practice-campaign-source-layouts.json` conserva el resultado de esa extracción.

`manifest.layoutElements` relaciona cada elemento original con un actor nativo editable mediante su ID estable. Conserva origen, dimensiones, centro original, posición real y envolvente medida. El área del recinto mantiene sus dimensiones originales. Los planos no suministran puntos numéricos de la polilínea; por ello `executionRoute.provenance` distingue la ruta derivada de waypoints nativos o la guía de interacción. Su longitud no se presenta como la distancia de la lámina.

Una zona de 6 × 4 m no implica escalar una máquina a 6 × 4 m. Las zonas originales quedan demarcadas y rotuladas; los equipos conservan sus mecanismos, articulaciones y puertos. Si es necesario acercar una estación para alcanzar un producto, conectar puertos o abrir un pasillo, `layoutAdjustments` explica el cambio. La celda se ancla primero a la zona de su máquina principal. Las demarcaciones y las etiquetas tienen colisión desactivada explícitamente.

## Operaciones y modalidades

`PracticeCapabilities.cjs` declara la disponibilidad por práctica y modalidad. Una modalidad sin implementación compatible se rechaza **antes de crear actores**; su ficha fuente sigue disponible. Hay una modalidad manual para las 64 prácticas. Las opciones automáticas que requieren una misión AS/RS, AGV/ATLS, cambiador EOAT o integración externa todavía no especializada aparecen no disponibles y explican el motivo.

Los registros de recepción, orden, asignación, inventario y planificación usan un flujo documental local con seis eventos ligados a actores reales y datos de una orden declarada. No incrementan contadores de producción ni simulan una integración ERP/WMS/OCR inexistente. L01 mantiene su ASN de doce estibas y compara cita, transporte, capacidad, muelle, excepción y entrega de la tarea; no crea doce cargas físicas para imitar ese registro.

Las operaciones materiales usan los mismos Source, transportadores, procesadores, robots, pallets, montacargas y registros de custodia del sistema. Se retiró el reemplazo genérico por un banco MA-15 cuando el recurso principal no era un procesador. Las líneas que lo requieren incluyen tolva, enfriamiento, fixture o ensayo como etapas reales, no sólo decoración. I28 contiene tres estaciones en serie; I29 conserva dos SKU con dimensiones distintas y preparación por cambio de producto. Ambos cierres requieren material realmente recibido al final de la línea.

I23 monta una celda robótica nativa, tres soportes EOAT y una selección limitada de herramientas compatibles. El cambio manual/asistido regenera el EOAT real y vuelve a vincular el mismo actor al runtime sin reiniciar stock, documento o sesión. La verificación consulta la herramienta instalada y exige un ciclo y una entrega reales. No se afirma que exista un cambiador automático, una simulación de manos o un acoplador OEM.

En D3 se exige el caso C y la recuperación de una incidencia. Cambiar la modalidad o el caso construye un ensayo nuevo; las variantes no se acumulan dentro del mismo recinto.

## Contactos y coste gráfico

Las misiones de vehículo conservan una carga y una tarea, sin arrastrar los tres pallets, retornos y estanterías de la demostración anterior. La carga y descarga del camión usan su plataforma real; la aproximación eleva las horquillas lejos de la carrocería antes de entrar. La configuración de vehículo debe corresponder a la modalidad elegida. Los auxiliares estacionados conservan el modelo moderno y su rig, con detalle bajo e interior de cabina desactivado; no sustituyen al vehículo principal ni permiten conducir una copia de atrezzo.

La prueba `practice-campaign-budgets.test.mjs` recorre las 576 combinaciones de práctica, caso y modalidad. El recibo `data/qa-studio/practice-fidelity/native-matrix.json` distingue montajes válidos y rechazos seguros, y registra triángulos, mallas, materiales, texturas y llamadas de dibujo visibles antes del culling/LOD del renderizador. Las variantes por encima del objetivo de 250 llamadas quedan señaladas. Es una medición de contenido, no de FPS en un Quest físico.

`practice-native-flow.test.mjs` comprueba todos los flujos automáticos materiales habilitados con lotes finitos, ausencia de custodia duplicada, paso por cada etapa y llegada al receptor. También comprueba la operación asistida de I28/I29 y el guardado/reapertura real de montajes representativos. La simulación de fabricación sigue siendo educativa y por eventos discretos: no certifica capacidad OEM, transferencia térmica, fuerzas, calidad de soldadura o estabilidad física de una instalación real.
