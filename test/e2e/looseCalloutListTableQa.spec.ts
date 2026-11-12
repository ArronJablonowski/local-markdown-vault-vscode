import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const quote of ['', '> ', '> > ']) for (const marker of ['-', '- [ ]']) for (const blank of ['', '  ']) {
	test(`loose list selection preserves callout and resized table: ${JSON.stringify({ quote, marker, blank })}`, async ({ page }) => {
		const block = `${quote}${marker} Child\n${quote}${blank}\n${quote}  Continued **detail** with [owner](Notes.md)`;
		const source = '# Meeting\n\n' + (quote ? `${quote}[!warning]+ Agenda\n` : '') + `${quote}${marker} Parent\n` + block + `\n${quote}${marker} Sibling\n\n| Notes | Owner |\n| --- | --- |\n| <ul><li>First<ul><li>Nested detail</li></ul></li></ul> | Team |\n\nAfter`;
		await mountEditor(page, source);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus(); for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		await page.locator('.cm-content').evaluate((el: any, range) => { const view = el.cmTile.root.view; view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus(); }, { from: source.indexOf(block), to: source.indexOf(block) + block.length });
		await page.keyboard.press('Tab');
		const expected = source.replace(block, `${quote}    ${marker} Child\n${quote}    ${blank}\n${quote}      Continued **detail** with [owner](Notes.md)`);
		const read = () => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
		await expect.poll(read).toBe(expected);
		await page.keyboard.press('Shift+Tab'); await expect.poll(read).toBe(source);
		await page.locator('.cm-line', { hasText: /^After$/ }).click();
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		await expect(page.locator('.mlp-table td').last()).toHaveText('Team');
		await expect.poll(() => page.locator('.mlp-table td').first().evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(34);
		if (quote) { await page.getByRole('button', { name: 'Agenda callout', exact: true }).click(); await page.getByRole('button', { name: 'Agenda callout', exact: true }).click(); await expect(handle).toHaveAttribute('aria-valuenow', '64'); }
	});
}
