# Validación de la integración Anatomy

Fuente importada: `wheresryan22/anatomy`, commit `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`. Se conservan 160 archivos originales y su licencia MIT; `VENDOR.json` contiene sus huellas SHA-256. Los adaptadores de navegador se mantienen separados de esos originales. Git preserva sus bytes, incluidos los finales de línea, para que los hashes funcionen también en Windows.

## Pruebas verificadas

- 335 pruebas del framework aprobadas: contratos, contenido portable, activación de módulos, almacenamiento, permisos y nuevos contratos de herramientas.
- 38 pruebas específicas de geometría, integración CAD, proyección, kit original, límites, ciclo de vida, acceso y mensajes del taller aprobadas.
- Taller de navegador: 17 comprobaciones y cuatro tamaños de pantalla aprobados.
- Integración con el editor compilado y API autenticada: dos ejecuciones correctas en proyectos temporales. Una estantería de 70 piezas y 2.200 triángulos se inserta con un único deshacer; rehacer, modificar, actualizar y volver a abrir conservan su geometría y fuente.
- Guardado real de JSON y SVG: dos recursos y sus cuatro archivos de metadatos/blobs en `Content/Assets/`, con hashes comprobados. Una recarga completa recupera el conjunto y sus cambios.
- Equipo nativo: captura de ocho grupos de geometría de un montacargas; aplicación de material sólo a `Carrocería`, con descriptor, identidad y comportamiento del vehículo conservados. Deshacer y rehacer restauran el material correctamente.
- Integración visual autenticada en 1600×1000, 390×844 y 854×480: sin desbordamiento horizontal; botones táctiles visibles de al menos 44 px en móvil. Sin excepciones, errores de consola, servidor ni WebGL. La fixture bloquea expresamente las fuentes externas existentes; no necesita acceso a proveedores.
- API de producción: catálogo, interfaz, adaptador y SDK exigen sesión en GET y HEAD. La galería usa CSP aislada, sin `allow-same-origin` ni red. Los scripts de autoría no listados devuelven 404 incluso con sesión. El cierre de sesión revoca el acceso.
- Regresiones CAD: las 132 operaciones declarativas y las pruebas de documento, geometría avanzada y adjuntos aprobadas. Regresiones de Workspace, interfaz de Studio, asistencia de montacargas, descarga y misiones de almacén aprobadas.

## Portabilidad y límites

Un modelo de 59.904 triángulos atraviesa la validación de API y el roundtrip de Content sin alterar mallas ni metadatos. Una captura equivalente como malla única conserva 1,62 millones de nodos y vuelve a compilar el mismo número de triángulos. El presupuesto ampliado está limitado a documentos de escena; las solicitudes generales conservan su límite anterior, y continúan rechazándose claves peligrosas, objetos ajenos a JSON y números no finitos.

El catálogo de herramientas es opcional y se descubre como datos. Al desactivar una herramienta no se carga su adaptador. Al retirar el paquete, los diseños existentes siguen siendo CAD genérico. Las pruebas del anfitrión cubren entradas ausentes, cambios de cuenta, selección, nivel y proyecto, respuestas tardías, replay, historial atómico y limpieza.

El visor público sigue conteniendo un único escenario y ningún recurso de Anatomy. El kit se sirve únicamente desde el Workspace autenticado. Las muestras utilizan siete HTML fijos y PDF locales; los scripts Node y fuentes auxiliares de autoría se conservan en Git, fuera de los recursos HTTP.

## Alcance pendiente de comprobación física

Estas comprobaciones usan Chrome de escritorio y resoluciones móviles simuladas. No se ha validado esta integración en un Quest 3 físico. El taller de autoría se cierra al entrar en RV; la simulación consume las mallas CAD del motor existente. La fluidez depende del presupuesto completo de cada escenario. Un modelo cercano al máximo puede exceder la cuota inicial de almacenamiento y requerir simplificación o una cuota mayor administrada.
