# Fuentes de prácticas y equipos NEXUS

## Integración modular

Las prácticas son contenido y adaptadores de `sector.logistics-industrial`.
`PracticeSceneBuilder` consume las fábricas y los puertos nativos del sector;
`PracticeController` observa y manda su simulación existente. No mantiene un
inventario paralelo. Un proyecto conserva el manifiesto de su práctica en
`studio.moduleData['sector.logistics-industrial']`, con IDs reales de actores y
la huella de la fuente, por lo que necesita ese sector para volver a ejecutarse.
La carpeta no se declara como función SDK copiable independiente mientras esas
capacidades nativas no estén expuestas como puertos portables.

La biblioteca de prácticas, su compilador y los libros completos se importan
bajo demanda. Abrir el editor o instanciar un equipo no lee las extracciones
completas; consultar un libro carga sólo el proveedor solicitado. El anfitrión
debe comprobar el módulo, permiso de edición y contexto de proyecto también
después de cada preparación asíncrona, antes de guardar o abrir un proyecto.

Esta carpeta conserva dos documentos aportados por el propietario como requisitos consultables. Sus prompts son texto de la fuente y no se ejecutan. La existencia de una ficha, un layout o una variante no acredita una máquina ni una práctica funcional.

| Fuente | Identificador de edición | Contenido |
| --- | --- | --- |
| `NEXUS_Base_Conceptual_Ilustrada.docx` | `nexus-illustrated-2026` | 189 fichas, 11 familias, 204 tablas y 195 imágenes |
| `NEXUS_Practicas_Escenarios_Diagramas.docx` | `nexus-practices-2026` | 64 operaciones, 384 pasos, 192 casos, 346 tablas y 138 archivos de imagen con 139 referencias |

El SHA-256 y los identificadores de párrafos, tablas y dibujos se conservan en los JSON. Las claves completas incluyen la edición, por ejemplo `nexus-illustrated-2026:TR-03`. Hay códigos reutilizados con otro significado respecto al libro anterior: no se deben reutilizar sus bindings por coincidencia de código. La vinculación con recursos nativos requiere el catálogo semántico y una capacidad comprobada.

`data/source-equipment.json` y `data/source-practices.json` mantienen todos los párrafos y tablas, además de los registros normalizados. Sus estados iniciales son requisitos no verificados. Los índices `equipment-index.cjs` y `practice-index.cjs` cargan únicamente sus JSON ligeros; no importan las extracciones completas. Los libros de `documentation/` son proveedores bajo demanda para el visor genérico: 189 fichas y 64 prácticas, cada una con seis secciones, y una guía de procedencia por libro.

Los 333 archivos originales están en `assets/<edición>/`. El manifiesto declara hashes, tamaños, dimensiones, roles y usos documentales; su presupuesto total es de 24 MiB y no contiene DOCX ni imágenes base64. Solo deben publicarse en el Workspace privado mediante su lista explícita. El visor público no debe importar estos libros ni copiar esta carpeta indiscriminadamente.

Para regenerar las fuentes, desde la raíz del repositorio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tooling/content/extract-docx-ooxml.ps1 -Source "C:/ruta/NEXUS_Base_Conceptual_Ilustrada.docx" -OutputDirectory "../output/nexus-practices-2026-11-02/conceptual-source"
powershell -NoProfile -ExecutionPolicy Bypass -File tooling/content/extract-docx-ooxml.ps1 -Source "C:/ruta/NEXUS_Practicas_Escenarios_Diagramas.docx" -OutputDirectory "../output/nexus-practices-2026-11-02/practices-source"
node tooling/content/build-nexus-source-catalogs.cjs
node --test tests/framework/practice-session.test.mjs tests/framework/nexus-source-coverage.test.mjs
```

`schema/PracticeSession.cjs` evalúa seis pasos con evidencia suministrada por el adaptador del mundo. `act()` no modifica inventarios, equipos ni documentos: solo confirma una acción cuando el snapshot nativo la respalda. El anfitrión debe conservar el contexto de proyecto/generación, comprobar permisos y enlazar los guardas con eventos reales. `blocked` representa una condición crítica; una banda detenida normalmente por su destino lleno no debe presentarse como una emergencia de la práctica.

El evaluador conserva hasta 64 eventos, evita recompensar pasos repetidos, aplica una penalización con enfriamiento y comprueba la evidencia al restaurar un checkpoint. El caso C exige observar la incidencia y su recuperación. Los pesos de la rúbrica se normalizan cuando un criterio no es aplicable, y aprobar requiere completar objetivos materiales, al menos 75 puntos y ninguna condición crítica abierta.

`campaignLedger()` reproduce los balances de referencia de cajas y BOM. Los rechazos no devuelven componentes consumidos. Las masas permanecen desconocidas si no se proporcionan explícitamente las masas de los componentes; los conteos de unidades no se presentan como una conservación de kilogramos.
