# Catálogo industrial y operaciones educativas

El catálogo proyecta **387 fichas documentales en 237 identidades semánticas**: 198 referencias del documento anterior y 189 del documento ilustrado. Los códigos documentales se conservan con su espacio de nombres. `nexus-conceptual-198:TR-03` representa una banda plana; `nexus-illustrated-2026:TR-03` representa rodillos para pallets. No se comparten por número.

`schema/source-crosswalk.cjs` contiene los vínculos revisados. `schema/regenerateCatalogue.cjs` genera el pequeño `catalogue-data.json`; la aplicación no importa los documentos completos para crear una máquina.

## Interfaces

- `equipmentCatalog.definition(id)`, `normalize(id, config)`, `layout(id, config)` y `source(sourceKey)` resuelven una misma definición.
- `resources({nativeReady})` sólo habilita una acción cuando el integrador verifica la capacidad. Una ficha, ilustración o geometría aislada no habilita inserción funcional.
- `CatalogueEquipmentFactory.createCatalogueEquipment` usa la fábrica nativa y conserva sus actores, controles, identificadores y mecanismos. `refreshCatalogueEquipment` recibe un `refreshNative` sin interceptar para evitar recursión.
- `catalogueEquipmentId` es independiente del antiguo `equipmentId` de los transportadores. `catalogueToolId` identifica un acoplamiento compatible con el TCP real.

## Límite modular y traslado

Esta carpeta pertenece a `sector.logistics-industrial`; no constituye un motor
alternativo ni una función SDK portable por sí sola. Las definiciones y los
adaptadores requieren los contratos, fábricas y runtimes nativos de bandas,
robots, montacargas, almacenamiento, procesamiento y flujo de materiales del
mismo sector. Para trasladar escenarios funcionales debe conservarse ese
sector y sus dependencias, además del contenido del proyecto. Copiar únicamente
esta carpeta no instala esas capacidades en otro anfitrión.

No se declara un `function-manifest.json` que prometa una copia incompleta.
El contrato portable `logistics.storage` existente es un servicio de inventario
lógico distinto de las geometrías y mecanismos de este catálogo. Extraer una
función nueva requiere primero publicar sus puertos y su ciclo de vida mediante
el SDK; no basta con enumerar archivos o inventar dependencias circulares.

Los paquetes de motor genérico no importan esta carpeta. Los consumidores del
sector consultan metadatos pequeños; la regeneración que lee DOCX extraídos es
una tarea de desarrollo. Desactivar el sector oculta sus recursos y evita las
acciones del editor y sus proveedores documentales; no descarga automáticamente
el código de una sesión ya compilada ni transforma un objeto industrial en un
objeto de otro sector.

Hay **195 actores independientes, 32 acoplamientos y 10 acciones de espacio de trabajo**. El soporte de herramientas es una estación física pasiva; no se monta en la muñeca ni fabrica productos. Las acciones WMS/MES/ERP abren inventario, misiones o análisis de la simulación; no establecen por sí mismas conexiones con servicios externos.

## Operaciones y custodia

`operationSpec.prepareOperation` produce un plan validado sin cambiar entradas. `commitOperation` comprueba que no cambiaron sus identidades, dueño, cantidades o propiedades; después aplica una única modificación. No acepta planes fabricados o reutilizados. Conserva el identificador, origen, dueño y unidades de la carga. El material retirado se registra en un balance de masa.

Las recetas de empaque, mecanizado, formado, dosificación, inspección y otros procesos son modelos de eventos discretos. Registran estados y valores declarados; no calculan fuerzas, dinámica granular, CFD, curado, temperatura medida o calidad de un proceso industrial real. Una consigna de temperatura no se presenta como una medición.

Ejemplo de parámetros de mecanizado:

```json
{"targetWidth":0.35,"targetHeight":0.2,"targetDepth":0.25,"removedMassKg":0.1,"guardClosed":true}
```

`operationParametersJson` admite únicamente propiedades y rangos declarados. No admite código JavaScript. La salida debe caber en las superficies y conexiones configuradas. Moldeo, extrusión y fabricación aditiva pueden convertir un lote declarado de granel/fluido en una pieza sólida educativa; conservan su masa y procedencia. Se puede elegir otro producto registrado mediante `outputCatalogueEquipmentId`.

`ProductSourceRuntime.refreshVisual` actualiza los hijos, metadatos y límites del **mismo objeto** después de una transformación. Conserva la custodia y el controlador de interacción. Archiva la geometría de un producto creado en el editor y la restaura al detener; libera los recursos temporales. Las cargas generadas pueden virtualizarse en una cola FIFO, manteniendo su identidad de inventario.

## Trayectorias, almacenes y señales

`cataloguePath.cjs` abastece a la geometría, puertos y transporte nativo. La espiral y el transporte aéreo tienen recorrido 3D; `closestPath(config,x,z,route,y)` usa la altura para distinguir niveles. Sinfín, neumático y cangilones admiten lotes declarados de granel; rechazan cajas cerradas y pallets. Su alcance es cinemático de lotes discretos, no dinámica de partículas o fluidos.

Los seis almacenes adicionales se registran en `warehouseRacks.CATALOGUE_SYSTEMS`, conservando las 14 familias anteriores. AS/RS y shuttles utilizan ubicaciones y carros físicos. El cubo apila por la altura real, exige apoyo inferior y retira primero el contenedor superior. Su extractor se aproxima antes de tomar la carga y circula por encima de las guías. El carrusel horizontal mueve todas sus bandejas y cargas en una misma operación atómica; se detiene si encuentra obstáculos o una carga capturada. No inserta inventario oculto a nivel del piso.

`equipmentCapabilities` ofrece admisión de herramientas, lectura de señales y mandos limitados a máquinas existentes. Un imán necesita material ferromagnético declarado; el color no establece el material. Sensores y encoders consultan estados reales del simulador. Si no existe una señal de temperatura o vibración, la lectura se marca desconocida. Los mandos de servicio requieren contexto autorizado y no eliminan el enclavamiento de emergencia al rearmar.

## Evidencia automatizada

- `catalogue-equipment.test.mjs`: 387 vínculos, colisiones de códigos, planes inmutables, balance, rechazos y recorridos compartidos.
- `catalogue-native-integration.test.mjs`: 195 fábricas nativas, atributos geométricos finitos, normalización y guardado/reapertura/validación del servidor de tipos representativos.
- `catalogue-runtime-integration.test.mjs`: IBC/barras/granel reales, flujo de cuatro cargas por CNC/envolvedora/picking/put-wall, transformación de polímero, restauración de un producto del editor y almacenamiento/retiro de las **48 posiciones predeterminadas** de los seis almacenes.
- `catalogue-capabilities-runtime.test.mjs`: rechazo robótico antes de transferir custodia, encoder y código de producto observados, lectura desconocida honesta y emergencia enclavada.

Estas pruebas de código y simulación no son una medición de rendimiento en un visor físico ni una certificación de una instalación.
