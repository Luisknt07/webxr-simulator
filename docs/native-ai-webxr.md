# IA integrada y vista normal durante WebXR

La IA forma parte del aplicativo web: sus scripts, runtime y pesos se sirven desde el mismo proyecto. El visitante no instala extensiones, Python ni un programa de escritorio. Se cargan al solicitar la mejora, no al abrir cada nivel.

## Uso de la IA local

Abrir **Menú → Ajustes**, **Rendimiento** o la configuración del entorno y usar **IA integrada · materiales → Mejorar concreto con IA**. Esta primera integración procesa el concreto generado del nivel con una red de superresolución entrenada; no modifica modelos 3D ni los materiales personalizados del usuario.

El procesamiento conserva la imagen anterior mientras trabaja. La red amplía un parche de 192 × 192 a 576 × 576 con contexto circular para evitar bordes en la repetición. El perfil gráfico mantiene su propio límite de resolución GPU. **Restaurar detalle** recupera la imagen anterior. El resultado es un recurso visual local y temporal, no una edición del documento ni una nueva revisión del proyecto.

La inferencia utiliza un único hilo WASM en un worker temporal, con tamaño, tiempo y memoria de trabajo estimada limitados. Termina al completar o cancelar; entrar en VR, cambiar de proyecto/nivel, perder contexto u ocultar la pestaña cancela un trabajo pendiente. El resultado terminado se usa como textura normal durante VR. No se ejecuta la red por fotograma ni por ojo. El modelo puede mejorar ciertas imágenes pequeñas y también puede introducir detalle inadecuado: por eso la mejora es reversible y no se presenta como recuperación exacta de información ni calidad AAA automática.

Los [archivos, licencias y procedencia del modelo](../assets/ai/README.md) incluyen la conversión reproducible necesaria para tamaños acotados. El runtime local ocupa unos 13,65 MiB y cada copia del modelo unos 240 KB; no se descargan desde un CDN ni se envían las texturas a un servicio de inferencia. La estimación de trabajo de la IA no representa toda la RAM del navegador.

## Quest 3 y el botón existente

Abrir la dirección HTTPS del aplicativo en Meta Quest Browser y pulsar **Entrar en VR**. La dirección debe ser accesible desde el visor, con un certificado válido o confiado. `localhost` en el Quest se refiere al propio visor, no al computador que ejecuta el servidor. El servidor de desarrollo escucha en la red; el acceso también depende de la red y el cortafuegos existentes.

El botón conserva el gesto de usuario, espera a que el gestor XR confirme la sesión y negocia espacio de referencia `local-floor`, con alternativa `local`. Solicita 72 Hz sólo cuando la sesión declara esa frecuencia y permite cambiarla; un rechazo mantiene la frecuencia del runtime. Es una frecuencia solicitada, no una medición de FPS alcanzados. Los controles, agarres y funciones del nivel continúan utilizando la sesión WebXR existente.

La IA pendiente se cancela antes de pedir la sesión y permanece suspendida durante VR. Esto permite dedicar el presupuesto de fotograma al visor, su seguimiento y la simulación. No se cambia de motor ni se instala un SDK nativo de Meta.

## Una sola imagen en el mismo navegador

Durante una sesión inmersiva, el visor sigue recibiendo la imagen estéreo necesaria para la profundidad. El canvas normal del mismo navegador muestra una copia de un ojo, con recorte centrado a su proporción. No mezcla ambos ojos ni estira los objetos para llenar la pantalla.

La copia se hace en GPU dentro del mismo fotograma XR, sin leer píxeles en CPU, crear otro contexto WebGL o dibujar de nuevo la escena completa. Se limita a 15 actualizaciones por segundo y a cuatro millones de píxeles (aproximadamente 16 MiB de textura como máximo). Si el ojo excede ese presupuesto o la función no está disponible, la sesión inmersiva continúa sin ese espejo. Al ocultar la página, terminar la sesión o perder el contexto se liberan sus recursos. El espejo no cambia las poses, los controles, el reloj de simulación ni la resolución de los ojos.

Esta vista pertenece al mismo navegador. No transmite automáticamente la sesión a otro computador ni sustituye la función de casting del sistema del visor.

## Validación

`npm.cmd run test:webxr-ai` cubre el botón, espejo, inferencia local y aplicación del resultado. También se mantienen las pruebas de gráficos, controles y funciones nativas. Las auditorías de Chrome usan perfiles temporales y no guardan proyectos:

- `tooling/qa/qa-xr-mirror-browser.js` verifica píxeles de un framebuffer estéreo sintético: el canvas contiene sólo el ojo elegido en paisaje y retrato, sin errores GL ni cambios de estado o autoría.
- `tooling/qa/qa-native-texture-ai-browser.js` verifica inferencia neuronal real con los archivos locales y su integración visual.

La comprobación de Chrome y los adaptadores XR no sustituyen una prueba de rendimiento con un Quest 3 físico. Para ella se deben medir FPS, tiempo de fotograma y estabilidad térmica con los niveles reales, siguiendo las [herramientas y recomendaciones oficiales de Meta](https://developers.meta.com/vr/documentation/web/webxr-perf/).
