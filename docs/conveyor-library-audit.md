# Biblioteca de transportadores: auditoría y contrato

Auditoría previa del 23 de octubre de 2026. Se conserva el proyecto existente,
sus archivos, identificadores de objetos y revisiones SQLite. Copia recuperable
del código y base de datos en `data/backups/*before-conveyor-library-20261023*`.

Motor Three.js 0.112.1 / ECSY; JavaScript en navegador, Node.js en servidor;
metros, Y arriba, trayecto local +X (o +Z con el eje existente). Modelos glTF/GLB,
OBJ/MTL y FBX; los equipos propios son geometría procedural, no imágenes. Los
`.blend` son archivos fuente. No se requiere Python para estas funciones.

| Equipo | Modelo existente | Función existente | Falta detectada | Mejora compatible |
| --- | --- | --- | --- | --- |
| Recto de rodillos | Bastidor, pies, rodillos, motor lateral, sensores, panel | Marcha, paro, pausa, alimentación, velocidad, caja, contadores | Masa, base, apoyo y familia unificada | Referencia común y validación de producto |
| Banda continua | Banda con retorno y tambores | Recorrido, velocidad y flujo | Variantes inclinadas y modulares | Reutilizar trayectoria y superficie |
| Curva | Arco continuo de rodillos/banda | Radio, ángulo, sentido | Ficha educativa y soporte del producto | Variantes reales y visor del mismo modelo |
| Unión T | Rama genérica curva | Enrutamiento, reglas, bloqueo y salida | No identifica mecanismo industrial concreto | Transferencia, empujador, giro o unión explícitos |
| Transferencia/elevador | Tarjetas deshabilitadas, sin equipo | Ninguna capacidad de la tarjeta | Modelo y secuencia | Mostrar únicamente variantes con modelo y comportamiento |
| Acumulación | Retención de cargas al bloquear salida | Colisión y contrapresión | Detección y liberación por zonas | Zonas y señales de ocupación |
| Source/FIFO/Processor/Pallet Queue | Equipos y paneles propios | Generación, cola, proceso, estiba | Separación semántica del puesto físico | Source como herramienta lógica; estación física independiente |

El panel de referencia conserva su carcasa, proporciones, posiciones, materiales,
nueve botones, etiquetas y eventos. Orden de lectura: Marcha / Parar / Emergencia;
Pausa / Apagar / Encender; −Velocidad / Insertar caja / +Velocidad. El desgaste y
los acabados editados por el usuario siguen siendo propios de cada pieza.

Puntos de integración: `IndustrialPrefabs` construye y refresca el modelo;
`IndustrialVisuals` muestra el HMI y animaciones; `SimulationRuntime` conserva la
autoridad del transporte; `ConveyorAssembly` alinea puertos con imán y escribe
conexiones; `SceneDocument` guarda y deshace; `ResourceBrowser` ofrece recursos
y miniaturas del modelo; `RayControl` atiende mouse y ambos mandos WebXR.

Los valores numéricos de la biblioteca son supuestos didácticos editables.
Referencias de principios: [Interroll](https://www.interroll.com/products/rollers-and-wheels),
[Bosch Rexroth TS 5](https://www.boschrexroth.com/en/sg/c/transfer-system-ts-5/),
[SOCO SYSTEM](https://www.socosystem.com/us/articles/how-to-dimension-conveyors).
No son fichas comerciales ni validación de seguridad o capacidad de una máquina
real. La simulación usa eventos, trayectorias cinemáticas y comprobaciones
geométricas; no resuelve contactos, deformación, fricción o estabilidad mediante
un motor de cuerpos rígidos. El visor nunca modifica el escenario abierto.
