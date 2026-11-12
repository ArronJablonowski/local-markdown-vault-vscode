import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const nested of [false, true]) for (const touched of [false, true]) {
	test(`${editingMode}: deleting a folded neighbor preserves mixed callout content, nested=${nested}, touched=${touched}`, async ({ page }) => {
		const prefix = nested ? '> > ' : '> ';
		const content = '[!note]+ Meeting\n- [ ] Retained task\n\n| Notes | Owner |\n| --- | --- |\n| **Decision**<br>Follow up | Team |\n\n```js\nconst retained = true;\n```';
		const block = content.split('\n').map(line => prefix + line).join('\n');
		const intro = 'Before\n\n' + (nested ? '> [!abstract]+ Outer\n>\n' : '');
		const separator = nested ? '\n>\n' : '\n\n';
		const source = intro + block + separator + block + '\n\nAfter';
		await mountEditor(page, source, { editingMode });
		const meetings = page.getByRole('button', { name: 'Meeting callout', exact: true });
		await expect(meetings).toHaveCount(2);
		if (touched) { await meetings.nth(1).click(); await meetings.nth(1).click(); }
		await meetings.first().click();
		await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
		await page.keyboard.press('Shift+ArrowRight');
		const width = await page.getByRole('separator', { name: 'Resize column 1', exact: true }).getAttribute('aria-valuenow');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: intro.length, to: intro.length + block.length + separator.length, insert: '' }] });
		await expect(meetings).toHaveCount(1);
		await expect(meetings).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('.mlp-checkbox')).toHaveCount(1);
		await expect(page.locator('.mlp-table td').last()).toHaveText('Team');
		await expect(page.getByRole('separator', { name: 'Resize column 1', exact: true })).toHaveAttribute('aria-valuenow', width!);
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((message: any) => message.type === 'copyCode')?.text)).toBe('const retained = true;');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(intro + block + '\n\nAfter');
	});
}
