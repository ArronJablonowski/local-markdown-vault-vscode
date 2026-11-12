import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const quote of ['', '> ', '> > ']) for (const marker of ['-', '*', '+', '- [ ]']) for (const detail of ['Follow up with **owner** and `code`', 'Second line with [review](Notes.md)']) {
	test(`selected list item and continuation indent together, quote=${JSON.stringify(quote)}, marker=${marker}, detail=${detail.slice(0, 12)}`, async ({ page }) => {
		const intro = '# Meeting\n\n' + (quote ? `${quote}[!note] Agenda\n` : '');
		const block = `${quote}${marker} Child\n${quote}  ${detail}`;
		const source = intro + `${quote}${marker} Parent\n` + block + `\n${quote}${marker} Sibling\n\n| Notes | Owner |\n| --- | --- |\n| Retained | Team |\n\nAfter`;
		await mountEditor(page, source);
		// Select a physical source block, then use the real editing keymap.
		await page.locator('.cm-content').evaluate((el: any, range) => { const view = el.cmTile.root.view; view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus(); }, { from: source.indexOf(block), to: source.indexOf(block) + block.length });
		await page.keyboard.press('Tab');
		const expected = source.replace(block, `${quote}    ${marker} Child\n${quote}      ${detail}`);
		const read = () => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
		await expect.poll(read).toBe(expected);
		await page.keyboard.press('Shift+Tab');
		await expect.poll(read).toBe(source);
	});
}
