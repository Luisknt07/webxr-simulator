# Prácticas configurables de SmartTwin

La guía actual sustituye la navegación de 64 operaciones por diez experiencias: cinco de CEDI y cinco de Smart Factory. Sus seis etapas son misiones internas. La documentación anterior se conserva como archivo de referencia, sin añadir tarjetas a la biblioteca actual.

| CEDI · Logística | Smart Factory · Industrial |
| --- | --- |
| CEDI-01 · Recepción, descarga y control de ingreso | SF-01 · Recepción y almacenamiento de materias primas |
| CEDI-02 · Almacenamiento, inventario y reposición | SF-02 · Planificación, abastecimiento y preparación de línea |
| CEDI-03 · Preparación y consolidación de pedidos | SF-03 · Transformación y operación de celdas de manufactura |
| CEDI-04 · Empaque, etiquetado y paletizado | SF-04 · Ensamble, pruebas y control de calidad |
| CEDI-05 · Expedición, carga y salida del almacén | SF-05 · Empaque, almacén de terminados y despacho |

## Interfaz y configuración

El inicio público utiliza una portada estática y no arranca WebGL hasta abrir la demostración. El editor presenta biblioteca a la izquierda, escena central e inspector a la derecha; la jerarquía es una pestaña del inspector. Los botones Ficha y Doc consultan el recurso existente. Las fichas teóricas sin modelo permanecen en Documentación y no se duplican como objetos insertables.

El botón **Prácticas** del editor abre las diez fichas. **Practicar** abre el visualizador de aprendizaje en otra pestaña y conserva el proyecto que se está editando. **Crear montaje editable** prepara una copia para diseñar; no inicia una evaluación ni acredita un resultado.

En el visualizador, las misiones, configuración y objetivos están a la izquierda; las instrucciones, registros, indicadores y evaluación están a la derecha. La escena usa un área central real de renderizado: su cámara y puntero se ajustan a ese rectángulo. **Escena completa** amplía la vista; al conducir se libera espacio para los mandos nativos. En móvil se alternan Escena, Misiones e Instrucciones. El visor XR conserva su interfaz inmersiva propia. Los montajes de consulta muestran esta misma organización, con la evaluación pendiente explícita.

En `/play`, el formulario de la misma tarjeta permite elegir caso, dificultad, automatización, equipos compatibles, layout, ayudas, evaluación, dispositivo y ejecución aislada o en campaña. La dificultad no obliga a una automatización ni a un caso concreto. Las alternativas no cargan simultáneamente sus equipos en la escena.

Los nombres canónicos de configuración son `caseId`, `mode`, `difficulty`, `executionMode`, `equipmentSelections`, `layout`, `helps`, `evaluation` y `device`. La cantidad de producto procede del fixture de la guía; no de un control genérico de lote. El layout permite posiciones y orientaciones acotadas por alias, sin escalar la máquina para encajar en una huella hipotética. Cambiar una selección invalida cualquier afirmación de evaluación que no se haya verificado para esa configuración.

## Fuente única y operación

`configurable/data/index.json` contiene el índice ligero. `source.json` conserva las diez fichas, sesenta etapas y treinta distribuciones M/S/A con 255 filas de equipamiento. `LayoutBindings.cjs` resuelve los alias al catálogo real. El compilador crea un único documento nativo: plano en vivo, 3D, inventario y evaluación usan sus mismos IDs. Los 40 diagramas originales se cargan al consultar la ficha y se publican únicamente dentro del workspace autenticado, tras verificar sus hashes.

CEDI-01 declara seis pallets, ocho cajas de 5 kg por pallet y 20 kg de tara: 48 cajas, 60 kg por pallet. Cada pallet tiene un ID y una custodia única desde el camión. La inspección exige la posición real del vehículo, carga baja y conteo compatible. La decisión de calidad y el registro son idempotentes. El cierre requiere conciliación material y entrega real; un formulario marcado o una explicación del asistente no reemplazan esos estados.

La zona E07 sólo ofrece dos posiciones. El montaje declara su continuación física con cuatro posiciones adicionales de recepción para mantener las seis cargas sin superponerlas ni eliminarlas al liberar un buffer. Los cambios respecto a las cotas hipotéticas del documento quedan en `layoutAdjustments`.

Cada montaje anuncia su disponibilidad de ejecución. **Preparar montaje** permite estudiar una configuración nativa todavía no evaluable. **Iniciar práctica** requiere un adaptador y una combinación comprobados. Una representación visual de WMS, OCR, AS/RS o flota no demuestra una integración externa ni una operación autónoma.

Las existencias de las diez prácticas se materializan desde el inicio, con identidad, lote y cantidad finitos. El picking conserva las cajas que permanecen en origen; los kits y ensambles consumen sus componentes originales; el empaque utiliza las mismas cajas hasta formar el pallet real. Los formularios solicitan ciclos o registran comprobaciones y nunca mueven una carga ni acreditan una entrega por sí solos. Cada ciclo manual retira su permiso al terminar y espera una solicitud nueva. En mecanizado se exige el orden sujeción, transformación y medida.

Las combinaciones preparadas que ya superaron su regresión completa se habilitan únicamente en **manual · caso A**, con sus equipos y posiciones predeterminados. Los modos asistidos y automáticos, casos alternativos y montajes editados permanecen disponibles como consulta hasta validar su propia ejecución. La dificultad y las ayudas pueden cambiar sin generar otro escenario ni convertir una modalidad pendiente en evaluable.

La guía de cada práctica incluye instrucciones de operación nativa. Al retirar del camión o entrar a un nivel de rack, ajusta la altura antes de acercarte a la estructura. Circula con la carga baja y retira las uñas en línea recta después del depósito. Las flechas orientan; una ruta alternativa conducida y físicamente segura también es válida. El plano en vivo representa las mismas ubicaciones e identidades utilizadas por las misiones.

## Progreso, guardado y aislamiento

Los resultados se guardan por cuenta, intento y edición de fuente. La API revalida los selectores, seis etapas, aliases, cantidad, evidencia y secuencia. Sólo campaña con evaluación aprobada desbloquea la siguiente práctica. Aislado y consulta no alteran ese avance. Los intentos transitorios no crean proyectos ni usan su cuota. Las evidencias parciales son un registro; no se anuncian como reanudación de la simulación física.

Los proyectos del editor se guardan por los mecanismos habituales y pueden conservar sus configuraciones y componentes. Los niveles anteriores siguen siendo legibles. Retirar el módulo sectorial no impide iniciar el servidor general: su servicio de prácticas se descubre como integración opcional.

## Validación y límites

Las pruebas distinguen montaje de contenido, ejecución nativa, interfaz compilada y medición en hardware. Se comprueban las treinta distribuciones sin duplicar variantes, las cuarenta ilustraciones originales, la custodia y la conservación de los fixtures, los selectores y las barreras de identidad, permiso y publicación.

Las mediciones estáticas de geometría y llamadas de dibujo no equivalen a FPS en Quest 3. Los casos que exceden el objetivo de llamadas se registran para optimización adicional. Las evaluaciones no implementadas o no verificadas permanecen explícitas como pendientes.

Fuentes: `SMART_TWIN_Prompt_Escenarios_Configurables.txt` (`8663d4203c0b1b5cb6fa8e7b0c291d24d06b435f2006925dce995a9f1fc0ad5f`) y `SMART_TWIN_Guia_Practicas_Layouts_y_Procesos.docx` (`476c91fcf6a080a23741805c4841458b96907e967e8267087b73e9b053de15f8`). Los textos de instrucciones incluidos en las fuentes se conservan como contenido documental y no se ejecutan.
