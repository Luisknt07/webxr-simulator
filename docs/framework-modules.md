# Guía de implementación: sectores, funciones y composiciones

Para la organización actual, creación de sectores y controles de activación por proyecto, véase [Proyectos y módulos reutilizables](modular-projects.md). `createProjectSession` añade gestión de proyectos con estado, y el visor genérico actualiza sus paneles al pausar o retirar funciones. Los sectores o raíces con `enabled: false` permanecen en el documento y quedan fuera de la composición, salvo dependencias todavía requeridas.

El núcleo ejecutable está en [`packages/core`](../packages/core/index.js), sus contratos de datos en [`packages/contracts`](../packages/contracts/index.js) y el SDK en [`packages/module-sdk`](../packages/module-sdk/index.js). Estos paquetes no importan Three.js, DOM, clases industriales ni el editor. La aplicación proporciona los adaptadores de render, entrada y servicios autorizados.

Los módulos que administra el usuario son sectores grandes: `logistica-industrial`, `agricultura`, `turismo`, `educacion` y `alimentos`. Cada sector puede contener muchas funciones. La unidad que se exporta, reutiliza o copia es una función completa, con su runtime, esquemas, interfaz, validadores de servidor, migraciones, assets y pruebas aplicables.

La implementación convive con el mundo industrial existente. `logistics.workspace` es un adaptador de compatibilidad con ciclo de vida de página; no convierte automáticamente el editor completo en una función que pueda retirarse en caliente. Las funciones portables nuevas tienen un contrato más acotado.

Para ejecutar las demostraciones de datos sin navegador:

```sh
node apps/core-empty/index.mjs
node apps/sector-demo/index.mjs agricultura
node apps/sector-demo/index.mjs turismo
node apps/sector-demo/index.mjs educacion
node apps/sector-demo/index.mjs alimentos
```

El primer comando arranca sin sectores. Los demás realizan operaciones reales: cosecha y traslado de inventario lógico, recorrido por puntos, evaluación ponderada y trazabilidad de lotes. La aplicación ejecuta esas operaciones explícitamente; cargar un proyecto JSON no ejecuta comandos guardados ni descarga código.

El código y los datos se organizan así:

```text
modules/agricultura/
  manifest.json                    # sector instalado y funciones predeterminadas
  functions/cosecha/
    function-manifest.json         # contrato de datos portable
    manifest.js                    # misma declaración usada por el runtime
    index.js                       # defineFunction(...)
    schema.js / server.js / ui.js
    contract.test.mjs
projects/agricultura/project.json  # selección y componentes del proyecto
tooling/modules/discover.mjs       # descubrimiento y generación de composición
```

[`discover.mjs`](../tooling/modules/discover.mjs) lee `modules/*/manifest.json` y `modules/*/functions/*/function-manifest.json`. No importa `manifest.js`, `module.js` ni los runtimes para descubrirlos. Valida JSON finito, claves seguras, namespaces, versiones, entradas locales, archivos declarados y ausencia de enlaces que puedan salir de la raíz. Dos sectores no pueden registrar el mismo identificador de función.

Un manifiesto sectorial usa `format: "smarttwin.sector"`, `schemaVersion: 1`, `id`, `version`, `metadata.folder`, `imports` y `functions`. Cada función declara una entrada relativa dentro de su propio paquete. El manifiesto portable usa `format: "smarttwin.function"` y `schemaVersion: 1`, además de los mismos campos de función. `metadata.packageRoot`, `metadata.entry` y `metadata.files` identifican el paquete y su lista completa de archivos. Assets locales que deban viajar en una copia deben figurar en esa lista.

`node tooling/modules/generate-manifests.mjs` valida y materializa los manifiestos JSON locales sin una lista manual de cinco sectores. No infiere dependencias leyendo código: `requires`, `uses`, `provides` y `capabilities` deben describir lo que la función realmente utiliza. La declaración que devuelve el runtime debe coincidir con el manifiesto; el host rechaza una implementación que cambie identidad, versión o permisos durante la carga.

Un proyecto selecciona funciones con datos como estos:

```json
{
  "format": "smarttwin.project",
  "version": 1,
  "worldId": "world.agriculture-demo",
  "modules": [
    {
      "id": "sector.agriculture",
      "version": "1.0.0",
      "functions": ["agriculture.harvest"]
    }
  ],
  "entities": []
}
```

Para generar su entrada independiente:

```sh
node tooling/modules/discover.mjs --project projects/agricultura/project.json
```

El resultado se escribe únicamente en `data/build/compositions/agricultura/`:

- `catalog.mjs`: metadatos y loaders con imports literales del cierre seleccionado.
- `bootstrap.mjs`: exporta `createComposedHost({ports, grants})`, `project`, `selections` y `missing`.
- `selection.json`: funciones, versiones, entradas y hashes de los manifiestos utilizados.

La composición de Agricultura selecciona `agriculture.harvest` y su dependencia `logistics.storage`. El sector de Logística aporta esa función como proveedor disponible; no se activa todo su módulo, el editor, el museo ni `logistics.workspace`. El bundler debe usar esta entrada generada para producir una distribución por proyecto, evitando el barrel de todos los sectores.

El bootstrap puede probarse directamente en Node:

```js
import {createComposedHost} from './data/build/compositions/agricultura/bootstrap.mjs';

const host = await createComposedHost();
console.log(host.status());
await host.dispose();
```

Añadir un sector requiere su carpeta y manifiesto válidos. Añadir una copia a un sector existente requiere su `function-manifest.json`; no hay que editar el core ni una lista global de imports. Las copias descubiertas son opciones disponibles: no se agregan automáticamente a las funciones predeterminadas de proyectos existentes. El proyecto debe seleccionarlas expresamente.

Una función se implementa mediante `defineFunction`. Durante `register(scope)` registra contribuciones con nombres locales; el SDK las publica como `functionId:nombre`. El registro debe terminar antes de empezar la ejecución. Puede devolver una función de limpieza, pero no debe devolver accidentalmente la clave de un registro.

```js
import {defineFunction} from '../../../../packages/module-sdk/index.js';
import {manifest} from './manifest.js';

export default defineFunction({...manifest,
  register(scope) {
    scope.register('commands', 'saludo', input => ({text: input.text}));
    scope.register('components', 'settings', {
      schemaVersion: 1,
      validate: value => typeof value.title === 'string'
    });
    scope.register('ui', 'panel', {kind: 'text', title: 'Mi función'});
  }
});
```

El host permite contribuciones como `commands`, `components`, `systems`, `ui`, `migrations` y `server-validators`. Una contribución UI es una descripción; el adaptador de la aplicación decide cómo mostrarla. Los títulos y datos de proyecto se muestran como texto escapado, sin `eval` ni asignaciones de propiedades ejecutables. Registrar un validador de servidor no instala una ruta HTTP pública: la composición de la API debe incorporar expresamente el adaptador y exigir autenticación, permisos y esquema.

Las capacidades sólo existen si la función las declara y la aplicación las concede mediante `grants` y `ports`. Por ejemplo, `scope.port('platform.scene')` no obtiene nada por existir un campo similar en el proyecto. Un módulo recibe los puertos concretos autorizados, no el contexto completo de la aplicación por defecto. Este control organiza código local confiable; no es un sandbox contra JavaScript malicioso del mismo origen.

Los recursos adquiridos deben pertenecer a su scope:

```js
scope.onDispose(() => target.removeEventListener('change', listener));
scope.own(texture, value => value.dispose());
const model = await scope.track(loadModel({signal: scope.signal}), value => value.dispose());
const callback = scope.guard(() => refresh());
```

`track` libera también recursos que llegan después de cancelarse la activación. `guard` evita callbacks de una función pausada o retirada. Esto no cancela automáticamente operaciones externas que ignoren la señal: deben conectar `scope.signal`, liberar sus propios recursos y evitar cambios irreversibles durante el registro. `systems.step` es síncrono y se ejecuta con el reloj del host. Las funciones portables no crean otro bucle de render ni modifican la pose XR de la aplicación.

`host.activate(moduleId, {functions})` resuelve dependencias y versiones. `pause` conserva estado y recursos, y suspende sistemas y comandos de funciones sin otros consumidores activos. `remove` conserva una dependencia compartida mientras otro módulo la necesite. Antes de liberar una función se consulta `canStop`; una reserva o carga sostenida puede devolver `{allowed: false, reason: "..."}`. Una activación fallida revierte registros y recursos nuevos. Reanudar un proveedor y fallar al iniciar su consumidor también restaura el estado anterior.

Un servicio compartido se declara con `provides: [{id: "world.inventory", version: "1.0.0"}]`. Sus consumidores declaran `requires` con la función proveedora y `uses` con el servicio compatible. `scope.provide` crea un único proveedor por host/mundo, y `scope.service` comprueba el contrato y la dependencia. El mismo identificador `worldId` en dos hosts separados no sincroniza sus almacenes: una escena conectada debe compartir la instancia del host o un servicio de custodia explícito.

`logistics.storage` es inventario **lógico** transaccional: ubicaciones, capacidad, masa, unidades, revisiones optimistas, reserva exclusiva y confirmación o reversión de traslados. Agricultura y Alimentos utilizan la misma instancia `world.inventory`. No materializa meshes ni duplica `sourceEntry`, reservas de robots o cargas de montacargas del simulador físico. Una integración física debe adaptar el registro de custodia existente; crear otro mapa de las mismas cargas produciría doble propiedad y pérdida de coherencia.

Para copiar código completo de una función:

```sh
node tooling/modules/copy-function.mjs --function logistics.storage --sector agricultura --folder almacenamiento-propio --id agriculture.storage-propio --version 1.0.0
```

La herramienta descubre el origen local, copia sólo sus archivos declarados y conserva hashes y procedencia en `copy-manifest.json`. Genera la nueva declaración JS, `function-manifest.json` y un descriptor `module.js`. No ejecuta el runtime, no copia estado vivo y no sobrescribe otra carpeta. Las dependencias siguen siendo explícitas: copiar una función no incorpora todo el sector proveedor.

El nuevo namespace mantiene separados comandos, componentes y versiones del original. La copia no recibe actualizaciones automáticas del origen. Si ambos paquetes proveen `world.inventory`, el host rechaza activarlos juntos: una copia proveedora reemplaza al proveedor original. Para mantener dos interfaces o variantes sobre un único inventario se implementa un consumidor/adaptador con `uses` y `requires`, sin volver a crear el servicio. Las migraciones de una copia tampoco se aplican al namespace original.

Los componentes persistidos incluyen `functionId`, `functionVersion`, `type`, `schemaVersion` y `data`. Un componente no disponible conserva todos sus datos y referencias como contenido opaco. `--allow-optional-missing` admite ausencias marcadas expresamente como opcionales; no oculta una dependencia requerida ni una incompatibilidad de versión. Los manifiestos nunca pueden indicar URLs de código que se importen desde el documento.

`host.importState` se utiliza antes de activar funciones. `scope.state` admite sólo datos JSON finitos, y `host.exportState` conserva estados de funciones ausentes. Cambiar versión o esquema exige una migración local explícita mediante `migrateState`; no se restaura silenciosamente un estado incompatible. El checkpoint industrial sigue siendo un contrato distinto que valida identidad y custodia física. La ausencia de sus propietarios impide reanudar la simulación, aunque el documento pueda conservarse.

El adaptador [`logistics.workspace`](../modules/logistica-industrial/application/workspace.js) declara `applicationLifetime: true`, `hotRemoval: false` y `hotPause: false`. Su puerto actual detiene el loop y la simulación, pero no libera por completo UI, listeners y todos los recursos GPU. Por eso `host.remove`, `host.dispose()` normal y `host.pause` no deben presentarse como retirada o pausa completa del Workspace. La simulación conserva sus controles propios.

El cierre de página y el fallo de arranque usan `host.dispose({force: true})` como cierre terminal de aplicación. Ese camino invalida las contribuciones del core, detiene el mundo y limpia la referencia `context.frameworkHost` que le pertenece. También detiene un arranque asíncrono que termine después de cancelarse. No certifica que el editor pueda desmontarse, reactivarse y coexistir con otro mundo dentro de la misma página: la liberación completa de sus listeners/UI/GL sigue pendiente de extracción.

AssetLibrary conserva las rutas lógicas de proyectos anteriores en el momento de resolverlas; no reescribe las bases de datos. Estos ejemplos de `.path` producen recursos relativos al montaje de la aplicación:

| Ruta guardada | Ruta física resuelta |
|---|---|
| `hall.glb` o `assets/hall.glb` | `modules/turismo/assets/hall.glb` |
| `blender/hall.blend` | `modules/logistica-industrial/assets/blender/hall.blend` |
| `assets/materials/...` | `modules/logistica-industrial/assets/materials/...` |
| `assets/editor-previews/...` | `packages/tools/editor/assets/previews/...` |
| `assets/ai/...` | `packages/tools/ai/assets/...` |
| `assets/scene-thumbnails/...` | `projects/smarttwin/previews/...` |
| `modules/...`, `packages/...`, `projects/...` | conserva su raíz canónica |

La ruta persistida es un nombre lógico o canónico sin codificar; el resolver codifica sus segmentos para la petición. La URL resultante continúa bajo `/workspace/` en la aplicación privada. `.url` de un archivo subido tiene otro contrato: únicamente `/api/assets/<sha256>`, con autenticación del servidor. No se convierten URLs externas en imports autorizados.

Las verificaciones relevantes están en `tests/framework/core.test.mjs`, `discovery.test.mjs`, `sectors.test.mjs`, `packaging.test.mjs`, `workspace-lifecycle.test.mjs` y `asset-url-compat.test.mjs`, además de los contratos locales de cada función. Las últimas pruebas de compatibilidad recorren todas las entradas reales del catálogo y sus miniaturas, comparando rutas y tamaños de archivos; no usan una segunda tabla de mapeo ficticia.

Después de cambios de navegador, el build y la QA deben volver a registrar el hash exacto del artefacto. La comprobación privada utiliza HTTPS, bootstrap local y SQLite/Chrome temporales:

```sh
node tooling/qa/workspace-production.cjs --expected-workspace-sha256 HASH_REVISADO
```

La publicación estática usa el artefacto `artifacts/public-viewer` con un único escenario. El empaquetador legado de dos/todos los ejemplos conserva un perfil explícito de regresión; no determina qué se publica en producción. Las rutas privadas, bases de datos y fuentes del servidor quedan fuera de los artefactos y de sus allowlists.
