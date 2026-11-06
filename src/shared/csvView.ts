/** Static controls shared by the host and UI tests; CSV values never enter HTML. */
export const CSV_VIEW_BODY = `<header><strong>CSV Table</strong><label>Separator <select id="separator" aria-label="Separator"><option value=",">Comma</option><option value=";">Semicolon</option><option value="tab">Tab</option></select></label>
<label><input id="headers" type="checkbox" checked>First row is a header</label><button id="reset">Reset sort</button><button id="source">Open Text</button></header>
<p id="status" role="status" aria-live="polite">Loading CSV…</p><p class="hint">Read-only view. Select a column header to sort. Sorting does not change the file. Formulas are displayed as text.</p>
<div id="viewport" tabindex="0" role="region" aria-label="CSV table; scroll for more columns"><table aria-label="CSV data"><thead id="head"></thead><tbody id="rows"></tbody></table></div>
<footer><button id="previous">Previous page</button><span id="page"></span><button id="next">Next page</button></footer>`;
