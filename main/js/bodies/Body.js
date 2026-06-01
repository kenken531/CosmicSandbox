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

// Shared mass display constants — imported by ui.js and props-panel.js
export const M_SUN   = 1989000;
export const M_EARTH = 6;
export const STELLAR_TYPES = new Set(['star','blackhole','neutronstar','pulsar']);

export function massToDisplay(body) {
  if (STELLAR_TYPES.has(body.type)) return { val: body.mass / M_SUN,   unit: 'M☉' };
  return                                   { val: body.mass / M_EARTH, unit: 'M⊕' };
}
export function displayToMass(val, type) {
  return STELLAR_TYPES.has(type) ? val * M_SUN : val * M_EARTH;
}

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
// ρ_display = mass / radius³ — DISPLAY density proxy, not physical density.
export function classifyType(mass, radius, currentType) {
  const rSafe = Math.max(radius, 1e-6);
  const rho   = mass / (rSafe * rSafe * rSafe);

  if (mass < 0.5)                                              return 'comet';
  if (mass < 24000)                                            return 'planet';
  if ((mass > 4.57e6 && rho > 1e9) || rho > 1e13)             return 'blackhole';
  if (rho > 5e8 && mass >= 2.18e6 && mass <= 4.57e6) {
    return (currentType === 'pulsar') ? 'pulsar' : 'neutronstar';
  }
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

    this.spinAngle = 0;
    this.spinRate  = type === 'pulsar' ? 4.5 : type === 'neutronstar' ? 1.2 : 0.3;
    this.diskPhase = Math.random() * Math.PI * 2;
    this.comaIntensity = 0;
    this.spaghetti     = 0;

    // Live trail — ring buffer
    this.trailMaxLen = 500;
    this.trail       = [];
    this.trailHead   = 0;

    // Permanent trail
    this.permTrail    = [];
    this.permTrailMax = 10000;
    this._permCounter = 0;

    // Pre-allocated output buffer for getTrail() to avoid per-call Array allocation
    this._trailOut = [];
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

  clearTrail()     { this.trail = []; this.trailHead = 0; this._trailOut = []; }
  clearPermTrail() { this.permTrail = []; this._permCounter = 0; }

  // Returns trail points in chronological order.
  // Reuses a pre-allocated buffer to avoid a new Array() allocation every frame.
  getTrail() {
    const len = this.trail.length;
    if (len < this.trailMaxLen) return this.trail; // not yet wrapped; already ordered

    // Wrapped ring-buffer: reorder into _trailOut
    if (this._trailOut.length !== len) this._trailOut.length = len;
    for (let i = 0; i < len; i++) {
      this._trailOut[i] = this.trail[(this.trailHead + i) % len];
    }
    return this._trailOut;
  }

  get speed()    { return Math.sqrt(this.vx*this.vx + this.vy*this.vy); }
  get speedKms() { return this.speed * SIM.velUnit; }
  get distAU()   { return Math.sqrt(this.x*this.x + this.y*this.y); }
  get isMassive() {
    return this.type === 'blackhole' || this.type === 'neutronstar' ||
           this.type === 'pulsar'    || this.type === 'star';
  }

  _reclassifyAfterMerge() {
    if (this.type === 'blackhole') return;
    if (this.type === 'neutronstar' || this.type === 'pulsar') return;

    const newType = classifyType(this.mass, this.radius, this.type);
    if (newType === this.type) return;

    this.type          = newType;
    this.physicsRadius = (BODY_DEFAULTS[newType] || BODY_DEFAULTS.star).physicsRadius;
    this.spinRate      = newType === 'pulsar' ? 4.5 : newType === 'neutronstar' ? 1.2 : 0.3;
    this.diskPhase     = Math.random() * Math.PI * 2;
    this.comaIntensity = 0;
    this.spaghetti     = 0;
  }

  reclassify() {
    const oldType = this.type;

    const isDefaultRadius = (type) => {
      const def = BODY_DEFAULTS[type];
      return def && Math.abs(this.radius - def.radius) < 0.001;
    };

    let curType = oldType;
    for (let i = 0; i < 5; i++) {
      const next = classifyType(this.mass, this.radius, curType);
      if (next === curType) break;
      curType = next;
      if (isDefaultRadius(oldType) || (i > 0 && isDefaultRadius(curType))) {
        const newDef = BODY_DEFAULTS[curType];
        if (newDef) this.radius = newDef.radius;
      } else {
        break;
      }
    }

    if (curType === oldType) return null;

    const oldDefaultName = (BODY_DEFAULTS[oldType] || {}).name;
    if (this.name === oldDefaultName) {
      this.name = (BODY_DEFAULTS[curType] || {}).name || this.name;
    }

    this.type = curType;
    const def = BODY_DEFAULTS[curType];
    if (def) this.physicsRadius = def.physicsRadius;

    this.spinRate      = curType === 'pulsar' ? 4.5 : curType === 'neutronstar' ? 1.2 : 0.3;
    this.diskPhase     = Math.random() * Math.PI * 2;
    this.comaIntensity = 0;
    this.spaghetti     = 0;

    return oldType;
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

/** Blend two 6-digit hex colors by fraction t (0=a, 1=b). */
export function blendHex(a, b, t) {
  const [ra,ga,ba] = hexRgb(a), [rb,gb,bb] = hexRgb(b);
  return '#' + [
    Math.round(ra+(rb-ra)*t),
    Math.round(ga+(gb-ga)*t),
    Math.round(ba+(bb-ba)*t),
  ].map(v => Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
}
