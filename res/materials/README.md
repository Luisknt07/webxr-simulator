# Concreto industrial preparado con IA

Asset: `ai-industrial-concrete-v1-master.png`. Imagen original generada con la herramienta integrada ImageGen el 25 de octubre de 2026, sin imágenes de referencia, fondo opaco. Modo: generación nueva. No hubo ediciones creativas posteriores; sólo reducción de resolución y codificación JPEG con System.Drawing para distribución web.

Los archivos de ejecución están en `assets/materials/ai-industrial-concrete-v1-{256,512,1024}.jpg`. El original de producción no se descarga en la experiencia. Las variantes son albedo sRGB, no mapas de normales, profundidad o rugosidad, y no son texturas comprimidas en GPU. Se usan como detalle relativo normalizado sobre el color editable del concreto, conservando su iluminación, relieve y desgaste existentes.

Prompt exacto:

```text
Use case: photorealistic-natural. Asset type: production game material, seamless tileable BASE COLOR / ALBEDO texture for an industrial warehouse floor in a WebXR browser simulator. Generate one square 1024x1024 image of worn medium neutral grey power-troweled concrete, viewed perfectly orthographically straight down, full frame edge to edge. Photographic scanned material realism: fine mineral aggregate, subtle mottled cement, faint polished circulation wear, tiny irregular pores and sparse hairline micro cracks, subdued varied old grime embedded in the surface. Small-scale detail only: this tile represents about 2 square metres and will repeat over a large floor. Medium grey neutral palette, no strong directional lighting or glossy highlights, no baked shadows, no ambient occlusion dark vignette, no perspective, no borders, no slab joints, no painted lines, no text, no watermarks, no props, no objects, no dramatic stains or large conspicuous repeated features. All four edges must join seamlessly. This is a flat physically plausible diffuse albedo texture, not a photo of a scene and not a rendered floor mockup. The image itself fills the entire square.
```

Verificación: inspección visual del original y comparación antes/después en el shader real de Chrome; piso con cambio visible de agregado y color editable conservado. La carga fallida conserva el material procedural. Una sola textura con mipmaps por resolución activa, con cambio atómico y liberación al abandonar el nivel.
