/* Cursorful clone: progressive enhancement only.
   Every section renders and reads correctly with JavaScript disabled. */

(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------------------------------------------------------------- nav */
  const nav = $('#nav');
  if (nav) {
    const setStuck = () => nav.classList.toggle('is-stuck', window.scrollY > 12);
    setStuck();
    window.addEventListener('scroll', setStuck, { passive: true });
  }

  const burger = $('#burger');
  const menu = $('#mobileMenu');
  if (burger && menu) {
    const setOpen = (open) => {
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.hidden = !open;
    };
    burger.addEventListener('click', () => setOpen(menu.hidden));
    $$('a', menu).forEach((a) => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        setOpen(false);
        burger.focus();
      }
    });
  }

  /* ------------------------------------------------------------- reveal */
  const revealables = $$('.reveal');
  if (revealables.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealables.forEach((el) => el.classList.add('in'));
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('in');
              io.unobserve(entry.target);
            }
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
      );
      revealables.forEach((el) => io.observe(el));
    }
  }

  /* --------------------------------------------------------- demo timeline */
  const track = $('#track');
  if (track) {
    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

    const apply = (seg, leftPct, widthPct) => {
      seg.style.setProperty('--x', `${leftPct}%`);
      seg.style.setProperty('--w', `${widthPct}%`);
    };

    const read = (seg) => ({
      x: parseFloat(seg.style.getPropertyValue('--x')) || 0,
      w: parseFloat(seg.style.getPropertyValue('--w')) || 14,
    });

    $$('.zoomseg', track).forEach((seg) => {
      const start = (event) => {
        const handle = event.target.closest('.handle');
        const mode = handle ? (handle.classList.contains('handle--l') ? 'left' : 'right') : 'move';
        const rect = track.getBoundingClientRect();
        const origin = read(seg);
        const startPct = ((event.clientX - rect.left) / rect.width) * 100;
        seg.setPointerCapture?.(event.pointerId);

        const move = (e) => {
          const nowPct = ((e.clientX - rect.left) / rect.width) * 100;
          const delta = nowPct - startPct;
          if (mode === 'move') {
            apply(seg, clamp(origin.x + delta, 0, 100 - origin.w), origin.w);
          } else if (mode === 'left') {
            const nextX = clamp(origin.x + delta, 0, origin.x + origin.w - 6);
            apply(seg, nextX, origin.w + (origin.x - nextX));
          } else {
            apply(seg, origin.x, clamp(origin.w + delta, 6, 100 - origin.x));
          }
        };

        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        event.preventDefault();
      };

      seg.addEventListener('pointerdown', start);
      seg.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 5 : 1.5;
        const cur = read(seg);
        if (e.key === 'ArrowLeft') {
          apply(seg, clamp(cur.x - step, 0, 100 - cur.w), cur.w);
          e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          apply(seg, clamp(cur.x + step, 0, 100 - cur.w), cur.w);
          e.preventDefault();
        }
      });
    });

    const play = $('.demo__play', $('[data-demo]'));
    if (play) {
      play.addEventListener('click', () => {
        const paused = play.getAttribute('aria-label') === 'Play preview';
        play.setAttribute('aria-label', paused ? 'Pause preview' : 'Play preview');
        play.innerHTML = paused
          ? '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3" y="2" width="2" height="8" rx="1" fill="currentColor"/><rect x="7" y="2" width="2" height="8" rx="1" fill="currentColor"/></svg>'
          : '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.4l6 3.6-6 3.6z" fill="currentColor"/></svg>';
      });
    }
  }

  /* ------------------------------------------------------------ look panel */
  const stage = $('#lookStage');
  if (stage) {
    $$('.seg').forEach((group) => {
      const key = group.dataset.group;
      $$('button', group).forEach((btn) => {
        btn.addEventListener('click', () => {
          $$('button', group).forEach((b) => b.classList.toggle('is-on', b === btn));
          stage.dataset[key] = btn.dataset.value;
        });
      });
    });
  }

  /* --------------------------------------------------------------- seats */
  const seatCount = $('#seatCount');
  if (seatCount) {
    const minus = $('#seatMinus');
    const plus = $('#seatPlus');
    const perSeat = $('#perSeat');
    const pills = $$('.seats__pills button');
    let seats = 1;

    const render = () => {
      seatCount.textContent = String(seats);
      const total = 79 * seats;
      perSeat.textContent = seats === 1
        ? '$79 per seat · one-time payment'
        : `$79 per seat · $${total} total, one-time payment`;
      pills.forEach((p) => p.classList.toggle('is-on', Number(p.dataset.seats) === seats));
      minus.disabled = seats <= 1;
      plus.disabled = seats >= 20;
      minus.style.opacity = minus.disabled ? '.4' : '1';
      plus.style.opacity = plus.disabled ? '.4' : '1';
    };

    minus.addEventListener('click', () => { seats = Math.max(1, seats - 1); render(); });
    plus.addEventListener('click', () => { seats = Math.min(20, seats + 1); render(); });
    pills.forEach((p) => p.addEventListener('click', () => { seats = Number(p.dataset.seats); render(); }));
    render();
  }

  /* -------------------------------------------------------- cursor effects */
  const cards = $$('[data-cursor-effect]');
  if (cards.length && !reduceMotion) {
    cards.forEach((card) => {
      const field = $('.cursorcard__field', card);
      const kind = card.dataset.cursorEffect;
      const els = {
        raw: $('.raw-cursor', card),
        soft: $('.soft-cursor', card),
        big: $('.big-cursor', card),
        blur: $('.blur-cursor', card),
      };

      let targetX = 0;
      let targetY = 0;
      let softX = 0;
      let softY = 0;
      let lastX = 0;
      let lastY = 0;
      let velocity = 0;
      let active = false;
      let raf = 0;

      const size = (el) => (el ? el.offsetWidth || 22 : 22);

      const onMove = (e) => {
        const rect = field.getBoundingClientRect();
        targetX = e.clientX - rect.left;
        targetY = e.clientY - rect.top;
        if (!active) {
          active = true;
          softX = targetX;
          softY = targetY;
          lastX = targetX;
          lastY = targetY;
          if (kind === 'size') place(els.big, targetX, targetY);
          if (kind === 'blur') place(els.blur, targetX, targetY);
          if (els.raw) place(els.raw, targetX, targetY);
        }
      };

      function place(el, x, y) {
        if (!el) return;
        const s = size(el);
        el.style.transform = `translate3d(${x - s / 2}px, ${y - s / 2}px, 0)`;
      }

      const tick = () => {
        if (!active) {
          raf = 0;
          return;
        }

        if (kind === 'smooth') {
          softX += (targetX - softX) * 0.14;
          softY += (targetY - softY) * 0.14;
          place(els.soft, softX, softY);
          // raw input carries a small hand tremor
          const jx = Math.sin(performance.now() / 90) * 1.6;
          const jy = Math.cos(performance.now() / 120) * 1.6;
          place(els.raw, targetX + jx, targetY + jy);
        }

        if (kind === 'size') {
          place(els.big, targetX, targetY);
        }

        if (kind === 'blur') {
          const dx = targetX - lastX;
          const dy = targetY - lastY;
          velocity = velocity * 0.86 + Math.hypot(dx, dy) * 0.14;
          lastX = targetX;
          lastY = targetY;
          const s = size(els.blur);
          const angle = Math.max(-24, Math.min(24, dx * 1.6));
          const blur = Math.min(5, velocity / 5);
          els.blur.style.transform =
            `translate3d(${targetX - s / 2}px, ${targetY - s / 2}px, 0) rotate(${angle}deg)`;
          els.blur.style.filter = `blur(${blur.toFixed(2)}px)`;
        }

        raf = requestAnimationFrame(tick);
      };

      field.addEventListener('pointerenter', () => {
        field.classList.add('is-live');
        if (kind === 'size') place(els.big, targetX, targetY);
        if (!raf) raf = requestAnimationFrame(tick);
      });
      field.addEventListener('pointermove', onMove);
      field.addEventListener('pointerleave', () => {
        active = false;
        field.classList.remove('is-live');
        [els.raw, els.soft, els.big, els.blur].forEach((el) => {
          if (el) el.style.filter = '';
        });
      });
    });
  }

  /* ----------------------------------------------------------- faq accordion */
  const accs = $$('.acc');
  accs.forEach((acc) => {
    acc.addEventListener('toggle', () => {
      if (!acc.open) return;
      accs.forEach((other) => {
        if (other !== acc) other.open = false;
      });
    });
  });

  /* --------------------------------------------------- active section link */
  const links = $$('.nav__links a');
  if (links.length && 'IntersectionObserver' in window) {
    const map = new Map();
    links.forEach((link) => {
      const id = link.getAttribute('href').slice(1);
      const section = document.getElementById(id);
      if (section) map.set(section, link);
    });
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((l) => l.removeAttribute('aria-current'));
          map.get(entry.target)?.setAttribute('aria-current', 'true');
        });
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );
    map.forEach((_, section) => spy.observe(section));
  }
})();
