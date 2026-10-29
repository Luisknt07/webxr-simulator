Esta aplicación Node ejecuta composiciones sectoriales con el núcleo puro. Los proyectos son datos JSON; no contienen loaders ni código ejecutable.

```sh
node apps/core-empty/index.mjs
node apps/sector-demo/index.mjs agricultura
node apps/sector-demo/index.mjs turismo
node apps/sector-demo/index.mjs educacion
node apps/sector-demo/index.mjs alimentos
```

Los perfiles están en `projects/agricultura/project.json`, `projects/turismo/project.json`, `projects/educacion/project.json` y `projects/alimentos/project.json`. El descubrimiento local lee `modules/*/manifest.json` y `functions/*/function-manifest.json`; valida sus rutas, versiones y archivos antes de crear loaders locales. La aplicación realiza las operaciones de demostración explícitamente después de validar el perfil.

Agricultura y Alimentos reutilizan `logistics.storage` sin iniciar todo el sector de Logística. Este servicio administra inventario lógico con capacidad, masa, unidades y reservas transaccionales. No crea cargas físicas ni sustituye el registro de custodia del simulador industrial.

Para copiar una función completa con identidad independiente:

```sh
node tooling/modules/copy-function.mjs --function logistics.storage --sector agricultura --folder almacenamiento-propio --id agriculture.storage-propio
```

La copia incluye sólo los archivos portables declarados: runtime, esquema, interfaz, validación de servidor, migración cuando corresponde y pruebas. Conserva procedencia y hashes, no sobrescribe archivos y produce un `module.js` para añadir la función a una composición. Un mundo admite un único proveedor de `world.inventory`: una copia proveedora reemplaza al original; para compartir el mismo inventario se usa un adaptador consumidor con dependencia explícita.

Los manifiestos JSON de sectores se actualizan con `node tooling/modules/generate-manifests.mjs`.

Para generar una composición independiente por proyecto:

```sh
node tooling/modules/discover.mjs --project projects/agricultura/project.json
```

El resultado queda en `data/build/compositions/agricultura/`: `catalog.mjs` importa únicamente el cierre seleccionado, `bootstrap.mjs` exporta `createComposedHost({ports, grants})` y `selection.json` registra funciones y hashes de manifiestos. Añadir un sector o copiar una función no requiere editar el core ni una lista global de imports. Las copias se descubren como opciones y sólo se activan cuando el proyecto las selecciona. La ausencia opcional conserva los componentes opacos con `--allow-optional-missing`; una dependencia obligatoria sigue bloqueando la composición.
