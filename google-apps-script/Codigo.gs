/**
 * Servidor de "Cuotas Fraccionamiento" sobre Google Sheets.
 *
 * Instalación (una sola vez):
 *  1. Crea una hoja de cálculo nueva en Google Drive (ej. "Cuotas Capulac").
 *  2. Menú Extensiones → Apps Script. Borra lo que haya y pega TODO este archivo. Guarda.
 *  3. Recarga la hoja de cálculo: aparecerá el menú "Cuotas". Usa
 *     Cuotas → "Establecer clave de administrador" (pedirá permisos la primera vez).
 *  4. En Apps Script: Implementar → Nueva implementación → tipo "Aplicación web".
 *       Ejecutar como: Yo    ·    Quién tiene acceso: Cualquier persona
 *     Copia la URL que termina en /exec y pégala en la app (Ajustes → Google Sheets).
 *
 * Los residentes solo pueden LEER datos públicos (sin nombres ni teléfonos).
 * Para escribir se requiere la clave de administrador.
 */

const ESQUEMA = {
  Config: ['clave', 'valor'],
  Casas: ['id', 'num', 'propietario', 'telefono', 'notas', 'correo'],
  Pagos: ['id', 'casaId', 'casa', 'periodo', 'monto', 'fecha', 'metodo', 'nota', 'ts'],
  Gastos: ['id', 'concepto', 'categoria', 'monto', 'fecha', 'nota', 'ts'],
  Adeudos: ['id', 'casaId', 'casa', 'periodo'],
};
const NUMERICOS = ['monto', 'ts'];
const CONFIG_BASE = { nombre: 'Fraccionamiento', cuota: 100, saldoInicial: 0, diaInicioCobro: 30, diaLimiteCobro: 3 };

/* ---------- web app ---------- */
function doGet() {
  return responder(() => datos(false));
}

function doPost(e) {
  return responder(() => {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!esAdmin(body.key)) {
      Utilities.sleep(1200); // frena intentos de adivinar la clave
      return { ok: false, auth: true, error: 'Clave de administrador incorrecta' };
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      cacheCasas = null;
      (body.ops || []).forEach(aplicar);
      return datos(true);
    } finally {
      lock.releaseLock();
    }
  });
}

function responder(fn) {
  let out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function esAdmin(key) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!real && typeof key === 'string' && key === real;
}

/* ---------- lectura ---------- */
function datos(admin) {
  const config = Object.assign({}, CONFIG_BASE);
  leer('Config').forEach(r => {
    if (!(r.clave in CONFIG_BASE)) return;
    config[r.clave] = typeof CONFIG_BASE[r.clave] === 'number' ? Number(r.valor) || 0 : String(r.valor);
  });
  let casas = leer('Casas');
  let pagos = leer('Pagos').map(p => { delete p.casa; return p; });
  if (!admin) {
    casas = casas.map(c => ({ id: c.id, num: c.num, propietario: '', telefono: '', notas: '', correo: '' }));
    pagos = pagos.map(p => ({ id: p.id, casaId: p.casaId, periodo: p.periodo, monto: p.monto, fecha: p.fecha, ts: p.ts, metodo: '', nota: '' }));
  }
  const adeudos = {};
  leer('Adeudos').forEach(a => { adeudos[a.casaId + '|' + a.periodo] = true; });
  return { ok: true, admin: admin, actualizado: new Date().toISOString(),
    data: { config: config, casas: casas, pagos: pagos, gastos: leer('Gastos'), adeudos: adeudos } };
}

function hoja(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre);
    const cab = ESQUEMA[nombre];
    h.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    h.setFrozenRows(1);
    const iMonto = cab.indexOf('monto');
    if (iMonto >= 0) h.getRange(2, iMonto + 1, Math.max(h.getMaxRows() - 1, 1), 1).setNumberFormat('$#,##0.00');
  } else if (!hoja.revisadas[nombre]) {
    // hojas creadas con una versión anterior: agrega encabezados de columnas nuevas
    const cab = ESQUEMA[nombre];
    const actual = h.getRange(1, 1, 1, cab.length).getValues()[0];
    if (actual.some((v, i) => String(v) !== cab[i])) h.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
  }
  hoja.revisadas[nombre] = true;
  return h;
}

hoja.revisadas = {};

function leer(nombre) {
  const h = hoja(nombre);
  const cab = ESQUEMA[nombre];
  const n = h.getLastRow();
  if (n < 2) return [];
  const tz = Session.getScriptTimeZone();
  return h.getRange(2, 1, n - 1, cab.length).getValues()
    .filter(r => r[0] !== '' && r[0] !== null)
    .map(r => {
      const o = {};
      cab.forEach((c, i) => {
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, c === 'periodo' || c === 'valor' ? 'yyyy-MM' : 'yyyy-MM-dd');
        o[c] = NUMERICOS.indexOf(c) >= 0 ? Number(v) || 0 : String(v === null || v === undefined ? '' : v);
      });
      return o;
    });
}

/* ---------- escritura ---------- */
let cacheCasas = null;
function numCasa(id) {
  if (!cacheCasas) { cacheCasas = {}; leer('Casas').forEach(c => { cacheCasas[c.id] = c.num; }); }
  return cacheCasas[id] || '';
}

// El apóstrofo obliga a Sheets a guardar texto tal cual (evita que "2026-10" se vuelva fecha o que "=..." sea fórmula).
function celda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  return s === '' ? '' : "'" + s;
}

function fila(nombre, obj) { return ESQUEMA[nombre].map(c => celda(obj[c])); }

function buscarFila(h, id) {
  const n = h.getLastRow();
  if (n < 2) return 0;
  const ids = h.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function guardarFila(nombre, obj) {
  if (!obj || !obj.id) throw new Error('Registro sin id en ' + nombre);
  const h = hoja(nombre);
  const r = buscarFila(h, obj.id);
  if (r) h.getRange(r, 1, 1, ESQUEMA[nombre].length).setValues([fila(nombre, obj)]);
  else h.appendRow(fila(nombre, obj));
}

function borrarFila(nombre, id) {
  const h = hoja(nombre);
  const r = buscarFila(h, id);
  if (r) h.deleteRow(r);
}

function borrarDonde(nombre, campo, valor) {
  const h = hoja(nombre);
  const n = h.getLastRow();
  if (n < 2) return;
  const col = ESQUEMA[nombre].indexOf(campo) + 1;
  const vals = h.getRange(2, col, n - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]) === String(valor)) h.deleteRow(i + 2);
}

function reescribir(nombre, objetos) {
  const h = hoja(nombre);
  const cab = ESQUEMA[nombre];
  const n = h.getLastRow();
  if (n > 1) h.getRange(2, 1, n - 1, cab.length).clearContent();
  if (!objetos.length) return;
  const falta = objetos.length + 1 - h.getMaxRows();
  if (falta > 0) h.insertRowsAfter(h.getMaxRows(), falta);
  h.getRange(2, 1, objetos.length, cab.length).setValues(objetos.map(o => fila(nombre, o)));
}

function guardarConfig(cfg) {
  const c = Object.assign({}, CONFIG_BASE, cfg || {});
  reescribir('Config', Object.keys(CONFIG_BASE).map(k => ({ clave: k, valor: c[k] })));
}

// Actualiza la columna informativa "casa" cuando cambia el número de una casa
function renombrarCasa(nombre, casaId, num) {
  const h = hoja(nombre);
  const n = h.getLastRow();
  if (n < 2) return;
  const cab = ESQUEMA[nombre];
  const iId = cab.indexOf('casaId') + 1, iCasa = cab.indexOf('casa') + 1;
  const ids = h.getRange(2, iId, n - 1, 1).getValues();
  const col = h.getRange(2, iCasa, n - 1, 1);
  const vals = col.getValues();
  let cambio = false;
  ids.forEach((r, i) => { if (String(r[0]) === casaId && String(vals[i][0]) !== num) { vals[i][0] = celda(num); cambio = true; } });
  if (cambio) col.setValues(vals);
}

function aplicar(op) {
  switch (op.tipo) {
    case 'pago.guardar': {
      const p = Object.assign({}, op.pago, { casa: numCasa(op.pago.casaId) });
      guardarFila('Pagos', p);
      borrarFila('Adeudos', p.casaId + '|' + p.periodo);
      return;
    }
    case 'pago.borrar': return borrarFila('Pagos', op.id);
    case 'gasto.guardar': return guardarFila('Gastos', op.gasto);
    case 'gasto.borrar': return borrarFila('Gastos', op.id);
    case 'casa.guardar': {
      guardarFila('Casas', op.casa);
      if (cacheCasas) cacheCasas[op.casa.id] = op.casa.num;
      renombrarCasa('Pagos', op.casa.id, op.casa.num);
      renombrarCasa('Adeudos', op.casa.id, op.casa.num);
      return;
    }
    case 'casa.borrar':
      borrarFila('Casas', op.id);
      borrarDonde('Pagos', 'casaId', op.id);
      borrarDonde('Adeudos', 'casaId', op.id);
      return;
    case 'adeudo.poner':
      return guardarFila('Adeudos', { id: op.casaId + '|' + op.periodo, casaId: op.casaId, casa: numCasa(op.casaId), periodo: op.periodo });
    case 'adeudo.quitar':
      return borrarFila('Adeudos', op.casaId + '|' + op.periodo);
    case 'config.guardar':
      return guardarConfig(op.config);
    case 'todo.reemplazar': {
      const d = op.db;
      const nums = {};
      d.casas.forEach(c => { nums[c.id] = c.num; });
      guardarConfig(d.config);
      reescribir('Casas', d.casas);
      reescribir('Pagos', d.pagos.map(p => Object.assign({}, p, { casa: nums[p.casaId] || '' })));
      reescribir('Gastos', d.gastos);
      reescribir('Adeudos', Object.keys(d.adeudos || {}).map(k => {
        const [casaId, periodo] = k.split('|');
        return { id: k, casaId: casaId, casa: nums[casaId] || '', periodo: periodo };
      }));
      cacheCasas = nums;
      return;
    }
    default:
      throw new Error('Operación desconocida: ' + op.tipo);
  }
}

/* ---------- menú en la hoja ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Cuotas')
    .addItem('Establecer clave de administrador', 'establecerClave')
    .addItem('Preparar hojas', 'prepararHojas')
    .addToUi();
}

function establecerClave() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Clave de administrador',
    'Escribe una clave de al menos 8 caracteres. Se usará en la app para registrar pagos y gastos.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = r.getResponseText().trim();
  if (k.length < 8) return ui.alert('La clave debe tener al menos 8 caracteres.');
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', k);
  prepararHojas();
  ui.alert('Clave guardada. Ahora implementa el script como "Aplicación web" (ver instrucciones al inicio del código).');
}

function prepararHojas() {
  Object.keys(ESQUEMA).forEach(hoja);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
}
