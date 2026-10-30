# Inicio y prácticas compactas de realidad virtual

La página inicial muestra una portada estable con la imagen industrial de SMART-TWIN. **Explorar escenarios** abre el catálogo; **Iniciar sesión** o **Continuar en mi espacio** abre el acceso que corresponde a la cuenta. La portada no muestra un indicador de carga ficticio ni crea un renderer. En la publicación estática y sin sesión se ofrece la demostración pública. El servidor anuncia explícitamente su disponibilidad en `config.js`; después de confirmar la sesión, la galería solicita los metadatos de los 34 escenarios permitidos. Elegir una práctica privada abre su ruta autenticada. Los modelos se cargan después de la selección.

El botón de acceso del servidor lleva al formulario real y vuelve a la portada al iniciar sesión. El recorrido es **Inicio → Escenarios → Práctica**. Los botones Inicio y Escenarios, la marca y el historial del navegador permiten regresar; al salir de la demostración se liberan sus recursos. El editor conserva su confirmación por cambios sin guardar. La publicación estática mantiene sus instrucciones para conectar un servidor. El buscador, las categorías y las tarjetas funcionan en escritorio y móvil.

Las tarjetas de inicio reutilizan las mismas miniaturas PNG reales y los mismos metadatos de **Menú → Escenarios**: categoría, descripción, nivel, modo, objetivo y tareas. Se agrupan por categoría y permiten buscar también por objetivo, con filtros de categoría, nivel y modo. Las imágenes se cargan de forma diferida y las tarjetas permanecen en el DOM al filtrar. El helper puro `projects/smarttwin/SceneLibraryMetadata.mjs` mantiene ambas vistas coherentes sin construir escenas 3D. La publicación anónima incluye únicamente la imagen de su demostración; las demás miniaturas requieren sesión.

Las prácticas `vr-robot-dispatch`, `vr-robot-transfer` y `vr-robot-turn` usan cuatro paredes mates sin volúmenes superpuestos, techo cerrado, dos vigas y cuatro luminarias emisivas. La envolvente añade 144 triángulos y ninguna luz puntual. Se mantienen las dos cargas máximas y el mismo pallet físico entre robot, banda y montacargas.

Las manchas triangulares de las paredes provenían de las sombras proyectadas por la cubierta sobre su propia instalación. La arquitectura recibe sombras y se excluye como proyector de la luz interior. Los antiguos perfiles industriales tenían demasiado poco relleno y las luminarias emisivas no iluminaban otras mallas. El perfil interior compartido resuelve esos valores anteriores con exposición 1.00, clave 1.10 y relleno hemisférico 0.55, además de reflejos de sala calculados una sola vez. Mantiene un solo mapa de sombras y no añade luces puntuales. Los colores y reflejos de la sala principal y las escenas nativas conservan su presentación previa. El visor público aplica los colores sRGB de los materiales una sola vez.

La demostración usa la receta existente **Transferencia entre dos bandas**, con un robot, dos transportadores cortos y un montacargas. Su URL pública permanece estable; el catálogo y la miniatura identifican la receta utilizada y los otros escenarios mantienen el acceso autenticado. La generación selectiva permite reconstruir este documento sin reescribir los demás.

La barra compacta, el puntero central y **Menú** sirven para explorar, consultar la guía, pausar o reiniciar. Los mandos de montacargas son los mismos del módulo industrial, agrupados en una consola visible con iconos y teclas. **Shift+G** alterna el holograma; **Shift+R**, el retrovisor. Los objetivos tienen un panel separado y el plano y las medidas permanecen visibles. Al bajar o seleccionar Caminar se libera el mouse; mirar arrastrando requiere mantener pulsado el botón.

El piso y las paredes estándar usan dos mapas compartidos de 512 px con manchas, desgaste, rugosidad y microrelieve a escala en metros. Se calculan mipmaps para evitar brillos de detalle a distancia; no se añaden geometrías superpuestas y las superficies personalizadas conservan sus materiales.

Los proyectos guardados no se reescriben automáticamente. El reconocimiento de paredes y techos del renderer corrige la presentación de las recetas anteriores al cargarlas. Los valores personalizados de iluminación y los colores de horquilla distintos del acabado estándar se conservan.

Validación del 29 de octubre de 2026:

- 71 pruebas del framework aprobadas, incluidas la navegación, la galería y la equivalencia de sus metadatos con el menú.
- Tres comprobaciones de geometría, colisiones de cerramiento y guardado/carga.
- Las tres prácticas mantienen recogida real con horquillas y entrega de la misma carga de cuatro unidades y 33 kg.
- API de producción, materiales y presupuesto de sombras aprobados.
- Chrome verificó catálogo anónimo sin WebGL, sesión y biblioteca de 34 elementos, acceso al escenario de giro, techo, posición inicial, móvil, reentrada, cámaras y restauración de WebGL. Sin excepciones, errores de consola ni solicitudes fallidas en el recorrido privado.

Los informes y capturas quedan localmente bajo `data/qa-studio`. La validación de escritorio y el perfil XR automatizado no sustituyen una prueba física de rendimiento en Quest 3.
