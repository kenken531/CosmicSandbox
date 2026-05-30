// effects.js — collision flashes, shockwaves, debris, floating text
// Effects use world-space positions so camera pan/zoom during an effect looks correct.
import { hexRgb } from './bodies/Body.js';

export class Effects {
  constructor() {
    this.particles  = [];
    this.shockwaves = [];
    this.flashes    = [];
    this.floaters   = [];
  }

  // event.wx, event.wy are WORLD coords from physics
  spawnCollision(event, camera, canvas) {
    const sp = camera.worldToScreen(event.wx, event.wy, canvas);
    const sr = Math.max(8, camera.worldSizeToScreen(event.r));

    this.flashes.push({
      wx: event.wx, wy: event.wy,   // world position
      r:  sr * 2.5,                 // screen-space radius at spawn zoom (updated each draw)
      worldR: event.r,              // world radius for zoom-corrected drawing
      colorA: event.colorA, colorB: event.colorB,
      life: 1.0, decay: 0.055,
    });

    this.shockwaves.push({
      wx: event.wx, wy: event.wy,
      worldR: event.r,
      maxWorldR: event.r * 6,
      currentWorldR: event.r * 0.5,
      color: blendHex(event.colorA, event.colorB, 0.5),
      life: 1.0, decay: 0.038,
    });

    this.shockwaves.push({
      wx: event.wx, wy: event.wy,
      worldR: event.r,
      maxWorldR: event.r * 10,
      currentWorldR: event.r * 0.3,
      color: '#ffffff',
      life: 0.65, decay: 0.028,
    });

    // Debris particles stored as world-space positions + world-space velocities
    const speedBase = event.r * 0.4;   // world units / frame
    const count = Math.min(40, Math.max(14, Math.floor(event.r * 8)));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (Math.random() * speedBase + speedBase * 0.1);
      this.particles.push({
        wx: event.wx, wy: event.wy,
        wvx: Math.cos(angle) * speed,
        wvy: Math.sin(angle) * speed,
        worldR: event.r * 0.05 + Math.random() * event.r * 0.05,
        color: Math.random() > 0.4 ? event.colorA : event.colorB,
        life: Math.random() * 0.5 + 0.5,
        decay: Math.random() * 0.022 + 0.016,
      });
    }

    this.floaters.push({
      wx: event.wx, wy: event.wy,
      wyOffset: -(event.r + 0.5),   // world-space y offset above collision
      text: '✦ MERGE',
      life: 1.0, decay: 0.016,
      worldDrift: -0.015,   // float upward in world units per frame
    });
  }

  update() {
    for (let i = this.flashes.length    - 1; i >= 0; i--) { this.flashes[i].life    -= this.flashes[i].decay;    if (this.flashes[i].life    <= 0) this.flashes.splice(i, 1);    }
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.currentWorldR += (s.maxWorldR - s.currentWorldR) * 0.1;
      s.life -= s.decay;
      if (s.life <= 0) this.shockwaves.splice(i, 1);
    }
    for (let i = this.particles.length  - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.wx  += p.wvx; p.wy  += p.wvy;
      p.wvx *= 0.96;  p.wvy *= 0.96;
      p.life -= p.decay;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.floaters.length   - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.wyOffset += f.worldDrift;
      f.life -= f.decay;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  // All drawing converts world→screen fresh each frame so camera movement works
  draw(ctx, camera, canvas) {
    // Flashes
    for (const f of this.flashes) {
      const sp = camera.worldToScreen(f.wx, f.wy, canvas);
      const sr = Math.max(4, camera.worldSizeToScreen(f.worldR)) * 2.5;
      const a  = f.life;
      const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sr * (2 - f.life));
      const [r,g,b] = hexRgb(blendHex(f.colorA, f.colorB, 0.5));
      grad.addColorStop(0,    `rgba(255,255,240,${a * 0.95})`);
      grad.addColorStop(0.15, `rgba(${r},${g},${b},${a * 0.75})`);
      grad.addColorStop(0.7,  `rgba(${r},${g},${b},${a * 0.15})`);
      grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr * (2 - f.life), 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Shockwaves
    for (const s of this.shockwaves) {
      const sp = camera.worldToScreen(s.wx, s.wy, canvas);
      const sr = camera.worldSizeToScreen(s.currentWorldR);
      const [r,g,b] = hexRgb(s.color);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(1, sr), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${s.life * 0.65})`;
      ctx.lineWidth   = s.life * 2.5;
      ctx.stroke();
    }

    // Particles
    for (const p of this.particles) {
      const sp  = camera.worldToScreen(p.wx, p.wy, canvas);
      const sr  = Math.max(0.5, camera.worldSizeToScreen(p.worldR));
      const [r,g,b] = hexRgb(p.color);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${p.life * 0.9})`;
      ctx.fill();
      // Motion streak toward previous position
      const prevSp = camera.worldToScreen(p.wx - p.wvx * 2, p.wy - p.wvy * 2, canvas);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(prevSp.x, prevSp.y);
      ctx.strokeStyle = `rgba(${r},${g},${b},${p.life * 0.35})`;
      ctx.lineWidth   = sr * 0.4;
      ctx.stroke();
    }

    // Floating text
    for (const f of this.floaters) {
      const sp = camera.worldToScreen(f.wx, f.wy + f.wyOffset, canvas);
      ctx.save();
      ctx.globalAlpha = f.life;
      ctx.font        = '700 11px "Orbitron", monospace';
      ctx.textAlign   = 'center';
      ctx.fillStyle   = '#ffffff';
      ctx.shadowColor = 'rgba(180,200,255,0.8)';
      ctx.shadowBlur  = 8;
      ctx.fillText(f.text, sp.x, sp.y);
      ctx.restore();
    }
  }

  get active() {
    return this.particles.length + this.shockwaves.length + this.flashes.length + this.floaters.length > 0;
  }
}

function blendHex(a, b, t) {
  const [ra,ga,ba] = hexRgb(a), [rb,gb,bb] = hexRgb(b);
  return '#' + [
    Math.round(ra+(rb-ra)*t), Math.round(ga+(gb-ga)*t), Math.round(ba+(bb-ba)*t)
  ].map(v => Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
}
