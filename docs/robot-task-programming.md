# Tareas programadas del robot existente

La pestaña **Programar** del estudio permite configurar un ciclo de recogida,
traslado y entrega del mismo robot que trabaja en el escenario. La tarea se
guarda en el comportamiento `robot` como `taskProgramJson`, y se activa con
`taskEnabled`. Ambos campos tienen valores vacíos/inactivos por defecto; no se
cambia la operación de un proyecto guardado que no haya activado una tarea.

## Preparar y probar una tarea

1. Elegir el equipo de recogida y el receptor entre los equipos del nivel.
2. Revisar las coordenadas TCP calculadas. X/Y/Z están en metros en el marco
   local de la base del robot; **Y es altura**, no profundidad.
3. Ajustar la velocidad, altura de aproximación y esperas de recogida/depósito.
4. Añadir hasta ocho puntos TCP intermedios para indicar **por dónde** trasladar
   la carga. El orden de las filas es el orden de paso.
5. Elegir retorno a la pose de origen o introducir una coordenada de retorno.
6. Validar y usar Simular, Pausar, Paso siguiente o Restablecer vista.
7. Activar la tarea y guardarla en el robot. La aplicación queda en **modo
   manual y detenida**. Iniciar y solicitar el ciclo desde el panel del robot.
8. Guardar el proyecto para conservar el cambio. La aplicación de tarea,
   conexiones y parámetros es una sola operación que admite Ctrl+Z.

Con **Repetir ciclos**, el primer ciclo manual sigue necesitando una orden
explícita. Después de un retorno correcto, el controlador toma la carga siguiente
mientras el robot siga habilitado y existan productos y espacio receptor. Parada,
pausa y emergencia conservan sus funciones originales.

## Contacto real y puntos de paso

El programa no asigna directamente la posición de una caja. La fuente conserva
la cola/estiba y el receptor calcula su celda o posición de apoyo actual. Por eso
los puntos finales se muestran como datos derivados de esos equipos, y los
puntos de paso son los que se editan numéricamente. Esto evita que una tarea
salte la custodia de una carga o la deposite en una pila que haya cambiado.

La ejecución reutiliza la IK, límites, retirada vertical, orientación de carga,
comprobaciones del brazo y entrega del `RobotRuntime`. Los pasos intermedios no
usan un controlador alternativo ni cambian el propietario o matriz del producto.
Una interferencia bloquea y restaura la pose/carga del paso, igual que en un
ciclo automático. El progreso y propietario se conservan en checkpoints.

La previsualización es **cinemática y aislada**: copia poses numéricas, muestra
el recorrido en planta/alzado y anima una carga de demostración etiquetada en
el estudio 3D. No genera ni retira inventario, y no sustituye la comprobación de
colisiones del escenario. La coordenada de recogida se mide en una carga ya
presente; si no está materializada, se calcula con la configuración de su fuente.
La procedencia se muestra junto a las coordenadas.

## Código y parámetros

El formulario genera el JSON declarativo. Para importar una receta, pegar el JSON
y usar **Cargar JSON en los parámetros**; después validar de nuevo. El JSON no
admite JavaScript, HTML, URLs ejecutables ni campos adicionales. Las referencias
se validan contra los equipos del nivel y vuelven a comprobarse antes de aplicar.

Ejemplo (reemplazar los dos identificadores con equipos reales):

```json
{
  "version": 1,
  "name": "Transferencia por punto de control",
  "sourceId": "source-a",
  "outputId": "source-b",
  "speed": 0.45,
  "clearance": 0.18,
  "gripWait": 0.2,
  "releaseWait": 0.2,
  "via": [{"x": 0.8, "y": 1.1, "z": 0.0}],
  "returnPoint": null,
  "repeat": false
}
```

La tarea corresponde a robots fijos de manipulación: articulado, paletizador,
SCARA, cartesiano, cilíndrico, polar y delta. Los AMR/AGV y herramientas de proceso
conservan sus controladores especializados. La capacidad, volumen admitido,
herramienta y alcance siguen siendo parámetros originales del equipo.

En la vista pública se puede estudiar y previsualizar. La escritura requiere
permisos vigentes del proyecto. Si cambia el proyecto, nivel o permiso mientras
la aplicación está pendiente, la operación se cancela antes de mutar el documento.

## Validación

- `node --test tests/framework/robot-task-program.test.mjs`: límites, JSON,
  referencias coherentes, trayectorias IK y conservación de entradas.
- `node tests/legacy/test-robot-task-runtime.js`: ciclo nativo con la misma carga,
  recogida/entrega, vía intermedia, retorno, repetición, emergencia, rollback y
  continuación exacta de checkpoint.
- `node tests/legacy/test-robot-task-panel.js`: reproducción aislada, importación,
  escritura manual explícita, deshacer, permisos, lectura pública y cambio tardío
  de proyecto.
