# Diseño y visualización de los equipos existentes

Esta integración se aplica directamente a los modelos nativos que ya están en los escenarios. Utiliza el sombreado y los materiales del motor Three.js para el modelo 3D, y las funciones de proyección de Anatomy para mostrar ese mismo equipo en los monitores. El taller independiente de Anatomy continúa disponible para crear variantes y piezas.

## Acabados y geometría

Los robots conservan sus vértices, articulaciones, herramienta, TCP, envolventes de contacto y número de triángulos. Se corrigieron las normales de las carcasas curvas y tapas mecanizadas: el sombreado ya no interpreta cada diagonal de triangulación como una abolladura. Las aristas reales mantienen su separación; las curvas reciben una transición suave. Las extrusiones del montacargas usan el mismo criterio sin mover sus superficies físicas.

La capa automática de acabados respeta ahora la pintura de fabricación de robots, vehículos, transportadores y estanterías. Antes la reemplazaba por una fotografía de pintura desconchada con relieve fuerte, incluso en máquinas con poco desgaste. Los acabados nuevos mantienen microdetalle discreto, acero, caucho, tapicería y superficies pintadas diferenciados. Los colores y las asignaciones de material elegidas expresamente por el autor se conservan; el preset fotográfico desgastado sigue disponible como opción.

Las mejoras de robots y montacargas no agregan mallas, triángulos ni llamadas de dibujo. Los paneles reutilizan su geometría y controles existentes. Las vistas técnicas se dibujan en los canvases de los monitores, sin duplicar el equipo en la escena WebXR.

## Elegir el panel de una máquina

Selecciona un **robot** o **transportador** y abre su configuración en el inspector. El campo **Modelo del panel de control** ofrece:

- **Automático según la máquina**: resuelve un modelo apropiado para su familia o mecanismo.
- **Botonera compacta sobre pedestal**.
- **Terminal de programación de robot**.
- **Consola HMI inclinada**.
- **Armario industrial con baliza**.

Cada formato conserva los comandos y destinos del equipo: arranque, parada, pausa, energía, emergencia, velocidad y operación contextual. Las superficies de interacción siguen utilizando los controles y rayos existentes de escritorio y RV. Cambiar el modelo no añade un controlador o simulador diferente. La selección se guarda con el proyecto y admite deshacer, rehacer y reapertura. `withPanel: false` continúa ocultando el panel. Las estanterías siguen configurándose desde el editor y no reciben un panel físico.

## Vistas técnicas de los monitores

En un monitor de línea, abre **EQUIPO** y selecciona el objeto. Los botones **ISO**, **FRONTAL**, **PLANTA** y **DESPIECE** muestran sus mallas nativas reales, sus materiales y la postura actual. Las anotaciones identifican los componentes; el despiece es una separación ilustrativa y no desplaza las piezas del escenario.

Se corrigieron la conversión de color lineal a sRGB, los contornos, las normales de las curvas y las instancias. La generación anterior saltaba triángulos de forma uniforme y podía producir agujeros artificiales. Ahora se conservan superficies completas; los componentes demasiado densos utilizan una envolvente cerrada y la vista indica que está simplificada o parcial.

La proyección compartida conserva las ecuaciones de `cameraOf`, `iso` y `depthOf` de Anatomy, commit `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`, con su licencia MIT. Está en `packages/render-three/src/TechnicalProjection.js`; la captura y el dibujo nativos están en `modules/logistica-industrial/functions/presentacion/runtime/NativeTechnicalIllustration.js`. Esta ruta no carga el taller, React ni el kit de autoría dentro del bucle de RV.

## Rendimiento y comprobación

La caché conserva cuatro vistas de monitor; las posturas se comprueban como máximo dos veces por segundo. Los monitores ocultos no actualizan su imagen. Móvil y RV utilizan límites menores de componentes y caras del diagrama. Estos límites afectan exclusivamente a la ilustración 2D, no a las mallas 3D ni a la simulación.

```powershell
npm.cmd run test:native-design
npm.cmd run test:native-design-browser -- --expected-workspace-sha256 <hash-revisado>
```

Las pruebas verifican presupuestos, normales, materiales, controles, persistencia y proyección de los modelos nativos. El QA de navegador utiliza una cuenta y proyectos temporales con el editor compilado, incluyendo capturas comparables antes y después. No sustituye una comprobación de comodidad y rendimiento en un Quest 3 físico. La generación inicial de una ilustración densa tiene un coste de CPU y no constituye una garantía de tiempo de fotograma en el visor.

En la comparación de navegador, con las mismas máquinas e iluminación, los presupuestos permanecen iguales:

| Modelo de comprobación | Triángulos antes | Triángulos después |
|---|---:|---:|
| Robot con panel | 10.624 | 10.624 |
| Montacargas | 30.460 | 30.460 |
| Transportador con panel | 15.120 | 15.120 |
| Estantería con direcciones | 5.512 | 5.512 |

Son recuentos de las mallas nativas, incluidas sus piezas instanciadas; las ayudas temporales y los decals de presentación se excluyen en ambos casos. Las pruebas de fábrica comparan además 45 combinaciones de robot y 39 de vehículo. Los cuatro paneles conservan 2.492 triángulos y 44 mallas asignadas; los modelos sin baliza ocultan las piezas correspondientes. Se comprueba también la continuidad de comandos y los rayos sobre botones, rótulos y pantallas.
