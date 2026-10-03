# El Rey — Sistema de pedidos y administración

Prototipo web (sin backend) para el bar/restaurante **El Rey**: menú y pedidos para clientes, paneles para Mesero, Cantinero (bartender), Cocinera y Administrador. Todo corre en el navegador con React (vía CDN) y guarda los datos en `localStorage`.

## Archivos

- `index.html` — estructura de la página y referencias a los otros archivos.
- `style.css` — todos los estilos.
- `app.js` — toda la lógica de la aplicación (React, ya compilado a JavaScript plano, sin JSX).

## Cómo usarlo

### Opción 1: GitHub Pages (recomendado, gratis, sin instalar nada)

1. Sube estos 3 archivos a un repositorio de GitHub.
2. Ve a **Settings → Pages** en el repositorio.
3. En "Source", elige la rama `main` y la carpeta `/ (root)`.
4. Guarda. GitHub te dará un link como `https://tu-usuario.github.io/tu-repo/` — ábrelo y ya funciona.

### Opción 2: Abrir localmente

Como `app.js` ya está compilado (no depende de Babel en el navegador), puedes abrir `index.html` directamente con doble clic y debería funcionar. Si no, usa un servidor local sencillo:

```bash
python3 -m http.server
```

y abre `http://localhost:8000`.

## Notas

- No hay backend ni base de datos real: todo se guarda en el `localStorage` del navegador de cada persona. Si se abre en otro dispositivo o se borran los datos del navegador, la información no se comparte ni se conserva.
- Las cuentas de acceso (mesero, bartender, cocinera, admin) están precargadas en el código fuente — para cambiarlas hay que editar `app.js` (buscar `STAFF_SEED`) o pedir que se actualicen.
