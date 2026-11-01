# Carga visible y descarga asistida

El holograma de cabina solo modifica los componentes del montacargas. La carga
conserva sus materiales, contornos y posición al bajar y volver a subir, también
cuando permanece acoplada a las horquillas.

En las misiones, las flechas orientan la aproximación. Una entrega conducida y
segura en el destino asignado puede completarse aunque no se hayan atravesado
todas las flechas. Solo recorrer la ruta indicada concede sus puntos adicionales.
La misión termina después de depositar el pallet y retirar ambas horquillas.

Se mantienen las tolerancias manuales existentes y el centrado final limitado:
no es necesario acertar una coordenada exacta. La descarga sigue comprobando la
celda asignada, disponibilidad, capacidad, apoyo real y espacio libre; una carga
flotante, en movimiento o con un obstáculo no se confirma. El freno de
estacionamiento no impide una descarga válida.

Las etiquetas impresas de las estanterías se mantienen visibles e identificables,
pero no forman un obstáculo físico para el mástil. Postes, vigas y soportes
conservan su colisión.

Regresiones: `npm run test:vehicle-assistance`, `npm run test:warehouse-missions`
y `npm run test:drop-placement`. `tooling/qa/learning-warehouse.cjs` verifica las
tres misiones en Chrome con los artefactos compilados, tres remontadas por carga
y los pequeños desajustes de la captura en el nivel superior. Sus posiciones
finales son fixtures de precisión declaradas; los trayectos y la retirada usan
el movimiento manual y las colisiones reales. La prueba no usa proyectos ni
cuentas del usuario.
