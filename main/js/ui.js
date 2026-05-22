// ui.js — DOM event handling: drag-drop, selection, props panel, keyboard

import { Body } from './bodies/Body.js';

export class UI {
  constructor(canvas, camera, bodies, physics, renderer, onUpdate) {
    this.canvas   = canvas;
    this.camera   = camera;
    this.bodies   = bodies;
    this.physics  = physics;
    this.renderer = renderer;
    this.onUpdate = onUpdate;   // called whenever scene changes

    this.selectedId  = null;
    this.velArrow    = null;

    // Panning state
    this._panning    = false;
    this._panStart   = null;
    this._camAtStart = null;

    // Velocity drag state (right-click drag after placing)
    this._velDragActive = false;
    this._velDragBodyId = null;

    // Dragging from palette
    this._ghostType   = null;
    this._ghostEl     = document.getElementById('drag-ghost');

    this._bindEvents();
    this._bindProps();
    this._bindToolbar();
    this._bindKeyboard();
  }

  // ── Palette drag-and-drop ───────────────────────────────
  _bindEvents() {
    const container = this.canvas.parentElement;

    // Palette items: mousedown starts drag
    document.querySelectorAll('.palette-item:not(.locked)').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        this._ghostType = item.dataset.type;
        this._showGhost(e.clientX, e.clientY, this._ghostType);
      });
    });

    // Mouse move: move ghost + pan
    window.addEventListener('mousemove', (e) => {
      if (this._ghostType) {
        this._moveGhost(e.clientX, e.clientY);
      }
      if (this._panning) {
        const dx = e.clientX - this._panStart.x;
        const dy = e.clientY - this._panStart.y;
        this.camera.x = this._camAtStart.x - dx / this.camera.zoom;
        this.camera.y = this._camAtStart.y - dy / this.camera.zoom;
      }
      if (this._velDragActive) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const body = this.bodies.find(b => b.id === this._velDragBodyId);
        if (body) {
          this.velArrow = {
            fromWorld: { x: body.x, y: body.y },
            toScreen:  { x: sx, y: sy }
          };
        }
      }
    });

    // Mouse up: drop body onto canvas or release pan
    window.addEventListener('mouseup', (e) => {
      if (this._ghostType) {
        const rect = this.canvas.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top  && e.clientY <= rect.bottom) {
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const world = this.camera.screenToWorld(sx, sy, this.canvas);
          this._placeBody(this._ghostType, world.x, world.y);
        }
        this._hideGhost();
        this._ghostType = null;
      }

      if (this._panning) {
        this._panning = false;
        container.classList.remove('panning');
      }

      if (this._velDragActive) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const body = this.bodies.find(b => b.id === this._velDragBodyId);
        if (body) {
          const ws = this.camera.worldToScreen(body.x, body.y, this.canvas);
          const dx = sx - ws.x;
          const dy = sy - ws.y;
          // Scale: 80 pixels = 1 AU/yr velocity
          body.vx = dx / 80;
          body.vy = dy / 80;
          body.clearTrail();
          this._updatePropsPanel(body);
        }
        this._velDragActive = false;
        this._velDragBodyId = null;
        this.velArrow = null;
      }
    });

    // Canvas: click to select / start pan / right-drag for velocity
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        // Middle button or Alt+Left = pan
        e.preventDefault();
        this._panning = true;
        this._panStart = { x: e.clientX, y: e.clientY };
        this._camAtStart = { x: this.camera.x, y: this.camera.y };
        container.classList.add('panning');
        return;
      }

      if (e.button === 2) {
        // Right-click drag = set velocity of selected body
        if (this.selectedId !== null) {
          this._velDragActive = true;
          this._velDragBodyId = this.selectedId;
        }
        return;
      }

      if (e.button === 0) {
        // Try to select a body
        const world = this.camera.screenToWorld(sx, sy, this.canvas);
        const hit = this._hitTest(world.x, world.y);
        if (hit) {
          this.select(hit.id);
        } else {
          this.deselect();
          // Left-click drag on empty space = pan too
          this._panning = true;
          this._panStart = { x: e.clientX, y: e.clientY };
          this._camAtStart = { x: this.camera.x, y: this.camera.y };
          container.classList.add('panning');
        }
      }
    });

    // Scroll to zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.camera.zoomAt(sx, sy, factor, this.canvas);
    }, { passive: false });

    // Prevent context menu on canvas
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _hitTest(wx, wy) {
    // Iterate in reverse (topmost drawn last)
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      const dx = wx - b.x;
      const dy = wy - b.y;
      const hitR = b.radius * 1.5; // generous hit area
      if (dx*dx + dy*dy <= hitR*hitR) return b;
    }
    return null;
  }

  _placeBody(type, wx, wy) {
    const b = new Body(type, wx, wy);
    this.bodies.push(b);
    this.select(b.id);
    this._updateHint();
    this.onUpdate();
  }

  // ── Ghost ───────────────────────────────────────────────
  _showGhost(cx, cy, type) {
    const icons = {
      star:   '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="10" fill="#FFC940"/><circle cx="20" cy="20" r="14" fill="none" stroke="#FFC940" stroke-width="0.8" opacity="0.5"/></svg>',
      planet: '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="10" fill="#4B8FDE"/><ellipse cx="20" cy="20" rx="18" ry="5" fill="none" stroke="#4B8FDE" stroke-width="1" opacity="0.5" transform="rotate(-20,20,20)"/></svg>'
    };
    this._ghostEl.innerHTML = icons[type] || '';
    this._ghostEl.style.display = 'block';
    this._ghostEl.style.opacity = '0.75';
    this._moveGhost(cx, cy);
  }
  _moveGhost(cx, cy) {
    this._ghostEl.style.left = cx + 'px';
    this._ghostEl.style.top  = cy + 'px';
  }
  _hideGhost() {
    this._ghostEl.style.display = 'none';
  }

  // ── Selection ────────────────────────────────────────────
  select(id) {
    this.selectedId = id;
    const body = this.bodies.find(b => b.id === id);
    if (body) this._openPropsPanel(body);
  }

  deselect() {
    this.selectedId = null;
    this._closePropsPanel();
  }

  // ── Properties panel ─────────────────────────────────────
  _openPropsPanel(body) {
    const panel = document.getElementById('props-panel');
    panel.classList.remove('hidden');
    document.body.classList.add('props-open');
    this._updatePropsPanel(body);
  }

  _closePropsPanel() {
    document.getElementById('props-panel').classList.add('hidden');
    document.body.classList.remove('props-open');
  }

  _updatePropsPanel(body) {
    document.getElementById('props-type-label').textContent = body.type.toUpperCase();
    document.getElementById('prop-name').value   = body.name;
    document.getElementById('prop-mass').value   = (body.mass / 1e6).toFixed(3);
    document.getElementById('prop-radius').value = body.radius.toFixed(2);
    document.getElementById('prop-vx').value     = body.vx.toFixed(4);
    document.getElementById('prop-vy').value     = body.vy.toFixed(4);
    document.getElementById('prop-color').value  = body.color;
    document.getElementById('prop-color-hex').textContent = body.color;
    this._updateStats(body);
  }

  _updateStats(body) {
    if (!body) return;
    document.getElementById('stat-speed').textContent =
      body.speedKms.toFixed(1) + ' km/s';
    document.getElementById('stat-dist').textContent =
      body.distAU.toFixed(2) + ' AU';
  }

  _bindProps() {
    const getBody = () => this.bodies.find(b => b.id === this.selectedId);

    document.getElementById('prop-name').addEventListener('input', e => {
      const b = getBody(); if (b) b.name = e.target.value;
    });
    document.getElementById('prop-mass').addEventListener('input', e => {
      const b = getBody(); if (b) b.mass = parseFloat(e.target.value) * 1e6 || b.mass;
    });
    document.getElementById('prop-radius').addEventListener('input', e => {
      const b = getBody(); if (b) b.radius = parseFloat(e.target.value) || b.radius;
    });
    document.getElementById('prop-vx').addEventListener('input', e => {
      const b = getBody(); if (b) { b.vx = parseFloat(e.target.value) || 0; b.clearTrail(); }
    });
    document.getElementById('prop-vy').addEventListener('input', e => {
      const b = getBody(); if (b) { b.vy = parseFloat(e.target.value) || 0; b.clearTrail(); }
    });
    document.getElementById('prop-color').addEventListener('input', e => {
      const b = getBody();
      if (b) {
        b.color = e.target.value;
        document.getElementById('prop-color-hex').textContent = e.target.value;
      }
    });

    document.getElementById('btn-delete-body').addEventListener('click', () => {
      this._deleteSelected();
    });
  }

  _deleteSelected() {
    if (this.selectedId === null) return;
    const idx = this.bodies.findIndex(b => b.id === this.selectedId);
    if (idx !== -1) this.bodies.splice(idx, 1);
    this.deselect();
    this._updateHint();
    this.onUpdate();
  }

  // ── Toolbar ───────────────────────────────────────────────
  _bindToolbar() {
    document.getElementById('btn-play').addEventListener('click', () => {
      this.togglePlay();
    });

    document.getElementById('btn-reset-view').addEventListener('click', () => {
      if (this.bodies.length > 0) {
        this.camera.fitBodies(this.bodies, this.canvas);
      } else {
        this.camera.reset();
      }
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
      if (this.bodies.length === 0) return;
      if (confirm('Clear all bodies?')) {
        this.bodies.length = 0;
        this.deselect();
        this._updateHint();
        this.physics.simTime = 0;
        this.onUpdate();
      }
    });

    const slider = document.getElementById('speed-slider');
    const label  = document.getElementById('speed-label');
    slider.addEventListener('input', () => {
      this.physics.setSpeedFromSlider(slider.value);
      label.textContent = this.physics.speedLabel(slider.value);
    });
  }

  togglePlay() {
    this.physics.running = !this.physics.running;
    const btn    = document.getElementById('btn-play');
    const lbl    = document.getElementById('play-label');
    const iPlay  = document.getElementById('icon-play');
    const iPause = document.getElementById('icon-pause');

    if (this.physics.running) {
      btn.classList.add('active');
      lbl.textContent   = 'PAUSE';
      iPlay.style.display  = 'none';
      iPause.style.display = '';
    } else {
      btn.classList.remove('active');
      lbl.textContent   = 'PLAY';
      iPlay.style.display  = '';
      iPause.style.display = 'none';
    }
  }

  // ── Keyboard ──────────────────────────────────────────────
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return; // don't fire in text fields

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'Delete':
        case 'Backspace':
          this._deleteSelected();
          break;
        case 'Escape':
          this.deselect();
          break;
        case 'r': case 'R':
          if (this.bodies.length > 0) {
            this.camera.fitBodies(this.bodies, this.canvas);
          } else {
            this.camera.reset();
          }
          break;
        case 'c': case 'C':
          if (e.ctrlKey || e.metaKey) break; // allow Ctrl+C
          if (this.bodies.length === 0) break;
          if (confirm('Clear all bodies?')) {
            this.bodies.length = 0;
            this.deselect();
            this._updateHint();
            this.physics.simTime = 0;
            this.onUpdate();
          }
          break;
      }
    });
  }

  // ── HUD update ────────────────────────────────────────────
  updateHUD(fps) {
    document.getElementById('hud-bodies').textContent = this.bodies.length;
    document.getElementById('hud-fps').textContent    = Math.round(fps);
    const yrs = this.physics.simTime;
    document.getElementById('hud-time').textContent   =
      yrs < 1 ? (yrs * 365.25).toFixed(1) + ' d'
      : yrs < 100 ? yrs.toFixed(1) + ' yr'
      : (yrs / 1000).toFixed(2) + ' kyr';

    // Update live stats in props panel
    if (this.selectedId !== null) {
      const b = this.bodies.find(b => b.id === this.selectedId);
      if (b) this._updateStats(b);
    }
  }

  _updateHint() {
    const hint = document.getElementById('empty-hint');
    if (this.bodies.length > 0) hint.classList.add('hidden');
    else hint.classList.remove('hidden');
  }
}
