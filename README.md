# Cosmic Sandbox

A browser-based N-body gravitational simulator. Place stars, planets, black holes, neutron stars, pulsars, and comets on a canvas. Set their velocities with an interactive drag arrow, watch orbits form in real time, and see what happens when things collide.

No installation. No build step. Open `index.html` via any local HTTP server.

---

## Quick Start

```bash
# Any of these work:
python -m http.server 8080
npx serve .
# Then open http://localhost:8080
```

> **Why HTTP?** The project uses ES Modules (`type="module"`). Browsers block module imports over `file://` for security reasons. Any local HTTP server works — Python, Node's `serve`, VS Code Live Server, etc.

### Load a preset directly from the URL

```
http://localhost:8080/?scene=solar-system
http://localhost:8080/?scene=black-hole-flyby
http://localhost:8080/?scene=figure8
```

All 12 scene IDs are listed in the [Presets](#presets) section.

---

## Controls

### Mouse

| Action | Effect |
|---|---|
| **Drag** body palette icon → canvas | Place a new body |
| **Click** a body | Select it (opens properties panel) |
| **Drag** from a body, then **release** | Set velocity — release commits the orbit |
| **Alt + drag** from a body | Reposition the body |
| **Drag** empty space | Pan the camera |
| **Middle-click + drag** | Pan the camera |
| **Scroll wheel** | Zoom in / out, centred on cursor |

### Keyboard

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `R` | Re-fit camera to show all bodies |
| `P` | Open / close Presets modal |
| `T` | Clear all permanent trails |
| `C` | Clear all bodies (asks for confirmation) |
| `Delete` / `Backspace` | Delete the selected body |
| `Escape` | Close modal / deselect |
| `Ctrl + S` | Save scene as JSON |

### Touch (mobile)

| Gesture | Effect |
|---|---|
| Tap a body | Select it |
| Drag from a body, release | Set velocity arrow |
| Drag empty space | Pan |
| Two-finger pinch | Zoom |
| Tap a palette icon | Place body at canvas centre |

---

## Interface

```
┌──────────────────────── Topbar ────────────────────────────────┐
│ ◈ COSMIC SANDBOX  [▶ Play] [Speed ──●──] [Fit] [Clear] [⚙]    │
└────────────────────────────────────────────────────────────────┘
┌─────────┐  ┌──────────────────────────────┐  ┌───────────────┐
│         │  │                              │  │               │
│  Body   │  │         Main Canvas          │  │  Properties   │
│ Palette │  │      (simulation view)       │  │    Panel      │
│         │  │                              │  │               │
│  Star   │  │                              │  │ (opens when   │
│ Planet  │  │                              │  │  body is      │
│   BH    │  └──────────────────────────────┘  │  clicked)     │
│   NS    │                 ┌──────────┐        └───────────────┘
│ Pulsar  │                 │ Minimap  │ ← scale bar + viewport rect
│  Comet  │                 └──────────┘
└─────────┘
┌─────────────────────────────────────────────────────────────────┐
│  HUD:  bodies · fps · sim time · KE · TE · drift %              │
└─────────────────────────────────────────────────────────────────┘
```

### Body Palette

Drag any icon onto the canvas to place that body type. On mobile, tap to place at canvas centre. Hovering a body on the canvas changes the cursor to a grab hand — this hints that you can drag to set an orbit. Clicking selects the body.

### Properties Panel

Opens on a clean click (never during a velocity-arrow drag). Shows and allows editing of:

- **Name** — editable text label
- **Mass** — solar masses for stars / BH / NS; Earth masses for planets / comets
- **Size** — display radius in AU (0.01 – 50)
- **Colour** — colour picker + hex readout
- **Speed** — current speed in km/s (live, read-only)
- **Direction** — current velocity heading in degrees, with a drag-to-rotate dial
- **Density** — live `mass / radius³` readout in SI-prefixed units
- **Class Check** — predicted reclassification in real time. Amber `→ Neutron Star` means the current parameters would reclassify on commit. Hovering shows the exact radius threshold needed

Reclassification fires when you tab out of or press Enter in the mass or radius field. The body type, name, radius, and renderer all update automatically. A slide-up toast describes the transition.

### HUD

| Field | Description |
|---|---|
| Bodies | Current body count |
| FPS | Frames per second |
| Sim Time | Elapsed simulation time (days / years / kiloyears) |
| KE | Kinetic energy, EMA-smoothed (α = 0.05, ~20-frame lag) |
| TE | Total mechanical energy, smoothed |
| Drift % | Energy conservation error since last baseline reset (green < 0.1%, yellow < 1%, red ≥ 1%) |

### Settings Panel (⚙)

All controls sync from live physics state each time the panel opens — displayed values are never stale.

| Setting | Description |
|---|---|
| **G multiplier** | Scale gravitational constant by 0.01× – 5× |
| **Softening ε** | Force softening radius in AU. Default 0.05 AU — negligible at ≥ 0.5 AU separations, prevents singularities at close range |
| **Trail length** | Points in the live ring-buffer trail per body (50 – 2000) |
| **Collision mode** | `merge` — bodies merge on contact; `passthrough` — bodies pass through each other |
| **Reset energy baseline** | Re-anchors drift % to current state |
| **Substeps/Frame** | Live micro-step count. Amber ≥ 20, red ≥ 100 with `⚠` |

### Minimap

Bottom-right corner overview. The blue rectangle is the current viewport. A **scale bar** above the rectangle auto-selects the cleanest round number (0.1, 0.5, 1, 2, 5 AU…) for the current zoom. Trails are drawn at reduced density (max 80 segments per body) to keep the minimap responsive.

---

## Velocity Arrow

Drag from any body to set its velocity, then release to commit:

- Arrow **length and direction** map directly to speed and heading
- At default zoom (40 px/AU), a 100 px drag ≈ 6.25 AU/yr ≈ 29.6 km/s — roughly Earth's orbital speed
- **Release commits.** Releasing within 5 px of the body discards the arrow
- A **dashed predicted path** forward-integrates ~500 steps with Velocity Verlet against the dominant attractor
  - Blue = bound elliptic orbit
  - Red = hyperbolic / escape trajectory  
  - Green = circular or snapped to circular
- An **orbit preview ring** around the dominant attractor marks the circular orbit radius for the current speed

### Circular Orbit Snap

When arrow speed is within 5% of circular velocity `√(GM/r)` for the dominant attractor:

- Velocity snaps to exactly `√(GM/r)`, direction perpendicular to radius (prograde or retrograde per drag direction)
- Arrow turns bright green, `⊙ CIRCULAR LOCK` label appears
- Predicted trace turns green

The snap uses the live G from Settings, so it remains correct if you have changed the G multiplier.

---

## Body Types

| Type | Default Mass | Collision Radius | Visual |
|---|---|---|---|
| **Star** | 1 M☉ (1,989,000 units) | 0.08 AU | Radial gradient, multi-layer glow halos |
| **Planet** | 1 M⊕ (6 units) | 0.015 AU | Surface bands, terminator shadow, spaghettification stretch |
| **Black Hole** | 10 M☉ | 0.04 AU | Black disc, animated dual accretion disk, photon sphere ring |
| **Neutron Star** | 1.4 M☉ | 0.02 AU | Bright white-blue core, equatorial bulge, spin animation |
| **Pulsar** | 1.4 M☉ | 0.02 AU | Neutron star + two sweeping radiation beam jets |
| **Comet** | ~10⁻⁷ M⊕ | 0.008 AU | Nucleus + coma halo that grows within 3 AU of any massive body |

### Special Visual Effects

**Spaghettification** — planets near a black hole stretch along the tidal axis. Intensity `= clamp(1 − (r − r_tidal) / (2·r_tidal), 0, 1)` where `r_tidal = physicsRadius × (M_BH/M_body)^(1/3)`.

**Pulsar beams** — two jets sweep at 4.5°/frame. Beam length scales with screen radius.

**BH accretion disk** — two counter-rotating ellipses phase at 0.020 and 0.014 rad/frame, giving an asymmetric shimmer.

**Comet coma** — `intensity = clamp((3 − d_nearest_massive) / 2.5, 0, 1)`. Full coma inside 0.5 AU, zero beyond 3 AU.

### Collision Merging

When `dist < physicsRadius_A + physicsRadius_B`:

1. Momentum conserved: `v_new = (m₁v₁ + m₂v₂) / (m₁ + m₂)`
2. Radius volume-conserved: `r_new = ∛(r_A³ + r_B³)`
3. Colour blends weighted by victim mass fraction
4. Type hierarchy applied: `blackhole > neutronstar/pulsar > star > planet > comet`
5. Survivor reclassified — merged planets that cross the stellar mass threshold become stars
6. Collision flash, two shockwave rings, debris particles, and a floating `✦ MERGE` label spawn

---

## Auto-Classification

Mass and display radius together determine body type. Editing mass or radius in the properties panel and committing (blur / Enter) triggers iterative classification:

```
mass < 0.5 units                                          → comet
mass < 24,000 units  (≈ 13 M_Jupiter)                    → planet
(mass > 4.57×10⁶ AND ρ_display > 10⁹) OR ρ > 10¹³       → black hole
ρ_display > 5×10⁸  AND  mass ∈ [2.18×10⁶, 4.57×10⁶]     → neutron star
otherwise                                                  → star
```

`ρ_display = mass / radius³` — this is a **display density proxy**, not physical density. It is calibrated against the default body radii in `BODY_DEFAULTS`.

The iteration updates the display radius to the new type's default at each step (only if the radius is still at the old type's default). This ensures a planet raised to stellar mass becomes a star with star-sized visuals, not an impossibly dense micro-object.

**Pulsar** is never auto-assigned — it is the same mass/density range as a neutron star, distinguished by spin. An existing pulsar stays a pulsar through edits as long as it stays within the NS mass range.

---

## Presets

Load with **P**, the Presets button, or `?scene=<id>` in the URL.

| Name | ID | Bodies | Key Physics |
|---|---|---|---|
| Solar System | `solar-system` | 4 | Circular orbits via `v = √(GM/r)`; Earth, Mars, Jupiter |
| Binary Stars | `binary-stars` | 2 | Equal-mass pair, `v = √(GM/4r)` two-body circular |
| Chaotic Three-Body | `three-body` | 3 | Equilateral triangle; starts near-periodic, becomes chaotic |
| Figure-8 Orbit | `figure8` | 3 | Chenciner–Montgomery choreography (Simo 2002 initial conditions, zero net momentum) |
| Planet + Moon | `planet-moon` | 3 | Moon at 44% of Hill sphere, inside Holman–Wiegert prograde stability limit |
| Gravity Slingshot | `slingshot` | 2 | Hyperbolic flyby, eccentricity 1.053, periapsis 0.66 AU |
| Galactic Collision | `galactic-collision` | 14 | Two clusters, zero net CoM momentum, counter-drifting at ±0.8 AU/yr |
| Rogue Planet | `rogue-planet` | 4 | Hyperbolic interloper, periapsis 0.61 AU |
| Black Hole Flyby | `black-hole-flyby` | 4 | CoM-corrected: all bodies in zero-momentum frame so scene stays centred |
| Pulsar System | `pulsar-system` | 3 | Two planets on circular orbits around a 1.4 M☉ pulsar |
| Comet Storm | `comet-storm` | 6 | Five bound comets, all ≥ 8% below escape velocity |
| Neutron Star Binary | `neutron-binary` | 2 | Two 1.4 M☉ neutron stars, gravitational wave source analogue |

---

## Save & Load

**Ctrl+S** or the Save button downloads `cosmic-scene.json`. The Load button opens a file picker.

```json
{
  "version": 2,
  "simTime": 12.5,
  "camera": { "x": 0.0, "y": 0.0, "zoom": 40 },
  "bodies": [
    {
      "type": "star",
      "x": 0, "y": 0, "vx": 0, "vy": 0,
      "mass": 1989000, "radius": 0.25, "physicsRadius": 0.08,
      "color": "#FFD060", "name": "Sol"
    }
  ]
}
```

---

## Physics Engine

### Unit System

Defined in `js/bodies/Body.js` (`SIM` object — single source of truth). Never hardcode raw SI values.

| Quantity | Unit | SI Equivalent |
|---|---|---|
| Distance | AU | 1 AU = 1.496 × 10¹¹ m |
| Mass | 10²⁴ kg | Earth = 6, Sun = 1,989,000 |
| Time | year | 1 yr = 3.156 × 10⁷ s |
| Velocity | AU/yr | **1 AU/yr = 4.740 km/s** |
| G | AU³ yr⁻² (10²⁴ kg)⁻¹ | **1.9855 × 10⁻⁵** |

Sanity check: `v_Earth = √(1.9855e-5 × 1,989,000 / 1 AU) = 6.284 AU/yr = 29.79 km/s` ✓

### Velocity Verlet Integration

Per micro-step:

```
1.  x(t+dt) = x + v·dt + ½·a·dt²
2.  a(t+dt) = Σ G·mⱼ·(rⱼ−rᵢ) / (|r|² + ε²)^(3/2)    (recomputed at new positions)
3.  v(t+dt) = v + ½·(a_old + a_new)·dt
```

Velocity Verlet is symplectic — it preserves phase-space volume and conserves energy far better than Euler over long runs. Well-configured orbits show < 0.1% energy drift over thousands of revolutions.

### Softened Gravity

```
F_ij = G · mᵢ · mⱼ · (rⱼ − rᵢ) / (|r|² + ε²)^(3/2)
```

Softening `ε = 0.05 AU` prevents force divergence at very close range. At r = 1 AU, gravity is only 0.4% weaker than exact Newtonian. At r = 0.5 AU, 1.5%. At r = 0.1 AU, 28% — but adaptive micro-stepping keeps bodies from reaching such separations without many substeps.

### Adaptive Micro-Stepping

Each frame, `physics.step()` selects the micro-step count from two criteria:

**Period-based** — for every body pair, `T = 2π √(r³ / GM_total)`. Substeps needed for 20 integration points per orbit: `⌈dt / (T/20)⌉`. This prevents close orbits from being traced as polygons. A planet at 0.1 AU from a Sun-mass star (period = 11.5 days) requires ~11 substeps at timeScale = 1.

**Speed-based** — `⌈timeScale / 2⌉`, keeping each substep's effective dt ≤ `baseDt × 2 = 0.033 yr`.

Final: `min(200, max(period_substeps, speed_substeps))`. The **Substeps/Frame** counter in Settings shows this live.

**Performance note:** At timeScale = 100 with 20 bodies, 50 substeps × 190 force pairs = 9,500 force evaluations per frame. Expect < 60 fps in this regime. The O(n²) force loop is the bottleneck; Barnes-Hut is not implemented.

### Collision Detection

Uses `physicsRadius` (not display `radius`). On overlap:

- Momentum conserved
- Radius volume-conserved
- Type hierarchy: BH > NS/Pulsar > Star > Planet > Comet
- Post-merge reclassification via `_reclassifyAfterMerge()`

### Energy Tracking

```
KE = Σ ½ mᵢ |vᵢ|²
PE = −Σᵢ<ⱼ G mᵢ mⱼ / √(|rᵢ − rⱼ|² + ε²)
drift = (E_now − E_init) / |E_init| × 100%
```

Baseline resets after collisions or `markDirty()`. HUD values are EMA-smoothed (α = 0.05) to remain readable at any simulation speed.

---

## File Structure

```
index.html              UI shell — topbar, sidebar, canvas, panels, modals
style.css               Dark space theme, CSS variables, responsive ≤800px / ≤480px

js/
  main.js          (184)  Game loop, resize, URL ?scene= handler, settings panel binding
  camera.js         (74)  worldToScreen / screenToWorld, pan, zoom, fitBodies
  physics.js        (286) Velocity Verlet, adaptive substeps, collisions, energy
  renderer.js       (699) Canvas pipeline, starfield, trails, glows, body types, vel-arrow
  minimap.js        (125) Overview canvas, LOD trail rendering, scale bar
  effects.js        (168) Collision flash, shockwave rings, debris particles, floating labels
  ui.js             (842) Drag state machine, selection, toolbar, keyboard, touch events
  hud.js             (86) Per-frame energy / fps display with EMA smoothing
  props-panel.js    (272) Properties sidebar — fields, dial, reclassification, toast
  presets.js        (217) 12 scenario definitions (pure data, no DOM)
  bodies/
    Body.js         (248) Body class, SIM constants, hexRgb, classifyType, trail ring buffer
```

### Module Dependency Graph

```
index.html
└── main.js
    ├── camera.js
    ├── physics.js
    ├── renderer.js   ← imports SIM, hexRgb from Body.js
    ├── minimap.js    ← imports hexRgb from Body.js
    ├── effects.js    ← imports hexRgb from Body.js
    ├── ui.js
    │   ├── presets.js
    │   ├── props-panel.js  ← imports SIM, classifyType from Body.js
    │   └── hud.js
    └── bodies/Body.js      ← SIM constants, hexRgb, classifyType (shared by all)
```

No circular dependencies. Pure ES Modules, no bundler required.

---

## Deployment

No build step required.

```bash
# GitHub Pages  — push repo root, enable Pages on main branch
# Netlify       — drag-drop the project folder
# Vercel        — import from git, zero configuration
# Local         — python -m http.server 8080
```

---

## Known Limitations

- **O(n²) force loop** — comfortable to ~80 bodies at timeScale = 1. Past that, fps drops. Barnes-Hut (O(n log n)) is not implemented
- **Single-attractor predicted trace** — the vel-arrow path preview uses only the most massive body. In multi-star systems the trace can be misleading
- **Softening at sub-0.1 AU separations** — gravity is reduced by up to 28% at 0.1 AU. Orbits remain stable via micro-stepping, but forces are not exactly Newtonian at very close range
- **No server-side storage** — save/load works via local JSON download/upload only. No URL-based scene sharing
- **Mobile layout** — functional below 800px but not optimised for very small screens (< 400px)
- **No undo** — a single-level Ctrl+Z for vel-arrow commits, body placements, and deletions is not yet implemented

---

## Contributor Notes

### Critical invariants — never break these

**1. `physics.markDirty()`** must be called after every external change to body positions or velocities: drag, preset load, vel-arrow commit, clear. Without it the first Verlet step uses stale zero accelerations and kicks all bodies.

**2. `physicsRadius` ≠ `radius`.** `radius` is the display size. `physicsRadius` is the collision detection radius. They are intentionally separate. Merging them causes instant collisions at orbital distances.

**3. `SIM.G = 1.9855e-5`** is the canonical constant. Never hardcode another value. The G-multiplier slider scales from this: `physics.G = SIM.G × mult`. Both the vel-arrow snap and orbit preview ring use `physics.G` (live), not `SIM.G`.

**4. `SIM.velUnit = 4.740`** — 1 AU/yr in km/s. The value 29.78 km/s is Earth's orbital speed, not the conversion factor.

**5. Auto-fit fires only on the first body** (`bodies.length === 1`). Never call `fitBodies()` on every body placement.

**6. Classification thresholds are calibrated against display radii.** If `BODY_DEFAULTS` radii change, `classifyType` thresholds must be recalibrated to match.

**7. `_bindSimPanel` syncs from `physics.*`**, not HTML attribute defaults. Every slider label is set from live state when the panel opens.

### Adding a new preset

1. Add an entry to `PRESETS` in `js/presets.js` with a unique kebab-case `id`
2. Compute all velocities from `v = √(GM/r)` or vis-viva, using `G = 1.9855e-5`
3. Verify total centre-of-mass momentum is zero: `Σ mᵢvᵢ = 0`
4. For moon systems: place the moon at ≤ 50% of the Hill sphere `r_H = a × (m_moon / 3M_star)^(1/3)` to stay within the prograde stability limit
5. For flyby presets with a massive interloper: subtract the scene CoM velocity from all bodies so the scene stays centred

### Adding a new body type

1. Add a `BODY_DEFAULTS` entry in `Body.js`
2. Add a draw method in `renderer.js` and route to it in `_drawBody`
3. Update `glowMap` in `_drawGlow`
4. Handle the type in the collision hierarchy block in `physics.js`
5. Update `classifyType` if the type should be auto-assigned
6. Add a palette item in `index.html` and CSS icon in `style.css`
