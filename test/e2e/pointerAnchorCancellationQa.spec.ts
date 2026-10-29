import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

for (const intent of ['ArrowLeft', 'wheel', 'focusout', 'pointercancel', 'touchstart', 'blur']) test(`a retained hover anchor does not undo ${intent}`, async ({ page }) => {
	const text = '# Notes\n\n' + 'Retained paragraph.\n\n'.repeat(2000) + 'Final editable paragraph.';
	await mountEditor(page, text);
	await page.locator('.cm-content').evaluate((el: any) => { el.style.paddingTop = '1200px'; });
	await openSearch(page);
	await page.locator('input[name="search"]').fill('Final editable paragraph.');
	await page.locator('input[name="search"]').press('Enter');
	await page.locator('input[name="search"]').press('Escape');
	const line = page.locator('.cm-line').filter({ hasText: /^Final editable paragraph\.$/ });
	await line.scrollIntoViewIfNeeded();
	await line.hover();
	const before = await line.boundingBox();
	if (intent === 'ArrowLeft') await page.keyboard.press('ArrowLeft');
	else if (intent === 'wheel') await page.mouse.wheel(0, -100);
	else await page.locator('.cm-content').evaluate((el: HTMLElement, intent) => {
		if (intent === 'blur') window.dispatchEvent(new Event('blur'));
		else if (intent === 'focusout') el.blur();
		else if (intent === 'touchstart') el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
		else el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
	}, intent);
	const expected = await page.locator('.cm-content').evaluate(async (el: any) => {
		el.style.paddingTop = '24px';
		// Let the normal scroll anchor finish responding to this layout change.
		await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
		const view = el.cmTile.root.view;
		view.coordsAtPos(view.state.doc.length);
		return view.scrollDOM.scrollTop;
	});
	await page.mouse.move(before!.x + 50, before!.y + before!.height / 2);
	const actual = await page.locator('.cm-content').evaluate((el: any) => ({ scroll: el.cmTile.root.view.scrollDOM.scrollTop, source: el.cmTile.root.view.state.doc.toString() }));
	expect(Math.abs(actual.scroll - expected)).toBeLessThan(2);
	expect(actual.source).toBe(text);
});
