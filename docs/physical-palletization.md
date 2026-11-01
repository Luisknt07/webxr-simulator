# Manipulación coherente de cajas y pallets

Los ejemplos compactos de RV generan ocho cajas individuales de 2 kg. El robot
recoge una caja por ciclo y la deposita en una posición real del pallet. Tras
cuatro entregas se forma una unidad física de cuatro cajas más el pallet de
25 kg: 33 kg y cuatro unidades comerciales. Las cajas conservan sus objetos,
identidades y procedencia; no se sustituyen por copias ni se generan cajas al
consolidar. El montacargas retira esa unidad con sus horquillas reales.

Las ventosas y la pinza de cajas admiten productos individuales. Contactar con
la caja superior no sujeta el pallet ni las otras cajas sueltas. Para mover un
pallet completo se necesita un robot configurado con horquillas o plataforma,
volumen compatible y capacidad suficiente. La admisión comprueba la masa total
de la carga —incluida la tara del pallet— más `toolMassKg`. Las interferencias,
alcance, límites y custodia nativos siguen vigentes. Estos controles didácticos
no calculan vacío, resistencia, fuerza de cierre ni estabilidad certificada.

Las escenas guardadas por usuarios no se migran automáticamente. Una conexión
antigua que intente levantar un pallet con ventosas muestra una explicación y
conserva el inventario. Puede corregirse generando cajas individuales y usando
paletizado físico, o eligiendo un manipulador con apoyo inferior compatible.
La integración CEDI conserva enlaces que transportan pallets y explica por qué
no intercala una pinza de cajas en ellos.

## Configuración del paletizado físico

En un `palletQueue`, activar `palletize` y declarar `palletizeLimit` (1–32 pallets
vacíos disponibles por ejecución). El modo requiere una posición, cuadrícula,
hasta 32 cajas por pallet, `acceptsPallets=false` y `autoRelease=false`.
El total de cajas de una ejecución está limitado a 128.
La cuadrícula y las dimensiones determinan dónde deposita cada caja el robot.
Con la opción desactivada se conserva el almacenamiento anterior.

El receptor debe estar físicamente apoyado: en el ejemplo está sobre la entrada
del transportador. Con `delivery=automatic`, su `outputId` debe señalar esa
entrada contigua y alineada. El sistema solo transfiere el pallet a menos de
3,5 cm de la pose real de admisión, después de comprobar capacidad y colisión.
No transporta pallets a distancia por enlazar identificadores.

La cinta permanece parada durante la construcción. Un pallet completo inicia
su traslado por la cinemática del transportador. El siguiente pallet vacío
espera a que la cinta quede libre, sin detener una carga todavía en tránsito.
En la recogida manual se mantiene el paro de salida: tras retirar las horquillas,
el operario puede reiniciar la banda para el siguiente pallet.

La consolidación mantiene una sola carga activa y archiva sus componentes en
la infraestructura existente de procedencia y sesiones. Guardar/reanudar una
sesión restablece los objetos hijos, posiciones y cantidades. Retirar una carga
con componentes creados en el editor no destruye sus recursos; detener la
simulación recupera sus posiciones y visibilidad originales.
