# Compra: listas de la compra compartidas

Una lista por súper (Mercadona, Dia…), que se rellena entre los dos, un modo "Ir a comprar" con casillas
para ir marcando lo que metes al carro, y un historial con calendario.

## 1. Subirla a GitHub

Es una app distinta de la de medicación, así que va en un **repositorio nuevo**.

1. En github.com pulsa **New repository**, ponle un nombre (por ejemplo `compra`) y márcalo como **Public**.
2. Pulsa **uploading an existing file** y arrastra **todos los archivos** de la carpeta (index.html, app.js, styles.css,
   sw.js, manifest.json, config.js y las tres imágenes .png). Pulsa **Commit changes**.
3. **Settings → Pages**: en *Branch* elige `main` y carpeta `/ (root)`. Guarda.
4. En un par de minutos tendrás la dirección `https://TU-USUARIO.github.io/compra/`.

## 2. Instalarla en el móvil

- **iPhone**: abre la dirección en **Safari** → Compartir → **Añadir a pantalla de inicio**.
- **Android**: en **Chrome** → menú de tres puntos → **Instalar aplicación**.

Hacedlo en los dos móviles.

## 3. Compartir las listas (usa el mismo Firebase que la app de medicación)

No hay que crear ningún proyecto nuevo ni tocar las reglas de Firebase.

1. Abre en GitHub el repositorio de la app de medicación, entra en `config.js` y copia **todo su contenido**.
2. Abre el `config.js` de este repositorio nuevo, pulsa el lápiz, borra lo que hay, pega lo que has copiado
   y pulsa **Commit changes**.
3. Espera un minuto, cierra la app del todo y ábrela otra vez.
4. En **Ajustes → Compartir con tu pareja** pulsa **Crear código nuevo** en un móvil y escribe ese código
   en el otro con **Unirme con este código**.

Este código es distinto del de la app de medicación: cada app guarda sus datos por separado.
Quien tenga el código puede leer y editar las listas, así que no lo compartáis con nadie más.

## 4. Cómo se usa

- **Listas**: crea una por súper. Cada una tiene su color.
- **Añadir**: escribe el producto y pulsa Enter. Puedes poner varios a la vez separados por comas
  (`leche, pan, 2 huevos`). Un número delante se apunta como cantidad.
- **Ir a comprar**: pulsa el botón de abajo. Cada producto tiene una casilla grande; lo que marcas pasa a
  "En el carro". Si se te olvida algo, lo añades arriba sin salir. La pantalla no se apaga mientras compras.
- **Si el otro móvil mira la lista**, ve en directo lo que vas marcando.
- **Terminar compra**: pone la fecha de hoy y, si quieres, el precio. Lo que no has cogido se queda en la lista.
- **Historial**: calendario con puntos de color en los días que compraste, gasto del mes si apuntaste precios,
  y un botón para volver a añadir una compra antigua a la lista.

## 5. Actualizar y copias

Para actualizar, editad el archivo en GitHub y haced *Commit*. En Ajustes hay un botón para descargar una copia
de seguridad y otro para restaurarla (la restauración sustituye todo lo que haya, también lo compartido).
