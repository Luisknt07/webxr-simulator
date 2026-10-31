# Rutas en el plano y en el escenario

El botón **Holograma · Shift+G** controla la presentación 3D: contornos, flechas y referencias del escenario. El plano conserva el destino seleccionado y la navegación al ocultar ese efecto. La consulta de objetivos, fase de carga y disponibilidad del receptor sigue actualizándose de forma acotada, sin crear recursos gráficos cuando el holograma arranca apagado.

La demostración pública conecta robot, bandas y montacargas. Sus pallets se generan durante la simulación; no utiliza las misiones de almacén con existencias iniciales y puntuación. Dispone de un recorrido orientativo definido en los puntos manuales del vehículo, con un tramo de recogida en la banda de salida y otro de entrega en las bahías. La ruta lleva a una zona de aproximación; la alineación final se hace con la cámara y las medidas reales.

Los puntos se reutilizan únicamente para un vehículo en modo manual y un objetivo compatible que coincida con el tramo. No ejecutan comandos de recogida, depósito o movimiento, ni asignan puntuación. La comprobación física existente valida cada segmento y giro con la envolvente del montacargas, horquillas y carga. Un obstáculo corta el recorrido; sin comprobación física no se dibuja un camino como si estuviera validado. Otros proyectos sin itinerario conservan su marcador de destino y una indicación de referencia local.

Para ver flechas en el piso, activa **Shift+G**. Antes de circular con un pallet elevado, sigue la instrucción de bajar a altura de transporte. El plano muestra la ruta por separado del efecto 3D y del retrovisor.

La visibilidad del holograma no modifica inventario, vehículo, proyectos ni progreso. Las pruebas de regresión cubren carga real de 33 kg, transición de recogida a entrega, receptor lleno, rutas autorizadas, obstáculos y ausencia de un comprobador físico, además de los límites de actualización y recursos.
