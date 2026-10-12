import './styles.css';

const topbar = document.querySelector('.topbar');
const scrollTitle = document.querySelector('.scroll-title');
const hero = document.querySelector('.hero');
const reelsCarousel = document.querySelector('#reelsCarousel');

const reels = [
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: new URL('./assets/reels/reel-1.jpg', import.meta.url).href,
    href: 'https://www.instagram.com/reel/DdVWckkKyxw/?stkn=ODN3ajIwazloOWV1',
  },
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: new URL('./assets/reels/reel-2.jpg', import.meta.url).href,
    href: 'https://www.instagram.com/reel/DcujX35qKmg/?stkn=d3FibWhmYzdvN3M5',
  },
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: new URL('./assets/reels/reel-3.jpg', import.meta.url).href,
    href: 'https://www.instagram.com/reel/DcmtFHqJfOX/?stkn=MWJzNmx2Y2liNndqaQ==',
  },
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: new URL('./assets/reels/reel-4.jpg', import.meta.url).href,
    href: 'https://www.instagram.com/reel/DbV6JHmK3e-/?stkn=emFodmE1amUzZ2Rs',
  },
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: new URL('./assets/reels/reel-5.jpg', import.meta.url).href,
    href: 'https://www.instagram.com/reel/DMRgjIkx6pf/?stkn=NHQ5Nnh0dnVpbDFw',
  },
];

const updateScrollState = () => {
  if (!topbar || !scrollTitle || !hero) return;

  const heroHeight = hero.offsetHeight || window.innerHeight;
  const triggerPoint = heroHeight * 0.55;
  const shouldShowTitle = window.scrollY > triggerPoint;

  topbar.classList.toggle('is-scrolled', shouldShowTitle);
  scrollTitle.classList.toggle('is-visible', shouldShowTitle);
};

updateScrollState();
window.addEventListener('scroll', updateScrollState, { passive: true });
window.addEventListener('resize', updateScrollState);

const renderReelsCarousel = () => {
  if (!reelsCarousel) return;

  reelsCarousel.innerHTML = reels
    .map((reel) => {
      return `
        <article class="reel-card">
          <a href="${reel.href}" target="_blank" rel="noreferrer" class="reel-card__link">
            <div class="reel-card__media">
              <img class="reel-card__preview" src="${reel.previewSrc}" alt="${reel.title}" loading="lazy" />
              <div class="reel-card__chip">Open reel</div>
            </div>
          </a>
        </article>
      `;
    })
    .join('');
};

const shell = document.querySelector('.reels-carousel-shell');
let reelCards = [];
let activeReel = 0;

const pad = (n) => String(n).padStart(2, '0');

const buildReelControls = () => {
  if (!shell || !reelsCarousel) return;
  reelCards = [...reelsCarousel.querySelectorAll('.reel-card')];

  const controls = document.createElement('div');
  controls.className = 'reel-controls';
  controls.innerHTML = reelCards
    .map((_, i) => `<button type="button" aria-label="Go to reel ${i + 1}" data-dot="${i}"></button>`)
    .join('');
  shell.after(controls);

  controls.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.dot) goToReel(Number(btn.dataset.dot));
  });
};

const goToReel = (index) => {
  const i = Math.max(0, Math.min(reelCards.length - 1, index));
  const card = reelCards[i];
  if (!card) return;
  reelsCarousel.scrollTo({ left: card.offsetLeft - reelsCarousel.offsetLeft - 2, behavior: 'smooth' });
};

const updateReelState = () => {
  if (!reelCards.length) return;
  const max = reelsCarousel.scrollWidth - reelsCarousel.clientWidth;
  const ratio = max > 0 ? reelsCarousel.scrollLeft / max : 0;
  const nearest = reelCards.reduce(
    (best, card, i) => {
      const d = Math.abs(card.offsetLeft - reelsCarousel.offsetLeft - 2 - reelsCarousel.scrollLeft);
      return d < best.d ? { i, d } : best;
    },
    { i: 0, d: Infinity }
  ).i;
  activeReel = ratio > 0.98 ? reelCards.length - 1 : nearest;

  reelCards.forEach((c, i) => c.classList.toggle('is-active', i === activeReel));
  const controls = document.querySelector('.reel-controls');
  if (!controls) return;
  controls.querySelectorAll('[data-dot]').forEach((d, i) => d.classList.toggle('is-active', i === activeReel));
};

// Mouse drag to scroll
let dragStartX = 0;
let dragStartLeft = 0;
let dragging = false;
let dragMoved = false;

reelsCarousel?.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') return;
  dragging = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragStartLeft = reelsCarousel.scrollLeft;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragStartX;
  if (Math.abs(dx) > 5 && !dragMoved) {
    dragMoved = true;
    reelsCarousel.classList.add('is-dragging');
  }
  if (dragMoved) reelsCarousel.scrollLeft = dragStartLeft - dx;
});
window.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  reelsCarousel.classList.remove('is-dragging');
  if (dragMoved) goToReel(activeReel);
});
reelsCarousel?.addEventListener('click', (e) => {
  if (dragMoved) {
    e.preventDefault();
    dragMoved = false;
  }
}, true);
reelsCarousel?.addEventListener('dragstart', (e) => e.preventDefault());
reelsCarousel?.addEventListener('scroll', updateReelState, { passive: true });

renderReelsCarousel();
buildReelControls();
updateReelState();

// Gentle autoplay hints that the row can be moved; pauses while the user interacts
let autoplayId = null;
const startReelAutoplay = () => {
  if (autoplayId) return;
  autoplayId = window.setInterval(() => {
    goToReel(activeReel >= reelCards.length - 1 ? 0 : activeReel + 1);
  }, 3200);
};
const stopReelAutoplay = () => {
  window.clearInterval(autoplayId);
  autoplayId = null;
};
['mouseenter', 'pointerdown', 'touchstart', 'focusin'].forEach((ev) => reelsCarousel?.addEventListener(ev, stopReelAutoplay, { passive: true }));
['mouseleave', 'focusout'].forEach((ev) => reelsCarousel?.addEventListener(ev, startReelAutoplay));
startReelAutoplay();
const revealTargets = document.querySelectorAll(
  '.services__header, .dark-panel__intro, .dark-panel__item, .red-panel__content, .contact__col, .footer, .brands, .gallery'
);
revealTargets.forEach((el) => el.classList.add('reveal'));
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);
revealTargets.forEach((el) => revealObserver.observe(el));
