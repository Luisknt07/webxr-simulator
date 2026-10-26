# Publicación pública

GitHub Pages sirve la aplicación estática desde `/webxr-simulator/`. La base relativa de `index.html` mantiene scripts, estilos, modelos y texturas dentro de esa carpeta; `.nojekyll` conserva los recursos publicados.

Sin el servidor de Studio, el visualizador abre dos ejemplos incluidos: transferencia rectangular a 90° e inspección y clasificación. Sus proyecciones se generan desde ejemplos versionados con `node scripts/generate-public-scenes.js` durante `prebuild` y `prestart`. Cada archivo contiene una sola sala, sin archivos privados importados. El visualizador conserva la simulación y WebXR, y limita la navegación a esas dos escenas públicas.

Las cuentas, cuotas, proyectos privados, edición y sesiones compartidas necesitan el servidor Node/SQLite. En una publicación estática se informa de esta condición y no se muestra un formulario de contraseña que no pueda funcionar. La caída de la API nunca habilita edición ni recupera borradores privados del navegador.

Para publicar, ejecutar `npm.cmd run build` y subir los cambios a `main`. El flujo `.github/workflows/pages.yml` prepara un artefacto con los recursos del visualizador y lo despliega mediante las acciones oficiales de Pages. En **Settings → Pages → Build and deployment → Source** se debe seleccionar **GitHub Actions**. También se puede iniciar manualmente desde Actions. `publication.json` identifica el commit y el hash del bundle que realmente se sirve.

El paquete sólo contiene HTML, estilos, scripts compilados y recursos estáticos. No incluye SQLite, carpetas de usuarios, servidor, certificados, dependencias de desarrollo ni mapas de fuentes. `npm.cmd run pages:prepare` lo genera en `data/pages-site`, excluido de Git.

Para acceso mediante Dev Tunnels, ejecutar `npm.cmd start`, configurar el puerto 8080 con protocolo **HTTPS** y utilizar el dominio público asignado. El servidor admite los dominios de Dev Tunnels y conserva la validación para hosts ajenos. Tras cambiar de HTTP a HTTPS, VS Code puede volver a marcar el puerto como privado: restablecer **Puertos → 8080 → Visibilidad del puerto → Público**. La primera visita puede requerir pulsar **Continuar** en el aviso propio de Dev Tunnels.

Dev Tunnels puede mostrar un aviso inicial con el botón «Continuar». Al abrir el túnel de este proyecto, ese paso permite llegar al visualizador y sólo se solicita una vez por navegador/túnel.

Validación automatizada:

```powershell
node scripts/test-editor-routes.js
node scripts/test-public-tunnel.js
node scripts/test-public-static-viewer.js
$buildHash = (Get-FileHash bundle.js -Algorithm SHA256).Hash.ToLower()
node scripts/qa-public-publication-browser.js --expected-bundle-sha256 $buildHash
```

La prueba de Chrome usa un servidor estático temporal, tanto en la raíz como bajo la carpeta de repositorio. Comprueba carga 3D, cambio de los dos ejemplos públicos, acceso de sólo lectura, aviso de cuentas, menú móvil, rutas de recursos y ausencia de escrituras o errores de WebGL. Los reportes y capturas se guardan en `data/qa-studio/`, excluida del repositorio. No es una medición física en Quest 3.
