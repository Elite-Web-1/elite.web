# Elite.web — Portfolio

Sitio personal de **Mateo Benítez**, desarrollador web (Argentina). Single-page, vanilla HTML/CSS/JS, sin build step — se sirve tal cual.

URL del proyecto: portfolio para presentar trabajos a medida para emprendimientos, marcas personales y pymes.

---

## Cómo correrlo

### Opción 1 — Abrir directo desde el explorador
Doble click a `index.html`. Funciona, pero `file://` tiene algunas limitaciones (autoplay de audio más restrictivo, caché de videos menos predecible).

### Opción 2 — Servidor local (recomendado, sobre todo si vas a grabar)
```bash
# Python 3
python -m http.server 8000

# o Node
npx serve .
```
Después abrí `http://localhost:8000`.

No hay dependencias ni `package.json` — todo está embebido en el HTML/CSS/JS planos.

---

## Estructura

```
.
├── index.html          # Markup + estilos críticos inline
├── styles.css          # Estilos del intro cinemático (gate, video, rose)
├── app.js              # State machine del loader + cursor (spotlight/glitch/trail) + section indicator
├── assets/             # Logo (rose mp4), glitch pixel art mp4
├── img/                # Capturas de proyectos, logo PNG, og-image
└── uploads/            # Video de fondo del hero + video del intro cinemático
```

---

## Tour de las piezas

### 1. Loading screen cinemático
State machine en [`app.js`](app.js) con 5 fases (`waiting → loading → logo-hold → transitioning → hero`), reflejadas en `body[data-phase]` para que CSS reaccione sin JS extra.

- **waiting**: el usuario ve el gate "Hacé click para ingresar"
- **loading**: corre el video `uploads/Pantalla de carga 1.mp4`
- **logo-hold**: el rose (`assets/logo.mp4`) aparece con audio
- **transitioning**: el rose se "blinkea" a su posición lateral
- **hero**: el portfolio queda accesible, se desbloquea el scroll

Hay un safety fallback de 25s por si el evento `ended` del video nunca llega — **el contador arranca al clickear el gate**, no al cargar la página, para que no corte la animación si tardás en clickear (típico al configurar un screen recorder).

Atajos:
- Click en cualquier lado durante `loading` → skip al hero (con un guard de 600ms para evitar doble-click accidental)
- `prefers-reduced-motion: reduce` → salta directo al estado final, sin animaciones ni videos en autoplay

### 2. Sistema de cursor (solo desktop con hover)
Tres efectos coordinados, todos rAF-coalesced con un único listener de `mousemove`:

| Efecto | Qué hace |
|---|---|
| **Spotlight** (`#cursorSpotlight`) | Halo azul soft que sigue al cursor con `mix-blend-mode: screen` → ilumina el video de fondo |
| **Glitch** (`#cursorGlitch`) | Pixel art magenta que persigue al cursor con 540ms de delay + min-gap + jitter sub-pixel |
| **Trail sobre el texto** | Cada sample del cursor pinta un blob radial que vive 1.9s y va de azul puro → blue→magenta lerp → magenta fading. Se pinta vía `background-clip: text` en todos los `h1/h2/h3/p` del documento. Las coords del cursor se convierten a element-local por frame (no se usa `background-attachment: fixed` porque ancestros con `transform` rompen ese anclaje). |

Los tiempos del trail están alineados con `GLITCH_DELAY`: el magenta puro arranca exactamente cuando el glitch llega a la posición del sample, así las letras debajo del glitch son siempre magenta (no quedan azules con el magenta brotando 300ms más tarde).

### 3. Performance
- `content-visibility: auto` + `contain-intrinsic-size` en secciones no-hero → el browser skipea paint/layout de lo que está fuera de viewport
- AABB cull doble en el trail (descarta elementos fuera del bounding box del trail antes de calcular blobs por letra)
- Videos de fondo se pausan en `visibilitychange` (tab oculta) — fondo del hero, logo rose y glitch
- El logo rose se pausa también una vez que scrolleás más allá del hero
- Listeners de scroll rAF-coalesced
- Trail renderer detiene su rAF loop cuando el array de samples se vacía (cursor quieto = 0 CPU)

### 4. Indicador lateral de sección
6 puntos al borde derecho (uno por sección 01..06). El activo se ilumina azul con halo, hover muestra el label en font-mono. JS scroll-driven elige la sección cuyo midpoint está más cerca del 40% del viewport. Hidden en móvil.

### 5. Paleta accent
CSS vars que matchean el cursor:
```css
--accent-blue:    #2196f3;
--accent-magenta: #e040fb;
--accent-grad:    linear-gradient(135deg, #2196f3 0%, #e040fb 100%);
```
Se usan en focus rings, separadores, status pill, números de sección (con `background-clip: text`), hovers de cards y botones, indicador lateral, ring del WhatsApp float, y `::selection`. Intensidad sutil (alpha 0.05-0.45) para mantener el dark mode como protagonista.

---

## Reseñas y formularios
La página tiene un sistema de reseñas con estrellas + nombre + mensaje. Al enviar, abre **WhatsApp** con el mensaje pre-cargado al número configurado en `WHATSAPP_NUMBER` (en el script inline del index). No hay backend.

---

## Notas técnicas
- **Tipografías**: Geist, Geist Mono, Instrument Serif (display), Cormorant Garamond (notas en cursiva). Cargadas desde Google Fonts.
- **Sin build**: edita los archivos y refrescá. No hay bundler, transpilador ni dependencias npm.
- **Compatibilidad**: pensado para evergreen browsers desktop + mobile. En `(any-hover: none)` se desactivan los efectos de cursor; en `prefers-reduced-motion: reduce` se desactivan animaciones y autoplay.

---

## Licencia / atribución
Código propio. Las capturas en `img/` son de proyectos reales (Zuca, PeluTere, ArquiNueva, Avenue).

Contacto: [benitez.mateo.trabajo@gmail.com](mailto:benitez.mateo.trabajo@gmail.com) — [WhatsApp](https://wa.me/5491160172754)
