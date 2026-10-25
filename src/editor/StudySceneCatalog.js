// Public, stable preset IDs are also the authoring / QA API.
const lesson = (id, title, description, difficulty, objective, tasks, extra = {}) => Object.assign({id, title, description, difficulty,
  objective, tasks, mode: 'automatic', family: 'Fundamentos', version: 1}, extra);

export const STUDY_ENVIRONMENT_DEFAULTS = Object.freeze({renderQuality: 'high', shadows: true, exposure: .9, sunIntensity: .85, ambientIntensity: .15,
  machineSounds: true, machineVolume: .25, ambientPreset: 'warehouse', ambientSound: '', ambientVolume: .12});

export const STUDY_SCENES = [
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
    'Supervisar redes independientes y comprobar trazabilidad por perfil.', ['Prueba las redes automáticas y consulta cada PLC.', 'Compara calidad, SKU, color, tipo y dimensiones.', 'Practica generar y manipular cargas en los anexos manuales.'], {family: 'CEDI completos', kind: 'sorting', mode: 'mixed'}),
  lesson('cedi-packing', 'CEDI · Packing y transferencias', 'Combiner/Separator, reparto 25/75, transporte de cuatro formatos y pallets entre niveles.', 3,
    'Analizar conservación de unidades y comportamiento de una red multietapa.', ['Sigue un lote compuesto y su separación.', 'Compara reparto recto/lateral en el monitor.', 'Observa pallets y los cuatro formatos del recorrido multinivel.'], {family: 'CEDI completos', kind: 'packing', mode: 'mixed'}),
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
