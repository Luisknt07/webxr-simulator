# Proyectos y módulos reutilizables

La plataforma tiene una base compartida y sectores que se seleccionan por proyecto. Un proyecto de Agricultura puede utilizar almacenamiento de Logística sin incorporar robots, montacargas, museo ni editor industrial. Cada función portable declara sus archivos, dependencias, servicios y permisos.

```text
apps/                              Aplicaciones y sus interfaces
  core-empty/                      WebXR sin sectores
  project-viewer/                   Visor genérico y gestor de módulos
  public-viewer/                    Demostración pública acotada
  workspace/                       Editor industrial existente
  api/                             Autenticación, permisos y datos privados
packages/                          Infraestructura reutilizable
  core/                            Registro, ciclo de vida y sesiones de proyectos
    project-selection.js           Selección y cierre de dependencias
    project-session.js             Cambiar de proyecto y gestionar sus módulos
  contracts/                       Esquemas y datos JSON validados
  module-sdk/                      API para implementar funciones
  render-three/                    Adaptador de render, entrada y WebXR
  voice-assistant/                 Asistencia opcional mediante un puerto
modules/                           Sectores completos
  logistica-industrial/
  agricultura/
  turismo/
  educacion/
  alimentos/
    manifest.json                  Identidad, versión y funciones del sector
    functions/<funcion>/
      function-manifest.json       Paquete y lista completa de archivos
      manifest.js / index.js       Declaración y registro del runtime
      schema.js / runtime.js       Datos y comportamiento propios
      ui.js / server.js            Interfaz y validación propias
      migrations.js               Migraciones explícitas del estado
      assets/                     Recursos de esta función, si los necesita
      contract.test.mjs            Comprobaciones de su contrato
projects/<proyecto>/project.json    Selección, entidades y componentes
tooling/modules/                   Crear, descubrir y copiar paquetes
artifacts/projects/                Distribuciones seleccionadas e inmutables
data/                             Datos privados, temporales y resultados locales
```

Los nombres internos de las funciones existentes pueden ser distintos; el manifiesto declara sus archivos reales. La plantilla nueva usa esta estructura. No es necesario mover archivos antiguos ni reescribir rutas guardadas para utilizarla.

## Crear otro sector

```sh
npm.cmd run module:create -- --sector salud --id sector.health --folder checklist --function health.checklist --project salud --title Salud
npm.cmd run project:build -- --project projects/salud/project.json
```

El primer comando crea un sector con una función completa y un proyecto inicial. Incluye estado propio, esquema, acciones, interfaz, validador, migración y prueba. No sobrescribe carpetas ni modifica una lista central de sectores. La función de ejemplo permite configurar e inspeccionar sus datos; se sustituye su comportamiento por el del nuevo dominio.

El segundo comando genera una carpeta nueva en `artifacts/projects/`. Esa carpeta contiene el visor, el código seleccionado y sus recursos declarados. Puede trasladarse como distribución estática; no incorpora la API, usuarios, proyectos privados ni recursos de los otros sectores. El visor 3D inicial muestra primitivas de referencia: cada sector aporta su experiencia mediante adaptadores autorizados.

Para partir de un proyecto madre sin sectores:

```sh
npm.cmd run project:build -- --project projects/framework-base/project.json
```

Para desarrollar una experiencia con nuevos puertos, la aplicación debe implementar y conceder esos adaptadores. El compilador genérico admite `platform.scene`; rechaza capacidades para las que no tiene adaptador. No concede permisos porque aparezcan escritos en un JSON.

## Seleccionar únicamente lo necesario

```json
{
  "format": "smarttwin.project",
  "version": 1,
  "id": "project.finca",
  "worldId": "world.finca",
  "modules": [
    {"id": "sector.agriculture", "version": "1.0.0", "functions": ["agriculture.harvest"]},
    {"id": "sector.tourism", "version": "1.0.0", "enabled": false}
  ],
  "entities": []
}
```

La función de cosecha incorpora su dependencia `logistics.storage`, compartiendo un único servicio de inventario. Turismo desactivado permanece en el documento y queda fuera de sus loaders, recursos y bundle. También se admite desactivar una raíz con `{"id":"agriculture.harvest","enabled":false}` dentro de `functions`.

Una dependencia requerida permanece disponible mientras exista un consumidor. Desactivar una referencia directa de Almacenamiento no elimina el inventario que todavía necesita Agricultura. La interfaz distingue estas funciones de las elegidas directamente.

La comprobación de compilación rechaza imports hacia sectores ajenos a la selección y helpers propios omitidos en `metadata.files`. Esquemas, UI, validadores, migraciones, pruebas y assets declarados también deben pertenecer a esa lista: una copia no puede parecer completa y omitir un archivo necesario.

## Activar, desactivar y cambiar de proyecto

El visor genérico incluye controles para cada módulo y función:

| Acción | Resultado |
| --- | --- |
| Pausar / Continuar | Suspende o reanuda sistemas y comandos; conserva recursos y estado. |
| Desactivar / Activar | Retira o registra funciones, libera recursos propios sin consumidores y conserva sus datos. |
| Quitar del proyecto / Añadir | Cambia la selección del documento. Los datos opacos permanecen disponibles para recuperarlos. |
| Abrir proyecto | Abre otro JSON compatible con los paquetes incluidos en esa distribución. |
| Descargar proyecto y estado | Guarda selección, entidades, estado lógico y módulos pausados en un JSON local. |

El catálogo compilado determina qué código está disponible. Un JSON no instala scripts ni descarga módulos. Para incluir otro paquete hay que añadirlo al repositorio y volver a compilar. Las referencias ausentes opcionales se conservan y pueden quitarse desde el gestor. Si falta un proveedor requerido, se informa el problema antes de detener el proyecto actual.

La sesión reutiliza un solo renderizador y reloj. Antes de cambiar de mundo valida versiones, capacidades y estado; retira el anterior y activa el nuevo. Si la activación falla, intenta restaurar el anterior. No ejecuta dos mundos sobre los mismos puertos para simular un cambio instantáneo. Los errores de limpieza o recuperación se comunican, no se ocultan.

El estado lógico se conserva en memoria, separado por `worldId` e `id` de proyecto; use identificadores distintos para proyectos diferentes. La descarga es necesaria para conservarlo al cerrar o recargar. No constituye un checkpoint de custodia física industrial: ese contrato sigue siendo independiente.

La API compartida también puede usarse desde otra aplicación:

```js
import {createProjectSession} from './packages/core/index.js';

const session = createProjectSession({catalog, grants, ports});
await session.open(project);
await session.pauseModule('sector.agriculture');
await session.resumeModule('sector.agriculture');
await session.disableModule('sector.agriculture');
await session.enableModule('sector.agriculture');
// En el único loop de la aplicación: session.step(delta).
const snapshot = session.capture();
await session.dispose();
```

Cada función registra recursos mediante su scope y los libera al retirarse. Las cargas retenidas y reservas pueden bloquear la retirada mediante `canStop`. Cerrar la página admite una limpieza terminal forzada; no debe usarse para ignorar una operación pendiente durante cambios normales de módulo.

## Compartir funciones entre sectores

Preferir una dependencia y un servicio compartido cuando dos sectores deban operar sobre el mismo inventario o proceso. Para una variante independiente de código:

```sh
npm.cmd run module:copy -- --function logistics.storage --sector agricultura --folder almacenamiento-propio --id agriculture.storage-propio --version 1.0.0
```

La copia transporta los archivos declarados, registra un namespace nuevo y conserva procedencia y hashes. No copia estado vivo ni actualiza el origen. Dos proveedores del mismo servicio no se activan juntos; utilice un consumidor o adaptador si necesita dos interfaces para el mismo inventario.

## Compatibilidad del editor existente

`apps/workspace` mantiene el editor y la simulación industrial completos mediante `logistics.workspace`. Ese adaptador conserva ciclo de vida de página: cambiarlo por otra aplicación requiere guardar y recargar. El gestor impide presentarlo como un paquete que se pueda retirar en caliente. Los componentes visuales antiguos de montacargas, robots y simulación no se han convertido automáticamente en funciones portables por estar bajo una carpeta `functions/`.

El núcleo, los proyectos genéricos y las funciones portables se pueden utilizar sin cargar ese editor. Algunos helpers antiguos de `render-three` conservan configuraciones de materiales y salas por compatibilidad, pero no pertenecen al grafo de los proyectos genéricos seleccionados. La voz ya es opcional y recibe su contexto mediante un puerto; la integración industrial vive en su sector.

Comprobaciones específicas:

```sh
npm.cmd run test:modularity
npm.cmd run test:modular-browser
```

La prueba de navegador utiliza una distribución real de Agricultura, HTTPS y Chrome temporales: pausa, retirada, reactivación, cambio de proyecto e importación de estado. No utiliza cuentas ni proyectos del usuario. El rendimiento y los controles físicos de Quest 3 requieren además una sesión en el visor.

[Resultados y límites de esta validación](modularity-validation-2026-10-30.md).
