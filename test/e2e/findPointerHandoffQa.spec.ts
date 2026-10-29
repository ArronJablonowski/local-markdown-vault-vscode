import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

for (const mixed of [false, true]) for (const width of [500, 1000]) test(`Find-to-mouse handoff at bottom edge: mixed=${mixed}, width=${width}`, async ({ page }, info) => {
	await page.setViewportSize({ width, height: 700 });
	const text = mixed ? largeMixedDocument(100) : '# Notes\n\n' + 'Retained paragraph with **important** context.\n\n'.repeat(2_000) + 'Final editable paragraph.';
	await mountEditor(page, text);
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill('Final editable paragraph.');
	await page.locator('.cm-search input[name="search"]').press('Enter');
	await page.locator('.cm-search input[name="search"]').press('Escape');
	const line = page.locator('.cm-line').filter({ hasText: /^Final editable paragraph\.$/ });
	await line.scrollIntoViewIfNeeded();
	await page.mouse.move(width / 2, 350);
	const initial = await line.boundingBox();
	await page.mouse.wheel(0, initial!.y - 665);
	await line.hover();
	const before = await line.evaluate(async (el: any) => {
		await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
		const range = document.createRange(); range.selectNodeContents(el);
		const box = range.getBoundingClientRect(), view = el.closest('.cm-content').cmTile.root.view;
		return { x: box.x, y: box.y, width: box.width, height: box.height, focus: view.hasFocus,
			scroll: view.scrollDOM.scrollTop, scrollTarget: Boolean(view.viewState.scrollTarget) };
	});
	await page.mouse.move(before.x + 1, before.y + before.height / 2);
	await page.mouse.down();
	const pressed = await line.boundingBox();
	await page.mouse.move(before.x + before.width - 1, before.y + before.height / 2, { steps: 20 });
	await page.mouse.up();
	await info.attach('pointer-geometry.json', { body: JSON.stringify({ before, pressed }), contentType: 'application/json' });
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => {
		const state = el.cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	})).toBe('Final editable paragraph.');
	await page.keyboard.press('Backspace');
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(text.replace('Final editable paragraph.', ''));
});
