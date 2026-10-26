# Administración y menú inmersivo

La administración de escritorio se abre en un modal amplio desde **Menú → Administración**. La lista de cuentas ocupa la columna izquierda y la información de la cuenta seleccionada aparece a la derecha. La búsqueda permite filtrar por nombre o usuario; también se puede filtrar por permiso, ordenar por actividad o uso y cambiar la cantidad de filas por página.

Los cambios de cuota y permiso se aplican a la cuenta seleccionada. La consulta de recursos y avances se solicita cuando se necesita, evitando desplegar todos los informes de todos los usuarios. **Escape**, el botón de cierre y el fondo del modal permiten volver al escenario. El acceso y la información siguen restringidos al superadministrador.

## Acceso desde realidad virtual

Durante una sesión inmersiva, los paneles HTML del escritorio se ocultan. El menú del visor es una pantalla 3D de la misma escena, con botones y un teclado que reciben los rayos de ambos mandos. Al entrar en RV permanece cerrado y no muestra etiquetas flotantes frente al usuario; sólo se abre al pulsar los botones asignados.

- **X del mando izquierdo o A del derecho:** abrir o cerrar el menú, cuando el dispositivo expone botones con el mapa `xr-standard`.
- **Gatillo:** pulsar botones y teclas. Los botones muestran estados de señalamiento y pulsación.
- **Recentrar este menú:** colocar de nuevo el panel frente a la posición actual.
- **Cerrar:** continuar usando los equipos y productos del escenario.

El botón de sistema del visor Meta permanece reservado al sistema operativo, conforme al [mapeo y los controles reservados de WebXR](https://www.w3.org/TR/webxr-gamepads-module-1/). Cuando el menú está abierto, sus interacciones excluyen los botones de maquinaria, la toma de productos y las acciones de teletransporte. Al cerrarlo se recuperan las interacciones normales.

El formulario inmersivo permite iniciar sesión y crear una cuenta con un código de registro cuando corresponda. Las contraseñas se dibujan ocultas. Los campos se vacían al cerrar, cambiar de identidad, desconectar un controlador o finalizar la sesión. Las credenciales no forman parte del documento del escenario, las preferencias ni las exportaciones.

Al abrir el acceso aparece el teclado sobre el campo Usuario. **Siguiente** pasa a Contraseña y **Entrar** envía el formulario desde el propio teclado. También permanece disponible el botón de inicio de sesión del panel. Si la conexión inicial falló, **Reintentar conexión de cuentas** vuelve a comprobar el servicio del mismo origen antes de mostrar los campos; una respuesta tardía no vuelve a abrir un menú cerrado ni cambia a una cuenta anterior.

La autenticación necesita el servidor de Studio, también desde el visor. La copia de GitHub Pages ofrece los dos ejemplos públicos y no ejecuta el servicio de cuentas; para iniciar sesión se debe abrir la dirección HTTPS del servidor o del túnel público. El menú informa de esta condición sin enviar contraseñas a otra dirección. Si el servidor estaba temporalmente inaccesible al cargar, **Reintentar conexión de cuentas** comprueba su disponibilidad y vuelve a mostrar el teclado cuando se recupera; esta comprobación no envía credenciales.

Después de iniciar sesión se pueden consultar las escenas y los proyectos autorizados, las prácticas y los ajustes del visor. Iniciar sesión conserva la posición y la escena actual; abrir otro escenario es una acción separada. La administración detallada de cuotas permanece en el modal de escritorio.

## Alcance de verificación

Las pruebas automatizadas utilizan los rayos y eventos de `RayControl`, mallas Three.js y coordenadas UV reales. Comprueban ambos mandos, teclado, aislamiento de maquinaria, cambios de identidad, visibilidad y liberación de recursos. La prueba de Chrome usa un servidor y una base de datos temporales, con renderizador WebGL real y modo inmersivo simulado. Esto no sustituye una prueba física con Meta Quest 3.
