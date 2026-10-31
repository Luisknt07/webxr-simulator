# Proyectos independientes, Content y niveles

La organización distingue el framework, los paquetes de funciones y el contenido de cada proyecto. Se utiliza una estructura inspirada en proyectos con mapas y niveles: el descriptor identifica el proyecto; `Content` contiene sus datos y recursos, y el motor se instala por separado.

```text
MiProyecto/
  project.stproject                  Descriptor: nombre, versión, mapas y módulos
  Content/
    Maps/
      hall.level.json                Nivel identificado, con su nombre y objetos
      sound.level.json               Otro nivel independiente
    Assets/
      import-....asset.json           Metadatos del recurso
      <sha256>.blob                   Binario autorizado, en carpetas del servidor
  Config/
    Project.json                     Configuración y datos compartidos
    ModuleState.json                  Estado modular, cuando corresponde
```

Los identificadores de los niveles se mantienen estables para conservar portales, misiones y referencias. El nombre visible se edita desde el editor y figura tanto en el descriptor como en el archivo del nivel. Los espacios nativos vacíos del formato anterior se conservan en Config para compatibilidad; no aparecen como mapas ficticios en Content.

El motor compartido permanece en `packages/` y las aplicaciones en `apps/`. El código y los recursos propios de los sectores permanecen en `modules/<sector>/functions/<funcion>/`; el proyecto selecciona los que necesita. Los comportamientos configurados de objetos, procesos y misiones viajan con los niveles como datos. Un archivo de proyecto no instala ni ejecuta scripts externos.

## Dónde se guardan los proyectos del editor

El guardado privado sigue siendo transaccional en SQLite, con permisos, revisiones y cuotas. Además, se materializa su contenido actual en:

```text
data/users/<propietario>/projects/<proyecto>/project.stproject
data/users/<propietario>/projects/<proyecto>/Content/Maps/
data/users/<propietario>/projects/<proyecto>/Content/Assets/
```

`data/` representa el directorio de datos configurado del servidor; puede haberse instalado en otra ubicación física. El navegador muestra esa ruta relativa autorizada y no una ruta absoluta inventada del equipo del usuario. Los proyectos antiguos sin propietario conservan SQLite y no reciben una carpeta atribuida arbitrariamente a otra cuenta.

El editor muestra la ubicación bajo el selector de proyecto y en **Archivo → Contenido y niveles del proyecto**. La biblioteca de proyectos también muestra su carpeta. La carpeta es una proyección de la revisión actual: no duplica todo el historial y los binarios se enlazan cuando es posible.

Si se modifican archivos manualmente en esa carpeta, el servidor conserva esas modificaciones y muestra una advertencia en lugar de sobrescribirlas. Para convertirlas en un proyecto guardado hay que importarlas como copia. SQLite continúa siendo la fuente de verdad; editar el espejo no cambia silenciosamente un proyecto que otra persona tiene abierto.

## Trabajar con mapas o niveles

Desde el selector superior o **Contenido → Maps** puedes abrir un nivel. En el gestor también puedes renombrarlo, duplicarlo, definir el inicial, asignarle un módulo o eliminarlo.

Eliminar solicita confirmación dentro del panel, conserva al menos un nivel y permite deshacer/rehacer. Elimina conjuntamente sus objetos y configuración; los demás niveles y archivos importados permanecen. Después de guardar, Content se actualiza. Un nivel eliminado deja de ser navegable y su espacio interno puede reutilizarse al crear otro.

El editor industrial existente conserva sus diez espacios internos de nivel por compatibilidad. No se presenta como un sistema de mapas ilimitados ni como un editor Unreal. El formato independiente y el visor modular constituyen la base para otros adaptadores de proyecto.

## Guardar y abrir un proyecto independiente

En **Contenido del proyecto** están disponibles:

- **Descargar proyecto independiente**: crea un `.stproject.json` con el descriptor, los mapas, los recursos importados completos y la configuración. No incluye cuentas, permisos del servidor ni el motor.
- **Guardar carpeta local…**: Chrome y Edge compatibles permiten elegir una carpeta y crear dentro una carpeta nueva con `project.stproject`, Content y Config. Nunca se fusiona ni sobrescribe una carpeta existente.
- **Abrir carpeta de proyecto…**: reconoce el descriptor y comprueba los archivos antes de abrir una copia. Los blobs del servidor se verifican y se incluyen al trasladarlos.
- **Importar proyecto…**: admite el paquete independiente, el JSON anterior del editor y proyectos o sesiones modulares del mismo framework.

Importar conserva el proyecto anterior y abre una copia sin apropiarse de su identificador ni de sus permisos. **Guardar** crea un proyecto propio nuevo. Los datos desconocidos de funciones ausentes permanecen conservados. Un proyecto genérico abre sus funciones y datos en el editor; su experiencia visual depende de los adaptadores que aporte el sector.

En navegadores sin selección de carpetas, utiliza la descarga e importación del paquete JSON. El destino local lo elige el usuario; por las restricciones del navegador solo se muestra el nombre de la carpeta elegida, no una ruta completa de disco que el navegador no proporcione.

Herramientas de carpeta:

```sh
npm.cmd run project:content -- unpack --file MiProyecto.stproject.json --out NuevaCarpeta
npm.cmd run project:content -- inspect --project NuevaCarpeta
npm.cmd run project:content -- pack --project NuevaCarpeta --out Copia.stproject.json
```

Si has editado deliberadamente los JSON, `pack --refresh` vuelve a validar sus datos y produce un paquete nuevo con hashes nuevos. No sobreescribe el descriptor anterior ni ejecuta código contenido en los datos.

El compilador de proyectos genéricos reconoce también el descriptor o la carpeta:

```sh
npm.cmd run project:build -- --project projects/finca/project.stproject
```

Para compilar en esa instalación deben estar instaladas las versiones y dependencias locales requeridas. El documento y su estado se restauran antes de activar las funciones. Los proyectos industriales se abren en su editor, en lugar de fingir que el visor genérico incluye toda la simulación industrial.

## Módulos en el editor y en el visualizador

**Archivo → Módulos del proyecto** administra los sectores instalados, por ejemplo Agricultura, Alimentos, Educación, Turismo y Logística. La configuración permite:

- Añadir o quitar un paquete del proyecto conservando su estado opaco.
- Habilitarlo para edición y para el visitante de forma independiente.
- Trabajar con varios módulos o especializar el proyecto en uno.
- Seleccionar el módulo actual y mostrar sus niveles; los niveles compartidos permanecen disponibles.

El visitante elige entre los módulos habilitados por el autor. No puede cambiar esa configuración. En RV, la selección está en **Menú → Sonido y controles → Módulos y niveles del proyecto**. Los módulos visuales reciben un contenedor de contenido y los adaptadores gráficos autorizados; sus cargas se mantienen ocultas mientras cambia el contexto. No crean otro bucle de render.

Los servicios comunes, como un inventario, se conservan mientras otros consumidores los necesiten. Desactivar una referencia no elimina un proveedor todavía requerido. El editor industrial completo sigue teniendo ciclo de vida de página; desactivar funciones portables no equivale a desmontar todo ese motor en caliente.

## Intercambiar módulos con otra persona

El contenido del proyecto y el código del módulo son paquetes diferentes. Un proyecto puede viajar sin el motor; si la otra instalación no tiene el módulo requerido, hay que instalar su paquete compatible.

```sh
npm.cmd run module:pack -- export --module sector.agriculture --out agricultura.stmodule
npm.cmd run module:pack -- inspect --file agricultura.stmodule
npm.cmd run module:pack -- import --file agricultura.stmodule --trust-local-code
npm.cmd run build
```

La inspección informa archivos, hashes, capacidades y dependencias externas. La instalación no ejecuta el código, no concede puertos y no sobrescribe otro sector. El indicador `--trust-local-code` exige aceptar expresamente el código local revisado; al activar un módulo se ejecutará JavaScript de ese paquete. Un módulo no confiable no se convierte en seguro por usar el mismo framework.

Después de instalarlo y compilar, aparece en el catálogo del editor sin editar una lista central. Los proyectos dedicados pueden compilar exclusivamente su selección y sus dependencias. La publicación pública sigue conteniendo su único escenario autorizado; las carpetas y proyectos privados no se publican por esta función.

[Resultados y límites de la validación](project-content-validation-2026-10-30.md).
