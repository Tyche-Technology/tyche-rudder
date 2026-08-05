/* Rudder mockups — shared nav rail + theme toggle.
   Static prototypes: one shell so five screens cannot drift apart. */

const NAV = [
  { key: 'inbox', href: '01-inbox.html', ko: '입항 대기', en: 'Inbox', count: '6' },
  { key: 'backlog', href: '02-backlog.html', ko: '선적 대기 보드', en: 'Board', count: '18' },
  { key: 'roadmap', href: '03-roadmap.html', ko: '로드맵', en: 'Roadmap' },
  { key: 'mine', href: '04-my-requests.html', ko: '내 요청', en: 'Mine', count: '4' },
];

/* 11x12 grid, 2x — the rudder: stock on the left, blade stepping aft. Pixel. */
const MARK = `<svg class="brand__mark px" width="22" height="24" viewBox="0 0 11 12" aria-hidden="true">
  <g fill="currentColor">
    <rect x="2" y="0" width="2" height="12"/>
    <rect x="4" y="3" width="1" height="6"/>
    <rect x="5" y="4" width="1" height="5"/>
    <rect x="6" y="5" width="1" height="4"/>
    <rect x="7" y="6" width="1" height="3"/>
    <rect x="8" y="7" width="1" height="2"/>
  </g>
</svg>`;

function rail(page) {
  const items = NAV.map(
    (n) => `<a class="nav__item" href="${n.href}"${n.key === page ? ' aria-current="page"' : ''}>
      <span class="nav__label">${n.ko}</span>
      <span class="nav__en">${n.en}</span>
      ${n.count ? `<span class="nav__count">${n.count}</span>` : ''}
    </a>`
  ).join('');

  return `<nav class="rail" aria-label="주 메뉴">
    <a class="brand" href="index.html">
      ${MARK}
      <span>
        <span class="brand__name">RUDDER</span><br>
        <span class="brand__sub">tyche · issues</span>
      </span>
    </a>
    <div class="nav">
      ${items}
      <div class="nav__group eyebrow">관리</div>
      <a class="nav__item" href="index.html"${page === 'system' ? ' aria-current="page"' : ''}>
        <span class="nav__label">디자인 시스템</span><span class="nav__en">Tokens</span>
      </a>
      <a class="nav__item" href="#">
        <span class="nav__label">제품 관리</span><span class="nav__en">Products</span>
      </a>
    </div>
    <div class="rail__foot">
      <button class="btn btn--ghost btn--sm" type="button" data-theme-toggle>
        <span data-theme-label>어두운 테마</span>
      </button>
      <div class="who-row">
        <span class="avatar" aria-hidden="true">한</span>
        <span>
          <span style="font-size:var(--t-13);font-weight:600">김한솔</span><br>
          <span class="mono faint">admin</span>
        </span>
      </div>
    </div>
  </nav>`;
}

const root = document.documentElement;
const saved = localStorage.getItem('rudder-theme');
if (saved) root.dataset.theme = saved;

document.addEventListener('DOMContentLoaded', () => {
  const slot = document.querySelector('[data-rail]');
  if (slot) slot.outerHTML = rail(document.body.dataset.page || '');

  const label = () => {
    const el = document.querySelector('[data-theme-label]');
    if (el) el.textContent = root.dataset.theme === 'dark' ? '밝은 테마' : '어두운 테마';
  };
  label();

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('rudder-theme', root.dataset.theme);
    label();
  });
});
