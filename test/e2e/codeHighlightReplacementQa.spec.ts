import { expect, test, type Page } from '@playwright/test';
import type { CodeBlockTokens } from '../../src/shared/messages';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const objects = '\n\n# Clipboard report\n\n**Strong**, *emphasis*, `code`, $x^2$ and :smile:.\n\n'
	+ '- First item\n  - Nested item\n- [ ] Pending task\n\n'
	+ '| Name | Value |\n| --- | --- |\n| Original | Keep |\n\n'
	+ '> [!warning]+ Review\n> Callout with **bold**.\n>\n> - Nested list\n\n'
	+ '```typescript\n\tconst retained = 42;\n```\n\n'
	+ '```mermaid\nflowchart LR\nA[Start] --> B[End]\n```\n\n'
	+ '```drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>\n```\n\nEND_OBJECTS';

function tokensFor(doc: string): CodeBlockTokens[] {
	return [...doc.matchAll(/```typescript\n([^]*?)\n```/g)].map(match => {
		const start = match.index! + '```typescript\n'.length;
		return {
			from: match.index!, to: match.index! + match[0].length,
			// Model a host tokenizer with many adjacent spans, not a token-free stub.
			tokens: Array.from(match[1], (_char, index) => ({
				from: start + index, to: start + index + 1, style: index % 2 ? 'color:#569cd6' : 'color:#c586c0',
			})),
		};
		});
}
async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate((element: any) => element.cmTile.root.view.state.doc.toString());
}

for (const removeFirst of [false, true]) {
	test(`replacing a 265 KB host-highlighted mixed note ${removeFirst ? 'after Delete' : 'by typing'} remains editable`, async ({ page }, testInfo) => {
		test.setTimeout(90_000);
		const errors: string[] = [];
		page.on('pageerror', error => errors.push(String(error)));
		page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
		const doc = 'Large clipboard report\n\n' + objects.repeat(600);
		expect(doc.length).toBeGreaterThan(260_000);
		await mountEditor(page, doc);
		await postToWebview(page, { type: 'codeTokens', blocks: tokensFor(doc) });
		await expect(page.locator('.cm-content [style*="569cd6"], .cm-content [style*="86, 156, 214"]').first()).toBeVisible();
		await page.locator('.cm-content').focus();
		await page.keyboard.press(`${mod}+a`);
		if (removeFirst) await page.keyboard.press('Backspace');
		await page.keyboard.type('SINK_UNIQUE');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Fresh uncolored prose remains editable.');
		await testInfo.attach('runtime-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
		expect(errors).toEqual([]);
		expect(await source(page)).toBe('SINK_UNIQUE\nFresh uncolored prose remains editable.');
		await expect(page.locator('.cm-content [style*="569cd6"], .cm-content [style*="86, 156, 214"]')).toHaveCount(0);
		await page.screenshot({ path: testInfo.outputPath('large-replacement.png') });
		await page.keyboard.press(`${mod}+z`);
		await page.keyboard.press(`${mod}+Shift+z`);
		expect(await source(page)).toBe('SINK_UNIQUE\nFresh uncolored prose remains editable.');
		expect(errors).toEqual([]);
	});
}

test('editing one highlighted fence does not spread stale color or drop unrelated code highlighting', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(String(error)));
	page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
	const doc = 'Intro\n\n```typescript\nconst first = 1;\n```\n\n```typescript\nconst second = 2;\n```\n\nTail';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'codeTokens', blocks: tokensFor(doc) });
	await postToWebview(page, { type: 'jumpToLine', line: 4 });
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.type('let replacement = 3;');
	const expected = doc.replace('const first = 1;', 'let replacement = 3;');
	expect(await source(page)).toBe(expected);
	const editedLine = page.locator('.cm-line').filter({ hasText: 'let replacement = 3;' });
	await expect(editedLine.locator('[style*="color"]')).toHaveCount(0);
	const otherLine = page.locator('.cm-line').filter({ hasText: 'const second = 2;' });
	await expect(otherLine.locator('[style*="color"]').first()).toBeVisible();
	// The real host cannot return fresh tokens until it has received all text edits.
	await expect.poll(() => page.evaluate(initialLength => (window as any).__posted
		.filter((message: any) => message.type === 'edit')
		.reduce((length: number, message: any) => message.changes.reduce((value: number, change: any) => value + change.insert.length - (change.to - change.from), length), initialLength), doc.length)).toBe(expected.length);
	await postToWebview(page, { type: 'codeTokens', blocks: tokensFor(expected) });
	expect(errors).toEqual([]);
	await expect(editedLine.locator('[style*="color"]').first()).toBeVisible();
	expect(errors).toEqual([]);
});

test('a cross-block keyboard replacement drops overlapping old marks and preserves earlier code', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(String(error)));
	page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
	const doc = 'Intro\n\n```typescript\nconst first = 1;\n```\n\n```typescript\nconst second = 2;\n```\n\n```typescript\nconst third = 3;\n```\n\nTail';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'codeTokens', blocks: tokensFor(doc) });
	await postToWebview(page, { type: 'jumpToLine', line: 8 });
	await page.keyboard.press('Home');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+ArrowDown' : 'Control+Shift+End');
	const selected = await page.locator('.cm-content').evaluate((element: any) => {
		const state = element.cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	});
	expect(selected).toBe(doc.slice(doc.indexOf('const second')));
	await page.keyboard.type('Replacement across two old code blocks.');
	expect(await source(page)).toBe(doc.slice(0, doc.indexOf('const second')) + 'Replacement across two old code blocks.');
	await expect(page.locator('.cm-line').filter({ hasText: 'Replacement across two old code blocks.' }).locator('[style*="color"]')).toHaveCount(0);
	await expect(page.locator('.cm-line').filter({ hasText: 'const first = 1;' }).locator('[style*="color"]').first()).toBeVisible();
	expect(errors).toEqual([]);
});
