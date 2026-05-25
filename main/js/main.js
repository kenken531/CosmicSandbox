// main.js — entry point + game loop

import { Camera }   from './camera.js';
import { SIM }      from './bodies/Body.js';
import { Physics }  from './physics.js';
import { Renderer } from './renderer.js';
import { Minimap }  from './minimap.js';
import { Effects }  from './effects.js';
import { UI }       from './ui.js';

// ── Global state ─────────────────────────────────────────
const bodies   = [];
const camera   = new Camera();
const physics  = new Physics();
const effects  = new Effects();

const canvas   = document.getElementById('main-canvas');
const renderer = new Renderer(canvas);

const minimapCanvas = document.getElementById('minimap');
const minimap = new Minimap(minimapCanvas);

// ── Resize ───────────────────────────────────────────────
function resize() {
  const c = canvas.parentElement;
  renderer.resize(c.clientWidth, c.clientHeight);
}
window.addEventListener('resize', resize);
resize();

// ── UI ───────────────────────────────────────────────────
const ui = new UI(canvas, camera, bodies, physics, renderer, () => {
  physics.resetEnergy();
});

// ── Sim Settings Panel ────────────────────────────────────
_bindSimPanel();

// ── FPS ──────────────────────────────────────────────────
let lastTime = 0, fps = 60;
const FPS_SMOOTH = 0.92;
const MAX_SUBSTEPS = 8;

// ── Game loop ─────────────────────────────────────────────
function loop(timestamp) {
  const elapsed = Math.min(timestamp - lastTime, 100);
  lastTime = timestamp;
  if (elapsed > 0) fps = fps * FPS_SMOOTH + (1000 / elapsed) * (1 - FPS_SMOOTH);

  // Physics + sub-stepping
  if (physics.running && bodies.length > 1) {
    // FIX: use sqrt(timeScale) for substep count — ceil() caused dt blowup at high speeds
    // e.g. timeScale=100 → substeps=10, dt_per_step = baseDt*100/10 = baseDt*10 (manageable)
    //      instead of substeps=100 which wastes CPU for no accuracy gain
    const substeps = physics.timeScale > 2
      ? Math.min(MAX_SUBSTEPS, Math.ceil(Math.sqrt(physics.timeScale)))
      : 1;

    const saved = physics.timeScale;
    physics.timeScale = saved / substeps;

    for (let s = 0; s < substeps; s++) {
      const toRemove = physics.step(bodies);

      // Spawn collision effects before removing bodies
      for (const evt of physics.collisionEvents) {
        effects.spawnCollision(evt, camera, canvas);
      }

      if (toRemove && toRemove.length > 0) {
        for (const idx of toRemove) {
          const removed = bodies.splice(idx, 1)[0];
          if (ui.selectedId === removed.id) ui.deselect();
        }
      }
      if (bodies.length < 2) break;
    }

    physics.timeScale = saved;
  }

  // Update effects
  effects.update();

  // Render
  renderer.render(bodies, camera, ui.selectedId, ui.velArrow);
  effects.draw(renderer.ctx, camera, canvas);  // FIX: pass camera+canvas for world→screen

  // Minimap
  if (bodies.length > 0) {
    minimap.render(bodies, camera, canvas);
  } else {
    minimapCanvas.getContext('2d').clearRect(
      0, 0, minimapCanvas.width, minimapCanvas.height
    );
  }

  // HUD
  ui.updateHUD(fps, physics);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// ── Sim settings panel binding ────────────────────────────
function _bindSimPanel() {
  const panel = document.getElementById('sim-panel');

  document.getElementById('btn-settings').addEventListener('click', () => {
    panel.classList.toggle('hidden');
  });
  document.getElementById('sim-close').addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  // G multiplier
  const gSlider = document.getElementById('sim-g');
  const gVal    = document.getElementById('sim-g-val');
  gSlider.addEventListener('input', () => {
    const mult = parseFloat(gSlider.value);
    physics.G  = SIM.G * mult;       // always based on canonical G
    gVal.textContent = mult.toFixed(2) + '×';
    physics.resetEnergy();
  });

  // Softening
  const epsSlider = document.getElementById('sim-eps');
  const epsVal    = document.getElementById('sim-eps-val');
  epsSlider.addEventListener('input', () => {
    physics.softening = parseFloat(epsSlider.value);
    epsVal.textContent = physics.softening.toFixed(3) + ' AU';
  });

  // Trail length
  const trailSlider = document.getElementById('sim-trail');
  const trailVal    = document.getElementById('sim-trail-val');
  trailSlider.addEventListener('input', () => {
    const len = parseInt(trailSlider.value);
    trailVal.textContent = len;
    for (const b of bodies) b.trailMaxLen = len;
  });

  // Collision mode
  document.getElementById('sim-collision').addEventListener('change', (e) => {
    physics.collisionMode = e.target.value;
  });

  // Reset energy baseline
  document.getElementById('sim-reset-energy').addEventListener('click', () => {
    physics.resetEnergy();
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('hidden') &&
        !panel.contains(e.target) &&
        e.target.id !== 'btn-settings') {
      panel.classList.add('hidden');
    }
  });
}
