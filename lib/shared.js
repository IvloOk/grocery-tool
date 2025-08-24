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
