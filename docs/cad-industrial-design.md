# Diseño paramétrico de piezas industriales

El editor conserva un historial declarativo que se reconstruye en un Web Worker. Sirve para detalles y accesorios del simulador: chapas, carcasas, asas, perfiles, soportes y conductos. Las piezas siguen siendo mallas poligonales CSG; este modelador no sustituye al kernel BRep de Fusion, Inventor o SOLIDWORKS ni produce planos de fabricación certificados.

## Qué cambia

- **Bocetos editables:** arrastrar vértices, introducir coordenadas métricas, añadir o eliminar puntos y abrir hasta cuatro huecos. Los perfiles rechazan cruces, vértices repetidos y huecos que se solapen o toquen un contorno. El radio de esquina genera arcos reales en el contorno; no se limita a cambiar la iluminación.
- **Trayectorias 3D:** proyecciones XY, XZ y YZ conservan la tercera coordenada. El barrido usa marcos de transporte paralelo para evitar cambios repentinos de orientación. Puede interpolar una curva centrípeta, variar escala y aplicar torsión. Un perfil anular conserva su hueco a lo largo del recorrido. La manguera usa una superficie continua en lugar de cilindros y esferas superpuestos.
- **Loft multisección:** entre dos y ocho perfiles anteriores, cada uno con posición, rotación y escala. Las recetas antiguas de dos secciones mantienen altura y desplazamiento. El usuario controla los marcos; no se promete continuidad analítica G1/G2, conectores topológicos persistentes ni raíles guía de un kernel de superficies.
- **Mecanizado sobre caras:** «Seleccionar cara para taladrar» permite pulsar una cara de la vista 3D. La operación guarda su origen y ejes locales y corta perpendicularmente a ella. El marco también es válido para rebaje, avellanado y ranura en recetas. El taladro lateral deja de depender exclusivamente del eje Z global. El plano se guarda por coordenadas de la pieza; no es una referencia topológica BRep que se reasocie automáticamente si se reemplaza la cara anterior.
- **Chaflán constructivo:** la caja admite un bisel de 45° que modifica su volumen. Radios y chaflanes de estas operaciones son constructivos y acotados; no son un fillet arbitrario sobre cualquier arista seleccionada de una malla.
- **Suavizado de normales:** el ángulo entre caras conserva las aristas mecánicas y suaviza superficies curvas sin añadir triángulos. Cambia la reflexión visual; no corrige una geometría mal formada. No se almacenan copias de las normales en cada proyecto.

Las piezas iniciales —panel plegado, escuadra perforada, carcasa de motor, asa tubular y carcasa de asiento— son recetas completas. Sus perfiles, taladros y marcos se pueden volver a editar. No son imágenes ni botones sin operación asociada.

## Uso

1. Abre el diseñador desde el equipo o el menú de creación de piezas.
2. Elige una pieza industrial inicial o construye perfiles y sólidos en el historial.
3. Selecciona una operación para cambiar sus dimensiones. Los bocetos permiten arrastrar puntos; un loft muestra los marcos de sus secciones.
4. Reconstruye la vista antes de aplicar. Los errores dejan el proyecto sin modificar.
5. Elige el suavizado y el anclaje. Las piezas pueden seguir chasis, cabina o carro de horquillas conservando sus transformaciones relativas.

El boceto y el kernel usan XY con Z de altura; al insertar, el editor convierte a Y vertical. Las dimensiones y normales de la malla resultante se expresan en el marco del editor.

## Presupuesto y límites

Se mantienen las 131 operaciones de las recetas anteriores, 48 pasos por pieza y 60.000 triángulos como máximo. Los puntos se limitan a 64 por contorno o trayectoria, los huecos a cuatro y las secciones de loft a ocho. El worker se cancela a los 15 segundos. Los ejemplos añadidos quedan por debajo de 10.000 triángulos y no cargan un kernel de escritorio en cada frame.

Los radios grandes, los cambios de orientación extremos y las trayectorias que hacen que una sección atraviese otra pueden producir sólidos inválidos. Se rechazan inversiones de tangente y parámetros mal formados, pero no existe un verificador general de auto-intersección de todas las superficies posibles. La comprobación de malla cerrada de las pruebas cubre los presets y los casos geométricos ensayados; no constituye garantía de fabricación para una receta arbitraria.

No se incluyen restricciones de boceto con solver dimensional, superficies NURBS, continuidad G2 certificada, radios variables por arista BRep, planos STEP/IGES ni cálculo estructural. Para esos flujos se requiere un kernel y una integración específicos; no se anuncian como capacidades ya implementadas.

## Investigación y decisiones

Autodesk documenta el barrido de un perfil por un recorrido con distintas orientaciones y controles de torsión. Esto sustenta separar el perfil de la trayectoria y conservar un marco local continuo en el simulador. Su sistema admite también guías adicionales que esta implementación todavía no incorpora. [Inventor: crear barridos](https://help.autodesk.com/cloudhelp/2021/ENU/Inventor-Help/files/GUID-FCC0126F-50ED-449B-A0EF-1DED0287170B.htm).

Fusion distingue secciones de loft, condiciones de extremos y raíles o línea central. Aquí se implementan secciones ordenadas con marcos explícitos; el control avanzado de continuidad del kernel comercial queda fuera del alcance. [Fusion: referencia de Loft](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/GUID-EC6CECCD-55C1-4B08-95E4-5B1EEDE78D07.htm).

SOLIDWORKS describe las relaciones entre perfiles y guías para controlar formas intermedias. Es una capacidad mayor que unir secciones de una malla y explica por qué no se presenta nuestro loft como equivalente a su modelado de superficies. [SOLIDWORKS: loft con curvas guía](https://help.solidworks.com/2021/english/SolidWorks/sldworks/t_loft_with_guide_curve_non_planar_profile.htm).

El fillet de radio variable de Fusion opera sobre entidades de arista, radios y continuidad. El proyecto conserva arcos de contorno y chaflanes constructivos que el kernel actual sí puede reconstruir; no ofrece una falsa selección de fillets sobre cualquier triángulo. [Fusion API: VariableRadiusFilletEdgeSetInput](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_VariableRadiusFilletEdgeSetInput.htm).

JSCAD permite extruir mediante secciones y generar tapas. El kernel instalado utiliza esa API y sus geometrías poligonales para los barridos y lofts, dentro del worker existente. [JSCAD: extrusiones](https://jscad.app/docs/module-modeling_extrusions.html).

Para una futura capa BRep, OpenCascade.js sí ofrece un port del kernel OpenCascade a JavaScript/WebAssembly. Su integración requeriría medir carga, memoria, reconstrucción y teselado en los dispositivos objetivo. Sería un módulo de diseño bajo demanda, manteniendo mallas optimizadas en el simulador; no se ha agregado esa dependencia en esta iteración. [Repositorio oficial de OpenCascade.js](https://github.com/donalffons/opencascade.js).

## Verificación

`tests/legacy/test-cad-modeling.js` conserva la prueba de las 131 operaciones y sus límites. `tests/legacy/test-cad-advanced.js` comprueba volumen, superficies cerradas y orientación, huecos, marcos continuos, lofts rotados/escalados, taladros laterales y normales que preservan aristas. `test-cad-document.js` y `test-vehicle-cad-collisions.js` cubren guardado, copia, anclajes y colisiones. La validación visual se hace con el bundle compilado y el Web Worker real en Chrome sobre datos temporales.
