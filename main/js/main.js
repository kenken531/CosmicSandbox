// main.js — entry point, game loop, wires everything together

import { Camera }   from './camera.js';
import { Body }     from './bodies/Body.js';
import { Physics }  from './physics.js';
import { Renderer } from './renderer.js';
import { UI }       from './ui.js';

// ── Global state ─────────────────────────────────────────
const bodies  = [];          // array of Body instances — single source of truth
const camera  = new Camera();
const physics = new Physics();

const canvas  = document.getElementById('main-canvas');
const renderer = new Renderer(canvas);

// ── Resize handler ───────────────────────────────────────
function resize() {
  const container = canvas.parentElement;
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ── UI wiring ─────────────────────────────────────────────
const ui = new UI(canvas, camera, bodies, physics, renderer, () => {
  // called on scene changes (body added, removed, etc.)
});

// ── FPS tracking ─────────────────────────────────────────
let lastTime = 0;
let fps      = 60;
const FPS_SMOOTH = 0.9; // exponential moving average

// ── Game loop ─────────────────────────────────────────────
function loop(timestamp) {
  const dt = Math.min(timestamp - lastTime, 100); // cap at 100ms to avoid spiraling
  lastTime = timestamp;

  // Smooth FPS
  if (dt > 0) fps = fps * FPS_SMOOTH + (1000 / dt) * (1 - FPS_SMOOTH);

  // Physics step (if running)
  if (physics.running && bodies.length > 1) {
    const toRemove = physics.step(bodies);
    if (toRemove && toRemove.length > 0) {
      // Remove merged bodies (indices in descending order)
      for (const idx of toRemove) {
        const removed = bodies.splice(idx, 1)[0];
        // Deselect if the selected body was merged
        if (ui.selectedId === removed.id) {
          ui.deselect();
        }
      }
    }
  }

  // Render
  renderer.render(bodies, camera, ui.selectedId, ui.velArrow);

  // HUD
  ui.updateHUD(fps);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
