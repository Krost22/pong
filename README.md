<img width="1920" height="1080" alt="01-poster" src="https://github.com/user-attachments/assets/2c13f4db-8cd1-4517-a979-a9b9f569dfbd" />


# PONG

Pong clásico en blanco y negro pixelado, hecho solo con HTML, CSS y JavaScript.

**Jugar:** https://krost22.github.io/pong/

- 1 jugador contra la COM (la dificultad sube un 10% cada 3 goles) o 2 jugadores.
- Dos estilos:
  - **Clásico:** blanco y negro con pitidos, como el original.
  - **Moderno:** pixel art a color sobre una cancha de césped que reacciona al paso de la pelota, con estela, chispas, confeti y onda expansiva en los goles, y sonidos sintetizados nuevos. A alta velocidad la pelota se prende fuego. En este estilo, tras un gol el saque va hacia la cancha de quien anotó.

En el menú se juega de fondo una partida de demostración (COM contra COM) en el estilo elegido.

### Más del modo moderno

- **Ayuda al que pierde:** quien vaya 5 goles por detrás tiene la paleta un 50% más grande, con brillo dorado, hasta que empate.
- **Gol de fuego:** si la pelota entra en llamas, el gol es más dramático. La pantalla tiembla con fuerza, sale una doble onda de fuego y el césped de quien recibe el gol se quema durante unos segundos.
- **Pista de hielo:** el poder Congelado convierte la cancha en una pista de hockey sobre hielo (con disco incluido) durante 2 goles.

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
| Congelado | El rival no puede moverse durante 2 s y la cancha se vuelve de hielo durante 2 goles. |

## KrostNoid

Rompeladrillos al estilo Arkanoid, rápido y lleno de eventos. Tiene 5 niveles; al terminar el quinto vuelven a empezar, más rápidos y con ladrillos de plata más duros.

- **Ladrillos:** los de color se rompen de un golpe, los de **plata** necesitan dos y los de **oro** son indestructibles. Al empezar un nivel, los ladrillos caen desde arriba.
- **Bola:** se acelera un poco con cada rebote en la paleta.
- **Combos:** romper ladrillos seguidos sin tocar la paleta multiplica los puntos (x2 desde 5, x3 desde 10...).
- **Naves enemigas:** cruzan la pantalla de vez en cuando.
  - El **OVNI** siempre suelta una cápsula al destruirlo.
  - El **BOMBARDERO** lanza bombas que aturden tu paleta.
  - Las destruyes con la bola o con el láser.
- **Cápsulas:**
  - **E**xpandir: paleta más ancha.
  - **M**ultibola: tres bolas.
  - **L**áser: dispara solo.
  - **S** (lento): la bola va más despacio.
  - **V**ida extra.
  - **F**uego: la bola atraviesa los ladrillos.
  - E**X**plosiva: rompe también los ladrillos de alrededor.
  - **B**arrera: salva una bola.
- **Controles:** arrastra el dedo o usa ← / → para mover la paleta. Toca la pantalla o pulsa Espacio para lanzar la bola.
- Empiezas con 3 vidas y hay una tabla de récords.
## RogueLike (Rogue Pong)

Una *run* de Pong moderno contra la COM, en 3 pisos de 4 salas: **Césped**, **Hielo** (pista de hockey) y **Volcán** (lava). Las 3 primeras salas de cada piso las eliges entre 2 puertas; la cuarta es siempre el **jefe**.

- **Puertas:**
  - **Combate:** rival normal.
  - **Élite:** rival más duro, mejor premio.
  - **Tienda:** gastas tus monedas.
  - **Descanso:** te curas o entrenas.
- **Salas de combate:** superas la sala al marcar 3 goles (4 en élite). Los jefes tienen 5, 6 o 7 de vida.
- **Corazones:** cada gol que recibes cuesta 1 corazón. Empiezas con 5. Al llegar a 0 se acaba la run, y no se recuperan solos.
- **Rivales con rasgos:**
  - Muralla y Rayo: paleta grande y lenta, o pequeña y rápida.
  - Ilusionista: lanza bolas fantasma.
  - Escarcha: congela tu paleta.
  - Pirómano: la pelota arde casi siempre.
  - Acorazado: se pone un escudo.
- **Jefes:** EL MURO, REY DE HIELO y DRAGÓN. Con la mitad de vida se enfurecen.
- **Rivales:** cada piso tiene su propio diseño de paleta rival (madera, cristal de hielo u obsidiana) y cada jefe el suyo (muro de ladrillos, cristal con corona, dragón con escamas y cuernos).
- **Corazones:** al perder uno, explota. Si fue un gol de fuego, arde y se deshace en brasas.
- **Mejoras:** tras cada sala eliges 1 de 3 cartas (comunes, raras y legendarias) que se acumulan durante la run. Por ejemplo: Paleta larga, Golpe potente, Efecto, Vampiro, Espectro, Congelador, Segunda vida, Gol de oro, Freno, Titán…
- **Monedas:** se ganan con goles y salas, y se gastan en la tienda (cartas o curación).
- **Continuar:** la run se guarda en el dispositivo entre salas. Si sales al menú o cierras la app, CONTINUAR te devuelve al mapa.
- **Puntos de run:** goles×10 + salas×25 + jefes×100 + monedas. Tabla de récords propia.

## Versiones

La versión actual está en `version.js`. El menú la muestra y la APK la usa como `versionName`.
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
