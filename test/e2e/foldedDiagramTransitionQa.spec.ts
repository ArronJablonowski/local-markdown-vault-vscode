import { expect, test, type Page } from '@playwright/test';
import { mountEditor, openSearch, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const diagrams = {
	mermaid: 'graph TD\nA --> B\nB --> C\nC --> D\nD --> E\nE --> F\nF --> G\nG --> H\nH --> I',
	drawio: '<mxGraphModel>\n<root>\n<mxCell id="0"/>\n<mxCell id="1" parent="0"/>\n<mxCell id="2" value="QA node" vertex="1" parent="1">\n<mxGeometry x="20" y="20" width="160" height="60" as="geometry"/>\n</mxCell>\n</root>\n</mxGraphModel>',
};
async function find(page: Page, text: string) {
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill(text);
	await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
}

for (const [language, body] of Object.entries(diagrams)) for (const nested of [false, true]) {
	test(`locked ${language} source expands after an external language change, nested=${nested}`, async ({ page }) => {
		const block = '```text\n' + body + '\n```';
		const original = 'Intro\n\n' + (nested ? '> [!note] Container\n>\n' + block.split('\n').map(line => '> ' + line).join('\n') : block) + '\n\nAfter sentinel';
		await mountEditor(page, original, { editingMode: 'locked' });
		await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		const from = original.indexOf('text');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to: from + 4, insert: language }] });
		await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
		await page.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
		await expect(page.locator('.cm-content')).toContainText(body.split('\n').at(-1)!);
		await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);
		await page.keyboard.type('Must not be saved');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('```text', '```' + language));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}

test('revealing a converted diagram leaves an unrelated code block folded through later edits', async ({ page }) => {
	const sibling = '```js\n' + Array.from({ length: 9 }, (_, i) => `const sibling_${i} = ${i};`).join('\n') + '\n```';
	const original = 'Intro\n\n```text\n' + diagrams.mermaid + '\n```\n\n' + sibling + '\n\nAfter sentinel';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Collapse all collapsible objects', exact: true }).click();
	await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(2);
	await find(page, 'text'); await page.keyboard.type('mermaid', { delay: 10 });
	await find(page, 'After sentinel'); await page.keyboard.press('ArrowRight');
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
	await page.locator('.mlp-mermaid-wrap').getByRole('button', { name: 'Switch to code mode', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('H --> I');
	await expect(page.locator('.cm-content')).not.toContainText('const sibling_8');
	await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
	await find(page, 'H --> I'); await page.keyboard.press('ArrowRight'); await page.keyboard.type(';');
	await find(page, 'After sentinel'); await page.keyboard.press('ArrowRight');
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('```text', '```mermaid').replace('H --> I', 'H --> I;'));
	await expect(page.locator('.cm-content')).not.toContainText('const sibling_8');
});

for (const [language, body] of Object.entries(diagrams)) for (const nested of [false, true]) for (const global of [false, true]) {
	test(`collapsed code becomes ${language} with complete source, nested=${nested}, global=${global}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const block = '```text\n' + body + '\n```';
		const original = 'Intro\n\n' + (nested ? '> [!note] Container\n>\n' + block.split('\n').map(line => '> ' + line).join('\n') : block) + '\n\nAfter sentinel';
		await mountEditor(page, original);
		await page.getByRole('button', { name: global ? 'Collapse all collapsible objects' : 'Collapse code block', exact: true }).click();
		if (nested && global) await expect(page.getByRole('button', { name: 'Container callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
		else await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
		await find(page, 'text');
		await page.keyboard.type(language, { delay: 10 });
		await find(page, 'After sentinel'); await page.keyboard.press('ArrowRight');
		await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
		await page.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
		await expect(page.locator('.cm-content')).toContainText(body.split('\n').at(-1)!);
		await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('```text', '```' + language));
		expect(errors).toEqual([]);
	});
}
