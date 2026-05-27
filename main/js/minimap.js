// minimap.js — small overview canvas showing all bodies and viewport rect

export class Minimap {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx    = canvasEl.getContext('2d');
    this.padding = 10; // world-space padding around extents
  }

  render(bodies, camera, mainCanvas) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(5,8,16,0.0)';
    ctx.fillRect(0, 0, W, H);

    if (bodies.length === 0) return;

    // Compute world extents
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const b of bodies) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y);
    }
    // Add padding
    const pad = Math.max((maxX - minX) * 0.2, this.padding);
    minX -= pad; maxX += pad;
    minY -= pad; maxY += pad;

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // Keep aspect, fit within minimap with margin
    const margin = 8;
    const mW = W - margin * 2;
    const mH = H - margin * 2;
    const scale = Math.min(mW / rangeX, mH / rangeY);
    const offX = margin + (mW - rangeX * scale) / 2;
    const offY = margin + (mH - rangeY * scale) / 2;

    const toMini = (wx, wy) => ({
      x: offX + (wx - minX) * scale,
      y: offY + (wy - minY) * scale
    });

    // Draw trails (LOD: stride proportional to trail length so we never draw > 80 segments per body)
    const MAX_TRAIL_SEGS = 80;
    for (const b of bodies) {
      const trail = b.getTrail();
      if (trail.length < 2) continue;
      const stride = Math.max(1, Math.ceil(trail.length / MAX_TRAIL_SEGS));
      const hex = b.color;
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const bl = parseInt(hex.slice(5,7),16);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < trail.length; i += stride) {
        const p = toMini(trail[i].x, trail[i].y);
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      // Always include the very last point for accuracy
      const last = trail[trail.length - 1];
      const lp   = toMini(last.x, last.y);
      ctx.lineTo(lp.x, lp.y);
      ctx.strokeStyle = `rgba(${r},${g},${bl},0.3)`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Draw bodies
    for (const b of bodies) {
      const p = toMini(b.x, b.y);
      const dotR = b.type === 'star' ? 3 : 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
    }

    // Draw viewport rectangle
    const topLeft     = camera.screenToWorld(0, 0, mainCanvas);
    const bottomRight = camera.screenToWorld(mainCanvas.width, mainCanvas.height, mainCanvas);

    const vpTL = toMini(topLeft.x, topLeft.y);
    const vpBR = toMini(bottomRight.x, bottomRight.y);

    ctx.strokeStyle = 'rgba(91,142,255,0.5)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(vpTL.x, vpTL.y, vpBR.x - vpTL.x, vpBR.y - vpTL.y);

    // ── Scale bar ────────────────────────────────────────
    // Choose a round-number distance that fits nicely in the minimap
    // Pick the largest of: 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250 AU
    // that maps to between 15 and 55 minimap pixels.
    const NICE = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
    let barAU = NICE[0];
    for (const v of NICE) {
      const px = v * scale;
      if (px >= 15 && px <= 55) barAU = v;
    }
    const barPx = barAU * scale;
    const barLabel = barAU >= 1 ? barAU.toFixed(0) + ' AU' : barAU + ' AU';

    const bx = offX;
    const by = offY + (rangeY * scale) + 6;  // just below the mapped world extent

    ctx.fillStyle    = 'rgba(91,142,255,0.85)';
    ctx.fillRect(bx, by, barPx, 2);
    // End ticks
    ctx.fillRect(bx,          by - 3, 1.5, 8);
    ctx.fillRect(bx + barPx - 1.5, by - 3, 1.5, 8);

    ctx.font      = '8px "Space Mono", monospace';
    ctx.fillStyle = 'rgba(150,180,255,0.8)';
    ctx.textAlign = 'left';
    ctx.fillText(barLabel, bx, by + 12);
  }
}
