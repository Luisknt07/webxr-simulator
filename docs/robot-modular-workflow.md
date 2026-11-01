# Configurar el mismo robot por piezas

Selecciona **Articulado de manipulación** y pulsa **Configurar montaje 3D y
piezas** en el inspector. También puedes abrir **Estudiar equipo → Configurar**.
El montaje modular utiliza el rig funcional de seis ejes; no inserta una figura
independiente ni sustituye la máquina por una ilustración.

Hay cuatro estructuras: compacto de formación, industrial, largo alcance y
manipulación reforzada. Base, hombro, brazo, antebrazo y muñeca tienen selectores
de piezas compatibles. **Automático** toma la pieza del perfil. Al cambiar de
perfil se restablecen las elecciones incompatibles, sin descartar las que siguen
siendo válidas. Los perfiles representan formas industriales genéricas: no
cambian por sí solos la carga máxima ni son réplicas certificadas de fabricantes.

**Previsualizar ensamblaje** muestra la nueva geometría en reposo, en 3D o plano
ortográfico, sin mover el robot ni cambiar el inventario. **Aplicar al robot**
actualiza el mismo objeto mediante el historial del editor. Ctrl+Z permite
deshacer. Guarda el proyecto para conservar la configuración.

## Herramienta y soporte

La pinza y las ventosas toman productos individuales compatibles. Una ventosa
sobre una caja no sujeta el pallet que hay debajo. Las horquillas y la plataforma
tienen un adaptador conectado a la brida y un TCP de apoyo propio, separado de
la muñeca para dejar espacio a la carga. Su uso con pallets exige apoyo inferior,
capacidad y dimensiones compatibles; la masa de herramienta forma parte del
límite configurado. Los demás efectores conservan su referencia anterior.

La escena compacta suministra cajas individuales al robot. El paletizado reúne
las cajas originales sobre una base vacía; sólo el conjunto terminado se
transfiere al transportador y al montacargas. Cada caja conserva su identidad
como miembro del conjunto, y la masa incluye la tara del pallet. La configuración
de paletizado físico es explícita y no cambia las colas que no la activan.

## Terminal de programación

En **Panel y terminal portátil**, elige **Industrial**, **Formación** o **Ninguno**,
y montaje en armario o pedestal. El terminal tiene una cuna y un cable al armario;
su pantalla muestra el estado del mismo robot. Los diez pulsadores utilizan los
controles nativos de encendido, apagado, marcha, parada, pausa, ciclo, velocidad,
emergencia y rearme. La emergencia del terminal queda enclavada: pulsarla otra
vez no la libera. No se muestran ejes de jog o pinzas manuales como si fueran
mandos implementados cuando el controlador no ofrece esas funciones.

Cambiar la carcasa del terminal conserva sus actores de control y sus enlaces.
La selección y el guardado pasan por las mismas comprobaciones de permisos que
el resto del editor. El visor público permite estudiar el conjunto publicado;
aplicar cambios requiere un proyecto editable.

Referencias de operación: [caso de paletizado KUKA](https://www.kuka.com/en-ch/industries/solutions-database/2023/10/rupp-food-eberle-palettierroboter),
[soportes específicos de Schmalz](https://www.schmalz.com/en-in/support/know-how/vacuum-knowledge/innovative-expansion-option-layer-gripping-systems).
Las referencias de fabricante no convierten el esquema didáctico ni las
capacidades configuradas en especificaciones OEM.
