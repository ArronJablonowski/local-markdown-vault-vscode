import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const contexts = [['## Configuration', ''], ['> [!note]+ Configuration', '> '], ['> [!abstract]+ Outer\n>\n> > [!warning]+ Configuration', '> > '], ['- > [!tip]+ Configuration', '  > ']];
for (const [header, prefix] of contexts) for (const target of ['YAML', 'bullet', 'table']) for (const remove of [false, true]) {
	test(`host undo/redo round trip preserves mixed objects: ${JSON.stringify({ header, target, remove })}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const code = 'service:\n  name: demo\n  enabled: true\nports:\n  - 8080\n  - 8443\ndescription: |\n  Literal Markdown\n  **Retained**';
		const body = '- [ ] Task review\n    - Nested detail\n\n```yaml\n' + code + '\n```\n\n| Notes | Owner |\n| --- | --- |\n| Seed | Team |\n' + '| Retained | Alex |\n'.repeat(7).trimEnd();
		const source = '# Mixed history QA\n\n' + header + '\n' + body.split('\n').map(line => prefix + line).join('\n') + '\n\nOutside';
		await mountEditor(page, source);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus(); for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
		await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		const original = target === 'YAML' ? 'true' : target === 'bullet' ? 'Task review' : 'Seed';
		const replacement = remove ? '' : target === 'YAML' ? 'false' : target === 'bullet' ? '**Task** review with `code`' : '**Seed**<br>Detail';
		const from = source.indexOf(original), expected = source.slice(0, from) + replacement + source.slice(from + original.length);
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to: from + original.length, insert: replacement }] });
		const read = () => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
		await expect.poll(read).toBe(expected);
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		const history = () => page.evaluate(() => (window as any).__posted.filter((message: any) => ['undo', 'redo'].includes(message.type)).map((message: any) => message.type));
		await page.getByRole('button', { name: 'Expand table', exact: true }).focus();
		await page.keyboard.press(`${mod}+z`); await expect.poll(history).toEqual(['undo']);
		// The host owns history. Replay its inverse edit through the real boundary.
		await postToWebview(page, { type: 'externalUpdate', version: 2, changes: [{ from, to: from + replacement.length, insert: original }] });
		await expect.poll(read).toBe(source);
		await page.getByRole('button', { name: 'Expand table', exact: true }).focus();
		await page.keyboard.press(`${mod}+Shift+z`); await expect.poll(history).toEqual(['undo', 'redo']);
		await postToWebview(page, { type: 'externalUpdate', version: 3, changes: [{ from, to: from + original.length, insert: replacement }] });
		await expect.poll(read).toBe(expected);
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
		await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveCount(1);
		await page.getByRole('button', { name: 'Expand table', exact: true }).click();
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(8);
		await expect(page.locator('.mlp-table td').last()).toHaveText('Alex');
		expect(errors).toEqual([]);
	});
}
