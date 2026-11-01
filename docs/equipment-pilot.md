# Pilotos de diseño industrial y estudio visual

Esta entrega cambia dos equipos existentes: `articulated-general` y
`forklift-electric-4w`. Con **Diseño 3D → Automático**, estas dos variantes usan
el piloto. **Diseño anterior → comparar** conserva la geometría previa. Las
demás variantes mantienen su diseño; no se extiende todavía el piloto a toda
la biblioteca. Los proyectos guardados no se sustituyen ni se reubican.

## Cambios que se pueden ver

El montacargas incorpora pilares delanteros inclinados hacia atrás, perfiles
de techo contorneados, pasos de rueda abiertos, contrapeso con receso sobre el
eje trasero, acceso lateral, llanta embutida, rodadura y tapicería perfilada.
Conserva los marcos de asiento, volante, palancas, horquillas y contacto con
el pallet. Las dimensiones extremas que no admiten sus holguras recurren al
modelo paramétrico anterior y la ficha indica el motivo.

El robot utiliza una adaptación de siete carcasas CAD del repositorio oficial
[KUKA robot descriptions](https://github.com/kuka-ros/kuka_robot_descriptions/tree/5ddbc41ce8726fd680bcc19562d78bcabfbdf96d).
Se conservan revisión, hashes, licencia Apache 2.0 y modificaciones en el módulo
y en las notas distribuidas con el visor. Las formas asimétricas del hombro,
codo, antebrazo y muñeca sustituyen las carcasas genéricas del primer intento.
La jerarquía, ejes, TCP y lógica siguen siendo los de SmartTwin; no se atribuyen
al modelo límites, calibración o capacidad certificados del fabricante.

El panel del piloto es una consola de piso con envolvente cerrada, frente
inclinado, pantalla, doce teclas HMI, puerta y ventilación de servicio. Los nueve
actores de operación conservan sus órdenes, identificadores y conexiones. La
baliza se apoya detrás del teclado. La migración reconoce controles automáticos
anteriores y conserva las transformaciones, materiales y recursos editados.

## Estudiar con imágenes y componentes

En **Estudiar equipo**, los dos pilotos incorporan dieciséis bloques técnicos
seleccionables por equipo. El diagrama distingue potencia, señales, seguridad,
movimiento y fluido. Las fichas incluyen interfaces, unidades, funcionamiento,
conexiones navegables, diagnóstico y valores con su procedencia: configuración,
pose capturada o simulación actual.

Las fotografías documentales de KUKA, Cat Lift Trucks, Universal Robots,
Siemens e ifm se conservan como referencias locales optimizadas, con crédito,
enlace y ampliador. Los retratos y diagramas SVG son explicaciones conceptuales.
La ficha distingue estos conceptos de las piezas presentes en la malla y no
inventa una lectura eléctrica, un circuito o un interior del fabricante.

La opción de preparar una pregunta lleva al asistente existente. La consulta
de documentos oficiales funciona mediante enlaces HTTPS. El razonamiento y la
búsqueda web en vivo requieren un proveedor configurado en el servidor; no se
incluyen claves en el navegador ni se presenta una ficha local como una
investigación de IA en tiempo real. La pregunta no ejecuta movimientos ni edita
el equipo por sí misma.

## Alcance de validación

Se comparan ambos diseños mediante sus fábricas reales, sus vistas de perfil,
tres cuartos y posterior, y la aplicación compilada. El robot conserva los
marcos articulares y el TCP en 363 muestras. El montacargas conserva los marcos
de control en 24 poses; sus doce variantes ajenas al piloto tienen geometría
equivalente en los tres niveles de detalle. La consola tiene 424 pruebas de
rayos sobre controles, rótulos, pantalla y teclado.

Las pruebas de malla y exportación no garantizan FPS en un visor físico ni
ausencia de toda colisión imaginable. Se conservan las comprobaciones
estructurales y las pruebas de cargas y recorridos de la simulación. El nivel
alto del robot se reserva para escritorio; el perfil equilibrado con consola
se comprueba contra el presupuesto de 35.000 triángulos de Quest.
