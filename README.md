# NYC · Guía familiar

Web app estática para explorar el catálogo familiar de Nueva York, marcar intereses previos, obtener recomendaciones y construir un itinerario compartido.

## Probar localmente

La aplicación necesita servirse por HTTP para que el catálogo y el modo instalable funcionen. Se puede utilizar cualquier servidor estático.

## Conectar Google Sheets

Las instrucciones están en `apps-script/README.md`. Hasta configurar `apiUrl`, la aplicación utiliza `data/catalog.json` y conserva intereses e itinerario en el dispositivo.

## Actualizar la copia local del catálogo

Ejecuta:

```sh
node scripts/build-seed.mjs
```

## Publicar en GitHub Pages

1. Sube este directorio a la rama `main` de un repositorio de GitHub.
2. En **Settings → Pages**, selecciona **GitHub Actions** como origen.
3. El flujo `.github/workflows/pages.yml` publicará la web automáticamente.

## Estructura

- `index.html`, `styles.css`, `app.js`: aplicación.
- `data/catalog.json`: copia local de lectura y respaldo sin conexión.
- `apps-script/`: servicio que lee y escribe en Google Sheets.
- `config.js`: dirección del servicio y clave familiar.
- `sw.js`, `manifest.webmanifest`: instalación en la pantalla de inicio.
