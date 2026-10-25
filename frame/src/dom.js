// Tiny DOM helpers shared by the v2 screens. textContent only: nothing from the network becomes HTML.

/** h('div', 'cls', 'text', [children]) */
export function h(tag, cls, text, kids) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null && text !== '') el.textContent = text;
  if (kids) for (const k of kids) if (k) el.appendChild(k);
  return el;
}

/** A tappable button routed through main.js's single tap handler (data-act). */
export function btn(label, act, cls, extra) {
  const b = h('button', 'btn' + (cls ? ' ' + cls : ''), label);
  b.type = 'button';
  b.setAttribute('data-act', act);
  if (extra) for (const k of Object.keys(extra)) b.setAttribute('data-' + k, extra[k]);
  return b;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A 28 px line icon from path data (stroke = currentColor, so inverting the item inverts it). */
export function icon(d, size = 28) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

/** Weather icon <img> from the shared icon set. */
export function wxImg(name, cls) {
  const img = h('img', cls || 'wx');
  img.alt = '';
  if (name) img.src = './icons/' + name + '.svg';
  return img;
}
