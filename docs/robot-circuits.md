# Circuitos didácticos sobre el robot existente

`RobotCircuitPanel` amplía «Electrónica» del estudio de un robot. Utiliza el mismo
objeto seleccionado, sus identificadores de componente, los ejes realmente
definidos por su rig y su estado de simulación. No construye una segunda máquina
ni modifica la pose, los materiales, la configuración o el programa.

## Tres hojas conectadas

| Hoja | Qué permite seguir | Interfaces del ejemplo |
| --- | --- | --- |
| Armario | Rama protegida de potencia, control, petición/respuesta, seguridad y continuación hacia herramienta | PS1 L+/M, PLC Q_START/I_READY, C1 DI_START/DO_READY/BUS_CMD, SF1 A/B, D1 STO_A/B, PE |
| Robot y encoder | Drive → motor y motor → lector → drive, diferenciados por color y sentido | U/V/W, PE, A+/A−, B+/B−, V_ENC/M_ENC y acoplamiento mecánico |
| Herramienta | Alimentación → salida PNP → bobina → distribuidor → actuador; confirmación de vuelta a control | +24 V/0 V del ejemplo, DO_GRIP, A1/A2, aire P/A, DI_GRIP |

Hay 40 conexiones y 77 terminales seleccionables. Cada conductor llega a los
bornes definidos en el catálogo. Un clic en cable o borne abre origen/destino,
significado, unidad, diagnóstico conceptual y fuentes. También puede elegirse con
los desplegables y con teclado. Las rutas son ortogonales; la selección atenúa
las demás para seguir el trayecto. Los círculos identifican conexiones: un cruce
sin borne no crea una unión.

Las etiquetas de bornes tienen prioridad sobre los identificadores opcionales
de rutas. Un ajuste acotado usa sus cajas SVG reales para separarlas de títulos,
símbolos y otros bornes; un ID de ruta que no cabe se conserva en el selector y
la ficha de conexión, sin superponerlo sobre el esquema. La auditoría compilada
comprueba todos los textos visibles de las tres hojas en escritorio y móvil,
tanto ajustados al panel como ampliados.

Los cortes de motor, encoder, drive, salida/bobina, lógica y seguridad explican
funciones internas. La foto de servo o encoder se amplía mediante el lector de
referencias existente. «Relacionar con el equipo 3D existente» sólo solicita un
resaltado de la carcasa, eje o conjunto identificado; no afirma que una carcasa
contenga un motor interno independiente modelado. El eje se elige entre los
J1–Jn disponibles, conservando su unidad real (`rad` o `m`).

La acción de un cable relaciona su función con los mazos exteriores ya modelados
(`robot.harness`, `robot.base-services`, `robot.tool-services`) o el armario
`robot.control-cabinet`. No identifica un hilo OEM individual. El CAD de codo
incluye la carcasa del accionamiento; rotor, bobinado y encoder internos siguen
siendo cortes conceptuales, no mallas internas inventadas.

La reproducción recorre siete pasos: potencia/PE, alimentación de control,
seguridad, petición y coordinación, lazo de servo, herramienta y confirmación.
Es una animación pedagógica, no una simulación eléctrica. Se detiene al terminar,
no avanza mientras el panel está oculto y libera el temporizador al cerrarse.

## Qué se observa y qué se explica

La fila de estado sólo lee `powered`, `running`, `paused`, `emergency`, `phase`,
`fault`, `inFlight`, `loadKg` y `completed`. La coordenada articular se toma de la
pose actual o de `variables.joints`; si no hay registro activo, se identifica
como pose capturada. No hay valores inventados de voltaje, corriente, par,
temperatura, presión, continuidad, DI/DO físico o pulsos adquiridos. La custodia
`inFlight` y `loadKg` no se presentan como señal física del sensor B1.

Las etiquetas de bornes son nombres de interfaces del ejemplo, no números de
pin de KUKA, UR, Siemens u otro OEM. Las hojas no son un plano de instalación
exhaustivo: las referencias de alimentación, comunes, protecciones, capacidad de
carga, blindaje y funciones de parada específicas requieren el manual del modelo
real. La rama auxiliar de 24 V DC no fija la alimentación de potencia del robot.
PE se mantiene separado del retorno de señal 0 V en esta representación; no se
prescribe una unión universal para una instalación concreta.

## Fundamento y diferencias que se conservan

- [UR: Controller I/O](https://www.universal-robots.com/manuals/EN/HTML/SW10_10/Content/prod-usr-man/complianceUR20/H_g5_sections/installation/controller_i_o.htm)
  fundamenta separar alimentación de control, entradas y salidas. Se usa como
  referencia de interfaces; no se copia su pinout en el robot genérico.
- [UR: Tool Digital Outputs](https://www.universal-robots.com/manuals/EN/HTML/SW10_15/Content/prod-usr-man/complianceUR12e/H_g5_sections/installation/tool_digital_outputs.htm)
  distingue salidas sourcing/PNP de sinking/NPN y muestra protección de cargas
  inductivas. La hoja utiliza un ejemplo PNP, no todas las variantes posibles.
- [UR: Safety I/O](https://www.universal-robots.com/manuals/EN/HTML/SW10_9/Content/prod-usr-man/complianceUR20/H_g5_sections/installation/safety_i_o.htm)
  diferencia canales emparejados y tipos de parada. No se transfieren PL, SIL o
  categoría de parada a SmartTwin.
- [Rockwell: Kinetix 5500, 2198-IN001](https://literature.rockwellautomation.com/idc/groups/literature/documents/in/2198-in001_-en-p.pdf)
  documenta una interfaz STO con dos entradas y común. Sustenta la alternativa
  didáctica de dos canales, sin usar sus números de pin ni circuitos de bypass.
- [Siemens: F-TM ServoDrive ST, 06/2023](https://cache.industry.siemens.com/dl/files/075/109823075/att_1149394/v1/F-TM_ServoDrive_ST_equip_man_0623_en-US.pdf)
  distingue fases U/V/W, señales diferenciales de encoder y su alimentación.
  Su interfaz STO+/STO− es distinta del ejemplo STO_A/B; la alimentación del
  encoder depende del dispositivo, no se presupone 24 V.
- [ifm: Incremental encoders](https://www.ifm.com/us/en/us/learn-more/motion-control/encoders/incremental-encoders)
  explica canales A/B desfasados y posición relativa. La escala ilustrada no
  atribuye una resolución numérica al robot nativo.
- [ifm: Absolute encoders](https://www.ifm.com/gb/en/shared/technologies/drehgeber/absolute-encoders)
  identifica el RM9000 de la foto como absoluto CANopen. Es otra interfaz;
  CANopen/SSI no comparten la tabla de conexiones incremental A/B del ejemplo.
- [Siemens: SINAMICS Engineering Manual](https://cache.industry.siemens.com/dl/files/185/83180185/att_1023081/v1/SINAMICS_Engineering_manual_V6.6_February_2020_external-e.pdf)
  sirve de referencia para diferenciar potencia, realimentación y blindajes.

Fuentes consultadas el 1 de noviembre de 2026. Se enlazan manuales oficiales; no
hay iframe arbitrario, extracción de HTML remoto ni solicitud a una API de IA.
Las imágenes proceden de la lista local revisada del estudio de equipos.

## Integración y prueba

```js
const circuit = new RobotCircuitPanel({
  document, host, description,
  getRecord: () => currentRuntimeRecord,
  getObject: () => selectedNativeObject,
  onHighlight: ({componentIds, jointId, conceptual, component}) => {},
  onReference: reference => existingLearningPanel.openPhoto(reference)
}).mount();
circuit.setView('robot');
circuit.refresh();
// Al cerrar/cambiar equipo:
circuit.dispose();
```

El host incorpora `ROBOT_CIRCUIT_STYLE` una vez. `setView`, `selectWire`,
`selectTerminal`, `selectComponent` y `setStep` rechazan identificadores
desconocidos. `onHighlight` sólo se invoca con la acción explícita de relacionar
el componente. Ninguna función de este panel aplica órdenes al runtime.

`node --test tests/framework/robot-circuits.test.mjs` comprueba la conectividad de
las tres hojas, extremos exactos, rutas finitas/ortogonales, separación PE/0 V,
identidades y fuentes, valores reales/capturados, selección accesible de cables
y bornes, seis ejes del prefab nativo, fotografías, ausencia de cambios al
documento, temporizador acotado y liberación al cerrar. La lectura en navegador y
la legibilidad de escritorio/móvil se verifican sobre el bundle compilado, no se
deducen de estas pruebas de catálogo/DOM.
