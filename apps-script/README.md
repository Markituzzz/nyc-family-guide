# Conexión con Google Sheets

1. Abre la hoja de Google Sheets.
2. Entra en **Extensiones → Apps Script**.
3. Sustituye el contenido de `Code.gs` por el de este directorio.
4. Abre **Configuración del proyecto → Propiedades de la secuencia de comandos**.
5. Añade `FAMILY_KEY` con una frase larga que solo conozca la familia.
6. Pulsa **Implementar → Nueva implementación → Aplicación web**.
7. Selecciona **Ejecutar como: yo** y **Quién tiene acceso: cualquier usuario**.
8. Copia la URL terminada en `/exec`.
9. Pégala como `apiUrl` en `config.js` y copia el mismo valor de `FAMILY_KEY` en `familyKey`.

La clave familiar evita escrituras casuales, pero no es una contraseña secreta: forma parte del código público de la web. No se debe guardar información sensible en estas hojas.

La hoja `Comentarios` se crea automáticamente la primera vez que la aplicación solicita el catálogo tras desplegar esta versión.
