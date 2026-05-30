// props-panel.js — body properties sidebar
// Owns: open/close, field updates, stats, dial, reclassification, toast.

import { SIM, classifyType } from './bodies/Body.js';

// ── Mass display helpers (duplicated from ui.js to avoid circular dep) ──
const M_SUN   = 1989000;
const M_EARTH = 6;
function massToDisplay(body) {
  if (['star','blackhole','neutronstar','pulsar'].includes(body.type)) {
    return { val: body.mass / M_SUN,   unit: 'M☉' };
  }
  return { val: body.mass / M_EARTH, unit: 'M⊕' };
}
function displayToMass(val, type) {
  return ['star','blackhole','neutronstar','pulsar'].includes(type)
    ? val * M_SUN : val * M_EARTH;
}
function vxyToSpeedDir(vx, vy) {
  const speedAUyr = Math.sqrt(vx*vx + vy*vy);
  const speedKms  = speedAUyr * SIM.velUnit;
  let deg = Math.atan2(vy, vx) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return { speedKms, speedAUyr, deg };
}
function speedDirToVxy(speedKms, deg) {
  const speedAUyr = speedKms / SIM.velUnit;
  const rad = deg * Math.PI / 180;
  return { vx: speedAUyr * Math.cos(rad), vy: speedAUyr * Math.sin(rad) };
}

export class PropsPanel {
  /**
   * @param {object} opts
   * @param {Body[]}    opts.bodies      — shared bodies array ref
   * @param {Physics}   opts.physics     — physics instance
   * @param {Renderer}  opts.renderer    — renderer (for resize on open/close)
   * @param {HTMLCanvasElement} opts.canvas
   * @param {() => number|null} opts.getSelectedId
   */
  constructor({ bodies, physics, renderer, canvas, getSelectedId, onDelete }) {
    this.bodies        = bodies;
    this.physics       = physics;
    this.renderer      = renderer;
    this.canvas        = canvas;
    this.getSelectedId = getSelectedId;
    this._onDelete     = onDelete || (() => {});

    this._dialDragging = false;
    this._toastTimer   = null;

    this._dom = {
      panel:          document.getElementById('props-panel'),
      typeLabel:      document.getElementById('props-type-label'),
      propName:       document.getElementById('prop-name'),
      propMass:       document.getElementById('prop-mass'),
      propRadius:     document.getElementById('prop-radius'),
      propColor:      document.getElementById('prop-color'),
      propColorHex:   document.getElementById('prop-color-hex'),
      propSpeed:      document.getElementById('prop-speed'),
      propDir:        document.getElementById('prop-dir'),
      massUnitLabel:  document.getElementById('mass-unit-label'),
      dirDialNeedle:  document.getElementById('dir-dial-needle'),
      statSpeed:      document.getElementById('stat-speed'),
      statDist:       document.getElementById('stat-dist'),
      statDensity:    document.getElementById('stat-density'),
      statClassify:   document.getElementById('stat-classify'),
      toast:          document.getElementById('reclassify-toast'),
    };

    this._bindEvents();
  }

  get visible() {
    return this._dom.panel && !this._dom.panel.classList.contains('hidden');
  }

  open(body) {
    this._dom.panel.classList.remove('hidden');
    document.body.classList.add('props-open');
    this.update(body);
    requestAnimationFrame(() => {
      const c = this.canvas.parentElement;
      this.renderer.resize(c.clientWidth, c.clientHeight);
    });
  }

  close() {
    this._dom.panel.classList.add('hidden');
    document.body.classList.remove('props-open');
    requestAnimationFrame(() => {
      const c = this.canvas.parentElement;
      this.renderer.resize(c.clientWidth, c.clientHeight);
    });
  }

  // Called every frame when a body is selected, and on explicit edits.
  update(body) {
    if (!body) return;
    this._dom.typeLabel.textContent = body.type.toUpperCase();
    this._dom.propName.value        = body.name;
    const md = massToDisplay(body);
    this._dom.propMass.value = md.val.toFixed(4);
    if (this._dom.massUnitLabel) this._dom.massUnitLabel.textContent = md.unit;
    this._dom.propRadius.value      = body.radius.toFixed(2);
    this._dom.propColor.value       = body.color;
    this._dom.propColorHex.textContent = body.color;
    const { speedKms, deg } = vxyToSpeedDir(body.vx, body.vy);
    this._dom.propSpeed.value = speedKms.toFixed(2);
    this._dom.propDir.value   = deg.toFixed(1);
    this.updateDial(deg);
    this.updateStats(body);
  }

  // Called every frame to refresh live stats without touching input fields.
  updateStats(body) {
    if (!body) return;
    this._dom.statSpeed.textContent = body.speedKms.toFixed(1) + ' km/s';
    this._dom.statDist.textContent  = body.distAU.toFixed(2)   + ' AU';

    const rSafe = Math.max(body.radius, 1e-6);
    const rho   = body.mass / (rSafe * rSafe * rSafe);
    const rhoEl = this._dom.statDensity;
    if (rhoEl) {
      let s;
      if      (rho >= 1e12) s = (rho/1e12).toFixed(2) + ' T';
      else if (rho >= 1e9)  s = (rho/1e9).toFixed(2)  + ' G';
      else if (rho >= 1e6)  s = (rho/1e6).toFixed(2)  + ' M';
      else if (rho >= 1e3)  s = (rho/1e3).toFixed(2)  + ' k';
      else                  s = rho.toFixed(2);
      rhoEl.textContent = s + ' M/AU³';
    }

    const clEl = this._dom.statClassify;
    if (clEl) {
      const predicted = classifyType(body.mass, body.radius, body.type);
      const LABELS = {
        star:'Star', planet:'Planet', blackhole:'Black Hole',
        neutronstar:'Neutron Star', pulsar:'Pulsar', comet:'Comet',
      };
      const label = LABELS[predicted] || predicted;
      const same  = predicted === body.type;
      clEl.textContent = same ? `✓ ${label}` : `→ ${label}`;
      clEl.style.color = same ? 'var(--text-dim)' : '#facc15';
      let hint = same
        ? 'Parameters match body type'
        : `Parameters suggest this should be a ${label}. Click off the mass or radius field to reclassify.`;
      if (!same && (predicted === 'neutronstar' || predicted === 'pulsar')) {
        const rMax = Math.pow(body.mass / 5e8, 1 / 3);
        hint += ` (Requires radius ≤ ${rMax.toFixed(3)} AU for NS density.)`;
      }
      clEl.title = hint;
    }
  }

  // ── Reclassification ─────────────────────────────────────
  tryReclassify() {
    const body = this.bodies.find(b => b.id === this.getSelectedId());
    if (!body) return;
    const oldType = body.reclassify();
    if (oldType !== null) {
      this.update(body);
      this.physics.markDirty();
      this._showToast(oldType, body.type);
    }
  }

  _showToast(oldType, newType) {
    const LABELS = {
      star:'Star', planet:'Planet', blackhole:'Black Hole',
      neutronstar:'Neutron Star', pulsar:'Pulsar', comet:'Comet',
    };
    const ICONS = { star:'★', planet:'◉', blackhole:'◈', neutronstar:'✦', pulsar:'✦', comet:'☄' };
    const el = this._dom.toast;
    if (!el) return;
    el.innerHTML =
      `<span class="toast-icon">${ICONS[newType] || '◉'}</span>` +
      `<span class="toast-text">Reclassified: <b>${LABELS[oldType]}</b> → <b>${LABELS[newType]}</b></span>`;
    el.className = 'reclassify-toast visible';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.className = 'reclassify-toast'; }, 3000);
  }

  // ── Dial (public so ui.js can call it during vel-arrow drag) ─
  updateDial(deg) {
    const needle = this._dom.dirDialNeedle;
    if (!needle) return;
    const rad = deg * Math.PI / 180;
    needle.setAttribute('x2', (16 + 13 * Math.cos(rad)).toFixed(1));
    needle.setAttribute('y2', (16 + 13 * Math.sin(rad)).toFixed(1));
  }

  // ── Preview velocity during vel-arrow drag (called by ui.js) ─
  previewVelocity(vx, vy) {
    const speedAUyr = Math.sqrt(vx*vx + vy*vy);
    const speedKms  = speedAUyr * SIM.velUnit;
    let deg = Math.atan2(vy, vx) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    if (this._dom.propSpeed) this._dom.propSpeed.value = speedKms.toFixed(2);
    if (this._dom.propDir)   this._dom.propDir.value   = deg.toFixed(1);
    this.updateDial(deg);
  }

  // ── Input event bindings ──────────────────────────────────
  _bindEvents() {
    const getBody = () => this.bodies.find(b => b.id === this.getSelectedId());

    const applyVelocity = () => {
      const b = getBody(); if (!b) return;
      const rawSpeed = parseFloat(this._dom.propSpeed.value);
      const rawDir   = parseFloat(this._dom.propDir.value);
      const speedKms = isNaN(rawSpeed) ? 0 : rawSpeed;
      const deg      = isNaN(rawDir)   ? 0 : rawDir;
      const { vx, vy } = speedDirToVxy(speedKms, deg);
      b.vx = vx; b.vy = vy;
      b.clearTrail();
      this.physics.markDirty();
      this.updateDial(deg);
      this.updateStats(b);
    };

    this._dom.propName.addEventListener('input', e => {
      const b = getBody(); if (b) b.name = e.target.value;
    });
    this._dom.propMass.addEventListener('input', e => {
      const b = getBody(); if (!b) return;
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) { b.mass = displayToMass(val, b.type); this.updateStats(b); }
    });
    this._dom.propMass.addEventListener('blur', () => this.tryReclassify());
    this._dom.propMass.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

    this._dom.propRadius.addEventListener('input', e => {
      const b = getBody(); if (!b) return;
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) { b.radius = Math.max(0.01, Math.min(50, val)); this.updateStats(b); }
    });
    this._dom.propRadius.addEventListener('blur', () => this.tryReclassify());
    this._dom.propRadius.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

    this._dom.propSpeed.addEventListener('input', applyVelocity);
    this._dom.propDir.addEventListener('input', applyVelocity);

    this._dom.propColor.addEventListener('input', e => {
      const b = getBody();
      if (b) { b.color = e.target.value; this._dom.propColorHex.textContent = e.target.value; }
    });

    document.getElementById('btn-delete-body').addEventListener('click', () => {
      this._onDelete();
    });

    // Dial drag
    const dial = document.getElementById('dir-dial');
    if (dial) {
      const onMove = (e) => {
        if (!this._dialDragging) return;
        const rect = dial.getBoundingClientRect();
        let deg = Math.atan2(
          e.clientY - (rect.top  + rect.height / 2),
          e.clientX - (rect.left + rect.width  / 2)
        ) * 180 / Math.PI;
        if (deg < 0) deg += 360;
        this._dom.propDir.value = deg.toFixed(1);
        applyVelocity();
      };
      dial.addEventListener('mousedown', e => { this._dialDragging = true; e.preventDefault(); e.stopPropagation(); });
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', () => { this._dialDragging = false; });
    }
  }
}
