# Punto de continuación · NYC Family Guide

Fecha de cierre: 2026-07-14

## Estado general

Estamos trabajando en una web app familiar para el viaje a Nueva York. La app se publica en GitHub Pages y lee/escribe datos desde Google Sheets mediante Apps Script.

La versión publicada todavía no incluye los últimos cambios visuales ni funcionales. Los cambios están preparados en local y se están revisando en:

`http://localhost:8000/`

## Enlaces importantes

- Web publicada: https://markituzzz.github.io/nyc-family-guide/
- Repositorio: https://github.com/Markituzzz/nyc-family-guide
- Google Sheet: https://docs.google.com/spreadsheets/d/1WaotDKkqltUQlrPKYuo7ZupEIKUF27tuklrGcSe4brM/edit
- Apps Script URL: https://script.google.com/macros/s/AKfycbx0KToGfL_jn_m14vLTuTuJe6ly5-VD_68gC60icu6ekRADkmHZOws_sgNaXTs3qvyQ/exec

## Decisiones fijadas

- Estética: metro NYC / urbana, pero limpia en móvil.
- Fondo: gris claro tipo asfalto, no beige.
- Paleta actual aprobada como base:
  - negro/asfalto como estructura
  - amarillo taxi como acento principal
  - azul acero, verde oxidado, naranja ladrillo y gris pizarra como colores secundarios
- Iconografía:
  - Gastronomía: 🍔
  - Compras: 🛍️
  - Cultura/iconos: 🏛️
  - Paseo/descubrir: 🚶
- Navegación superior: estilo líneas de metro.
- Las tarjetas del catálogo deben permitir decidir sin entrar siempre en la ficha.
- “Conviene saber” debe aparecer en la tarjeta, pero integrado, no como caja de alerta.
- En la tarjeta solo debe salir el campo `notes` como “Conviene saber”.
- No debe salir en tarjeta texto editorial tipo `whyItMatters`, `bestFor` o `ifCondition` si lo que buscamos es “Conviene saber”.

## Cambios locales preparados

Archivos modificados:

- `app.js`
- `styles.css`
- `index.html`
- `sw.js`
- `apps-script/Code.gs`

Resumen de cambios:

1. Look & feel
   - Fondo gris/asfalto.
   - Tarjetas más blancas.
   - Señalética tipo metro.
   - Bullets de línea por categoría.
   - Iconos reconocibles por tipo.
   - Paleta menos saturada.

2. Catálogo
   - Las tarjetas muestran `notes` como “Conviene saber”.
   - El bloque se limita visualmente a dos líneas.
   - Ya no se muestra la descripción editorial en la tarjeta del catálogo.

3. Fichas
   - Hero más visual, con estética metro.
   - Se mantienen los datos prácticos y comentarios familiares.

4. Añadir lugar
   - El formulario se amplió:
     - nombre
     - enlace Google Maps
     - tipo
     - zona/barrio
     - por qué lo propones
     - nota práctica opcional
   - Las propuestas familiares mantienen la etiqueta “Propuesto por la familia”.

5. Apps Script
   - `apps-script/Code.gs` se preparó para aceptar nuevos campos en `PropuestasFamilia`.
   - Añade automáticamente cabeceras faltantes para propuestas familiares.

6. Caché/PWA
   - `index.html` y `sw.js` se actualizaron con versión `20260714-7`.
   - Antes de publicar definitivamente quizá conviene subir a `20260714-8` si hacemos más cambios.

## Pendiente antes de publicar

1. Revisar en local la versión actual:

   ```bash
   cd /Users/marc/Documents/Codex/2026-07-12/qu
   python3 -m http.server 8000
   ```

   Abrir:

   ```text
   http://localhost:8000/?v=7
   ```

2. Pulir si hace falta:
   - separación de tarjetas en móvil
   - tamaño de iconos
   - tamaño del bloque “Conviene saber”
   - contraste de la paleta

3. Si se aprueba, publicar frontend:

   ```bash
   git add app.js styles.css index.html sw.js apps-script/Code.gs NEXT_SESSION.md
   git commit -m "Mejorar look metro NYC y tarjetas del catálogo"
   git push
   ```

4. Actualizar Apps Script manualmente:
   - Copiar el contenido de `apps-script/Code.gs`
   - Pegar en Google Apps Script
   - Guardar
   - Desplegar nueva versión

## Importante

Los últimos cambios todavía no están publicados en GitHub Pages. Si mañana la web pública no muestra nada nuevo, es normal.

Para ver lo último hay que usar la vista local o publicar los cambios.

## Próximo inicio recomendado

Empezar mañana con:

1. Abrir `http://localhost:8000/?v=7`
2. Revisar visualmente:
   - Catálogo
   - Decidir
   - Ficha de lugar
   - Añadir lugar
3. Decidir si publicamos o hacemos una última ronda de pulido.

