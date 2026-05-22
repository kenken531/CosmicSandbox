// physics.js — N-body Newtonian gravity (Euler integration, Phase 3 upgrades to Verlet)

import { SIM } from './bodies/Body.js';

export class Physics {
  constructor() {
    this.G         = SIM.G;   // gravitational constant in sim units
    this.softening = 0.05;    // ε — prevents singularity at r≈0 (AU)
    this.timeScale = 1.0;     // simulation speed multiplier (1 = 1 year per real second at 60fps)
    this.running   = false;
    this.simTime   = 0;       // elapsed sim time in years

    // base dt per frame at 60fps — 1/60 of a "year step"
    // at default timeScale=1, full orbit of Earth (1 AU) takes ~60 frames
    this.baseDt    = 1 / 60;
  }

  get dt() {
    return this.baseDt * this.timeScale;
  }

  step(bodies) {
    if (!this.running) return;

    const n   = bodies.length;
    const dt  = this.dt;
    const G   = this.G;
    const eps2 = this.softening * this.softening;

    // Reset accelerations
    for (let i = 0; i < n; i++) {
      bodies[i].ax = 0;
      bodies[i].ay = 0;
    }

    // Accumulate gravitational force between every pair
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const bi = bodies[i];
        const bj = bodies[j];

        const dx = bj.x - bi.x;
        const dy = bj.y - bi.y;
        const dist2 = dx * dx + dy * dy + eps2;
        const dist  = Math.sqrt(dist2);
        const force = G / dist2;           // G / r² (mass factored below)

        // F = G·mi·mj/r²  →  a_i = F·mj direction,  a_j = -F·mi direction
        const fx = force * dx / dist;
        const fy = force * dy / dist;

        bi.ax += fx * bj.mass;
        bi.ay += fy * bj.mass;
        bj.ax -= fx * bi.mass;
        bj.ay -= fy * bi.mass;
      }
    }

    // Integrate: update velocities then positions (Euler)
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      b.vx += b.ax * dt;
      b.vy += b.ay * dt;
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;
      b.recordTrail();
    }

    // Collision detection — merge on contact
    const toRemove = new Set();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (toRemove.has(i) || toRemove.has(j)) continue;
        const bi = bodies[i];
        const bj = bodies[j];
        const dx = bj.x - bi.x;
        const dy = bj.y - bi.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const sumR = (bi.radius + bj.radius) * 0.5; // visual radius in world units
        if (dist < sumR) {
          // Conserve momentum: merge smaller into larger
          const totalMass = bi.mass + bj.mass;
          const [survivor, victim] = bi.mass >= bj.mass ? [bi, bj] : [bj, bi];
          survivor.vx = (survivor.mass * survivor.vx + victim.mass * victim.vx) / totalMass;
          survivor.vy = (survivor.mass * survivor.vy + victim.mass * victim.vy) / totalMass;
          survivor.x  = (survivor.mass * survivor.x  + victim.mass * victim.x)  / totalMass;
          survivor.y  = (survivor.mass * survivor.y  + victim.mass * victim.y)  / totalMass;
          survivor.mass = totalMass;
          // Grow radius slightly
          survivor.radius = Math.cbrt(
            Math.pow(survivor.radius, 3) + Math.pow(victim.radius, 3)
          );
          toRemove.add(bodies.indexOf(victim));
          survivor.clearTrail();
        }
      }
    }

    this.simTime += dt;

    // Return indices to remove (caller filters the array)
    return [...toRemove].sort((a, b) => b - a);
  }

  // Speed multiplier → dt multiplier
  // slider value in [-2, 2] → 10^value (0.01× to 100×)
  setSpeedFromSlider(val) {
    this.timeScale = Math.pow(10, parseFloat(val));
  }

  speedLabel(sliderVal) {
    const v = Math.pow(10, parseFloat(sliderVal));
    if (v >= 10)  return v.toFixed(0) + '×';
    if (v >= 1)   return v.toFixed(1) + '×';
    return v.toFixed(2) + '×';
  }
}
