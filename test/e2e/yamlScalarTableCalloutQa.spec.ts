import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const bodies = [
	['literal Markdown', 'description: |\n  # Literal heading\n  > [!warning] Literal callout\n  - [ ] Literal task\n  | A | B |\n  | --- | --- |\n  ```text\n  literal code\n  ```\n  ~~~\nenabled: true'],
	['folded scalar', 'description: >+\n  **Literal emphasis** and [link](Notes.md)\n\n  Another paragraph.\n\nservice:\n  enabled: false\n  ports: [8080, 8443]\n  note: "# not a tag"'],
	['anchors', 'defaults: &defaults\n  enabled: true\n  retries: 3\nservices:\n  first:\n    <<: *defaults\n  second:\n    <<: *defaults\n    retries: 5'],
	['multiple documents', '---\nname: first\nitems:\n  - notes\n  - reports\n...\n---\nname: second\nhtml: \'<img src="https://tracker.invalid/yaml">\''],
];
const contexts = [['## Configuration', ''], ['> [!note]+ Configuration', '> '], ['> [!abstract]+ Outer\n>\n> > [!warning]+ Configuration', '> > '], ['1. > [!tip]+ Configuration', '   > ']];
for (const editingMode of ['editing', 'locked'] as const) for (const [header, prefix] of contexts) for (const fence of ['````', '~~~~']) for (const [name, code] of bodies) {
	test(`${editingMode}: ${name} with ${fence} remains literal beside resized table, ${header}`, async ({ page }) => {
		const errors: string[] = [], requests: string[] = [];
		page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
		await page.setViewportSize({ width: 480, height: 1100 });
		const content = '- [ ] Review configuration\n    - Compare details\n\n' + fence + 'yaml\n' + code + '\n' + fence + '\n\n| Notes | Owner |\n| --- | --- |\n| <ul><li>First detailed meeting decision<ul><li>Nested review details</li></ul></li></ul> | Team |';
		const source = '---\ntitle: Scalar QA\n---\n\n' + header + '\n' + content.split('\n').map(line => prefix + line).join('\n') + '\n\nOutside';
		await mountEditor(page, source, { editingMode, stickyTableHeaders: true });
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
		await expect(page.locator('.mlp-line-code .mlp-bullet, .mlp-line-code .mlp-checkbox, .mlp-frontmatter-error, .cm-content img[src*="tracker.invalid"]')).toHaveCount(0);
		await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((message: any) => message.type === 'copyCode')?.text)).toBe(code);
		const first = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await first.focus(); for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		const cell = page.locator('.mlp-table td').first();
		const narrow = await cell.evaluate(cell => cell.getBoundingClientRect().height);
		await expect(first).toHaveAttribute('aria-valuenow', '64');
		const second = page.getByRole('separator', { name: 'Resize column 2', exact: true });
		await second.focus(); for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowRight');
		await expect(second).toHaveAttribute('aria-valuenow', '2000');
		await page.locator('.mlp-table-viewport').evaluate(viewport => { viewport.scrollLeft = 300; });
		await expect.poll(() => page.locator('.mlp-table').evaluate(table => {
			const a = table.querySelector('th')!.getBoundingClientRect(), b = table.querySelector('td')!.getBoundingClientRect();
			return Math.max(Math.abs(a.left - b.left), Math.abs(a.width - b.width));
		})).toBeLessThan(2);
		await page.locator('.mlp-table-viewport').evaluate(viewport => { viewport.scrollLeft = 0; });
		await first.focus(); for (let n = 0; n < 10; n++) await page.keyboard.press('Shift+ArrowRight');
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeLessThan(narrow);
		await expect(page.locator('.mlp-table td').last()).toHaveText('Team');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source);
		expect(errors).toEqual([]); expect(requests).toEqual([]);
	});
}
