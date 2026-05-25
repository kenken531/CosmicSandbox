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
