// Body.js
// Unit system:
//   Distance : 1 AU = 1.496e11 m
//   Mass     : 1 unit = 1e24 kg  (Earth≈6, Sun≈1,989,000)
//   Velocity : AU/yr
//   G        : 1.9855e-5 AU³ yr⁻² (1e24 kg)⁻¹
//   velUnit  : 4.740 km/s per AU/yr

let _nextId = 1;

export const SIM = {
  AU:       1,
  massUnit: 1e24,
  velUnit:  4.740,
  G:        1.9855e-5,
};

// Per-type defaults
// physicsRadius: collision detection radius in AU (small so orbits work)
// radius:        display radius in AU world units
const BODY_DEFAULTS = {
  star:        { mass:1989000,   radius:0.25,  physicsRadius:0.08,  color:'#FFC940', name:'New Star'        },
  planet:      { mass:6,         radius:0.08,  physicsRadius:0.015, color:'#4B8FDE', name:'New Planet'      },
  blackhole:   { mass:19890000,  radius:0.06,  physicsRadius:0.04,  color:'#8B5CF6', name:'Black Hole'      },
  neutronstar: { mass:2785000,   radius:0.04,  physicsRadius:0.02,  color:'#A0EFFF', name:'Neutron Star'    },
  pulsar:      { mass:2785000,   radius:0.04,  physicsRadius:0.02,  color:'#80FFCC', name:'Pulsar'          },
  comet:       { mass:0.0001,    radius:0.025, physicsRadius:0.008, color:'#C8E8FF', name:'Comet'           },
};

// ── Auto-classification ───────────────────────────────────
// Determines the physically correct body type from mass and display radius.
// Uses mass (M☉ units) and display density (mass / radius³, proportional to ρ).
//
// Classification rules (first match wins):
//
//  mass < 0.5 units   (< ~8e-8 M☉)                               → comet
//  mass < 24000 units (~0.012 M☉, ≈ 13 M_Jupiter)                → planet
//  ρ_display > 1e13, OR (mass > 4.57e6 AND ρ > 1e9)              → blackhole
//  ρ_display > 5e8  AND mass in [2.18e6, 4.57e6] (1.1–2.3 M☉)   → neutronstar *
//  otherwise                                                       → star
//
//  * pulsar is neutronstar with spin — never assigned fresh, preserved if already pulsar
//
// ρ_display = mass / radius³  (DISPLAY density, not physical density)
//
// IMPORTANT: radius is the visual display radius in AU, not the physical radius.
// A star renders at 0.25 AU but its real radius is ~0.005 AU. This means the
// thresholds below have no physical meaning — they are empirically calibrated
// against the default display sizes in BODY_DEFAULTS. If default radii change,
// these thresholds must be recalibrated.
//
// Threshold derivation (using BODY_DEFAULTS display radii):
//   comet/planet boundary : mass < 0.5 / 24000 — mass-only, density irrelevant
//   star → neutronstar    : ρ > 5e8 AND mass in 1.1–2.3 M☉ range
//                           NS default: mass=2785000, r=0.04 AU → ρ=4.35e10 ✓
//   star/NS → blackhole   : mass > 2.3 M☉ AND ρ > 1e9 (compact BH)
//                           BH default: mass=19890000, r=0.06 AU → ρ=9.2e10 ✓
//                           OR any mass at ρ > 1e13 (extreme compression)
export function classifyType(mass, radius, currentType) {
  const rSafe = Math.max(radius, 1e-6);
  const rho   = mass / (rSafe * rSafe * rSafe);   // display density proxy

  if (mass < 0.5)                                        return 'comet';
  if (mass < 24000)                                      return 'planet';
  if ((mass > 4.57e6 && rho > 1e9) || rho > 1e13)                 return 'blackhole';
  if (rho > 5e8 && mass >= 2.18e6 && mass <= 4.57e6) {
    // preserve pulsar if already spinning
    return (currentType === 'pulsar') ? 'pulsar' : 'neutronstar';
  }
  // Pulsars that drift outside NS mass band fall back to star
  return 'star';
}

/** Parse a 6-digit hex color string into [r, g, b] integers 0–255. */
export function hexRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export class Body {
  constructor(type, x, y) {
    this.id   = _nextId++;
    this.type = type;
    this.x    = x;  this.y    = y;
    this.vx   = 0;  this.vy   = 0;
    this.ax   = 0;  this.ay   = 0;
    this._ax_old = 0;  this._ay_old = 0;

    const def          = BODY_DEFAULTS[type] || BODY_DEFAULTS.planet;
    this.mass          = def.mass;
    this.radius        = def.radius;
    this.physicsRadius = def.physicsRadius;
    this.color         = def.color;
    this.name          = def.name;

    // Spin angle (degrees, updated each frame) — for neutron star / pulsar visuals
    this.spinAngle     = 0;
    // Spin rate (deg/frame) — pulsars spin fast
    this.spinRate      = type === 'pulsar' ? 4.5 : type === 'neutronstar' ? 1.2 : 0.3;

    // Accretion disk animation phase — for black holes
    this.diskPhase     = Math.random() * Math.PI * 2;

    // Comet coma intensity (0–1) — driven by distance to nearest star each frame
    this.comaIntensity = 0;

    // Spaghettification state — set by physics when near a black hole
    this.spaghetti     = 0;  // 0 = normal, 1 = fully stretched

    // Live trail
    this.trailMaxLen = 500;
    this.trail       = [];
    this.trailHead   = 0;

    // Permanent trail
    this.permTrail    = [];
    this.permTrailMax = 10000;
    this._permCounter = 0;
  }

  recordTrail() {
    if (this.trail.length < this.trailMaxLen) {
      this.trail.push({ x: this.x, y: this.y });
    } else {
      this.trail[this.trailHead] = { x: this.x, y: this.y };
      this.trailHead = (this.trailHead + 1) % this.trailMaxLen;
    }
    this._permCounter++;
    if (this._permCounter >= 4 && this.permTrail.length < this.permTrailMax) {
      this.permTrail.push({ x: this.x, y: this.y });
      this._permCounter = 0;
    }
  }

  clearTrail()     { this.trail = []; this.trailHead = 0; }
  clearPermTrail() { this.permTrail = []; this._permCounter = 0; }

  getTrail() {
    if (this.trail.length < this.trailMaxLen) return this.trail;
    const out = new Array(this.trailMaxLen);
    for (let i = 0; i < this.trailMaxLen; i++) {
      out[i] = this.trail[(this.trailHead + i) % this.trailMaxLen];
    }
    return out;
  }

  get speed()    { return Math.sqrt(this.vx*this.vx + this.vy*this.vy); }
  get speedKms() { return this.speed * SIM.velUnit; }
  get distAU()   { return Math.sqrt(this.x*this.x + this.y*this.y); }
  get isMassive() { return this.type === 'blackhole' || this.type === 'neutronstar' || this.type === 'pulsar' || this.type === 'star'; }

  // Called by physics.js after a collision merge to update type based on new mass+radius.
  // Applies the collision type hierarchy first (BH > NS > star > planet/comet),
  // then falls back to classifyType for density-based promotion.
  _reclassifyAfterMerge() {
    // Type hierarchy rules already applied by physics.js before this call;
    // this handles cases physics doesn't cover (e.g. two planets merging into a star-mass body)
    if (this.type === 'blackhole') return;   // BH always wins
    if (this.type === 'neutronstar' || this.type === 'pulsar') return;  // NS/pulsar wins

    const newType = classifyType(this.mass, this.radius, this.type);
    if (newType === this.type) return;

    this.type          = newType;
    this.physicsRadius = (BODY_DEFAULTS[newType] || BODY_DEFAULTS.star).physicsRadius;
    this.spinRate      = newType === 'pulsar' ? 4.5 : newType === 'neutronstar' ? 1.2 : 0.3;
    this.diskPhase     = Math.random() * Math.PI * 2;
    this.comaIntensity = 0;
    this.spaghetti     = 0;
  }

  // Returns the new type if reclassification is needed, or null if unchanged.
  // Caller is responsible for updating visual state and notifying the user.
  reclassify() {
    const oldType = this.type;

    // Track whether the display radius is still the default for the current type.
    // If so, we update radius alongside type so density doesn't skew classification.
    // (e.g. a planet at 0.08 AU would classify as BH at stellar mass — wrong.)
    const isDefaultRadius = (type) => {
      const def = BODY_DEFAULTS[type];
      return def && Math.abs(this.radius - def.radius) < 0.001;
    };

    // Iterate until classification stabilises (usually 1–2 passes).
    let curType = oldType;
    for (let i = 0; i < 5; i++) {
      const next = classifyType(this.mass, this.radius, curType);
      if (next === curType) break;
      curType = next;
      // If radius was the default for the previous type, update to new type's default
      // so the next classification round uses a realistic density for the new type.
      if (isDefaultRadius(oldType) || (i > 0 && isDefaultRadius(curType))) {
        const newDef = BODY_DEFAULTS[curType];
        if (newDef) this.radius = newDef.radius;
      } else {
        break; // user has a custom radius — don't touch it, stop iterating
      }
    }

    if (curType === oldType) return null;

    // Update name only if the user hasn't changed it from the old type's default
    const oldDefaultName = (BODY_DEFAULTS[oldType] || {}).name;
    if (this.name === oldDefaultName) {
      this.name = (BODY_DEFAULTS[curType] || {}).name || this.name;
    }

    this.type = curType;

    // Update physicsRadius to new type's canonical value
    const def = BODY_DEFAULTS[curType];
    if (def) this.physicsRadius = def.physicsRadius;

    // Reset animation state for new type
    this.spinRate      = curType === 'pulsar' ? 4.5 : curType === 'neutronstar' ? 1.2 : 0.3;
    this.diskPhase     = Math.random() * Math.PI * 2;
    this.comaIntensity = 0;
    this.spaghetti     = 0;

    return oldType;  // return old type so caller can describe the transition
  }

  toJSON() {
    return {
      type: this.type, x: this.x, y: this.y,
      vx: this.vx, vy: this.vy,
      mass: this.mass, radius: this.radius,
      physicsRadius: this.physicsRadius,
      color: this.color, name: this.name,
    };
  }

  static fromJSON(d) {
    const b          = new Body(d.type || 'planet', d.x, d.y);
    b.vx             = d.vx  ?? 0;
    b.vy             = d.vy  ?? 0;
    b.mass           = d.mass;
    b.radius         = Math.max(0.01, Math.min(50, d.radius ?? 0.08));
    b.physicsRadius  = d.physicsRadius ?? (BODY_DEFAULTS[d.type]?.physicsRadius ?? 0.015);
    b.color          = d.color;
    b.name           = d.name;
    return b;
  }
}
