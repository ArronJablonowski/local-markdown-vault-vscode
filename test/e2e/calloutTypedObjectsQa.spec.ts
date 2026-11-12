import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const nested of [false, true]) for (const marker of ['+', '-']) for (const type of ['abstract', 'warning', 'tip']) {
	test(`type mixed Markdown through callout soft breaks: ${JSON.stringify({ nested, marker, type })}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const prefix = nested ? '> > ' : '> ';
		const intro = 'Before\n\n' + (nested ? '> [!note]+ Outer\n>\n' : '');
		const header = `${prefix}[!${type}]${marker} Meeting`;
		const original = intro + header + '\n\nOutside';
		const lines = ['**Scope** with [owner](Notes.md) and `code`', '', '| Notes | Owner |', '| --- | --- |', '| **Decision**<br>Follow up | Team |', '', '```js', 'const retained = true;', '```'];
		await mountEditor(page, original);
		await page.locator('.cm-content').evaluate((el: any, anchor) => { const view = el.cmTile.root.view; view.dispatch({ selection: { anchor } }); view.focus(); }, intro.length + header.length);
		for (const line of lines) { await page.keyboard.press('Shift+Enter'); await page.keyboard.type(line, { delay: 5 }); }
		const expected = intro + header + '\n' + lines.map(line => prefix + line).join('\n') + '\n\nOutside';
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
		await page.locator('.cm-line', { hasText: /^Outside$/ }).click();
		const callout = page.getByRole('button', { name: 'Meeting callout', exact: true });
		await expect(callout).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('.mlp-table td').last()).toHaveText('Team');
		await expect.poll(() => page.locator('.mlp-table td').first().evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(34);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus(); await page.keyboard.press('Shift+ArrowRight');
		const width = await handle.getAttribute('aria-valuenow');
		await callout.click(); await expect(page.locator('.mlp-table')).toHaveCount(0);
		await callout.click(); await expect(handle).toHaveAttribute('aria-valuenow', width!);
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((message: any) => message.type === 'copyCode')?.text)).toBe('const retained = true;');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
		expect(errors).toEqual([]);
	});
}
