import { expect, test } from '@playwright/test';
import { mountEditorWithExpandedYaml as mountEditor } from './harness';

for (const language of ['yaml', 'yml']) for (const nested of [false, true]) for (const editingMode of ['editing', 'locked'] as const) {
	test(`${language} code displays literally and copies completely, nested=${nested}, ${editingMode}`, async ({ page }) => {
		const requests: string[] = []; page.on('request', request => requests.push(request.url()));
		const code = '---\nservice:\n  name: local-vault\n  enabled: true\n  port: 8080\ntags:\n  - notes\n  - local\nhtml: \'<img src="https://tracker.invalid/yaml" onerror="alert(1)">\'';
		const fence = '```' + language + '\n' + code + '\n```';
		const source = '# YAML example\n\n' + (nested ? '> [!note]+ Configuration\n>\n> ' + fence.split('\n').join('\n> ') : fence) + '\n\nAfter';
		await mountEditor(page, source, { editingMode });
		await expect(page.locator('.mlp-code-language')).toHaveText(language);
		await expect(page.locator('.mlp-frontmatter, .cm-content img[src*="tracker.invalid"]')).toHaveCount(0);
		await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((message: any) => message.type === 'copyCode')?.text)).toBe(code);
		await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
		await expect(page.locator('.cm-content')).toContainText('local-vault');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source);
		expect(requests).toEqual([]);
	});
}
