/* Paper deck scenes, from the Zenod product deck (EPIC-12 P1). No dependencies, about 90 lines.
 *
 * A scene is any element with class "scene", data-len="<loop ms>". Inside it:
 *   data-at="<ms>"    the element gets .go at that time in the loop (CSS decides what .go looks like)
 *   data-off="<ms>"   ... and loses .go again (typing dots, a hint that leaves)
 *   data-type="text"  the element types this text, 45 ms a letter, from 300 ms; the scene gets .q when typing ends
 *   data-p="<n>"      inside a step: counts up to n% over 700 ms when the step goes
 * The scene plays while 35% of it is on screen, restarts from zero each time it comes back, fades out over the
 * last 600 ms of each loop (.fade) and loops. Off screen it rests on its final frame.
 * ?still in the URL, prefers-reduced-motion, or no IntersectionObserver: final frame only, no motion at all.
 * Without this script nothing is hidden: the CSS only hides steps under .scene.js, so the page reads as the final frame.
 * Arrow keys and Page Up/Down move one .slide at a time.
 */
(function () {
  document.addEventListener('keydown', function (e) {
    if (['ArrowDown', 'PageDown', 'ArrowUp', 'PageUp'].indexOf(e.key) < 0) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    var s = Array.prototype.slice.call(document.querySelectorAll('.slide'));
    if (!s.length) return;
    var y = window.scrollY + 10, i = 0;
    s.forEach(function (el, k) { if (el.offsetTop <= y) i = k; });
    var down = e.key === 'ArrowDown' || e.key === 'PageDown';
    e.preventDefault();
    s[down ? Math.min(i + 1, s.length - 1) : Math.max(i - 1, 0)].scrollIntoView();
  });

  var still = /[?&]still\b/.test(location.search) ||
    (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function count(el) {
    var to = +el.getAttribute('data-p'), t0 = performance.now();
    (function f(now) {
      var k = Math.min(1, (now - t0) / 700);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + '%';
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }
  function stop(sc) { (sc._t || []).forEach(clearTimeout); sc._t = []; }
  function final(sc) {
    stop(sc); sc.classList.remove('fade'); sc.classList.add('q');
    sc.querySelectorAll('[data-at]').forEach(function (el) { el.classList.toggle('go', !el.hasAttribute('data-off')); });
    sc.querySelectorAll('[data-type]').forEach(function (q) { q.textContent = q.getAttribute('data-type'); });
    sc.querySelectorAll('[data-p]').forEach(function (p) { p.textContent = p.getAttribute('data-p') + '%'; });
  }
  function play(sc) {
    stop(sc);
    var T = sc._t, len = +sc.getAttribute('data-len') || 10000, steps = sc.querySelectorAll('[data-at]');
    sc.classList.remove('fade', 'q');
    steps.forEach(function (el) { el.classList.remove('go'); });
    steps.forEach(function (el) {
      T.push(setTimeout(function () {
        el.classList.add('go');
        if (el.hasAttribute('data-p')) count(el);
        el.querySelectorAll('[data-p]').forEach(count);
      }, +el.getAttribute('data-at')));
      if (el.hasAttribute('data-off')) T.push(setTimeout(function () { el.classList.remove('go'); }, +el.getAttribute('data-off')));
    });
    var typed = 0;
    sc.querySelectorAll('[data-type]').forEach(function (q) {
      var txt = q.getAttribute('data-type');
      q.textContent = '';
      for (var i = 1; i <= txt.length; i++) (function (i) { T.push(setTimeout(function () { q.textContent = txt.slice(0, i); }, 300 + i * 45)); })(i);
      typed = Math.max(typed, 300 + txt.length * 45 + 200);
    });
    if (typed) T.push(setTimeout(function () { sc.classList.add('q'); }, typed));
    T.push(setTimeout(function () { sc.classList.add('fade'); }, len - 600));
    T.push(setTimeout(function () { if (sc._on) play(sc); }, len));
  }

  document.querySelectorAll('.scene').forEach(function (sc) {
    sc.classList.add('js');
    final(sc);
    if (still || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { sc._on = e.isIntersecting; if (e.isIntersecting) play(sc); else final(sc); });
    }, { threshold: 0.35 }).observe(sc);
  });
})();
