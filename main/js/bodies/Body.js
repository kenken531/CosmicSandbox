// bodies/Body.js — base class for all celestial objects

let _nextId = 1;

// Simulation unit definitions (makes numbers feel right on screen):
// 1 sim unit of distance ≈ 1 AU (1.496e11 m)  — so Earth orbits at ~1 unit from Sun
// 1 sim unit of mass    ≈ 1e24 kg              — Earth = ~6 units, Sun = ~2e6 units
// velocities in sim units/year
// G in sim units = 4π² AU³/(M☉·yr²) ≈ 39.478  (but we expose it as tunable)

export const SIM = {
  AU:       1,           // 1 sim distance = 1 AU
  massUnit: 1e24,        // kg per sim mass unit
  velUnit:  29.78,       // km/s per sim velocity unit (Earth orbital speed ≈ 1)
  G:        39.478,      // sim gravitational constant (AU³ yr⁻² M☉⁻¹, M☉ ≈ 2e6 mass units)
};

const BODY_DEFAULTS = {
  star:   { mass: 1989000, radius: 5,  color: '#FFC940', name: 'New Star'   },
  planet: { mass: 6,       radius: 1.8, color: '#4B8FDE', name: 'New Planet' },
};

export class Body {
  constructor(type, x, y) {
    this.id     = _nextId++;
    this.type   = type;         // 'star' | 'planet' | 'blackhole' | ...
    this.x      = x;            // sim world coords
    this.y      = y;
    this.vx     = 0;            // sim velocity
    this.vy     = 0;
    this.ax     = 0;            // acceleration (reset each physics step)
    this.ay     = 0;

    const def = BODY_DEFAULTS[type] || BODY_DEFAULTS.planet;
    this.mass   = def.mass;     // sim mass units
    this.radius = def.radius;   // screen display radius (world units, scaled visually)
    this.color  = def.color;
    this.name   = def.name;
    this.merged = false;        // flag for deletion after collision

    // Trail: ring buffer of {x,y} positions
    this.trailMaxLen = 500;
    this.trail = [];
    this.trailHead = 0;         // index of oldest entry
    this.trailCount = 0;
  }

  // Add current position to trail ring buffer
  recordTrail() {
    if (this.trail.length < this.trailMaxLen) {
      this.trail.push({ x: this.x, y: this.y });
    } else {
      this.trail[this.trailHead] = { x: this.x, y: this.y };
      this.trailHead = (this.trailHead + 1) % this.trailMaxLen;
    }
    this.trailCount = Math.min(this.trailCount + 1, this.trailMaxLen);
  }

  clearTrail() {
    this.trail = [];
    this.trailHead = 0;
    this.trailCount = 0;
  }

  // Returns ordered trail from oldest → newest
  getTrail() {
    if (this.trail.length < this.trailMaxLen) return this.trail;
    const ordered = [];
    for (let i = 0; i < this.trailMaxLen; i++) {
      ordered.push(this.trail[(this.trailHead + i) % this.trailMaxLen]);
    }
    return ordered;
  }

  // Speed in sim units/yr
  get speed() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  // Speed in km/s (for display)
  get speedKms() {
    return this.speed * SIM.velUnit;
  }

  // Distance from origin in AU
  get distAU() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  // For serialisation
  toJSON() {
    return {
      id: this.id, type: this.type,
      x: this.x, y: this.y,
      vx: this.vx, vy: this.vy,
      mass: this.mass, radius: this.radius,
      color: this.color, name: this.name
    };
  }

  static fromJSON(data) {
    const b = new Body(data.type, data.x, data.y);
    Object.assign(b, data);
    return b;
  }
}
