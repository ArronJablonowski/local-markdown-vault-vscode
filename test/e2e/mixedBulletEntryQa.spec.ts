import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const quote of ['', '> ', '> > ']) for (const marker of ['*', '+', '- [ ]', '- [x]']) for (const indent of ['', '    ']) {
	test(`mixed bullet entry keeps sibling depth after resize: ${JSON.stringify({ quote, marker, indent })}`, async ({ page }) => {
		const before = '# Meeting\n\n| Notes | Owner |\n| --- | --- |\n| **Decision**<br>Second line | Team |\n\n';
		const initial = before + (quote ? `${quote}[!warning] Agenda\n` : '## Agenda\n') + (indent ? `${quote}- Parent\n` : '') + `${quote}${indent}${marker} Initial`;
		await mountEditor(page, initial);
		await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
		await page.keyboard.press('Shift+ArrowRight');
		const width = await page.getByRole('separator', { name: 'Resize column 1', exact: true }).getAttribute('aria-valuenow');
		await page.locator('.cm-line', { hasText: 'Initial' }).click(); await page.keyboard.press('End');
		await page.keyboard.press('Enter'); await page.keyboard.type('Sibling **review** with `code`', { delay: 10 });
		await page.keyboard.press('Tab');
		await page.keyboard.press('Enter'); await page.keyboard.type('Sub sibling', { delay: 10 });
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('Peer', { delay: 10 });
		const nextMarker = marker === '- [x]' ? '- [ ]' : marker;
		const expected = initial + `\n${quote}${indent}    ${nextMarker} Sibling **review** with \`code\`\n${quote}${indent}${nextMarker} Sub sibling\n${quote}${indent}${nextMarker} Peer`;
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => {
			const view = el.cmTile.root.view, source = view.state.doc.toString();
			return Math.abs(view.coordsAtPos(source.indexOf('Sub sibling')).left - view.coordsAtPos(source.lastIndexOf('Peer')).left);
		})).toBeLessThan(2);
		await expect(page.getByRole('separator', { name: 'Resize column 1', exact: true })).toHaveAttribute('aria-valuenow', width!);
	});
}
