  const state = { rows: [], keys: new Set() };
  const $ = (sel,root=document)=>root.querySelector(sel);
  const $$ = (sel,root=document)=>Array.from(root.querySelectorAll(sel));
  const byId = id => document.getElementById(id);

  const fmtMoney = (n)=> n==null||Number.isNaN(+n) ? '' : (+n).toFixed(2);
  const toCSV = (rows, headers) => {
    const esc = (v)=>{ const s = v==null ? '' : String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
    const head = headers.map(esc).join(',');
    const body = rows.map(r=> headers.map(h=> esc(r[h])).join(',')).join('\n');
    return head + '\n' + body;
  };
  const download = (name, text, type='text/plain') => {
    const blob = new Blob([text], {type});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {href:url, download:name});
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 250);
  };

  // CSV parser (handles quoted fields/commas/newlines)
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

  // --- Date parsing & sorting ---
  const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  function dateKey(s){
    if(!s) return Number.POSITIVE_INFINITY;
    const n = String(s).replace(/\./g,'').trim(); // normalize 'Aug.' -> 'Aug'
    const d1 = new Date(n);
    if(!Number.isNaN(d1)) return d1.getTime();
    const m = n.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/);
    if(m){ const mon = m[1].slice(0,3).toLowerCase(); const month = MONTHS[mon]; if(month!=null) return new Date(+m[3], month, +m[2]).getTime(); }
    const iso = n.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return new Date(+iso[1], +iso[2]-1, +iso[3]).getTime();
    return Number.POSITIVE_INFINITY;
  }
  function sortRowsByDateAsc(){ state.rows.sort((a,b)=> dateKey(a.Date) - dateKey(b.Date)); }

  function parseKrogerHTML(htmlStr){
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlStr, 'text/html');

    // Date (e.g., "Order Date: Aug. 23, 2025")
    let orderDate = 'Unknown';
    const allText = (doc.body.textContent || '').replace(/\s+/g,' ').trim();
    const mDate = allText.match(/Order Date:\s*([A-Za-z]{3,9}\.?\s*\d{1,2},?\s*\d{4})/);
    if (mDate) orderDate = mDate[1].trim();

    // Each item lives in a .mt-8.mb-4 block
    const blocks = $$('div.mt-8.mb-4', doc);
    const out = [];

    for(const block of blocks){
      const nameEl = $('.kds-Text--m.kds-Text--bold', block);
      if(!nameEl) continue;
      const itemName = nameEl.textContent.trim();

      // Total (right side of the header row)
      let totalPrice = null;
      const headerRow = $('.flex.justify-between.items-center, .flex.justify-between', block) || block;
      const spanTexts = $$('span', headerRow).map(s=>s.textContent.trim());
      for(let i=spanTexts.length-1;i>=0;i--){
        const m = spanTexts[i].match(/\$([0-9]+(?:\.[0-9]{2})?)/);
        if(m){ totalPrice = parseFloat(m[1]); break; }
      }
      if(totalPrice==null){
        const any = block.textContent.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
        if(any) totalPrice = parseFloat(any[1]);
      }
      if(totalPrice==null) continue;

      // Quantity + unit (handles "2 x $3.79" and "2.31 lbs x $1.77")
      let quantityRaw = '1';
      let unitPrice = totalPrice;
      const qtyCandidates = $$('.ml-12.mt-4, .ml-12.mt-4 span', block).map(e=>e.textContent.trim());
      for(const t of qtyCandidates){
        const qm = t.match(/([0-9.]+\s*(?:lbs|lb)?)\s*x\s*\$([0-9]+\.[0-9]{2})/i);
        if(qm){
          quantityRaw = qm[1].replace(/\blb\b/i,'lbs').trim();
          unitPrice = parseFloat(qm[2]);
          break;
        }
      }

      // Coupon flag
      const couponUsed = /Item\s+Coupon\/Sale/i.test(block.textContent);

      // UPC
      let upc = '';
      const upcEl = $$('.ml-12.mt-4, *', block).find(e => /^UPC:\s*\d+/.test((e.textContent||'').trim()));
      if(upcEl){ const um = upcEl.textContent.match(/UPC:\s*([0-9]+)/); if(um) upc = um[1]; }

      out.push({
        'Item': itemName,
        'Date': orderDate,
        'Unit Price': unitPrice,
        'Quantity': quantityRaw,
        'Total Price': totalPrice,
        'Coupon Used': couponUsed ? 'Yes' : 'No',
        'UPC': upc
      });
    }

    return { rows: out, orderDate };
  }

  function makeKey(r){ return [r.Date, r.Item, r.UPC, r.Quantity, r['Total Price']].join('|'); }
  function upsertRows(rows){
    let added = 0;
    for(const r of rows){
      const key = makeKey(r);
      if(!state.keys.has(key)){ state.keys.add(key); state.rows.push(r); added++; }
    }
    return added;
  }

  function renderTable(){
    sortRowsByDateAsc();
    const cont = byId('tableContainer');
    const hasRows = state.rows.length > 0;
    cont.style.display = hasRows ? 'block' : 'none';
    if(!hasRows){ cont.innerHTML = ''; byId('rowCount').textContent = '0 items'; return; }

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
    byId('rowCount').textContent = state.rows.length + (state.rows.length===1 ? ' item' : ' items');
  }

  // --- Event handlers ---
  byId('btnProcess').addEventListener('click', () => {
    const ta = byId('htmlInput');
    const html = ta.value.trim();
    if(!html){ byId('status').textContent = 'Paste some HTML first.'; return; }
    ta.value = '';
    const t0 = performance.now();
    const { rows, orderDate } = parseKrogerHTML(html);
    const added = upsertRows(rows);
    renderTable();
    const t1 = performance.now();
    byId('status').textContent = rows.length
      ? `Parsed ${rows.length} item blocks for order dated ${orderDate}; ${added} new rows added in ${(t1-t0).toFixed(1)} ms.`
      : 'No items found — make sure you pasted the correct receipt HTML.';
  });

  byId('btnExportCSV').addEventListener('click', ()=>{
    if(!state.rows.length) return;
    const headers = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];
    const csv = toCSV(state.rows, headers);
    download('kroger_items.csv', csv, 'text/csv');
  });

  // Import CSV (upsert)
  const fileCSV = byId('fileCSV');
  byId('btnImportCSV').addEventListener('click', ()=> fileCSV && fileCSV.click());
  if (fileCSV) {
    fileCSV.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const text = await f.text();
      const matrix = parseCSV(text);
      if (!matrix.length) { byId('status').textContent = 'CSV appears empty.'; return; }

      const headers = matrix[0].map(h => (h||'').trim());
      const need = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];
      const missing = need.filter(h => !headers.includes(h));
      if (missing.length) { byId('status').textContent = 'CSV missing headers: ' + missing.join(', '); return; }

      const idx = h => headers.indexOf(h);
      const toNum = v => { const s = String(v||'').replace(/[^0-9.]/g,''); const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
      const rows = [];
      for (let i = 1; i < matrix.length; i++) {
        const r = matrix[i];
        if (!r || r.length === 0 || (r.length === 1 && r[0] === '')) continue;
        const get = (h) => r[idx(h)] ?? '';
        rows.push({
          'Item': get('Item'),
          'Date': get('Date'),
          'Unit Price': toNum(get('Unit Price')),
          'Quantity': get('Quantity'),
          'Total Price': toNum(get('Total Price')),
          'Coupon Used': /^(yes|true|1)$/i.test(get('Coupon Used')) ? 'Yes' : 'No',
          'UPC': get('UPC')
        });
      }
      const added = upsertRows(rows);
      renderTable();
      byId('status').textContent = `Imported ${rows.length} row(s); ${added} new row(s) added.`;
      fileCSV.value = '';
    });
  }

  // Clear
  byId('btnClear').addEventListener('click', ()=>{
    state.rows.length = 0; state.keys.clear();
    renderTable();
    byId('status').textContent = 'Cleared.';
  });

  // Back-to-top wiring after DOM loaded
  window.addEventListener('load', () => {
    const btnTop = byId('btnTop');
    if(!btnTop) return;
    const toggle = () => { if (window.scrollY > 200) btnTop.classList.add('show'); else btnTop.classList.remove('show'); };
    window.addEventListener('scroll', toggle, {passive:true});
    toggle();
    btnTop.addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));
  });