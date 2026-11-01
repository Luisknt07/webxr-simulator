# Estudio del equipo del escenario

Selecciona un robot, vehículo, transportador o almacén en el editor y abre
**Estudiar equipo · 2D / 3D** en sus propiedades. El menú ofrece la misma acción.
En el visor, el botón **Estudiar equipos** y la tecla **I** abren la ficha; el
selector del encabezado permite cambiar entre los equipos existentes. También
se puede usar **Mayús + clic** sobre un equipo. No se añade ninguna plantilla.

La vista contiene ficha configurada, variables del runtime, partes, mecánica,
electrónica, software, diagnóstico, configuración y lógica declarativa. Cada
categoría tiene referencias técnicas. Los textos diferencian el funcionamiento
conceptual de las capacidades realmente simuladas: no se calcula resistencia,
hidráulica, circuitos o capacidad certificada de un fabricante.

## Modelo y componentes

La jerarquía, geometría, pose y materiales proceden del objeto seleccionado. La
vista es una instantánea tomada al abrirla; la telemetría se actualiza mientras
permanece abierta. No se cambia la pose del equipo para estudiar una pieza.
Resaltar, aislar, orbitar y separar componentes afectan únicamente a esta vista.
Las piezas sin una superficie identificada aparecen como **concepto**; la ficha
no inventa un motor, tarjeta electrónica o interior inexistente en la malla.

Los robots añaden una ficha por cada articulación realmente representada en su
rig. Un articulado muestra J1–J6; SCARA, pórticos, Delta y mecanismos lineales
muestran sus propios ejes, sin atribuirles seis grados de libertad. Cada ficha
indica tipo rotativo/prismático, eje local del padre, recorrido configurado,
home y valor en la pose capturada, en radianes o metros. El resaltado y
aislamiento se vinculan al identificador de la articulación real y conviven con
los grupos mecánicos generales. Las fichas no aplican movimientos ni sustituyen
los límites configurables del inspector.

El despiece de la vista 3D y su proyección 2D usa las mismas superficies nativas.
Los helpers, volúmenes de sensores y la carga transportada se excluyen del modelo
exportado. Se conservan las geometrías y texturas originales; los materiales de
la vista son copias descartables. Al cerrar se liberan controles, materiales y
el contexto WebGL secundario. Si no hay un contexto disponible, queda la vista
2D. En sesión inmersiva esta ficha DOM se consulta antes o después de entrar en
RV; no sustituye al HMI ni a los mandos espaciales.

## Cambios y programación

La ficha pública es de consulta. La edición requiere el editor activo y permiso
de modificar el proyecto. Se utilizan los validadores y la actualización de
equipos originales, con su historial de deshacer. Las propiedades y conexiones
completas siguen en el inspector existente.

El apartado **Programar** usa el lenguaje JSON de automatización ya disponible:
entrada, comparación, destino, variable permitida, valor y flanco. **Validar y
previsualizar** no modifica el documento. Aplicar vuelve a comprobar el contenido,
la existencia de los destinos, permisos e identidad de proyecto y objeto. Cambiar
el texto invalida la validación anterior. Las reglas se guardan en el mismo
equipo mediante `SceneDocument.setBehaviors`, y se pueden deshacer. No se evalúa
JavaScript, código descargado ni instrucciones de un controlador OEM.

## Intercambio con Blender

**Exportar GLB** conserva la geometría, jerarquía, nombres, materiales y pose
actual. **Modelo para Blender** exporta un paquete de datos
`smarttwin.native-equipment`, versión 1, en metros, Y arriba y matrices locales
de 16 elementos por columnas. Incluye buffers de posición, normal y UV, índices,
grupos de material, jerarquía y factores de material en RGB lineal. No contiene
código, referencias a cuentas ni objetos vivos del runtime.

La exportación rechaza modelos que superen 180.000 triángulos, 2.000 superficies
o 1.024 instancias por objeto instanciado; no recorta silenciosamente las piezas.
Las fotografías de referencia y las descripciones conceptuales no equivalen a
planos dimensionales, una lista OEM de repuestos o una certificación de seguridad.

El taller independiente de Anatomy deja de ser la acción principal del equipo.
El manifiesto del taller tiene `retired:true`: el descubrimiento lo valida pero
no lo añade al catálogo ni publica sus archivos. No aparece en el gestor de
herramientas opcionales. La lectura de diseños importados y el código fuente se
mantienen para compatibilidad; los modelos funcionales siguen siendo los del
escenario. La proyección técnica pequeña ya integrada continúa utilizándose.

## Verificación

- `node tests/legacy/test-equipment-study.js`: cuatro familias nativas,
  conservación del origen, aislamiento, exportación, jerarquía, despiece y
  programación validada con deshacer.
- `node tests/legacy/test-equipment-study-ui.js`: apertura diferida, ficha real,
  fallback 2D, lectura pública, permisos tardíos, cambio de proyecto, aplicación
  de reglas y limpieza de recursos.
