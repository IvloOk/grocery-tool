// pages/summarizer.js
// Summarizer: show ONLY the roll-up summary table.
// Reuses Shared helpers when available; provides safe fallbacks where needed.

const { byId, parseCSV, toCSV, download } = window.Shared;

(function () {
  // ---------- Local state ----------
  const State = {
    rows: [],        // normalized raw rows from CSV
    summary: [],     // computed roll-up rows
    keyField: 'UPC', // column name used as unique key (e.g., 'UPC')
    store: 'Kroger', // default if no Store column
    firstTS: NaN,
    lastTS: NaN,
    daysSpan: 1
  };

  // ---------- Fallback helpers (if not present in Shared) ----------
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const detectStore =
    window.Shared.detectStore ||
    function detectStore(headers, sampleRow) {
      const hasStore = headers.includes('Store');
      return hasStore ? (sampleRow?.Store || 'Kroger') : 'Kroger';
    };

  const qtyToNumber =
    window.Shared.qtyToNumber ||
    function qtyToNumber(q) {
      if (q == null) return 1;
      const m = String(q).match(/([0-9]+(?:\.[0-9]+)?)/);
      if (!m) return 1;
      const n = parseFloat(m[1]);
      return Number.isFinite(n) ? n : 1;
    };

  const parseDateSafe =
    window.Shared.parseDateSafe ||
    function parseDateSafe(s) {
      if (!s) return NaN;
      const n = String(s).replace(/\./g, '').trim(); // supports "Aug. 23, 2025"
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
    window.Shared.formatDateYMD ||
    function formatDateYMD(ts) {
      if (!Number.isFinite(ts)) return '';
      const d = new Date(ts);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
    };

  const STORE_KEY_MATRIX = window.Shared.STORE_KEY_MATRIX || {
    Kroger: ['UPC'],
    // Future: BJs: ['ItemNumber','UPC'], Costco: ['ItemNumber']
  };

  const keyForRow =
    window.Shared.keyForRow ||
    function keyForRow(row, storeName = 'Kroger') {
      const prefs = STORE_KEY_MATRIX[storeName] || ['UPC'];
      for (const field of prefs) {
        const v = row[field];
        if (v != null && String(v).trim() !== '') return `${field}:${String(v).trim()}`;
      }
      return `NO-KEY:${(row.Item || '').slice(0, 80)}`;
    };

  const summarizeByKey =
    window.Shared.summarizeByKey ||
    function summarizeByKey(rows, storeName = 'Kroger') {
      let firstTS = Infinity, lastTS = -Infinity;

      const parsed = rows.map(r => {
        const ts = parseDateSafe(r.Date);
        if (Number.isFinite(ts)) {
          if (ts < firstTS) firstTS = ts;
          if (ts > lastTS) lastTS = ts;
        }
        const qn = qtyToNumber(r.Quantity);
        const up = (r['Unit Price'] == null || Number.isNaN(+r['Unit Price'])) ? null : +r['Unit Price'];
        const tp = (r['Total Price'] == null || Number.isNaN(+r['Total Price'])) ? (up != null ? up * qn : null) : +r['Total Price'];
        return { row: r, ts, qtyNum: qn, totalPrice: tp };
      });

      const daysSpan = (Number.isFinite(firstTS) && Number.isFinite(lastTS))
        ? Math.max(1, Math.round((lastTS - firstTS) / MS_PER_DAY))
        : 1;

      const groups = new Map();
      for (const p of parsed) {
        const key = keyForRow(p.row, storeName);
        let g = groups.get(key);
        if (!g) {
          g = {
            key,
            Item: p.row.Item || '',
            KeyField: key.split(':', 1)[0],
            KeyValue: key.includes(':') ? key.slice(key.indexOf(':') + 1) : '',
            firstTS: Number.isFinite(p.ts) ? p.ts : Infinity,
            lastTS: Number.isFinite(p.ts) ? p.ts : -Infinity,
            purchases: 0,
            qtySum: 0,
            spentSum: 0
          };
          groups.set(key, g);
        }
        g.purchases += 1;
        if (Number.isFinite(p.ts)) {
          if (p.ts < g.firstTS) g.firstTS = p.ts;
          if (p.ts > g.lastTS) g.lastTS = p.ts;
        }
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
          'First Date': Number.isFinite(g.firstTS) ? formatDateYMD(g.firstTS) : '',
          'Last Date':  Number.isFinite(g.lastTS)  ? formatDateYMD(g.lastTS)  : '',
          Purchases: g.purchases,
          'Total Qty': Number.isFinite(g.qtySum) ? +g.qtySum.toFixed(2) : '',
          'Avg Unit Price ($/unit)': (avgUnitPrice != null && Number.isFinite(avgUnitPrice)) ? +avgUnitPrice.toFixed(2) : '',
          'Total Spent': (g.spentSum != null && Number.isFinite(g.spentSum)) ? +g.spentSum.toFixed(2) : '',
          'Est. Days / Unit': (estDaysPerUnit != null && Number.isFinite(estDaysPerUnit)) ? +estDaysPerUnit.toFixed(1) : ''
        });
      }

      summary.sort((a, b) => String(a.Item || '').localeCompare(String(b.Item || '')));

      return {
        summary,
        firstTS: Number.isFinite(firstTS) ? firstTS : NaN,
        lastTS: Number.isFinite(lastTS) ? lastTS : NaN,
        daysSpan
      };
    };

  // Minimal fallback renderer if Shared.renderTableCustom is not present
  const renderTableCustom =
    window.Shared.renderTableCustom ||
    function renderTableCustom(containerId, headers, rows, numericCols = []) {
      const cont = document.getElementById(containerId);
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
              val = (val == null || Number.isNaN(+val)) ? '' : (+val).toFixed(2);
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

  // ---------- UI: render summary only ----------
  function renderSummaryOnly(rows) {
    // Decide store + compute summary
    const headers = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];
    State.store = detectStore(headers, rows[0]);
    const { summary, firstTS, lastTS, daysSpan } = summarizeByKey(rows, State.store);
    State.summary = summary;
    State.firstTS = firstTS;
    State.lastTS = lastTS;
    State.daysSpan = daysSpan;

    // Dataset banner
    const banner = byId('datasetBanner');
    if (summary.length) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div><strong>Dataset range:</strong> ${formatDateYMD(firstTS)} → ${formatDateYMD(lastTS)} (${daysSpan} day${daysSpan===1?'':'s'})</div>
          <div><strong>Rows:</strong> ${rows.length}</div>
          <div><strong>Unique items:</strong> ${summary.length}</div>
        </div>
      `;
    } else {
      banner.style.display = 'none';
    }

    // Pick the key column name (e.g., 'UPC' or 'ItemNumber' or 'NO-KEY')
    const keyField =
      (summary[0] && Object.keys(summary[0]).find(k => k !== 'Item' && /^(UPC|ItemNumber|NO-KEY)/.test(k))) ||
      'UPC';
    State.keyField = keyField;

    const summaryHeaders = [
      keyField,
      'Item',
      'First Date',
      'Last Date',
      'Purchases',
      'Total Qty',
      'Avg Unit Price ($/unit)',
      'Total Spent',
      'Est. Days / Unit'
    ];
    const numericCols = ['Purchases','Total Qty','Avg Unit Price ($/unit)','Total Spent','Est. Days / Unit'];

    byId('summaryBox').style.display = 'block';
    renderTableCustom('summaryContainer', summaryHeaders, summary, numericCols);

    byId('status').textContent = `Summarized ${rows.length} rows into ${summary.length} unique items.`;
  }

  // ---------- CSV Import flow (no raw table; summary only) ----------
  const fileCSV = byId('fileCSV');
  byId('btnImportCSV').addEventListener('click', () => fileCSV && fileCSV.click());

  if (fileCSV) {
    fileCSV.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const text = await f.text();
      const matrix = parseCSV(text);
      if (!matrix.length) { byId('status').textContent = 'CSV appears empty.'; return; }

      const headers = matrix[0].map(h => (h || '').trim());
      const need = ['Item','Date','Unit Price','Quantity','Total Price','Coupon Used','UPC'];
      const missing = need.filter(h => !headers.includes(h));
      if (missing.length) { byId('status').textContent = 'CSV missing headers: ' + missing.join(', '); return; }

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
  byId('btnExportCSV').addEventListener('click', () => {
    if (!State.summary.length) return;
    const key = State.keyField || 'UPC';
    const headers = [
      key,
      'Item',
      'First Date',
      'Last Date',
      'Purchases',
      'Total Qty',
      'Avg Unit Price ($/unit)',
      'Total Spent',
      'Est. Days / Unit'
    ];
    const csv = toCSV ? toCSV(State.summary, headers) : fallbackToCSV(State.summary, headers);
    download('unique_items_summary.csv', csv, 'text/csv');
  });

  function fallbackToCSV(rows, headers) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = headers.map(esc).join(',');
    const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
    return head + '\n' + body;
  }

  // ---------- Clear ----------
  byId('btnClear').addEventListener('click', () => {
    State.rows = [];
    State.summary = [];
    State.keyField = 'UPC';
    State.firstTS = NaN;
    State.lastTS = NaN;
    State.daysSpan = 1;

    // Hide summary/table and banner
    byId('summaryBox').style.display = 'none';
    byId('datasetBanner').style.display = 'none';
    byId('summaryContainer').innerHTML = '';
    byId('status').textContent = 'Cleared.';
  });
})();
