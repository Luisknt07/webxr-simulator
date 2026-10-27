# Puesto de conducción interactivo

En escritorio, al subir con **F** o desde el inspector se libera el cursor para usar el panel. Si el vehículo está apagado, pulsa **Encender**, después **Marcha** y desactiva **Freno P**. La cabina muestra el estado real de alimentación, marcha, emergencia y freno, e indica qué falta para conducir. Los botones activos quedan resaltados; Encender conserva los enclavamientos y no anula una emergencia ni libera el freno por sí solo.

**Tab** alterna entre cursor libre y mirada con el mouse; **Esc** también libera el cursor. Puedes volver a capturarlo haciendo clic en la vista 3D. Los atajos de la cabina son **B** para encender, **V** para marcha y **P** para alternar el freno de estacionamiento. **WASD** conduce y **Espacio** aplica el freno de servicio.

La dirección se interpreta desde el asiento: **D** gira el morro a la derecha y el aro en sentido horario; **A** gira a la izquierda. Las ruedas traseras orientan al lado contrario del morro y la cola barre hacia fuera del giro. En reversa, el mismo ángulo de dirección invierte el cambio de rumbo, como corresponde a una dirección trasera. El pedal acelerador queda a la derecha del conductor y el freno a su izquierda.

El acelerador entra progresivamente, limita el cambio de aceleración y retiene al soltarlo; **S** frena el avance antes de iniciar reversa. La dirección entra y retorna de forma gradual, con menor sensibilidad a mayor velocidad. El control manual limita velocidad y giro en curvas. Estos ajustes se editan en la configuración del vehículo: cambio máximo de aceleración, retención, velocidad de dirección y retorno, aceleración lateral y velocidad angular máximas. Son parámetros educativos de un modelo cinemático; no representan la calibración certificada de un fabricante ni una simulación de vuelco o suspensión.

En RV, acerca un mando al aro del volante y mantén pulsado el botón lateral de agarre. El volante sigue el giro de la mano dentro de sus topes. Puedes sostenerlo con cualquiera de las manos; una segunda mano no lo roba mientras está ocupado. El stick conserva avance y reversa mientras el volante físico tiene prioridad sobre la dirección del stick.

El stick izquierdo tiene respuesta gradual cerca del centro para acercamientos precisos y conserva toda la autoridad en sus extremos. El aro físico conserva su ángulo al reagarrarlo, incluso si el eje todavía está alcanzando la orden anterior.

Las palancas hidráulicas se toman por el pomo con el mismo agarre. Su desplazamiento manda elevación, inclinación, alcance, desplazamiento lateral o torreta, según las capacidades del vehículo. Tirar de la palanca de elevación hacia el operador levanta las horquillas. Al soltar, la palanca vuelve al centro y la máquina deja de recibir esa orden. Una mano puede dirigir mientras la otra acciona una palanca. Los sticks siguen disponibles como alternativa.

Abrir un menú, pausar, activar una emergencia, perder el seguimiento o desconectar un mando suelta los controles y aplica el bloqueo de entrada existente. Debes soltar el agarre y volver a neutral antes de retomarlos. Agarrar un volante o una palanca no ejecuta la acción de tomar una carga ni activa el freno asociado al grip libre.

`VehicleCabInteraction` interpreta las poses; `VehicleRuntime` sigue siendo responsable de movimientos, capacidad, colisiones y custodia de la carga. Los pivotes y capacidades vienen de `vehicleRig.controls`. Los mandos y la cabeza conservan sus poses nativas: sólo se añaden indicadores translúcidos de contacto.

La versión de Three usada por el proyecto expone targetRaySpace. `XRGripTracking` añade la pose gripSpace de WebXR con dos grupos reutilizados y usa el espacio de referencia de la misma sesión. Una pose ausente oculta la mano y libera su mando; no se reutiliza una pose antigua. Si el motor ofrece `getControllerGrip`, se usa directamente.

La prueba `test-vehicle-cab.js` utiliza los modelos, RayControl y runtime reales con poses y sesión simuladas. Verifica ambas manos, los cinco canales hidráulicos, cambio de ángulo a través de ±π, topes, prioridades, rearme y limpieza. La comodidad y alcance físico de los controles necesitan una comprobación final en un visor real.

El criterio de dirección trasera se contrastó con [Toyota: diferencias entre un montacargas y un automóvil](https://www.toyotaforklift.com/resource-library/blog/toyota-products/is-driving-a-forklift-like-driving-a-car). La respuesta según velocidad y la reducción en curvas se inspiran en funciones documentadas de [Linde Steer Control](https://www.linde-mh.com/en/About-us/Innovations-from-Linde/Linde-Steer-Control/) y [Linde Load Management](https://www.linde-mh.com/en/About-us/Innovations-from-Linde/Load-Management.html); los valores del simulador son propios.
