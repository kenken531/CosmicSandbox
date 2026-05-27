// ui.js — interaction layer

import { Body, SIM } from './bodies/Body.js';
import { PRESETS } from './presets.js';

// ── Helpers ───────────────────────────────────────────────
function vxyToSpeedDir(vx, vy) {
  const speedAUyr = Math.sqrt(vx*vx + vy*vy);
  const speedKms  = speedAUyr * SIM.velUnit;
  let deg = Math.atan2(vy, vx) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return { speedKms, deg };
}

function speedDirToVxy(speedKms, deg) {
  const speedAUyr = speedKms / SIM.velUnit;
  const rad = deg * Math.PI / 180;
  return { vx: speedAUyr * Math.cos(rad), vy: speedAUyr * Math.sin(rad) };
}

// Mass display helpers
// Planets/comets: Earth masses (1 M⊕ = 6 units)
// Stars/BH/NS/Pulsars: Solar masses (1 M☉ = 1,989,000 units)
const STELLAR_TYPES = new Set(['star','blackhole','neutronstar','pulsar']);
const M_EARTH  = 6;
const M_SUN    = 1989000;

function massToDisplay(body) {
  if (STELLAR_TYPES.has(body.type)) return { val: body.mass / M_SUN,    unit: 'M☉ (solar masses)' };
  return                                   { val: body.mass / M_EARTH,  unit: 'M⊕ (Earth masses)' };
}
function displayToMass(val, type) {
  if (STELLAR_TYPES.has(type)) return val * M_SUN;
  return                              val * M_EARTH;
}

export class UI {
  constructor(canvas, camera, bodies, physics, renderer, onUpdate) {
    this.canvas   = canvas;
    this.camera   = camera;
    this.bodies   = bodies;
    this.physics  = physics;
    this.renderer = renderer;
    this.onUpdate = onUpdate;

    this.selectedId = null;
    this.velArrow   = null;  // { fromWorld, toScreen } — read by renderer

    // ── Drag state machine ────────────────────────────────
    // Three mutually exclusive drag modes: PAN, BODY_MOVE, VEL_ARROW
    // Mode is decided on first mousemove after mousedown (>8px threshold for body clicks)
    this._dragMode     = 'none';  // 'none' | 'pan' | 'body' | 'vel'
    this._dragBodyId   = null;    // which body is being dragged (body or vel mode)
    this._dragBodyOffset = { x: 0, y: 0 };  // world-space offset for body move
    this._dragStart    = { x: 0, y: 0 };    // screen px where drag began
    this._panStart     = { x: 0, y: 0 };
    this._camAtStart   = { x: 0, y: 0 };
    this._velCommitted = false;   // true if vel arrow was long enough to commit

    // Ghost
    this._ghostType = null;
    this._ghostEl   = document.getElementById('drag-ghost');

    // Tooltip
    this._tooltipEl   = document.getElementById('tooltip');
    this._tooltipBody = null;

    // Dial drag
    this._dialDragging = false;

    this._bindEvents();
    this._bindProps();
    this._bindToolbar();
    this._bindKeyboard();
    this._buildPresetsModal();
  }

  // ─────────────────────────────────────────────────────────
  // EVENT BINDING
  // ─────────────────────────────────────────────────────────
  _bindEvents() {
    const container = this.canvas.parentElement;

    // ── Palette drag ──────────────────────────────────────
    document.querySelectorAll('.palette-item:not(.locked)').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        this._ghostType = item.dataset.type;
        this._showGhost(e.clientX, e.clientY, this._ghostType);
        e.preventDefault();
      });
    });

    // ── Global mousemove ──────────────────────────────────
    window.addEventListener('mousemove', (e) => {
      // Ghost follows cursor
      if (this._ghostType) {
        this._moveGhost(e.clientX, e.clientY);
        return;
      }

      const rect = this.canvas.getBoundingClientRect();
      const sx   = e.clientX - rect.left;
      const sy   = e.clientY - rect.top;

      // ── Decide drag mode on first significant movement ──
      if (this._dragMode === 'pending-body') {
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        if (Math.sqrt(dx*dx + dy*dy) > 8) {
          // Left-drag on a selected body → VEL ARROW
          // Hold Alt while dragging to MOVE the body instead
          if (e.altKey) {
            this._dragMode = 'body';
            container.classList.add('dragging-body');
          } else {
            this._dragMode = 'vel';
            this._velCommitted = false;
            container.classList.add('vel-dragging');
            this._hideHint();
          }
        }
      }

      // ── Body move ────────────────────────────────────────
      if (this._dragMode === 'body') {
        const world = this.camera.screenToWorld(sx, sy, this.canvas);
        const body  = this.bodies.find(b => b.id === this._dragBodyId);
        if (body) {
          body.x = world.x - this._dragBodyOffset.x;
          body.y = world.y - this._dragBodyOffset.y;
          body.clearTrail();
          if (this.selectedId === body.id) this._updatePropsPanel(body);
        }
        return;
      }

      // ── Pan ───────────────────────────────────────────────
      if (this._dragMode === 'pan') {
        const dx = e.clientX - this._panStart.x;
        const dy = e.clientY - this._panStart.y;
        this.camera.x = this._camAtStart.x - dx / this.camera.zoom;
        this.camera.y = this._camAtStart.y - dy / this.camera.zoom;
        return;
      }

      // ── Velocity arrow ────────────────────────────────────
      if (this._dragMode === 'vel') {
        const body = this.bodies.find(b => b.id === this._dragBodyId);
        if (body) {
          this.velArrow = { fromWorld: { x: body.x, y: body.y }, toScreen: { x: sx, y: sy } };
          // Live-preview in props panel
          const vel = this._arrowToVelocity(body, sx, sy);
          this._previewVelocity(vel.vx, vel.vy);
        }
        return;
      }

      // ── Tooltip on hover (idle) ───────────────────────────
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top  && e.clientY <= rect.bottom) {
        const world = this.camera.screenToWorld(sx, sy, this.canvas);
        const hit   = this._hitTest(world.x, world.y);
        if (hit && hit.id !== this.selectedId) this._showTooltip(hit, e.clientX, e.clientY);
        else this._hideTooltip();
      } else {
        this._hideTooltip();
      }
    });

    // ── Global mouseup ────────────────────────────────────
    window.addEventListener('mouseup', (e) => {
      // Drop palette ghost
      if (this._ghostType) {
        const rect = this.canvas.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top  && e.clientY <= rect.bottom) {
          const world = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top, this.canvas);
          this._placeBody(this._ghostType, world.x, world.y);
          this._showHint();
        }
        this._hideGhost();
        this._ghostType = null;
        return;
      }

      const prevMode = this._dragMode;
      this._dragMode = 'none';

      if (prevMode === 'body') {
        container.classList.remove('dragging-body');
        this.physics.markDirty();
        return;
      }

      if (prevMode === 'pan' || prevMode === 'pending-body') {
        container.classList.remove('panning');
        // pending-body with no drag = pure click → now open props panel
        if (prevMode === 'pending-body' && this._dragBodyId !== null) {
          const body = this.bodies.find(b => b.id === this._dragBodyId);
          if (body) this._openPropsPanel(body);
        }
        return;
      }

      if (prevMode === 'vel') {
        container.classList.remove('vel-dragging');
        const rect = this.canvas.getBoundingClientRect();
        const sx   = e.clientX - rect.left;
        const sy   = e.clientY - rect.top;
        const body = this.bodies.find(b => b.id === this._dragBodyId);
        if (body) {
          const vel = this._arrowToVelocity(body, sx, sy);
          // Only commit if arrow is longer than 5 screen pixels
          const ws  = this.camera.worldToScreen(body.x, body.y, this.canvas);
          const len = Math.sqrt((sx-ws.x)**2 + (sy-ws.y)**2);
          if (len > 5) {
            body.vx = vel.vx;
            body.vy = vel.vy;
            body.clearTrail();
            this.physics.markDirty();
            this._updatePropsPanel(body);
          }
        }
        this.velArrow = null;
        this._dragBodyId = null;
        this._hideHint();
      }
    });

    // ── Canvas mousedown ──────────────────────────────────
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx   = e.clientX - rect.left;
      const sy   = e.clientY - rect.top;

      // Middle or Alt+Left on empty space = pan
      if (e.button === 1) {
        e.preventDefault();
        this._dragMode   = 'pan';
        this._panStart   = { x: e.clientX, y: e.clientY };
        this._camAtStart = { x: this.camera.x, y: this.camera.y };
        container.classList.add('panning');
        return;
      }

      if (e.button === 2) { e.preventDefault(); return; }

      if (e.button === 0) {
        const world = this.camera.screenToWorld(sx, sy, this.canvas);
        const hit   = this._hitTest(world.x, world.y);

        if (hit) {
          // Only highlight selection visually on mousedown — defer opening props panel
          // until mouseup (pure click). This prevents the panel from opening and shifting
          // the canvas during a velocity-arrow drag.
          this.selectedId = hit.id;
          this._hideTooltip();
          this._dragMode   = 'pending-body';
          this._dragBodyId = hit.id;
          this._dragStart  = { x: e.clientX, y: e.clientY };
          this._dragBodyOffset = {
            x: world.x - hit.x,
            y: world.y - hit.y,
          };
        } else {
          // Empty space = pan
          this.deselect();
          this._hideHint();
          this._dragMode   = 'pan';
          this._panStart   = { x: e.clientX, y: e.clientY };
          this._camAtStart = { x: this.camera.x, y: this.camera.y };
          container.classList.add('panning');
        }
      }
    });

    // Scroll zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect   = this.canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
      this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor, this.canvas);
    }, { passive: false });

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    // ── Touch events ──────────────────────────────────────
    // Map single-finger touch → mouse-style drag (pan + vel arrow)
    // Map pinch (two-finger) → zoom
    this._bindTouch();
  }

  // ─────────────────────────────────────────────────────────
  // TOUCH SUPPORT
  // Single finger: pan (on empty) or vel-arrow (on body)
  // Two fingers:   pinch-to-zoom
  // ─────────────────────────────────────────────────────────
  _bindTouch() {
    const canvas = this.canvas;

    // Track second-touch distance for pinch
    let _pinchDist = null;

    const getTouchPos = (touch) => {
      const rect = canvas.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    };

    const pinchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx*dx + dy*dy);
    };

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();

      if (e.touches.length === 2) {
        // Entering pinch mode — cancel any ongoing drag
        this._dragMode = 'none';
        this.velArrow  = null;
        _pinchDist = pinchDistance(e.touches);
        return;
      }

      if (e.touches.length !== 1) return;
      const pos   = getTouchPos(e.touches[0]);
      const world = this.camera.screenToWorld(pos.x, pos.y, canvas);
      const hit   = this._hitTest(world.x, world.y);

      if (hit) {
        this.select(hit.id);
        this._hideTooltip();
        this._dragMode   = 'pending-body';
        this._dragBodyId = hit.id;
        this._dragStart  = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        this._dragBodyOffset = { x: world.x - hit.x, y: world.y - hit.y };
      } else {
        this.deselect();
        this._hideHint();
        this._dragMode   = 'pan';
        this._panStart   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        this._camAtStart = { x: this.camera.x, y: this.camera.y };
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();

      // ── Pinch-to-zoom ────────────────────────────────────
      if (e.touches.length === 2 && _pinchDist !== null) {
        const newDist = pinchDistance(e.touches);
        const factor  = newDist / _pinchDist;
        // Zoom around midpoint of the two fingers
        const rect  = canvas.getBoundingClientRect();
        const midX  = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
        const midY  = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
        this.camera.zoomAt(midX, midY, factor, canvas);
        _pinchDist = newDist;
        return;
      }

      if (e.touches.length !== 1) return;
      const t  = e.touches[0];
      const pos = getTouchPos(t);

      // Promote pending-body to a mode after 8px threshold
      if (this._dragMode === 'pending-body') {
        const dx = t.clientX - this._dragStart.x;
        const dy = t.clientY - this._dragStart.y;
        if (Math.sqrt(dx*dx + dy*dy) > 8) {
          // On touch, default to vel arrow (no Alt key on mobile)
          this._dragMode = 'vel';
          this._velCommitted = false;
          this._hideHint();
        }
      }

      if (this._dragMode === 'pan') {
        const dx = t.clientX - this._panStart.x;
        const dy = t.clientY - this._panStart.y;
        this.camera.x = this._camAtStart.x - dx / this.camera.zoom;
        this.camera.y = this._camAtStart.y - dy / this.camera.zoom;
        return;
      }

      if (this._dragMode === 'vel') {
        const body = this.bodies.find(b => b.id === this._dragBodyId);
        if (body) {
          this.velArrow = { fromWorld: { x: body.x, y: body.y }, toScreen: { x: pos.x, y: pos.y } };
          const vel = this._arrowToVelocity(body, pos.x, pos.y);
          this._previewVelocity(vel.vx, vel.vy);
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      _pinchDist = null;

      const prevMode = this._dragMode;
      this._dragMode = 'none';

      if (prevMode === 'vel') {
        // Find last touch (changedTouches has the lifted finger)
        const t   = e.changedTouches[0];
        const pos = getTouchPos(t);
        const body = this.bodies.find(b => b.id === this._dragBodyId);
        if (body) {
          const vel = this._arrowToVelocity(body, pos.x, pos.y);
          const ws  = this.camera.worldToScreen(body.x, body.y, canvas);
          const len = Math.sqrt((pos.x-ws.x)**2 + (pos.y-ws.y)**2);
          if (len > 5) {
            body.vx = vel.vx;
            body.vy = vel.vy;
            body.clearTrail();
            this.physics.markDirty();
            this._updatePropsPanel(body);
          }
        }
        this.velArrow    = null;
        this._dragBodyId = null;
        this._hideHint();
      }
    }, { passive: false });

    // Palette items: tap to place at canvas center (mobile-friendly alternative to drag)
    document.querySelectorAll('.palette-item:not(.locked)').forEach(item => {
      item.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const type  = item.dataset.type;
        const rect  = canvas.getBoundingClientRect();
        const world = this.camera.screenToWorld(rect.width / 2, rect.height / 2, canvas);
        this._placeBody(type, world.x, world.y);
        this._showHint();
      }, { passive: false });
    });
  }

  // ─────────────────────────────────────────────────────────
  // ARROW → VELOCITY  (zoom-invariant)
  // 100 px = 1 AU/yr at zoom=1
  // ─────────────────────────────────────────────────────────
  _arrowToVelocity(body, sx, sy) {
    const ws = this.camera.worldToScreen(body.x, body.y, this.canvas);
    // Convert screen delta → world delta → velocity
    // world_delta (AU) = screen_delta_px / zoom
    // velocity (AU/yr) = world_delta × SENSITIVITY
    // SENSITIVITY=2.5: at default zoom=40 px/AU, a 100px drag = 2.5 AU/yr × (100/40) = 6.25 AU/yr
    // = 29.6 km/s ≈ Earth orbital speed. Feels natural.
    // (Old value was 10 — 4× too fast)
    const SENSITIVITY = 2.5;
    const worldDx = (sx - ws.x) / this.camera.zoom;
    const worldDy = (sy - ws.y) / this.camera.zoom;
    let vx = worldDx * SENSITIVITY;
    let vy = worldDy * SENSITIVITY;

    // ── Circular orbit snap (fix #7) ──────────────────────
    // Find the most massive other body (attractor)
    const G = 1.9855e-5;  // SIM.G
    let attractor = null;
    for (const b of this.bodies) {
      if (b.id === body.id) continue;
      if (!attractor || b.mass > attractor.mass) attractor = b;
    }
    if (attractor) {
      const dx = body.x - attractor.x;
      const dy = body.y - attractor.y;
      const r  = Math.sqrt(dx*dx + dy*dy);
      if (r > 0.001) {
        const v_circ = Math.sqrt(G * attractor.mass / r);
        const v_curr = Math.sqrt(vx*vx + vy*vy);
        const snapZone = 0.05; // 5% tolerance
        if (Math.abs(v_curr - v_circ) / v_circ < snapZone) {
          // Snap speed to exactly v_circ, keep direction perpendicular to radius
          // Perpendicular direction (90° CCW from radius)
          const rx = dx / r, ry = dy / r;
          // Determine which perpendicular matches user's drag direction
          const perpCCW = { x: -ry, y:  rx };
          const perpCW  = { x:  ry, y: -rx };
          const dot     = vx * perpCCW.x + vy * perpCCW.y;
          const perp    = dot >= 0 ? perpCCW : perpCW;
          vx = perp.x * v_circ;
          vy = perp.y * v_circ;
          // Signal to renderer that we're snapped
          if (this.velArrow) this.velArrow._snapped = true;
        } else {
          if (this.velArrow) this.velArrow._snapped = false;
        }
      }
    }

    return { vx, vy };
  }

  _previewVelocity(vx, vy) {
    const { speedKms, deg } = vxyToSpeedDir(vx, vy);
    const se = document.getElementById('prop-speed');
    const de = document.getElementById('prop-dir');
    if (se) se.value = speedKms.toFixed(2);
    if (de) de.value = deg.toFixed(1);
    this._updateDial(deg);
  }

  // ─────────────────────────────────────────────────────────
  // HIT TEST
  // ─────────────────────────────────────────────────────────
  _hitTest(wx, wy) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b    = this.bodies[i];
      const dx   = wx - b.x, dy = wy - b.y;
      const hitR = Math.max(b.radius, 0.5 / this.camera.zoom);
      if (dx*dx + dy*dy <= hitR*hitR) return b;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────
  // PLACE BODY
  // ─────────────────────────────────────────────────────────
  _placeBody(type, wx, wy) {
    const b = new Body(type, wx, wy);
    this.bodies.push(b);
    this.select(b.id);
    this._updateHint();
    this.physics.markDirty();
    // BUG1 FIX: only auto-fit on the very first body.
    // After that respect the user's zoom — re-fitting on every drop is jarring.
    if (this.bodies.length === 1) {
      this.camera.fitBodies(this.bodies, this.canvas);
    }
    this.onUpdate();
  }

  // ─────────────────────────────────────────────────────────
  // GHOST
  // ─────────────────────────────────────────────────────────
  _showGhost(cx, cy, type) {
    const icons = {
      star:        '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="10" fill="#FFC940"/><circle cx="20" cy="20" r="14" fill="none" stroke="#FFC940" stroke-width="0.8" opacity="0.5"/></svg>',
      planet:      '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="10" fill="#4B8FDE"/><ellipse cx="20" cy="20" rx="18" ry="5" fill="none" stroke="#4B8FDE" stroke-width="1" opacity="0.5" transform="rotate(-20,20,20)"/></svg>',
      blackhole:   '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="8" fill="#000"/><circle cx="20" cy="20" r="8" fill="none" stroke="#8B5CF6" stroke-width="2"/><ellipse cx="20" cy="20" rx="18" ry="5" fill="none" stroke="#8B5CF6" stroke-width="1" opacity="0.7"/></svg>',
      neutronstar: '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="6" fill="#A0EFFF"/><ellipse cx="20" cy="20" rx="14" ry="5" fill="none" stroke="#A0EFFF" stroke-width="1" opacity="0.5"/></svg>',
      pulsar:      '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="6" fill="#80FFCC"/><line x1="20" y1="4" x2="20" y2="14" stroke="#80FFCC" stroke-width="2" stroke-linecap="round"/><line x1="20" y1="26" x2="20" y2="36" stroke="#80FFCC" stroke-width="2" stroke-linecap="round"/></svg>',
      comet:       '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="30" cy="10" r="5" fill="#C8E8FF"/><path d="M26 15 Q16 24 6 34" stroke="#C8E8FF" stroke-width="2" stroke-linecap="round" opacity="0.7"/></svg>',
    };
    this._ghostEl.innerHTML = icons[type] || '';
    this._ghostEl.style.display = 'block';
    this._moveGhost(cx, cy);
  }
  _moveGhost(cx, cy) { this._ghostEl.style.left = cx+'px'; this._ghostEl.style.top = cy+'px'; }
  _hideGhost() { this._ghostEl.style.display = 'none'; }

  // ─────────────────────────────────────────────────────────
  // TOOLTIP
  // ─────────────────────────────────────────────────────────
  _showTooltip(body, cx, cy) {
    this._tooltipBody = body.id;
    const { val: mVal, unit: mUnit } = massToDisplay(body);
    const massStr = mVal.toFixed(3) + ' ' + mUnit.split(' ')[0];
    this._tooltipEl.innerHTML =
      `<strong style="color:${body.color}">${body.name}</strong><br>` +
      `Type: ${body.type}<br>Mass: ${massStr}<br>Speed: ${body.speedKms.toFixed(1)} km/s`;
    this._tooltipEl.style.display = 'block';
    this._tooltipEl.style.left = (cx+14)+'px';
    this._tooltipEl.style.top  = (cy-10)+'px';
  }
  _hideTooltip() { this._tooltipEl.style.display = 'none'; this._tooltipBody = null; }

  // ─────────────────────────────────────────────────────────
  // VEL HINT
  // ─────────────────────────────────────────────────────────
  _showHint() { const e = document.getElementById('vel-arrow-hint'); if (e) e.classList.remove('hidden'); }
  _hideHint() { const e = document.getElementById('vel-arrow-hint'); if (e) e.classList.add('hidden'); }

  // ─────────────────────────────────────────────────────────
  // SELECTION
  // ─────────────────────────────────────────────────────────
  select(id) {
    this.selectedId = id;
    const body = this.bodies.find(b => b.id === id);
    if (body) this._openPropsPanel(body);
  }
  deselect() { this.selectedId = null; this._closePropsPanel(); }

  // ─────────────────────────────────────────────────────────
  // PROPS PANEL
  // ─────────────────────────────────────────────────────────
  _openPropsPanel(body) {
    document.getElementById('props-panel').classList.remove('hidden');
    document.body.classList.add('props-open');
    this._updatePropsPanel(body);
    // Resize canvas after CSS transition so coordinate math stays correct
    requestAnimationFrame(() => {
      const c = this.canvas.parentElement;
      this.renderer.resize(c.clientWidth, c.clientHeight);
    });
  }
  _closePropsPanel() {
    document.getElementById('props-panel').classList.add('hidden');
    document.body.classList.remove('props-open');
    requestAnimationFrame(() => {
      const c = this.canvas.parentElement;
      this.renderer.resize(c.clientWidth, c.clientHeight);
    });
  }
  _updatePropsPanel(body) {
    document.getElementById('props-type-label').textContent = body.type.toUpperCase();
    document.getElementById('prop-name').value   = body.name;
    const md = massToDisplay(body);
    document.getElementById('prop-mass').value = md.val.toFixed(4);
    const massUnitEl = document.getElementById('mass-unit-label');
    if (massUnitEl) massUnitEl.textContent = md.unit;
    document.getElementById('prop-radius').value = body.radius.toFixed(2);
    document.getElementById('prop-color').value  = body.color;
    document.getElementById('prop-color-hex').textContent = body.color;
    const { speedKms, deg } = vxyToSpeedDir(body.vx, body.vy);
    document.getElementById('prop-speed').value = speedKms.toFixed(2);
    document.getElementById('prop-dir').value   = deg.toFixed(1);
    this._updateDial(deg);
    this._updateStats(body);
  }
  _updateStats(body) {
    if (!body) return;
    document.getElementById('stat-speed').textContent = body.speedKms.toFixed(1)+' km/s';
    document.getElementById('stat-dist').textContent  = body.distAU.toFixed(2)+' AU';
  }

  // ── Dial ────────────────────────────────────────────────
  _updateDial(deg) {
    const needle = document.getElementById('dir-dial-needle');
    if (!needle) return;
    const rad = deg * Math.PI / 180;
    needle.setAttribute('x2', (16 + 13*Math.cos(rad)).toFixed(1));
    needle.setAttribute('y2', (16 + 13*Math.sin(rad)).toFixed(1));
  }

  _bindProps() {
    const getBody = () => this.bodies.find(b => b.id === this.selectedId);

    const applyVelocity = () => {
      const b = getBody(); if (!b) return;
      // FIX: use isNaN guard instead of || 0, so partial input (empty string) doesn't snap to 0°
      const rawSpeed = parseFloat(document.getElementById('prop-speed').value);
      const rawDir   = parseFloat(document.getElementById('prop-dir').value);
      const speedKms = isNaN(rawSpeed) ? 0 : rawSpeed;
      const deg      = isNaN(rawDir)   ? 0 : rawDir;
      const { vx, vy } = speedDirToVxy(speedKms, deg);
      b.vx = vx; b.vy = vy;
      b.clearTrail();
      this.physics.markDirty();
      this._updateDial(deg);
      this._updateStats(b);
    };

    document.getElementById('prop-name').addEventListener('input', e => { const b = getBody(); if (b) b.name = e.target.value; });
    document.getElementById('prop-mass').addEventListener('input', e => {
      const b = getBody(); if (!b) return;
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) b.mass = displayToMass(val, b.type);
    });
    document.getElementById('prop-radius').addEventListener('input', e => {
      const b = getBody(); if (!b) return;
      const val = parseFloat(e.target.value);
      // BUG1 FIX: clamp display radius — huge values (e.g. 6371 typed as km) break gradient rendering
      if (!isNaN(val) && val > 0) b.radius = Math.max(0.01, Math.min(50, val));
    });
    document.getElementById('prop-speed').addEventListener('input', applyVelocity);
    document.getElementById('prop-dir').addEventListener('input', applyVelocity);
    document.getElementById('prop-color').addEventListener('input', e => {
      const b = getBody();
      if (b) { b.color = e.target.value; document.getElementById('prop-color-hex').textContent = e.target.value; }
    });
    document.getElementById('btn-delete-body').addEventListener('click', () => this._deleteSelected());

    // Dial drag
    const dial = document.getElementById('dir-dial');
    if (dial) {
      const onDialMove = (e) => {
        if (!this._dialDragging) return;
        const rect = dial.getBoundingClientRect();
        let deg = Math.atan2(e.clientY - (rect.top + rect.height/2), e.clientX - (rect.left + rect.width/2)) * 180 / Math.PI;
        if (deg < 0) deg += 360;
        document.getElementById('prop-dir').value = deg.toFixed(1);
        applyVelocity();
      };
      dial.addEventListener('mousedown', (e) => { this._dialDragging = true; e.preventDefault(); e.stopPropagation(); });
      window.addEventListener('mousemove', onDialMove);
      window.addEventListener('mouseup', () => { this._dialDragging = false; });
    }
  }

  // ─────────────────────────────────────────────────────────
  // DELETE
  // ─────────────────────────────────────────────────────────
  _deleteSelected() {
    if (this.selectedId === null) return;
    const idx = this.bodies.findIndex(b => b.id === this.selectedId);
    if (idx !== -1) this.bodies.splice(idx, 1);
    this.deselect();
    this._updateHint();
    this.onUpdate();
  }

  // ─────────────────────────────────────────────────────────
  // TOOLBAR
  // ─────────────────────────────────────────────────────────
  _bindToolbar() {
    document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
    document.getElementById('btn-reset-view').addEventListener('click', () => {
      if (this.bodies.length > 0) this.camera.fitBodies(this.bodies, this.canvas);
      else this.camera.reset();
    });
    document.getElementById('btn-clear-trails').addEventListener('click', () => {
      for (const b of this.bodies) b.clearPermTrail();
    });
    document.getElementById('btn-clear').addEventListener('click', () => {
      if (this.bodies.length === 0) return;
      if (confirm('Clear all bodies?')) this._clearAll();
    });
    const slider = document.getElementById('speed-slider');
    const slabel = document.getElementById('speed-label');
    slider.addEventListener('input', () => {
      this.physics.setSpeedFromSlider(slider.value);
      slabel.textContent = this.physics.speedLabel(slider.value);
    });
    document.getElementById('btn-presets').addEventListener('click', () =>
      document.getElementById('presets-overlay').classList.remove('hidden')
    );
    document.getElementById('btn-save').addEventListener('click', () => this._saveScene());
    document.getElementById('btn-load').addEventListener('change', (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => { try { this._loadScene(JSON.parse(ev.target.result)); } catch { alert('Invalid scene file.'); } };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  togglePlay() {
    this.physics.running = !this.physics.running;
    const btn = document.getElementById('btn-play');
    const lbl = document.getElementById('play-label');
    const iPlay  = document.getElementById('icon-play');
    const iPause = document.getElementById('icon-pause');
    if (this.physics.running) {
      btn.classList.add('active'); lbl.textContent = 'PAUSE';
      iPlay.style.display = 'none'; iPause.style.display = '';
    } else {
      btn.classList.remove('active'); lbl.textContent = 'PLAY';
      iPlay.style.display = ''; iPause.style.display = 'none';
    }
  }

  // ─────────────────────────────────────────────────────────
  // PRESETS
  // ─────────────────────────────────────────────────────────
  _buildPresetsModal() {
    const grid = document.getElementById('presets-grid');
    for (const preset of PRESETS) {
      const card = document.createElement('div');
      card.className = 'preset-card';
      const bodyCount = preset.bodies_data ? preset.bodies_data.length : preset.bodies;
      card.innerHTML = `<div class="preset-card-title">${preset.name}</div><div class="preset-card-desc">${preset.desc}</div><div class="preset-card-meta">${bodyCount} bodies</div>`;
      card.addEventListener('click', () => {
        this._loadPreset(preset);
        document.getElementById('presets-overlay').classList.add('hidden');
      });
      grid.appendChild(card);
    }
    document.getElementById('presets-close').addEventListener('click', () =>
      document.getElementById('presets-overlay').classList.add('hidden')
    );
    document.getElementById('presets-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('presets-overlay'))
        document.getElementById('presets-overlay').classList.add('hidden');
    });
  }

  _loadPreset(preset) {
    this._clearAll(true);
    for (const bd of preset.bodies_data) {
      const b         = new Body(bd.type, bd.x, bd.y);
      b.vx            = bd.vx  ?? 0;
      b.vy            = bd.vy  ?? 0;
      b.mass          = bd.mass;
      b.radius        = bd.radius;
      b.physicsRadius = bd.physicsRadius ?? (bd.type === 'star' ? 0.08 : 0.015);
      b.color         = bd.color;
      b.name          = bd.name;
      this.bodies.push(b);
    }
    this.physics.markDirty();
    this.camera.fitBodies(this.bodies, this.canvas);
    this._updateHint();
    this.onUpdate();
  }

  // ─────────────────────────────────────────────────────────
  // SAVE / LOAD
  // ─────────────────────────────────────────────────────────
  _saveScene() {
    const data = { version: 2, simTime: this.physics.simTime,
      camera: { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom },
      bodies: this.bodies.map(b => b.toJSON()) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'cosmic-scene.json' });
    a.click(); URL.revokeObjectURL(url);
  }

  _loadScene(data) {
    if (!data.bodies || !Array.isArray(data.bodies)) { alert('Invalid scene format.'); return; }
    this._clearAll(true);
    for (const bd of data.bodies) this.bodies.push(Body.fromJSON(bd));
    if (data.camera) { this.camera.x = data.camera.x; this.camera.y = data.camera.y; this.camera.zoom = data.camera.zoom; }
    if (data.simTime) this.physics.simTime = data.simTime;
    this.physics.markDirty();
    this._updateHint();
    this.onUpdate();
  }

  // ─────────────────────────────────────────────────────────
  // CLEAR
  // ─────────────────────────────────────────────────────────
  _clearAll(silent = false) {
    for (const b of this.bodies) b.clearPermTrail();
    this.bodies.length = 0;
    this.deselect();
    this._hideTooltip();
    this._hideHint();
    this.velArrow  = null;
    this._dragMode = 'none';
    this.physics.simTime = 0;
    // Force-stop sim without toggling
    if (this.physics.running) {
      this.physics.running = false;
      const btn = document.getElementById('btn-play');
      const lbl = document.getElementById('play-label');
      const ip  = document.getElementById('icon-play');
      const ipa = document.getElementById('icon-pause');
      if (btn) btn.classList.remove('active');
      if (lbl) lbl.textContent = 'PLAY';
      if (ip)  ip.style.display  = '';
      if (ipa) ipa.style.display = 'none';
    }
    this.physics.markDirty();
    this._updateHint();
    if (!silent) this.onUpdate();
  }

  // ─────────────────────────────────────────────────────────
  // KEYBOARD
  // ─────────────────────────────────────────────────────────
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
      switch (e.key) {
        case ' ': e.preventDefault(); this.togglePlay(); break;
        case 'Delete': case 'Backspace': this._deleteSelected(); break;
        case 'Escape':
          if (!document.getElementById('presets-overlay').classList.contains('hidden'))
            document.getElementById('presets-overlay').classList.add('hidden');
          else this.deselect();
          break;
        case 'r': case 'R':
          if (this.bodies.length > 0) this.camera.fitBodies(this.bodies, this.canvas);
          else this.camera.reset(); break;
        case 'c': case 'C':
          if (e.ctrlKey || e.metaKey) break;
          if (this.bodies.length === 0) break;
          if (confirm('Clear all bodies?')) this._clearAll(); break;
        case 'p': case 'P':
          document.getElementById('presets-overlay').classList.toggle('hidden'); break;
        case 't': case 'T':
          for (const b of this.bodies) b.clearPermTrail(); break;
        case 's': case 'S':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); this._saveScene(); } break;
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  // HUD
  // ─────────────────────────────────────────────────────────
  updateHUD(fps, physics) {
    const phys = physics || this.physics;
    document.getElementById('hud-bodies').textContent = this.bodies.length;
    document.getElementById('hud-fps').textContent    = Math.round(fps);
    const yrs = phys.simTime;
    document.getElementById('hud-time').textContent =
      yrs < 1 ? (yrs*365.25).toFixed(1)+' d' : yrs < 100 ? yrs.toFixed(1)+' yr' : (yrs/1000).toFixed(2)+' kyr';

    if (this.bodies.length > 1 && phys._initEnergy !== null) {
      // Smooth energy values with EMA so they don't flicker unreadably
      const EMA = 0.05; // blending factor — smaller = smoother
      if (this._hudKE  === undefined) this._hudKE  = phys.kineticEnergy;
      if (this._hudTE  === undefined) this._hudTE  = phys.totalEnergy;
      if (this._hudDrift === undefined) this._hudDrift = phys.energyDrift;
      this._hudKE    = this._hudKE    * (1-EMA) + phys.kineticEnergy   * EMA;
      this._hudTE    = this._hudTE    * (1-EMA) + phys.totalEnergy     * EMA;
      this._hudDrift = this._hudDrift * (1-EMA) + phys.energyDrift     * EMA;

      const fmt = v => { const a=Math.abs(v); return a>=1e9?(v/1e9).toFixed(2)+' G':a>=1e6?(v/1e6).toFixed(2)+' M':a>=1e3?(v/1e3).toFixed(2)+' k':v.toFixed(2); };
      document.getElementById('hud-ke').textContent = fmt(this._hudKE);
      document.getElementById('hud-te').textContent = fmt(this._hudTE);
      const drift   = this._hudDrift;
      const driftEl = document.getElementById('hud-drift');
      driftEl.textContent  = drift.toFixed(3)+'%';
      driftEl.dataset.good = Math.abs(drift) < 0.1 ? 'true' : 'false';
      const seKe = document.getElementById('se-ke');
      if (seKe) {
        document.getElementById('se-ke').textContent = fmt(this._hudKE);
        document.getElementById('se-pe').textContent = fmt(phys.potentialEnergy);
        document.getElementById('se-te').textContent = fmt(this._hudTE);
        const sdEl = document.getElementById('se-drift');
        sdEl.textContent = drift.toFixed(4)+'%';
        sdEl.style.color = Math.abs(drift)<0.1 ? '#4ade80' : Math.abs(drift)<1 ? '#facc15' : '#f87171';
      }
    } else {
      this._hudKE = undefined; this._hudTE = undefined; this._hudDrift = undefined;
      ['hud-ke','hud-te','hud-drift'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='—'; });
    }

    if (this.selectedId !== null) {
      const b = this.bodies.find(b => b.id === this.selectedId);
      if (b) this._updateStats(b);
    }
  }

  _updateHint() {
    const h = document.getElementById('empty-hint');
    if (this.bodies.length > 0) h.classList.add('hidden');
    else h.classList.remove('hidden');
  }
}
