// Pure reuse of shared logic: just wire the file input
const { byId, parseCSV, toCSV, download, upsertRows, renderTable } = window.Shared;

(function(){
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

  byId('btnExportCSV').addEventListener('click', ()=>{
    if(!Shared.state.rows.length) return;
    const headers = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];
    const csv = toCSV(Shared.state.rows, headers);
    download('kroger_items.csv', csv, 'text/csv');
  });

  byId('btnClear').addEventListener('click', ()=>{
    Shared.state.rows.length = 0; Shared.state.keys.clear();
    renderTable();
    byId('status').textContent = 'Cleared.';
  });
})();
