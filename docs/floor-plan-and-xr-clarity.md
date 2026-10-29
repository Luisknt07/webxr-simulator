# Piso editable y nitidez de realidad virtual

Esta revisión permite construir equipos dentro de las zonas pintadas, diseñar pasillos y escribir nombres propios en el piso y en carteles. Añade controles de nitidez para Quest sin aumentar la resolución del framebuffer ni incorporar pases de posprocesado.

## Editar pasillos y nombres

1. Abre una variante editable de la plantilla y entra en el editor. Los ejemplos públicos conservan su acceso de consulta.
2. Usa **Añadir → Pasillos, zonas y textos de piso…**. También puedes seleccionar la capa **RV · pasillos y textos editables** y pulsar **Editar pasillos y textos** en el inspector.
3. Añade pasillos, zonas de trabajo, bahías, pasos peatonales, flechas, textos de piso o carteles. Ajusta X/Z, medidas y, cuando corresponde, giro. Los rectángulos de pasillos y zonas usan los ejes locales del nivel.
4. Escribe el nombre directamente en las filas **Texto en piso** o **Cartel**. Pulsa **Aplicar diseño** y después **Guardar**.

Los cambios admiten deshacer/rehacer y mantienen la identidad de la capa. Se guardan y reabren con el proyecto o su JSON. La ventana rechaza una aplicación si el nivel, proyecto, permiso de edición o capa cambiaron mientras estaba abierta.

Las marcas pintadas no reservan espacio sólido. La colocación sigue comprobando el suelo de apoyo, paredes, equipos y el espacio individual de cada cartel. Esto corrige el rechazo de equipos dentro de una zona porque la envolvente de un lote de pintura o de varios carteles ocupaba toda el área intermedia.

La señalización conserva ocho lotes de materiales como máximo y un atlas compartido. Admite hasta 24 textos personalizados de 64 caracteres, además de los nombres originales. El atlas tiene mipmaps y filtrado anisotrópico; crece por potencias de dos hasta 1024 × 1024, sin crear una textura por palabra. Los límites de cantidad de marcas existentes siguen activos.

Las tres prácticas compactas incorporan una capa de ejemplo con zona de trabajo, pasillo, dos rótulos y un cartel. Ahora contienen 11 o 12 objetos principales, además de sus hijos de control y marcadores. Conservan un robot, un montacargas, una o dos bandas y el límite de dos pallets de cuatro cajas.

## Bordes y parpadeo en Quest

En navegadores identificados como Quest/Oculus Browser/Wolvic se selecciona inicialmente **Más nítida**. Esta preferencia limita la pérdida de detalle periférico; el control de presión de fotogramas sigue ajustando el perfil de recursos. Para comparar fluidez puedes usar **Priorizar rendimiento**.

- Antes de entrar en RV: abre **Menú → Ajustes**, o **Rendimiento** en el editor, y cambia **Nitidez de bordes en RV**.
- Dentro del visor: abre **Menú → Sonido y controles** y pulsa el botón **Nitidez** para alternar los dos modos.
- La preferencia se guarda en este navegador, no en el proyecto ni en el perfil del servidor.

El renderer ya solicitaba antialiasing. Ahora el diagnóstico informa si el contexto o la capa XR realmente lo proporciona. El navegador decide el tipo de suavizado disponible; solicitarlo no garantiza que cada dispositivo lo conceda. La foveación reduce la resolución periférica y puede degradar su detalle, como documentan [Meta](https://developers.meta.com/vr/documentation/web/webxr-ffr/) y [MDN](https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/antialias).

Solo durante la presentación en un visor autónomo, una cámara con plano cercano inferior a 2 cm utiliza 2 cm. Esto mejora la precisión de profundidad de superficies lejanas y cercanas entre sí, como pintura y chapas, frente al valor inicial de 5 mm. Se conserva el plano lejano y se restaura el valor anterior al salir de RV; la geometría y la cámara de escritorio conservan su configuración. Los objetos a menos de 2 cm de la cámara pueden recortarse durante esa presentación.

## Comprobaciones

- Colocación real sobre pasillos, letras y zonas pintadas, incluyendo carteles distantes dentro de un mismo lote gráfico. Los carteles siguen reservando solo su propio espacio.
- Texto español personalizado en piso/cartel, identidad y transformaciones de capa, reconstrucción visual al deshacer/rehacer, guardado, reapertura y validación de servidor.
- Nitidez persistente, límites de foveación, adaptación bajo presión, diagnóstico de antialiasing real y restauración del plano cercano y de la capa XR.
- Acceso con ambos mandos al botón inmersivo de nitidez, sin escritura del perfil del usuario.
- Recorrido físico robot → bandas → horquillas → bahía en la variante compacta con giro y la señalización nueva.

`npm run test:floor-plan` ejecuta las pruebas del editor de piso y colocación. `node tooling/qa/qa-floor-plan-browser.js` utiliza la aplicación compilada, Chrome y una cuenta/base de datos temporales para comprobar la ventana, los textos, construcción sobre pintura, guardado y ajustes de nitidez.

La nitidez percibida, los FPS y la estabilidad prolongada requieren comprobar el Quest 3 físico. La revisión se aplica al repositorio local; no publica automáticamente en GitHub Pages.
