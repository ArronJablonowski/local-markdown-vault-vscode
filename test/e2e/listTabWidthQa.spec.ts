import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const marker of ['-', '- [ ]', '- [x]']) test(`full tab spacing and keyboard nesting for ${marker}`, async ({ page }) => {
	const initial = `# Notes\n\n${marker} Parent\n${marker} Child\n\nAfter`;
	await mountEditor(page, initial);
	await page.locator('.cm-line', { hasText: 'Child' }).click();
	await page.keyboard.press('Tab');
	const source = () => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString());
	await expect.poll(source).toBe(initial.replace(`${marker} Child`, `    ${marker} Child`));
	await page.locator('.cm-line', { hasText: 'After' }).click();
	const selector = marker.includes('[') ? '.mlp-checkbox' : '.mlp-bullet';
	await expect(page.locator(selector)).toHaveCount(2);
	const positions = await page.locator(selector).evaluateAll(elements => elements.map(el => el.getBoundingClientRect().left));
	const tab = await page.locator('.cm-content').evaluate(el => {
		const span = document.createElement('span'); span.style.width = '4ch'; span.style.display = 'inline-block';
		span.style.font = getComputedStyle(el).font;
		document.body.append(span); const width = span.getBoundingClientRect().width; span.remove(); return width;
	});
	expect(positions[1] - positions[0]).toBeCloseTo(tab, 0);
	const rootInset = await page.locator(selector).first().evaluate(el => el.getBoundingClientRect().left - el.closest('.cm-line')!.getBoundingClientRect().left);
	expect(rootInset).toBeCloseTo(tab, 0);
	await page.locator('.cm-line', { hasText: 'Child' }).click();
	await page.keyboard.press('Shift+Tab');
	await expect.poll(source).toBe(initial);
});

test('legacy two-space nested checkbox outdents by one level without rewriting other content', async ({ page }) => {
	const initial = '- [ ] Parent\n  - [ ] Child\n    - [ ] Grandchild';
	await mountEditor(page, initial);
	await page.locator('.cm-line', { hasText: 'Grandchild' }).click();
	await page.keyboard.press('Shift+Tab');
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
		.toBe('- [ ] Parent\n  - [ ] Child\n  - [ ] Grandchild');
});
