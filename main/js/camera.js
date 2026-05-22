// camera.js — world/screen coordinate transform + pan/zoom

export class Camera {
  constructor() {
    this.x = 0;          // world origin at screen center offset
    this.y = 0;
    this.zoom = 1.0;
    this.minZoom = 0.002;
    this.maxZoom = 50;
  }

  // world coords → screen pixel coords
  worldToScreen(wx, wy, canvas) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return {
      x: cx + (wx - this.x) * this.zoom,
      y: cy + (wy - this.y) * this.zoom
    };
  }

  // screen pixel coords → world coords
  screenToWorld(sx, sy, canvas) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return {
      x: (sx - cx) / this.zoom + this.x,
      y: (sy - cy) / this.zoom + this.y
    };
  }

  // scale a world-size to screen pixels
  worldSizeToScreen(size) {
    return size * this.zoom;
  }

  // apply zoom centered on screen point (sx, sy)
  zoomAt(sx, sy, factor, canvas) {
    const before = this.screenToWorld(sx, sy, canvas);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy, canvas);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1.0;
  }

  // Fit all bodies in view with padding
  fitBodies(bodies, canvas) {
    if (bodies.length === 0) { this.reset(); return; }
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const b of bodies) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y);
    }
    const padFactor = 1.4;
    const rangeX = (maxX - minX) * padFactor || 200;
    const rangeY = (maxY - minY) * padFactor || 200;
    this.x = (minX + maxX) / 2;
    this.y = (minY + maxY) / 2;
    this.zoom = Math.min(
      canvas.width / rangeX,
      canvas.height / rangeY,
      this.maxZoom
    );
    this.zoom = Math.max(this.zoom, this.minZoom);
  }
}
