// ui.js — interaction layer

import { Body, SIM, classifyType, STELLAR_TYPES, M_EARTH, M_SUN, massToDisplay, displayToMass } from './bodies/Body.js';
import { PRESETS } from './presets.js';
import { PropsPanel } from './props-panel.js';
import { HUD } from './hud.js';

// ── Helpers ───────────────────────────────────────────────
function vxyToSpeedDir(vx, vy) {
  const speedAUyr = Math.sqrt(vx*vx + vy*vy);
  let deg = Math.atan2(vy, vx) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return { speedKms: speedAUyr * SIM.velUnit, deg };
}

function speedDirToVxy(speedKms, deg) {
  const speedAUyr = speedKms / SIM.velUnit;
  const rad = deg * Math.PI / 180;
  return { vx: speedAUyr * Math.cos(rad), vy: speedAUyr * Math.sin(rad) };
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
    this.velArrow   = null;

    // ── Drag state machine ────────────────────────────────
    this._dragMode       = 'none'; // 'none' | 'pan' | 'body' | 'vel'
    this._dragBodyId     = null;
    this._dragBodyOffset = { x: 0, y: 0 };
    this._dragStart      = { x: 0, y: 0 };
    this._panStart       = { x: 0, y: 0 };
    this._camAtStart     = { x: 0, y: 0 };
    this._velCommitted   = false;

    // Ghost
    this._ghostType = null;
    this._ghostEl   = document.getElementById('drag-ghost');

    // Tooltip
    this._tooltipEl   = document.getElementById('tooltip');
    this._tooltipBody = null;

    this._bindEvents();
    this._bindToolbar();
    this._bindKeyboard();
    this._buildPresetsModal();
    this._cacheDOMRefs();

    this.propsPanel = new PropsPanel({
      bodies:        this.bodies,
      physics:       this.physics,
      renderer:      this.renderer,
      canvas:        this.canvas,
      getSelectedId: () => this.selectedId,
      onDelete:      () => this._deleteSelected(),
    });
    this.hud = new HUD();
  }

  _cacheDOMRefs() {
    this._dom = {
      velArrowHint:    document.getElementById('vel-arrow-hint'),
      emptyHint:       document.getElementById('empty-hint'),
      reclassifyToast: document.getElementById('reclassify-toast'),
    };
  }

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
      if (this._ghostType) { this._moveGhost(e.clientX, e.clientY); return; }

      const rect = this.canvas.getBoundingClientRect();
      const sx   = e.clientX - rect.left;
      const sy   = e.clientY - rect.top;

      if (this._dragMode === 'pending-body') {
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        if (Math.sqrt(dx*dx + dy*dy) > 8) {
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

      if (this._dragMode === 'body') {
        const world = this.camera.screenToWorld(sx, sy, this.canvas);
        const body  = this.bodies.find(b => b.id === this._dragBodyId);
        if (body) {
          body.x = world.x - this._dragBodyOffset.x;
          body.y = world.y - this._dragBodyOffset.y;
          body.clearTrail();
          body.clearPermTrail();
          if (this.selectedId === body.id) this.propsPanel.update(body);
        }
        return;
      }

      if (this._dragMode === 'pan') {
        const dx = e.clientX - this._panStart.x;
        const dy = e.clientY - this._panStart.y;
        this.camera.x = this._camAtStart.x - dx / this.camera.zoom;
        this.camera.y = this._camAtStart.y - dy / this.camera.zoom;
        return;
      }

      if (this._dragMode === 'vel') {
        const body = this.bodies.find(b => b.id === this._dragBodyId);
        if (body) {
          this.velArrow = { fromWorld: { x: body.x, y: body.y }, toScreen: { x: sx, y: sy } };
          const vel = this._arrowToVelocity(body, sx, sy);
          this._previewVelocity(vel.vx, vel.vy);
        }
        return;
      }

      // Tooltip + cursor on hover (idle)
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top  && e.clientY <= rect.bottom) {
        const world = this.camera.screenToWorld(sx, sy, this.canvas);
        const hit   = this._hitTest(world.x, world.y);
        if (hit && hit.id !== this.selectedId) {
          this._showTooltip(hit, e.clientX, e.clientY);
          container.style.cursor = 'grab';
        } else {
          this._hideTooltip();
          container.style.cursor = '';
        }
      } else {
        this._hideTooltip();
        container.style.cursor = '';
      }
    });

    // ── Global mouseup ────────────────────────────────────
    window.addEventListener('mouseup', (e) => {
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
        if (prevMode === 'pending-body' && this._dragBodyId !== null) {
          const body = this.bodies.find(b => b.id === this._dragBodyId);
          if (body) this.propsPanel.open(body);
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
          const ws  = this.camera.worldToScreen(body.x, body.y, this.canvas);
          const len = Math.sqrt((sx-ws.x)**2 + (sy-ws.y)**2);
          if (len > 5) {
            body.vx = vel.vx;
            body.vy = vel.vy;
            body.clearTrail();
            this.physics.markDirty();
            this.propsPanel.update(body);
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
          this.selectedId = hit.id;
          this._hideTooltip();
          this._dragMode   = 'pending-body';
          this._dragBodyId = hit.id;
          this._dragStart  = { x: e.clientX, y: e.clientY };
          this._dragBodyOffset = { x: world.x - hit.x, y: world.y - hit.y };
        } else {
          this.deselect();
          this._hideHint();
          this._dragMode   = 'pan';
          this._panStart   = { x: e.clientX, y: e.clientY };
          this._camAtStart = { x: this.camera.x, y: this.camera.y };
          container.classList.add('panning');
        }
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect   = this.canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
      this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor, this.canvas);
    }, { passive: false });

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this._bindTouch();
  }

  _bindTouch() {
    const canvas = this.canvas;
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
        this.selectedId  = hit.id;
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
      if (e.touches.length === 2 && _pinchDist !== null) {
        const newDist = pinchDistance(e.touches);
        const factor  = newDist / _pinchDist;
        const rect  = canvas.getBoundingClientRect();
        const midX  = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
        const midY  = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
        this.camera.zoomAt(midX, midY, factor, canvas);
        _pinchDist = newDist;
        return;
      }
      if (e.touches.length !== 1) return;
      const t   = e.touches[0];
      const pos = getTouchPos(t);

      if (this._dragMode === 'pending-body') {
        const dx = t.clientX - this._dragStart.x;
        const dy = t.clientY - this._dragStart.y;
        if (Math.sqrt(dx*dx + dy*dy) > 8) {
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

      if (prevMode === 'pending-body' && this._dragBodyId !== null) {
        const body = this.bodies.find(b => b.id === this._dragBodyId);
        if (body) this.propsPanel.open(body);
        this._dragBodyId = null;
        return;
      }

      if (prevMode === 'vel') {
        const body = this.bodies.find(b => b.id === this._dragBodyId);
        const t    = e.changedTouches[0];
        const pos  = getTouchPos(t);
        if (body) {
          const vel = this._arrowToVelocity(body, pos.x, pos.y);
          const ws  = this.camera.worldToScreen(body.x, body.y, canvas);
          const len = Math.sqrt((pos.x-ws.x)**2 + (pos.y-ws.y)**2);
          if (len > 5) {
            body.vx = vel.vx; body.vy = vel.vy;
            body.clearTrail();
            this.physics.markDirty();
            this.propsPanel.update(body);
          }
        }
        this.velArrow    = null;
        this._dragBodyId = null;
        this._hideHint();
      }
    }, { passive: false });

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

  _arrowToVelocity(body, sx, sy) {
    const ws = this.camera.worldToScreen(body.x, body.y, this.canvas);
    const SENSITIVITY = 2.5;
    const worldDx = (sx - ws.x) / this.camera.zoom;
    const worldDy = (sy - ws.y) / this.camera.zoom;
    let vx = worldDx * SENSITIVITY;
    let vy = worldDy * SENSITIVITY;

    const G = this.physics.G;
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
        if (Math.abs(v_curr - v_circ) / v_circ < 0.05) {
          const rx = dx / r, ry = dy / r;
          const perpCCW = { x: -ry, y:  rx };
          const perpCW  = { x:  ry, y: -rx };
          const dot     = vx * perpCCW.x + vy * perpCCW.y;
          const perp    = dot >= 0 ? perpCCW : perpCW;
          vx = perp.x * v_circ;
          vy = perp.y * v_circ;
          if (this.velArrow) this.velArrow._snapped = true;
        } else {
          if (this.velArrow) this.velArrow._snapped = false;
        }
      }
    }
    return { vx, vy };
  }

  _previewVelocity(vx, vy) { this.propsPanel.previewVelocity(vx, vy); }

  _hitTest(wx, wy) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b    = this.bodies[i];
      const dx   = wx - b.x, dy = wy - b.y;
      const hitR = Math.max(b.radius, 0.5 / this.camera.zoom);
      if (dx*dx + dy*dy <= hitR*hitR) return b;
    }
    return null;
  }

  _placeBody(type, wx, wy) {
    const b = new Body(type, wx, wy);
    this.bodies.push(b);
    this.select(b.id);
    this._updateHint();
    this.physics.markDirty();
    if (this.bodies.length === 1) {
      this.camera.fitBodies(this.bodies, this.canvas);
      if (!this.physics.running) this.togglePlay();
    }
    this.onUpdate();
  }

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

  _showTooltip(body, cx, cy) {
    this._tooltipBody = body.id;
    const { val: mVal, unit: mUnit } = massToDisplay(body);
    this._tooltipEl.innerHTML =
      `<strong style="color:${body.color}">${body.name}</strong><br>` +
      `Type: ${body.type}<br>Mass: ${mVal.toFixed(3)} ${mUnit.split(' ')[0]}<br>Speed: ${body.speedKms.toFixed(1)} km/s`;
    this._tooltipEl.style.display = 'block';
    this._tooltipEl.style.left = (cx+14)+'px';
    this._tooltipEl.style.top  = (cy-10)+'px';
  }
  _hideTooltip() { this._tooltipEl.style.display = 'none'; this._tooltipBody = null; }

  _showHint() { if (this._dom.velArrowHint) this._dom.velArrowHint.classList.remove('hidden'); }
  _hideHint() { if (this._dom.velArrowHint) this._dom.velArrowHint.classList.add('hidden'); }

  select(id) {
    this.selectedId = id;
    const body = this.bodies.find(b => b.id === id);
    if (body) this.propsPanel.open(body);
  }
  deselect() { this.selectedId = null; this.propsPanel.close(); }

  _deleteSelected() {
    if (this.selectedId === null) return;
    const idx = this.bodies.findIndex(b => b.id === this.selectedId);
    if (idx !== -1) this.bodies.splice(idx, 1);
    this.deselect();
    this._updateHint();
    this.onUpdate();
  }

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
    slabel.textContent = this.physics.speedLabel(slider.value);
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
    const btn    = document.getElementById('btn-play');
    const lbl    = document.getElementById('play-label');
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

  _buildPresetsModal() {
    const grid = document.getElementById('presets-grid');
    for (const preset of PRESETS) {
      const card      = document.createElement('div');
      card.className  = 'preset-card';
      const bodyCount = preset.bodies_data ? preset.bodies_data.length : preset.bodies;
      card.innerHTML  = `<div class="preset-card-title">${preset.name}</div><div class="preset-card-desc">${preset.desc}</div><div class="preset-card-meta">${bodyCount} bodies</div>`;
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

  _clearAll(silent = false) {
    for (const b of this.bodies) b.clearPermTrail();
    this.bodies.length = 0;
    this.deselect();
    this._hideTooltip();
    this._hideHint();
    this.velArrow  = null;
    this._dragMode = 'none';
    this.physics.simTime = 0;
    // Stop sim without duplicating button-update logic
    if (this.physics.running) this.togglePlay();
    this.physics.markDirty();
    this._updateHint();
    if (!silent) this.onUpdate();
  }

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

  updateHUD(fps, physics) {
    const phys = physics || this.physics;
    this.hud.update(this.bodies, phys, fps);
    if (this.selectedId !== null) {
      const b = this.bodies.find(b => b.id === this.selectedId);
      if (b) this.propsPanel.updateStats(b);
    }
  }

  _updateHint() {
    const h = this._dom.emptyHint;
    if (this.bodies.length > 0) h.classList.add('hidden');
    else h.classList.remove('hidden');
  }
}
