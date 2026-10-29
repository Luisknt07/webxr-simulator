# Publicación y aplicaciones privadas

GitHub Pages recibe exclusivamente `artifacts/public-viewer`. Incluye HTML, CSS, configuración pública, un bundle compilado, el catálogo de un elemento y la proyección `vr-robot-dispatch`. No recibe el editor, las otras 33 escenas, sectores adicionales, API, SQLite, archivos de usuarios ni mapas de fuentes.

El servidor privado se despliega por separado. `apps/api/index.cjs` sirve el mismo visor público y protege `/editor`, `/workspace/`, sus recursos y las APIs con sesión. Consulta [la configuración del servidor](../apps/api/README.md). Una publicación estática no puede autenticar ni almacenar proyectos privados por sí sola.

## Preparar una publicación

```powershell
npm.cmd run build
npm.cmd run pages:verify
npm.cmd run pages:prepare
```

`build` genera el catálogo fuente completo bajo `projects/smarttwin/scenes`, compila las aplicaciones y empaqueta distribuciones separadas. La existencia de esas escenas en el repositorio no las incorpora al visor público. `tooling/build/package-apps.cjs` selecciona solo la proyección autorizada y crea manifiestos de hashes por aplicación.

`pages:verify` exige una lista cerrada de seis recursos y `publication.json`: rechaza archivos adicionales, cambios de bytes sin actualizar el manifiesto, escenas adicionales y metadatos globales privados. `pages:prepare` copia únicamente esa lista a `data/pages-site`, añade `.nojekyll` y registra la revisión publicada. Nunca copia la raíz del repositorio.

Al subir a `main`, `.github/workflows/pages.yml` verifica estos artefactos versionados y despliega `data/pages-site`. No recompila las escenas dentro de Actions. En Settings → Pages debe estar seleccionado GitHub Actions. `publication.json` permite comprobar el commit y el SHA-256 del bundle efectivamente servido.

El visor usa rutas relativas para funcionar bajo `/webxr-simulator/`. Su selección pública es fija: parámetros de URL o fallos de red no desbloquean escenarios privados. El botón de acceso muestra instrucciones si no hay backend configurado. Para conectar un servidor, configura las URLs HTTPS admitidas en `apps/public-viewer/config.js` y vuelve a empaquetar; las credenciales y claves nunca pertenecen a esa configuración.

## Otras aplicaciones

- `artifacts/workspace`: editor y mundo industrial existentes; se sirve autenticado desde la API. No publicar esta carpeta en un hosting estático abierto.
- `artifacts/core-empty`: prueba independiente del núcleo y BrowserHost, sin sectores.
- `artifacts/projects/<nombre>-…`: resultado de `npm.cmd run project:build -- --project projects/agricultura/project.json`. Contiene únicamente la composición elegida y sus dependencias. Es una aplicación local de referencia con estado en memoria; su despliegue no crea un backend ni convierte datos en privados automáticamente.

Las herramientas heredadas de empaquetado y sus pruebas permanecen para compatibilidad de los ejemplos antiguos. El flujo oficial de Pages es `tooling/deploy/{verify-public,prepare-pages}.cjs`; no se debe volver a publicar el empaquetador antiguo del catálogo completo.

## Validación

`tests/framework/publication.test.mjs` comprueba aislamiento, hashes, campos privados y archivos extra. `packaging.test.mjs` comprueba listas de recursos y empaquetado transaccional. La revisión de navegador cubre el visor público, la entrada independiente, las composiciones de Agricultura y Turismo, y el editor privado con una base temporal HTTPS.

La estabilidad y calidad en Quest 3 requieren además probar el visor físico. Los resultados de Chrome de escritorio no son una medida de FPS del dispositivo.
