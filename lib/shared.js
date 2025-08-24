// Shared helpers + state used by BOTH pages (receipts & summarizer)
window.Shared = (() => {
  const state = { rows: [], keys: new Set() };

  // tiny DOM helpers
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);

  // formatting
  const fmtMoney = (n) => n==null || Number.isNaN(+n) ? '' : (+n).toFixed(2);

  // CSV — parser + exporter (same as receipts page)
  const parseCSV = (text) => {
    const rows = [];
    let row = [], field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (inQuotes && text[i+1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (c === ',' && !inQuotes) {
        row.push(field); field = '';
      } else if (c === '\n' && !inQuotes) {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
    row.push(field);
    if (row.length) rows.push(row);
    return rows;
  };

  const toCSV = (rows, headers) => {
    const esc = (v)=> {
      const s = v==null ? '' : String(v);
      return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
    };
    const head = headers.map(esc).join(',');
    const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
    return head + '\n' + body;
  };

  const download = (name, text, type='text/plain') => {
    const blob = new Blob([text], {type});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {href:url, download:name});
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 250);
  };

  // date helpers for stable sorting
  const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  function dateKey(s){
    if(!s) return Number.POSITIVE_INFINITY;
    const n = String(s).replace(/\./g,'').trim();
    const d1 = new Date(n);
    if(!Number.isNaN(d1)) return d1.getTime();
    const m = n.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/);
    if(m){ const mon = m[1].slice(0,3).toLowerCase(); const month = MONTHS[mon]; if(month!=null) return new Date(+m[3], month, +m[2]).getTime(); }
    const iso = n.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return new Date(+iso[1], +iso[2]-1, +iso[3]).getTime();
    return Number.POSITIVE_INFINITY;
  }
  function sortRowsByDateAsc(){ state.rows.sort((a,b)=> dateKey(a.Date) - dateKey(b.Date)); }

  // identity & table ops
  const makeKey = (r) => [r.Date, r.Item, r.UPC, r.Quantity, r['Total Price']].join('|');

  function upsertRows(rows){
    let added = 0;
    for (const r of rows){
      const key = makeKey(r);
      if (!state.keys.has(key)) { state.keys.add(key); state.rows.push(r); added++; }
    }
    return added;
  }

  function renderTable(containerId='tableContainer'){
    sortRowsByDateAsc();
    const cont = byId(containerId);
    const hasRows = state.rows.length > 0;
    cont.style.display = hasRows ? 'block' : 'none';
    if(!hasRows){ cont.innerHTML = ''; byId('rowCount') && (byId('rowCount').textContent = '0 items'); return; }

    const headers = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    headers.forEach(h=>{ const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
    thead.appendChild(trh);

    const tbody = document.createElement('tbody');
    state.rows.forEach(r=>{
      const tr = document.createElement('tr');
      headers.forEach(h=>{
        const td = document.createElement('td');
        let val = r[h];
        if(h==='Unit Price' || h==='Total Price') td.classList.add('num');
        if(h==='Unit Price' || h==='Total Price') val = fmtMoney(val);
        td.textContent = val;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    cont.innerHTML = '';
    cont.appendChild(table);
    byId('rowCount') && (byId('rowCount').textContent = state.rows.length + (state.rows.length===1 ? ' item' : ' items'));
  }

  return { state, $, $$, byId, fmtMoney, parseCSV, toCSV, download, upsertRows, renderTable };
})();

// --- Store-aware key mapping (future-proof) ---
window.Shared = window.Shared || {};
window.Shared.STORE_KEY_MATRIX = {
  Kroger: ['UPC'],
  // BJs: ['ItemNumber','UPC'],
  // Costco: ['ItemNumber'],
};

window.Shared.detectStore = function detectStore(headers, sampleRow) {
  const hasStore = headers.includes('Store');
  return hasStore ? (sampleRow?.Store || 'Kroger') : 'Kroger';
};

window.Shared.keyForRow = function keyForRow(row, storeName = 'Kroger') {
  const prefs = (window.Shared.STORE_KEY_MATRIX[storeName] || ['UPC']);
  for (const field of prefs) {
    const v = row[field];
    if (v != null && String(v).trim() !== '') return `${field}:${String(v).trim()}`;
  }
  return `NO-KEY:${(row.Item || '').slice(0, 80)}`;
};

// --- Date/qty helpers ---
const MS_PER_DAY = 24*60*60*1000;

window.Shared.parseDateSafe = function parseDateSafe(s) {
  if (!s) return NaN;
  const n = String(s).replace(/\./g,'').trim();  // "Aug. 23, 2025" → "Aug 23, 2025"
  const d = new Date(n);
  if (!Number.isNaN(+d)) return +d;
  const m = n.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/);
  if (m) {
    const mn = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const mi = mn.indexOf(m[1].slice(0,3).toLowerCase());
    if (mi >= 0) return +new Date(+m[3], mi, +m[2]);
  }
  const iso = n.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return +new Date(+iso[1], +iso[2]-1, +iso[3]);
  return NaN;
};

window.Shared.formatDateYMD = function formatDateYMD(ts) {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

window.Shared.qtyToNumber = function qtyToNumber(q) {
  if (q == null) return 1;
  const m = String(q).match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return 1;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : 1;
};

// --- Generic renderer for arbitrary column sets ---
window.Shared.renderTableCustom = function renderTableCustom(containerId, headers, rows, numericCols = []) {
  const cont = window.Shared.byId ? window.Shared.byId(containerId) : document.getElementById(containerId);
  const hasRows = rows && rows.length > 0;
  cont.style.display = hasRows ? 'block' : 'none';
  cont.innerHTML = '';
  if (!hasRows) return;

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh);

  const tbody = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    headers.forEach(h => {
      const td = document.createElement('td');
      let val = r[h];
      if (numericCols.includes(h)) {
        td.classList.add('num');
        if (/price|spent/i.test(h)) {
          val = window.Shared.fmtMoney ? window.Shared.fmtMoney(val) : (Number.isFinite(val) ? val.toFixed(2) : '');
        } else if (typeof val === 'number' && Number.isFinite(val)) {
          val = String(val);
        }
      }
      td.textContent = val == null ? '' : val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  cont.appendChild(table);
};

// --- Summarize by store-aware key (e.g., UPC for Kroger) ---
window.Shared.summarizeByKey = function summarizeByKey(rows, storeName = 'Kroger') {
  let firstTS = Infinity, lastTS = -Infinity;

  const parsed = rows.map(r => {
    const ts = window.Shared.parseDateSafe(r.Date);
    if (Number.isFinite(ts)) { if (ts < firstTS) firstTS = ts; if (ts > lastTS) lastTS = ts; }
    const qtyNum = window.Shared.qtyToNumber(r.Quantity);
    const up = (r['Unit Price'] == null || Number.isNaN(+r['Unit Price'])) ? null : +r['Unit Price'];
    const tp = (r['Total Price'] == null || Number.isNaN(+r['Total Price'])) ? (up != null ? up * qtyNum : null) : +r['Total Price'];
    return { row: r, ts, qtyNum, totalPrice: tp };
  });

  const daysSpan = (Number.isFinite(firstTS) && Number.isFinite(lastTS))
    ? Math.max(1, Math.round((lastTS - firstTS) / MS_PER_DAY))
    : 1;

  const groups = new Map();
  for (const p of parsed) {
    const key = window.Shared.keyForRow(p.row, storeName);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        Item: p.row.Item || '',
        KeyField: key.split(':',1)[0],
        KeyValue: key.includes(':') ? key.slice(key.indexOf(':')+1) : '',
        firstTS: Number.isFinite(p.ts) ? p.ts : Infinity,
        lastTS:  Number.isFinite(p.ts) ? p.ts : -Infinity,
        purchases: 0,
        qtySum: 0,
        spentSum: 0
      };
      groups.set(key, g);
    }
    g.purchases += 1;
    if (Number.isFinite(p.ts)) { if (p.ts < g.firstTS) g.firstTS = p.ts; if (p.ts > g.lastTS) g.lastTS = p.ts; }
    g.qtySum += Number.isFinite(p.qtyNum) ? p.qtyNum : 1;
    if (Number.isFinite(p.totalPrice)) g.spentSum += p.totalPrice;
  }

  const summary = [];
  for (const g of groups.values()) {
    const avgUnitPrice = g.qtySum > 0 ? (g.spentSum / g.qtySum) : null;
    const estDaysPerUnit = g.qtySum > 0 ? (daysSpan / g.qtySum) : null;
    summary.push({
      [g.KeyField]: g.KeyValue,
      Item: g.Item,
      'First Date': Number.isFinite(g.firstTS) ? window.Shared.formatDateYMD(g.firstTS) : '',
      'Last Date':  Number.isFinite(g.lastTS)  ? window.Shared.formatDateYMD(g.lastTS)  : '',
      Purchases: g.purchases,
      'Total Qty': Number.isFinite(g.qtySum) ? +g.qtySum.toFixed(2) : '',
      'Avg Unit Price ($/unit)': (avgUnitPrice != null && Number.isFinite(avgUnitPrice)) ? +avgUnitPrice.toFixed(2) : '',
      'Total Spent': (g.spentSum != null && Number.isFinite(g.spentSum)) ? +g.spentSum.toFixed(2) : '',
      'Est. Days / Unit': (estDaysPerUnit != null && Number.isFinite(estDaysPerUnit)) ? +estDaysPerUnit.toFixed(1) : ''
    });
  }

  summary.sort((a,b) => String(a.Item||'').localeCompare(String(b.Item||'')));

  return {
    summary,
    firstTS: Number.isFinite(firstTS) ? firstTS : NaN,
    lastTS:  Number.isFinite(lastTS)  ? lastTS  : NaN,
    daysSpan
  };
};

