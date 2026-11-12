import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const count of [1000, 8000, 20000]) for (const nested of [false, true]) {
	test(`opening ${count}-line YAML, callout=${nested}, folds the complete block and preserves neighbors`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const code = Array.from({ length: count }, (_, i) => `item_${i}: "Review configuration ${i}"`).join('\n');
		const block = '```yaml\n' + code + '\n```';
		const source = '# Large YAML\n\n' + (nested ? '> [!warning]+ Configuration\n>\n' + block.split('\n').map(line => '> ' + line).join('\n') : block)
			+ '\n\n- [ ] Review\n    - Follow up\n\n| Notes | State |\n| --- | --- |\n| Preserved | Retained |\n\nEnd';
		await mountEditor(page, source);
		await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible({ timeout: 10000 });
		await expect(page.locator('.cm-content')).toContainText('item_5:');
		await expect(page.locator('.cm-content')).not.toContainText('item_6:');
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((m: any) => m.type === 'copyCode')?.text)).toBe(code);
		await expect(page.locator('.mlp-table td').last()).toHaveText('Retained');
		expect(await page.locator('.cm-content').evaluate((element: any) => element.cmTile.root.view.state.doc.toString())).toBe(source);
		expect(errors).toEqual([]);
	});
}
