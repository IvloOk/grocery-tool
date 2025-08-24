# Kroger Receipt HTML → Table (Multi-file)


A tiny, local, browser-only tool that parses Kroger order HTML into a table you can export/import as CSV. No data leaves your machine.


Open `index.html` in your browser.


## Getting the HTML from Kroger
1. Open your order page on https://www.kroger.com for the order you want.
2. Open **DevTools** → **Console** (Cmd/Ctrl+Option+J on Mac, Ctrl+Shift+J on Windows).
3. Run this snippet to copy the receipt HTML **and** log the order date:


```js
(function(){
  const root = document.getElementById('receipt-print-area');
  if(!root){ console.warn('receipt-print-area not found'); return; }
  const text = (root.textContent||'').replace(/\s+/g,' ').trim();
  const m = text.match(/Order Date:\s*([A-Za-z]{3,9}\.?\s*\d{1,2},?\s*\d{4})/);
  const date = m ? m[1].trim() : 'Unknown';
  copy(root.innerHTML);
  console.log(`Copied receipt HTML for order dated ${date}`);
})();