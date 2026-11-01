# Taller de diseño Anatomy

Anatomy se integra como herramienta opcional, independiente de los módulos por sector. Su código está en `packages/tools/anatomy/`; el editor usa un anfitrión genérico en `packages/tools/editor/src/DesignToolHost.js`. La procedencia, los hashes y la licencia MIT del repositorio original se conservan junto al código importado.

## Uso

1. Abre un proyecto con permisos de edición. En **Añadir**, elige **Diseño y despiece 2D/3D**. También puedes abrirlo desde el inspector de un objeto seleccionado.
2. Empieza con un robot, montacargas, estantería con pallets, transportador de rodillos, bomba, panel de control o diagrama de proceso. Modifica sus piezas, perfiles, tubos, dimensiones, transformaciones y materiales. Los grupos pueden tener movimiento de bisagra o desplazamiento.
3. Examina la vista 2D, la órbita 3D, las proyecciones, la transparencia y el despiece. **Verificar** muestra problemas topológicos; no certifica fabricación ni resistencia.
4. **Insertar en escenario** crea piezas CAD independientes, agrupadas y colocadas en una zona libre. Una sola acción de deshacer retira el conjunto. Para editarlo después, selecciona una de sus piezas y vuelve a abrir el taller; **Actualizar objeto** conserva la posición del conjunto.
5. **Guardar diseño** añade un documento `.anatomy.json` editable y un plano `.svg` a **Archivos del proyecto**. Guarda después el proyecto para persistir su documento y referencias en el servidor. También puedes descargar JSON, SVG y PNG, o imprimir el plano desde el taller.

Las exportaciones del proyecto conservan los recursos en `Content/Assets/` y los objetos de cada nivel en `Content/Maps/`. El editor muestra la carpeta del proyecto en su explorador de contenido. El modelo de cada pieza viaja en sus metadatos CAD: puede visualizarse sin tener Anatomy instalado y volver a editarse cuando se reincorpore la herramienta.

Al abrir un equipo existente, el taller captura su geometría visible y sus grupos de material. Puedes aplicar un material a la pieza capturada o insertar una variante de diseño independiente. Los robots, bandas y vehículos originales conservan sus fábricas, comportamiento, colisiones y misiones; insertar un diseño nuevo no le asigna automáticamente esas funciones.

## Activación y portabilidad

**Añadir → Herramientas de diseño instaladas** permite activar o desactivar cada herramienta para el proyecto y cuenta actuales. La herramienta sólo se carga al abrirse. Para retirarla de una distribución, retira su carpeta de `packages/tools/` y recompila; sus mallas CAD guardadas continúan siendo legibles por el motor genérico. Para incorporarla a otro proyecto del mismo framework, copia el paquete completo y recompila. Los nuevos paquetes deben seguir el contrato `tool.json`; el código de sus adaptadores requiere revisión antes de instalarse.

El núcleo, las aplicaciones públicas y los módulos sectoriales no importan Anatomy. El empaquetador genera `editor-tools.json` sólo para el Workspace privado. El servidor exige sesión para el catálogo, la interfaz, los módulos y las muestras; no publica la raíz del repositorio. Los siete ejemplos HTML se muestran aislados, sin acceso al editor ni conexión de red. Los scripts originales de compilación y publicación permanecen como fuente local y se excluyen de los recursos HTTP.

## Alcance y rendimiento

El documento admite 96 piezas, 48 grupos y hasta 60.000 triángulos por diseño, sujeto a la cuota de almacenamiento y al presupuesto total del proyecto. Por encima de 24.000, la vista vectorial desactiva el arrastre continuo y ofrece controles de ángulo. Una malla capturada cerca del máximo puede superar la cuota inicial de 20 MiB porque conserva tanto la receta como los triángulos y su fuente editable. Estos límites de autoría no garantizan un presupuesto de RV: para Quest conviene reutilizar componentes, simplificar piezas y probar cada escena en el visor.

Anatomy aporta ilustración técnica y vistas proyectadas SVG/Canvas. El adaptador convierte el mismo documento en geometría real Y-up, en metros, para Three.js y WebXR. La cámara estereoscópica y la simulación continúan en el motor existente. Las superficies procedentes de un objeto se capturan como mallas; las plantillas del taller conservan sus parámetros de construcción. No se convierten automáticamente todos los recursos del proyecto ni se sustituyen sus texturas.

El kit original completo, incluidas APIs de auditoría, efectos WebGL, Canvas, TURN, impresión y fuentes React opcionales, está documentado en [la referencia del paquete](../packages/tools/anatomy/README.md). Las funciones de desarrollador no se presentan como comandos remotos ni como operaciones disponibles para documentos importados.

## Validación

```powershell
npm.cmd run test:anatomy
npm.cmd run test:anatomy-browser -- --expected-workspace-sha256 <hash-del-bundle-revisado>
```

La primera orden comprueba geometría, fuente vendorizada, render, seguridad del contrato y el taller en cuatro tamaños. La segunda comprueba la integración autenticada con el editor compilado y proyectos temporales. Las pruebas de escritorio no sustituyen la comprobación física con Quest 3.

Consulta el [registro de validación de la integración](anatomy-validation-2026-10-31.md).
