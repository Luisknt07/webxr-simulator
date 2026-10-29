# Validación de la reorganización

Fecha: 29 de octubre de 2026. Base de migración: `7f14390787545096bc9057e550fc71c7407f02e2`. La reorganización se preparó y verificó en una copia aislada antes de aplicarse al repositorio original.

## Resultados

| Comprobación | Resultado |
|---|---|
| Contratos, núcleo, sectores, API genérica, copia, discovery, empaquetado y compilación selectiva | 57 pruebas aprobadas; 0 fallos |
| Compatibilidad del sistema existente | 268 scripts aprobados; 0 fallos |
| API de producción | Bootstrap local, TLS, proxy, sesión, roles, recursos y hashes aprobados |
| BrowserHost | Bucle único, pausa de pestaña, restauración de WebGL, cierre y sesión XR tardía aprobados |
| Visor público | Robot → banda → recogida y entrega con montacargas; mismo pallet de 4 unidades y 33 kg |
| Núcleo vacío | 0 sectores; suelo y cubo; móvil, limpieza y entrada XR de prueba |
| Workspace | HTTPS real, propietario temporal, sesión, crear/guardar/cambiar escena/reabrir/recargar; sin errores de consola, peticiones ni servidor |
| Agricultura compilada | Solo cosecha + almacenamiento; UI creó ubicación y cosecha de 12 unidades/20 kg |
| Turismo compilado | Solo recorridos; UI completó 2 visitas |
| Publicación | Lista cerrada, hashes, una escena, rechazo de campos privados y archivos adicionales |

La batería de compatibilidad excluyó un único script: `test-continuous-industrial-examples.js`, la simulación prolongada completa. No se contabiliza como aprobado en esta ejecución. Las pruebas compactas de RV, custodia física de pallets, robots, horquillas, cámaras, pasillos, estanterías, CAD y rutas guardadas sí se ejecutaron.

Las cinco aplicaciones se probaron en Chrome con artefactos compilados, cuentas o servidores temporales cuando correspondía y revisión de capturas de escritorio/móvil. Se comprobaron los bytes solicitados contra sus hashes. El perfil XR automatizado preservó la pose de la cabeza; no equivale a una sesión física en Quest 3 ni aporta una medida de FPS del visor.

## Artefactos revisados

| Aplicación | SHA-256 del bundle |
|---|---|
| Visor público | `6a6dd7e8888b0e223170e16cbf2f27914e5bdcad472281bf010b404f20c34b55` |
| Núcleo vacío | `ae5f3520dab566573464641dca3ae4a701022779d24842a298f04d2f40f6766a` |
| Workspace | `3e6928608bfa9adf37fecbf6036fa19fb594d68512c6787cc9dcb6e95ca8fd5b` |

Los informes completos y capturas se conservan localmente en `data/qa-restructure`, `data/qa-studio` y `data/qa-modular`; no se publican en Pages. Los builds de composiciones son resultados locales ignorados por Git.

La revisión adicional corrigió entradas declaradas fuera de un paquete, salidas con enlaces colgantes, cierres asíncronos y la restauración de recursos de sombras de Three.js r112 tras perder WebGL. El escaneo redactado de 806 archivos de texto no encontró claves ni tokens productivos; los 49 literales de contraseñas detectados pertenecían exclusivamente a fixtures/QA. Los binarios grandes quedaron fuera del escaneo textual.

Siguen pendientes los avisos de las dependencias heredadas, la retirada completa en caliente del editor industrial y la prueba física de Quest 3. Véanse [seguridad y alcance](framework-security.md) y [módulos y compatibilidad](framework-modules.md).
