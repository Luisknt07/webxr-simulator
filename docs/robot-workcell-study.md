# Robot: montaje, conexiones y tareas

El piloto `articulated-general` conserva los ejes y el TCP del controlador
nativo. Las carcasas tienen una sección visual independiente de la carga
simulada; sus extremos de articulación mantienen proporción circular. La ficha
permite ajustar `housingScale`, arnés, tapas, paquete neumático/eléctrico,
identificaciones, acabado y desgaste. Las variantes restantes mantienen su
geometría y herramientas propias; estos accesorios no convierten automáticamente
otras familias en el mismo modelo de seis ejes.

Los arneses J2/J3 tienen racores, abrazaderas y puntos de unión articulados.
El suministro de la herramienta termina detrás de su zona de contacto con la
carga. El mazo hacia la consola enlaza el conector real de la base con un
prensaestopas de la envolvente; sigue la posición del armario y se rehace sólo
cuando cambian los extremos. La manguera exterior se oculta al elegir una
herramienta que no la utiliza. No se simulan presión ni corriente a partir
de la sola presencia de esos detalles.

## Visor del mismo equipo

La vista 3D tiene iluminación de estudio prefiltrada y conserva materiales,
desgaste y calcomanías proyectadas. La consola y su cable exterior se muestran
con **Equipo + consola**; la vista inicial encuadra el mecanismo. **Ampliar vista**
dedica el contenedor al modelo. Los componentes pueden resaltarse y aislarse.

Con WebGL, **Plano 2D** usa las mallas completas y una cámara ortográfica:
frontal, posterior, lateral, superior o isométrica. No sustituye las carcasas
por sus cajas envolventes. La proyección Canvas de presupuesto limitado se
conserva como alternativa cuando no puede crearse ese contexto de renderizado.
Ambas vistas son copias de estudio y no mueven el equipo del escenario.

## Conexiones y programación

**Electrónica y sistemas** incluye tres hojas didácticas: armario, robot/encoder
y herramienta. Los 40 cables llegan a 77 bornes identificados, con selección,
referencias y siete pasos de explicación. Se distinguen potencia, 24 V de
control, PE, mando, realimentación y seguridad. El estado observado del simulador
se mantiene separado de la animación explicativa. El esquema no atribuye un
pinout genérico a un fabricante concreto.

**Programar** permite elegir equipos existentes como origen y receptor,
parametrizar velocidad, aproximación y esperas, definir hasta ocho puntos TCP
locales y un retorno, y consultar o importar el JSON declarativo equivalente.
La vista previa calcula IK sobre un rig nativo privado con una carga de
demostración. Puede reproducirse, pausarse, avanzar por fases y restablecerse.
No reserva stock ni modifica productos o el documento real.

Al aplicar una tarea validada, el cambio pasa por el historial del editor. El
robot queda detenido en modo manual para iniciar el ciclo explícitamente. El
programa persiste en `taskProgramJson`, con activación `taskEnabled`, y se guarda
al guardar el proyecto. La ejecución real conserva comprobaciones de alcance,
colisión, emergencia, contacto, receptor y custodia de la carga. La previsualización
cinemática no sustituye esa prueba del ciclo en el escenario. La vista pública
puede ensayar y consultar; guardar requiere permisos de edición.

Ver también [programación de tareas](robot-task-programming.md),
[circuitos](robot-circuits.md) y [procedencia del piloto](robot-reference-pilot.md).

## Comprobaciones

- `npm run test:robots`: mecanismos, carga real, accesorios, tarea y conexión de consola.
- `npm run test:equipment-study`: instantánea, materiales, vistas y ensayo aislado.
- `npm run test:framework`: contratos, circuitos, recetas, persistencia y publicación.
- Las QA compiladas `equipment-study-production.cjs`, `robot-circuits-production.cjs`
  y `robot-task-production.cjs` exigen hashes revisados y usan cuentas y proyectos
  temporales. Una exportación estática no establece FPS en un visor físico.
