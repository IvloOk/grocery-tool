// pages/summarizer.js
// Summary-only view with robust DOM guards and enhanced banner.
// - Banner: Dataset range, Rows, Unique items, Number of Orders, Total Spent ($X, $Y/day)
// - Table/CSV: no First/Last columns; $-prefixed price fields
// - Safe if some HTML containers are missing.

(function () {
  const SharedNS = window.Shared || {};
  const byId = SharedNS.byId ? SharedNS.byId.bind(SharedNS) : (id) => document.getElementById(id);
  const parseCSV = SharedNS.parseCSV || ((text) => {
    // Minimal fallback CSV parser (quotes + commas)
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (inQuotes && text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (c === ',' && !inQuotes) {
        row.push(field); field = '';
      } else if ((c === '\n') && !inQuotes) {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c === '\r') {
        // ignore
      } else {
        field += c;
      }
    }
    row.push(field); rows.push(row);
    return rows;
  });
  const toCSV = SharedNS.toCSV || ((rows, headers) => {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = headers.map(esc).join(',');
    const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
    return head + '\n' + body;
  });
  const download = SharedNS.download || ((name, text, type = 'text/plain') => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  });

  // ---------- Local state ----------
  const State = {
    rows: [],
    summary: [],
    keyField: 'UPC',
    store: 'Kroger',
    firstTS: NaN,
    lastTS: NaN,
    daysSpan: 1,
    totalSpentNum: 0,
    ordersCount: 0
  };

  // ---------- Helpers ----------
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const money = (n) => (n == null || Number.isNaN(+n)) ? '$0.00' : `$${(+n).toFixed(2)}`;

  const detectStore =
    SharedNS.detectStore ||
    function detectStore(headers, sampleRow) {
      const hasStore = headers.includes('Store');
      return hasStore ? (sampleRow?.Store || 'Kroger') : 'Kroger';
    };

  const qtyToNumber =
    SharedNS.qtyToNumber ||
    function qtyToNumber(q) {
      if (q == null) return 1;
      const m = String(q).match(/([0-9]+(?:\.[0-9]+)?)/);
      if (!m) return 1;
      const n = parseFloat(m[1]);
      return Number.isFinite(n) ? n : 1;
    };

  const parseDateSafe =
    SharedNS.parseDateSafe ||
    function parseDateSafe(s) {
      if (!s) return NaN;
      const n = String(s).replace(/\./g, '').trim(); // "Aug. 23, 2025" → "Aug 23, 2025"
      const d = new Date(n);
      if (!Number.isNaN(+d)) return +d;
      const m = n.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/);
      if (m) {
        const mn = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const mi = mn.indexOf(m[1].slice(0,3).toLowerCase());
        if (mi >= 0) return +new Date(+m[3], mi, +m[2]);
      }
      const iso = n.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return +new Date(+iso[1], +iso[2] - 1, +iso[3]);
      return NaN;
    };

  const formatDateYMD =
    SharedNS.formatDateYMD ||
    function formatDateYMD(ts) {
      if (!Number.isFinite(ts)) return '';
      const d = new Date(ts);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
    };

  const STORE_KEY_MATRIX = SharedNS.STORE_KEY_MATRIX || {
    Kroger: ['UPC'],
    // Future: BJs: ['ItemNumber','UPC'], Costco: ['ItemNumber']
  };

  const keyForRow =
    SharedNS.keyForRow ||
    function keyForRow(row, storeName = 'Kroger') {
      const prefs = STORE_KEY_MATRIX[storeName] || ['UPC'];
      for (const field of prefs) {
        const v = row[field];
        if (v != null && String(v).trim() !== '') return `${field}:${String(v).trim()}`;
      }
      return `NO-KEY:${(row.Item || '').slice(0, 80)}`;
    };

  const summarizeByKey =
    SharedNS.summarizeByKey ||
    function summarizeByKey(rows, storeName = 'Kroger') {
      const groups = new Map();
      for (const r of rows) {
        const key = keyForRow(r, storeName);
        let g = groups.get(key);
        if (!g) {
          const [KeyField, KeyValue] = key.includes(':') ? key.split(/:(.+)/) : ['NO-KEY', ''];
          g = {
            key, Item: r.Item || '', KeyField, KeyValue,
            purchases: 0, qtySum: 0, spentSum: 0
          };
          groups.set(key, g);
        }
        g.purchases += 1;
        g.qtySum += qtyToNumber(r.Quantity);
        const tp = (r['Total Price'] == null || Number.isNaN(+r['Total Price'])) ? 0 : +r['Total Price'];
        g.spentSum += tp;
      }

      const summary = [];
      for (const g of groups.values()) {
        const avgUnitPrice = g.qtySum > 0 ? (g.spentSum / g.qtySum) : null;
        summary.push({
          [g.KeyField]: g.KeyValue,
          Item: g.Item,
          Purchases: g.purchases,
          'Total Qty': Number.isFinite(g.qtySum) ? +g.qtySum.toFixed(2) : '',
          'Avg Unit Price ($/unit)': (avgUnitPrice != null && Number.isFinite(avgUnitPrice)) ? +avgUnitPrice.toFixed(2) : '',
          'Total Spent': (g.spentSum != null && Number.isFinite(g.spentSum)) ? +g.spentSum.toFixed(2) : '',
          'Est. Days / Unit': '' // filled later if desired; currently derived from overall timespan
        });
      }

      summary.sort((a, b) => String(a.Item || '').localeCompare(String(b.Item || '')));

      return { summary };
    };

  function computeDatasetStats(rows) {
    // Total spent across ALL rows & distinct order dates
    const totalSpent = rows.reduce((acc, r) => {
      const n = (r['Total Price'] == null || Number.isNaN(+r['Total Price'])) ? 0 : +r['Total Price'];
      return acc + n;
    }, 0);

    const days = new Set();
    let firstTS = Infinity, lastTS = -Infinity;
    for (const r of rows) {
      const ts = parseDateSafe(r.Date);
      if (!Number.isFinite(ts)) continue;
      days.add(formatDateYMD(ts));
      if (ts < firstTS) firstTS = ts;
      if (ts > lastTS)  lastTS  = ts;
    }
    const daysSpan = (Number.isFinite(firstTS) && Number.isFinite(lastTS))
      ? Math.max(1, Math.round((lastTS - firstTS) / MS_PER_DAY))
      : 1;

    return { totalSpentNum: totalSpent, ordersCount: days.size, firstTS, lastTS, daysSpan };
  }

  function renderTableCustomSafe(containerId, headers, rows, numericCols = []) {
    const cont = byId(containerId);
    if (!cont) { console.warn(`[summarizer] Missing container #${containerId}`); return; }
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
          if (typeof val === 'number' && Number.isFinite(val)) val = String(val);
        }
        td.textContent = val == null ? '' : val;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    cont.appendChild(table);
  }

  // ---------- UI: render summary only ----------
  function renderSummaryOnly(rows) {
    const headers = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];
    State.store = detectStore(headers, rows[0]);

    const agg = summarizeByKey(rows, State.store);

    // Compute dataset stats for banner and frequency
    const ds = computeDatasetStats(rows);
    State.firstTS = ds.firstTS;
    State.lastTS  = ds.lastTS;
    State.daysSpan = ds.daysSpan;
    State.totalSpentNum = ds.totalSpentNum;
    State.ordersCount = ds.ordersCount;

    // Fill Est. Days / Unit from dataset timespan
    const filled = agg.summary.map(s => {
      const keyValue = s.UPC ?? s.ItemNumber ?? s['NO-KEY'] ?? '';
      const out = {
        ...(keyValue !== '' ? { [s.UPC != null ? 'UPC' : (s.ItemNumber != null ? 'ItemNumber' : 'NO-KEY')]: keyValue } : {}),
        Item: s.Item,
        Purchases: s.Purchases,
        'Total Qty': s['Total Qty'],
        'Avg Unit Price ($/unit)': (s['Avg Unit Price ($/unit)'] === '' ? '' : money(s['Avg Unit Price ($/unit)'])),
        'Total Spent': (s['Total Spent'] === '' ? '' : money(s['Total Spent'])),
        'Est. Days / Unit': (s['Total Qty'] && Number.isFinite(+s['Total Qty']) && +s['Total Qty'] > 0)
          ? +(State.daysSpan / +s['Total Qty']).toFixed(1)
          : ''
      };
      return out;
    });

    // Determine key field present in summary rows
    const keyField =
      (filled[0] && (filled[0].UPC ? 'UPC' : (filled[0].ItemNumber ? 'ItemNumber' : 'NO-KEY'))) || 'UPC';
    State.keyField = keyField;

    const summaryHeaders = [
      keyField,
      'Item',
      'Purchases',
      'Total Qty',
      'Avg Unit Price ($/unit)',  // $-prefixed for display/export
      'Total Spent',              // $-prefixed for display/export
      'Est. Days / Unit'
    ];
    const numericCols = ['Purchases','Total Qty','Est. Days / Unit'];

    // Banner
    const banner = byId('datasetBanner');
    if (banner) {
      const rowsCount = rows.length;
      const uniqueItems = filled.length;
      const firstStr = formatDateYMD(State.firstTS);
      const lastStr  = formatDateYMD(State.lastTS);
      const totalStr = money(State.totalSpentNum);
      const perDayStr = money(State.totalSpentNum / (State.daysSpan || 1));
      banner.style.display = 'block';
      banner.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div><strong>Dataset range:</strong> ${firstStr} → ${lastStr} (${State.daysSpan} day${State.daysSpan===1?'':'s'})</div>
          <div><strong>Rows:</strong> ${rowsCount}</div>
          <div><strong>Unique items:</strong> ${uniqueItems}</div>
          <div><strong>Number of Orders:</strong> ${State.ordersCount}</div>
          <div><strong>Total Spent:</strong> ${totalStr} (${perDayStr}/day)</div>
        </div>
      `;
    }

    const box = byId('summaryBox');
    if (box) box.style.display = 'block';
    renderTableCustomSafe('summaryContainer', summaryHeaders, filled, numericCols);

    State.summary = filled;

    const status = byId('status');
    if (status) status.textContent = `Summarized ${rows.length} rows into ${filled.length} unique items.`;
  }

  // ---------- CSV Import flow (summary only) ----------
  const fileCSV = byId('fileCSV');
  const btnImport = byId('btnImportCSV');
  if (btnImport) btnImport.addEventListener('click', () => fileCSV && fileCSV.click());

  if (fileCSV) {
    fileCSV.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const text = await f.text();
      const matrix = parseCSV(text);
      const status = byId('status');

      if (!matrix.length) { if (status) status.textContent = 'CSV appears empty.'; return; }

      const headers = matrix[0].map(h => (h || '').trim());
      const need = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];
      const missing = need.filter(h => !headers.includes(h));
      if (missing.length) { if (status) status.textContent = 'CSV missing headers: ' + missing.join(', '); return; }

      const idx = h => headers.indexOf(h);
      const toNum = v => { const s = String(v || '').replace(/[^0-9.]/g, ''); const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

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

      State.rows = rows;
      renderSummaryOnly(rows);
      fileCSV.value = '';
    });
  }

  // ---------- Export summary CSV ----------
  const btnExport = byId('btnExportCSV');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      if (!State.summary.length) return;
      const key = State.keyField || 'UPC';
      const headers = [
        key,
        'Item',
        'Purchases',
        'Total Qty',
        'Avg Unit Price ($/unit)', // $-prefixed strings
        'Total Spent',             // $-prefixed strings
        'Est. Days / Unit'
      ];
      const csv = toCSV(State.summary, headers);
      download('unique_items_summary.csv', csv, 'text/csv');
    });
  }

  // ---------- Clear ----------
  const btnClear = byId('btnClear');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      State.rows = [];
      State.summary = [];
      State.keyField = 'UPC';
      State.firstTS = NaN;
      State.lastTS = NaN;
      State.daysSpan = 1;
      State.totalSpentNum = 0;
      State.ordersCount = 0;

      const box = byId('summaryBox');
      if (box) box.style.display = 'none';
      const banner = byId('datasetBanner');
      if (banner) banner.style.display = 'none';
      const cont = byId('summaryContainer');
      if (cont) cont.innerHTML = '';
      const status = byId('status');
      if (status) status.textContent = 'Cleared.';
    });
  }
})();
