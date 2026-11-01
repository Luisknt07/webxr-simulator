# Anatomy para SmartTwin

Este paquete reúne el kit completo de [Anatomy](https://github.com/wheresryan22/anatomy) y un editor de objetos que comparte geometría entre sus vistas 2D, 3D y los objetos de Three.js. El contenido fuente de upstream está fijado al commit `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`. La licencia MIT y el aviso `Copyright (c) 2026 Ryan` se conservan en `vendor/anatomy/LICENSE`.

`vendor/anatomy/VENDOR.json` registra los 160 archivos originales con su SHA-256. No se modificaron esos archivos ni se instalaron habilidades de agentes. Se excluyeron `.git`, `.github`, los metadatos Git y `agents/`. El repositorio completo descargado también está disponible en la carpeta de trabajo `_external/anatomy`.

## Organización

- `shared/model.mjs`: documento portable, unidades en metros y validación de parámetros.
- `shared/geometry.mjs`: compilación de los mismos triángulos que recibe Three.js.
- `shared/render.mjs`: diagrama SVG, órbita, despiece, transparencia, vistas ortográficas y diagnóstico topológico.
- `shared/toolkit.mjs`: carga de capacidades del kit original, metadatos, galería y efectos WebGL de presets locales.
- `shared/base64.mjs` y `shared/turn-build.browser.mjs`: compatibilidad del constructor con navegadores sin una variable global `Buffer`.
- `shared/canvas-painter.browser.mjs`: variante del pintor original con limpieza de recursos y exportación CSS acotada.
- `vendor/anatomy/kit/`: los 16 archivos originales, incluidas las fuentes TypeScript y React.
- `vendor/anatomy/examples/`: siete ejemplos HTML ejecutables y dos ejemplos React como código fuente.
- `vendor/anatomy/references/`: referencias de geometría, movimiento, WebGL, impresión y verificación.
- `vendor/anatomy/scripts/`: herramientas originales de autoría conservadas como fuente; no se ejecutan desde el servidor ni se exponen como operaciones del asistente.

## API del editor

```js
import { createDiagram, renderSVG, auditDiagram } from './shared/render.mjs';

const preview = createDiagram(model, {
  mode: '3d', width: 900, height: 620,
  azimuth: 45, elevation: 30,
  explode: 0, transparent: false, wireframe: false
});
container.append(preview.element);
preview.setView({ explode: 1 });
const svg = preview.exportSvg();
const check = auditDiagram(model);
preview.dispose();
```

`renderSVG(model, options)` devuelve un SVG generado a partir de un documento validado. No admite HTML, GLSL, enlaces ni código dentro del modelo. Las etiquetas se escapan y la exportación incluye únicamente su propio contenido. `renderDiagram` proporciona también estadísticas, límites en metros y la proyección utilizada.

Las coordenadas del proyecto son Y-up en metros. El adaptador las transforma a las coordenadas Z-up de Anatomy mediante `[100*x, -100*z, 100*y]`; la conversión conserva la orientación. Los cambios de posición, rotación, grupos y despiece parten de los mismos triángulos del compilador.

La exportación estática conserva hasta 60.000 triángulos. Por encima de 24.000, la vista mantiene el modelo completo y desactiva el arrastre continuo; los controles de ángulo permiten actualizarlo expresamente. No se descartan caras para aparentar mayor rendimiento. Los colores se agrupan por tonos y los caminos consecutivos compatibles se agrupan para reducir elementos SVG. La vista no mantiene un bucle de animación cuando está quieta.

`auditDiagram` informa de finitud, bordes abiertos, uniones no manifold y orientaciones inconsistentes por pieza. No certifica fabricación, resistencia, ausencia de auto-intersecciones ni la seguridad física de una operación.

## Cobertura del kit original

| Capacidad | Entrada | Uso integrado |
|---|---|---|
| Proyección, extrusión, sólidos, líneas, texto, detalles y temas | `loadFeature('projection')` | Proyección de las mallas reales del editor y SVG independiente |
| Torneado de perfiles, discos, anillos, esferas, curvas, nervios y bridas | `loadFeature('lathe')` | SDK completo; iluminación compartida con los diagramas |
| Tubos, cables, tramos, huecos, tapas y anillos | `loadFeature('tube')` | SDK completo para ilustraciones técnicas |
| Recorder, SDF, soportes, montajes, holguras, conexiones, cobertura y orden | `loadFeature('audit')` | SDK de diagnóstico y `auditShapes` acotado; sin alterar las colisiones del simulador |
| Grupos turn, hinge, slide y free; materiales y piezas articuladas | `loadFeature('turning')` y `loadFeature('builder')` | `buildTurningDiagram` y `createTurningPreview` usan realmente el constructor y el controlador original para despieces por traslación |
| Auditoría de órbitas, capas, continuidad y fidelidad | `loadFeature('orbitAudit')` | Autoría avanzada; puede ser costosa y no corre en cada fotograma |
| Runtime numérico y Canvas2D incremental | `loadFeature('fixed')` y `loadFeature('canvas')` | `createCanvasPreview` utiliza ambos runtimes originales; informa de operaciones no soportadas |
| Cámara WebGL, GLSL, ruido, rayos, poses y máscaras | `loadFeature('gl')` y `loadFeature('glShared')` | SDK completo; `createWebGLEffect` restringe el editor a presets locales y libera buffers, programas y shaders |
| Botón PDF y hojas A4/Letter | `loadFeature('pdf')`, referencias y scripts de impresión | Botón disponible en SDK; impresión avanzada es una herramienta local de Node/Chrome |
| Componentes React/Next, motion, in-view y reduced motion | `vendor/anatomy/kit/react/` | Fuentes originales opcionales; requieren React 18 y una compilación TSX del proyecto que los utilice |
| Captura, pruebas de líneas, sesiones, benchmark y publicación | `vendor/anatomy/scripts/` | Fuente de desarrollo conservada; no son funciones remotas ni endpoints del editor |

Los espacios de nombres nativos se cargan por capacidad, sin introducir React en el simulador. Las funciones originales de bajo nivel son herramientas de código para desarrolladores de confianza: admiten markup o shaders como parte de su diseño. Los documentos y archivos importados utilizan exclusivamente el esquema declarativo validado del editor; un diseño generado con ayuda de IA debe pasar por esa misma validación.

## Vistas TURN y Canvas

`buildTurningDiagram`, `createTurningPreview` y `createCanvasPreview` aceptan hasta 48 piezas y 6.000 triángulos. Su referencia de movimiento es el desplazamiento de despiece de cada pieza. Los contornos envolventes se usan para la composición visual; no reemplazan la geometría de colisión ni prueban ajustes físicos. Las APIs articuladas completas de upstream siguen disponibles en el SDK para escenas de autoría especializadas.

La versión 3D de Anatomy es beta y proyecta piezas sobre SVG/Canvas. La representación WebXR, la cámara estereoscópica, las colisiones, los pallets y las misiones continúan usando el motor Three.js del framework. No se crea un contexto WebGL por cada equipo del almacén ni se ejecuta el pintor de Anatomy dentro del bucle de RV.

## Cambios de compatibilidad

Los originales se conservan intactos. En los adaptadores separados:

1. `turn-build.browser.mjs` cambia únicamente las rutas de imports y la codificación `Buffer.from(bytes).toString('base64')` por una función local de `Uint8Array`.
2. `canvas-painter.browser.mjs` conserva el algoritmo del pintor, retira sus escuchas DPR y sus canvases al destruirse y exporta únicamente `ISO_CSS + TURN_CSS`. No copia todos los estilos del documento anfitrión.
3. Los wrappers TURN restauran el hook de diagnóstico global que pudiera existir y gestionan su propio desmontaje.
4. Los efectos WebGL restringidos registran y liberan los recursos incluso cuando falla la compilación o se pierde el contexto.

Los siete HTML de la galería son autocontenidos. Se muestran en un iframe con `sandbox="allow-scripts"`, sin `allow-same-origin`, sin conectividad de red y sin acceso al documento editor. Los enlaces PDF de los ejemplos son locales. Las herramientas originales `publish.mjs`, `drive.mjs` y las instrucciones de habilidades se conservan como fuente, pero no se ejecutan ni se instalan automáticamente.

## Verificación

```text
node --test --test-concurrency=1 tests/framework/anatomy-render.test.mjs tests/framework/anatomy-vendor.test.mjs
```

Estas pruebas comprueban identidad de la geometría y las transformaciones, proyecciones ortográficas, despiece, entradas no confiables, ciclo de vida del visor, acceso real a los espacios de nombres del kit, constructor sin `Buffer`, limpieza de WebGL y los hashes de todos los archivos upstream.
