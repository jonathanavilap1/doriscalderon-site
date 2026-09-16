import './styles.css';

const topbar = document.querySelector('.topbar');
const scrollTitle = document.querySelector('.scroll-title');
const hero = document.querySelector('.hero');
const reelsCarousel = document.querySelector('#reelsCarousel');

const reels = [
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: 'https://scontent.cdninstagram.com/v/t51.82787-15/812940374_18336347539272958_8739881983344618762_n.jpg?stp=cmp1_dst-jpg_e35_s640x640_tt6&_nc_cat=109&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiQ0xJUFMuYmVzdF9pbWFnZV91cmxnZW4uQzMifQ%3D%3D&_nc_ohc=ionfyCaZXpQQ7kNvwFkFMij&_nc_oc=AdqFqiI-dkU7_xBbMJvgpE1vQRB4LrZWaGjd51Rq5WXbYcIFOYg13VohHl1R9NEoAGE&_nc_zt=23&_nc_ht=scontent.cdninstagram.com&_nc_gid=0MOmeBCJ4S_6UftKtJVGvg&_nc_ss=7060f&oh=00_AQL1pOOKzTLJWssUugdrz6Vm-I9JxGtDp06q7MczIej aAw&oe=6AB0C23E'.replace(/\s+/g, ''),
    href: 'https://www.instagram.com/reel/DdVWckkKyxw/?stkn=ODN3ajIwazloOWV1',
  },
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: 'https://scontent.cdninstagram.com/v/t51.71878-15/792133063_4140816922720753_6691737151194218916_n.jpg?stp=cmp1_dst-jpg_e35_s640x640_tt6&_nc_cat=105&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiQ0xJUFMuYmVzdF9pbWFnZV91cmxnZW4uQzMifQ%3D%3D&_nc_ohc=c-e799zYNa4Q7kNvwHxDU_d&_nc_oc=AdqixFIhwbvGsUQEgnwshqOKHjE1aYIJvPaWWaG8jRyTFMw9402ve20f1RKi-kTX_Ic&_nc_zt=23&_nc_ht=scontent.cdninstagram.com&_nc_gid=_dtWjSVSqLr36ztu9rO1Gg&_nc_ss=7060f&oh=00_AQJFH0bDfVZvqJpMoZrVZSk6L4pf1FE-EIu3L560X7tSRA&oe=6AB0B2BC'.replace(/\s+/g, ''),
    href: 'https://www.instagram.com/reel/DcujX35qKmg/?stkn=d3FibWhmYzdvN3M5',
  },
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: 'https://scontent.cdninstagram.com/v/t51.82787-15/789237118_18333720499272958_6946304254299882748_n.jpg?stp=cmp1_dst-jpg_e35_s640x640_tt6&_nc_cat=106&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiQ0xJUFMuYmVzdF9pbWFnZV91cmxnZW4uQzMifQ%3D%3D&_nc_ohc=DWZCmoNW7t8Q7kNvwHU_6ku&_nc_oc=AdoteE9fOFCRUAu7ZRYLAvEe0yHbiclZRa_yBHXvCveso1mhyPtMGpZZNhEPX3l998A&_nc_zt=23&_nc_ht=scontent.cdninstagram.com&_nc_gid=Xu0mxIo3ax5MuPTzF2p_GA&_nc_ss=7060f&oh=00_AQJQBU5RQSl2ZnQAWGyWgraLQYDSlPbyUgnIZb9oR2z5zg&oe=6AB0A82C'.replace(/\s+/g, ''),
    href: 'https://www.instagram.com/reel/DcmtFHqJfOX/?stkn=MWJzNmx2Y2liNndqaQ==',
  },
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: 'https://scontent.cdninstagram.com/v/t51.82787-15/756045893_18329001928272958_998701801815614318_n.jpg?stp=cmp1_dst-jpg_e35_s640x640_tt6&_nc_cat=106&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiQ0xJUFMuYmVzdF9pbWFnZV91cmxnZW4uQzMifQ%3D%3D&_nc_ohc=mhmR-NZMEWEQ7kNvwHGv4rJ&_nc_oc=AdqrdizzzGTircHBk2TZKYEkTrbuZT2pFxKI8ZHrc1FZADrGHD6FUeSFt1Vxba4stfk&_nc_zt=23&_nc_ht=scontent.cdninstagram.com&_nc_gid=VCh2KBFGJXXpmSjgHwvNdw&_nc_ss=7060f&oh=00_AQLE3fxJLC755e9xN-xLcyrWZtPDuPq-914d_xhmkqheWQ&oe=6AB0C4EC'.replace(/\s+/g, ''),
    href: 'https://www.instagram.com/reel/DbV6JHmK3e-/?stkn=emFodmE1amUzZ2Rs',
  },
  {
    title: 'Selected reel',
    description: 'Open the original reel on Instagram.',
    previewSrc: 'https://scontent.cdninstagram.com/v/t51.82787-15/522397725_18279980986272958_6851778800452631430_n.jpg?stp=cmp1_dst-jpg_e35_s640x640_tt6&_nc_cat=108&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiQ0xJUFMuYmVzdF9pbWFnZV91cmxnZW4uQzMifQ%3D%3D&_nc_ohc=-NAGIqucka8Q7kNvwGIbK9k&_nc_oc=AdqFEdTccgxA6ntpuQ-5j9z4GUKWPJI90UKGct2vTNhTfvRJE1PCcZN48fVqoujmxXk&_nc_zt=23&_nc_ht=scontent.cdninstagram.com&_nc_gid=Ldu76xwI-hAmsW7fDdnYcQ&_nc_ss=7060f&oh=00_AQLae32h0YuH_OSacw9usdMYdwZHFh72KDaL56BCh6z7fg&oe=6AB0D70C'.replace(/\s+/g, ''),
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
