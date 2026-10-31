# Controles adaptables, mandos y volante

La consola del montacargas ocupa la altura de su contenido. **Todos**, **Compactar** y **Minimizar** ajustan el tamaño real del panel; el espacio disponible ya no se rellena con un fondo vacío. Si falta altura, los mandos se desplazan dentro del panel y los demás instrumentos mantienen su posición. Se conserva la columna estrecha de escritorio y el plano a la derecha. En celular se utilizan categorías y zonas táctiles de al menos 44 px, con adaptación vertical y horizontal.

El botón **◉ Controles** abre la configuración local de dispositivos. El indicador informa si hay un mando detectado, si necesita calibración o si debe volver a neutral. Al abrir este panel se libera el mouse y se detiene la entrada del vehículo; mover pedales para calibrarlos no conduce el montacargas.

## Mando tipo PlayStation o Xbox

Conecta el mando por USB o Bluetooth al equipo y pulsa un botón con la página enfocada. Si el navegador lo identifica con el mapeo estándar, se configura automáticamente. Un DualShock/DualSense reconocido muestra símbolos PlayStation en los mandos; un Xbox muestra sus equivalentes. Los dispositivos sin mapeo fiable necesitan asignación explícita.

| Función | PlayStation | Xbox |
| --- | --- | --- |
| Avance, retroceso y dirección | Palanca izquierda | Palanca izquierda |
| Elevación e inclinación | Palanca derecha | Palanca derecha |
| Freno | L2 | LT |
| Tomar / depositar carga | ✕ / ○ | A / B |
| Cámara / holograma | □ / △ | X / Y |
| Freno de estacionamiento | L1 | LB |
| Marcha | R1 | RB |
| Encender | Options | Menu |
| Bocina | Share | View |
| Emergencia | R3 | R3 |

Las funciones que el vehículo no admite permanecen ocultas. El teclado y la pantalla táctil continúan disponibles. Una entrada explícita de teclado tiene prioridad en su canal; el freno toma la mayor demanda de las fuentes activas.

## Volante y pedales

1. Abre **Controles** y selecciona los dispositivos detectados. Puedes seleccionar el volante y una pedalera USB separada.
2. En **Calibración**, elige dispositivo, función y eje. Las lecturas en vivo ayudan a encontrar el eje que se mueve.
3. Para dirección, captura el centro y ambos extremos. Invierte el sentido si es necesario y ajusta la zona muerta.
4. Para un pedal independiente, suéltalo y captura **Reposo**; presiónalo completamente y captura **Pedal a fondo**. Se aceptan pedales que van de −1 a 1 o de 0 a 1, en cualquiera de sus sentidos reales.
5. Si acelerador y freno comparten un eje, utiliza **Pedales combinados** y captura reposo y extremos. Esta opción reemplaza las asignaciones independientes de esos dos pedales.
6. Asigna botones pulsándolos durante la captura. Puedes asignar un botón que se mantiene pulsado para retroceder mientras aceleras.
7. Cierra el panel y deja palancas, volante y pedales en neutral. Después utiliza los controles de arranque y marcha del vehículo.

Los volantes desconocidos no adquieren control por una suposición sobre sus ejes. Sus perfiles requieren asignación y calibración. Las preferencias se conservan como datos locales del navegador; no se guardan en los niveles ni se envían al servidor.

## Reconexión y realidad virtual

Una desconexión, pérdida de foco o apertura de configuración libera entradas y mantiene el frenado. Reconectar con un acelerador pulsado no reanuda la marcha: hace falta neutral y una nueva acción. El teclado permite continuar de forma deliberada cuando el mando no está disponible. Los botones generan una acción al pulsarlos, no una repetición en cada fotograma.

Los mandos de Quest conservan su entrada WebXR y la cabina física existente. Los dispositivos externos de este adaptador se suspenden durante la sesión inmersiva para no competir con esos controles. La configuración de escritorio se cierra al entrar en RV. Esta entrega no añade volante externo a una sesión XR ni fuerza de retorno de motores.

## Compatibilidad y límites

La detección depende de lo que el sistema operativo y el navegador expongan a la [Gamepad API](https://www.w3.org/TR/gamepad/). La lista puede permanecer vacía hasta que el usuario pulse un botón; algunos dispositivos y navegadores utilizan ejes distintos. WebXR sigue requiriendo HTTPS o localhost. Un volante que solo exponga un protocolo HID propietario necesita un adaptador específico y permisos explícitos; no se implementa una lectura HID genérica. Véanse las [limitaciones de dispositivos HID](https://developer.chrome.com/docs/capabilities/hid).

Se verificaron entradas y desconexiones con hardware simulado, el runtime real y navegador temporal. Esto no certifica un modelo físico de volante, pedalera o teléfono. El modelo concreto debe comprobarse conectado en su navegador.

## Organización y comprobación

`packages/input-devices/GamepadInput.js` es independiente de Three.js, editor y simulación. Entrega canales normalizados al host, no mueve objetos ni inventario. `InputDevicePanel.js` e `input-device.css` aportan su interfaz opcional; `VehicleDriving.js` adapta esos canales a la misma ruta física del teclado y la cabina. El servicio usa el bucle existente, sin otro temporizador de animación ni conexión de red. Las opciones de host `inputDeviceClass:false` e `inputPanelClass:false` permiten retirar el adaptador o su interfaz.

`npm.cmd run test:input-devices` verifica núcleo, configuración e integración física. La QA `tooling/qa/forklift-responsive.cjs` comprueba alturas, blancos, botones táctiles y modal; `tooling/qa/input-device-production.cjs` comprueba el artefacto compilado con un mando simulado, captura de calibración, foco, neutral y limpieza. Los proyectos y las bases de datos de esas pruebas son temporales.
