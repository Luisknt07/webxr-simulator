// Public, stable preset IDs are also the authoring / QA API.
const lesson = (id, title, description, difficulty, objective, tasks, extra = {}) => Object.assign({id, title, description, difficulty,
  objective, tasks, mode: 'automatic', family: 'Fundamentos', version: 1}, extra);

export const STUDY_ENVIRONMENT_DEFAULTS = Object.freeze({renderQuality: 'high', shadows: true, exposure: .9, sunIntensity: .85, ambientIntensity: .15,
  machineSounds: true, machineVolume: .25, ambientPreset: 'warehouse', ambientSound: '', ambientVolume: .12});

export const STUDY_SCENES = [
  lesson('vr-warehouse-missions', 'RV · Almacén, rutas y ubicaciones', 'Un montacargas manual, una estantería selectiva de ocho ubicaciones y tres pallets reales. Practica retirada, reposición y entrega en bahías demarcadas con rutas y atraque holográfico.', 2,
    'Trasladar el pallet indicado hasta su ubicación exacta, siguiendo el pasillo y conservando su identidad y contenido.', ['Retira el pallet del nivel superior y entrégalo en SALIDA S01.', 'Recoge el pallet de ENTRADA E01 y repón la ubicación superior reservada de la fila R01.', 'Baja el pallet del primer nivel y deposítalo en DEVOLUCIÓN D01.'], {family: 'Realidad virtual compacta', compactVR: 'warehouse', warehouseTraining: true, mode: 'manual', expectedUnits: 12}),
  lesson('vr-robot-dispatch', 'RV · Robot, banda y montacargas', 'Una célula de expedición con un robot, un transportador de pallets y un montacargas. Lote finito de dos pallets de cuatro cajas.', 1,
    'Seguir la misma carga desde la recogida robótica hasta la entrega manual con las horquillas.', ['Observa al robot colocar el pallet sobre la banda.', 'Espera el paro de la banda y recoge el pallet con las dos uñas.', 'Deposita en la bahía y pulsa Marcha para el segundo pallet.'], {family: 'Realidad virtual compacta', compactVR: 'dispatch', mode: 'mixed', expectedUnits: 8}),
  lesson('vr-robot-transfer', 'RV · Transferencia entre dos bandas', 'Un robot, dos tramos cortos y un montacargas. Dos pallets como máximo y una sola zona de entrega.', 2,
    'Comprobar continuidad y paro de entrega en una línea corta con recogida manual.', ['Sigue el mismo pallet durante la entrega del robot y el cruce entre bandas.', 'Comprueba el paro del último tramo antes de aproximarte con el montacargas.', 'Entrega los dos pallets sin crear cargas adicionales.'], {family: 'Realidad virtual compacta', compactVR: 'transfer', mode: 'mixed', expectedUnits: 8}),
  lesson('vr-robot-turn', 'RV · Giro y expedición compacta', 'Un robot, una mesa de giro, un tramo de salida y un montacargas. Lote limitado a dos pallets.', 2,
    'Relacionar el giro de 90° con la salida y la recogida real de la carga.', ['Observa la entrega del robot y el giro del pallet.', 'Recoge solo después del paro del tramo final.', 'Transporta bajo y entrega en las dos bahías disponibles.'], {family: 'Realidad virtual compacta', compactVR: 'turn', mode: 'mixed', expectedUnits: 8}),
  lesson('forklift-training', 'Montacargas · práctica de once tipologías', 'Once puestos de conducción con pallets vacíos y cargados, recepción a piso, rodillos, cadenas y racks elevados para los equipos apropiados. Sin generación automática de cargas.', 2,
    'Comparar conducción, mecanismos propios y transferencia de pallets conservando la carga real.', ['Libera Freno P y conduce el equipo de cada puesto.', 'Alinea ambas uñas, recoge doce cajas como un pallet y deposítalo con apoyo completo.', 'Compara retráctil, VNA, telescópico y las transpaletas de baja elevación.'], {family: 'Logística y montacargas', vehicles: true, mode: 'manual'}),
  lesson('cedi-sorting-robotics', 'CEDI robotizado · Clasificación y expedición', 'Células reales de carga, transferencia y descarga se intercalan en la clasificación. Un Source de pallets completos alimenta las cadenas de expedición y su montacargas.', 3,
    'Coordinar las mismas cargas entre robots, transportadores y almacenes sin duplicar inventario.', ['Observa la pinza retirar cada producto del equipo anterior y depositarlo en el siguiente.', 'Sigue las decisiones de clasificación y la descarga robótica al almacén.', 'Recoge con el montacargas un pallet producido en las cadenas y llévalo al destino.'], {family: 'CEDI robotizados', kind: 'sorting', robotized: true, mode: 'mixed'}),
  lesson('cedi-packing-robotics', 'CEDI robotizado · Packing y logística', 'Carga desde Source, transferencia entre transportadores y descarga robótica conservan la agrupación y separación de productos. Expedición manual con pallets completos reales.', 3,
    'Comprobar conservación de unidades entre manipulación robótica, Combiner, Separator y expedición.', ['Sigue la misma carga durante la recogida, traslado y entrega robótica.', 'Compara el contenido del Combiner y del Separator.', 'Extrae desde las cadenas los pallets completos del Source y deposítalos en sus bahías.'], {family: 'CEDI robotizados', kind: 'packing', robotized: true, mode: 'mixed'}),
  lesson('robot-handling-line', 'Robótica · Manipulación y expedición', 'Un brazo de seis ejes con pinza recoge tres formatos y alimenta una banda hacia el almacén de pallets.', 2,
    'Relacionar alcance, herramienta, tiempo de ciclo y transferencia entre equipos conservando la trazabilidad.', ['Observa cómo el robot recoge del Source y entrega a la entrada de banda.', 'Consulta articulaciones, carga retenida y TCP en el monitor.', 'Pausa y reanuda el panel: la carga debe conservarse.'], {family: 'Robótica industrial', robot: 'handling'}),
  lesson('robot-scara-sorting', 'Robótica · SCARA y clasificación', 'SCARA con eje vertical y tres formatos alimenta un clasificador en T con dos almacenes por calidad simulada.', 3,
    'Supervisar una celda de picking y comprobar que cada carga conserva sus atributos en la clasificación.', ['Sigue cajas y contenedores de tres tamaños desde el Source.', 'Compara productos conformes y defectuosos en las dos salidas.', 'Comprueba preparación, ciclos del robot y ocupación de los almacenes.'], {family: 'Robótica industrial', robot: 'scara'}),
  lesson('lab-transfer-l', 'Transferencia rectangular a 90°', 'Dos rectas de rodillos conectadas por correas elevables. Una L real con detección y descarga a estibas.', 1,
    'Comprender la secuencia posicionar, elevar y transferir.', ['Ejecuta y sigue una caja desde Source hasta el almacén.', 'Pausa el PLC y comprueba que se detiene toda la línea.', 'Compara sensores de entrada y salida en el monitor.'], {cellId: 'transfer-l'}),
  lesson('lab-sorting', 'Inspección y clasificación', 'FIFO, inspección y desvío por calidad hacia dos almacenes. Los atributos de calidad son datos simulados.', 2,
    'Relacionar una regla de calidad con su salida física.', ['Consulta la secuencia de productos del Source.', 'Sigue una caja conforme y una defectuosa.', 'Verifica las dos salidas en Analítica.'], {cellId: 'sorting'}),
  lesson('lab-merge', 'Unión en Y y acumulación', 'Dos alimentaciones se unen en una red con acumulación por zonas y un PLC común.', 2,
    'Estudiar coordinación de entradas y contrapresión.', ['Observa la alternancia de las dos entradas.', 'Pausa la descarga y observa ocupación de zonas.', 'Reanuda y compara entradas, almacenado y salida.'], {cellId: 'merge'}),
  lesson('lab-elevator', 'Transporte entre niveles', 'Elevador de cajas con recepción inferior y descarga superior sobre plataforma accesible.', 2,
    'Identificar enclavamientos de recepción, elevación y evacuación.', ['Observa un ciclo completo del elevador.', 'Consulta su fase en el monitor.', 'Accede a la descarga por la plataforma y comprueba el almacén.'], {cellId: 'elevator'}),
  lesson('lab-pallets', 'Transferencia y giro de pallets', 'Cargas completas sobre cadenas, transferencia perpendicular y mesa giratoria.', 2,
    'Distinguir unidades de producto y cargas paletizadas.', ['Inspecciona el formato de carga del Source.', 'Sigue un pallet por la transferencia y el giro.', 'Compara cargas y unidades en los resultados.'], {cellId: 'pallets'}),
  lesson('lab-assembly', 'Combiner y Separator', 'Agrupación y separación de productos con conservación de su origen.', 2,
    'Verificar que agrupar cargas conserva las unidades originales.', ['Observa las cargas que entran al Combiner.', 'Sigue un lote compuesto hasta el Separator.', 'Compara unidades generadas y recibidas.'], {cellId: 'assembly'}),
  lesson('lab-rectangle', 'Circuito rectangular', 'Circuito cerrado con admisión lateral y un distribuidor para ensayar retorno y descarga.', 3,
    'Comprender recirculación y congestión sin crear productos sin origen.', ['Sigue una caja desde la admisión lateral.', 'Cambia la ruta del distribuidor en Equipo.', 'Observa el retorno y vuelve a habilitar la descarga.'], {cellId: 'rectangle'}),
  lesson('lab-gravity', 'Rodillos por gravedad', 'Alimentación motorizada y descenso libre con transiciones suaves hasta el almacén.', 1,
    'Relacionar pendiente, impulso y resistencia de rodadura.', ['Observa el impulso de entrada.', 'Comprueba que el tramo libre carece de motor.', 'Crea una variante y compara pendientes moderadas.'], {cellId: 'gravity'}),
  lesson('lab-manual-l', 'Curva de rodillos a 90°', 'Puesto de carga temporizado y curva continua; comparación con la transferencia rectangular.', 1,
    'Distinguir una curva de una transferencia de correas.', ['Ejecuta la alimentación y observa la curva.', 'Compara su trayectoria con la lección de L rectangular.', 'Retira y deposita una caja con ratón o grip en VR.'], {cellId: 'manual-l'}),
  lesson('cedi-sorting', 'CEDI · Clasificación y consolidación', 'Dos entradas, FIFO, seis decisiones por atributos, logística de pallets y dos anexos manuales vacíos.', 3,
    'Supervisar redes independientes, células de manipulación y trazabilidad por perfil.', ['Prueba la carga, transferencia y descarga robóticas en los equipos originales.', 'Compara calidad, SKU, color, tipo y dimensiones.', 'Recoge pallets completos de las cadenas con el montacargas.'], {family: 'CEDI completos', kind: 'sorting', robotized: true, mode: 'mixed'}),
  lesson('cedi-packing', 'CEDI · Packing y transferencias', 'Combiner/Separator, reparto 25/75, transporte de cuatro formatos y pallets entre niveles.', 3,
    'Analizar conservación de unidades, transferencia robótica y comportamiento de una red multietapa.', ['Sigue un lote compuesto, su transferencia y separación.', 'Compara reparto recto/lateral y descarga robótica.', 'Conduce el montacargas entre las cadenas de expedición y las bahías de pallets completos.'], {family: 'CEDI completos', kind: 'packing', robotized: true, mode: 'mixed'}),
  lesson('advanced-rework', 'Inspección y retrabajo segregado', 'Lote reproducible de 16 cajas: 8 conformes y 8 defectuosas pasan a una celda de retrabajo temporizado.', 3,
    'Medir segregación y coste de retrabajo conservando los atributos del producto.', ['Ejecuta el lote finito de 16 cajas.', 'Comprueba 8 cajas en cada destino.', 'Compara tiempos del ramal de retrabajo; su salida sigue pendiente de validación de calidad.'], {family: 'Automatización avanzada', advanced: 'rework', expectedUnits: 16}),
  lesson('advanced-packing', 'Packing multitipo y trazabilidad', '24 productos de cuatro formatos pasan por setup, Combiner y Separator; una decisión separa los contenedores.', 3,
    'Validar que el empaque y desempaque conservan 24 unidades y sus tipos.', ['Consulta los cuatro perfiles del Source.', 'Sigue sus lotes por Combiner y Separator.', 'Comprueba 18 unidades en salida general y 6 contenedores en su ramal.'], {family: 'Automatización avanzada', advanced: 'packing', expectedUnits: 24}),
  lesson('advanced-pallets', 'Buffer y transferencia de pallets', 'Cuatro pallets de cuatro cajas recorren cadenas, transferencia a 90°, giro y cuatro posiciones de buffer.', 3,
    'Comprobar continuidad física y conservación de 4 cargas / 16 unidades.', ['Observa posicionamiento y permiso de transferencia.', 'Consulta ciclos de giro y ocupación del buffer.', 'Verifica 4 cargas completas y 16 unidades al terminar.'], {family: 'Automatización avanzada', advanced: 'pallets', expectedUnits: 16}),
  lesson('manual-station', 'Estación manual con operario', 'Source vacío y puesto sin ciclo automático: generar, habilitar operario y despachar son acciones explícitas.', 1,
    'Reconocer qué acciones esperan al operario y cómo se registran.', ['En Probar, pulsa Generar en el Source.', 'Habilita Operario disponible en Equipo del monitor.', 'Solicita Despachar y observa la llegada al almacén.'], {family: 'Prácticas manuales', advanced: 'manual', mode: 'manual'})
];

export const DIFFICULTY_LABELS = {1: 'Básica', 2: 'Intermedia', 3: 'Avanzada'};
export const MODE_LABELS = {automatic: 'Automática', manual: 'Manual', mixed: 'Automática + anexos manuales'};
export function studyScene(id) {
  const result = STUDY_SCENES.find(scene => scene.id === id);
  if (!result) throw new Error('El escenario de estudio no existe: ' + id);
  return result;
}
