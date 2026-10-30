# Cámara isométrica, retrovisor y paneles de cabina

La cámara comienza en **Isométrica**, una vista ortográfica lateral elevada a 35,26° de la zona de inserción. **Isométrica**, **Frontal** y **Puntas** usan una escala métrica fija basada en las hojas horizontales: acercarse al pallet no abre una lente extrema ni amplía la imagen. El botón **Lado** cambia el costado de inspección.

La vista frontal y la de puntas recortan la región de trabajo delante del soporte. Cambiar la cámara auxiliar no mueve la vista principal ni la cabeza en RV. Los objetivos y sus instrucciones se muestran en un panel separado; sus letreros no se capturan en la cámara auxiliar.

El botón **Retrovisor** alterna la misma pantalla entre horquillas y vista posterior reflejada. Sólo se actualiza la imagen elegida y se mantiene un único render target vivo. No invierte la dirección de marcha, los mandos ni la cámara del visor.

El plano y las medidas permanecen visibles junto a la imagen, también al alternar el retrovisor o apagar la cámara. La comprobación física de toma y depósito sigue a cargo del runtime de vehículos.

En pantallas estrechas las vistas se ajustan al abrir el plano, manteniendo la frontal y el retrovisor. Las medidas de alineación también aparecen como texto legible en escritorio.

## Cámaras y guía holográfica

| Control | Función |
|---|---|
| **C** | Activar o desactivar la cámara auxiliar. |
| **Shift+R** | Alternar horquillas y retrovisor. |
| **Shift+C** | Recorrer **Isométrica**, **Frontal** y **Puntas**. |
| **Shift+N** o **Lado** | Cambiar el costado de la vista isométrica. |
| **Plano y medidas** | Contorno, altura, ángulo e inserción visibles de forma permanente. |
| **Shift+G** o **Guía holográfica** | Mostrar u ocultar los indicadores en la instalación. |
| **Shift+J** o selector **Objetivo** | Cambiar entre cargas o destinos compatibles. La selección automática sigue disponible. |

La guía marca el pallet de recogida o la zona de descarga, dibuja referencias de las horquillas y muestra la siguiente indicación. Ámbar significa ajustar; rojo, revisar el impedimento; verde, comprobación física confirmada para ese objetivo. Si el equipo detecta otra carga distinta de la seleccionada, el monitor lo indica y no presenta esa lectura como confirmación del objetivo elegido.

1. **Preparar el vehículo.** Enciende con **B**, habilita **Marcha (V)** y revisa el pasillo antes de liberar el freno **P**. Motor, pausa, emergencia y freno tienen prioridad sobre las instrucciones de movimiento.
2. **Aproximarse y alinear.** Selecciona la carga marcada. Alinea ambas uñas con los huecos, corrige la altura con **Q/E** y comprueba la inserción en la cámara. Frena con **Espacio** antes de manipular.
3. **Tomar y retirar.** Solicita **Tomar carga (G)** cuando el apoyo real esté confirmado. Eleva lo necesario para liberar el origen y retírate lentamente; después ajusta la altura de transporte.
4. **Transportar.** Selecciona un destino habilitado y compatible. La guía muestra su distancia y si queda al frente, a la izquierda, a la derecha o detrás del vehículo. Lleva la carga baja, conduce suavemente y comprueba personalmente el espacio de paso.
5. **Preparar y depositar.** Usa **Shift+K** o baja la carga para preparar el depósito. Alinea, detente y baja hasta confirmar el apoyo. **Depositar (K)** conserva las comprobaciones de capacidad, ocupación y geometría.
6. **Liberar las horquillas.** Después del depósito retrocede lentamente hasta sacar ambas uñas antes de girar o buscar otra carga.

Al activar la guía holográfica, el mástil, los talones verticales, el respaldo y la estructura frontal del montacargas ocupado se vuelven transparentes. Sólo las hojas horizontales y sus puntas conservan el acabado opaco de acero gris satinado. La geometría y las colisiones permanecen activas; al desactivar la guía o bajar del vehículo se restauran los materiales originales, sin afectar a otros equipos. Los colores de horquilla personalizados se conservan.

En RV se usan los botones del monitor y los mandos físicos de volante y palancas; no se modifica la pose de la cabeza. La guía es **orientación local**, no una ruta automática: sus flechas no certifican todo el trayecto ni conducen el vehículo. No toma, mueve ni deposita pallets por sí sola.

En RV las pantallas forman dos columnas laterales orientadas al asiento, por fuera de los pilares. El frente central queda libre para el volante y las palancas. Las imágenes no capturan agarres ni gatillos; los paneles de mandos rechazan la mano que sostiene o está junto a un control físico, y permiten utilizar la otra mano. La disposición se comprueba con las mallas reales de nueve variantes, tanto con el menú compacto como con todos los mandos abiertos.

## Presupuesto de render y recursos

Sólo la imagen seleccionada se renderiza dentro de una secuencia limitada de pasadas auxiliares. La resolución se adapta al tamaño físico del panel, la densidad de píxeles y el presupuesto de escritorio, móvil o RV. El suavizado usa MSAA cuando está disponible y FXAA como alternativa. No se crea otro renderer ni se leen imágenes de la GPU a la CPU.

No se actualiza una pantalla fuera de la vista del visor o un área de escritorio oculta. Alternar la vista descarta el target anterior; salir del vehículo, desactivar la cámara o perder el contexto libera el target activo. Su textura se registra como recurso GPU de la integración. Cada pasada restaura el framebuffer, viewport, scissor, XR, sombras y estado de la cámara principal.

## Comprobación

- `npm run test:vehicle-vision`: encuadre frontal y de puntas, retrovisor, estados del renderer, propiedad de recursos y separación de paneles/mandos.
- `npm run test:vehicles`: pruebas de vehículos, conducción, manejo físico de cargas y las comprobaciones anteriores.
- `npm run test:vehicle-assistance`: flujo de mandos, objetivos holográficos, lectura física, calidad y limpieza de las cámaras y separación de paneles/mandos.
- `node tooling/qa/vehicle-camera-quality.cjs`: render WebGL1/2, suavizado de bordes, retrovisor reflejado y recursos.
- `node tooling/qa/vehicle-assistance-production.cjs`: Chrome con una cuenta y base de datos temporales; revisa el ciclo real del robot, recogida, destinos de descarga y ambas cámaras en escritorio y móvil sobre los artefactos de producción. Las comprobaciones automatizadas no sustituyen una prueba física en Quest 3.

La auditoría posterior corrigió el bloqueo CEDI y añadió pruebas de orientación de la carga, retirada de pinzas y funcionamiento de las células. También corrigió el plano blanco transitorio de las cámaras RV y la desconexión del audio de los mandos. Véase [auditoría del 29 de octubre de 2026](audit-2026-10-29.md) para las comprobaciones y pendientes.
