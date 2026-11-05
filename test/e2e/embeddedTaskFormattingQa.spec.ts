import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const quoted of [false, true]) for (const marker of ['x', 'X', ' ']) {
	test(`${editingMode}: embedded [${marker}] tasks preserve labels and nested state, quote=${quoted}`, async ({ page }) => {
		const original = 'Before\n\n![[Tasks]]\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Tasks.md', basename: 'Tasks', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		const tasks = `- [${marker}] **Review** and *confirm*\n  - [ ] Child \`code\`\n- [ ] [Follow up](Notes.md)`;
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Tasks.md', text:
			'# Agenda\n\n' + tasks.split('\n').map(line => (quoted ? '> ' : '') + line).join('\n') + '\n\n| Owner |\n| --- |\n| **Alex** |\n\n```text\n[x] literal task\n```' });
		const embed = page.locator('.mlp-wiki-embed-content');
		const checkboxes = embed.getByRole('checkbox');
		await expect(checkboxes).toHaveCount(3);
		for (const checkbox of await checkboxes.all()) await expect(checkbox).toBeDisabled();
		if (marker === ' ') await expect(checkboxes.first()).not.toBeChecked();
		else await expect(checkboxes.first()).toBeChecked();
		await expect(checkboxes.nth(1)).not.toBeChecked();
		await expect(embed.locator('.mlp-embed-task > span')).toHaveText(['Review and confirm', 'Child code', 'Follow up']);
		await expect(embed.locator('.mlp-embed-task > span').first()).toHaveCSS('text-decoration-line', marker === ' ' ? 'none' : 'line-through');
		await expect(embed.locator('ul ul .mlp-embed-task > span')).toHaveCSS('text-decoration-line', 'none');
		await expect(embed.locator('.mlp-embed-task a')).toHaveAttribute('data-href', 'Notes.md');
		await expect(embed.locator('table strong')).toHaveText('Alex');
		await expect(embed.locator('pre code')).toHaveText('[x] literal task');
		await expect(embed.locator('pre input')).toHaveCount(0);
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'Revised' }] });
		await expect(page.locator('.mlp-wiki-embed-content .mlp-embed-task > span')).toHaveText(['Review and confirm', 'Child code', 'Follow up']);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Before', 'Revised'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
