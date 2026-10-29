import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

for (const phase of ['mousemove', 'mousedown', 'between-events', 'drag', 'mouseup']) for (const editingMode of ['editing', 'locked'] as const) for (const width of [500, 1000]) for (const modifier of phase === 'between-events' ? ['none', 'Shift'] : ['none']) test(`mouse selection retains its visual anchor during ${phase} height correction: ${editingMode}, ${width}px, ${modifier}`, async ({ page }) => {
	await page.setViewportSize({ width, height: 700 });
	const text = '# Notes\n\n' + 'Retained paragraph.\n\n'.repeat(2000) + 'Final editable paragraph.';
	await mountEditor(page, text, { editingMode });
	await page.locator('.cm-content').evaluate((el: any) => { el.style.paddingTop = '1200px'; });
	await openSearch(page);
	await page.locator('input[name="search"]').fill('Final editable paragraph.');
	await page.locator('input[name="search"]').press('Enter');
	await page.locator('input[name="search"]').press('Escape');
	const line = page.locator('.cm-line').filter({ hasText: /^Final editable paragraph\.$/ });
	await line.scrollIntoViewIfNeeded();
	await line.evaluate((el: any) => {
		const view = el.closest('.cm-content').cmTile.root.view;
		view.coordsAtPos(view.state.doc.length);
		view.scrollDOM.scrollTop += el.getBoundingClientRect().top - 665;
	});
	await line.hover();
	const before = await line.evaluate(el => {
		const range = document.createRange(); range.selectNodeContents(el);
		return { ...range.getBoundingClientRect().toJSON(), lineY: el.getBoundingClientRect().top };
	});
	// Reproduce a queued height correction during CodeMirror's coordinate read,
	// rather than relying on a background parser/diagram winning a timing race.
	if (modifier === 'Shift') await page.keyboard.down('Shift');
	await page.locator('.cm-content').evaluate((el: any, phase) => {
		const view = el.cmTile.root.view;
		if (phase === 'between-events') {
			el.style.paddingTop = '24px';
			el.getBoundingClientRect();
			return;
		}
		if (phase === 'drag') {
			const duringDrag = (event: MouseEvent) => {
				if (event.buttons !== 1) return;
				document.removeEventListener('mousemove', duringDrag, true);
				view.requestMeasure({ read: () => null, write: () => { el.style.paddingTop = '24px'; } });
			};
			document.addEventListener('mousemove', duringDrag, true);
			return;
		}
		document.addEventListener(phase, () => view.requestMeasure({
			read: () => null, write: () => { el.style.paddingTop = '24px'; },
		}), { capture: true, once: true });
	}, phase);
	await page.mouse.move(before.x + 1, before.y + before.height / 2);
	await page.mouse.down();
	const after = await line.boundingBox();
	await page.mouse.move(before.x + before.width - 1, before.y + before.height / 2, { steps: 12 });
	await page.mouse.up();
	if (modifier === 'Shift') await page.keyboard.up('Shift');
	expect(Math.abs(after!.y - before.lineY)).toBeLessThan(2);
	const result = await page.locator('.cm-content').evaluate((el: any) => {
		const state = el.cmTile.root.view.state;
		return { selected: state.sliceDoc(state.selection.main.from, state.selection.main.to), source: state.doc.toString() };
	});
	expect(result.selected).toBe('Final editable paragraph.');
	expect(result.source).toBe(text);
});
