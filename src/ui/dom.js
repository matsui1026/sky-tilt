// 小さな DOM ヘルパー
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** タップで反応するボタン（押下フィードバック＋振動） */
export function tapButton(label, onTap, cls = 'btn', attrs = {}) {
  const b = h('button', { class: cls, type: 'button', ...attrs }, label);
  b.addEventListener('pointerdown', () => b.classList.add('pressed'));
  const clear = () => b.classList.remove('pressed');
  b.addEventListener('pointerup', clear);
  b.addEventListener('pointercancel', clear);
  b.addEventListener('pointerleave', clear);
  b.addEventListener('click', (e) => {
    try { if (navigator.vibrate && tapButton.vibrate !== false) navigator.vibrate(10); } catch (err) { /* 非対応 */ }
    onTap(e);
  });
  return b;
}
tapButton.vibrate = true;
