/* Cuotas de mantenimiento — Fraccionamiento Capulac
   Modos:
   - local:     sin Google Sheets; los datos viven solo en este navegador.
   - admin:     conectado a Google Sheets con sesión de administrador (usuario y contraseña); controla todo.
   - invitado:  conectado a Google Sheets sin iniciar sesión; solo consulta. */
'use strict';

const KEY = 'cuotas-capulac-v1';          // datos del modo local
const KEY_CACHE = 'cuotas-capulac-cache'; // copia de los datos de Google Sheets
const CFG_API = 'cuotas-api', CFG_TOKEN = 'cuotas-token', CFG_USER = 'cuotas-usuario', CFG_COLA = 'cuotas-cola', CFG_MICASA = 'cuotas-mi-casa';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MES_C = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const METODOS = ['Efectivo', 'Transferencia', 'Depósito', 'Otro'];
const CATEGORIAS = ['Limpieza', 'Jardinería', 'Vigilancia', 'Luz', 'Agua', 'Mantenimiento', 'Reparaciones', 'Administración', 'Papelería', 'Otro'];

// Catálogo tomado de la hoja "FRACCIONAMIENTO CAPULAC"
const CASAS_BASE = [
  '1A', '1B', '2A', '2B',
  '3A', '3B', '3C', '3D', '4A', '4B', '4C', '4D', '5A', '5B', '5C', '5D', '6A', '6B', '6C', '6D',
  '7A', '7B', '7C', '7D', '8A', '8B', '8C', '8D', '9A', '9B', '9C', '9D', '10A', '10B', '10C', '10D',
  '11A', '11B', '12A', '12B', '13A', '13B', '14A', '14B', '15A', '15B', '16A', '16B', '17A', '17B',
  '18A', '18B', '19A', '19B', '20A', '20B', '21A', '21B', '22A', '22B', '23A', '23B',
];

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const periodoActual = () => hoy().slice(0, 7);
const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fechaTxt = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const periodoTxt = p => { const [y, m] = p.split('-'); return `${MESES[+m - 1]} ${y}`; };
const periodoCorto = p => { const [y, m] = p.split('-'); return `${MES_C[+m - 1]} ${y}`; };
const num = v => Math.round((parseFloat(v) || 0) * 100) / 100;
const ordenCasa = (a, b) => (parseInt(a.num) - parseInt(b.num)) || a.num.localeCompare(b.num);
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2800);
}

/* ---------- conexión con Google Sheets ---------- */
const qpApi = new URLSearchParams(location.search).get('api');
if (qpApi && /^(https:\/\/|http:\/\/localhost)/.test(qpApi)) { ls.set(CFG_API, qpApi); history.replaceState(null, '', location.pathname); }
const remoto = {
  url: ls.get(CFG_API) || (window.CUOTAS_CONFIG && window.CUOTAS_CONFIG.apiUrl) || '',
  token: ls.get(CFG_TOKEN) || '',
  usuario: ls.get(CFG_USER) || '',
  cola: (() => { try { return JSON.parse(ls.get(CFG_COLA)) || []; } catch { return []; } })(),
  estado: 'idle', error: '', ultima: null,
};
const modo = () => (!remoto.url ? 'local' : remoto.token ? 'admin' : 'invitado');
const puedeEditar = () => modo() !== 'invitado';
ls.del('cuotas-admin-key'); // clave de la versión anterior

/* ---------- base de datos ---------- */
function dbInicial() {
  return {
    config: { nombre: 'Fraccionamiento Capulac', cuota: 100, saldoInicial: 0, diaInicioCobro: 30, diaLimiteCobro: 3 },
    casas: CASAS_BASE.map(n => ({ id: uid(), num: n, propietario: '', telefono: '', correo: '', notas: '' })),
    pagos: [],   // {id, casaId, periodo:'YYYY-MM', monto, fecha, metodo, nota, ts}
    adeudos: {}, // {'casaId|YYYY-MM': true}
    gastos: [],  // {id, concepto, categoria, monto, fecha, nota, ts}
  };
}
function normalizar(d) {
  const base = dbInicial().config;
  const cfg = Object.assign({}, base, d.config || {});
  cfg.diaInicioCobro = Math.min(31, Math.max(1, parseInt(cfg.diaInicioCobro) || base.diaInicioCobro));
  cfg.diaLimiteCobro = Math.min(31, Math.max(1, parseInt(cfg.diaLimiteCobro) || base.diaLimiteCobro));
  cfg.cuota = num(cfg.cuota); cfg.saldoInicial = num(cfg.saldoInicial);
  return {
    config: cfg,
    casas: (d.casas || []).map(c => ({ id: String(c.id), num: String(c.num), propietario: c.propietario || '', telefono: String(c.telefono || ''), correo: c.correo || '', notas: c.notas || '', desocupada: c.desocupada || '' })),
    pagos: (d.pagos || []).map(p => ({ ...p, monto: num(p.monto), ts: +p.ts || 0, metodo: p.metodo || '', nota: p.nota || '' })),
    gastos: (d.gastos || []).map(g => ({ ...g, monto: num(g.monto), ts: +g.ts || 0, categoria: g.categoria || '', nota: g.nota || '' })),
    adeudos: d.adeudos || {},
  };
}
const claveDatos = () => (modo() === 'local' ? KEY : KEY_CACHE);
function cargarDb() {
  try {
    const d = JSON.parse(ls.get(claveDatos()));
    if (d) return normalizar(d);
  } catch {}
  return modo() === 'local' ? dbInicial() : normalizar({ casas: [] });
}
let db = cargarDb();
let idx = {};
function reindex() {
  idx = { pagos: {}, casa: {} };
  for (const c of db.casas) idx.casa[c.id] = c;
  for (const p of db.pagos) (idx.pagos[p.casaId + '|' + p.periodo] ||= []).push(p);
}
function guardar() {
  db.casas.sort(ordenCasa);
  ls.set(claveDatos(), JSON.stringify(db));
  reindex();
}
db.casas.sort(ordenCasa);
reindex();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- operaciones (mismas reglas que el servidor) ---------- */
function upsert(lista, obj) {
  const i = lista.findIndex(x => x.id === obj.id);
  if (i >= 0) lista[i] = obj; else lista.push(obj);
}
function aplicarLocal(o) {
  switch (o.tipo) {
    case 'pago.guardar': upsert(db.pagos, o.pago); delete db.adeudos[o.pago.casaId + '|' + o.pago.periodo]; break;
    case 'pago.borrar': db.pagos = db.pagos.filter(p => p.id !== o.id); break;
    case 'gasto.guardar': upsert(db.gastos, o.gasto); break;
    case 'gasto.borrar': db.gastos = db.gastos.filter(g => g.id !== o.id); break;
    case 'casa.guardar': upsert(db.casas, o.casa); break;
    case 'casa.borrar':
      db.casas = db.casas.filter(c => c.id !== o.id);
      db.pagos = db.pagos.filter(p => p.casaId !== o.id);
      for (const k of Object.keys(db.adeudos)) if (k.startsWith(o.id + '|')) delete db.adeudos[k];
      break;
    case 'adeudo.poner': db.adeudos[o.casaId + '|' + o.periodo] = true; break;
    case 'adeudo.quitar': delete db.adeudos[o.casaId + '|' + o.periodo]; break;
    case 'config.guardar': db.config = { ...o.config }; break;
    case 'todo.reemplazar': db = normalizar(JSON.parse(JSON.stringify(o.db))); break;
  }
}
// Aplica cambios en pantalla al instante y, si hay Google Sheets, los encola para enviarlos.
function ejecutar(ops) {
  if (!puedeEditar()) { toast('Modo invitado: solo puedes consultar'); return false; }
  ops.forEach(aplicarLocal);
  guardar();
  if (modo() === 'admin') {
    remoto.cola.push(...JSON.parse(JSON.stringify(ops)));
    ls.set(CFG_COLA, JSON.stringify(remoto.cola));
    sincronizar();
  }
  return true;
}

async function api(url, body) {
  const r = body
    ? await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
    : await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
  let j;
  try { j = await r.json(); } catch { throw new Error('Respuesta inválida del servidor. Revisa la URL del script.'); }
  if (!j.ok) { const e = new Error(j.error || 'Error del servidor'); e.auth = !!j.auth; e.server = true; throw e; }
  return j;
}

let sincronizando = false;
async function sincronizar() {
  if (!remoto.url || sincronizando) return;
  sincronizando = true;
  setEstado('sync');
  try {
    let res;
    if (modo() === 'admin') {
      const ops = remoto.cola.slice();
      res = await api(remoto.url, { token: remoto.token, ops });
      remoto.cola.splice(0, ops.length);
      ls.set(CFG_COLA, JSON.stringify(remoto.cola));
    } else {
      res = await api(remoto.url);
    }
    if (!remoto.cola.length) {
      db = normalizar(res.data);
      guardar();
      render();
    }
    remoto.ultima = new Date();
    setEstado('ok');
  } catch (e) {
    if (e.auth) {
      olvidarSesion();
      toast('Tu sesión de administrador expiró. Ahora estás como invitado.');
      render();
    }
    setEstado('error', e.server ? e.message : 'Sin conexión');
    if (remoto.cola.length && !e.server) { clearTimeout(sincronizar._t); sincronizar._t = setTimeout(sincronizar, 15000); }
  } finally {
    sincronizando = false;
    if (remoto.cola.length && remoto.estado === 'ok') sincronizar();
  }
}

function setEstado(est, err) {
  remoto.estado = est; remoto.error = err || '';
  const el = $('#estadoSync');
  if (!el) return;
  const m = modo();
  const pend = remoto.cola.length;
  let txt, cls;
  if (m === 'local') { txt = 'Solo este dispositivo'; cls = 'local'; }
  else if (est === 'sync') { txt = pend ? `Guardando ${pend}…` : 'Actualizando…'; cls = 'sync'; }
  else if (est === 'error') { txt = pend ? `Sin conexión · ${pend} pendiente(s)` : (remoto.error || 'Sin conexión'); cls = 'err'; }
  else if (remoto.ultima) { txt = `Al día ${pad(remoto.ultima.getHours())}:${pad(remoto.ultima.getMinutes())}`; cls = 'ok'; }
  else { txt = 'Conectando…'; cls = 'sync'; }
  el.className = 'sync-pill ' + cls;
  el.textContent = (m === 'invitado' ? 'Invitado · ' : '') + txt;
  el.title = remoto.error || '';
}

/* ---------- cálculos ---------- */
const pagosDe = (casaId, per) => idx.pagos[casaId + '|' + per] || [];
const pagadoDe = (casaId, per) => pagosDe(casaId, per).reduce((s, p) => s + p.monto, 0);
/* Ocupación: casa.desocupada guarda los rangos en que la casa estuvo deshabitada,
   ej. "2026-03:2026-06,2026-10:" (el último sin fin = sigue deshabitada). */
function rangosDesocupada(c) {
  return (c?.desocupada || '').split(',').filter(Boolean).map(r => { const [desde, hasta] = r.split(':'); return { desde, hasta: hasta || '' }; });
}
const deshabitadaDesde = c => (rangosDesocupada(c).find(r => !r.hasta) || {}).desde || '';
const deshabitadaEn = (c, per) => rangosDesocupada(c).some(r => per >= r.desde && (!r.hasta || per <= r.hasta));
const unirRangos = rs => rs.map(r => `${r.desde}:${r.hasta}`).join(',');

function estado(casaId, per) {
  const s = pagadoDe(casaId, per);
  if (s > 0 && s >= db.config.cuota) return 'pagado';
  if (deshabitadaEn(idx.casa[casaId], per)) return 'deshabitada';
  if (s > 0) return 'parcial';
  if (db.adeudos[casaId + '|' + per]) return 'adeudo';
  return 'pendiente';
}
const ESTADO_TXT = { pagado: 'Pagado', parcial: 'Parcial', adeudo: 'Adeudo', pendiente: 'Sin registro', deshabitada: 'Deshabitada' };
const ESTADO_ICO = { pagado: '✓', parcial: '½', adeudo: '✕', pendiente: '·', deshabitada: '–' };

function moverPeriodo(per, d) {
  let [y, m] = per.split('-').map(Number);
  m += d;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${pad(m)}`;
}
const diasDelMes = per => { const [y, m] = per.split('-').map(Number); return new Date(y, m, 0).getDate(); };

/* Periodo de cobro: la cuota de un mes se paga del día "diaInicioCobro" del mes anterior
   al día "diaLimiteCobro" del mismo mes (ej. cuota de octubre: del 30 sep al 03 oct).
   Si el día de inicio es menor o igual al límite, todo el periodo cae dentro del mismo mes. */
function ventanaCobro(per) {
  const { diaInicioCobro: di, diaLimiteCobro: dl } = db.config;
  const perIni = di > dl ? moverPeriodo(per, -1) : per;
  return {
    desde: `${perIni}-${pad(Math.min(di, diasDelMes(perIni)))}`,
    hasta: `${per}-${pad(Math.min(dl, diasDelMes(per)))}`,
  };
}
// Cuota que corresponde cobrar hoy (la del periodo abierto o, si ya pasó, la del mes en curso)
function periodoACobrar(fecha = hoy()) {
  const sig = moverPeriodo(fecha.slice(0, 7), 1);
  return fecha >= ventanaCobro(sig).desde ? sig : fecha.slice(0, 7);
}
// Última cuota cuyo periodo de cobro ya terminó
function ultimoVencido(fecha = hoy()) {
  const per = fecha.slice(0, 7);
  return fecha > ventanaCobro(per).hasta ? per : moverPeriodo(per, -1);
}
const enPlazo = p => p.fecha <= ventanaCobro(p.periodo).hasta;
const txtVentana = per => { const v = ventanaCobro(per); return `del ${fechaTxt(v.desde).slice(0, 5)} al ${fechaTxt(v.hasta).slice(0, 5)}`; };

function deudaCasa(casaId) {
  let meses = 0, monto = 0;
  const pers = new Set();
  for (const k of Object.keys(db.adeudos)) { const [c, p] = k.split('|'); if (c === casaId) pers.add(p); }
  for (const p of db.pagos) if (p.casaId === casaId) pers.add(p.periodo);
  for (const p of pers) {
    const e = estado(casaId, p);
    if (e === 'adeudo') { meses++; monto += db.config.cuota; }
    else if (e === 'parcial') { meses++; monto += db.config.cuota - pagadoDe(casaId, p); }
  }
  return { meses, monto };
}
const totIngresos = () => db.pagos.reduce((s, p) => s + p.monto, 0);
const totGastos = () => db.gastos.reduce((s, g) => s + g.monto, 0);
const saldo = () => db.config.saldoInicial + totIngresos() - totGastos();

function movimientos() {
  const m = [
    ...db.pagos.map(p => ({ tipo: 'Ingreso', fecha: p.fecha, ts: p.ts, monto: p.monto, ref: p,
      concepto: `Cuota ${periodoTxt(p.periodo)} — Casa ${idx.casa[p.casaId]?.num ?? '?'}` })),
    ...db.gastos.map(g => ({ tipo: 'Gasto', fecha: g.fecha, ts: g.ts, monto: g.monto, ref: g, concepto: g.concepto })),
  ];
  m.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.ts - b.ts));
  let s = db.config.saldoInicial;
  for (const x of m) { s += x.tipo === 'Ingreso' ? x.monto : -x.monto; x.saldo = s; }
  return m;
}

/* ---------- estado de UI ---------- */
const ui = { tab: 'inicio', casaId: null, anio: new Date().getFullYear(), buscar: '', filtro: 'todas', buscarGasto: '', mesInicio: periodoActual(), mesCasas: periodoActual() };

function ir(tab) {
  ui.tab = tab;
  if (tab !== 'casa') ui.casaId = null;
  render();
  window.scrollTo(0, 0);
}

function render() {
  $('#tituloFracc').textContent = db.config.nombre;
  document.querySelectorAll('#nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === ui.tab || (ui.tab === 'casa' && b.dataset.tab === 'casas')));
  $('#navAjustes').lastChild.textContent = puedeEditar() ? 'Ajustes' : 'Más';
  // conservar el foco si el usuario está escribiendo en un buscador
  const act = document.activeElement;
  const foco = act && act.id && act.tagName === 'INPUT' ? { id: act.id, pos: act.selectionStart } : null;
  const v = { inicio: vInicio, casas: vCasas, casa: vCasa, gastos: vGastos, reporte: vReporte, ajustes: vAjustes }[ui.tab];
  $('#view').innerHTML = v();
  if (foco) { const i = document.getElementById(foco.id); if (i) { i.focus(); try { i.setSelectionRange(foco.pos, foco.pos); } catch {} } }
  setEstado(remoto.estado, remoto.error);
  pintarSesion();
}

/* ---------- vistas ---------- */
function selectorAnio() {
  const y0 = Math.min(new Date().getFullYear(), ...db.pagos.map(p => +p.periodo.slice(0, 4))) - 1;
  const y1 = new Date().getFullYear() + 1;
  let o = '';
  for (let y = y1; y >= y0; y--) o += `<option ${y === ui.anio ? 'selected' : ''}>${y}</option>`;
  return `<select data-change="anio" class="sel-anio" aria-label="Año">${o}</select>`;
}

function cargandoHtml() {
  return `<section class="card"><p class="empty">${remoto.estado === 'error'
    ? `No se pudieron cargar los datos: ${esc(remoto.error)}.<br><button class="btn btn-ghost" data-action="reintentar">Reintentar</button>`
    : 'Cargando datos del fraccionamiento…'}</p></section>`;
}

function tarjetaMiCasa() {
  const id = ls.get(CFG_MICASA);
  const c = id && idx.casa[id];
  if (!c) {
    return `<section class="card">
      <h2>Mi casa</h2>
      <p class="muted small">Elige tu casa para ver aquí si estás al corriente.</p>
      <select data-change="miCasa" class="sel-full"><option value="">Selecciona tu casa…</option>
        ${db.casas.map(x => `<option value="${x.id}">${esc(x.num)}</option>`).join('')}</select>
    </section>`;
  }
  const pc = periodoACobrar();
  const d = deudaCasa(c.id), e = estado(c.id, pc);
  return `<section class="card mi-casa ${d.meses ? 'debe' : 'ok'}" data-action="abrirCasa" data-id="${c.id}">
    <div class="card-head"><h2>Mi casa · ${esc(c.num)}</h2><span class="badge st-${e}">${ESTADO_TXT[e]} ${MES_C[+pc.slice(5) - 1]}</span></div>
    <b class="${d.meses ? 'negc' : 'pos'}">${d.meses ? `Adeudo: ${d.meses} mes(es) · ${money(d.monto)}` : 'Al corriente ✓'}</b>
    <span class="muted small">Cuota de ${MESES[+pc.slice(5) - 1]}: se paga ${txtVentana(pc)}</span>
    <span class="muted small">Toca para ver el detalle · <a href="#" data-action="cambiarMiCasa">cambiar casa</a></span>
  </section>`;
}

function tarjetaCobro(editor) {
  const hoyIso = hoy();
  let pc = periodoACobrar(hoyIso);
  if (hoyIso > ventanaCobro(pc).hasta) pc = moverPeriodo(pc, 1); // ya cerró: mostrar el siguiente cobro
  const v = ventanaCobro(pc);
  const abierto = hoyIso >= v.desde && hoyIso <= v.hasta;
  const pagadas = db.casas.filter(c => estado(c.id, pc) === 'pagado').length;
  const cobrables = db.casas.filter(c => estado(c.id, pc) !== 'deshabitada').length;
  const venc = ultimoVencido(hoyIso);
  const sinPago = db.casas.filter(c => estado(c.id, venc) === 'pendiente').length;
  const vv = ventanaCobro(venc);
  return `<section class="card cobro ${abierto ? 'abierto' : ''}">
    <div class="card-head"><h2>${abierto ? '🟢 Periodo de cobro abierto' : 'Próximo cobro'}</h2>
      <span class="badge ${abierto ? 'st-pagado' : 'st-pendiente'}">Cuota de ${MESES[+pc.slice(5) - 1]}</span></div>
    <p class="cobro-fechas">${abierto ? 'Se paga' : 'Se pagará'} <b>${txtVentana(pc)}</b> · ${money(db.config.cuota)} por casa</p>
    <p class="muted small">${pagadas} de ${cobrables} casas habitadas ya pagaron la cuota de ${MESES[+pc.slice(5) - 1]}${cobrables < db.casas.length ? ` (${db.casas.length - cobrables} deshabitada(s) no se cobran)` : ''}.</p>
    ${editor && sinPago ? `<div class="aviso">
      <span>La cuota de <b>${MESES[+venc.slice(5) - 1]}</b> venció el ${fechaTxt(vv.hasta)}: <b>${sinPago}</b> casa(s) sin pago ni adeudo.</span>
      <button class="btn btn-sm btn-danger-soft" data-action="marcarAdeudosMes" data-per="${venc}">Marcar adeudo</button>
    </div>` : ''}
  </section>`;
}

function vInicio() {
  if (!db.casas.length && modo() !== 'local') return cargandoHtml();
  const editor = puedeEditar();
  const per = ui.mesInicio;
  const [py, pm] = per.split('-');
  const ingMes = db.pagos.filter(p => p.fecha.startsWith(per)).reduce((s, p) => s + p.monto, 0);
  const gasMes = db.gastos.filter(g => g.fecha.startsWith(per)).reduce((s, g) => s + g.monto, 0);
  const cuentas = { pagado: 0, parcial: 0, adeudo: 0, pendiente: 0, deshabitada: 0 };
  for (const c of db.casas) cuentas[estado(c.id, per)]++;
  const deudaTotal = db.casas.reduce((s, c) => s + deudaCasa(c.id).monto, 0);
  const s = saldo();
  const ult = movimientos().slice(-8).reverse();
  const habitadas = db.casas.length - cuentas.deshabitada;
  const pct = habitadas ? Math.round(cuentas.pagado / habitadas * 100) : 0;
  return `
  <section class="hero ${s < 0 ? 'neg' : ''}">
    <div class="hero-lbl">Saldo disponible</div>
    <div class="hero-amt">${money(s)}</div>
    <div class="hero-sub">Ingresos ${money(totIngresos())} · Gastos ${money(totGastos())}${db.config.saldoInicial ? ` · Saldo inicial ${money(db.config.saldoInicial)}` : ''}</div>
  </section>

  ${editor ? `<div class="actions">
    <button class="btn btn-primary" data-action="nuevoPago">+ Registrar pago</button>
    <button class="btn btn-danger-soft" data-action="nuevoGasto">− Registrar gasto</button>
  </div>` : tarjetaMiCasa()}

  ${tarjetaCobro(editor)}

  <section class="card">
    <div class="card-head">
      <h2>Mes de</h2>
      <input type="month" value="${per}" data-change="mesInicio" aria-label="Mes">
    </div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <p class="muted small">${cuentas.pagado} de ${habitadas} casas habitadas al corriente en ${MESES[+pm - 1]} ${py} (${pct}%)${cuentas.deshabitada ? ` · ${cuentas.deshabitada} deshabitada(s)` : ''}</p>
    <div class="stats">
      <div class="stat ok"><b>${cuentas.pagado}</b><span>Pagadas</span></div>
      <div class="stat warn"><b>${cuentas.parcial}</b><span>Parciales</span></div>
      <div class="stat bad"><b>${cuentas.adeudo}</b><span>Adeudo</span></div>
      <div class="stat"><b>${cuentas.pendiente}</b><span>Sin registro</span></div>
    </div>
    <div class="stats two">
      <div class="stat"><b class="pos">${money(ingMes)}</b><span>Ingresos del mes</span></div>
      <div class="stat"><b class="negc">${money(gasMes)}</b><span>Gastos del mes</span></div>
    </div>
    ${editor && cuentas.pendiente ? `<button class="btn btn-ghost full" data-action="marcarAdeudosMes" data-per="${per}">Marcar las ${cuentas.pendiente} casas sin registro como adeudo</button>` : ''}
  </section>

  <section class="card">
    <div class="card-head"><h2>Adeudo acumulado</h2><b class="negc">${money(deudaTotal)}</b></div>
    <p class="muted small">Suma de meses marcados como adeudo y pagos parciales.</p>
    <button class="btn btn-ghost full" data-action="verDeudores">Ver casas con adeudo</button>
  </section>

  <section class="card">
    <div class="card-head"><h2>Últimos movimientos</h2>${editor ? '<button class="btn btn-sm btn-ghost" data-action="exportar">Exportar Excel</button>' : ''}</div>
    ${ult.length ? `<ul class="list">${ult.map(movItem).join('')}</ul>` : '<p class="empty">Aún no hay movimientos.</p>'}
  </section>`;
}

function movItem(x) {
  return `<li class="mov">
    <span class="dot ${x.tipo === 'Ingreso' ? 'ok' : 'bad'}"></span>
    <div class="grow"><div>${esc(x.concepto)}</div><div class="muted small">${fechaTxt(x.fecha)}${x.ref.metodo ? ' · ' + esc(x.ref.metodo) : ''}${x.ref.categoria ? ' · ' + esc(x.ref.categoria) : ''}</div></div>
    <b class="${x.tipo === 'Ingreso' ? 'pos' : 'negc'}">${x.tipo === 'Ingreso' ? '+' : '−'}${money(x.monto)}</b>
  </li>`;
}

function vCasas() {
  if (!db.casas.length && modo() !== 'local') return cargandoHtml();
  const editor = puedeEditar();
  const per = ui.mesCasas;
  const q = ui.buscar.trim().toLowerCase().replace(/\s+/g, '');
  const coincide = c => !q || c.num.toLowerCase().includes(q) ||
    (editor && (c.propietario.toLowerCase().replace(/\s+/g, '').includes(q) || c.telefono.replace(/\s+/g, '').includes(q)));
  // agrupa cada casa según su estado en el mes elegido
  const grupo = c => { const e = estado(c.id, per); return e === 'pagado' ? 'corriente' : e === 'pendiente' || e === 'deshabitada' ? e : 'deuda'; };
  const buscadas = db.casas.filter(coincide);
  const cuenta = { todas: buscadas.length, corriente: 0, deuda: 0, pendiente: 0, deshabitada: 0 };
  buscadas.forEach(c => cuenta[grupo(c)]++);
  const casas = ui.filtro === 'todas' ? buscadas : buscadas.filter(c => grupo(c) === ui.filtro);
  const chip = (k, t) => `<button class="chip chip-${k} ${ui.filtro === k ? 'on' : ''}" data-action="filtro" data-f="${k}">${t} <b>${cuenta[k]}</b></button>`;
  const sinProp = editor ? db.casas.filter(c => !c.propietario).length : 0;
  return `
  <div class="searchbar">
    <input id="buscarCasa" type="search" placeholder="Buscar casa (ej. 17A)${editor ? ', propietario o teléfono' : ''}" value="${esc(ui.buscar)}" data-input="buscar" autocomplete="off" inputmode="search">
  </div>
  <div class="mes-filtro">
    <span class="lbl">Estado del mes</span>
    <button class="icon-btn" data-action="mesCasas" data-d="-1" aria-label="Mes anterior">‹</button>
    <input type="month" value="${per}" data-change="mesCasas" aria-label="Mes a revisar">
    <button class="icon-btn" data-action="mesCasas" data-d="1" aria-label="Mes siguiente">›</button>
  </div>
  <div class="chips">${chip('todas', 'Todas')}${chip('corriente', 'Al corriente')}${chip('deuda', 'Con adeudo')}${chip('pendiente', 'Sin registro')}${chip('deshabitada', 'Deshabitadas')}</div>
  <div class="casas-bar">
    <p class="muted small">${casas.length} casa(s) · ${periodoTxt(per)}${sinProp ? ` · ${sinProp} sin propietario registrado` : ''}</p>
    ${editor ? '<button class="chip add" data-action="nuevaCasa">+ Casa</button>' : ''}
  </div>
  <div class="grid-casas">
    ${casas.map(c => {
      const e = estado(c.id, per), d = deudaCasa(c.id), s = pagadoDe(c.id, per);
      return `<div class="casa st-${e}">
        <button class="casa-main" data-action="abrirCasa" data-id="${c.id}">
          <span class="casa-num">${esc(c.num)}</span>
          ${editor ? `<span class="casa-prop">${esc(c.propietario) || '<i>Sin propietario</i>'}</span>` : ''}
          <span class="casa-st">${ESTADO_TXT[e]}${e === 'parcial' ? ' · ' + money(s) : ''}</span>
          ${d.meses ? `<span class="casa-deuda">Adeudo total: ${d.meses} mes(es) · ${money(d.monto)}</span>` : ''}
          ${e !== 'deshabitada' && deshabitadaDesde(c) ? `<span class="casa-desh">Deshabitada desde ${periodoCorto(deshabitadaDesde(c))}</span>` : ''}
        </button>
        ${editor ? `<button class="casa-edit" data-action="editarCasa" data-id="${c.id}">${c.propietario ? '✎ Datos del propietario' : '+ Registrar propietario'}</button>` : ''}
      </div>`;
    }).join('') || '<p class="empty">No hay casas con ese estado en este mes.</p>'}
  </div>`;
}

function vCasa() {
  const c = idx.casa[ui.casaId];
  if (!c) { ui.tab = 'casas'; return vCasas(); }
  const editor = puedeEditar();
  const d = deudaCasa(c.id);
  const pagos = db.pagos.filter(p => p.casaId === c.id).sort((a, b) => b.periodo.localeCompare(a.periodo) || b.fecha.localeCompare(a.fecha));
  const total = pagos.reduce((s, p) => s + p.monto, 0);
  const meses = MES_C.map((m, i) => {
    const per = `${ui.anio}-${pad(i + 1)}`;
    const e = estado(c.id, per);
    const s = pagadoDe(c.id, per);
    return `<button class="mes st-${e}" data-action="mes" data-per="${per}">
      <span class="mes-n">${m}</span><span class="mes-i">${ESTADO_ICO[e]}</span>
      <span class="mes-m">${s ? money(s) : ESTADO_TXT[e]}</span></button>`;
  }).join('');
  return `
  <button class="back" data-action="volver">‹ Casas</button>
  <section class="card casa-head">
    <div>
      <div class="casa-big">Casa ${esc(c.num)}</div>
      ${deshabitadaDesde(c)
        ? `<span class="badge st-deshabitada">Deshabitada desde ${periodoTxt(deshabitadaDesde(c))}</span>`
        : '<span class="badge st-pagado">Habitada</span>'}
    </div>
    ${editor ? (deshabitadaDesde(c)
      ? `<button class="btn btn-sm btn-primary" data-action="ocupacion" data-id="${c.id}">Marcar como habitada</button>`
      : `<button class="btn btn-sm btn-ghost" data-action="ocupacion" data-id="${c.id}">Marcar como deshabitada</button>`) : ''}
  </section>
  ${deshabitadaDesde(c) ? `<p class="muted small nota-desh">Mientras esté deshabitada, sus meses no se marcan con adeudo ni cuentan como pendientes.</p>` : ''}
  ${editor ? `<section class="card">
    <div class="card-head"><h2>Propietario</h2>
      <button class="btn btn-sm ${c.propietario ? 'btn-ghost' : 'btn-primary'}" data-action="editarCasa" data-id="${c.id}">${c.propietario ? 'Editar' : '+ Registrar'}</button></div>
    ${c.propietario || c.telefono || c.correo || c.notas ? `<dl class="datos">
      <dt>Nombre</dt><dd>${esc(c.propietario) || '—'}</dd>
      <dt>Teléfono</dt><dd>${c.telefono ? `<a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : '—'}</dd>
      <dt>Correo</dt><dd>${c.correo ? `<a href="mailto:${esc(c.correo)}">${esc(c.correo)}</a>` : '—'}</dd>
      ${c.notas ? `<dt>Notas</dt><dd>${esc(c.notas)}</dd>` : ''}
    </dl>` : '<p class="muted small">Aún no se registran los datos del propietario.</p>'}
  </section>` : ''}
  <div class="stats two">
    <div class="stat"><b class="pos">${money(total)}</b><span>Total pagado</span></div>
    <div class="stat ${d.meses ? 'bad' : 'ok'}"><b>${d.meses ? money(d.monto) : 'Al corriente'}</b><span>${d.meses ? d.meses + ' mes(es) de adeudo' : 'Sin adeudos'}</span></div>
  </div>
  <section class="card">
    <div class="card-head"><h2>Cumplimiento</h2>${selectorAnio()}</div>
    <div class="meses">${meses}</div>
    <p class="muted small">${editor ? 'Toca un mes para registrar pago o marcar adeudo.' : 'Toca un mes para ver el detalle.'}</p>
    ${editor ? `<div class="actions"><button class="btn btn-primary" data-action="nuevoPago" data-casa="${c.id}">+ Registrar pago</button></div>` : ''}
  </section>
  <section class="card">
    <h2>Historial de pagos</h2>
    ${pagos.length ? `<ul class="list">${pagos.map(p => `<li class="mov">
      <span class="dot ok"></span>
      <div class="grow"><div>${periodoTxt(p.periodo)}</div><div class="muted small">Pagado el ${fechaTxt(p.fecha)}${enPlazo(p) ? '' : ' <span class="tag-tarde">fuera de plazo</span>'}${p.metodo ? ' · ' + esc(p.metodo) : ''}${p.nota ? ' · ' + esc(p.nota) : ''}</div></div>
      <b class="pos">${money(p.monto)}</b>
      ${editor ? `<button class="icon-btn" data-action="borrarPago" data-id="${p.id}" title="Eliminar pago" aria-label="Eliminar pago">🗑</button>` : ''}
    </li>`).join('')}</ul>` : '<p class="empty">Sin pagos registrados.</p>'}
  </section>`;
}

function vGastos() {
  const editor = puedeEditar();
  const q = ui.buscarGasto.trim().toLowerCase();
  const gastos = db.gastos.filter(g => !q || g.concepto.toLowerCase().includes(q) || (g.categoria || '').toLowerCase().includes(q))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.ts - a.ts);
  const grupos = {};
  for (const g of gastos) (grupos[g.fecha.slice(0, 7)] ||= []).push(g);
  return `
  <section class="hero small-hero">
    <div class="hero-lbl">Total de gastos</div>
    <div class="hero-amt">${money(totGastos())}</div>
    <div class="hero-sub">Saldo disponible ${money(saldo())}</div>
  </section>
  ${editor ? '<div class="actions"><button class="btn btn-primary" data-action="nuevoGasto">+ Registrar gasto</button></div>' : ''}
  <div class="searchbar"><input id="buscarGasto" type="search" placeholder="Buscar concepto o categoría" value="${esc(ui.buscarGasto)}" data-input="buscarGasto" autocomplete="off"></div>
  ${Object.keys(grupos).map(per => `
    <section class="card">
      <div class="card-head"><h2>${periodoTxt(per)}</h2><b class="negc">${money(grupos[per].reduce((s, g) => s + g.monto, 0))}</b></div>
      <ul class="list">${grupos[per].map(g => `<li class="mov">
        <span class="dot bad"></span>
        <div class="grow"><div>${esc(g.concepto)}</div><div class="muted small">${fechaTxt(g.fecha)}${g.categoria ? ' · ' + esc(g.categoria) : ''}${g.nota ? ' · ' + esc(g.nota) : ''}</div></div>
        <b class="negc">${money(g.monto)}</b>
        ${editor ? `<button class="icon-btn" data-action="editarGasto" data-id="${g.id}" title="Editar" aria-label="Editar gasto">✎</button>` : ''}
      </li>`).join('')}</ul>
    </section>`).join('') || '<p class="empty">No hay gastos registrados.</p>'}`;
}

function vReporte() {
  const pers = MES_C.map((_, i) => `${ui.anio}-${pad(i + 1)}`);
  const cobrado = pers.map(p => db.pagos.filter(x => x.periodo === p).reduce((s, x) => s + x.monto, 0));
  // flujo de caja por mes (según fecha del movimiento)
  const movs = movimientos();
  let saldoPrevio = db.config.saldoInicial;
  for (const m of movs) if (m.fecha < `${ui.anio}-01-01`) saldoPrevio += m.tipo === 'Ingreso' ? m.monto : -m.monto;
  let acum = saldoPrevio;
  const flujo = pers.map(p => {
    const ing = movs.filter(m => m.tipo === 'Ingreso' && m.fecha.startsWith(p)).reduce((s, m) => s + m.monto, 0);
    const gas = movs.filter(m => m.tipo === 'Gasto' && m.fecha.startsWith(p)).reduce((s, m) => s + m.monto, 0);
    acum += ing - gas;
    return { p, ing, gas, saldo: acum };
  });
  return `
  <section class="card">
    <div class="card-head"><h2>Reporte anual</h2>${selectorAnio()}</div>
    ${puedeEditar() ? '<div class="actions"><button class="btn btn-primary" data-action="exportar">⬇ Exportar Excel (todas las transacciones)</button></div>' : ''}
  </section>
  <section class="card">
    <h2>Flujo de caja ${ui.anio}</h2>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Saldo</th></tr></thead>
      <tbody>
        <tr class="muted"><td>Saldo al inicio</td><td></td><td></td><td>${money(saldoPrevio)}</td></tr>
        ${flujo.map(f => `<tr><td>${MESES[+f.p.slice(5) - 1]}</td><td class="pos">${f.ing ? money(f.ing) : '—'}</td><td class="negc">${f.gas ? money(f.gas) : '—'}</td><td><b>${money(f.saldo)}</b></td></tr>`).join('')}
      </tbody>
    </table></div>
  </section>
  <section class="card">
    <h2>Cumplimiento por casa ${ui.anio}</h2>
    <p class="muted small leyenda"><span class="lg st-pagado">✓ Pagado</span><span class="lg st-parcial">½ Parcial</span><span class="lg st-adeudo">✕ Adeudo</span><span class="lg st-pendiente">· Sin registro</span><span class="lg st-deshabitada">– Deshabitada</span></p>
    <div class="table-wrap"><table class="tbl matrix">
      <thead><tr><th class="sticky">Casa</th>${MES_C.map(m => `<th>${m}</th>`).join('')}</tr></thead>
      <tbody>${db.casas.map(c => `<tr><th class="sticky" title="${esc(c.propietario)}">${esc(c.num)}</th>${pers.map(p => {
        const e = estado(c.id, p);
        return `<td class="st-${e}" data-action="mesCasa" data-id="${c.id}" data-per="${p}" title="${esc(c.num)} · ${periodoTxt(p)}: ${ESTADO_TXT[e]}">${ESTADO_ICO[e]}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><th class="sticky">Cobrado</th>${cobrado.map(v => `<td class="small">${v ? '$' + Math.round(v).toLocaleString('es-MX') : '—'}</td>`).join('')}</tr></tfoot>
    </table></div>
  </section>`;
}

function enlaceVecinos() {
  // si la URL del script ya está en config.js, basta con la dirección de la app
  const fija = window.CUOTAS_CONFIG && window.CUOTAS_CONFIG.apiUrl;
  return location.origin + location.pathname + (fija === remoto.url ? '' : '?api=' + encodeURIComponent(remoto.url));
}

function seccionConexion() {
  const m = modo();
  if (m === 'admin') {
    const esLocalHost = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
    return `<section class="card">
      <h2>Sesión y Google Sheets</h2>
      <p class="small"><span class="badge st-pagado">Administrador: ${esc(remoto.usuario || 'admin')}</span></p>
      <p class="muted small">Los cambios se guardan en tu hoja de Google. Los vecinos los ven al abrir el enlace, como invitados (solo consulta).</p>
      <div class="lbl">Enlace para vecinos</div>
      <input class="sel-full" readonly value="${esc(enlaceVecinos())}" onclick="this.select()">
      ${esLocalHost ? '<p class="muted small">⚠ Este enlace solo funcionará cuando la app esté publicada en internet.</p>' : ''}
      <div class="actions">
        <button class="btn btn-primary" data-action="compartirEnlace">Compartir enlace</button>
        <button class="btn btn-ghost" data-action="sincronizar">Actualizar ahora</button>
      </div>
      ${remoto.cola.length ? `<p class="small negc">${remoto.cola.length} cambio(s) sin enviar. <a href="#" data-action="descartarCola">Descartar</a></p>` : ''}
      <button class="btn btn-ghost full" data-action="cerrarSesion">Cerrar sesión de administrador</button>
      <button class="btn btn-ghost full" data-action="desconectar">Desconectar este dispositivo de Google Sheets</button>
    </section>`;
  }
  return `<section class="card">
    <h2>Conectar con Google Sheets</h2>
    <p class="muted small">Conecta la app a tu hoja de Google para que los datos se compartan y los vecinos puedan consultarlos con el enlace.</p>
    <form id="formConexion" class="form flush">
      <label>URL del script (termina en /exec)<input name="url" type="url" required placeholder="https://script.google.com/macros/s/…/exec" value="${esc(remoto.url)}"></label>
      <label>Usuario<input name="usuario" required autocomplete="username" autocapitalize="none"></label>
      <label>Contraseña<input name="clave" type="password" required autocomplete="current-password"></label>
      <button class="btn btn-primary">Conectar e iniciar sesión</button>
    </form>
  </section>`;
}

function ejemploCobro(di, dl) {
  di = +di; dl = +dl;
  if (!di || !dl) return '';
  return di > dl
    ? `Ejemplo: la cuota de octubre se paga del ${pad(di)} de septiembre al ${pad(dl)} de octubre. Después de esa fecha se considera vencida.`
    : `Ejemplo: la cuota de octubre se paga del ${pad(di)} al ${pad(dl)} de octubre. Después de esa fecha se considera vencida.`;
}

function vAjustes() {
  const m = modo();
  if (m === 'invitado') {
    return `
    <section class="card">
      <h2>Modo invitado</h2>
      <p class="muted small">Puedes ver el saldo del fraccionamiento, los gastos y el estado de cada casa. Solo el administrador puede registrar, modificar o eliminar información.</p>
      <button class="btn btn-ghost full" data-action="sincronizar">Actualizar datos</button>
      ${ls.get(CFG_MICASA) ? '<button class="btn btn-ghost full" data-action="cambiarMiCasa">Cambiar mi casa</button>' : ''}
    </section>
    <section class="card">
      <h2>Administrador</h2>
      <p class="muted small">Si eres el administrador, inicia sesión para registrar pagos, gastos y movimientos.</p>
      <button class="btn btn-primary full" data-action="login">Iniciar sesión</button>
    </section>
    <p class="muted small center">${esc(db.config.nombre)} · ${db.casas.length} casas</p>`;
  }
  const c = db.config;
  return `
  <section class="card">
    <h2>Configuración</h2>
    <form id="formConfig" class="form flush">
      <label>Nombre del fraccionamiento<input name="nombre" value="${esc(c.nombre)}" required></label>
      <label>Cuota mensual por casa<input name="cuota" type="number" step="0.01" min="0" value="${c.cuota}" required></label>
      <label>Saldo inicial en caja<input name="saldoInicial" type="number" step="0.01" value="${c.saldoInicial}"></label>
      <div>
        <div class="lbl">Periodo de cobro de cada mes</div>
        <div class="dias-cobro">del día <input name="diaInicioCobro" type="number" min="1" max="31" value="${c.diaInicioCobro}" required aria-label="Día en que inicia el cobro">
          al día <input name="diaLimiteCobro" type="number" min="1" max="31" value="${c.diaLimiteCobro}" required aria-label="Día límite de pago"></div>
        <p class="muted small" id="ejemploCobro">${ejemploCobro(c.diaInicioCobro, c.diaLimiteCobro)}</p>
      </div>
      <button class="btn btn-primary">Guardar configuración</button>
    </form>
  </section>
  ${seccionConexion()}
  <section class="card">
    <h2>Exportar y respaldar</h2>
    <p class="muted small">${m === 'local' ? 'Los datos se guardan solo en este dispositivo. Haz respaldos periódicos para no perderlos.' : 'Los datos están en Google Sheets. El respaldo descarga una copia en este dispositivo.'}</p>
    <div class="stack">
      <button class="btn btn-primary" data-action="exportar">⬇ Exportar Excel</button>
      <button class="btn btn-ghost" data-action="respaldo">Descargar respaldo (.json)</button>
      <label class="btn btn-ghost file-btn">Restaurar respaldo<input type="file" accept=".json,application/json" data-change="restaurar" hidden></label>
    </div>
  </section>
  ${m === 'local' ? `<section class="card">
    <h2>Zona de riesgo</h2>
    <button class="btn btn-danger-soft full" data-action="borrarTodo">Borrar todos los datos</button>
  </section>` : ''}
  <p class="muted small center">${db.casas.length} casas · ${db.pagos.length} pagos · ${db.gastos.length} gastos</p>`;
}

/* ---------- modales ---------- */
const modal = $('#modal');
function abrirModal(html) { $('#modalBody').innerHTML = html; if (!modal.open) modal.showModal(); }
function cerrarModal() { if (modal.open) modal.close(); }
modal.addEventListener('click', e => { if (e.target === modal) cerrarModal(); });

function modalPago(casaId, preselPer) {
  const casaSel = casaId || '';
  if (!preselPer) { const pc = periodoACobrar(); if (!casaId || estado(casaId, pc) !== 'pagado') preselPer = pc; }
  const anio = +preselPer.slice(0, 4);
  abrirModal(`
  <form id="formPago" class="form">
    <h3>Registrar pago</h3>
    <label>Casa
      <select name="casaId" required>
        <option value="">Selecciona…</option>
        ${db.casas.map(c => `<option value="${c.id}" ${c.id === casaSel ? 'selected' : ''}>${esc(c.num)}${c.propietario ? ' — ' + esc(c.propietario) : ''}</option>`).join('')}
      </select>
    </label>
    <label>Año <input name="anio" type="number" value="${anio}" min="2000" max="2100" required></label>
    <div><div class="lbl">Mes(es) que paga</div><div id="mesesPago" class="mes-pick"></div></div>
    <label>Monto por mes<input name="monto" type="number" step="0.01" min="0.01" value="${db.config.cuota}" required></label>
    <div class="total-line">Total: <b id="totalPago">${money(0)}</b></div>
    <label>Fecha de pago<input name="fecha" type="date" value="${hoy()}" required></label>
    <p class="muted small" id="plazoPago"></p>
    <label>Método<select name="metodo">${METODOS.map(m => `<option>${m}</option>`).join('')}</select></label>
    <label>Nota (opcional)<input name="nota" placeholder="Folio, referencia, quién entregó…"></label>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-action="cerrar">Cancelar</button>
      <button class="btn btn-primary">Guardar pago</button>
    </div>
  </form>`);
  const f = $('#formPago');
  const pintarMeses = () => {
    const cid = f.casaId.value, y = f.anio.value;
    const marcados = new Set([...f.querySelectorAll('input[name=mes]:checked')].map(i => i.value));
    if (preselPer) { marcados.add(preselPer); preselPer = null; }
    $('#mesesPago').innerHTML = MES_C.map((m, i) => {
      const per = `${y}-${pad(i + 1)}`;
      const e = cid ? estado(cid, per) : 'pendiente';
      return `<label class="mp st-${e}"><input type="checkbox" name="mes" value="${per}" ${marcados.has(per) ? 'checked' : ''}><span>${m}<small>${e === 'pagado' ? '✓' : e === 'adeudo' ? 'debe' : e === 'parcial' ? '½' : ''}</small></span></label>`;
    }).join('');
    total();
  };
  const total = () => {
    const sel = [...f.querySelectorAll('input[name=mes]:checked')].map(i => i.value);
    $('#totalPago').textContent = money(sel.length * num(f.monto.value));
    const tarde = sel.filter(p => f.fecha.value > ventanaCobro(p).hasta);
    $('#plazoPago').innerHTML = tarde.length
      ? `<span class="negc">⚠ Pago fuera de plazo para: ${tarde.map(periodoCorto).join(', ')}</span>`
      : sel.length === 1 ? `Periodo de cobro de ${MESES[+sel[0].slice(5) - 1]}: ${txtVentana(sel[0])}` : '';
  };
  f.casaId.addEventListener('change', pintarMeses);
  f.anio.addEventListener('change', pintarMeses);
  f.monto.addEventListener('input', total);
  f.fecha.addEventListener('change', total);
  $('#mesesPago').addEventListener('change', total);
  pintarMeses();
  f.addEventListener('submit', e => {
    e.preventDefault();
    const casa = f.casaId.value;
    const meses = [...f.querySelectorAll('input[name=mes]:checked')].map(i => i.value);
    if (!casa) return toast('Selecciona una casa');
    if (!meses.length) return toast('Selecciona al menos un mes');
    const monto = num(f.monto.value);
    if (monto <= 0) return toast('Monto inválido');
    const ya = meses.filter(p => estado(casa, p) === 'pagado');
    if (ya.length && !confirm(`Ya hay pago completo en: ${ya.map(periodoCorto).join(', ')}.\n¿Registrar otro pago de todos modos?`)) return;
    const ts = Date.now();
    const ops = meses.map((per, i) => ({ tipo: 'pago.guardar', pago: {
      id: uid(), casaId: casa, periodo: per, monto, fecha: f.fecha.value, metodo: f.metodo.value, nota: f.nota.value.trim(), ts: ts + i } }));
    if (!ejecutar(ops)) return;
    cerrarModal(); render();
    toast(`Pago registrado: Casa ${idx.casa[casa].num} · ${money(monto * meses.length)}`);
  });
}

function modalGasto(id) {
  const g = id ? db.gastos.find(x => x.id === id) : null;
  abrirModal(`
  <form id="formGasto" class="form">
    <h3>${g ? 'Editar gasto' : 'Registrar gasto'}</h3>
    <label>Concepto<input name="concepto" required value="${esc(g?.concepto)}" placeholder="Ej. Pago de jardinero"></label>
    <label>Categoría<input name="categoria" list="cats" value="${esc(g?.categoria)}" placeholder="Opcional"></label>
    <datalist id="cats">${CATEGORIAS.map(c => `<option value="${c}">`).join('')}</datalist>
    <label>Monto<input name="monto" type="number" step="0.01" min="0.01" required value="${g?.monto ?? ''}"></label>
    <label>Fecha<input name="fecha" type="date" required value="${g?.fecha ?? hoy()}"></label>
    <label>Nota (opcional)<input name="nota" value="${esc(g?.nota)}" placeholder="Proveedor, factura…"></label>
    ${!g ? `<p class="muted small">Saldo disponible: ${money(saldo())}</p>` : ''}
    <div class="modal-actions">
      ${g ? `<button type="button" class="btn btn-danger-soft" data-action="borrarGasto" data-id="${g.id}">Eliminar</button>` : ''}
      <button type="button" class="btn btn-ghost" data-action="cerrar">Cancelar</button>
      <button class="btn btn-primary">Guardar</button>
    </div>
  </form>`);
  $('#formGasto').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const data = { concepto: f.concepto.value.trim(), categoria: f.categoria.value.trim(), monto: num(f.monto.value), fecha: f.fecha.value, nota: f.nota.value.trim() };
    if (!data.concepto || data.monto <= 0) return toast('Revisa concepto y monto');
    const gasto = g ? { ...g, ...data } : { id: uid(), ts: Date.now(), ...data };
    if (!ejecutar([{ tipo: 'gasto.guardar', gasto }])) return;
    cerrarModal(); render();
    toast(g ? 'Gasto actualizado' : `Gasto registrado: ${money(data.monto)}`);
  });
}

function modalCasa(id) {
  const c = id ? idx.casa[id] : null;
  abrirModal(`
  <form id="formCasa" class="form">
    <h3>${c ? 'Casa ' + esc(c.num) + ' · datos del propietario' : 'Nueva casa'}</h3>
    <label>Número de casa<input name="num" required value="${esc(c?.num)}" placeholder="Ej. 17A"></label>
    <label>Nombre del propietario<input name="propietario" value="${esc(c?.propietario)}" autocomplete="off" placeholder="Nombre completo"></label>
    <label>Teléfono<input name="telefono" type="tel" inputmode="tel" value="${esc(c?.telefono)}" autocomplete="off" placeholder="10 dígitos"></label>
    <label>Correo electrónico<input name="correo" type="email" value="${esc(c?.correo)}" autocomplete="off" placeholder="Opcional"></label>
    <label>Notas<input name="notas" value="${esc(c?.notas)}" placeholder="Ej. renta la casa, contacto alterno…"></label>
    <p class="muted small">Estos datos solo los ve el administrador; los invitados no pueden consultarlos.</p>
    <div class="modal-actions">
      ${c ? `<button type="button" class="btn btn-danger-soft" data-action="borrarCasa" data-id="${c.id}">Eliminar</button>` : ''}
      <button type="button" class="btn btn-ghost" data-action="cerrar">Cancelar</button>
      <button class="btn btn-primary">Guardar</button>
    </div>
  </form>`);
  $('#formCasa').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const numero = f.num.value.trim().toUpperCase().replace(/\s+/g, '');
    if (db.casas.some(x => x.num === numero && x.id !== c?.id)) return toast(`La casa ${numero} ya existe`);
    const casa = { desocupada: '', ...c, id: c?.id || uid(), num: numero, propietario: f.propietario.value.trim(), telefono: f.telefono.value.trim(), correo: f.correo.value.trim(), notas: f.notas.value.trim() };
    if (!ejecutar([{ tipo: 'casa.guardar', casa }])) return;
    cerrarModal(); render(); toast('Casa guardada');
  });
}

function modalOcupacion(casaId) {
  const c = idx.casa[casaId];
  const desde = deshabitadaDesde(c);
  const pc = periodoACobrar();
  abrirModal(`
  <form id="formOcupacion" class="form">
    <h3>Casa ${esc(c.num)} · ${desde ? 'marcar como habitada' : 'marcar como deshabitada'}</h3>
    ${desde
      ? `<p class="muted small">Está deshabitada desde ${periodoTxt(desde)}. A partir del mes que elijas se vuelve a cobrar la cuota y podrá marcarse con adeudo.</p>
         <label>Habitada a partir de<input name="mes" type="month" value="${pc < desde ? desde : pc}" min="${desde}" required></label>`
      : `<p class="muted small">Desde el mes que elijas, la casa no se cobrará ni se marcará con adeudo hasta que la vuelvas a marcar como habitada. Los adeudos anteriores a ese mes se conservan.</p>
         <label>Deshabitada a partir de<input name="mes" type="month" value="${pc}" required></label>`}
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-action="cerrar">Cancelar</button>
      <button class="btn btn-primary">${desde ? 'Marcar como habitada' : 'Marcar como deshabitada'}</button>
    </div>
  </form>`);
  $('#formOcupacion').addEventListener('submit', e => {
    e.preventDefault();
    const mes = e.target.mes.value;
    if (!mes) return;
    let rs = rangosDesocupada(c);
    const ops = [];
    if (desde) {
      if (mes < desde) return toast(`El mes no puede ser anterior a ${periodoTxt(desde)}`);
      const abierto = rs.find(r => !r.hasta);
      if (mes === desde) rs = rs.filter(r => r !== abierto); // nunca estuvo deshabitada
      else abierto.hasta = moverPeriodo(mes, -1);
    } else {
      const ult = rs[rs.length - 1];
      if (ult && mes <= moverPeriodo(ult.hasta, 1)) { // une con el rango anterior si se encima o es contiguo
        ult.hasta = '';
        if (mes < ult.desde) ult.desde = mes;
      } else rs.push({ desde: mes, hasta: '' });
      // quita adeudos marcados a partir de ese mes
      for (const k of Object.keys(db.adeudos)) {
        const [cid, p] = k.split('|');
        if (cid === c.id && p >= mes) ops.push({ tipo: 'adeudo.quitar', casaId: cid, periodo: p });
      }
    }
    ops.unshift({ tipo: 'casa.guardar', casa: { ...c, desocupada: unirRangos(rs) } });
    if (!ejecutar(ops)) return;
    cerrarModal(); render();
    toast(desde ? `Casa ${c.num} habitada desde ${periodoTxt(mes)}` : `Casa ${c.num} deshabitada desde ${periodoTxt(mes)}`);
  });
}

function modalMes(casaId, per) {
  const c = idx.casa[casaId];
  if (!c) return;
  const editor = puedeEditar();
  const e = estado(casaId, per);
  const pagos = pagosDe(casaId, per);
  const marcado = !!db.adeudos[casaId + '|' + per];
  abrirModal(`
  <div class="form">
    <h3>Casa ${esc(c.num)} · ${periodoTxt(per)}</h3>
    <p><span class="badge st-${e}">${ESTADO_TXT[e]}</span> ${e === 'parcial' ? `Falta ${money(db.config.cuota - pagadoDe(casaId, per))}` : ''}</p>
    ${e === 'deshabitada' ? '<p class="muted small">La casa estaba deshabitada este mes: no se cobra ni se marca con adeudo.</p>' : ''}
    ${pagos.length ? `<ul class="list">${pagos.map(p => `<li class="mov"><div class="grow">${money(p.monto)} <span class="muted small">· ${fechaTxt(p.fecha)}${p.metodo ? ' · ' + esc(p.metodo) : ''}</span></div>
      ${editor ? `<button class="icon-btn" data-action="borrarPago" data-id="${p.id}" aria-label="Eliminar pago">🗑</button>` : ''}</li>`).join('')}</ul>` : ''}
    <div class="stack">
      ${editor && e !== 'pagado' ? `<button class="btn btn-primary" data-action="pagoMes" data-id="${casaId}" data-per="${per}">Registrar pago</button>` : ''}
      ${editor && !pagos.length && !marcado && e !== 'deshabitada' ? `<button class="btn btn-danger-soft" data-action="toggleAdeudo" data-id="${casaId}" data-per="${per}">Marcar como adeudo</button>` : ''}
      ${editor && marcado && !pagos.length ? `<button class="btn btn-ghost" data-action="toggleAdeudo" data-id="${casaId}" data-per="${per}">Quitar adeudo</button>` : ''}
      ${ui.tab !== 'casa' ? `<button class="btn btn-ghost" data-action="abrirCasa" data-id="${casaId}">Ver casa</button>` : ''}
      <button class="btn btn-ghost" data-action="cerrar">Cerrar</button>
    </div>
  </div>`);
}

function modalDeudores() {
  const editor = puedeEditar();
  const lista = db.casas.map(c => ({ c, d: deudaCasa(c.id) })).filter(x => x.d.meses).sort((a, b) => b.d.monto - a.d.monto);
  abrirModal(`
  <div class="form">
    <h3>Casas con adeudo (${lista.length})</h3>
    ${lista.length ? `<ul class="list">${lista.map(({ c, d }) => `<li class="mov clickable" data-action="abrirCasa" data-id="${c.id}">
      <b class="casa-tag">${esc(c.num)}</b><div class="grow">${editor ? (esc(c.propietario) || '<span class="muted">Sin nombre</span>') : ''}<div class="muted small">${d.meses} mes(es)</div></div><b class="negc">${money(d.monto)}</b></li>`).join('')}</ul>` : '<p class="empty">Ninguna casa tiene adeudos registrados. 🎉</p>'}
    <div class="modal-actions"><button class="btn btn-ghost" data-action="cerrar">Cerrar</button></div>
  </div>`);
}

/* ---------- exportar Excel ---------- */
function exportarExcel() {
  const X = XLSX_LITE, S = X.S;
  const H = t => ({ v: t, s: S.header });
  const D = iso => (iso ? { v: X.dateSerial(iso), s: S.date } : '');
  const M = n => (n || n === 0) ? { v: n, s: S.money } : '';
  const casaNum = id => idx.casa[id]?.num ?? '?';
  const prop = id => idx.casa[id]?.propietario ?? '';

  const movs = movimientos();
  const trans = {
    name: 'Transacciones', freezeRow: 1, cols: [12, 10, 8, 22, 44, 16, 13, 13, 14, 30],
    rows: [
      ['Fecha', 'Tipo', 'Casa', 'Propietario', 'Concepto', 'Método / Categoría', 'Ingreso', 'Gasto', 'Saldo', 'Nota'].map(H),
      ['', 'Saldo inicial', '', '', 'Saldo inicial en caja', '', '', '', M(db.config.saldoInicial), ''],
      ...movs.map(m => [
        D(m.fecha), m.tipo,
        m.tipo === 'Ingreso' ? casaNum(m.ref.casaId) : '',
        m.tipo === 'Ingreso' ? prop(m.ref.casaId) : '',
        m.concepto,
        m.ref.metodo || m.ref.categoria || '',
        m.tipo === 'Ingreso' ? M(m.monto) : '',
        m.tipo === 'Gasto' ? M(m.monto) : '',
        M(m.saldo), m.ref.nota || '',
      ]),
      [],
      ['', '', '', '', { v: 'TOTALES', s: S.bold }, '', { v: totIngresos(), s: S.boldMoney }, { v: totGastos(), s: S.boldMoney }, { v: saldo(), s: S.boldMoney }],
    ],
  };

  const pagos = [...db.pagos].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ts - b.ts);
  const hojaPagos = {
    name: 'Pagos', freezeRow: 1, cols: [12, 8, 26, 16, 13, 15, 12, 30],
    rows: [['Fecha pago', 'Casa', 'Propietario', 'Mes que cubre', 'Monto', 'Método', 'En plazo', 'Nota'].map(H),
      ...pagos.map(p => [D(p.fecha), casaNum(p.casaId), prop(p.casaId), periodoTxt(p.periodo), M(p.monto), p.metodo,
        enPlazo(p) ? { v: 'Sí', s: S.ok } : { v: 'No', s: S.warn }, p.nota || ''])],
  };

  const gastos = [...db.gastos].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ts - b.ts);
  const hojaGastos = {
    name: 'Gastos', freezeRow: 1, cols: [12, 44, 18, 13, 30],
    rows: [['Fecha', 'Concepto', 'Categoría', 'Monto', 'Nota'].map(H),
      ...gastos.map(g => [D(g.fecha), g.concepto, g.categoria || '', M(g.monto), g.nota || ''])],
  };

  // Hojas de estado por año
  const anios = new Set([new Date().getFullYear()]);
  db.pagos.forEach(p => anios.add(+p.periodo.slice(0, 4)));
  Object.keys(db.adeudos).forEach(k => anios.add(+k.split('|')[1].slice(0, 4)));
  const estSty = { pagado: S.ok, parcial: S.warn, adeudo: S.bad, pendiente: 0, deshabitada: 0 };
  const hojasEstado = [...anios].sort().map(y => ({
    name: `Estado ${y}`, freezeRow: 1, cols: [8, 26, ...MES_C.map(() => 11), 13, 13],
    rows: [
      ['Casa', 'Propietario', ...MES_C, `Pagado ${y}`, 'Adeudo'].map(H),
      ...db.casas.map(c => {
        let tot = 0, deu = 0;
        const cells = MES_C.map((_, i) => {
          const per = `${y}-${pad(i + 1)}`, e = estado(c.id, per), s = pagadoDe(c.id, per);
          tot += s;
          if (e === 'adeudo') deu += db.config.cuota;
          if (e === 'parcial') deu += db.config.cuota - s;
          const txt = e === 'pagado' ? 'Pagado' : e === 'parcial' ? `Parcial $${s}` : e === 'adeudo' ? 'Adeudo' : e === 'deshabitada' ? 'Deshabitada' : '';
          return { v: txt, s: estSty[e] };
        });
        return [c.num, c.propietario, ...cells, M(tot), M(deu)];
      }),
    ],
  }));

  const deudaTotal = db.casas.reduce((s, c) => s + deudaCasa(c.id).monto, 0);
  const resumen = {
    name: 'Resumen', cols: [32, 20],
    rows: [
      [{ v: db.config.nombre, s: S.title }],
      ['Reporte generado', D(hoy())],
      [],
      ['Cuota mensual por casa', M(db.config.cuota)],
      ['Periodo de cobro', `Del día ${db.config.diaInicioCobro} al día ${db.config.diaLimiteCobro} de cada mes`],
      ['Número de casas', db.casas.length],
      ['Saldo inicial', M(db.config.saldoInicial)],
      ['Total ingresos (cuotas)', M(totIngresos())],
      ['Total gastos', M(totGastos())],
      [{ v: 'Saldo disponible', s: S.bold }, { v: saldo(), s: S.boldMoney }],
      ['Adeudo acumulado de residentes', M(deudaTotal)],
      ['Pagos registrados', db.pagos.length],
      ['Gastos registrados', db.gastos.length],
    ],
  };

  const hojaCasas = {
    name: 'Propietarios', freezeRow: 1, cols: [8, 30, 16, 30, 36, 24, 15, 14],
    rows: [['Casa', 'Propietario', 'Teléfono', 'Correo', 'Notas', 'Ocupación', 'Meses adeudo', 'Adeudo'].map(H),
      ...db.casas.map(c => {
        const d = deudaCasa(c.id), desde = deshabitadaDesde(c);
        return [c.num, c.propietario, c.telefono, c.correo, c.notas, desde ? `Deshabitada desde ${periodoTxt(desde)}` : 'Habitada', d.meses, M(d.monto)];
      })],
  };

  const nombre = `Cuotas_${db.config.nombre.replace(/[^\wáéíóúñÁÉÍÓÚÑ]+/g, '_')}_${hoy()}.xlsx`;
  X.download(nombre, [resumen, trans, hojaPagos, hojaGastos, ...hojasEstado, hojaCasas]);
  toast('Excel generado');
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- sesión de administrador ---------- */
const URL_SCRIPT_OK = /^(https:\/\/script\.google(usercontent)?\.com\/|http:\/\/localhost[:\/])/;

function guardarSesion(url, token, usuario) {
  remoto.url = url; remoto.token = token; remoto.usuario = usuario; remoto.cola = [];
  ls.set(CFG_API, url); ls.set(CFG_TOKEN, token); ls.set(CFG_USER, usuario); ls.set(CFG_COLA, '[]');
}
function olvidarSesion() {
  remoto.token = ''; remoto.usuario = ''; remoto.cola = [];
  ls.del(CFG_TOKEN); ls.del(CFG_USER); ls.set(CFG_COLA, '[]');
}

async function iniciarSesion(url, usuario, clave) {
  url = String(url || '').trim();
  if (!URL_SCRIPT_OK.test(url)) { toast('La URL debe ser la de tu script de Google (script.google.com/…/exec)'); return false; }
  const btn = document.querySelector('#modal form button.btn-primary, #formConexion button.btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
  try {
    let res = await api(url, { accion: 'login', usuario, clave });
    const token = res.token;
    if (!res.data.casas.length) {
      const local = modo() === 'local' ? db : normalizar(JSON.parse(ls.get(KEY) || 'null') || dbInicial());
      if (confirm(`La hoja de Google está vacía.\n¿Subir los datos de este dispositivo (${local.casas.length} casas, ${local.pagos.length} pagos, ${local.gastos.length} gastos)?`)) {
        res = await api(url, { token, ops: [{ tipo: 'todo.reemplazar', db: local }] });
      }
    }
    guardarSesion(url, token, res.usuario || usuario);
    db = normalizar(res.data); guardar();
    remoto.ultima = new Date(); remoto.estado = 'ok';
    cerrarModal(); render();
    toast(`Bienvenido, ${remoto.usuario}. Tienes control total de la aplicación.`);
    return true;
  } catch (e) {
    toast(e.server ? e.message : 'No se pudo conectar. Revisa tu internet.');
    if (btn) { btn.disabled = false; btn.textContent = 'Iniciar sesión'; }
    return false;
  }
}

function modalLogin() {
  if (!remoto.url) { ir('ajustes'); return toast('Primero conecta la app con tu hoja de Google'); }
  abrirModal(`
  <form id="formLogin" class="form">
    <h3>Iniciar sesión · Administrador</h3>
    <p class="muted small">Los invitados no necesitan usuario: pueden consultar todo sin iniciar sesión.</p>
    <label>Usuario<input name="usuario" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
    <label>Contraseña<input name="clave" type="password" required autocomplete="current-password"></label>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-action="cerrar">Cancelar</button>
      <button class="btn btn-primary">Iniciar sesión</button>
    </div>
  </form>`);
  $('#formLogin').usuario.focus();
}

function pintarSesion() {
  const b = $('#btnSesion');
  if (!b) return;
  const m = modo();
  b.hidden = m === 'local';
  b.textContent = m === 'admin' ? `👤 ${remoto.usuario || 'Admin'}` : 'Iniciar sesión';
  b.dataset.action = m === 'admin' ? 'menuSesion' : 'login';
}

/* ---------- eventos ---------- */
const acciones = {
  nuevoPago: el => modalPago(el.dataset.casa),
  nuevoGasto: () => modalGasto(),
  editarGasto: el => modalGasto(el.dataset.id),
  nuevaCasa: () => modalCasa(),
  editarCasa: el => modalCasa(el.dataset.id),
  ocupacion: el => modalOcupacion(el.dataset.id),
  cerrar: cerrarModal,
  abrirCasa: el => { cerrarModal(); ui.casaId = el.dataset.id; ir('casa'); },
  volver: () => ir('casas'),
  filtro: el => { ui.filtro = el.dataset.f; render(); },
  mesCasas: el => {
    let [y, m] = ui.mesCasas.split('-').map(Number);
    m += +el.dataset.d;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    ui.mesCasas = `${y}-${pad(m)}`; render();
  },
  mes: el => modalMes(ui.casaId, el.dataset.per),
  mesCasa: el => modalMes(el.dataset.id, el.dataset.per),
  pagoMes: el => modalPago(el.dataset.id, el.dataset.per),
  verDeudores: modalDeudores,
  exportar: exportarExcel,
  reintentar: () => sincronizar(),
  sincronizar: () => sincronizar(),
  cambiarMiCasa: () => { ls.del(CFG_MICASA); ir('inicio'); },
  toggleAdeudo: el => {
    const casaId = el.dataset.id, periodo = el.dataset.per;
    const poner = !db.adeudos[casaId + '|' + periodo];
    if (!ejecutar([{ tipo: poner ? 'adeudo.poner' : 'adeudo.quitar', casaId, periodo }])) return;
    cerrarModal(); render();
    toast(poner ? 'Marcado como adeudo' : 'Adeudo eliminado');
  },
  marcarAdeudosMes: el => {
    const periodo = el.dataset.per;
    const pend = db.casas.filter(c => estado(c.id, periodo) === 'pendiente');
    if (!confirm(`¿Marcar ${pend.length} casas sin pago como adeudo en ${periodoTxt(periodo)}?`)) return;
    if (!ejecutar(pend.map(c => ({ tipo: 'adeudo.poner', casaId: c.id, periodo })))) return;
    render(); toast(`${pend.length} casas marcadas con adeudo`);
  },
  borrarPago: el => {
    const p = db.pagos.find(x => x.id === el.dataset.id);
    if (!p || !confirm(`¿Eliminar el pago de ${money(p.monto)} (Casa ${idx.casa[p.casaId]?.num}, ${periodoTxt(p.periodo)})?`)) return;
    if (!ejecutar([{ tipo: 'pago.borrar', id: p.id }])) return;
    cerrarModal(); render(); toast('Pago eliminado');
  },
  borrarGasto: el => {
    const g = db.gastos.find(x => x.id === el.dataset.id);
    if (!g || !confirm(`¿Eliminar el gasto "${g.concepto}" de ${money(g.monto)}?`)) return;
    if (!ejecutar([{ tipo: 'gasto.borrar', id: g.id }])) return;
    cerrarModal(); render(); toast('Gasto eliminado');
  },
  borrarCasa: el => {
    const c = idx.casa[el.dataset.id];
    const n = db.pagos.filter(p => p.casaId === c.id).length;
    if (!confirm(`¿Eliminar la casa ${c.num}?${n ? `\nTambién se eliminarán sus ${n} pagos.` : ''}`)) return;
    if (!ejecutar([{ tipo: 'casa.borrar', id: c.id }])) return;
    cerrarModal(); ir('casas'); toast('Casa eliminada');
  },
  respaldo: () => descargar(`respaldo_cuotas_${hoy()}.json`, JSON.stringify(db, null, 1), 'application/json'),
  borrarTodo: () => {
    if (!confirm('Se borrarán TODOS los pagos, gastos y casas y se restaurará el catálogo original. ¿Continuar?')) return;
    if (prompt('Escribe BORRAR para confirmar') !== 'BORRAR') return;
    db = dbInicial(); guardar(); ir('inicio'); toast('Datos reiniciados');
  },
  compartirEnlace: async () => {
    const url = enlaceVecinos();
    const texto = `Consulta el estado de las cuotas de mantenimiento de ${db.config.nombre} (solo consulta, no necesitas usuario):`;
    if (navigator.share) { try { await navigator.share({ title: db.config.nombre, text: texto, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { prompt('Copia este enlace:', url); }
  },
  descartarCola: () => {
    if (!confirm(`¿Descartar ${remoto.cola.length} cambio(s) que no se han enviado a Google Sheets?`)) return;
    remoto.cola = []; ls.set(CFG_COLA, '[]'); sincronizar(); toast('Cambios descartados');
  },
  login: () => modalLogin(),
  menuSesion: () => abrirModal(`<div class="form">
    <h3>Sesión de administrador</h3>
    <p>Conectado como <b>${esc(remoto.usuario)}</b>. Tienes control total: registrar, modificar y eliminar.</p>
    <div class="stack">
      <button class="btn btn-ghost" data-action="irAjustes">Ajustes y enlace para vecinos</button>
      <button class="btn btn-danger-soft" data-action="cerrarSesion">Cerrar sesión</button>
      <button class="btn btn-ghost" data-action="cerrar">Volver</button>
    </div></div>`),
  irAjustes: () => { cerrarModal(); ir('ajustes'); },
  cerrarSesion: () => {
    if (remoto.cola.length && !confirm('Hay cambios sin enviar a Google que se perderán. ¿Cerrar sesión de todos modos?')) return;
    const token = remoto.token;
    if (token) api(remoto.url, { accion: 'logout', token }).catch(() => {});
    olvidarSesion(); cerrarModal();
    ir('inicio'); sincronizar(); toast('Sesión cerrada. Ahora estás como invitado.');
  },
  desconectar: () => {
    if (!confirm('Este dispositivo dejará de usar Google Sheets y volverá a sus datos locales. Los datos en Google no se borran. ¿Continuar?')) return;
    if (remoto.token) api(remoto.url, { accion: 'logout', token: remoto.token }).catch(() => {});
    olvidarSesion(); remoto.url = '';
    [CFG_API, KEY_CACHE].forEach(ls.del);
    db = cargarDb(); reindex(); ir('inicio'); toast('Desconectado');
  },
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) return ir(t.dataset.tab);
  const a = e.target.closest('[data-action]');
  if (a && acciones[a.dataset.action]) { e.preventDefault(); e.stopPropagation(); acciones[a.dataset.action](a); }
});

document.addEventListener('input', e => {
  if (e.target.name === 'diaInicioCobro' || e.target.name === 'diaLimiteCobro') {
    const f = e.target.form;
    $('#ejemploCobro').textContent = ejemploCobro(f.diaInicioCobro.value, f.diaLimiteCobro.value);
  }
  const k = e.target.dataset.input;
  if (k) { ui[k] = e.target.value; render(); }
});

document.addEventListener('change', e => {
  const k = e.target.dataset.change;
  if (k === 'anio') { ui.anio = +e.target.value; render(); }
  if (k === 'mesInicio' && e.target.value) { ui.mesInicio = e.target.value; render(); }
  if (k === 'mesCasas' && e.target.value) { ui.mesCasas = e.target.value; render(); }
  if (k === 'miCasa' && e.target.value) { ls.set(CFG_MICASA, e.target.value); render(); }
  if (k === 'restaurar') {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then(txt => {
      const d = JSON.parse(txt);
      if (!d.config || !Array.isArray(d.casas) || !Array.isArray(d.pagos) || !Array.isArray(d.gastos)) throw new Error();
      const dest = modo() === 'admin' ? ' en Google Sheets' : '';
      if (!confirm(`¿Restaurar respaldo con ${d.casas.length} casas, ${d.pagos.length} pagos y ${d.gastos.length} gastos? Se reemplazarán los datos actuales${dest}.`)) return;
      if (ejecutar([{ tipo: 'todo.reemplazar', db: normalizar(d) }])) { ir('inicio'); toast('Respaldo restaurado'); }
    }).catch(() => toast('Archivo de respaldo inválido'));
    e.target.value = '';
  }
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.id === 'formConfig') {
    e.preventDefault();
    const config = { ...db.config, nombre: f.nombre.value.trim() || 'Fraccionamiento', cuota: num(f.cuota.value), saldoInicial: num(f.saldoInicial.value),
      diaInicioCobro: parseInt(f.diaInicioCobro.value), diaLimiteCobro: parseInt(f.diaLimiteCobro.value) };
    if (ejecutar([{ tipo: 'config.guardar', config }])) { render(); toast('Configuración guardada'); }
  }
  if (f.id === 'formConexion') { e.preventDefault(); iniciarSesion(f.url.value, f.usuario.value, f.clave.value); }
  if (f.id === 'formLogin') { e.preventDefault(); iniciarSesion(remoto.url, f.usuario.value, f.clave.value); }
});

/* ---------- actualización automática ---------- */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });
window.addEventListener('online', () => sincronizar());
setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 60000);

/* ---------- instalación (PWA) ---------- */
let promptInstalar = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalar = e; $('#btnInstalar').hidden = false; });
$('#btnInstalar').addEventListener('click', async () => {
  if (!promptInstalar) return;
  promptInstalar.prompt();
  await promptInstalar.userChoice;
  promptInstalar = null; $('#btnInstalar').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#btnInstalar').hidden = true; toast('App instalada'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

render();
sincronizar();
