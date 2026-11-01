# Geometría mecánica nativa de los robots

La revisión conserva los identificadores, funciones, articulaciones y TCP del
robot existente. No sustituye el equipo por una ilustración ni por otra máquina.
La geometría de los perfiles articulados pasa a versión 3.

## Interferencias corregidas

El pedestal llegaba hasta el centro de J2 y coincidía con una cintura, un cuerpo
de hombro, dos orejas y la carcasa móvil. Esto producía recortes oscuros y bordes
de pintura superpuestos al mover el brazo. El pedestal ahora queda debajo del
centro del rodamiento; dos orejas separadas soportan el eje y la tapa de servicio
queda por fuera de ambas. La envolvente completa de la carcasa móvil cabe entre
las orejas, con una holgura comprobada en los perfiles y radios de acabado.

El antebrazo termina antes de la muñeca para dejar sitio a su accionamiento. El
modelo mantiene los centros originales de J1–J6, las longitudes cinemáticas y
la transformación de la herramienta. El perfil de fundición continúa siendo
volumétrico; no se ha convertido en una placa plana.

## Componentes para estudiar el equipo

Cada malla tiene `equipmentComponentId`, `robotJointId` y `equipmentSubsystem`.
`robotRig.components` agrupa las piezas reales del modelo en base, hombro, brazo
superior, codo, antebrazo, muñeca, herramienta y guías. Las referencias a objetos
viven únicamente en el rig de ejecución; el documento guardado no contiene
referencias circulares. Los conectores/encoders y servicios se distinguen de las
piezas mecánicas.

## Movimiento y límites de la comprobación

El controlador comprueba núcleos geométricos interiores de los eslabones para
impedir que una flexión cerrada atraviese otro eslabón o el pedestal. Las zonas
de unión de los rodamientos se excluyen de esa comparación porque allí el
contacto entre piezas es intencional. Esto complementa la comprobación existente
de brazo, herramienta, producto y custodia. No es un modelo certificado de
seguridad ni una prueba exhaustiva de todas las superficies de cables, tapas y
herrajes; una nueva configuración debe validarse con su recorrido completo.

Estos mismos núcleos se comprueban contra los triángulos sólidos del entorno,
incluido el caso de quedar dentro de un volumen cerrado. Las tres recetas
compactas separan la mesa de origen del barrido del hombro; la mesa giratoria
dispone de mayor separación a la base y cada robot tiene su propio panel lateral.
La receta de manipulación separa también el motorreductor de la trayectoria de
espera. Estas correcciones afectan a los ejemplos, no reubican objetos de un
proyecto guardado por el usuario.

Una celda antigua cuya trayectoria atraviese una mesa o un gabinete se detiene
en la última postura válida. `clearanceBody`, `clearanceObstacle` y
`clearanceWarning` identifican el conflicto para pausar, separar el obstáculo o
corregir el recorrido y reanudar; no se resuelve haciendo invisibles las
colisiones. Si el conflicto ya existe al iniciar, debe corregirse la colocación
y rearmar el equipo antes de volver a ejecutar el ciclo.

Los perfiles articulados se mantienen por debajo de 18.000 triángulos incluso
en el detalle alto. La comprobación automatizada cubre 45 combinaciones de
modelo, detalle y radio de acabado, además de FK/IK, traslado de cargas y retorno.
El ajuste de radio sigue modificando geometría real.

## Referencias técnicas

- [Descripción oficial de Universal Robots para ROS 2](https://docs.universal-robots.com/Universal_Robots_ROS2_Documentation/doc/ur_description/doc/index.html): separa configuración cinemática, límites, parámetros físicos y mallas visuales/de colisión. Una réplica dimensional requiere los parámetros del modelo concreto y su calibración; estas geometrías son modelos genéricos de enseñanza.
- [Normales ponderadas de Blender](https://docs.blender.org/manual/en/5.1/modeling/modifiers/normals/weighted_normal.html): distingue el sombreado de superficies planas y curvas de la geometría que realmente define el componente.
- [glTF 2.0 de Khronos](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html): formato de entrega con materiales PBR para representar superficies; no reemplaza la cinemática ni aporta por sí solo una geometría correcta.

Pruebas principales: `test-robot-bearing-clearance.js`,
`test-robot-industrial-design.js`, `test-robot-geometry.js`,
`test-robot-runtime.js`, `test-robot-integration.js` y
`test-robot-grasp-clearance.js`.
