// renderer.js — Canvas 2D rendering: starfield, trails, glows, bodies, overlays
import { SIM, hexRgb } from './bodies/Body.js';

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
  render(bodies, camera, selectedId, velArrow, physics) {
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
    if (velArrow) this._drawVelArrow(velArrow, camera, bodies, selectedId, physics);
  }

  // ── Permanent trails (full history, never cleared) ────────
  _drawPermTrails(bodies, camera) {
    const ctx = this.ctx;
    // Fixed jump threshold: perm trail records every 4 physics steps so consecutive
    // points are always close together unless the body was teleported (drag, preset load).
    // 100 AU² = 10 AU gap — catches any genuine teleport, never triggers on real motion.
    const JUMP_SQ_PERM = 100;

    for (const b of bodies) {
      const trail = b.permTrail;
      if (!trail || trail.length < 2) continue;
      const hex = b.color;
      const [r, g, bl] = hexRgb(hex);

      ctx.beginPath();
      let started = false;
      for (let i = 0; i < trail.length - 1; i++) {
        const wdx = trail[i+1].x - trail[i].x;
        const wdy = trail[i+1].y - trail[i].y;
        if (wdx*wdx + wdy*wdy > JUMP_SQ_PERM) {
          // Gap (body was teleported/dragged) — commit and restart
          ctx.strokeStyle = `rgba(${r},${g},${bl},0.18)`;
          ctx.lineWidth   = 0.8;
          ctx.stroke();
          ctx.beginPath();
          started = false;
          continue;
        }
        const sp = camera.worldToScreen(trail[i].x, trail[i].y, this.canvas);
        if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
        else {
          const sp2 = camera.worldToScreen(trail[i+1].x, trail[i+1].y, this.canvas);
          ctx.lineTo(sp2.x, sp2.y);
        }
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
    // 4 opacity bands: oldest (faintest) to newest (brightest)
    const BANDS = 4;

    for (const b of bodies) {
      const trail = b.getTrail();
      if (trail.length < 3) continue;
      // getTrail() always returns points in chronological order (handles ring-buffer
      // reordering internally), so we can draw straight sequential paths — no jump
      // detection needed here. Position teleports are handled by clearTrail/clearPermTrail.
      const [r, g, bl] = hexRgb(b.color);
      const segs = trail.length - 1;

      for (let band = 0; band < BANDS; band++) {
        const t0    = band / BANDS, t1 = (band + 1) / BANDS;
        const alpha = (t1 * t1) * 0.55;
        const lw    = band < 2 ? 0.5 : 1.0;

        const iStart = Math.floor(t0 * segs);
        const iEnd   = Math.min(segs, Math.ceil(t1 * segs));

        ctx.beginPath();
        const p0 = camera.worldToScreen(trail[iStart].x, trail[iStart].y, this.canvas);
        ctx.moveTo(p0.x, p0.y);
        for (let i = iStart + 1; i <= iEnd; i++) {
          const p = camera.worldToScreen(trail[i].x, trail[i].y, this.canvas);
          ctx.lineTo(p.x, p.y);
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
    const [r, g, bl] = hexRgb(hex);

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
    const [r, g, bl] = hexRgb(hex);

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
      ctx.lineWidth = 1; // reset lineWidth so outer draws are not affected

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
    const [r, g, bl] = hexRgb(body.color);

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

  // ── Velocity arrow ───────────────────────────────────────
  // velArrow = { fromWorld, toScreen, _snapped }
  // Draws orbit ring, predicted trace, snap indicator, and arrow shaft.
  _drawVelArrow(velArrow, camera, bodies, selectedId, physics) {
    const ctx = this.ctx;
    const { fromWorld, toScreen } = velArrow;
    const sp  = camera.worldToScreen(fromWorld.x, fromWorld.y, this.canvas);
    const dx  = toScreen.x - sp.x, dy = toScreen.y - sp.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 4) return;

    const SENSITIVITY = 2.5;
    const speedAUyr = (len / camera.zoom) * SENSITIVITY;
    const speedKms  = speedAUyr * SIM.velUnit;
    const angle     = Math.atan2(dy, dx);
    const G         = (physics && physics.G) ? physics.G : SIM.G;

    // Find dominant attractor (most massive other body)
    let attractor = null;
    for (const b of bodies) {
      if (b.id !== selectedId && (!attractor || b.mass > attractor.mass)) attractor = b;
    }

    this._drawOrbitRing(ctx, camera, attractor, fromWorld, speedAUyr, G);
    this._drawPredictedTrace(ctx, camera, bodies, selectedId, attractor, velArrow, sp, toScreen, G, SENSITIVITY);
    this._drawSnapIndicator(ctx, sp, velArrow);
    this._drawArrowShaft(ctx, sp, toScreen, angle, speedAUyr, speedKms, velArrow);
  }

  // ── Orbit preview ring ────────────────────────────────────
  _drawOrbitRing(ctx, camera, attractor, fromWorld, speedAUyr, G) {
    if (!attractor) return;
    const v2 = speedAUyr * speedAUyr;
    if (v2 <= 1e-10) return;
    const r_circ = G * attractor.mass / v2;
    const asc    = camera.worldToScreen(attractor.x, attractor.y, this.canvas);
    const r_px   = camera.worldSizeToScreen(r_circ);
    if (r_px < 10 || r_px > 8000) return;

    const actualDist = Math.sqrt((fromWorld.x-attractor.x)**2 + (fromWorld.y-attractor.y)**2);
    const v_circ     = Math.sqrt(G * attractor.mass / actualDist);
    const v_esc      = v_circ * Math.sqrt(2);
    const orbitColor =
      speedAUyr < v_circ * 0.98 ? 'rgba(80,200,120,0.25)' :
      speedAUyr < v_esc  * 0.98 ? 'rgba(80,200,255,0.25)' :
                                   'rgba(255,120,60,0.25)';

    ctx.save();
    ctx.beginPath();
    ctx.arc(asc.x, asc.y, r_px, 0, Math.PI * 2);
    ctx.strokeStyle = orbitColor.replace('0.25','0.5');
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(asc.x, asc.y, r_px, 0, Math.PI * 2);
    ctx.fillStyle = orbitColor;
    ctx.fill();
    ctx.restore();

    const orbitType =
      speedAUyr > v_esc        ? 'HYPERBOLIC' :
      speedAUyr > v_circ*1.10  ? 'SUPER-CIRC' :
      speedAUyr > v_circ*0.95  ? 'CIRCULAR'   : 'ELLIPTIC';
    const labelColor =
      speedAUyr > v_esc        ? 'rgba(255,120,60,0.95)' :
      speedAUyr > v_circ*0.95  ? 'rgba(80,200,255,0.95)' : 'rgba(80,200,120,0.95)';
    ctx.save();
    ctx.font      = '700 9px "Orbitron", monospace';
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'left';
    const labX = Math.min(this.canvas.width  - 90, asc.x + r_px * 0.707 + 6);
    const labY = Math.max(16,                      asc.y - r_px * 0.707 - 4);
    ctx.fillText(orbitType, labX, labY);
    ctx.restore();
  }

  // ── Predicted orbit trace (Velocity Verlet, single attractor) ─
  _drawPredictedTrace(ctx, camera, bodies, selectedId, attractor, velArrow, sp, toScreen, G, SENSITIVITY) {
    if (!attractor) return;
    const body = bodies.find(b => b.id === selectedId);
    if (!body) return;

    let traceVx, traceVy;
    if (velArrow._snapped) {
      const dx = body.x - attractor.x, dy = body.y - attractor.y;
      const r  = Math.sqrt(dx*dx + dy*dy);
      const v_circ  = Math.sqrt(G * attractor.mass / r);
      const perpCCW = { x: -dy/r, y: dx/r };
      const perpCW  = { x:  dy/r, y: -dx/r };
      const rawVx = (toScreen.x - sp.x) / camera.zoom * SENSITIVITY;
      const rawVy = (toScreen.y - sp.y) / camera.zoom * SENSITIVITY;
      const perp  = (rawVx * perpCCW.x + rawVy * perpCCW.y) >= 0 ? perpCCW : perpCW;
      traceVx = perp.x * v_circ;
      traceVy = perp.y * v_circ;
    } else {
      traceVx = (toScreen.x - sp.x) / camera.zoom * SENSITIVITY;
      traceVy = (toScreen.y - sp.y) / camera.zoom * SENSITIVITY;
    }

    // Velocity Verlet integration (replaces old Euler — much more accurate near BH)
    const traceDt  = 0.004;
    const traceMax = 500;
    let tx = body.x, ty = body.y, tvx = traceVx, tvy = traceVy;

    // Compute initial acceleration
    const adx0 = attractor.x - tx, ady0 = attractor.y - ty;
    const ar2_0 = adx0*adx0 + ady0*ady0 + 0.0025;
    const ar3_0 = ar2_0 * Math.sqrt(ar2_0);
    let ax_old = G * attractor.mass * adx0 / ar3_0;
    let ay_old = G * attractor.mass * ady0 / ar3_0;

    const pts = [camera.worldToScreen(tx, ty, this.canvas)];
    for (let t = 0; t < traceMax; t++) {
      // Step 1: position with current acceleration
      tx += tvx * traceDt + 0.5 * ax_old * traceDt * traceDt;
      ty += tvy * traceDt + 0.5 * ay_old * traceDt * traceDt;
      // Step 2: recompute acceleration at new position
      const adx = attractor.x - tx, ady = attractor.y - ty;
      const ar2 = adx*adx + ady*ady + 0.0025;
      const ar3 = ar2 * Math.sqrt(ar2);
      const ax_new = G * attractor.mass * adx / ar3;
      const ay_new = G * attractor.mass * ady / ar3;
      // Step 3: velocity with average acceleration
      tvx += 0.5 * (ax_old + ax_new) * traceDt;
      tvy += 0.5 * (ay_old + ay_new) * traceDt;
      ax_old = ax_new; ay_old = ay_new;

      pts.push(camera.worldToScreen(tx, ty, this.canvas));
      // Early exit: loop closed
      if (t > 60) {
        const dsx = pts[pts.length-1].x - pts[0].x;
        const dsy = pts[pts.length-1].y - pts[0].y;
        if (dsx*dsx + dsy*dsy < 100) break;
      }
      // Early exit: far offscreen
      const p = pts[pts.length-1];
      if (p.x < -400 || p.x > this.canvas.width+400 || p.y < -400 || p.y > this.canvas.height+400) break;
    }
    if (pts.length < 3) return;

    const actualDist = Math.sqrt((body.x-attractor.x)**2 + (body.y-attractor.y)**2);
    const v_esc      = Math.sqrt(2 * G * attractor.mass / actualDist);
    const traceVspd  = Math.sqrt(traceVx*traceVx + traceVy*traceVy);
    const traceColor = velArrow._snapped         ? 'rgba(80,255,160,0.55)'
                     : traceVspd > v_esc         ? 'rgba(255,120,60,0.45)'
                     :                             'rgba(80,210,255,0.35)';
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = traceColor;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Circular lock indicator ──────────────────────────────
  _drawSnapIndicator(ctx, sp, velArrow) {
    if (!velArrow._snapped) return;
    ctx.save();
    ctx.font      = '700 9px "Orbitron", monospace';
    ctx.fillStyle = 'rgba(80,255,160,0.95)';
    ctx.textAlign = 'center';
    ctx.fillText('⊙ CIRCULAR LOCK', sp.x, sp.y - 18);
    ctx.restore();
  }

  // ── Arrow shaft, arrowhead, and speed label pill ─────────
  _drawArrowShaft(ctx, sp, toScreen, angle, speedAUyr, speedKms, velArrow) {
    const arrowColor = velArrow._snapped ? 'rgba(80,255,160,0.92)' : 'rgba(80,210,255,0.92)';
    const arrowGlow  = velArrow._snapped ? 'rgba(80,255,160,0.5)'  : 'rgba(80,210,255,0.5)';
    ctx.save();
    ctx.strokeStyle = arrowColor;
    ctx.fillStyle   = arrowColor;
    ctx.lineWidth   = velArrow._snapped ? 2.5 : 2;
    ctx.shadowColor = arrowGlow;
    ctx.shadowBlur  = velArrow._snapped ? 14 : 8;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(toScreen.x, toScreen.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const hs = 10;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(toScreen.x, toScreen.y);
    ctx.lineTo(toScreen.x - hs*Math.cos(angle-0.38), toScreen.y - hs*Math.sin(angle-0.38));
    ctx.lineTo(toScreen.x - hs*Math.cos(angle+0.38), toScreen.y - hs*Math.sin(angle+0.38));
    ctx.closePath();
    ctx.fill();

    // Speed label pill
    ctx.shadowBlur = 0;
    const lx = toScreen.x + 12, ly = toScreen.y - 10;
    ctx.fillStyle = 'rgba(5,8,16,0.82)';
    ctx.beginPath();
    const px=lx-4, py=ly-14, pw=116, ph=32, pr=4;
    ctx.moveTo(px+pr, py);
    ctx.lineTo(px+pw-pr, py);   ctx.arcTo(px+pw,py,    px+pw,py+pr,   pr);
    ctx.lineTo(px+pw, py+ph-pr); ctx.arcTo(px+pw,py+ph, px+pw-pr,py+ph,pr);
    ctx.lineTo(px+pr, py+ph);   ctx.arcTo(px,py+ph, px,py+ph-pr,pr);
    ctx.lineTo(px, py+pr);      ctx.arcTo(px,py, px+pr,py,pr);
    ctx.closePath();
    ctx.fill();

    ctx.font      = '700 10px "Orbitron", monospace';
    ctx.fillStyle = velArrow._snapped ? 'rgba(80,255,160,0.98)' : 'rgba(160,230,255,0.98)';
    ctx.textAlign = 'left';
    ctx.fillText(speedKms.toFixed(1) + ' km/s', lx, ly);
    ctx.font      = '9px "Space Mono", monospace';
    ctx.fillStyle = velArrow._snapped ? 'rgba(80,220,140,0.8)' : 'rgba(100,180,220,0.7)';
    ctx.fillText(speedAUyr.toFixed(3) + ' AU/yr', lx, ly + 13);
    ctx.restore();
  }
}