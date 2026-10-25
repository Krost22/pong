# PONG

Pong clásico en blanco y negro pixelado, hecho solo con HTML, CSS y JavaScript.

**Jugar:** https://krost22.github.io/pong/

- 1 jugador contra la COM (la dificultad sube un 10% cada 3 goles) o 2 jugadores.
- Dos estilos:
  - **Clásico:** blanco y negro con pitidos, como el original.
  - **Moderno:** pixel art a color sobre una cancha de césped que reacciona al paso de la pelota, con estela, chispas, confeti y onda expansiva en los goles, y sonidos sintetizados nuevos. A alta velocidad la pelota se prende fuego. En este estilo, tras un gol el saque va hacia la cancha de quien anotó.

## Power-ups (modo moderno)

En la línea central aparecen regalos al azar. El poder se lo lleva quien lanzó la pelota que abre el regalo.

| Poder | Efecto |
|---|---|
| Fantasmas | Dos bolas fantasma azules para distraer (también engañan a la COM). No marcan y desaparecen al cruzar la línea de meta. |
| Pase lento | El siguiente golpe del rival sale muy lento, solo durante un rebote. |
| Gigante | Tu paleta mide el doble durante 10 s. |
| Globos | La cancha se llena de globos: la pelota rebota en ellos y explotan. |
| Escudo | Una barrera en tu línea de gol que te salva de un gol (15 s). |
| Mini rival | La paleta del rival mide la mitad durante 8 s. |
| Congelado | El rival no puede moverse durante 2 s. |
- Gana el primero en llegar a 11.
- Se adapta a pantallas verticales y horizontales.

## Controles

| | Teclado | Táctil |
|---|---|---|
| Jugador 1 | W / S (contra la COM también ↑ / ↓) | Arrastra en la mitad izquierda (horizontal) o inferior (vertical) |
| Jugador 2 | ↑ / ↓ | Arrastra en la mitad derecha (horizontal) o superior (vertical) |
| Pausa | P, Esc o Espacio | Botón **II** |
| Juego nuevo | N | Menú de pausa |
| Sonido | M | — |

Contra la COM, tocar en cualquier parte de la pantalla mueve al jugador 1.

## APK de Android

`android/` contiene una app mínima que muestra el juego en un WebView. Para compilarla:

```
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
```

El script usa el Android SDK y el JDK que trae el módulo Android de Unity, o los definidos en `ANDROID_HOME` / `JAVA_HOME`.
