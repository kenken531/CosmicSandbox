// physics.js — Velocity Verlet N-body integrator
//
// Softened gravity (ε=0.05 AU), adaptive micro-stepping for close approaches
// and high simulation speeds, momentum-conserving collision merges, and
// energy-drift tracking for conservation monitoring.

import { SIM, blendHex } from './bodies/Body.js';

export class Physics {
  constructor() {
    this.G             = SIM.G;      // 1.9855e-5 AU³ yr⁻² (1e24 kg)⁻¹
    this.softening     = 0.05;       // ε (AU) — prevents singularity at close range
    this.timeScale     = 1.0;
    this.running       = false;
    this.collisionMode = 'merge';    // 'merge' | 'passthrough'
    this.simTime       = 0;
    this.baseDt        = 1 / 60;    // 1 sim-year per second at 60 fps

    // Energy tracking
    this.kineticEnergy   = 0;
    this.potentialEnergy = 0;
    this.totalEnergy     = 0;
    this._initEnergy     = null;
    this.energyDrift     = 0;

    // Collision events for effects system (cleared each step)
    this.collisionEvents = [];

    // Dirty flag: recompute accelerations before first Verlet step after any external change
    this._dirty = true;
  }

  get dt() { return this.baseDt * this.timeScale; }

  markDirty()   { this._dirty = true; this.resetEnergy(); }
  resetEnergy() { this._initEnergy = null; this.energyDrift = 0; }

  // ── Compute accelerations at current positions ───────────
  _computeAccel(bodies) {
    const G    = this.G;
    const eps2 = this.softening * this.softening;
    const n    = bodies.length;
    for (let i = 0; i < n; i++) { bodies[i].ax = 0; bodies[i].ay = 0; }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const bi = bodies[i], bj = bodies[j];
        const dx    = bj.x - bi.x;
        const dy    = bj.y - bi.y;
        const dist2 = dx*dx + dy*dy + eps2;
        const dist  = Math.sqrt(dist2);
        const inv   = G / (dist2 * dist);  // G / r³
        const fx = inv * dx, fy = inv * dy;
        bi.ax += fx * bj.mass;  bi.ay += fy * bj.mass;
        bj.ax -= fx * bi.mass;  bj.ay -= fy * bi.mass;
      }
    }
  }

  // ── Velocity Verlet step ─────────────────────────────────
  step(bodies) {
    if (!this.running) return [];
    this.collisionEvents = [];

    const n  = bodies.length;
    const dt = this.dt;

    // Warm-up pass: compute real accelerations before first Verlet step
    if (this._dirty) {
      this._computeAccel(bodies);
      this._dirty = false;
    }

    // Adaptive micro-substeps:
    // 1. Period-based: ensure ≥20 steps per orbit for the tightest pair.
    // 2. Speed-based: scale with timeScale so high-speed simulations stay accurate.
    let periodSubsteps = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = bodies[j].x - bodies[i].x;
        const dy = bodies[j].y - bodies[i].y;
        const r  = Math.sqrt(dx*dx + dy*dy);
        if (r < 1e-6) continue;
        const Mtot = bodies[i].mass + bodies[j].mass;
        const T    = 2 * Math.PI * Math.sqrt(r * r * r / (this.G * Mtot));
        const need = Math.ceil(dt / (T / 20));
        if (need > periodSubsteps) periodSubsteps = need;
      }
    }
    const speedSubsteps = Math.max(1, Math.ceil(this.timeScale / 2));
    const microSteps    = Math.min(200, Math.max(periodSubsteps, speedSubsteps));
    const microDt       = dt / microSteps;
    this.lastMicroSteps = microSteps;  // exposed for HUD display

    // Record trail every N substeps so curves stay smooth at high speed.
    // Target ~10 samples per frame regardless of substep count; always
    // record on the final substep so the trail tip is never stale.
    const TRAIL_SAMPLES  = 10;
    const trailStride    = Math.max(1, Math.floor(microSteps / TRAIL_SAMPLES));

    for (let ms = 0; ms < microSteps; ms++) {
      // Step 1: x(t+dt) = x + v·dt + ½·a·dt²
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        b.x += b.vx * microDt + 0.5 * b.ax * microDt * microDt;
        b.y += b.vy * microDt + 0.5 * b.ay * microDt * microDt;
        b._ax_old = b.ax;
        b._ay_old = b.ay;
      }

      // Step 2: compute a(t+dt) at new positions
      this._computeAccel(bodies);

      // Step 3: v(t+dt) = v + ½·(a_old + a_new)·dt
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        b.vx += 0.5 * (b._ax_old + b.ax) * microDt;
        b.vy += 0.5 * (b._ay_old + b.ay) * microDt;
      }

      // Record trail at evenly-spaced substep intervals so fast orbits
      // produce smooth curves instead of polygons/triangles.
      // At low speeds (1 substep) this still records once per frame.
      if (ms % trailStride === 0 || ms === microSteps - 1) {
        for (let i = 0; i < n; i++) bodies[i].recordTrail();
      }
    }

    // ── Collision detection ──────────────────────────────
    const toRemove     = new Set();
    let   hadCollision = false;

    if (this.collisionMode !== 'passthrough') {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (toRemove.has(i) || toRemove.has(j)) continue;
          const bi = bodies[i], bj = bodies[j];
          const dx = bj.x - bi.x, dy = bj.y - bi.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < (bi.physicsRadius + bj.physicsRadius)) {
            hadCollision = true;
            const totalMass = bi.mass + bj.mass;
            const [survivor, victim] = bi.mass >= bj.mass ? [bi, bj] : [bj, bi];
            const blendT = victim.mass / totalMass;

            this.collisionEvents.push({
              wx:     (survivor.x * survivor.mass + victim.x * victim.mass) / totalMass,
              wy:     (survivor.y * survivor.mass + victim.y * victim.mass) / totalMass,
              r:      Math.max(survivor.radius, victim.radius),
              colorA: survivor.color,
              colorB: victim.color,
            });

            // Conserve momentum — compute BEFORE mutating mass
            const newVx = (survivor.mass * survivor.vx + victim.mass * victim.vx) / totalMass;
            const newVy = (survivor.mass * survivor.vy + victim.mass * victim.vy) / totalMass;
            const newX  = (survivor.mass * survivor.x  + victim.mass * victim.x)  / totalMass;
            const newY  = (survivor.mass * survivor.y  + victim.mass * victim.y)  / totalMass;

            survivor.vx     = newVx;  survivor.vy = newVy;
            survivor.x      = newX;   survivor.y  = newY;
            survivor.mass   = totalMass;
            survivor.radius        = Math.cbrt(survivor.radius**3        + victim.radius**3);
            survivor.physicsRadius = Math.cbrt(survivor.physicsRadius**3 + victim.physicsRadius**3);

            // Type hierarchy: BH > NS/pulsar > star > planet/comet
            if (survivor.type === 'blackhole') {
              // stays black hole
            } else if (survivor.type === 'neutronstar' || survivor.type === 'pulsar') {
              // stays NS/pulsar
            } else if (victim.type === 'star' || victim.type === 'neutronstar' || victim.type === 'pulsar') {
              survivor.type = 'star';
            }

            survivor.color = blendHex(survivor.color, victim.color, blendT);
            survivor._reclassifyAfterMerge();

            toRemove.add(bodies.indexOf(victim));
            survivor.clearTrail();
            survivor.ax = 0; survivor.ay = 0;
          }
        }
      }
    }

    // ── Exotic body effects ─────────────────────────────
    for (let i = 0; i < bodies.length; i++) {
      if (toRemove.has(i)) continue;
      const b = bodies[i];

      if (b.type === 'neutronstar' || b.type === 'pulsar') {
        b.spinAngle = (b.spinAngle + b.spinRate) % 360;
      }
      if (b.type === 'blackhole') {
        b.diskPhase += 0.02;
      }

      if (b.type === 'comet') {
        let nearestStarDist = Infinity;
        for (let j = 0; j < bodies.length; j++) {
          if (j === i || !bodies[j].isMassive) continue;
          const dx = bodies[j].x - b.x, dy = bodies[j].y - b.y;
          const d  = Math.sqrt(dx*dx + dy*dy);
          if (d < nearestStarDist) nearestStarDist = d;
        }
        b.comaIntensity = Math.max(0, Math.min(1, (3 - nearestStarDist) / 2.5));
      }

      b.spaghetti = 0;
      for (let j = 0; j < bodies.length; j++) {
        if (j === i || bodies[j].type !== 'blackhole') continue;
        const dx = bodies[j].x - b.x, dy = bodies[j].y - b.y;
        const dist    = Math.sqrt(dx*dx + dy*dy);
        const r_tidal = b.physicsRadius * Math.pow(bodies[j].mass / Math.max(b.mass, 1), 1/3);
        if (dist < r_tidal * 3) {
          b.spaghetti = Math.min(1, 1 - (dist - r_tidal) / (r_tidal * 2));
        }
      }
    }

    // ── Energy ───────────────────────────────────────────
    this._computeEnergy(bodies);

    if (this._initEnergy === null && !hadCollision && n > 1) {
      this._initEnergy = this.totalEnergy;
    }
    if (this._initEnergy !== null && Math.abs(this._initEnergy) > 1e-30) {
      this.energyDrift = ((this.totalEnergy - this._initEnergy) / Math.abs(this._initEnergy)) * 100;
    }
    if (hadCollision) {
      this._initEnergy = null;
      this._dirty = true;
    }

    this.simTime += dt;
    return [...toRemove].sort((a, b) => b - a);
  }

  _computeEnergy(bodies) {
    const G    = this.G;
    const eps2 = this.softening * this.softening;
    const n    = bodies.length;
    let KE = 0, PE = 0;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      KE += 0.5 * b.mass * (b.vx*b.vx + b.vy*b.vy);
      for (let j = i + 1; j < n; j++) {
        const bj = bodies[j];
        const dx = bj.x - b.x, dy = bj.y - b.y;
        PE -= G * b.mass * bj.mass / Math.sqrt(dx*dx + dy*dy + eps2);
      }
    }
    this.kineticEnergy   = KE;
    this.potentialEnergy = PE;
    this.totalEnergy     = KE + PE;
  }

  setSpeedFromSlider(val) { this.timeScale = Math.pow(10, parseFloat(val)); }

  speedLabel(v) {
    const s = Math.pow(10, parseFloat(v));
    return s >= 10 ? s.toFixed(0)+'×' : s >= 1 ? s.toFixed(1)+'×' : s.toFixed(2)+'×';
  }
}
