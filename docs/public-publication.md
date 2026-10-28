# Publicación pública

GitHub Pages sirve la aplicación estática desde `/webxr-simulator/`. La base relativa de `index.html` mantiene scripts, estilos, modelos y texturas dentro de esa carpeta; `.nojekyll` conserva los recursos publicados.

La vista previa temporal permite explorar **todos los ejemplos incluidos sin iniciar sesión**: las plantillas industriales actuales, el laboratorio completo y diez experiencias originales. El catálogo publica sus cantidades `templateCount`, `originalCount`, `laboratoryCount` e `includedCount`, calculadas desde las recetas disponibles; añadir una práctica no exige modificar un límite fijo. Incluye los CEDI con células robóticas y expedición, y la práctica de montacargas cuando está registrada en las plantillas. `node scripts/generate-public-scenes.js`, ejecutado en `prebuild` y `prestart`, construye sus proyecciones desde las fábricas de producción y los modelos incluidos; no consulta SQLite, cuentas ni proyectos guardados. Cada archivo contiene una sola sala, sin importaciones privadas ni cambios privados sobre modelos nativos. El navegador solicita el catálogo y después sólo el escenario elegido, conservando simulación y WebXR.

Los portales de una experiencia original pueden abrir otra original durante esta vista previa: se solicita su proyección independiente y se sustituye la anterior, sin ampliar el permiso de la sala actual. Una URL explícita `?room=photogrammetry` resuelve la experiencia original de esa sala; `?scene=...` conserva prioridad. Los proyectos privados y las plantillas no usan este acceso entre portales.

La política predeterminada está en `shared/public-scenes.js`, `POLICY.previewAllExamples`. En el servidor, Administración → Escenas públicas → «Vista previa temporal de todos los ejemplos incluidos» permite desactivarla o reactivarla inmediatamente. La selección pública original de dos salas se conserva intacta; el cambio nunca publica proyectos privados. Las proyecciones estáticas adicionales también quedan bloqueadas para visitantes cuando se vuelve al modo restringido del servidor.

Para volver a dos ejemplos en **GitHub Pages**, cambia `POLICY.previewAllExamples` a `false` antes de compilar y desplegar. Una generación puntual restringida también se puede hacer después del build con `node scripts/generate-public-scenes.js --restricted`, seguida de `npm.cmd run pages:prepare`; elimina las proyecciones adicionales del artefacto. El siguiente `prebuild` usa otra vez la política del código, por lo que conviene cambiar la bandera para una reversión permanente. Pages necesita desplegar el artefacto actualizado; el interruptor de la base del servidor no modifica una publicación estática ya distribuida.

Las cuentas, cuotas, proyectos privados, edición y sesiones compartidas necesitan el servidor Node/SQLite. En una publicación estática se informa de esta condición y no se muestra un formulario de contraseña que no pueda funcionar. La caída de la API nunca habilita edición ni recupera borradores privados del navegador.

Para publicar, ejecutar `npm.cmd run build` y subir los cambios a `main`. El flujo `.github/workflows/pages.yml` prepara un artefacto con los recursos del visualizador y lo despliega mediante las acciones oficiales de Pages. En **Settings → Pages → Build and deployment → Source** se debe seleccionar **GitHub Actions**. También se puede iniciar manualmente desde Actions. `publication.json` identifica el commit y el hash del bundle que realmente se sirve.

El workflow usa los bundles y las proyecciones **versionados y comprobados juntos**; no vuelve a construir escenas durante la publicación. `scripts/validate-public-scenes.js` valida los ejemplos con Node sin instalar dependencias npm. El generador local sí necesita las dependencias de modelado del proyecto. `publication.json` registra además los hashes del catálogo y de cada proyección, para identificar exactamente los bytes desplegados junto al bundle.

El paquete sólo contiene HTML, estilos, scripts compilados y recursos estáticos. No incluye SQLite, carpetas de usuarios, servidor, certificados, dependencias de desarrollo ni mapas de fuentes. `npm.cmd run pages:prepare` lo genera en `data/pages-site`, excluido de Git.

Para acceso mediante Dev Tunnels, ejecutar `npm.cmd start`, configurar el puerto 8080 con protocolo **HTTPS** y utilizar el dominio público asignado. El servidor admite los dominios de Dev Tunnels y conserva la validación para hosts ajenos. Tras cambiar de HTTP a HTTPS, VS Code puede volver a marcar el puerto como privado: restablecer **Puertos → 8080 → Visibilidad del puerto → Público**. La primera visita puede requerir pulsar **Continuar** en el aviso propio de Dev Tunnels.

Dev Tunnels puede mostrar un aviso inicial con el botón «Continuar». Al abrir el túnel de este proyecto, ese paso permite llegar al visualizador y sólo se solicita una vez por navegador/túnel.

Validación automatizada:

```powershell
node scripts/test-editor-routes.js
node scripts/test-public-tunnel.js
node scripts/test-public-static-viewer.js
node scripts/test-public-examples-policy.js
node scripts/test-public-original-navigation.js
$buildHash = (Get-FileHash bundle.js -Algorithm SHA256).Hash.ToLower()
node scripts/qa-public-publication-browser.js --expected-bundle-sha256 $buildHash
```

La prueba de Chrome genera y sirve exactamente el artefacto de Pages en `data/pages-site/`, tanto en la raíz como bajo la carpeta de repositorio. Comprueba carga 3D, cambio de los dos ejemplos públicos, acceso de sólo lectura, aviso de cuentas, menú móvil, rutas de recursos y ausencia de escrituras o errores de WebGL. Detecta también dependencias de ejecución ausentes del paquete, como los decodificadores Basis/Draco. Los reportes y capturas se guardan en `data/qa-studio/`, excluida del repositorio. No es una medición física en Quest 3.
