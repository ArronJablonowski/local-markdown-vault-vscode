import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const contexts = [['## Configuration', ''], ['> [!warning]+ Configuration', '> '], ['> [!note]+ Outer\n>\n> > [!tip]+ Configuration', '> > '], ['- > [!abstract]+ Configuration', '  > ']];
for (const [header, prefix] of contexts) for (const language of ['yaml', 'yml']) for (const edit of ['boolean', 'list']) {
	test(`YAML ${edit} edit preserves mixed objects: ${JSON.stringify({ header, language })}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const code = 'service:\n  name: local-vault\n  enabled: true\npaths:\n  - notes\n  - reports\ndescription: |\n  **Literal** text\n  More detail';
		const content = '- [ ] Review configuration\n    - Compare values\n\n```' + language + '\n' + code + '\n```\n\n| Notes | Owner |\n| --- | --- |\n| <ul><li>First<ul><li>Nested detail</li></ul></li></ul> | Team |';
		const source = '---\ntitle: YAML mixed QA\n---\n\n' + header + '\n' + content.split('\n').map(line => prefix + line).join('\n') + '\n\nOutside';
		await mountEditor(page, source);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus(); for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		await page.locator('.cm-line', { hasText: edit === 'boolean' ? 'enabled: true' : '- reports' }).click();
		await page.keyboard.press('End');
		for (let n = 0; n < (edit === 'boolean' ? 4 : 7); n++) await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.type(edit === 'boolean' ? 'false' : 'archive', { delay: 20 });
		const expected = source.replace(edit === 'boolean' ? 'enabled: true' : '- reports', edit === 'boolean' ? 'enabled: false' : '- archive');
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
		await page.locator('.cm-line', { hasText: /^Outside$/ }).click();
		await expect(page.locator('.mlp-line-code .mlp-bullet, .mlp-line-code .mlp-checkbox')).toHaveCount(0);
		await expect(page.locator('.mlp-checkbox')).toHaveCount(1);
		await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((message: any) => message.type === 'copyCode')?.text)).toBe(code.replace(edit === 'boolean' ? 'enabled: true' : '- reports', edit === 'boolean' ? 'enabled: false' : '- archive'));
		if (prefix) { const callout = page.getByRole('button', { name: 'Configuration callout', exact: true }); await callout.click(); await expect(page.locator('.mlp-table')).toHaveCount(0); await callout.click(); }
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		await expect.poll(() => page.locator('.mlp-table td').first().evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(34);
		expect(errors).toEqual([]);
	});
}
