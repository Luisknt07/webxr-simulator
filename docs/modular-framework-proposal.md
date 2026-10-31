# Nota histórica: propuesta modular

Este archivo conserva la referencia de la revisión arquitectónica inicial realizada contra `7f14390`. La propuesta dejó de describir el estado actual cuando se implementaron el core puro, el SDK, el descubrimiento local y las composiciones por sector.

La documentación vigente es [Guía de implementación de módulos y funciones](framework-modules.md). Incluye los contratos ejecutables, comandos, copia selectiva, persistencia, seguridad y límites comprobados.

La estructura actual usa `apps/`, `packages/`, `modules/`, `projects/`, `tooling/` y `artifacts/`. Agricultura y Alimentos reutilizan almacenamiento sin activar todo Logística; la aplicación pública distribuye un único escenario.

El Workspace industrial continúa mediante un adaptador explícito de compatibilidad con ciclo de vida de página. Su editor completo todavía no se puede retirar en caliente: esa limitación está documentada y protegida por el adaptador.
