(() => {
'use strict';

/* =====================  utilidades  ===================== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const fmt = (s, o) => new Intl.DateTimeFormat('es-ES', o).format(parse(s));
const eur = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
const uid = p => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

const COLORS = ['#2E7D4F', '#C8382F', '#2F62B8', '#B26A00', '#7C4A9E', '#1B7F86', '#C23B7B', '#4B5A6B'];
const PRESETS = [['Mercadona', 0], ['Dia', 1], ['Lidl', 2], ['Carrefour', 5], ['Alcampo', 3], ['Aldi', 4], ['Consum', 6]];

/* =====================  datos  ===================== */
const LS = 'compra.v1', LSMETA = 'compra.meta';
let state = load();

function norm(s) { return { lists: (s && s.lists) || {}, items: (s && s.items) || {}, purchases: (s && s.purchases) || {} }; }
function load() { try { const s = JSON.parse(localStorage.getItem(LS)); if (s && typeof s === 'object') return norm(s); } catch (e) {} return norm(null); }
function save() { localStorage.setItem(LS, JSON.stringify(state)); }
function meta() { try { return JSON.parse(localStorage.getItem(LSMETA)) || {}; } catch (e) { return {}; } }
function setMeta(m) { localStorage.setItem(LSMETA, JSON.stringify(m)); }

function putList(l) { state.lists[l.id] = l; save(); cloudSet(['lists', l.id], l); }
function removeList(id) {
  delete state.lists[id]; cloudDel(['lists', id]);
  for (const it of Object.values(state.items)) if (it.listId === id) { delete state.items[it.id]; cloudDel(['items', it.id]); }
  save();
}
function putItem(it) { state.items[it.id] = it; save(); cloudSet(['items', it.id], it); }
function removeItem(id) { delete state.items[id]; save(); cloudDel(['items', id]); }
function putPurchase(p) { state.purchases[p.id] = p; save(); cloudSet(['purchases', p.id], p); }
function removePurchase(id) { delete state.purchases[id]; save(); cloudDel(['purchases', id]); }

const sortedLists = () => Object.values(state.lists).sort((a, b) => a.created - b.created);
const itemsOf = id => Object.values(state.items).filter(i => i.listId === id).sort((a, b) => a.added - b.added);

function frequent(listId) {
  const cnt = {};
  for (const p of Object.values(state.purchases)) {
    if (p.listId !== listId) continue;
    for (const it of p.items) { const k = it.name.toLowerCase(); (cnt[k] = cnt[k] || { name: it.name, n: 0 }).n++; }
  }
  const here = new Set(itemsOf(listId).map(i => i.name.toLowerCase()));
  return Object.entries(cnt).filter(([k]) => !here.has(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([, v]) => v.name);
}
function knownNames(listId) {
  const s = new Set();
  for (const p of Object.values(state.purchases)) if (p.listId === listId) p.items.forEach(i => s.add(i.name));
  return [...s].slice(0, 80);
}
function parseItem(s) {
  const m = s.match(/^(\d+(?:[.,]\d+)?\s*(?:kg|g|gr|l|ml|uds?|x)?)\s+(.+)$/i);
  return m ? { qty: m[1].replace(/\s+/g, ' ').trim(), name: cap(m[2].trim()) } : { qty: '', name: cap(s.trim()) };
}
const qtyLabel = q => !q ? '' : /^\d+$/.test(q) ? `×${q}` : q;
function parsePrice(v) {
  const n = parseFloat(String(v || '').replace(',', '.').replace(/[^\d.]/g, ''));
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/* añade uno o varios productos separados por comas */
function addItems(listId, text) {
  const here = new Set(itemsOf(listId).map(i => i.name.toLowerCase()));
  let added = 0, dup = 0, t0 = Date.now();
  for (const piece of text.split(/[,\n;]+/).map(x => x.trim()).filter(Boolean)) {
    const { qty, name } = parseItem(piece);
    if (!name) continue;
    if (here.has(name.toLowerCase())) { dup++; continue; }
    here.add(name.toLowerCase());
    putItem({ id: uid('i'), listId, name, qty, got: false, added: t0 + added });
    added++;
  }
  return { added, dup };
}

/* =====================  estado de la interfaz  ===================== */
let view = 'home', curList = null, hist = { cursor: today().slice(0, 7), day: null }, lform = null, undoFn = null, pcur = null, pendingPhoto = null, photoTarget = null;
const IC = {
  chk: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>'
};

/* =====================  pantalla encendida durante la compra  ===================== */
let wl = null;
async function syncWake() {
  const l = view === 'list' && state.lists[curList];
  const want = !!(l && l.shopping);
  try {
    if (want && !wl && 'wakeLock' in navigator) {
      wl = await navigator.wakeLock.request('screen');
      wl.addEventListener('release', () => { wl = null; });
    } else if (!want && wl) { await wl.release(); wl = null; }
  } catch (e) {}
}

/* =====================  vistas  ===================== */
function render() {
  const act = document.activeElement, keep = {};
  ['addinp', 'joincode'].forEach(id => { const e = $('#' + id); if (e) keep[id] = { v: e.value, f: act === e }; });
  if (view === 'list' && !state.lists[curList]) { view = 'home'; curList = null; }
  const y = window.scrollY;
  $('#app').innerHTML = ({ home: vHome, list: vList, history: vHistory, settings: vSettings })[view]();
  $('nav').hidden = view === 'list';
  document.body.classList.toggle('inlist', view === 'list');
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  for (const id in keep) { const e = $('#' + id); if (e) { e.value = keep[id].v; if (keep[id].f) e.focus(); } }
  window.scrollTo(0, y);
  syncWake();
}

function presetPills(act) {
  return PRESETS.map(([n, c]) => `<button class="pill p" style="--c:${COLORS[c]}" data-act="${act}" data-name="${n}" data-color="${COLORS[c]}">${n}</button>`).join('');
}

function vHome() {
  const ls = sortedLists();
  const pending = Object.values(state.items).length;
  const tiles = ls.map(l => {
    const n = itemsOf(l.id).length;
    return `<button class="tile" style="--c:${l.color}" data-act="openlist" data-id="${l.id}">
      ${l.shopping ? '<span class="live">Comprando ahora</span>' : ''}
      <span class="tn">${esc(l.name)}</span><span class="tc"><b>${n}</b>${n === 1 ? 'producto' : 'productos'}</span></button>`;
  }).join('');
  return `<div class="wrap">
    <h1 class="big">Listas de la compra</h1>
    <p class="sub">${ls.length ? `${plural(ls.length, 'lista', 'listas')} con ${plural(pending, 'producto', 'productos')} por comprar.` : 'Crea una lista por cada súper y rellenadla entre los dos.'}</p>
    ${ls.length ? '' : `<div class="empty"><p>Empieza por el súper donde compras más:</p><div class="presets">${presetPills('quicklist')}</div></div>`}
    <div class="tiles">${tiles}<button class="tile add" data-act="newlist">Nueva lista</button></div>
  </div>`;
}

function vList() {
  const l = state.lists[curList], items = itemsOf(l.id), got = items.filter(i => i.got).length, shop = !!l.shopping;
  const freq = frequent(l.id);
  const names = knownNames(l.id);
  let body = '';
  if (!shop) {
    body = items.length ? items.map(i => `<div class="item">
        <button class="ibody" data-act="edititem" data-id="${i.id}"><span class="nm">${esc(i.name)}</span>${i.qty ? `<span class="q">${esc(qtyLabel(i.qty))}</span>` : ''}</button>
        <button class="x" data-act="delitem" data-id="${i.id}" aria-label="Quitar ${esc(i.name)}">×</button></div>`).join('')
      : `<div class="empty"><p>La lista está vacía. Escribe arriba lo que falta en casa.</p></div>`;
  } else {
    const row = i => `<button class="irow ${i.got ? 'got' : ''}" data-act="tick" data-id="${i.id}" aria-pressed="${i.got}">
        <span class="box">${IC.chk}</span><span class="nm">${esc(i.name)}</span>${i.qty ? `<span class="q">${esc(qtyLabel(i.qty))}</span>` : ''}</button>`;
    const todo = items.filter(i => !i.got), done = items.filter(i => i.got);
    body = todo.map(row).join('') + (done.length ? `<div class="sep">En el carro (${done.length})</div>${done.map(row).join('')}` : '')
      + (!items.length ? '<div class="empty"><p>No hay nada en esta lista.</p></div>' : '');
  }
  const bar = shop
    ? `<div class="bar"><div class="in"><button class="btn ghost" data-act="pauseshop">Pausar</button><button class="btn accent" data-act="finishsheet">Terminar compra</button></div></div>`
    : `<div class="bar"><div class="in"><button class="btn accent" data-act="startshop" ${items.length ? '' : 'disabled'}>Ir a comprar${items.length ? ` (${items.length})` : ''}</button></div></div>`;
  return `<div style="--c:${l.color}">
    <div class="lhead">
      <div class="ltop"><button class="hbtn" data-act="back" aria-label="Volver">${IC.back}</button><button class="hbtn" data-act="listmenu" aria-label="Opciones de la lista">${IC.more}</button></div>
      <h1>${esc(l.name)}</h1>
      <p>${shop ? `${got} de ${items.length} en el carro` : plural(items.length, 'producto', 'productos')}</p>
      ${shop && items.length ? `<div class="prog"><span style="width:${Math.round(got / items.length * 100)}%"></span></div>` : ''}
    </div>
    <div class="lbody">
      <div class="addrow"><input id="addinp" type="text" list="known" autocomplete="off" autocapitalize="sentences" placeholder="${shop ? '¿Se te olvida algo?' : 'Añadir producto'}" enterkeyhint="done">
        <button class="btn accent" data-act="additem">Añadir</button></div>
      <datalist id="known">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <p class="hint">Puedes poner varios separados por comas. Con "2 leche" se apunta la cantidad.</p>
      ${freq.length ? `<div class="freq"><b>Lo que sueles comprar</b><div class="presets">${freq.map(n => `<button class="pill" data-act="quick" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>` : ''}
      <div style="margin-top:10px">${body}</div>
    </div>${bar}</div>`;
}

function vHistory() {
  const [Y, M] = hist.cursor.split('-').map(Number);
  const month = Object.values(state.purchases).filter(p => p.date.startsWith(hist.cursor))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  const priced = month.filter(p => p.price != null), spent = priced.reduce((s, p) => s + p.price, 0);
  const byDay = {};
  month.forEach(p => (byDay[p.date] = byDay[p.date] || []).push(p));
  const offset = (new Date(Y, M - 1, 1).getDay() + 6) % 7, days = new Date(Y, M, 0).getDate(), t = today();
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<div class="cell blank"></div>';
  for (let i = 1; i <= days; i++) {
    const d = `${Y}-${pad(M)}-${pad(i)}`;
    const dots = (byDay[d] || []).slice(0, 3).map(p => `<i style="background:${p.color}"></i>`).join('');
    cells += `<button class="cell ${d === t ? 'today' : ''} ${d === hist.day ? 'sel' : ''}" data-act="histday" data-day="${d}">${i}<span class="dots">${dots}</span></button>`;
  }
  const wl = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(l => `<div class="wl">${l}</div>`).join('');
  const shown = hist.day ? month.filter(p => p.date === hist.day) : month;
  const cards = shown.map(p => `<button class="pcard" style="--c:${p.color}" data-act="openpurchase" data-id="${p.id}">
      <span></span>
      <span><span class="nm">${esc(p.listName)}</span><br><span class="ds">${fmt(p.date, { weekday: 'short', day: 'numeric', month: 'short' })}, ${plural(p.items.length, 'producto', 'productos')}${p.photo ? ', con ticket' : ''}</span></span>
      <span class="pr">${p.price != null ? eur(p.price) : '<small>Sin precio</small>'}</span></button>`).join('');
  return `<div class="wrap">
    <div class="mhead"><h1>${fmt(`${hist.cursor}-01`, { month: 'long', year: 'numeric' })}</h1>
      <div class="arrows"><button class="icon-btn" data-act="histprev" aria-label="Mes anterior">${IC.prev}</button><button class="icon-btn" data-act="histnext" aria-label="Mes siguiente">${IC.next}</button></div></div>
    <p class="summary">${month.length ? `<b>${plural(month.length, 'compra', 'compras')}</b>${priced.length ? `, <b>${eur(spent)}</b> gastados${priced.length < month.length ? ` (${plural(priced.length, 'compra tiene', 'compras tienen')} precio)` : ''}` : ', sin precios apuntados'}` : 'Ninguna compra este mes.'}</p>
    <div class="grid">${wl}${cells}</div>
    ${hist.day ? `<div class="filter"><span>${fmt(hist.day, { weekday: 'long', day: 'numeric', month: 'long' })}</span><button class="linkbtn" data-act="histall">Ver todo el mes</button></div>` : '<div class="filter"><span>Compras del mes</span></div>'}
    ${cards || '<div class="empty"><p>No hay compras guardadas para este periodo. Aparecen aquí cuando terminas una compra.</p></div>'}
  </div>`;
}

function vSettings() {
  const m = meta(), hasCfg = !!window.FIREBASE_CONFIG;
  let share;
  if (!hasCfg) {
    share = '<p>Para compartir las listas entre dos móviles hay que copiar la configuración de Firebase en el archivo config.js. Está explicado en el LEEME, apartado 3.</p>';
  } else if (m.code) {
    share = `<p>Los dos móviles tienen que usar este código:</p><div class="code">${fmtCode(m.code)}</div>
      <p class="${cloud && cloud.synced ? 'ok' : 'warn'}">${cloud ? (cloud.synced ? 'Sincronizado' : 'Guardando cambios. Se envían cuando haya conexión.') : 'Sin conexión con la nube. Se reintentará sola.'}</p>
      <div class="stack"><button class="btn ghost" data-act="copycode">Copiar código</button><button class="btn danger" data-act="leave">Dejar de compartir en este móvil</button></div>`;
  } else {
    share = `<p>En el primer móvil crea un código y pásaselo al otro.</p>
      <div class="stack"><button class="btn" data-act="sharecreate">Crear código nuevo</button>
      <label>Ya tengo un código<input id="joincode" type="text" autocapitalize="characters" autocomplete="off" placeholder="XXXX-XXXX-XXXX"></label>
      <button class="btn ghost" data-act="sharejoin">Unirme con este código</button></div>`;
  }
  return `<div class="wrap"><h1 class="big" style="margin-bottom:6px">Ajustes</h1>
    <section class="sec"><h2>Compartir con tu pareja</h2>${share}</section>
    <section class="sec"><h2>Copia de seguridad</h2><p>Guarda un archivo con todas las listas y compras, o recupéralo.</p>
      <div class="stack"><button class="btn ghost" data-act="export">Descargar copia</button><button class="btn ghost" data-act="import">Restaurar desde copia</button></div></section></div>`;
}

/* =====================  hojas y avisos  ===================== */
function sheet(html) { $('#sheet').innerHTML = `<div class="scrim" data-act="closesheet"></div><div class="panel" role="dialog" aria-modal="true">${html}</div>`; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; lform = null; pcur = null; pendingPhoto = null; }
let tt;
function toast(msg, undo) {
  const el = $('#toast');
  undoFn = undo || null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Deshacer</button>' : ''}`;
  el.classList.add('show');
  clearTimeout(tt);
  tt = setTimeout(() => el.classList.remove('show'), undo ? 6000 : 2800);
}
function confirmSheet(title, text, buttons) { sheet(`<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}<div class="stack">${buttons}</div>`); }

/* =====================  listas  ===================== */
function listSheet(id, name, color) {
  const l = id ? state.lists[id] : null;
  lform = { id: id || null, color: color || (l ? l.color : COLORS[0]) };
  const nm = name != null ? name : (l ? l.name : '');
  sheet(`<h2>${l ? 'Editar lista' : 'Nueva lista'}</h2>
    <label>Nombre del súper<input id="l-name" type="text" autocomplete="off" value="${esc(nm)}" placeholder="Mercadona"></label>
    <div class="presets">${presetPills('preset')}</div>
    <div class="field"><span>Color</span><div class="colors" id="l-colors"></div></div>
    <div class="actions"><button class="btn" data-act="savelist">Guardar</button><button class="btn ghost" data-act="closesheet">Cancelar</button></div>`);
  drawColors();
}
function drawColors() {
  $('#l-colors').innerHTML = COLORS.map(c => `<button class="sw ${c === lform.color ? 'on' : ''}" style="--c:${c}" data-act="pickcolor" data-c="${c}" aria-label="Color"></button>`).join('');
}
function saveList() {
  const name = $('#l-name').value.trim();
  if (!name) { toast('Escribe el nombre'); return; }
  if (lform.id) putList({ ...state.lists[lform.id], name, color: lform.color });
  else { const l = { id: uid('l'), name, color: lform.color, shopping: false, created: Date.now() }; putList(l); curList = l.id; view = 'list'; }
  closeSheet(); render();
}
function quickList(name, color) {
  const l = { id: uid('l'), name, color, shopping: false, created: Date.now() };
  putList(l); curList = l.id; view = 'list'; render(); window.scrollTo(0, 0);
}

/* =====================  productos  ===================== */
function doAdd(text) {
  if (!text.trim()) return;
  const r = addItems(curList, text);
  render();
  const inp = $('#addinp'); if (inp) { inp.value = ''; inp.focus(); }
  if (r.dup && !r.added) toast('Ya estaba en la lista');
  else if (r.dup) toast(`Añadidos ${r.added}. Alguno ya estaba.`);
}
function itemSheet(id) {
  const i = state.items[id];
  sheet(`<h2>Editar producto</h2>
    <label>Nombre<input id="i-name" type="text" autocomplete="off" value="${esc(i.name)}"></label>
    <label>Cantidad <small>(opcional)</small><input id="i-qty" type="text" autocomplete="off" value="${esc(i.qty)}" placeholder="2, 1 kg…"></label>
    <div class="actions"><button class="btn" data-act="saveitem" data-id="${id}">Guardar</button><button class="btn ghost" data-act="closesheet">Cancelar</button></div>
    <div class="stack"><button class="btn danger" data-act="delitem2" data-id="${id}">Quitar de la lista</button></div>`);
}
function delItem(id) {
  const i = { ...state.items[id] };
  removeItem(id); closeSheet(); render();
  toast(`${i.name} quitado`, () => { putItem(i); render(); });
}

/* =====================  modo compra  ===================== */
function tick(id) {
  const i = state.items[id]; if (!i) return;
  putItem({ ...i, got: !i.got });
  if (navigator.vibrate) navigator.vibrate(15);
  render();
}
function finishSheet() {
  const l = state.lists[curList], items = itemsOf(l.id), got = items.filter(i => i.got).length, left = items.length - got;
  if (!got) { toast('Marca primero lo que has cogido'); return; }
  sheet(`<h2>Terminar compra</h2>
    <p>${plural(got, 'producto cogido', 'productos cogidos')}.${left ? ` ${left === 1 ? 'El otro se queda' : `Los otros ${left} se quedan`} en la lista para la próxima.` : ''}</p>
    <label>Fecha<input type="date" id="p-date" value="${today()}"></label>
    <label>Precio total <small>(opcional)</small><input type="text" inputmode="decimal" id="p-price" placeholder="0,00 €" autocomplete="off"></label>
    <div class="field"><span>Foto del ticket <small>(opcional)</small></span><div id="p-photo"></div></div>
    <div class="actions"><button class="btn accent" data-act="finishgo">Guardar compra</button><button class="btn ghost" data-act="closesheet">Cancelar</button></div>`);
  $('#sheet .panel').style.setProperty('--c', l.color);
  pendingPhoto = null; drawFinishPhoto();
}
const photoBtns = t => `<div class="actions"><button class="btn ghost small" data-act="pickphoto" data-t="${t}" data-src="cam">Hacer foto</button><button class="btn ghost small" data-act="pickphoto" data-t="${t}" data-src="gal">Elegir de la galería</button></div>`;
function drawFinishPhoto() {
  const box = $('#p-photo'); if (!box) return;
  box.innerHTML = pendingPhoto
    ? `<img class="thumb" src="${pendingPhoto}" alt="Foto del ticket">${photoBtns('finish')}<div class="stack"><button class="btn danger small" data-act="rmphoto">Quitar foto</button></div>`
    : photoBtns('finish');
}
function finishShop() {
  const l = state.lists[curList], date = $('#p-date').value || today(), price = parsePrice($('#p-price').value);
  const got = itemsOf(l.id).filter(i => i.got);
  const pid = uid('p');
  putPurchase({ id: pid, listId: l.id, listName: l.name, color: l.color, date, price, photo: !!pendingPhoto, items: got.map(i => ({ name: i.name, qty: i.qty })), created: Date.now() });
  if (pendingPhoto) savePhoto(pid, pendingPhoto).catch(console.error);
  got.forEach(i => removeItem(i.id));
  putList({ ...l, shopping: false });
  closeSheet(); view = 'home'; curList = null; render(); window.scrollTo(0, 0);
  toast('Compra guardada en el historial');
}

/* =====================  historial  ===================== */
function purchaseSheet(id) {
  const p = state.purchases[id]; if (!p) return;
  pcur = id;
  sheet(`<div style="--c:${p.color}"><h2>${esc(p.listName)}</h2>
    <ul class="plist">${p.items.map(i => `<li><span>${esc(i.name)}</span><b>${esc(qtyLabel(i.qty))}</b></li>`).join('')}</ul>
    <label>Fecha<input type="date" id="e-date" value="${p.date}"></label>
    <label>Precio total <small>(opcional)</small><input type="text" inputmode="decimal" id="e-price" value="${p.price != null ? String(p.price).replace('.', ',') : ''}" placeholder="0,00 €" autocomplete="off"></label>
    <div class="field"><span>Foto del ticket</span><div id="e-photo"></div></div>
    <div class="actions"><button class="btn accent" data-act="savepurchase">Guardar cambios</button><button class="btn ghost" data-act="closesheet">Cerrar</button></div>
    <div class="stack"><button class="btn ghost" data-act="readd">Volver a añadir a la lista</button><button class="btn danger" data-act="delpurchase">Borrar compra</button></div></div>`);
  drawPurchasePhoto();
}
async function drawPurchasePhoto() {
  const box = $('#e-photo'), id = pcur, p = state.purchases[id];
  if (!box || !p) return;
  if (!p.photo) { box.innerHTML = photoBtns('purchase'); return; }
  box.innerHTML = '<p class="hint">Cargando foto…</p>';
  let data = null;
  try { data = await loadPhoto(id); } catch (e) { console.error(e); }
  if (pcur !== id || !$('#e-photo')) return;
  $('#e-photo').innerHTML = data
    ? `<button class="photobtn" data-act="viewphoto" aria-label="Ver el ticket en grande"><img class="thumb" src="${data}" alt="Foto del ticket"></button>
       ${photoBtns('purchase')}<div class="stack"><button class="btn danger small" data-act="delphoto">Quitar foto</button></div>`
    : `<p class="hint">No se pudo cargar la foto. Si estás sin conexión, prueba cuando la recuperes.</p>
       ${photoBtns('purchase')}`;
}
function readd() {
  const p = state.purchases[pcur], l = p && state.lists[p.listId];
  if (!l) { toast('Esa lista ya no existe'); return; }
  const r = addItems(l.id, p.items.map(i => (i.qty ? i.qty + ' ' : '') + i.name).join(', '));
  closeSheet(); render();
  toast(r.added ? `${plural(r.added, 'producto añadido', 'productos añadidos')} a ${l.name}` : 'Todo eso ya estaba en la lista');
}

/* =====================  compartir (Firebase)  ===================== */
const FB = '10.12.2';
let fb = null, cloud = null;
const fmtCode = c => c.match(/.{1,4}/g).join('-');
const newCode = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return [...crypto.getRandomValues(new Uint8Array(12))].map(x => A[x % A.length]).join(''); };
const docId = code => 'compra_' + code;

async function loadFb() {
  if (fb) return fb;
  const [app, fs] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FB}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FB}/firebase-firestore.js`)
  ]);
  const a = app.initializeApp(window.FIREBASE_CONFIG);
  let db;
  try { db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch (e) { db = fs.getFirestore(a); }
  fb = { fs, db };
  return fb;
}
async function connect(code, mode) {
  if (!window.FIREBASE_CONFIG) throw new Error('nocfg');
  const { fs, db } = await loadFb();
  const ref = fs.doc(db, 'shared', docId(code));
  if (mode === 'join') { const s = await fs.getDoc(ref); if (!s.exists()) throw new Error('notfound'); }
  if (mode === 'create') fs.setDoc(ref, { ...state, created: Date.now() }).catch(console.error);
  if (cloud && cloud.unsub) cloud.unsub();
  cloud = { fs, db, code, ref, synced: false };
  if (mode === 'create') uploadLocalPhotos();
  cloud.unsub = fs.onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    state = norm(snap.data());
    save();
    cloud.synced = !snap.metadata.hasPendingWrites && !snap.metadata.fromCache;
    render();
  }, err => { console.error(err); if (cloud) cloud.synced = false; render(); });
}
function cloudSet(path, value) { if (cloud) cloud.fs.updateDoc(cloud.ref, new cloud.fs.FieldPath(...path), value).catch(console.error); }
function cloudDel(path) { if (cloud) cloud.fs.updateDoc(cloud.ref, new cloud.fs.FieldPath(...path), cloud.fs.deleteField()).catch(console.error); }
async function startShare(mode, code) {
  try {
    toast('Conectando…');
    await connect(code, mode);
    const m = meta(); m.code = code; setMeta(m);
    toast('Compartido');
  } catch (e) {
    console.error(e);
    toast(e.message === 'notfound' ? 'No existe ese código' : 'No se pudo conectar. Revisa la conexión y la configuración de Firebase.');
  }
  render();
}

/* =====================  fotos del ticket  ===================== */
/* Las fotos viven en el móvil (IndexedDB). Si hay sincronización, cada foto se guarda
   además en su propio documento de Firestore (las listas no se hacen pesadas). */
let idbp = null;
function idb() {
  if (!idbp) idbp = new Promise((res, rej) => {
    const r = indexedDB.open('compra-fotos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return idbp;
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const q = fn(db.transaction('f', mode).objectStore('f')); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
}
const photoRef = pid => cloud.fs.doc(cloud.db, 'shared', docId(cloud.code) + '_f_' + pid);
async function savePhoto(pid, data) {
  await idbOp('readwrite', s => s.put(data, pid));
  if (cloud) cloud.fs.setDoc(photoRef(pid), { data, created: Date.now() }).catch(console.error);
}
async function loadPhoto(pid) {
  let d = await idbOp('readonly', s => s.get(pid));
  if (d) return d;
  if (cloud) {
    const snap = await cloud.fs.getDoc(photoRef(pid));
    if (snap.exists() && snap.data().data) { d = snap.data().data; await idbOp('readwrite', s => s.put(d, pid)); return d; }
  }
  return null;
}
async function dropPhoto(pid) {
  await idbOp('readwrite', s => s.delete(pid));
  if (cloud) cloud.fs.updateDoc(photoRef(pid), { data: '' }).catch(() => {});
}
async function uploadLocalPhotos() {
  for (const p of Object.values(state.purchases)) {
    if (!p.photo) continue;
    try { const d = await idbOp('readonly', s => s.get(p.id)); if (d && cloud) cloud.fs.setDoc(photoRef(p.id), { data: d, created: Date.now() }).catch(console.error); } catch (e) {}
  }
}
/* reduce la foto para que pese poco (cabe de sobra en un documento de Firestore) */
async function compress(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) { bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
  let max = 1600, q = 0.72, out = '';
  for (let i = 0; i < 6; i++) {
    const k = Math.min(1, max / Math.max(w0, h0)), c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    if (out.length < 800000) return out;
    max *= 0.8; q = Math.max(0.4, q - 0.08);
  }
  if (out.length > 950000) throw new Error('toobig');
  return out;
}
async function onPhoto(file) {
  try {
    toast('Preparando la foto…');
    const data = await compress(file);
    if (photoTarget === 'finish') { pendingPhoto = data; drawFinishPhoto(); }
    else if (photoTarget === 'purchase' && pcur && state.purchases[pcur]) {
      const id = pcur;
      await savePhoto(id, data);
      putPurchase({ ...state.purchases[id], photo: true });
      drawPurchasePhoto(); render();
    }
    toast('Foto añadida');
  } catch (e) {
    console.error(e);
    toast(e.message === 'toobig' ? 'La foto es demasiado grande' : 'No se pudo usar esa foto');
  }
}

/* =====================  copia de seguridad  ===================== */
async function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.append(a); a.click(); a.remove();
}
function exportData() { shareFile(new File([JSON.stringify(state, null, 1)], `compra-copia-${today()}.json`, { type: 'application/json' })); }
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || typeof d.lists !== 'object') throw new Error();
      state = norm(d); save();
      if (cloud) cloud.fs.setDoc(cloud.ref, { ...state, created: Date.now() }).catch(console.error);
      render(); toast('Copia restaurada');
    } catch (e) { toast('El archivo no es una copia válida'); }
  };
  r.readAsText(file);
}

/* =====================  eventos  ===================== */
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act, ds = el.dataset;
  switch (a) {
    case 'nav': view = ds.view; curList = null; closeSheet(); render(); window.scrollTo(0, 0); break;
    case 'openlist': curList = ds.id; view = 'list'; render(); window.scrollTo(0, 0); break;
    case 'back': view = 'home'; curList = null; render(); window.scrollTo(0, 0); break;
    case 'newlist': listSheet(null); break;
    case 'quicklist': quickList(ds.name, ds.color); break;
    case 'preset': { const n = $('#l-name'); n.value = ds.name; lform.color = ds.color; drawColors(); break; }
    case 'pickcolor': lform.color = ds.c; drawColors(); break;
    case 'savelist': saveList(); break;
    case 'listmenu':
      confirmSheet(state.lists[curList].name, '',
        `<button class="btn ghost" data-act="editlist">Cambiar nombre o color</button>
         <button class="btn danger" data-act="dellist">Eliminar lista</button>
         <button class="btn ghost" data-act="closesheet">Cerrar</button>`);
      break;
    case 'editlist': closeSheet(); listSheet(curList); break;
    case 'dellist':
      confirmSheet('¿Eliminar la lista?', 'Se borran sus productos. Las compras ya guardadas en el historial se conservan.',
        `<button class="btn danger" data-act="dellistok">Eliminar lista</button><button class="btn ghost" data-act="closesheet">Cancelar</button>`);
      break;
    case 'dellistok': removeList(curList); closeSheet(); view = 'home'; curList = null; render(); toast('Lista eliminada'); break;
    case 'additem': { const i = $('#addinp'); doAdd(i ? i.value : ''); break; }
    case 'quick': addItems(curList, ds.name); render(); break;
    case 'edititem': itemSheet(ds.id); break;
    case 'saveitem': {
      const i = state.items[ds.id], name = $('#i-name').value.trim();
      if (!name) { toast('Escribe el nombre'); break; }
      putItem({ ...i, name: cap(name), qty: $('#i-qty').value.trim() }); closeSheet(); render(); break;
    }
    case 'delitem': delItem(ds.id); break;
    case 'delitem2': delItem(ds.id); break;
    case 'tick': tick(ds.id); break;
    case 'startshop': putList({ ...state.lists[curList], shopping: true }); render(); window.scrollTo(0, 0); break;
    case 'pauseshop': putList({ ...state.lists[curList], shopping: false }); render(); toast('Compra en pausa. Lo marcado se conserva.'); break;
    case 'finishsheet': finishSheet(); break;
    case 'finishgo': finishShop(); break;
    case 'histprev': { const [y, m] = hist.cursor.split('-').map(Number); hist.cursor = ymd(new Date(y, m - 2, 1)).slice(0, 7); hist.day = null; render(); break; }
    case 'histnext': { const [y, m] = hist.cursor.split('-').map(Number); hist.cursor = ymd(new Date(y, m, 1)).slice(0, 7); hist.day = null; render(); break; }
    case 'histday': hist.day = hist.day === ds.day ? null : ds.day; render(); break;
    case 'histall': hist.day = null; render(); break;
    case 'openpurchase': purchaseSheet(ds.id); break;
    case 'savepurchase': {
      const p = state.purchases[pcur], date = $('#e-date').value || p.date;
      putPurchase({ ...p, date, price: parsePrice($('#e-price').value) });
      hist.cursor = date.slice(0, 7); hist.day = null; closeSheet(); render(); toast('Guardado'); break;
    }
    case 'readd': readd(); break;
    case 'delpurchase':
      confirmSheet('¿Borrar esta compra?', 'Desaparece del historial.',
        `<button class="btn danger" data-act="delpurchaseok">Borrar compra</button><button class="btn ghost" data-act="closesheet">Cancelar</button>`);
      break;
    case 'delpurchaseok': if (state.purchases[pcur] && state.purchases[pcur].photo) dropPhoto(pcur).catch(() => {}); removePurchase(pcur); closeSheet(); render(); toast('Compra borrada'); break;
    case 'pickphoto': photoTarget = ds.t; $(ds.src === 'cam' ? '#photocam' : '#photofile').click(); break;
    case 'rmphoto': pendingPhoto = null; drawFinishPhoto(); break;
    case 'delphoto': {
      const p = state.purchases[pcur];
      if (p) { dropPhoto(pcur).catch(() => {}); putPurchase({ ...p, photo: false }); drawPurchasePhoto(); render(); toast('Foto quitada'); }
      break;
    }
    case 'viewphoto': {
      const id = pcur; let d = null;
      try { d = await loadPhoto(id); } catch (e) {}
      if (d) sheet(`<img class="full" src="${d}" alt="Ticket"><div class="stack"><button class="btn ghost" data-act="closephoto">Volver</button></div>`);
      break;
    }
    case 'closephoto': purchaseSheet(pcur); break;
    case 'undo': if (undoFn) undoFn(); undoFn = null; $('#toast').classList.remove('show'); break;
    case 'closesheet': closeSheet(); break;
    case 'sharecreate': startShare('create', newCode()); break;
    case 'sharejoin': {
      const code = ($('#joincode').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 12) { toast('El código tiene 12 letras y números'); break; }
      if (Object.keys(state.lists).length) {
        confirmSheet('Unirte al código compartido', 'Las listas que hay ahora en este móvil se sustituirán por las compartidas.',
          `<button class="btn" data-act="sharejoinok" data-code="${code}">Unirme</button><button class="btn ghost" data-act="closesheet">Cancelar</button>`);
      } else startShare('join', code);
      break;
    }
    case 'sharejoinok': closeSheet(); startShare('join', ds.code); break;
    case 'copycode': try { await navigator.clipboard.writeText(fmtCode(meta().code)); toast('Código copiado'); } catch (e) { toast('No se pudo copiar'); } break;
    case 'leave':
      confirmSheet('¿Dejar de compartir?', 'Los datos se quedan en este móvil, pero ya no se actualizarán con los del otro.',
        `<button class="btn danger" data-act="leaveok">Dejar de compartir</button><button class="btn ghost" data-act="closesheet">Cancelar</button>`);
      break;
    case 'leaveok': if (cloud && cloud.unsub) cloud.unsub(); cloud = null; { const m = meta(); delete m.code; setMeta(m); } closeSheet(); render(); break;
    case 'export': exportData(); break;
    case 'import': $('#importfile').click(); break;
  }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'addinp') { ev.preventDefault(); doAdd(ev.target.value); }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.id === 'importfile' && el.files[0]) { importData(el.files[0]); el.value = ''; }
  else if ((el.id === 'photofile' || el.id === 'photocam') && el.files[0]) { const f = el.files[0]; el.value = ''; onPhoto(f); }
});

/* =====================  arranque  ===================== */
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); } });
window.addEventListener('online', () => {
  const m = meta();
  if (m.code && !cloud && window.FIREBASE_CONFIG) connect(m.code, 'resume').then(render).catch(console.error);
});

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
{
  const m = meta();
  if (m.code && window.FIREBASE_CONFIG) connect(m.code, 'resume').then(render).catch(console.error);
}
})();
