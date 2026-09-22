(() => {
	'use strict';

	const BUTTON_CLASS = 'lmv-code-copy-button';
	const COLLAPSE_BUTTON_CLASS = 'lmv-code-collapse-button';
	const MAX_BLOCKS = 10_000;
	const MAX_COPY_CHARACTERS = 5 * 1024 * 1024;
	const renderedCode = new WeakMap();
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
		// VS Code can replace only the code node during a preview update. Controls
		// attached to its surviving parent must not retain the old node's text.
		if (renderedCode.has(pre) && renderedCode.get(pre) !== code) {
			pre.querySelector(`:scope > .${BUTTON_CLASS}`)?.remove();
			pre.querySelector(`:scope > .${COLLAPSE_BUTTON_CLASS}`)?.remove();
			pre.classList.remove('lmv-code-collapsed');
		}
		renderedCode.set(pre, code);

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
		if (lineCount <= 8) {
			existingCollapse?.remove();
			code.hidden = false;
			pre.classList.remove('lmv-code-collapsed');
		} else if (!existingCollapse) {
			const collapse = document.createElement('button');
			collapse.type = 'button';
			collapse.className = COLLAPSE_BUTTON_CLASS;
			let collapsed = false;
			const update = () => {
				collapse.textContent = collapsed ? '›' : '⌄';
				collapse.title = `${collapsed ? 'Expand' : 'Collapse'} this code block (${lineCount} lines)`;
				collapse.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} code block`);
				collapse.setAttribute('aria-expanded', String(!collapsed));
				code.hidden = collapsed;
				pre.classList.toggle('lmv-code-collapsed', collapsed);
			};
			collapse.addEventListener('click', () => {
				collapsed = !collapsed;
				update();
			});
			update();
			pre.appendChild(collapse);
		}
	}

	function refresh() {
		refreshPending = false;
		const blocks = document.querySelectorAll('pre > code');
		const count = Math.min(blocks.length, MAX_BLOCKS);
		for (let index = 0; index < count; index++) addCopyButton(blocks[index]);
	}

	function scheduleRefresh() {
		if (refreshPending) return;
		refreshPending = true;
		window.requestAnimationFrame(refresh);
	}

	new MutationObserver(scheduleRefresh).observe(document.documentElement, {
		childList: true,
		characterData: true,
		subtree: true,
	});
	scheduleRefresh();
})();
