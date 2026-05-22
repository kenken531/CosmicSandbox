// renderer.js — Canvas 2D rendering pipeline

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.stars  = [];           // static background stars
    this.offscreen = null;      // offscreen canvas for starfield
    this._initStarfield();
  }

  _initStarfield() {
    // Generate once, blit every frame
    this.offscreen = document.createElement('canvas');
    this._rebuildStarfield();
  }

  _rebuildStarfield() {
    const w = this.canvas.width  || window.innerWidth;
    const h = this.canvas.height || window.innerHeight;
    this.offscreen.width  = w;
    this.offscreen.height = h;
    const ctx = this.offscreen.getContext('2d');
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, w, h);

    this.stars = [];
    const count = Math.floor((w * h) / 1200);
    for (let i = 0; i < count; i++) {
      const x    = Math.random() * w;
      const y    = Math.random() * h;
      const r    = Math.random() < 0.04 ? Math.random() * 1.4 + 0.8
                 : Math.random() < 0.2  ? Math.random() * 0.6 + 0.5
                 : Math.random() * 0.4 + 0.2;
      const opacity = Math.random() * 0.5 + 0.2;
      const hue = Math.random() < 0.3 ? `hsla(220,60%,90%,${opacity})`
                : Math.random() < 0.15 ? `hsla(30,80%,90%,${opacity})`
                : `hsla(200,40%,95%,${opacity})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = hue;
      ctx.fill();
    }
  }

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
    this._rebuildStarfield();
  }

  // Full frame render
  render(bodies, camera, selectedId, velArrow) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // 1. Starfield (static, no camera transform)
    ctx.drawImage(this.offscreen, 0, 0);

    // 2. Orbital trails
    this._drawTrails(bodies, camera);

    // 3. Body glows (stars only)
    for (const b of bodies) {
      if (b.type === 'star') this._drawGlow(b, camera);
    }

    // 4. Bodies
    for (const b of bodies) {
      this._drawBody(b, camera, b.id === selectedId);
    }

    // 5. Velocity arrow (during placement or when selected + dragging)
    if (velArrow) {
      this._drawVelArrow(velArrow, camera);
    }
  }

  _drawTrails(bodies, camera) {
    const ctx = this.ctx;
    for (const b of bodies) {
      const trail = b.getTrail();
      if (trail.length < 2) continue;

      ctx.beginPath();
      let started = false;
      for (let i = 0; i < trail.length; i++) {
        const sp = camera.worldToScreen(trail[i].x, trail[i].y, this.canvas);
        if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
        else          { ctx.lineTo(sp.x, sp.y); }
      }
      // Fading trail: use a gradient along the path
      const startPt = camera.worldToScreen(trail[0].x, trail[0].y, this.canvas);
      const endPt   = camera.worldToScreen(
        trail[trail.length - 1].x, trail[trail.length - 1].y, this.canvas
      );
      const grad = ctx.createLinearGradient(startPt.x, startPt.y, endPt.x, endPt.y);

      // Parse color for trail tint
      const hex = b.color;
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const bl = parseInt(hex.slice(5,7),16);
      grad.addColorStop(0,   `rgba(${r},${g},${bl},0)`);
      grad.addColorStop(0.7, `rgba(${r},${g},${bl},0.15)`);
      grad.addColorStop(1,   `rgba(${r},${g},${bl},0.55)`);

      ctx.strokeStyle = grad;
      ctx.lineWidth   = 1;
      ctx.stroke();
    }
  }

  _drawGlow(b, camera) {
    const ctx = this.ctx;
    const sp  = camera.worldToScreen(b.x, b.y, this.canvas);
    const sr  = Math.max(2, camera.worldSizeToScreen(b.radius));

    const hex = b.color;
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const bl = parseInt(hex.slice(5,7),16);

    // Multiple halo rings
    const layers = [
      { factor: 5,  alpha: 0.04 },
      { factor: 3,  alpha: 0.08 },
      { factor: 1.8,alpha: 0.15 },
    ];
    for (const layer of layers) {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr * layer.factor, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${bl},${layer.alpha})`;
      ctx.fill();
    }
  }

  _drawBody(b, camera, selected) {
    const ctx = this.ctx;
    const sp  = camera.worldToScreen(b.x, b.y, this.canvas);
    const sr  = Math.max(2, camera.worldSizeToScreen(b.radius));

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.fill();

    // Inner highlight
    ctx.beginPath();
    ctx.arc(sp.x - sr * 0.25, sp.y - sr * 0.3, sr * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();

    // Selection ring
    if (selected) {
      const ringR = sr + 5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(91,142,255,0.9)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = 'rgba(200,220,255,0.8)';
      ctx.font = '10px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.name, sp.x, sp.y - ringR - 6);
    }

    // Always show label for stars
    if (b.type === 'star' && !selected) {
      ctx.fillStyle = 'rgba(255,200,80,0.6)';
      ctx.font = '9px "Space Mono", monospace';
      ctx.textAlign = 'center';
      const displaySr = Math.max(2, camera.worldSizeToScreen(b.radius));
      ctx.fillText(b.name, sp.x, sp.y - displaySr - 5);
    }
  }

  _drawVelArrow(velArrow, camera) {
    const ctx = this.ctx;
    const { fromWorld, toScreen } = velArrow;
    const sp = camera.worldToScreen(fromWorld.x, fromWorld.y, this.canvas);

    const dx = toScreen.x - sp.x;
    const dy = toScreen.y - sp.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 4) return;

    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.strokeStyle = 'rgba(91,200,255,0.85)';
    ctx.fillStyle   = 'rgba(91,200,255,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);

    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(toScreen.x, toScreen.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    const hs = 8;
    ctx.beginPath();
    ctx.moveTo(toScreen.x, toScreen.y);
    ctx.lineTo(
      toScreen.x - hs * Math.cos(angle - 0.4),
      toScreen.y - hs * Math.sin(angle - 0.4)
    );
    ctx.lineTo(
      toScreen.x - hs * Math.cos(angle + 0.4),
      toScreen.y - hs * Math.sin(angle + 0.4)
    );
    ctx.closePath();
    ctx.fill();

    // Speed label
    const speedVal = (len / 80).toFixed(1);
    ctx.fillStyle = 'rgba(150,220,255,0.9)';
    ctx.font = '10px "Space Mono",monospace';
    ctx.fillText(`${speedVal} AU/yr`, toScreen.x + 8, toScreen.y - 6);

    ctx.restore();
  }
}
