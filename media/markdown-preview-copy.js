(() => {
	'use strict';

	const BUTTON_CLASS = 'lmv-code-copy-button';
	const COLLAPSE_BUTTON_CLASS = 'lmv-code-collapse-button';
	const MAX_BLOCKS = 10_000;
	const MAX_COPY_CHARACTERS = 5 * 1024 * 1024;
	const renderedCode = new WeakMap();
	const renderedTables = new WeakMap();
	let refreshPending = false;

	function setResult(button, succeeded) {
		button.textContent = succeeded ? 'Copied' : 'Copy failed';
		button.classList.toggle(`${BUTTON_CLASS}--done`, succeeded);
		button.classList.toggle(`${BUTTON_CLASS}--failed`, !succeeded);
		window.setTimeout(() => {
			button.textContent = 'Copy';
			button.classList.remove(`${BUTTON_CLASS}--done`, `${BUTTON_CLASS}--failed`);
		}, 1200);
	}

	function addCopyButton(code) {
		const pre = code.parentElement;
		if (!pre || pre.tagName !== 'PRE') return;
		// Preview patches can replace the code node while retaining its parent.
		const firstRender = !renderedCode.has(pre);
		let wasCollapsed = pre.classList.contains('lmv-code-collapsed');
		// VS Code can replace only the code node during a preview update. Controls
		// attached to its surviving parent must not retain the old node's text.
		if (renderedCode.has(pre) && renderedCode.get(pre) !== code) {
			pre.querySelector(`:scope > .${BUTTON_CLASS}`)?.remove();
			pre.querySelector(`:scope > .${COLLAPSE_BUTTON_CLASS}`)?.remove();
			pre.classList.remove('lmv-code-collapsed');
		}
		renderedCode.set(pre, code);
		const languageClass = Array.from(code.classList).find(value => value.startsWith('language-'));
		const language = languageClass ? languageClass.slice(9, 89) : '';
		const yaml = /^(?:yaml|yml)$/i.test(language);
		if (firstRender && yaml && pre.dataset.lmvYamlDefaultCollapsed !== 'false') wasCollapsed = true;
		let label = pre.querySelector(':scope > .lmv-code-language');
		if (language) {
			if (!label) {
				label = document.createElement('span');
				label.className = 'lmv-code-language';
				pre.appendChild(label);
			}
			if (label.textContent !== language) label.textContent = language;
		} else {
			label?.remove();
		}

		pre.classList.add('lmv-code-copy-host');
		if (!pre.querySelector(`:scope > .${BUTTON_CLASS}`)) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = BUTTON_CLASS;
			button.textContent = 'Copy';
			button.title = 'Copy code block';
			button.setAttribute('aria-label', 'Copy code block');
			button.addEventListener('click', async () => {
				const value = code.textContent ?? '';
				if (value.length > MAX_COPY_CHARACTERS || !navigator.clipboard?.writeText) {
					setResult(button, false);
					return;
				}
				try {
					await navigator.clipboard.writeText(value);
					setResult(button, true);
				} catch {
					setResult(button, false);
				}
			});
			pre.appendChild(button);
		}

		const normalized = (code.textContent ?? '').replace(/\r\n?/g, '\n');
		const withoutTrailingNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
		const lineCount = withoutTrailingNewline ? withoutTrailingNewline.split('\n').length : 0;
		const existingCollapse = pre.querySelector(`:scope > .${COLLAPSE_BUTTON_CLASS}`);
		if (lineCount < 8 && !(yaml && lineCount > 6) && !(wasCollapsed && lineCount > 6)) {
			existingCollapse?.remove();
			code.hidden = false;
			pre.classList.remove('lmv-code-collapsed');
		} else if (!existingCollapse) {
			const collapse = document.createElement('button');
			collapse.type = 'button';
			collapse.className = COLLAPSE_BUTTON_CLASS;
			let collapsed = wasCollapsed;
			const update = () => {
				collapse.textContent = collapsed ? '›' : '⌄';
				collapse.title = `${collapsed ? 'Expand' : 'Collapse'} this code block (${collapse.dataset.lineCount} lines)`;
				collapse.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} code block`);
				collapse.setAttribute('aria-expanded', String(!collapsed));
				// Clip the view rather than removing text; Copy still includes all lines.
				code.hidden = false;
				pre.classList.toggle('lmv-code-collapsed', collapsed);
			};
			collapse.addEventListener('click', () => {
				collapsed = !collapsed;
				update();
			});
			collapse.dataset.lineCount = String(lineCount);
			update();
			pre.appendChild(collapse);
		} else {
			existingCollapse.dataset.lineCount = String(lineCount);
			existingCollapse.title = `${pre.classList.contains('lmv-code-collapsed') ? 'Expand' : 'Collapse'} this code block (${lineCount} lines)`;
		}
	}

	function addTableCollapse(table) {
		if (!(table instanceof HTMLTableElement)) return;
		const rows = Array.from(table.tBodies).flatMap(body => Array.from(body.rows));
		const previous = renderedTables.get(table);
		if (previous && previous.rows.length === rows.length && rows.every((row, index) => row === previous.rows[index])) {
			// A preview patch can move the table or remove its sibling control.
			if (table.previousElementSibling !== previous.button) table.before(previous.button);
			return;
		}
		previous?.button.remove();
		if (!previous && table.previousElementSibling?.classList.contains('lmv-table-collapse-button')) table.previousElementSibling.remove();
		if (rows.length <= 5) { rows.forEach(row => { row.hidden = false; }); renderedTables.delete(table); return; }
		const button = document.createElement('button');
		button.type = 'button'; button.className = 'lmv-table-collapse-button';
		const state = { rows, button, collapsed: previous?.collapsed ?? false };
		const update = () => {
			rows.forEach((row, index) => { row.hidden = state.collapsed && index >= 5; });
			button.textContent = state.collapsed ? 'Expand table' : 'Collapse table';
			button.setAttribute('aria-expanded', String(!state.collapsed));
			button.title = state.collapsed ? `${rows.length - 5} more rows hidden` : 'Show the header and first five data rows';
		};
		button.addEventListener('click', () => { state.collapsed = !state.collapsed; update(); });
		table.before(button); renderedTables.set(table, state); update();
	}

	function refresh() {
		refreshPending = false;
		// Parent nodes can survive after a code block is removed or becomes prose.
		for (const pre of document.querySelectorAll('pre.lmv-code-copy-host')) {
			if (pre.querySelector(':scope > code')) continue;
			for (const control of pre.querySelectorAll(`:scope > .${BUTTON_CLASS}, :scope > .${COLLAPSE_BUTTON_CLASS}, :scope > .lmv-code-language`)) control.remove();
			pre.classList.remove('lmv-code-copy-host', 'lmv-code-collapsed');
			renderedCode.delete(pre);
		}
		const blocks = document.querySelectorAll('pre > code');
		const count = Math.min(blocks.length, MAX_BLOCKS);
		for (let index = 0; index < count; index++) addCopyButton(blocks[index]);
		for (const button of document.querySelectorAll('.lmv-table-collapse-button')) if (button.nextElementSibling?.tagName !== 'TABLE') button.remove();
		const tables = document.querySelectorAll('table');
		for (let index = 0; index < Math.min(tables.length, MAX_BLOCKS); index++) addTableCollapse(tables[index]);
	}

	function scheduleRefresh() {
		if (refreshPending) return;
		refreshPending = true;
		window.requestAnimationFrame(refresh);
	}

	new MutationObserver(records => {
		if (records.some(record => record.type !== 'attributes' || record.target instanceof HTMLElement && record.target.matches('pre > code'))) scheduleRefresh();
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class'],
		childList: true,
		characterData: true,
		subtree: true,
	});
	scheduleRefresh();
})();
