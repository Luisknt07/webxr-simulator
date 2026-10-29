# Nota hist?rica: propuesta modular

Este archivo conserva la referencia de la revisi?n arquitect?nica inicial realizada contra `7f14390`. La propuesta dej? de describir el estado actual cuando se implementaron el core puro, el SDK, el descubrimiento local y las composiciones por sector.

La documentaci?n vigente es [Gu?a de implementaci?n de m?dulos y funciones](framework-modules.md). Incluye los contratos ejecutables, comandos, copia selectiva, persistencia, seguridad y l?mites comprobados.

La estructura actual usa `apps/`, `packages/`, `modules/`, `projects/`, `tooling/` y `artifacts/`. Agricultura y Alimentos reutilizan almacenamiento sin activar todo Log?stica; la aplicaci?n p?blica distribuye un ?nico escenario.

El Workspace industrial contin?a mediante un adaptador expl?cito de compatibilidad con ciclo de vida de p?gina. Su editor completo todav?a no se puede retirar en caliente: esa limitaci?n est? documentada y protegida por el adaptador.
