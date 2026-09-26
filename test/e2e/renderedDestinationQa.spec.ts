import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) {
	test(`modified table link clicks navigate once without editing the cell in ${editingMode} mode`, async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| Link |\n| --- |\n| [Table note](<Notes/Meeting notes.md>) |\n', { editingMode });
		const link = page.getByRole('link', { name: 'Table note', exact: true });
		for (const modifier of ['Meta', 'Control'] as const) {
			await link.click({ modifiers: [modifier] });
			await expect(page.locator('.mlp-table-cell-editing')).toHaveCount(0);
		}
		await expect.poll(() => page.evaluate(() => (window as any).__posted
			.filter((message: any) => message.type === 'openLink').map((message: any) => message.href)))
			.toEqual(['Notes/Meeting notes.md', 'Notes/Meeting notes.md']);
		expect(await page.evaluate(() => (window as any).__posted.some((message: any) => message.type === 'edit'))).toBe(false);
	});

	test(`angle-wrapped and escaped destinations navigate consistently in ${editingMode} mode`, async ({ page }) => {
		await mountEditor(page, [
			'Intro', '',
			'[Meeting](<Notes/Meeting notes.md>)', '',
			String.raw`[Draft](Notes/Topic\(draft\).md)`, '',
			'[Reference][notes]', '',
			'| Link |', '| --- |',
			'| [Table meeting](<Notes/Meeting notes.md>) |',
			String.raw`| [Table draft](Notes/Topic\(draft\).md) |`, '',
			'[notes]: <Notes/Meeting notes.md>', '',
		].join('\n'), { editingMode });
		const targets = [
			['Meeting', 'Notes/Meeting notes.md'],
			['Draft', 'Notes/Topic(draft).md'],
			['Reference', 'Notes/Meeting notes.md'],
			['Table meeting', 'Notes/Meeting notes.md'],
			['Table draft', 'Notes/Topic(draft).md'],
		];
		for (const [label, destination] of targets) {
			const link = page.getByRole('link', { name: label, exact: true });
			await expect(link).toHaveAttribute('data-href', destination);
			await link.focus();
			await page.keyboard.press('Enter');
			await expect.poll(() => page.evaluate(() => (window as any).__posted
				.filter((message: any) => message.type === 'openLink').at(-1)?.href)).toBe(destination);
		}
		const edits = await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'));
		expect(edits).toEqual([]);
	});
}

test('angle-wrapped local image paths reach the existing authorization boundary without wrappers', async ({ page }) => {
	await mountEditor(page, [
		'Intro', '',
		String.raw`![Body image](<Assets/Body image\(draft\).png>)`, '',
		'| Image |', '| --- |',
		String.raw`| ![Table image](<Assets/Table image\(draft\).png>) |`, '',
	].join('\n'), { currentVaultPath: 'Home.md' });
	await expect.poll(() => page.evaluate(() => (window as any).__posted
		.filter((message: any) => message.type === 'resolveLocalImage').map((message: any) => message.src).sort()))
		.toEqual(['Assets/Body image(draft).png', 'Assets/Table image(draft).png']);
	// Without an authorized host response, neither local path becomes a resource.
	for (const image of await page.locator('.mlp-image').all()) await expect(image).not.toHaveAttribute('src');
});

test('embedded tables keep columns aligned around escaped pipes and trailing literal pipes', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n![[Grid]]\n', {
		currentVaultPath: 'Home.md',
		vaultNotes: [{ path: 'Grid.md', basename: 'Grid', aliases: [], headings: [], blockIds: [] }],
	});
	await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
	const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
	await postToWebview(page, {
		type: 'wikiEmbed', requestId, sourcePath: 'Grid.md', text: [
			'| Left | Middle | Right |', '| --- | --- | --- |',
			String.raw`| A\\| B | C |`,
			String.raw`X|Y|Z\|`,
		].join('\n'),
	});
	const rows = page.locator('.mlp-embed-table tbody tr');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0).locator('td')).toHaveText(['A\\', 'B', 'C']);
	await expect(rows.nth(1).locator('td')).toHaveText(['X', 'Y', 'Z|']);
});

test('normalizing wrapped hostile destinations never creates native browser links or fetches blocked media', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', request => requests.push(request.url()));
	await mountEditor(page, [
		'Intro', '',
		'[Command](<command:workbench.action.closeWindow>) [Script](<javascript:alert(1)>)', '',
		'![Remote](<https://tracker.invalid/pixel.png>) ![Data](<data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=>)', '',
		'| Link | Image |', '| --- | --- |',
		String.raw`| [Escaped command](command\:workbench.action.closeWindow) | ![Table data](<data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=>) |`,
	].join('\n'), { currentVaultPath: 'Home.md' });
	for (const link of await page.locator('.mlp-link').all()) await expect(link).not.toHaveAttribute('href');
	for (const image of await page.locator('.mlp-image').all()) await expect(image).not.toHaveAttribute('src');
	expect(requests).toEqual([]);
	await page.getByRole('link', { name: 'Command', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect.poll(() => page.evaluate(() => (window as any).__posted
		.filter((message: any) => message.type === 'openLink').at(-1)?.href)).toBe('command:workbench.action.closeWindow');
	// Activation still crosses the host policy boundary; it cannot run a webview URL.
	expect(requests).toEqual([]);
});
