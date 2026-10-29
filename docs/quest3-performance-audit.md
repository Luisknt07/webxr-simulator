# Auditoría de escenarios para Meta Quest 3

La auditoría completa, con las mediciones por escenario, se entrega en la carpeta `output/auditoria-rv-quest3` del chat. Las mediciones de Chrome de escritorio permiten comparar carga y detectar errores, pero no certifican FPS, estabilidad térmica ni ausencia de cierres en un visor físico.

## Cambios sin reducción de detalle

- `SurfaceMaterialSystem` comparte las recetas que producen exactamente los mismos píxeles y ajustes de muestreo. Acero y aluminio usan la misma fórmula de textura. El desgaste usa sus repeticiones en uniformes del shader. Los materiales editables, colores, semillas, geometría y datos guardados conservan su independencia.
- `XRMirror` omite por defecto la copia del ojo al canvas cuando detecta un navegador de visor autónomo. No cambia la resolución, campo de visión, renderizado de los dos ojos ni mandos. La captura explícita de la aplicación puede solicitar el espejo con `setCaptureActive(true)` y la opción `mirrorOnHeadset: true` permite mantenerlo. La retransmisión propia del sistema del visor debe comprobarse en el dispositivo.

## Qué sigue sobrecargado

Los escenarios CEDI completos, el laboratorio completo y la práctica con once vehículos mantienen entre aproximadamente 1.400 y 2.800 llamadas de dibujo en las vistas medidas de escritorio. Compartir texturas no elimina esa carga. Requieren agrupar partes rígidas compatibles, cargar sectores bajo demanda y mantener originales los mecanismos, colisiones, sensores y superficies editables. Antes de cualquier cambio de motor o multiview se deben conservar las pruebas de Three r112 y WebXR.

Los escenarios pequeños de estación manual, Combiner/Separator, gravedad y manipulación robótica son candidatos iniciales de menor carga. Esta selección no equivale a una certificación en Quest 3.

## Validación reproducible

```text
node scripts/test-surface-pixel-recipes.js
npm run test:graphics
npm run test:webxr-ai
node scripts/test-surface-materials.js
node scripts/test-material-parts-integration.js
node scripts/test-industrial-photographic.js
node scripts/qa-large-scene-performance.js --label quest-audit --scenes l-transfer,lab-assembly,lab-gravity,robot-handling-line,manual-station,industrial-lab-complete,cedi-sorting-robotics,forklift-training
```

La prueba de recetas compara 168 mapas generados byte a byte y verifica las transformaciones UV y parámetros del sampler. Las pruebas del espejo verifican que Quest sin captura no crea recursos ni ejecuta llamadas al renderizador para el espejo, y que activar/desactivar captura adquiere y libera sus recursos.

La prueba física pendiente debe usar Meta Quest Browser en Quest 3, recorrer cada escenario, operar equipos y cambiar varias veces entre escenarios. Registrar tiempos CPU/GPU, FPS sostenidos, memoria, pérdida de contexto y temperatura durante varios minutos. El objetivo de 72 Hz deja aproximadamente 13,9 ms por fotograma. Una prueba de escritorio o una sesión XR simulada no sustituye esta validación.

Referencias oficiales: [flujo de optimización de Meta](https://developers.meta.com/vr/documentation/web/webxr-perf-workflow/) y [buenas prácticas de WebXR](https://developers.meta.com/vr/documentation/web/webxr-perf-bp/).
