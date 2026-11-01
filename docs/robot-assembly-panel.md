# Configuración de ensamblajes del robot

`RobotAssemblyPanel` se integra en **Estudiar → Configurar**. Trabaja sobre el robot funcional seleccionado; no crea una plantilla ni un equipo adicional. Su disponibilidad se limita al articulado general de seis ejes con modelo visual nativo. Los modelos heredados y las familias especializadas conservan su configuración existente.

Las tarjetas seleccionan un conjunto compacto, industrial, de largo alcance o reforzado. Los selectores sólo ofrecen piezas compatibles para base, hombro, brazo superior, antebrazo y muñeca. Al cambiar de conjunto se restablecen a Automático únicamente las piezas que dejan de ser compatibles; se conservan las elecciones que siguen siendo válidas. La lista final muestra las piezas efectivas, incluidos los valores Automático, y la herramienta elegida.

Estos conjuntos representan formas educativas genéricas con interfaces mecánicas comunes. Cambiar una carcasa no certifica un nuevo alcance, capacidad de carga ni una clasificación de seguridad del fabricante. Se mantienen los parámetros operativos configurados y los mecanismos del mismo robot.

Aplicar usa los normalizadores del catálogo y `SceneEditor.setEquipmentBehaviors` sobre el mismo objeto. Se comprueban permisos y contexto nuevamente dentro de `perform`: documento, sala, generación del proyecto e identidad del equipo deben coincidir. La actualización combina los parámetros actuales con los campos del ensamblaje, preservando ediciones ajenas y la posibilidad de deshacer en una sola operación. Guardar el proyecto conserva el resultado.

La vista pública permite consultar las piezas resueltas sin aplicar cambios. El panel no ofrece previsualización si el visor no proporciona un constructor nativo conectado. Cuando está disponible, usa exclusivamente `viewer.previewRobotAssembly(configNormalizada)` y limpia el resultado con `viewer.clearRobotAssemblyPreview()` al cambiar de selección o cerrar. La vista previa no escribe la escena original.

La API es `new RobotAssemblyPanel(viewer).mount(host)` y `dispose()`. El visor debe añadir `ROBOT_ASSEMBLY_STYLE`, mantener los controles de autorización existentes y destruir el panel al cerrar. La prueba `tests/framework/robot-assembly-panel.test.mjs` usa el documento y los prefabs reales para comprobar compatibilidad, preservación del objeto, deshacer, permisos tardíos, cambios de contexto, lectura pública y limpieza de la previsualización.
