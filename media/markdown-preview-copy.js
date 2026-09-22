(() => {
	'use strict';

	const BUTTON_CLASS = 'lmv-code-copy-button';
	const MAX_BLOCKS = 10_000;
	const MAX_COPY_CHARACTERS = 5 * 1024 * 1024;
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
		if (!pre || pre.tagName !== 'PRE' || pre.querySelector(`:scope > .${BUTTON_CLASS}`)) return;

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
		pre.classList.add('lmv-code-copy-host');
		pre.appendChild(button);
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
		subtree: true,
	});
	scheduleRefresh();
})();
