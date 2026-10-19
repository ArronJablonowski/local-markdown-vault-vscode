import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
test('successive lines after a soft break preserve continuation depth without growing it', async ({ page }) => {
	const initial = 'Intro\n\n> [!note]+ Meeting\n> - Item 0';
	await mountEditor(page, initial); await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+End`);
	await page.keyboard.press('Shift+Enter'); await page.keyboard.type('More detail');
	await page.keyboard.press('Enter'); await page.keyboard.type('Item 1');
	await page.keyboard.press('Enter'); await page.keyboard.type('Item 2');
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString()))
		.toBe(initial + '\n>   More detail\n>   Item 1\n>   Item 2');
});
test('create a callout and eight bullets entirely through keyboard input', async ({ page }) => {
	await mountEditor(page, ''); await page.locator('.cm-content').focus();
	for (const char of '> [!note]+ Meeting') await page.keyboard.type(char);
	await page.keyboard.press('Shift+Enter');
	for (const char of '- Item 0') await page.keyboard.type(char);
	for (let index = 1; index <= 8; index++) {
		await page.keyboard.press('Enter');
		for (const char of `Item ${index}`) await page.keyboard.type(char);
	}
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString()))
		.toBe('> [!note]+ Meeting\n' + Array.from({ length: 9 }, (_, index) => `> - Item ${index}`).join('\n'));
});
for (const quote of ['', '> ', '> > ', '> - > ']) for (const marker of ['-', '- [ ]']) {
	test(`successive siblings retain source and visual alignment ${JSON.stringify({ quote, marker })}`, async ({ page }) => {
		await page.setViewportSize({ width: 520, height: 1000 });
		const body = quote === '> - > ' ? '>   > ' : quote;
		const first = `Intro\n\n${quote ? `${quote}[!note]+ Meeting\n` : ''}${body}${marker} Item 0`;
		await mountEditor(page, first);
		await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+End`);
		let expected = first;
		for (let index = 1; index <= 8; index++) {
			await page.keyboard.press('Enter'); await page.keyboard.type(`Item ${index}`);
			expected += `\n${body}${marker} Item ${index}`;
			await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
			await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => {
				const view = el.cmTile.root.view;
				const last = view.state.doc.line(view.state.doc.lines), prior = view.state.doc.line(view.state.doc.lines - 1);
				return Math.abs(view.coordsAtPos(last.to - 6).left - view.coordsAtPos(prior.to - 6).left);
			})).toBeLessThanOrEqual(1);
		}
	});
}

for (const indent of ['', '  ', '    ', '\t']) for (const theme of ['', 'obsidian-dark.css']) test(`rapid wrapped callout siblings ${JSON.stringify({ indent, theme })}`, async ({ page }) => {
	await page.setViewportSize({ width: 480, height: 1100 });
	const initial = `Intro\n\n> [!warning]+ Meeting\n${indent ? '> - Parent\n' : ''}> ${indent}- Item 0 has a long wrapped description that must retain its existing indentation and not move each subsequent sibling to the right.`;
	await mountEditor(page, initial, { css: theme ? readFileSync(join(__dirname, '../../media/sample-styles', theme), 'utf8') : '' });
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+End`);
	for (let index = 1; index <= 8; index++) {
		await page.keyboard.press('Enter');
		await page.keyboard.type(`Item ${index} has a long wrapped description that must retain its existing indentation and not move each subsequent sibling to the right.`);
	}
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => {
		const view = el.cmTile.root.view;
		const lines = view.state.doc.toString().split('\n').filter((line: string) => /Item [1-8]/.test(line));
		return new Set(lines.map((line: string) => line.slice(0, line.indexOf('Item')))).size;
	})).toBe(1);
	await page.keyboard.press(`${mod}+Home`);
	const points: number[] = [];
	for (let index = 0; index <= 8; index++) {
		const line = page.locator('.cm-line', { hasText: `Item ${index} has` });
		await line.scrollIntoViewIfNeeded();
		points.push(await line.evaluate(el => {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node: Node | null;
			while ((node = walker.nextNode())) if (node.textContent?.includes('Item ')) {
				const range = document.createRange(); range.setStart(node, node.textContent.indexOf('Item ')); range.setEnd(node, node.textContent.indexOf('Item ') + 1);
				return range.getBoundingClientRect().left;
			}
			throw new Error('Missing list text');
		}));
	}
	expect(Math.max(...points) - Math.min(...points), JSON.stringify(points)).toBeLessThanOrEqual(1);
});
