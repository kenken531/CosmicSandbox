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

// ── URL ?scene= parameter ─────────────────────────────────
// Load a preset directly from the URL, e.g. ?scene=solar-system
// Must run after UI is fully wired so _loadPreset works.
(function _loadSceneParam() {
  const params   = new URLSearchParams(window.location.search);
  const sceneId  = params.get('scene');
  if (!sceneId) return;
  // Import PRESETS lazily — ui already imports it, but we need it here too
  import('./presets.js').then(({ PRESETS }) => {
    const preset = PRESETS.find(p => p.id === sceneId);
    if (preset) {
      ui._loadPreset(preset);
      // Auto-play when loaded from URL
      if (!physics.running) ui.togglePlay();
    } else {
      console.warn(`[Cosmic Playground] Unknown scene id: "${sceneId}"`);
    }
  });
})();

// ── FPS ──────────────────────────────────────────────────
let lastTime = 0, fps = 60;
const FPS_SMOOTH = 0.92;

// ── Game loop ─────────────────────────────────────────────
function loop(timestamp) {
  const elapsed = Math.min(timestamp - lastTime, 100);
  lastTime = timestamp;
  if (elapsed > 0) fps = fps * FPS_SMOOTH + (1000 / elapsed) * (1 - FPS_SMOOTH);

  // Physics — single step call; all adaptive sub-stepping is handled inside physics.step()
  if (physics.running && bodies.length > 1) {
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
  }

  // Update effects
  effects.update();

  // Render
  renderer.render(bodies, camera, ui.selectedId, ui.velArrow, physics);
  effects.draw(renderer.ctx, camera, canvas);  // world→screen conversion needs both camera and canvas

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

  // Declare all controls upfront so the open-handler can sync them from physics state
  const gSlider    = document.getElementById('sim-g');
  const gVal       = document.getElementById('sim-g-val');
  const epsSlider  = document.getElementById('sim-eps');
  const epsVal     = document.getElementById('sim-eps-val');
  const trailSlider = document.getElementById('sim-trail');
  const trailVal   = document.getElementById('sim-trail-val');

  // Initialise labels from live physics values on page load
  gVal.textContent   = (physics.G / SIM.G).toFixed(2) + '×';
  epsSlider.value    = physics.softening;
  epsVal.textContent = physics.softening.toFixed(3) + ' AU';

  document.getElementById('btn-settings').addEventListener('click', () => {
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (opening) {
      // Sync all controls from live physics state so displayed values are never stale
      const gMult = physics.G / SIM.G;
      gSlider.value     = gMult.toFixed(2);
      gVal.textContent  = gMult.toFixed(2) + '×';
      epsSlider.value   = physics.softening;
      epsVal.textContent = physics.softening.toFixed(3) + ' AU';
      trailSlider.value = (bodies[0]?.trailMaxLen) || 500;
      trailVal.textContent = trailSlider.value;
    }
  });
  document.getElementById('sim-close').addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  // G multiplier
  gSlider.addEventListener('input', () => {
    const mult = parseFloat(gSlider.value);
    physics.G  = SIM.G * mult;       // always based on canonical G
    gVal.textContent = mult.toFixed(2) + '×';
    physics.resetEnergy();
  });

  // Softening
  epsSlider.addEventListener('input', () => {
    physics.softening = parseFloat(epsSlider.value);
    epsVal.textContent = physics.softening.toFixed(3) + ' AU';
  });

  // Trail length
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
