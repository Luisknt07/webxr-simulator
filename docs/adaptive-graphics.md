# Calidad adaptativa para escritorio, móvil y WebXR

En **Ajustes** de la experiencia, **Rendimiento** del editor y **Escenario → Configurar entorno** aparece **Calidad gráfica de este dispositivo**. La preferencia se conserva en este navegador; no modifica los niveles guardados ni los acabados personalizados.

| Modo | Uso | Máximo de píxeles del lienzo de escritorio | Sombra direccional máxima |
| --- | --- | ---: | ---: |
| Automático | Selección y recuperación progresivas según el dispositivo y la fluidez | Según el perfil efectivo | Según el perfil efectivo |
| Ahorro | Menor resolución y detalle decorativo lejano | 1 millón | 512 |
| Equilibrado | Inicio prudente en computadoras | 2 millones | 1024 |
| Alta | Mayor definición, iluminación y detalle | 4 millones | 2048 |
| Cinemática | Mayor presupuesto visual disponible | 6 millones | 2048 |

Los modos manuales son techos de calidad, no bloqueos: el perfil efectivo puede bajar si la carga sostenida supera el presupuesto de fotograma. Las capacidades limitadas del dispositivo prevalecen. Una pantalla con puntero táctil principal limita el lienzo a 1,5 millones de píxeles; una indicación de memoria de 2 GB o menos lo limita a 800.000. Las pistas de memoria y núcleos son opcionales, no identifican la GPU ni garantizan una velocidad determinada.

El controlador mide la cadencia entre fotogramas, espera tras una carga y aplica pausas e histéresis para evitar oscilaciones. Baja tras presión sostenida y prueba recuperar un nivel después de un período largo estable. No altera el reloj de producción, recetas, capacidades, sensores, controles, colisiones ni posiciones de productos. Una pestaña de escritorio oculta no renderiza. La memoria de los objetos CPU de niveles visitados puede permanecer para permitir volver y deshacer; los recursos GPU exclusivos de salas inactivas se liberan.

Si el navegador pierde y recupera el contexto WebGL, se reconstruyen los reflejos y se vuelven a cargar en GPU los recursos conservados en CPU. Una limitación de Three r112 obliga a mantener las sombras desactivadas durante esa visita recuperada para permitir cambiar de sala y seguir editando con estabilidad. La configuración guardada sigue intacta; una recarga normal crea un renderizador nuevo con sus sombras habituales.

## Qué se adapta

- Resolución interna y densidad de píxeles del lienzo, luces puntuales activas próximas y mapa de sombras local. Se respetan las sombras desactivadas y la exposición del escenario.
- Tornillería y herrajes estáticos pequeños o lejanos aprobados por la fábrica de equipos. Ahorro y Equilibrado pueden omitir sus dibujos; al acercarse o elegir Alta/Cinemática reaparecen. No se simplifican las siluetas, cargas, sensores, pulsadores, pantallas, rodillos animados ni su representación de colisión.
- Concreto preparado a 256, 512 o 1024 píxeles, compartido por los pisos generados compatibles. La imagen se carga sólo cuando se necesita y se libera al salir. Los materiales originales o personalizados conservan sus mapas y colores. El relieve, rugosidad y desgaste editable se mantienen.

La textura base de concreto se preparó con IA fuera de la experiencia. Su [procedencia y prompt](../res/materials/README.md) están incluidos. Además, **IA integrada · materiales** permite ejecutar un modelo neuronal local bajo demanda y reutilizar su resultado durante WebXR. La [guía de IA y Quest](native-ai-webxr.md) explica su uso y límites. El ajuste automático de rendimiento sigue siendo un controlador por mediciones, independiente de esa inferencia.

## Móvil y realidad virtual

Con un puntero táctil principal, el modo cliente muestra mandos de **Caminar** y **Mirar**, **Accionar**, **Coger/Soltar**, distancia de la carga y **Vuelo** con ascenso/descenso. El movimiento conserva las colisiones; las acciones usan el mismo rayo central y la misma simulación del escritorio. Los mandos se ocultan en editor, menús y VR, y una cancelación o pérdida de foco borra el movimiento pendiente.

En WebXR se conservan las poses y los mandos del visor. La resolución del framebuffer la controla el runtime XR: este proyecto con Three r112 no la cambia durante una sesión. Se reduce el presupuesto de sombras y se usa `fixedFoveation` sólo si la capa de la sesión lo expone y permite leer el valor aplicado. El objetivo usa `session.frameRate` cuando existe, con una referencia de 72 Hz en su ausencia. No todos los móviles o navegadores ofrecen sesiones inmersivas.

## Recursos y validación

El panel muestra FPS, resolución, perfil efectivo y una **estimación** de bytes de geometría/texturas alcanzables, incluidos mipmaps y objetivos conocidos. No representa la VRAM total del sistema ni toda la memoria del navegador. Las lecturas del panel usan un resultado en caché; no recorren todas las mallas cada fotograma.

Ejecutar `npm.cmd run test:graphics` valida política, pérdidas de contexto, límites XR, memoria, LOD, texturas preparadas, controles y UI. `npm.cmd test` incluye además las regresiones de simulación y VR. Las auditorías opcionales de navegador son:

```text
node tooling/qa/qa-adaptive-graphics-browser.js
node tooling/qa/qa-prepared-material-browser.js
node tooling/qa/qa-adaptive-mobile-browser.js
node tooling/qa/qa-context-recovery-browser.js
```

Estas auditorías usan Chrome temporal y no guardan proyectos. En una cámara fija del laboratorio, Ahorro omitió 132 dibujos y 12.408 triángulos decorativos frente al detalle completo; volver a Cinemática restauró ambos. Cambiar la textura de 1024 a 256 liberó aproximadamente 5 MiB de memoria gráfica estimada. Son comparaciones de esa escena, no promesas de FPS ni mediciones de un móvil o visor físico.

Esta mejora conserva el motor WebGL actual. No incorpora Lumen, Nanite, generación de vídeo en tiempo real, KTX2 nuevo ni equivalencia visual automática con Unreal. La calidad final también depende del modelo, sus texturas y la composición de la iluminación. Las siguientes mejoras que requieran otro renderizador deben validarse por separado para conservar la compatibilidad WebXR.
