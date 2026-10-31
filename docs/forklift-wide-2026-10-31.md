# Puesto de conducción en pantallas grandes

Desde 1440 × 800 píxeles de ventana, los mandos aparecen completos al entrar al montacargas. Las cuatro secciones —conducción, carga y horquillas, visión y ayuda, seguridad— se apilan en una columna estrecha, con cuatro botones por fila. Cada botón separa icono y atajo en la primera línea, con su nombre debajo. Esta distribución recupera la referencia anterior del usuario y sustituye la consola demasiado ancha de dos columnas.

La columna izquierda comparte un espacio acotado entre misión y controles; la cámara o el plano ocupan el lado derecho. El centro permanece libre para conducir. La anchura de la columna izquierda varía entre 340 y 380 px y el monitor ocupa hasta 720 px, con un límite del 38 % de la ventana. La misión arranca desplegada en escritorio amplio, con el objetivo, progreso e instrucción visibles. Durante la inspección, el plano conserva su columna separada y las medidas siguen visibles debajo de la imagen. Si falta altura, el desplazamiento queda dentro de los paneles y estos no se superponen.

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

La QA de interfaz comprueba 14 combinaciones de tamaño y estilos, incluyendo 1600 × 900, 1920 × 1080, 2560 × 1440, móvil vertical y horizontal. En escritorio verifica la columna estrecha, los cuatro grupos apilados, misión desplegada, etiquetas completas, separación de misión/mandos/cámara, plano e imagen independientes y zona central despejada. Comprueba desplazamiento acotado cuando falta altura y que Ampliar aumente realmente la inspección.

El recorrido del escenario 3D utiliza 1920 × 1080, 2560 × 1440 y 1440 × 900, con usuario, base de datos y Chrome temporales. Verifica aproximación física al pallet, cámara isométrica, dimensiones de la composición GPU y conservación de carga y entradas del pallet. Los informes y capturas se guardan en `data/qa-studio/forklift-wide-production/`.

Las regresiones de asistencia al montacargas y la prueba de controles pasan. Las 278 pruebas de framework pasan ejecutadas con `--test-concurrency=1`; esta ejecución evita que las pruebas de módulos descubran carpetas temporales mientras otra prueba las elimina en Windows. No se modificó el contenido de los proyectos del usuario.
