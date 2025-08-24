// Needs Shared loaded first
const { $, $$, byId, parseCSV, toCSV, download, upsertRows, renderTable } = window.Shared;

function parseKrogerHTML(htmlStr){
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlStr, 'text/html');

  // Date (e.g., "Order Date: Aug. 23, 2025")
  let orderDate = 'Unknown';
  const allText = (doc.body.textContent || '').replace(/\s+/g,' ').trim();
  const mDate = allText.match(/Order Date:\s*([A-Za-z]{3,9}\.?\s*\d{1,2},?\s*\d{4})/);
  if (mDate) orderDate = mDate[1].trim();

  const blocks = $$('div.mt-8.mb-4', doc);
  const out = [];

  for (const block of blocks){
    const nameEl = $('.kds-Text--m.kds-Text--bold', block);
    if(!nameEl) continue;
    const itemName = nameEl.textContent.trim();

    // total price (right side)
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

    // quantity + unit (supports weighted)
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
  return out;
}

// --- Page wiring ---
(function(){
  const fileCSV = byId('fileCSV');

  byId('btnProcess').addEventListener('click', () => {
    const ta = byId('htmlInput');
    const html = ta.value.trim();
    if(!html){ byId('status').textContent = 'Paste some HTML first.'; return; }
    ta.value = '';
    const t0 = performance.now();
    const rows = parseKrogerHTML(html);
    const added = upsertRows(rows);
    renderTable();
    const t1 = performance.now();
    byId('status').textContent = rows.length
      ? `Parsed ${rows.length} item block(s); ${added} new row(s) added in ${(t1-t0).toFixed(1)} ms.`
      : 'No items found — make sure you pasted the correct receipt HTML.';
  });

  byId('btnExportCSV').addEventListener('click', ()=>{
    if(!Shared.state.rows.length) return;
    const headers = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];
    const csv = toCSV(Shared.state.rows, headers);
    download('kroger_items.csv', csv, 'text/csv');
  });

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

  byId('btnClear').addEventListener('click', ()=>{
    Shared.state.rows.length = 0; Shared.state.keys.clear();
    renderTable();
    byId('status').textContent = 'Cleared.';
  });
})();
