import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const [name, content, formatted] of [
	['mixed safe emphasis', '<strong>**Safe**</strong> <em>detail</em> <kbd>Enter</kbd>', true],
	['raw active HTML', '<strong>Safe</strong><script>window.__tableExecuted=1</script><img src="https://tracker.invalid/pixel" onerror="window.__tableExecuted=1"><svg onload="window.__tableExecuted=1"></svg>', true],
	['attributed emphasis', '<strong onclick="window.__tableExecuted=1">Safe</strong>', false],
	['CSS impersonation', '<kbd class="mlp-mode-toggle" style="position:fixed">Safe</kbd>', false],
	['navigation attribute', '<em data-href="command:evil">Safe</em>', false],
	['encoded formatting', '&lt;strong&gt;Safe&lt;/strong&gt;', false],
	['code example', '`<strong>Safe</strong>`', false],
	['depth limit', '<strong>'.repeat(33) + 'Safe' + '</strong>'.repeat(33), false],
] as const) {
	test(`${editingMode}: table list ${name} remains safe beside a callout and YAML`, async ({ page }) => {
		const requests: string[] = []; const errors: string[] = [];
		page.on('request', request => requests.push(request.url())); page.on('pageerror', error => errors.push(error.message));
		const code = Array.from({ length: 9 }, (_, n) => `key_${n}: retained`).join('\n');
		const body = '- [ ] Review\n\n```yaml\n' + code + '\n```\n\n| Notes | State |\n| --- | --- |\n| <ul><li>' + content + '</li></ul> | Retained |';
		const source = '# Formatting security\n\n> [!warning]+ Meeting\n>\n' + body.split('\n').map(line => '> ' + line).join('\n') + '\n\nOutside';
		await mountEditor(page, source, { editingMode });
		const cell = page.locator('.mlp-table td').first();
		if (formatted) await expect(cell.locator('strong').first()).toContainText('Safe');
		else await expect(cell.locator('strong, em, kbd')).toHaveCount(0);
		await expect(cell.locator('script, img, svg, iframe, a[href], [onclick], [onload], [onerror], [style], [data-href]')).toHaveCount(0);
		await expect(cell).toContainText('Safe');
		expect(await page.evaluate(() => (window as any).__tableExecuted)).toBeUndefined();
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source);
		expect(requests).toEqual([]); expect(errors).toEqual([]);
	});
}
