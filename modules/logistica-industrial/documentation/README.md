# Documentación conceptual de logística y manufactura

El contenido procede de `NEXUS_Base_Conceptual_Equipos_Logistica_Manufactura.docx`, aportado por el propietario. Su SHA-256 es `eb77ebdd20f5b87cb7f734015bb567b29a03e88e9ac796448c883aa6f1b6c755`. El documento es una fuente de contenido: sus propuestas de configuración no se ejecutan ni acreditan que una máquina esté implementada.

Se conservan 198 fichas, 27 capítulos e introducciones, 213 tablas, 198 esquemas y 54 operaciones. Cada artículo incluye identificadores de párrafos, tablas e imágenes del OOXML original. Los 209 enlaces internos se resuelven a artículos. Los encabezados repetidos de paginación y los dos textos de cabecera/pie se conservan en `supplementaryParagraphs` para separarlos del contenido técnico de las fichas.

`index.cjs` y `index-data.json` contienen la taxonomía ligera utilizada por la biblioteca del editor. No importan el libro ni sus imágenes. `catalog.cjs` y `catalog-data.json` contienen el libro completo y se cargan cuando se solicita documentación. El visor genérico reside en `packages/documentation/DocumentationBrowser.js`; el proveedor sectorial se conecta desde `StudioTools`. Otro módulo puede aportar su propio proveedor sin incorporar este libro.

La relación con el inventario se mantiene en `../contracts/knowledgeBindings.json`. `exact` identifica una representación educativa nativa del tipo descrito; no significa que implemente todas las prestaciones del artículo ni una certificación OEM. `family` identifica un equipo relacionado o un componente integrado y no autoriza insertar una máquina nueva. Sin una relación exacta con un recurso funcional, el concepto permanece pendiente de modelo o comportamiento. La documentación no modifica acciones, prefabs ni inventarios de proyectos.

Para regenerar, se necesita el DOCX original fuera del paquete publicado. Desde la raíz del repositorio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tooling/content/extract-docx-ooxml.ps1 -Source "C:/ruta/NEXUS_Base_Conceptual_Equipos_Logistica_Manufactura.docx" -OutputDirectory "../output/logistics-library-wiki-2026-11-01"
node tooling/content/build-logistics-knowledge.cjs
node --test tests/framework/logistics-knowledge-coverage.test.mjs tests/framework/documentation-publication.test.mjs
```

La extracción abre el ZIP en modo de lectura y genera un inventario reproducible de partes, párrafos, tablas, enlaces e imágenes, con localizadores y hashes. El generador transforma esos datos en artículos y conserva las tablas completas; comprueba las cantidades y la cobertura de párrafos. Si cambia la fuente, hay que revisar sus diferencias, el mapeo de recursos y la prueba de procedencia antes de sustituir los datos aceptados.

Las rutas de ilustración son relativas a la base del Workspace, por ejemplo `modules/logistica-industrial/documentation/assets/TR-01.png`. `assets/manifest.json` declara cada PNG, su tamaño y SHA-256. El empaquetador valida ese manifiesto y copia únicamente las ilustraciones declaradas al Workspace privado. No se debe copiar el DOCX, la extracción completa ni carpetas privadas al visor público; tampoco se debe convertir la carpeta documental en una copia indiscriminada de archivos. Los esquemas conservan la advertencia original de que no están a escala ni representan un modelo comercial certificado.
