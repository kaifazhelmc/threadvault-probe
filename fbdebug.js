(() => {
  const W = innerWidth;
  const spans = [...document.querySelectorAll('span, div')].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.whiteSpace !== 'pre') return false;
    const t = el.textContent || '';
    return /[一-鿿]/.test(t) && t.length > 12 && el.children.length === 0;
  }).slice(0, 4);
  const cv = document.createElement('canvas').getContext('2d');
  const rows = spans.map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const m = cv.measureText(el.textContent).width;
    const chain = [];
    let p = el.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      const pr = p.getBoundingClientRect();
      chain.push(p.tagName + ' W' + Math.round(pr.width) + ' ' + (p.getAttribute('style') || '').replace(/color:[^;]+;?/g, '').slice(0, 50));
    }
    return 'len' + el.textContent.length + ' R' + Math.round(r.right) + ' W' + Math.round(r.width) + ' canvas' + Math.round(m) + ' ls ' + cs.letterSpacing + ' fs ' + cs.fontSize + ' | ' + chain.join(' > ');
  });
  const faces = [...document.fonts].map((f) => f.family + ':' + f.status).slice(0, 6).join(',');
  return 'W' + W + ' n' + spans.length + ' fonts ' + faces + ' ## ' + rows.join(' ## ');
})()
