# Tráiler e imágenes de marketing

Se graban desde el juego real con Chrome (sin ventana) y ffmpeg. Hace falta Node 22+ (usa `WebSocket` y `fetch` nativos), Google Chrome y ffmpeg en el PATH.

Desde la carpeta `Pong`:

```
node tools/marketing/record.mjs . tools/marketing marketing/trailer.mp4
node tools/marketing/stills.mjs . tools/marketing marketing
```

- **`trailer.html`:** las escenas del tráiler.
- **`marketing.html`:** las 5 imágenes.
- **Música:** chiptune que se sintetiza en `record.mjs`.
- **Resultados:** se guardan en `marketing/`, que no se sube al repositorio.
