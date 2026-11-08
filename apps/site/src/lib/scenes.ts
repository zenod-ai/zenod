// Scene player for the landing's product animations, ported from the EPIC-12
// deck kit (docs/epic12/design-kit/scenes.js). A scene is an element with
// class "scene" and data-len (loop ms). Inside it, data-at="<ms>" adds .go at
// that time, data-off="<ms>" removes it again, data-type types its text and
// data-p counts a percentage up. A scene plays while 35% of it is on screen,
// restarts each time it comes back and rests on its final frame otherwise.
// Reduced motion or no IntersectionObserver: final frame only, nothing moves.
// Without script nothing is hidden: CSS hides steps only under .scene.js.

type Timers = number[];

function count(el: HTMLElement) {
  const to = Number(el.dataset.p);
  const t0 = performance.now();
  const frame = (now: number) => {
    const k = Math.min(1, (now - t0) / 700);
    el.textContent = `${Math.round(to * (1 - Math.pow(1 - k, 3)))}%`;
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function final(scene: HTMLElement) {
  scene.classList.remove("fade");
  scene.classList.add("q");
  scene.querySelectorAll<HTMLElement>("[data-at]").forEach((el) => el.classList.toggle("go", !el.hasAttribute("data-off")));
  scene.querySelectorAll<HTMLElement>("[data-type]").forEach((el) => (el.textContent = el.dataset.type ?? ""));
  scene.querySelectorAll<HTMLElement>("[data-p]").forEach((el) => (el.textContent = `${el.dataset.p}%`));
}

function play(scene: HTMLElement, timers: Timers, onScreen: () => boolean) {
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const len = Number(scene.dataset.len) || 10000;
  const steps = scene.querySelectorAll<HTMLElement>("[data-at]");
  scene.classList.remove("fade", "q");
  steps.forEach((el) => el.classList.remove("go"));
  steps.forEach((el) => {
    at(Number(el.dataset.at), () => {
      el.classList.add("go");
      if (el.hasAttribute("data-p")) count(el);
      el.querySelectorAll<HTMLElement>("[data-p]").forEach(count);
    });
    if (el.hasAttribute("data-off")) at(Number(el.dataset.off), () => el.classList.remove("go"));
  });
  let typed = 0;
  scene.querySelectorAll<HTMLElement>("[data-type]").forEach((el) => {
    const text = el.dataset.type ?? "";
    el.textContent = "";
    for (let i = 1; i <= text.length; i++) at(300 + i * 45, () => (el.textContent = text.slice(0, i)));
    typed = Math.max(typed, 300 + text.length * 45 + 200);
  });
  if (typed) at(typed, () => scene.classList.add("q"));
  at(len - 600, () => scene.classList.add("fade"));
  at(len, () => {
    if (onScreen()) play(scene, timers, onScreen);
  });
}

export function startScenes(root: ParentNode): () => void {
  const still =
    !("IntersectionObserver" in window) ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    /[?&]still\b/.test(window.location.search);
  const cleanups: Array<() => void> = [];
  root.querySelectorAll<HTMLElement>(".scene").forEach((scene) => {
    scene.classList.add("js");
    final(scene);
    if (still) return;
    const timers: Timers = [];
    let visible = false;
    const stop = () => timers.splice(0).forEach((id) => window.clearTimeout(id));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.isIntersecting;
          stop();
          if (visible) play(scene, timers, () => visible);
          else final(scene);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(scene);
    cleanups.push(() => {
      observer.disconnect();
      stop();
    });
  });
  return () => cleanups.forEach((cleanup) => cleanup());
}
