import { CSV_LIMITS, parseCsv, sortedCsvRows, csvColumnLabel, type CsvResult } from '../shared/csv';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };
const host = acquireVsCodeApi();
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const separator = element<HTMLSelectElement>('separator');
const headers = element<HTMLInputElement>('headers');
const status = element('status');
const head = element('head');
const body = element('rows');
const previous = element<HTMLButtonElement>('previous');
const next = element<HTMLButtonElement>('next');
const PAGE_SIZE = 100;
let source = '', data: CsvResult = { rows: [], columns: 0 }, page = 0, column = -1, descending = false;
let firstLoad = true, hostError: string | undefined;
const saved = host.getState();
if (saved && typeof saved === 'object') {
	const state = saved as Record<string, unknown>;
	if (typeof state.separator === 'string' && [',', ';', 'tab'].includes(state.separator)) separator.value = state.separator;
	if (typeof state.headers === 'boolean') headers.checked = state.headers;
	if (Number.isInteger(state.column) && Number(state.column) >= -1 && Number(state.column) < CSV_LIMITS.columns) column = Number(state.column);
	if (Number.isInteger(state.page) && Number(state.page) >= 0 && Number(state.page) < 500) page = Number(state.page);
	descending = state.descending === true;
}

/** Build only the current page, and assign all imported strings as text. */
function render(): void {
	const rows = headers.checked ? data.rows.slice(1) : data.rows;
	const order = column < 0 ? rows.map((_, index) => index) : sortedCsvRows(rows, column, descending);
	const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
	page = Math.min(page, pages - 1);
	const headerRow = document.createElement('tr');
	const corner = document.createElement('th'); corner.textContent = 'Row'; corner.scope = 'col'; headerRow.append(corner);
	for (let index = 0; index < data.columns; index++) {
		const cell = document.createElement('th'); cell.scope = 'col';
		cell.setAttribute('aria-sort', column === index ? descending ? 'descending' : 'ascending' : 'none');
		const button = document.createElement('button');
		const label = headers.checked ? data.rows[0]?.[index] ?? '' : '';
		button.textContent = `${csvColumnLabel(index)}${label ? ` · ${label}` : ''}${column === index ? descending ? ' ▼' : ' ▲' : ''}`;
		button.title = `Sort column ${csvColumnLabel(index)} ${column === index && !descending ? 'descending' : 'ascending'}`;
		button.addEventListener('click', () => { descending = column === index ? !descending : false; column = index; page = 0; render(); (head.querySelectorAll('button')[index] as HTMLButtonElement)?.focus(); });
		cell.append(button); headerRow.append(cell);
	}
	head.replaceChildren(headerRow);
	const fragment = document.createDocumentFragment();
	for (const index of order.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
		const row = document.createElement('tr');
		const number = document.createElement('th'); number.scope = 'row'; number.textContent = String(index + (headers.checked ? 2 : 1)); row.append(number);
		for (let field = 0; field < data.columns; field++) {
			const cell = document.createElement('td'); cell.textContent = rows[index][field] ?? ''; row.append(cell);
		}
		fragment.append(row);
	}
	body.replaceChildren(fragment);
	status.textContent = `Data rows: ${rows.length.toLocaleString('en-US')} · Columns: ${data.columns}${column < 0 ? '' : ` · Sorted by ${csvColumnLabel(column)} ${descending ? 'descending' : 'ascending'}`}`;
	element('page').textContent = `Page ${page + 1} of ${pages}`;
	previous.disabled = page === 0; next.disabled = page + 1 >= pages;
	// Persist only presentation choices, never potentially sensitive cell values.
	host.setState({ separator: separator.value, headers: headers.checked, column, descending, page });
}
function load(): void {
	if (!firstLoad) page = 0;
	firstLoad = false;
	if (hostError) { showError(hostError); return; }
	try {
		data = parseCsv(source, separator.value === 'tab' ? '\t' : separator.value === ';' ? ';' : ',');
		if (column >= data.columns) column = -1;
		render();
	} catch (error) { showError(error instanceof Error ? error.message : 'Unable to display CSV.'); }
}
function showError(message: string): void {
	data = { rows: [], columns: 0 }; head.replaceChildren(); body.replaceChildren();
	status.textContent = message; element('page').textContent = ''; previous.disabled = true; next.disabled = true;
}
separator.addEventListener('change', load);
headers.addEventListener('change', () => { column = -1; load(); });
element('reset').addEventListener('click', () => { column = -1; load(); });
previous.addEventListener('click', () => { page--; render(); });
next.addEventListener('click', () => { page++; render(); });
element('source').addEventListener('click', () => host.postMessage({ type: 'openSource' }));
window.addEventListener('message', event => {
	const message = event.data;
	if (!message || typeof message !== 'object') return;
	if (message.type === 'csv' && typeof message.text === 'string' && message.text.length <= CSV_LIMITS.characters) { hostError = undefined; source = message.text; load(); }
	else if (message.type === 'error' && typeof message.message === 'string' && message.message.length <= 1024) { hostError = message.message; source = ''; showError(message.message); }
});
host.postMessage({ type: 'ready' });
