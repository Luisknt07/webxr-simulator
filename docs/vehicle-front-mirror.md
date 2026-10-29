# Cámara frontal, retrovisor y paneles de cabina

La vista de entrada de horquillas mira ahora de frente, centrada en el eje del soporte, 2,5 cm por encima de las uñas y con una inclinación máxima de 15°. La lente queda por delante del cilindro central y el encuadre centra las caras superiores y las ranuras del pallet. La vista complementaria **Puntas** mira desde el extremo opuesto para comprobar la salida de ambas horquillas, especialmente al completar la inserción. El encuadre utiliza la geometría real del pallet y de las uñas; no oculta el mástil, el vehículo ni la mercancía.

El **retrovisor** muestra una cámara posterior ligada al vehículo, con inversión horizontal de la imagen. Aparece dentro de la vista auxiliar en escritorio y como pantalla independiente en RV. No invierte la dirección de marcha, los mandos ni la cámara del visor.

En escritorio la cámara frontal ocupa el espacio principal. El plano y las medidas se abren mediante **Alineación y medidas**; quedan plegados al entrar para dejar visible la inserción. **C** activa las imágenes y **Shift+C** cambia entre frontal y puntas. La comprobación física de toma y depósito permanece a cargo del mismo runtime de vehículos.

En pantallas estrechas el plano sustituye temporalmente las imágenes mientras se consulta, para dejar accesibles los mandos. Cerrar las medidas recupera la frontal y el retrovisor.

En RV las pantallas forman dos columnas laterales orientadas al asiento, por fuera de los pilares. El frente central queda libre para el volante y las palancas. Las imágenes no capturan agarres ni gatillos; los paneles de mandos rechazan la mano que sostiene o está junto a un control físico, y permiten utilizar la otra mano. La disposición se comprueba con las mallas reales de nueve variantes, tanto con el menú compacto como con todos los mandos abiertos.

## Presupuesto de render y recursos

Ambas imágenes comparten una sola secuencia de pasadas auxiliares, con prioridad de dos imágenes frontales por una posterior. En RV el máximo conjunto es diez pasadas de mundo por segundo, con frontal de hasta 384×216 y retrovisor de hasta 192×108. En escritorio el perfil equilibrado utiliza 512×288 y 256×144; los perfiles superiores llegan a 640×360 y 320×180. El perfil económico conserva resoluciones inferiores.

No se actualiza una pantalla que queda fuera de la vista del visor o un área de escritorio oculta. Salir del vehículo, desactivar la cámara o perder el contexto libera ambos render targets. Sus texturas están registradas como recursos GPU de la integración, para que la limpieza de memoria no las trate como imágenes abandonadas. Cada pasada restaura el framebuffer, viewport, scissor, XR, sombras y estado de la cámara principal.

## Comprobación

- `npm run test:vehicle-vision`: encuadre frontal y de puntas, retrovisor, estados del renderer, propiedad de recursos y separación de paneles/mandos.
- `npm run test:vehicles`: pruebas de vehículos, conducción, manejo físico de cargas y las comprobaciones anteriores.
- `node tooling/qa/qa-vehicle-front-mirror-browser.js --expected-bundle-sha256 <SHA256> --label corrected`: Chrome con una cuenta y base de datos temporales; revisa aproximación, inserción parcial y toma válida, ambas imágenes reales, recursos y recuperación del contexto. La revisión de paneles usa XR emulado y no constituye una prueba física en Quest 3.

La auditoría posterior corrigió el bloqueo CEDI y añadió pruebas de orientación de la carga, retirada de pinzas y funcionamiento de las células. También corrigió el plano blanco transitorio de las cámaras RV y la desconexión del audio de los mandos. Véase [auditoría del 29 de octubre de 2026](audit-2026-10-29.md) para las comprobaciones y pendientes.
