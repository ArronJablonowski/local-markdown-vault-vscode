import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const edge of [false, true]) test(`${editingMode}: selection protection yields to ${edge ? 'edge scrolling' : 'multi-paragraph dragging'}`, async ({ page }) => {
	const paragraphs = Array.from({ length: 2000 }, (_, i) => `Paragraph ${String(i).padStart(4, '0')} retained.`);
	const text = paragraphs.join('\n\n');
	await mountEditor(page, text, { editingMode });
	await openSearch(page);
	await page.locator('input[name="search"]').fill(paragraphs[500]);
	await page.locator('input[name="search"]').press('Enter');
	await page.locator('input[name="search"]').press('Escape');
	const line = page.locator('.cm-line').filter({ hasText: paragraphs[500] });
	await line.scrollIntoViewIfNeeded();
	await line.evaluate((el: any, y) => { const view = el.closest('.cm-content').cmTile.root.view; view.scrollDOM.scrollTop += el.getBoundingClientRect().top - y; }, edge ? 680 : 300);
	await line.hover();
	const start = await line.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().toJSON(); });
	await page.mouse.move(start.x + 1, start.y + start.height / 2); await page.mouse.down();
	if (edge) {
		const scroller = page.locator('.cm-scroller');
		const before = await scroller.evaluate(el => el.scrollTop);
		const viewport = await scroller.boundingBox();
		for (let step = 0; step < 8; step++) {
			await page.mouse.move(start.x + 10 + step * 8, viewport!.y + viewport!.height - 2);
			await page.waitForTimeout(30);
		}
		await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(before + 30);
		await page.mouse.up();
	} else {
		const end = await page.locator('.cm-line').filter({ hasText: paragraphs[501] }).evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().toJSON(); });
		await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, { steps: 20 }); await page.mouse.up();
		const selected = await page.locator('.cm-content').evaluate((el: any) => { const state = el.cmTile.root.view.state; return state.sliceDoc(state.selection.main.from, state.selection.main.to); });
		expect(selected).toBe(paragraphs[500] + '\n\n' + paragraphs[501]);
	}
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(text);
});
