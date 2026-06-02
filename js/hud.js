// hud.js — heads-up display updater
// Owns: per-frame energy/fps/body-count display with EMA smoothing.

export class HUD {
  constructor() {
    this._ke    = null;
    this._te    = null;
    this._drift = null;

    this._dom = {
      bodies:  document.getElementById('hud-bodies'),
      fps:     document.getElementById('hud-fps'),
      time:    document.getElementById('hud-time'),
      ke:      document.getElementById('hud-ke'),
      te:      document.getElementById('hud-te'),
      drift:   document.getElementById('hud-drift'),
      seKe:    document.getElementById('se-ke'),
      sePe:    document.getElementById('se-pe'),
      seTe:    document.getElementById('se-te'),
      seDrift: document.getElementById('se-drift'),
      seSteps: document.getElementById('se-substeps'),
    };
  }

  /**
   * Called once per frame from main loop.
   * @param {Body[]}  bodies
   * @param {Physics} physics
   * @param {number}  fps
   */
  update(bodies, physics, fps) {
    this._dom.bodies.textContent = bodies.length;
    this._dom.fps.textContent    = Math.round(fps);

    const yrs = physics.simTime;
    this._dom.time.textContent =
      yrs < 1     ? (yrs * 365.25).toFixed(1) + ' d'
      : yrs < 100 ? yrs.toFixed(1) + ' yr'
      :             (yrs / 1000).toFixed(2) + ' kyr';

    if (bodies.length > 1 && physics._initEnergy !== null) {
      const EMA = 0.05;
      if (this._ke    == null) this._ke    = physics.kineticEnergy;
      if (this._te    == null) this._te    = physics.totalEnergy;
      if (this._drift == null) this._drift = physics.energyDrift;
      this._ke    = this._ke    * (1 - EMA) + physics.kineticEnergy * EMA;
      this._te    = this._te    * (1 - EMA) + physics.totalEnergy   * EMA;
      this._drift = this._drift * (1 - EMA) + physics.energyDrift   * EMA;

      const fmt = v => {
        const a = Math.abs(v);
        return a >= 1e9 ? (v/1e9).toFixed(2) + ' G'
             : a >= 1e6 ? (v/1e6).toFixed(2) + ' M'
             : a >= 1e3 ? (v/1e3).toFixed(2) + ' k'
             : v.toFixed(2);
      };

      this._dom.ke.textContent      = fmt(this._ke);
      this._dom.te.textContent      = fmt(this._te);
      this._dom.drift.textContent   = this._drift.toFixed(3) + '%';
      this._dom.drift.dataset.good  = Math.abs(this._drift) < 0.1 ? 'true' : 'false';

      if (this._dom.seKe) {
        this._dom.seKe.textContent    = fmt(this._ke);
        this._dom.sePe.textContent    = fmt(physics.potentialEnergy);
        this._dom.seTe.textContent    = fmt(this._te);
        this._dom.seDrift.textContent = this._drift.toFixed(4) + '%';
        this._dom.seDrift.style.color =
          Math.abs(this._drift) < 0.1 ? '#4ade80'
          : Math.abs(this._drift) < 1 ? '#facc15' : '#f87171';
      }

      if (this._dom.seSteps) {
        const n = physics.lastMicroSteps;
        this._dom.seSteps.textContent = n != null ? n + (n >= 100 ? ' ⚠' : '') : '—';
        this._dom.seSteps.style.color =
          n >= 100 ? '#f87171' : n >= 20 ? '#facc15' : 'var(--text)';
      }
    } else {
      this._ke = null; this._te = null; this._drift = null;
      [this._dom.ke, this._dom.te, this._dom.drift].forEach(el => {
        if (el) el.textContent = '—';
      });
    }
  }
}
