# Puesto de conducción en pantallas grandes

Desde 1440 × 800 píxeles de ventana, los mandos aparecen completos al entrar al montacargas. Las cuatro secciones —conducción, carga y horquillas, visión y ayuda, seguridad— forman una cuadrícula de dos columnas. Cada botón separa icono y atajo en la primera línea, con su nombre debajo, para evitar etiquetas cortadas.

La columna izquierda comparte un espacio acotado entre misión y controles; la cámara o el plano ocupan el lado derecho. El centro permanece libre para conducir. La anchura de los mandos crece entre 520 y 760 px y la del monitor entre 560 y 960 px. En una ventana de 1920 px el monitor ocupa aproximadamente 730 px; a 2560 px ocupa 960 px. Durante la inspección, el plano conserva su columna separada y las medidas siguen visibles debajo de la imagen.

**Ampliar** permite llevar la inspección hasta 1280 px. **Compactar** y **Minimizar** siguen disponibles como decisiones explícitas del usuario. El sistema recuerda la preferencia de escritorio y la de ventana compacta por separado durante la sesión. Un cambio de tamaño que oculta mandos libera inmediatamente cualquier acción mantenida. El listener de redimensionado se retira al cerrar el controlador.

En ventanas menores o bajas se conserva la navegación por categorías. La interfaz espacial de RV conserva su distribución existente. Las funciones que el vehículo no soporta permanecen ocultas también en la vista completa. Una misión ausente ya no oculta los controles de objetivos y holograma por coincidir con una tarjeta de misión invisible.

Los cambios afectan al tamaño y distribución del DOM. La cámara sigue usando su composición WebGL, resolución adaptativa y presupuesto de memoria existentes; no se crea otra cámara ni otro bucle de renderizado.

## Archivos

- `VehicleDriving.js`: selección automática del diseño, preferencias y liberación de entradas.
- `packages/tools/editor/src/editor.css` y `apps/public-viewer/viewer.css`: la misma política de distribución para Workspace y demostración pública.
- `tests/legacy/test-vehicle-responsive-controls.js`: puntos de corte, preferencias, entradas mantenidas, emergencia y limpieza.
- `tooling/qa/forklift-responsive.cjs`: geometría, etiquetas, funciones ocultas y ampliación en ambos estilos.
- `tooling/qa/forklift-wide-production.cjs`: comprobación del escenario 3D con proyecto y perfil de navegador temporales.

## Validación

La QA de interfaz comprueba 14 combinaciones de tamaño y estilos, incluyendo 1600 × 900, 1920 × 1080, 2560 × 1440, móvil vertical y horizontal. En escritorio verifica los cuatro grupos visibles, ausencia de scroll interno, etiquetas completas, separación de misión/mandos/cámara, plano e imagen independientes y zona central despejada. También verifica que Ampliar aumente realmente la inspección.

El recorrido del escenario 3D real pasa en 1920 × 1080, 2560 × 1440 y 1440 × 900, con usuario, base de datos y Chrome temporales. Verifica aproximación física al pallet, cámara isométrica, dimensiones de la composición GPU y conservación de carga y entradas del pallet. En 2560 × 1440 la imagen de cámara mide aproximadamente 709 × 399 px dentro del monitor de 960 px; el plano permanece a su lado. No se registraron excepciones, errores de consola, fallos de peticiones ni errores WebGL. Los informes y capturas se guardan en `data/qa-studio/forklift-wide-production/`.

Las regresiones de asistencia al montacargas y la prueba de controles pasan. Las 278 pruebas de framework pasan ejecutadas con `--test-concurrency=1`; esta ejecución evita que las pruebas de módulos descubran carpetas temporales mientras otra prueba las elimina en Windows. No se modificó el contenido de los proyectos del usuario.
