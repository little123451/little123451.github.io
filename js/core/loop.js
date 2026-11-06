const STEP_MS = 1000 / 60;

export function createLoop(update, render) {
  let rafId = 0;
  let last = 0;
  let acc = 0;
  let running = false;

  function frame(now) {
    if (!running) return;
    if (!last) last = now;
    let delta = now - last;
    last = now;
    if (delta > 250) delta = STEP_MS;
    acc += delta;
    let steps = 0;
    while (acc >= STEP_MS && steps < 5) {
      update(STEP_MS / 1000);
      acc -= STEP_MS;
      steps += 1;
    }
    if (steps === 5) acc = 0;
    render(acc / STEP_MS);
    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      acc = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    get running() {
      return running;
    },
  };
}
