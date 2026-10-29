import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const note = '# Start\n\n<div><p>Evidence</p><details><summary>Details</summary><p>Retained detail</p></details></div>\n\nAfter sentinel';

for (const mode of ['editing', 'locked'] as const) for (const target of ['p', 'summary']) {
	test(`HTML ${target} opens the note Find panel in ${mode}`, async ({ page }) => {
		await mountEditor(page, note, { editingMode: mode });
		await page.locator(`.mlp-safe-html ${target}`).first().click();
		await page.keyboard.press(`${mod}+f`);
		await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
	});
	for (const [key, action] of [['z', 'undo'], ['Shift+z', 'redo'], ['y', 'redo']]) {
		test(`HTML ${target} routes ${key} once through ordered history in ${mode}`, async ({ page }) => {
			await mountEditor(page, note, { editingMode: mode });
			await page.evaluate(() => {
				(window as any).__historyKeys = [];
				window.addEventListener('keydown', event => {
					if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) (window as any).__historyKeys.push(event.key);
				});
			});
			await page.locator(`.mlp-safe-html ${target}`).first().click();
			await page.keyboard.press(`${mod}+${key}`);
			await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => ['undo', 'redo'].includes(message.type)).map((message: any) => message.type))).toEqual(mode === 'editing' ? [action] : []);
			expect(await page.evaluate(() => (window as any).__historyKeys)).toEqual([]);
			expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(note);
		});
	}
}

for (const field of ['prose', 'property', 'nested table']) test(`HTML Undo waits for every ${field} edit acknowledgment`, async ({ page }) => {
	const original = '---\ntitle: Original\n---\n\nProse sentinel\n\n> [!note] Outer\n>\n> > [!warning] Inner\n> >\n> > | Owner | State |\n> > | --- | --- |\n> > | Original | Keep |\n\n<div><p>Evidence</p></div>';
	await mountEditor(page, original);
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	if (field === 'prose') {
		await page.locator('.cm-line', { hasText: /^Prose sentinel$/ }).click();
		await page.keyboard.press('End'); await page.keyboard.type(' Reviewed');
	} else {
		const cell = field === 'property' ? page.locator('.mlp-frontmatter tr', { hasText: 'title' }).locator('td') : page.locator('.mlp-table tbody td').first();
		await cell.focus(); await page.keyboard.press('F2');
		await page.keyboard.press(`${mod}+a`); await page.keyboard.type('Reviewed');
	}
	await page.locator('.mlp-safe-html p').click();
	await page.keyboard.press(`${mod}+z`);
	const expected = field === 'prose' ? original.replace('Prose sentinel', 'Prose sentinel Reviewed')
		: field === 'property' ? original.replace('title: Original', 'title: Reviewed') : original.replace('| Original |', '| Reviewed |');
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'undo'))).toEqual([]);
	let hostText = original, acknowledged = 0;
	for (let turn = 0; turn < 50; turn++) {
		const messages = await page.evaluate(() => (window as any).__posted);
		const edit = messages.filter((message: any) => message.type === 'edit')[acknowledged];
		if (edit) {
			for (const change of [...edit.changes].reverse()) hostText = hostText.slice(0, change.from) + change.insert + hostText.slice(change.to);
			acknowledged++;
			await postToWebview(page, { type: 'ackEdit', version: edit.baseVersion + 1 });
		} else if (messages.some((message: any) => message.type === 'undo')) break;
		else await page.waitForTimeout(20);
	}
	expect(hostText).toBe(expected);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'undo').length)).toBe(1);
});
