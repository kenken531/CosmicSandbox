# Cosmic Playground

A browser-based N-body gravitational simulator. Drag stars, planets, and exotic objects onto a canvas, set their velocities with an interactive arrow, and watch them interact under Newtonian gravity in real time. No installation. No build step. Open `index.html` via any local HTTP server.

![Cosmic Playground screenshot placeholder](docs/screenshot.png)

---

## Quick Start

```bash
# Clone or unzip the project, then serve it over HTTP:
python -m http.server 8080
# Open http://localhost:8080 in Chrome or Firefox
```

> **Why HTTP?** The project uses ES Modules (`type="module"`). Browsers block module imports over `file://` URLs for security. Any local HTTP server works — Python, Node's `http-server`, VS Code Live Server, etc.

### Direct URL launch

Load a preset directly from the URL:

```
http://localhost:8080/?scene=solar-system
http://localhost:8080/?scene=black-hole-flyby
http://localhost:8080/?scene=figure8
```

A full list of scene IDs is in the [Presets](#presets) section.

---

## Controls

### Mouse

| Action | Effect |
|---|---|
| **Drag** body palette item → canvas | Place a new body |
| **Click** a body | Select it (opens properties panel) |
| **Drag** from a body | Draw a velocity arrow — set speed and direction |
| **Alt + Drag** from a body | Reposition the body |
| **Drag** empty space | Pan the camera |
| **Middle-click + drag** | Pan the camera |
| **Scroll wheel** | Zoom in / out (centered on cursor) |
| **Right-click** | Suppressed (no context menu) |

**Note:** The properties panel only opens on a clean click (mouseup with no drag). Dragging a velocity arrow will never accidentally open the panel.

### Keyboard

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `R` | Re-fit camera to show all bodies |
| `P` | Open / close Presets modal |
| `T` | Clear all permanent trails |
| `C` | Clear all bodies (asks confirmation) |
| `Delete` / `Backspace` | Delete selected body |
| `Escape` | Close modal / deselect body |
| `Ctrl+S` | Save scene as JSON |

### Touch (mobile)

| Gesture | Effect |
|---|---|
| Tap a body | Select it |
| Drag from a body | Draw velocity arrow |
| Drag empty space | Pan |
| Two-finger pinch | Zoom |
| Tap palette icon | Place body at canvas center |

---

## Interface Layout

```
┌──────────────── Topbar ─────────────────────────────────┐
│ Logo  [▶ Play] [Speed ──●──] [Fit] [Clear] [⚙ Settings] │
└─────────────────────────────────────────────────────────┘
┌───────┐ ┌──────────────────────────────┐ ┌──────────────┐
│       │ │                              │ │              │
│ Body  │ │          Canvas              │ │  Properties  │
│Palette│ │      (main simulation)       │ │    Panel     │
│       │ │                              │ │  (opens on   │
│ Star  │ │                              │ │  body click) │
│Planet │ │                              │ │              │
│  BH   │ └──────────────────────────────┘ └──────────────┘
│  NS   │          ┌──────────┐
│Pulsar │          │ Minimap  │ ← overview + scale bar
│ Comet │          └──────────┘
└───────┘
         ┌──────────────────────────────────────────────┐
         │  HUD: bodies · fps · sim time · KE · TE · Δ% │
         └──────────────────────────────────────────────┘
```

### Body Palette (left sidebar)

Drag any icon onto the canvas to place that body type. On mobile, tap to place at canvas center.

### Properties Panel (right, opens on selection)

Shows and allows editing of:
- **Name** — editable text label
- **Mass** — in solar masses (stars/BH/NS) or Earth masses (planets/comets)
- **Radius** — display radius in AU
- **Color** — hex color picker
- **Speed** — current speed in km/s
- **Direction** — current velocity direction in degrees, with a drag-dial for adjustment
- **Live stats** — position (AU), distance from origin, acceleration, KE

### HUD (bottom bar)

| Field | Description |
|---|---|
| Bodies | Current body count |
| FPS | Frames per second |
| Sim Time | Elapsed simulation time (days / years / kiloyears) |
| KE | Kinetic energy (smoothed) |
| TE | Total mechanical energy (smoothed) |
| Drift % | Energy conservation error since last reset (green < 0.1%, yellow < 1%, red ≥ 1%) |

Energy values use an exponential moving average (α = 0.05) to prevent unreadable flickering.

### Settings Panel (⚙ button)

| Setting | Description |
|---|---|
| **Gravitational constant G** | Slider multiplier on canonical G (0.01× – 5×). Weaken or strengthen gravity. |
| **Softening ε** | Minimum separation in force denominator (AU). Prevents singularities. Default: 0.05 AU. |
| **Trail length** | Points in the live ring-buffer trail per body (50 – 2000). |
| **Collision mode** | `merge` (default) or `passthrough`. In passthrough, bodies pass through each other. |
| **Reset energy baseline** | Re-anchors drift % to current state. Use after manual edits. |

### Minimap (bottom-right corner)

Shows all body positions and orbital trails at a global scale. The blue rectangle shows the current viewport. A **scale bar** above the viewport rectangle auto-selects the best round number (0.1, 0.5, 1, 2, 5 AU…) that fits the minimap's current scale.

---

## Velocity Arrow

When you **drag** from any body, a velocity arrow appears:

- The arrow's **length and direction** map directly to velocity.
- At default zoom (40 px/AU), a 100 px drag produces ≈ 6.25 AU/yr ≈ 30 km/s — approximately Earth's orbital speed. The feel is intentionally calibrated so a comfortable drag gets you to a real orbit.
- A **dashed predicted path** trace is drawn in real time, forward-integrating ~300 steps using only the dominant attractor. It shows where the body will go if released now.
  - Blue trace = bound elliptic orbit
  - Red trace = hyperbolic / escape trajectory
  - Green trace = circular or near-circular orbit
- An **orbit preview ring** around the dominant attractor shows what radius the current speed corresponds to for a circular orbit, color-coded the same way.
- An orbit-type label (`ELLIPTIC`, `CIRCULAR`, `SUPER-CIRC`, `HYPERBOLIC`) appears near the ring.

### Circular Orbit Snap

When the arrow speed is within **5% of the circular orbit velocity** for the dominant attractor, the velocity snaps to exactly circular:
- The direction snaps perpendicular to the radius vector (prograde or retrograde, whichever matches your drag direction).
- The speed snaps to exactly `√(GM/r)`.
- The arrow turns **bright green** and a **⊙ CIRCULAR LOCK** label appears.

This makes it trivial to place a planet in a stable orbit.

---

## Body Types

| Type | Default Mass | Collision Radius | Visual |
|---|---|---|---|
| **Star** | 1,989,000 units (1 M☉) | 0.08 AU | Radial gradient with temperature glow halos |
| **Planet** | 6 units (1 M⊕) | 0.015 AU | Sphere with surface bands, terminator shadow, spaghettification stretch |
| **Black Hole** | 19,890,000 units (10 M☉) | 0.04 AU | Black disc, animated accretion disk (two counter-rotating ellipses), photon sphere ring |
| **Neutron Star** | 2,785,000 units (1.4 M☉) | 0.02 AU | Bright white-blue core, equatorial bulge ring, spin animation |
| **Pulsar** | 2,785,000 units (1.4 M☉) | 0.02 AU | Same as neutron star + two sweeping beam jets |
| **Comet** | 0.0001 units | 0.008 AU | Nucleus + coma halo that grows near massive bodies |

### Special Effects

- **Spaghettification**: Planets near a black hole stretch visually along the tidal axis. Intensity is `clamp(1 - (r - r_tidal) / (r_tidal × 2), 0, 1)`.
- **Comet coma**: Intensity = `clamp((3 - d_nearest_massive) / 2.5, 0, 1)`. Full coma inside 0.5 AU.
- **Pulsar beams**: Sweep at `4.5 deg/frame`. The beam length is `9 × screen_radius`.
- **Black hole disk**: Two accretion disk ellipses rotate at `0.02 rad/frame` and `0.014 rad/frame`.

### Collision Merging

When two bodies' `physicsRadius` values overlap:
- Momentum is conserved: `v_new = (m₁v₁ + m₂v₂) / (m₁ + m₂)`
- Radius is volume-conserved: `r_new = ∛(r₁³ + r₂³)`
- Color blends weighted by victim mass fraction
- Type hierarchy: `blackhole > neutronstar/pulsar > star > planet/comet`
- A collision flash, two shockwave rings, debris particles, and a floating `✦ MERGE` label are spawned

**Note:** `physicsRadius` (collision) and `radius` (display) are intentionally separate. A star's display radius of 0.25 AU would cause instant merges at orbital distances; its collision radius is only 0.08 AU.

---

## Presets

Load via the **P** key or the Presets button. All 12 presets can also be loaded via URL `?scene=<id>`.

| Name | ID | Bodies | Description |
|---|---|---|---|
| Solar System | `solar-system` | 4 | Sun + Earth + Mars + Jupiter in stable circular orbits |
| Binary Stars | `binary-stars` | 2 | Two equal stars in mutual circular orbit |
| Chaotic Three-Body | `three-body` | 3 | Equilateral triangle — begins periodic, becomes chaotic |
| Figure-8 Orbit | `figure8` | 3 | Chenciner–Montgomery choreography (2000) |
| Planet + Moon | `planet-moon` | 3 | Gas giant with moon, both orbiting a star |
| Gravity Slingshot | `slingshot` | 2 | Hyperbolic flyby — gravitational assist |
| Galactic Collision | `galactic-collision` | 14 | Two star clusters on collision course |
| Rogue Planet | `rogue-planet` | 4 | Interloper disrupts a solar system |
| Black Hole Flyby | `black-hole-flyby` | 4 | 10 M☉ black hole on hyperbolic trajectory |
| Pulsar System | `pulsar-system` | 3 | Two planets orbiting a millisecond pulsar |
| Comet Storm | `comet-storm` | 6 | Five comets on bound elliptic orbits around a star |
| Neutron Star Binary | `neutron-binary` | 2 | Two neutron stars in mutual orbit |

All preset velocities satisfy the vis-viva equation `v = √(GM(2/r − 1/a))` using `G = 1.9855×10⁻⁵`.

---

## Save / Load

- **Ctrl+S** or the Save button: downloads `cosmic-scene.json`
- **Load button**: opens a file picker; accepts `.json` files previously saved from this app
- Saved format (version 2):

```json
{
  "version": 2,
  "simTime": 3.14,
  "camera": { "x": 0, "y": 0, "zoom": 40 },
  "bodies": [
    {
      "type": "star", "x": 0, "y": 0, "vx": 0, "vy": 0,
      "mass": 1989000, "radius": 0.25, "physicsRadius": 0.08,
      "color": "#FFD060", "name": "Sol"
    }
  ]
}
```

---

## Physics Engine

### Unit System

All simulation math uses a consistent unit system defined in `js/bodies/Body.js` (`SIM` object — single source of truth). **Never hardcode raw SI values.**

| Quantity | Unit | SI Equivalent |
|---|---|---|
| Distance | AU | 1 AU = 1.496 × 10¹¹ m |
| Mass | 1e24 kg | Earth = 6, Sun = 1,989,000 |
| Time | year | 1 yr = 3.156 × 10⁷ s |
| Velocity | AU/yr | **1 AU/yr = 4.740 km/s** |
| G | AU³ yr⁻² (1e24 kg)⁻¹ | **1.9855 × 10⁻⁵** |

**Sanity check:** `v_Earth = √(G × M_Sun / 1 AU) = √(1.9855e-5 × 1,989,000) = 6.284 AU/yr = 29.79 km/s` ✓

### Integrator — Velocity Verlet

Each frame, for each body:

```
1.  x(t+dt) = x + v·dt + ½·a·dt²        (position update using old acceleration)
2.  a(t+dt) = Σ G·mⱼ·(rⱼ-rᵢ) / |r|³    (recompute pairwise forces at new positions)
3.  v(t+dt) = v + ½·(a_old + a_new)·dt   (velocity update using average acceleration)
```

Velocity Verlet is symplectic — it conserves energy much better than Euler over long runs. The energy drift display in the HUD directly measures this: green (< 0.1%) means the integrator is behaving well.

### Gravitational Force

```
F_ij = G · mᵢ · mⱼ · (rⱼ - rᵢ) / (|r|² + ε²)^(3/2)
```

The softening parameter `ε = 0.05 AU` prevents the force from diverging when bodies get very close. It is small enough to be negligible at typical orbital separations (≥ 0.5 AU) but avoids unphysical velocity spikes at close range.

### Adaptive Micro-Stepping

Two conditions trigger sub-dividing `dt` within a single frame:

1. **Close approach**: when the nearest pair is within `4ε = 0.2 AU`, steps are split by `ceil(0.2 / max(dist, 0.001))`
2. **High simulation speed**: `speedSubsteps = ceil(timeScale / 2)` ensures `dt_effective ≤ baseDt × 2 = 0.033 yr` regardless of the speed slider

Both are combined: `microSteps = max(closeSubsteps, speedSubsteps)`, capped at 200 to prevent frame stalls. Trail recording only happens on the final micro-step to keep trail density constant.

### Dirty Flag

`physics.markDirty()` **must** be called after any external change to body positions or velocities (drag-reposition, preset load, vel-arrow commit, clear). On the next step it recomputes accelerations from scratch before the first Verlet advance. Skipping this causes a velocity kick from stale `ax = ay = 0`.

This is called automatically by all paths in `ui.js` that mutate body state.

### Energy Tracking

KE + PE are computed every step:

```
KE = Σ ½ mᵢ |vᵢ|²
PE = -Σᵢ<ⱼ G mᵢ mⱼ / √(|rᵢ - rⱼ|² + ε²)
```

`energyDrift = (E_now - E_init) / |E_init| × 100%`

The baseline `E_init` resets after collisions or `markDirty()` calls. The HUD shows the EMA-smoothed drift so it's readable.

---

## Rendering Pipeline

Each frame in order (`renderer.js`):

1. **Starfield blit** — static offscreen canvas (nebula wisps + three star-size classes with color temperatures), rebuilt only on resize
2. **Permanent trails** — full orbit history (opacity 0.18, line 0.8px)
3. **Live trails** — ring-buffer trail split into 4 opacity bands (newest = brightest), with jump-detection to break paths at ring-buffer wrap points (prevents the "diagonal teleport line" artifact)
4. **Glow halos** — per-body radial gradient layers (different intensity profiles per type)
5. **Bodies** — type-specific draw methods (star, planet, blackhole, neutronstar, pulsar, comet)
6. **Velocity arrow overlay** — only when dragging; includes predicted path trace, orbit ring, orbit-type label, snap indicator
7. **Effects** — collision flashes, shockwave rings, debris particles, floating labels (drawn by `effects.js`, world-space positions converted to screen each frame)

### Trail Jump Detection

The live trail is a ring buffer of 500 points. When it wraps, consecutive points can be far apart in world space (the oldest point gets overwritten by a new position elsewhere on the orbit). Without correction, this produces a bright diagonal line across the canvas. The fix: if two consecutive trail world-points are more than 2 AU apart, the canvas path is committed and restarted.

---

## Architecture

```
index.html
└── js/main.js          Game loop (requestAnimationFrame), wires all modules
    ├── js/camera.js    World↔screen transforms, pan, zoom, fitBodies
    ├── js/physics.js   Velocity Verlet integrator, collision detection, energy
    ├── js/renderer.js  Canvas draw pipeline (imports SIM from Body.js)
    ├── js/minimap.js   Overview canvas, scale bar
    ├── js/effects.js   Collision particles, shockwaves, floating labels
    ├── js/ui.js        All DOM events, drag state machine, props panel, HUD
    │   └── js/presets.js   12 built-in scenario definitions (pure data)
    └── js/bodies/Body.js   Body class + SIM constants (single source of truth)
```

Pure vanilla JS, ES Modules. No framework, no bundler, no dependencies. Google Fonts (Orbitron + Space Mono) from CDN.

### Drag State Machine (`ui.js`)

A single `_dragMode` string — never two flags simultaneously:

| Mode | Trigger | Effect |
|---|---|---|
| `none` | Default | — |
| `pending-body` | Mousedown on a body | Waits for 8 px movement threshold |
| `vel` | >8 px drag from body (no Alt) | Draws velocity arrow |
| `body` | >8 px drag from body + Alt | Repositions body in world space |
| `pan` | Mousedown on empty space or middle-click | Pans camera |

Props panel opens **only on mouseup** after a pure click (`pending-body` → no drag). This ensures dragging a velocity arrow never accidentally opens the panel and shifts the canvas.

---

## Performance

| Bodies | Expected FPS | Notes |
|---|---|---|
| 1–20 | 60 fps | No issues |
| 20–80 | 55–60 fps | Trail rendering starts to matter |
| 80–120 | 40–55 fps | O(n²) force loop becomes visible |
| 120+ | < 40 fps | Barnes-Hut would be needed |

**Bottlenecks:**
- Force computation: O(n²) pairwise loop in `physics._computeAccel()`
- Trail rendering: O(bodies × trail_length) `lineTo` calls per frame — the minimap applies LOD (max 80 segments per body regardless of trail length)

**Not yet implemented:** Barnes-Hut tree (O(n log n)), OffscreenCanvas for trails, WebGL renderer.

---

## Deployment

No build step required. Works on any static host:

```bash
# GitHub Pages: push repo root, enable Pages on main branch
# Netlify / Vercel: drag-drop the project folder
# Local: python -m http.server 8080
```

The only constraint: files must be served over HTTP (not `file://`) due to ES Module CORS restrictions.

---

## Known Limitations

- **Mobile layout** is functional but not fully optimized for very small screens (< 400px)
- **No URL-based scene sharing** — save/load works locally (JSON download/upload) but there is no server-side storage
- **No Barnes-Hut** — force computation is O(n²); past ~80–100 bodies at 60 fps on modern hardware, fps drops
- **No WebGL** — Canvas 2D only; glow and trail rendering is CPU-bound at high body counts
- **Touch drag-to-place** from palette is not implemented — tap-to-center is the mobile alternative

---

## Common Pitfalls for Contributors

1. **Never auto-fit on every body placement.** `fitBodies()` only fires when `bodies.length === 1`. Re-fitting on every drop causes jarring zoom jumps. This was a fixed bug — do not revert.

2. **Always call `physics.markDirty()`** after any external change to body positions or velocities (drag, preset load, clear, vel-arrow commit). Without it, the first Verlet step uses stale zero accelerations and imparts a velocity kick.

3. **`physicsRadius` ≠ `radius`.** These are intentionally separate. `radius` can be 0.25 AU for a star visually; `physicsRadius` must be 0.08 AU so Earth at 1 AU is not inside the collision zone.

4. **`SIM.velUnit = 4.740`**, not 29.78. The value 29.78 km/s is Earth's speed, not the unit conversion factor. `1 AU/yr = 4.740 km/s`.

5. **`SIM.G = 1.9855e-5`** is the canonical value in `Body.js`. Never hardcode a different value anywhere — including in `presets.js` IIFEs or inline calculations.

6. **Canvas resize must be triggered when props panel opens/closes.** The panel shifts the canvas container width via CSS. `renderer.resize()` is called via `requestAnimationFrame` in `_openPropsPanel()` and `_closePropsPanel()` to keep `canvas.width` in sync. Without this, `camera.worldToScreen()` uses the wrong canvas center and body drops land in the wrong place.

7. **SENSITIVITY = 2.5 must match in both `ui.js` and `renderer.js`.** This constant converts `(screen_pixels / zoom)` → `AU/yr` for the velocity arrow. If they differ, the speed label shown during drag will not match the velocity that actually gets committed.

8. **Trail jump threshold = 2 AU (squared: 4.0).** This is the world-space distance above which the renderer breaks the trail path to prevent wrap artifacts. If you change `trailMaxLen` substantially, reconsider this threshold.

---

## File Reference

| File | Lines | Purpose |
|---|---|---|
| `index.html` | — | Full UI shell: topbar, sidebar, canvas, props panel, modals |
| `style.css` | — | Dark space theme, CSS variables, responsive layout (≤ 800px, ≤ 480px) |
| `js/main.js` | 182 | `requestAnimationFrame` game loop, substep scheduling, URL param handling |
| `js/camera.js` | 74 | `worldToScreen`, `screenToWorld`, `zoomAt`, `fitBodies` |
| `js/physics.js` | 287 | Velocity Verlet, softened gravity, adaptive micro-stepping, collision merging, energy |
| `js/renderer.js` | 721 | Full canvas draw pipeline: starfield, trails, glows, body types, vel arrow |
| `js/minimap.js` | 125 | Overview canvas with LOD trails, viewport rect, scale bar |
| `js/effects.js` | 172 | Collision flash, shockwave rings, debris particles, floating text labels |
| `js/ui.js` | 936 | DOM events, drag state machine, props panel, HUD, keyboard shortcuts, touch |
| `js/presets.js` | 205 | 12 scenario definitions (pure data) |
| `js/bodies/Body.js` | 123 | `Body` class, `SIM` constants, trail ring buffer, `toJSON` / `fromJSON` |
