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

let carouselAutoScrollId = null;

const scrollReelsCarousel = (direction) => {
  if (!reelsCarousel) return;

  const scrollAmount = Math.round(reelsCarousel.clientWidth * 0.8);
  reelsCarousel.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
};

const startCarouselAutoScroll = () => {
  if (!reelsCarousel || carouselAutoScrollId) return;

  carouselAutoScrollId = window.setInterval(() => {
    const maxScrollLeft = reelsCarousel.scrollWidth - reelsCarousel.clientWidth - 4;
    const atEnd = reelsCarousel.scrollLeft >= maxScrollLeft;

    if (atEnd) {
      reelsCarousel.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }

    scrollReelsCarousel(1);
  }, 2600);
};

const stopCarouselAutoScroll = () => {
  if (!carouselAutoScrollId) return;

  window.clearInterval(carouselAutoScrollId);
  carouselAutoScrollId = null;
};

reelsCarousel?.addEventListener('mouseenter', stopCarouselAutoScroll);
reelsCarousel?.addEventListener('mouseleave', startCarouselAutoScroll);
reelsCarousel?.addEventListener('focusin', stopCarouselAutoScroll);
reelsCarousel?.addEventListener('focusout', startCarouselAutoScroll);

renderReelsCarousel();
startCarouselAutoScroll();

const revealTargets = document.querySelectorAll(
  '.services__header, .dark-panel__intro, .dark-panel__item, .red-panel__content, .contact__col, .footer'
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
