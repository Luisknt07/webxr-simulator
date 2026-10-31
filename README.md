# SmartTwin · Framework WebXR por sectores

El repositorio separa el núcleo genérico, las aplicaciones y los módulos grandes por sector. Cada proyecto selecciona sus funciones y dependencias locales; no necesita incorporar todo SmartTwin. El visor público contiene un único escenario de robot, banda y montacargas. El editor, el catálogo completo y la administración se sirven desde la API con sesión y permisos.

## Organización

```text
apps/
  api/                    Servidor, autenticación, almacenamiento y administración
  core-empty/             Núcleo y adaptador WebXR sin módulos sectoriales
  public-viewer/          Demostración pública limitada y de solo lectura
  workspace/              Editor y simulación SmartTwin existentes
  project-viewer/         Visor genérico de composiciones sectoriales
  sector-demo/            Ejemplos ejecutables de integración
packages/
  contracts/              Documentos genéricos, validación y versiones
  core/                   Registro, dependencias, estados, reloj y ciclo de vida
  module-sdk/             Contrato de funciones y recursos administrados
  render-three/           Render, entrada de escritorio/móvil y WebXR
  project-model/          Modelo y esquemas de compatibilidad del editor existente
  tools/                  Herramientas opcionales: editor, CAD, IA y colaboración
modules/
  logistica-industrial/   Robots, bandas, montacargas, almacén y flujo de materiales
  agricultura/            Cosecha y conexión selectiva con almacenamiento
  turismo/                Recorridos y experiencia del museo existente
  educacion/              Evaluación y aprendizaje
  alimentos/              Lotes y trazabilidad
projects/                 Composiciones JSON, marca, ejemplos y escenas por proyecto
artifacts/                Distribuciones compiladas y manifiestos verificables
  public-viewer/          Único contenido que publica GitHub Pages
  workspace/              Distribución privada; exige sesión en el servidor
  core-empty/             Ejemplo independiente, sin sectores
  projects/               Distribuciones generadas por composición
tests/                   Contratos nuevos y regresiones de compatibilidad
tooling/                 Compilación, módulos, publicación, mantenimiento y QA
 data/                    SQLite, archivos y resultados locales; fuera de Git
```

Dentro de un sector, `functions/<función>/` reúne su implementación, esquema, UI, validación de servidor, migraciones, pruebas y manifiesto. Las funciones exportables se conectan mediante contratos versionados; el núcleo no importa sectores. Los archivos físicos del sistema anterior se trasladaron a estas carpetas y sus imports se actualizaron. `tooling/layout-map.json` documenta la correspondencia de rutas y ayuda a ejecutar las herramientas antiguas.

## Ejecutar y compilar

Requiere Node.js 24 o posterior. En PowerShell utiliza `npm.cmd` si la política bloquea `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run core:empty
npm.cmd run sector:demo -- agricultura
npm.cmd run sector:demo -- alimentos
npm.cmd run project:build -- --project projects/agricultura/project.json
npm.cmd run module:discover -- --project projects/turismo/project.json
```

`core:empty` demuestra que el núcleo funciona sin sectores. `project:build` genera un visor independiente con las funciones seleccionadas por el documento y sus dependencias. La compilación comprueba su cierre de imports para evitar arrastrar otros sectores. Sus paneles son modelos declarativos; un documento JSON no ejecuta código ni concede permisos.

Para trabajar localmente:

```powershell
npm.cmd run admin:init -- bootstrap --username administrador
npm.cmd run dev
```

La CLI solicita la contraseña sin mostrarla. Conserva el directorio `data/` y haz copia de seguridad antes de una migración de datos. `dev` recompila y utiliza HTTP exclusivamente en loopback, por defecto `http://localhost:8081`. Abre `/login` y luego `/editor`. WebXR requiere un contexto seguro; para entrar desde Quest configura HTTPS con un certificado confiable para el visor.

En producción, configura `SMARTTWIN_TLS_KEY` y `SMARTTWIN_TLS_CERT`, o declara las IP exactas de tu proxy HTTPS en `SMARTTWIN_TRUSTED_PROXY_ADDRESSES`. Después ejecuta `npm.cmd start`. El servidor rechaza un arranque sin TLS/proxy salvo el modo local explícito. Consulta [configuración y API](apps/api/README.md) y [límites de seguridad](docs/framework-security.md).

## Conectar o copiar una función

El descubrimiento lee `modules/<sector>/manifest.json` y los manifiestos de funciones instaladas. El proyecto declara qué sector y funciones utiliza. Agregar una carpeta no activa automáticamente todo su código: se valida y se incorpora al seleccionar la función. Una dependencia ausente o incompatible produce un error explícito; una referencia opcional puede conservarse sin activación.

Agricultura usa `agriculture.harvest` y la dependencia exportada `logistics.storage`. Este último proporciona un inventario lógico transaccional; no inicia el mundo físico industrial. Si necesitas una copia independiente:

```powershell
npm.cmd run module:copy -- --function logistics.storage --sector agricultura --folder almacenamiento-propio --id agriculture.storage
```

La copia incluye todos los archivos declarados, mantiene procedencia y hashes, cambia el espacio de nombres y no modifica el origen. Luego selecciona el nuevo identificador en el proyecto y ajusta explícitamente los consumidores que deban utilizarlo. Un mundo permite un único proveedor de cada servicio compartido, para evitar dos inventarios contradictorios. Véase [guía del SDK y composición](docs/framework-modules.md).

## Alcance de la migración

El núcleo independiente, el SDK, el descubrimiento, la copia, los cinco sectores de ejemplo y la API de documentos genéricos son ejecutables y tienen pruebas. Agricultura, alimentos, educación y recorridos aportan funciones iniciales de dominio; no representan simuladores completos de todos esos sectores.

La simulación industrial y el museo conservan su comportamiento y modelos existentes. El editor completo usa un adaptador de compatibilidad con ciclo de vida de página: para cambiar esa aplicación se guarda y recarga. No admite retirar todo el editor en caliente. Las funciones SDK sí tienen ciclo de vida, dependencias y limpieza administrados. El inventario lógico portable y las cargas físicas industriales mantienen registros distintos y no se presentan como una misma simulación.

## Publicación y seguridad

GitHub Pages publica únicamente `artifacts/public-viewer`, verificado mediante hashes y una lista cerrada de archivos. No aloja la API ni el editor. El botón de acceso del visor puede apuntar a un backend HTTPS configurado; sin backend muestra la información de conexión. No existe un servidor privado nuevo desplegado automáticamente.

El repositorio y el código que recibe un navegador son públicos. La protección de proyectos, sesiones y archivos privados ocurre en el servidor, no ocultando botones. No guardes secretos en módulos, escenas, bundles ni Git. El servidor sirve artefactos aprobados, nunca la raíz del repositorio.

## Validación y documentación

```powershell
npm.cmd run test:framework
npm.cmd run test:api-production
npm.cmd run test:legacy
npm.cmd run pages:verify
```

La comprobación de navegador exige el SHA-256 del bundle de Workspace que se haya revisado: `npm.cmd run test:browser -- --expected-workspace-sha256 <hash-revisado>`. Sustituye el marcador por los 64 caracteres de la huella; sin ella se rechaza la ejecución para evitar comprobar un artefacto diferente.

`test:legacy` incluye una prueba de simulación prolongada que puede tardar bastante. Las pruebas gráficas automatizadas usan un navegador de escritorio; la estabilidad y el rendimiento final en Quest 3 necesitan una sesión física en el visor.

- [Referencia histórica de la propuesta modular](docs/modular-framework-proposal.md)
- [SDK, módulos y composición](docs/framework-modules.md)
- [Seguridad y despliegue](docs/framework-security.md)
- [Resultados de validación](docs/framework-validation.md)
- [Auditoría del 30 de octubre de 2026: correcciones, pruebas y pendientes](docs/audit-2026-10-30.md)
- [Pantalla inicial e instalaciones compactas de RV](docs/vr-facility-home.md)
- [Guía del editor](docs/studio-guide.md)
- [Cuentas y sesiones](docs/studio-service.md)
- [Bandas](docs/conveyor-library.md), [estanterías](docs/warehouse-racks.md), [robots](docs/robot-grasp-clearance.md), [montacargas](docs/vehicle-front-mirror.md)

SmartTwin conserva código y recursos procedentes de Hello WebXR de Mozilla y las licencias de sus dependencias y activos. Consulta `LICENSE` y las licencias incluidas junto a cada recurso.
