// renderer.js — Canvas 2D rendering: starfield, trails, glows, bodies, overlays
import { SIM } from './bodies/Body.js';

export class Renderer {
  constructor(canvas) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.offscreen = document.createElement('canvas'); // static starfield
    this._selectionAngle = 0; // for animated selection ring
    this._initStarfield();
  }

  _initStarfield() { this._rebuildStarfield(); }

  _rebuildStarfield() {
    const w = this.canvas.width  || window.innerWidth;
    const h = this.canvas.height || window.innerHeight;
    this.offscreen.width  = w;
    this.offscreen.height = h;
    const ctx = this.offscreen.getContext('2d');

    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, w, h);

    // Nebula wisps for atmosphere
    const nebulaColors = [
      'rgba(30,40,120,0.04)', 'rgba(80,20,120,0.03)',
      'rgba(20,60,100,0.04)', 'rgba(100,30,60,0.03)'
    ];
    for (let n = 0; n < 6; n++) {
      const nx = Math.random() * w;
      const ny = Math.random() * h;
      const nr = Math.random() * 300 + 150;
      const grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
      grad.addColorStop(0, nebulaColors[n % nebulaColors.length]);
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Stars — three size classes with color temperature variation
    const count = Math.floor((w * h) / 900);
    for (let i = 0; i < count; i++) {
      const x       = Math.random() * w;
      const y       = Math.random() * h;
      const classRoll = Math.random();
      const r       = classRoll < 0.03 ? Math.random() * 1.6 + 1.0   // bright giants
                    : classRoll < 0.18 ? Math.random() * 0.7 + 0.5   // medium
                    : Math.random() * 0.35 + 0.15;                    // dim dwarfs
      const opacity = Math.random() * 0.55 + 0.25;

      // Color temperature: blue-white, white, warm yellow
      const tempRoll = Math.random();
      const hue = tempRoll < 0.25 ? `hsla(220,70%,92%,${opacity})`
                : tempRoll < 0.45 ? `hsla(200,40%,96%,${opacity})`
                : tempRoll < 0.55 ? `hsla(30,60%,92%,${opacity})`
                :                   `hsla(0,0%,97%,${opacity})`;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = hue;
      ctx.fill();

      // Tiny cross-spike on the bright ones
      if (classRoll < 0.03) {
        const spike = r * 2.5;
        ctx.strokeStyle = `hsla(210,60%,90%,${opacity * 0.4})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x - spike, y); ctx.lineTo(x + spike, y);
        ctx.moveTo(x, y - spike); ctx.lineTo(x, y + spike);
        ctx.stroke();
      }
    }
  }

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
    this._rebuildStarfield();
  }

  // ── Main render pipeline ────────────────────────────────
  render(bodies, camera, selectedId, velArrow) {
    const ctx = this.ctx;

    this._selectionAngle += 0.012;

    // 1. Static starfield
    ctx.drawImage(this.offscreen, 0, 0);

    // 2. Permanent trails (full history, drawn first so live trail overlays them)
    this._drawPermTrails(bodies, camera);

    // 3. Live trails (ring buffer, recent path with fading)
    this._drawTrails(bodies, camera);

    // 4. Glows (under bodies)
    for (const b of bodies) this._drawGlow(b, camera);

    // 5. Bodies
    for (const b of bodies) this._drawBody(b, camera, b.id === selectedId);

    // 6. Velocity arrow + orbit preview ring
    if (velArrow) this._drawVelArrow(velArrow, camera, bodies, selectedId);
  }

  // ── Permanent trails (full history, never cleared) ────────
  _drawPermTrails(bodies, camera) {
    const ctx = this.ctx;
    for (const b of bodies) {
      const trail = b.permTrail;
      if (!trail || trail.length < 2) continue;
      const hex = b.color;
      const r  = parseInt(hex.slice(1,3),16);
      const g  = parseInt(hex.slice(3,5),16);
      const bl = parseInt(hex.slice(5,7),16);

      // Draw in one path — uniform low opacity so it doesn't overwhelm
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < trail.length; i++) {
        const sp = camera.worldToScreen(trail[i].x, trail[i].y, this.canvas);
        if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
        else           ctx.lineTo(sp.x, sp.y);
      }
      ctx.strokeStyle = `rgba(${r},${g},${bl},0.18)`;
      ctx.lineWidth   = 0.8;
      ctx.setLineDash([]);
      ctx.stroke();
    }
  }

  // ── Live orbital trails (ring buffer, fades) ────────────
  _drawTrails(bodies, camera) {
    const ctx = this.ctx;
    // FIX: batch trail into 4 opacity bands instead of O(n) individual draw calls
    const BANDS = 4;
    for (const b of bodies) {
      const trail = b.getTrail();
      if (trail.length < 3) continue;
      const hex = b.color;
      const r  = parseInt(hex.slice(1,3),16);
      const g  = parseInt(hex.slice(3,5),16);
      const bl = parseInt(hex.slice(5,7),16);
      const segs = trail.length - 1;

      for (let band = 0; band < BANDS; band++) {
        const t0 = band / BANDS, t1 = (band + 1) / BANDS;
        const alpha = (t1 * t1) * 0.55;   // quadratic — newest band brightest
        const lw    = band < 2 ? 0.5 : 1.0;
        ctx.beginPath();
        let started = false;
        for (let i = Math.floor(t0 * segs); i < segs && i <= Math.ceil(t1 * segs); i++) {
          const p1 = camera.worldToScreen(trail[i].x,   trail[i].y,   this.canvas);
          const p2 = camera.worldToScreen(trail[i+1].x, trail[i+1].y, this.canvas);
          if (!started) { ctx.moveTo(p1.x, p1.y); started = true; }
          ctx.lineTo(p2.x, p2.y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha})`;
        ctx.lineWidth   = lw;
        ctx.stroke();
      }
    }
  }

  // ── Body glow ───────────────────────────────────────────
  _drawGlow(b, camera) {
    const ctx = this.ctx;
    const sp  = camera.worldToScreen(b.x, b.y, this.canvas);
    const sr  = Math.max(2, camera.worldSizeToScreen(b.radius));

    const hex = b.color;
    const r  = parseInt(hex.slice(1,3),16);
    const g  = parseInt(hex.slice(3,5),16);
    const bl = parseInt(hex.slice(5,7),16);

    const glowMap = {
      star:        [{ f:7, a:0.025 }, { f:4, a:0.06 }, { f:2.2, a:0.12 }, { f:1.4, a:0.2 }],
      blackhole:   [{ f:8, a:0.015 }, { f:5, a:0.03 }, { f:2.5, a:0.05 }],  // purple haze
      neutronstar: [{ f:5, a:0.04  }, { f:3, a:0.09 }, { f:1.6, a:0.18 }],  // blue-white
      pulsar:      [{ f:6, a:0.05  }, { f:3, a:0.10 }, { f:1.5, a:0.20 }],  // bright
      comet:       [{ f:3, a:0.03  }, { f:1.8, a:0.06 }],
      planet:      [{ f:2.5, a:0.04 }, { f:1.6, a:0.08 }],
    };
    const layers = glowMap[b.type] || glowMap.planet;

    for (const { f, a } of layers) {
      const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sr * f);
      grad.addColorStop(0, `rgba(${r},${g},${bl},${a})`);
      grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr * f, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }

  // ── Body rendering ──────────────────────────────────────
  _drawBody(b, camera, selected) {
    const ctx = this.ctx;
    const sp  = camera.worldToScreen(b.x, b.y, this.canvas);
    const sr  = Math.max(2, camera.worldSizeToScreen(b.radius));

    const hex = b.color;
    const r  = parseInt(hex.slice(1,3),16);
    const g  = parseInt(hex.slice(3,5),16);
    const bl = parseInt(hex.slice(5,7),16);

    if      (b.type === 'star')        this._drawStar(ctx, sp, sr, r, g, bl);
    else if (b.type === 'blackhole')   this._drawBlackHole(ctx, sp, sr, b);
    else if (b.type === 'neutronstar') this._drawNeutronStar(ctx, sp, sr, r, g, bl, b.spinAngle, false);
    else if (b.type === 'pulsar')      this._drawNeutronStar(ctx, sp, sr, r, g, bl, b.spinAngle, true);
    else if (b.type === 'comet')       this._drawComet(ctx, sp, sr, b);
    else                               this._drawPlanet(ctx, sp, sr, r, g, bl, b);

    // Selection ring — animated dashed arc
    if (selected) {
      const ringR = sr + Math.max(5, sr * 0.4);

      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(this._selectionAngle);

      // Outer dashed ring
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(91,142,255,0.85)`;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();

      // Inner thin solid ring
      ctx.beginPath();
      ctx.arc(0, 0, ringR + 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(91,142,255,0.25)`;
      ctx.lineWidth   = 0.75;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.lineWidth = 1; // FIX: reset lineWidth so outer draws aren't affected

      ctx.restore();

      // Name label above ring
      ctx.font      = `500 11px "Space Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${r},${g},${bl},0.95)`;
      ctx.fillText(b.name, sp.x, sp.y - ringR - 8);
    } else if (b.type === 'star') {
      // Stars always show name at rest
      ctx.font      = '9px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${r},${g},${bl},0.65)`;
      ctx.fillText(b.name, sp.x, sp.y - sr - 7);
    }
  }

  _drawStar(ctx, sp, sr, r, g, bl) {
    // Radial gradient body — bright core, dimmer edge
    const grad = ctx.createRadialGradient(
      sp.x - sr * 0.2, sp.y - sr * 0.2, 0,
      sp.x, sp.y, sr
    );
    grad.addColorStop(0,   `rgba(255,255,220,1)`);
    grad.addColorStop(0.3, `rgba(${r},${g},${bl},1)`);
    grad.addColorStop(1,   `rgba(${Math.max(0,r-40)},${Math.max(0,g-40)},${Math.max(0,bl-40)},0.9)`);

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  _drawPlanet(ctx, sp, sr, r, g, bl, body) {
    // Base sphere
    const grad = ctx.createRadialGradient(
      sp.x - sr * 0.3, sp.y - sr * 0.3, sr * 0.05,
      sp.x, sp.y, sr
    );
    grad.addColorStop(0,   `rgba(${Math.min(255,r+60)},${Math.min(255,g+60)},${Math.min(255,bl+60)},1)`);
    grad.addColorStop(0.6, `rgba(${r},${g},${bl},1)`);
    grad.addColorStop(1,   `rgba(${Math.max(0,r-60)},${Math.max(0,g-60)},${Math.max(0,bl-60)},1)`);

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle band lines (only visible when big enough on screen)
    if (sr > 6) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
      ctx.clip();

      // 2–3 horizontal bands
      const bands = [
        { y: sp.y - sr * 0.35, h: sr * 0.18, a: 0.07 },
        { y: sp.y + sr * 0.15, h: sr * 0.14, a: 0.05 },
      ];
      for (const band of bands) {
        ctx.beginPath();
        ctx.ellipse(sp.x, band.y, sr, band.h, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${band.a})`;
        ctx.fill();
      }
      ctx.restore();
    }

    // Terminator — shadow on right side
    const shadowGrad = ctx.createRadialGradient(
      sp.x + sr * 0.4, sp.y + sr * 0.3, 0,
      sp.x, sp.y, sr * 1.1
    );
    shadowGrad.addColorStop(0,   'rgba(0,0,0,0)');
    shadowGrad.addColorStop(0.7, 'rgba(0,0,0,0)');
    shadowGrad.addColorStop(1,   'rgba(0,0,0,0.45)');

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
    ctx.fillStyle = shadowGrad;
    ctx.fill();

    // Spaghettification stretch — elongate toward nearest BH
    if (body && body.spaghetti > 0.05) {
      const stretch = 1 + body.spaghetti * 5;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.scale(1 / stretch, stretch);
      ctx.beginPath();
      ctx.arc(0, 0, sr * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${bl},${body.spaghetti * 0.6})`;
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Black Hole ─────────────────────────────────────────
  _drawBlackHole(ctx, sp, sr, body) {
    ctx.save();

    // Accretion disk — two ellipses rotating at different rates
    const diskW = sr * 3.5, diskH = sr * 0.9;
    const angle1 = body.diskPhase;
    const angle2 = body.diskPhase * 0.7 + 1.2;

    for (const [ang, alpha, wMult] of [[angle1,0.45,1.0],[angle2,0.25,1.3]]) {
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(ang);
      const dg = ctx.createLinearGradient(-diskW*wMult, 0, diskW*wMult, 0);
      dg.addColorStop(0,   'rgba(139,92,246,0)');
      dg.addColorStop(0.3, `rgba(200,140,255,${alpha})`);
      dg.addColorStop(0.5, `rgba(255,200,255,${alpha*0.5})`);
      dg.addColorStop(0.7, `rgba(200,140,255,${alpha})`);
      dg.addColorStop(1,   'rgba(139,92,246,0)');
      ctx.beginPath();
      ctx.ellipse(0, 0, diskW*wMult, diskH, 0, 0, Math.PI*2);
      ctx.fillStyle = dg;
      ctx.fill();
      ctx.restore();
    }

    // Event horizon — pure black circle
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();

    // Photon sphere ring
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sr * 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(139,92,246,0.6)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Inner glow ring
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sr * 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220,180,255,0.35)';
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    ctx.restore();
  }

  // ── Neutron Star / Pulsar ───────────────────────────────
  _drawNeutronStar(ctx, sp, sr, r, g, bl, spinAngle, isPulsar) {
    ctx.save();

    // Core — tiny, incredibly dense, blue-white
    const coreGrad = ctx.createRadialGradient(
      sp.x - sr*0.15, sp.y - sr*0.15, 0,
      sp.x, sp.y, sr
    );
    coreGrad.addColorStop(0,   'rgba(255,255,255,1)');
    coreGrad.addColorStop(0.3, `rgba(${r},${g},${bl},1)`);
    coreGrad.addColorStop(1,   `rgba(${Math.max(0,r-30)},${Math.max(0,g-30)},${bl},0.9)`);

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
    ctx.fillStyle = coreGrad;
    ctx.fill();

    // Equatorial bulge ring
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y, sr*1.35, sr*0.5, spinAngle * Math.PI/180, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(${r},${g},${bl},0.4)`;
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    // Pulsar beams — two opposing jets along spin axis
    if (isPulsar) {
      const beamAngle = spinAngle * Math.PI / 180;
      const beamLen   = sr * 9;
      for (const sign of [1, -1]) {
        const bx = sp.x + Math.cos(beamAngle + Math.PI/2 * sign) * beamLen;
        const by = sp.y + Math.sin(beamAngle + Math.PI/2 * sign) * beamLen;
        const beamGrad = ctx.createLinearGradient(sp.x, sp.y, bx, by);
        beamGrad.addColorStop(0,   `rgba(${r},${g},${bl},0.9)`);
        beamGrad.addColorStop(0.4, `rgba(${r},${g},${bl},0.3)`);
        beamGrad.addColorStop(1,   `rgba(${r},${g},${bl},0)`);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = beamGrad;
        ctx.lineWidth   = Math.max(1, sr * 0.5);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // ── Comet ───────────────────────────────────────────────
  _drawComet(ctx, sp, sr, body) {
    ctx.save();
    const r  = parseInt(body.color.slice(1,3),16);
    const g  = parseInt(body.color.slice(3,5),16);
    const bl = parseInt(body.color.slice(5,7),16);

    // Nucleus
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, Math.max(2, sr), 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fill();

    // Coma — halo that grows near stars
    if (body.comaIntensity > 0.05) {
      const comaR = sr * (3 + body.comaIntensity * 5);
      const coma  = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, comaR);
      coma.addColorStop(0,   `rgba(${r},${g},${bl},${body.comaIntensity * 0.5})`);
      coma.addColorStop(0.5, `rgba(${r},${g},${bl},${body.comaIntensity * 0.15})`);
      coma.addColorStop(1,   `rgba(${r},${g},${bl},0)`);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, comaR, 0, Math.PI * 2);
      ctx.fillStyle = coma;
      ctx.fill();
    }

    ctx.restore();
  }

  // ── Velocity arrow + orbit preview ─────────────────────
  // velArrow = { fromWorld, toScreen }
  // Draws the arrow, speed labels, and — when there's a dominant
  // attractor nearby — a predicted circular-orbit radius ring.
  _drawVelArrow(velArrow, camera, bodies, selectedId) {
    const ctx = this.ctx;
    const { fromWorld, toScreen } = velArrow;
    const sp  = camera.worldToScreen(fromWorld.x, fromWorld.y, this.canvas);

    const dx  = toScreen.x - sp.x;
    const dy  = toScreen.y - sp.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 4) return;

    const angle = Math.atan2(dy, dx);
    // Convert arrow pixels → AU/yr — MUST match ui.js _arrowToVelocity formula:
    // ui.js: velocity = (screen_delta / zoom) * SENSITIVITY  where SENSITIVITY=10
    // Old renderer used scale=100*zoom which was 1000x smaller than committed velocity
    const SENSITIVITY = 10;
    const speedAUyr = (len / camera.zoom) * SENSITIVITY;
    const speedKms  = speedAUyr * SIM.velUnit;

    // ── Orbit preview ring ────────────────────────────────
    // Find the most massive other body (the "attractor")
    const G = SIM.G;  // use canonical value from Body.js
    let attractor = null;
    for (const b of bodies) {
      if (b.id === selectedId) continue;
      if (!attractor || b.mass > attractor.mass) attractor = b;
    }
    if (attractor) {
      // Vis-viva: v² = G·M·(2/r − 1/a)  — for circular orbit a=r, so v_circ=√(GM/r)
      // We invert to find what radius gives the current speed: r_circ = GM / v²
      const v2 = speedAUyr * speedAUyr;
      if (v2 > 1e-10) {
        const r_circ = G * attractor.mass / v2;
        const asc    = camera.worldToScreen(attractor.x, attractor.y, this.canvas);
        const r_px   = camera.worldSizeToScreen(r_circ);

        // Only draw if orbit fits reasonably on screen
        if (r_px > 10 && r_px < 8000) {
          // Color: green if close to circular, yellow/red if hyperbolic
          // Actual distance from attractor
          const actualDist = Math.sqrt(
            (fromWorld.x - attractor.x)**2 + (fromWorld.y - attractor.y)**2
          );
          const v_circ = Math.sqrt(G * attractor.mass / actualDist);
          const v_esc  = v_circ * Math.sqrt(2);
          let   orbitColor;
          if (speedAUyr < v_circ * 0.98)       orbitColor = 'rgba(80,200,120,0.25)';   // sub-circular (ellipse)
          else if (speedAUyr < v_esc * 0.98)    orbitColor = 'rgba(80,200,255,0.25)';   // near-circular (blue)
          else                                   orbitColor = 'rgba(255,120,60,0.25)';   // escape (red)

          ctx.save();
          ctx.beginPath();
          ctx.arc(asc.x, asc.y, r_px, 0, Math.PI * 2);
          ctx.strokeStyle = orbitColor.replace('0.25', '0.5');
          ctx.lineWidth   = 1;
          ctx.setLineDash([4, 6]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Subtle fill
          ctx.beginPath();
          ctx.arc(asc.x, asc.y, r_px, 0, Math.PI * 2);
          ctx.fillStyle = orbitColor;
          ctx.fill();
          ctx.restore();

          // Label: orbit type with non-overlapping speed bands
          // ELLIPTIC  → v < 95% of circular
          // CIRCULAR  → 95%–110% of circular (stable orbit zone)
          // HYPERBOLIC→ v > escape velocity
          const orbitType = speedAUyr > v_esc         ? 'HYPERBOLIC'
                          : speedAUyr > v_circ * 1.10 ? 'SUPER-CIRC'
                          : speedAUyr > v_circ * 0.95 ? 'CIRCULAR'
                          :                             'ELLIPTIC';
          const labelColor = speedAUyr > v_esc         ? 'rgba(255,120,60,0.95)'
                           : speedAUyr > v_circ * 0.95 ? 'rgba(80,200,255,0.95)'
                           :                             'rgba(80,200,120,0.95)';
          ctx.save();
          ctx.font      = '700 9px "Orbitron", monospace';
          ctx.fillStyle = labelColor;
          ctx.textAlign = 'left';
          // Position label at top-right of ring, clamped so it doesn't fly off screen
          const labX = Math.min(this.canvas.width  - 90, asc.x + r_px * 0.707 + 6);
          const labY = Math.max(16,                      asc.y - r_px * 0.707 - 4);
          ctx.fillText(orbitType, labX, labY);
          ctx.restore();
        }
      }
    }

    // ── Arrow shaft ───────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = 'rgba(80,210,255,0.92)';
    ctx.fillStyle   = 'rgba(80,210,255,0.92)';
    ctx.lineWidth   = 2;
    ctx.shadowColor = 'rgba(80,210,255,0.5)';
    ctx.shadowBlur  = 8;

    // Dashed shaft
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(toScreen.x, toScreen.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    const hs = 10;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(toScreen.x, toScreen.y);
    ctx.lineTo(toScreen.x - hs * Math.cos(angle - 0.38), toScreen.y - hs * Math.sin(angle - 0.38));
    ctx.lineTo(toScreen.x - hs * Math.cos(angle + 0.38), toScreen.y - hs * Math.sin(angle + 0.38));
    ctx.closePath();
    ctx.fill();

    // ── Speed labels ─────────────────────────────────────
    ctx.shadowBlur = 0;
    const lx = toScreen.x + 12;
    const ly = toScreen.y - 10;

    // Background pill — manual path, roundRect not available in Firefox <112 / Safari <15.4
    ctx.fillStyle = 'rgba(5,8,16,0.82)';
    ctx.beginPath();
    const px = lx - 4, py = ly - 14, pw = 116, ph = 32, pr = 4;
    ctx.moveTo(px + pr, py);
    ctx.lineTo(px + pw - pr, py);
    ctx.arcTo(px+pw, py,    px+pw, py+pr,    pr);
    ctx.lineTo(px+pw, py+ph-pr);
    ctx.arcTo(px+pw, py+ph, px+pw-pr, py+ph, pr);
    ctx.lineTo(px+pr, py+ph);
    ctx.arcTo(px, py+ph, px, py+ph-pr, pr);
    ctx.lineTo(px, py+pr);
    ctx.arcTo(px, py, px+pr, py, pr);
    ctx.closePath();
    ctx.fill();

    ctx.font      = '700 10px "Orbitron", monospace';
    ctx.fillStyle = 'rgba(160,230,255,0.98)';
    ctx.textAlign = 'left';
    ctx.fillText(speedKms.toFixed(1) + ' km/s', lx, ly);

    ctx.font      = '9px "Space Mono", monospace';
    ctx.fillStyle = 'rgba(100,180,220,0.7)';
    ctx.fillText(speedAUyr.toFixed(3) + ' AU/yr', lx, ly + 13);

    ctx.restore();
  }
}
