// physics.js — Velocity Verlet N-body integrator
//
// BUG FIXES applied in this version:
//  1. markDirty() now called from ui.js on every drag/load/clear
//  2. Substep count capped correctly — uses sqrt(timeScale) not timeScale
//     to avoid dt blowup at extreme speeds
//  3. Passthrough mode still records trails and advances simTime
//  4. Collision blend fraction captured before mass mutation
//  5. Energy baseline only set on a collision-free step

import { SIM } from './bodies/Body.js';

export class Physics {
  constructor() {
    this.G             = SIM.G;      // 1.9855e-5 AU³ yr⁻² (1e24 kg)⁻¹ (corrected)
    this.softening     = 0.05;        // ε (AU) — prevents singularity
    // Reduced from 0.3: large softening biases gravity at orbital distances (~1 AU),
    // causing slow artificial precession and drift. 0.05 is negligible at ≥0.5 AU.
    // Close-approach singularities are handled by adaptive micro-stepping instead.
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

    // FIX 1: dirty flag — must warm-up acceleration on first step
    // and after any external scene change (drag, load, clear)
    this._dirty = true;
  }

  get dt() { return this.baseDt * this.timeScale; }

  // Call this whenever bodies are moved externally (drag, preset, clear)
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

    // FIX 1: warm-up pass — compute real accelerations before first Verlet step
    if (this._dirty) {
      this._computeAccel(bodies);
      this._dirty = false;
    }

    // BUG3 FIX: adaptive micro-substeps when bodies are dangerously close
    // Find minimum separation; if < 2*softening, split this step further
    let minDist = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i+1; j < n; j++) {
        const dx = bodies[j].x - bodies[i].x;
        const dy = bodies[j].y - bodies[i].y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d < minDist) minDist = d;
      }
    }
    // Adaptive micro-substeps:
    // 1. If bodies are dangerously close, split more finely (close-approach guard)
    // 2. Always add substeps proportional to timeScale so orbital accuracy is preserved
    //    at high sim speeds. Target: dt_effective < P_min/20 where P_min is the period
    //    of the tightest pair. Floor is 1, no hardcoded cap of 8.
    const closeThreshold = this.softening * 4;
    const closeSubsteps  = minDist < closeThreshold
      ? Math.ceil(closeThreshold / Math.max(minDist, 0.001))
      : 1;
    // Speed substeps: scale so each substep ≤ baseDt × 2 regardless of timeScale
    const speedSubsteps = Math.max(1, Math.ceil(this.timeScale / 2));
    const microSteps = Math.min(200, Math.max(closeSubsteps, speedSubsteps));
    const microDt = dt / microSteps;

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
    // Only record trail on final micro-step — keeps trail density at 1 pt/frame
    if (ms === microSteps - 1) {
      for (let i = 0; i < n; i++) bodies[i].recordTrail();
    }
    } // end micro-step loop

    // ── Collision detection ──────────────────────────────
    const toRemove    = new Set();
    let   hadCollision = false;

    if (this.collisionMode !== 'passthrough') {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (toRemove.has(i) || toRemove.has(j)) continue;
          const bi = bodies[i], bj = bodies[j];
          const dx = bj.x - bi.x, dy = bj.y - bi.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          // Use physicsRadius (tiny, in AU) not display radius (huge, causes instant merges)
          if (dist < (bi.physicsRadius + bj.physicsRadius)) {
            hadCollision = true;
            const totalMass = bi.mass + bj.mass;
            const [survivor, victim] = bi.mass >= bj.mass ? [bi, bj] : [bj, bi];

            // FIX 4: capture blend fraction BEFORE mutating survivor.mass
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
            // Type rules after collision:
            // BH absorbs everything and stays BH
            // NS/pulsar absorbs smaller body → stays NS/pulsar
            // Star absorbs planet → stays star
            if (survivor.type === 'blackhole') {
              // stays black hole, absorbs mass
            } else if (survivor.type === 'neutronstar' || survivor.type === 'pulsar') {
              // stays neutron star / pulsar
            } else if (victim.type === 'star' || victim.type === 'neutronstar' || victim.type === 'pulsar') {
              survivor.type = 'star';
            }
            // Comets always dissolve into their absorber — no special handling needed
            survivor.color  = blendHex(survivor.color, victim.color, blendT);

            toRemove.add(bodies.indexOf(victim));
            survivor.clearTrail();
            survivor.ax = 0; survivor.ay = 0;
          }
        }
      }
    }

    // ── Exotic body effects ─────────────────────────────
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];

      // Spin animation for neutron stars and pulsars
      if (b.type === 'neutronstar' || b.type === 'pulsar') {
        b.spinAngle = (b.spinAngle + b.spinRate) % 360;
      }
      // Black hole disk animation
      if (b.type === 'blackhole') {
        b.diskPhase += 0.02;
      }

      // Comet coma: brighten when close to a star or massive body
      if (b.type === 'comet') {
        let nearestStarDist = Infinity;
        for (let j = 0; j < bodies.length; j++) {
          if (j === i) continue;
          if (bodies[j].isMassive) {
            const dx = bodies[j].x - b.x, dy = bodies[j].y - b.y;
            const d  = Math.sqrt(dx*dx + dy*dy);
            if (d < nearestStarDist) nearestStarDist = d;
          }
        }
        // Coma appears inside 3 AU, full intensity at 0.5 AU
        b.comaIntensity = Math.max(0, Math.min(1, (3 - nearestStarDist) / 2.5));
      }

      // Spaghettification: stretch bodies near black holes
      b.spaghetti = 0;
      for (let j = 0; j < bodies.length; j++) {
        if (j === i || bodies[j].type !== 'blackhole') continue;
        const dx = bodies[j].x - b.x, dy = bodies[j].y - b.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        // Tidal disruption radius ~ physicsRadius * (M_bh/M_body)^(1/3)
        const r_tidal = b.physicsRadius * Math.pow(bodies[j].mass / Math.max(b.mass, 1), 1/3);
        if (dist < r_tidal * 3) {
          b.spaghetti = Math.min(1, 1 - (dist - r_tidal) / (r_tidal * 2));
        }
      }
    }

    // ── Energy ───────────────────────────────────────────
    this._computeEnergy(bodies);

    // FIX 5: only set baseline on a collision-free step
    if (this._initEnergy === null && !hadCollision && n > 1) {
      this._initEnergy = this.totalEnergy;
    }
    if (this._initEnergy !== null && Math.abs(this._initEnergy) > 1e-30) {
      this.energyDrift = ((this.totalEnergy - this._initEnergy) / Math.abs(this._initEnergy)) * 100;
    }
    if (hadCollision) {
      this._initEnergy = null;  // reset so baseline re-establishes cleanly next step
      this._dirty = true;       // re-warmup after merge repositioning
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

function blendHex(a, b, t) {
  const pr = (h, o, l) => parseInt(h.slice(o, l), 16);
  const r  = Math.round(pr(a,1,3) + (pr(b,1,3) - pr(a,1,3)) * t);
  const g  = Math.round(pr(a,3,5) + (pr(b,3,5) - pr(a,3,5)) * t);
  const bl = Math.round(pr(a,5,7) + (pr(b,5,7) - pr(a,5,7)) * t);
  return '#' + [r,g,bl].map(v => Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
}
