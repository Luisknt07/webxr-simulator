# Proyectos industriales portables

Estos archivos contienen escenas y configuraciones de autoría. No incluyen cuentas, sesiones de visitantes ni la base de datos local.

| Archivo | Contenido |
| --- | --- |
| [industrial-cedi-complete.json](industrial-cedi-complete.json) | Laboratorio con nueve líneas de ejemplo y dos CEDI completos: clasificación y packing. |
| [industrial-study-fundamentals.json](industrial-study-fundamentals.json) | Nueve prácticas independientes de transporte, clasificación, unión, elevación y transferencia. |
| [industrial-study-advanced.json](industrial-study-advanced.json) | Inspección y retrabajo, packing multitipo, transferencia de pallets y estación manual. |

Ejecuta `npm.cmd install` y `npm.cmd start` con Node.js 24 o posterior. Abre `https://localhost:8080/editor`, usa **Archivo → Importar proyecto JSON** y selecciona uno de estos archivos. Guárdalo como proyecto para conservarlo en la instalación y utiliza **Probar** para ejecutarlo.

Los archivos utilizan los recursos incluidos en este repositorio y no necesitan archivos importados externos. Contienen los acabados y el desgaste, las demarcaciones del piso, las tarjetas contextuales y los monitores suspendidos de doble cara. El sonido está habilitado al iniciar; el navegador puede requerir la primera interacción para reproducirlo.

La configuración de las prácticas automáticas y manuales se conserva en cada ejemplo. Los casos avanzados con lotes finitos terminan al completar el lote; la estación manual espera las acciones del operario. El catálogo **Escenas** permite crear nuevas variantes editables.
