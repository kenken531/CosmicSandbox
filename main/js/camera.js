// camera.js — world/screen coordinate transform + pan/zoom

export class Camera {
  constructor() {
    this.x    = 0;
    this.y    = 0;
    this.zoom = 1.0;
    this.minZoom = 0.002;
    this.maxZoom = 500;
  }

  worldToScreen(wx, wy, canvas) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return { x: cx + (wx - this.x) * this.zoom, y: cy + (wy - this.y) * this.zoom };
  }

  screenToWorld(sx, sy, canvas) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return { x: (sx - cx) / this.zoom + this.x, y: (sy - cy) / this.zoom + this.y };
  }

  worldSizeToScreen(size) { return size * this.zoom; }

  zoomAt(sx, sy, factor, canvas) {
    const before = this.screenToWorld(sx, sy, canvas);
    this.zoom    = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after  = this.screenToWorld(sx, sy, canvas);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  reset() { this.x = 0; this.y = 0; this.zoom = 40; }

  // Fit all bodies in view with comfortable padding.
  // BUG2 FIX: single-body case uses a meaningful default zoom (40 px/AU)
  // instead of zoom=1 which made everything 1 pixel.
  fitBodies(bodies, canvas) {
    if (bodies.length === 0) { this.reset(); return; }

    // Include body radii in extent so the body isn't clipped at the edge
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const b of bodies) {
      const r = b.radius || 0;
      minX = Math.min(minX, b.x - r);
      maxX = Math.max(maxX, b.x + r);
      minY = Math.min(minY, b.y - r);
      maxY = Math.max(maxY, b.y + r);
    }

    this.x = (minX + maxX) / 2;
    this.y = (minY + maxY) / 2;

    const rangeX = maxX - minX;
    const rangeY = maxY - minY;

    if (rangeX < 0.01 && rangeY < 0.01) {
      // Single body or all bodies at same point — use a scale that makes
      // the body look like a comfortable ~30px dot: zoom = 30 / radius
      const r = bodies[0].radius || 0.25;
      this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, 60 / r));
    } else {
      const pad  = 1.5;  // 50% padding around the system
      this.zoom  = Math.min(
        canvas.width  / (rangeX * pad),
        canvas.height / (rangeY * pad),
        this.maxZoom
      );
      this.zoom = Math.max(this.zoom, this.minZoom);
    }
  }
}
