import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const source = (page: Page) => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
for (const [header, body] of [
	['> - > [!warning]+ Inner', '>   > '],
	['> - Parent\n>     - > [!note]+ Inner', '>       > '],
]) test(`soft-break editing inside list-nested callout: ${header}`, async ({ page }) => {
	const initial = `> [!abstract]+ Meeting\n> Agenda\n>\n${header}\n${body}Review risk`;
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+End`);
	await page.keyboard.press('Shift+Enter');
	for (const char of 'Confirm owner') await page.keyboard.type(char);
	await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace'); await page.keyboard.type('e');
	await expect.poll(() => source(page)).toBe(initial + '\n' + body + 'Confirm owner');
	await expect(page.locator('.cm-line', { hasText: 'Confirm owner' })).toHaveClass(/mlp-line-callout/);
});

for (const width of [520, 1100]) test(`mouse replacement across two inner-callout lines retains the outer meeting at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 900 });
	const initial = '> [!note]+ Meeting\n> Overview\n>\n> - > [!warning]+ Risks\n>   > Review scope.\n>   > Assign owner.\n\nOutside summary.';
	await mountEditor(page, initial);
	const point = async (text: string, end: boolean) => page.locator('.cm-line', { hasText: text }).evaluate((el, args) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node: Node | null;
		while ((node = walker.nextNode())) {
			const from = node.textContent!.indexOf(args.text); if (from < 0) continue;
			const range = document.createRange(); range.setStart(node, from); range.setEnd(node, from + args.text.length);
			// Start inside the first glyph, not on a zero-width hidden-marker edge.
			const box = range.getBoundingClientRect(); return { x: args.end ? box.right - .25 : box.left + 2, y: box.top + box.height / 2 };
		}
		throw new Error('Missing multiline selection target');
	}, { text, end });
	const first = await point('Review scope.', false), last = await point('Assign owner.', true);
	await page.mouse.move(first.x, first.y); await page.mouse.down();
	await page.mouse.move(last.x, last.y, { steps: 20 }); await page.mouse.up();
	const selected = await page.locator('.cm-content').evaluate((el: any) => {
		const state = el.cmTile.root.view.state; return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	});
	expect(selected).toBe('Review scope.\n>   > Assign owner.');
	await page.keyboard.press('Backspace');
	for (const ch of 'Decision approved.') await page.keyboard.type(ch);
	await expect.poll(() => source(page)).toBe(initial.replace(selected, 'Decision approved.'));
	await expect(page.locator('.cm-line', { hasText: 'Decision approved.' })).toHaveClass(/mlp-line-callout/);
	await expect(page.locator('.cm-line', { hasText: 'Outside summary.' })).not.toHaveClass(/mlp-line-callout/);
});

for (const width of [520, 1100]) for (const theme of ['', 'obsidian-dark.css']) test(`meeting redraft with real mouse selection and object edits: ${width}, ${theme || 'default'}`, async ({ page }, info) => {
	await page.setViewportSize({ width, height: 1100 });
	const initial = '# Meetings\n\n> [!abstract]+ Planning\n> Keep this overview.\n>\n> - > [!warning]+ Risks\n>   > Review deployment tomorrow.\n>   >\n>   > - Primary bullet\n>   >     - Child bullet\n>   > - [ ] Confirm owner\n>   >\n>   > | Owner | Status |\n>   > | --- | --- |\n>   > | Alex | Pending |\n>   >\n>   > Closing risk.\n\nOutside summary.';
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	await mountEditor(page, initial, { css: theme ? readFileSync(join(__dirname, '../../media/sample-styles', theme), 'utf8') : undefined });
	const target = 'deployment';
	const row = page.locator('.cm-line', { hasText: 'Review deployment tomorrow.' });
	const points = await row.evaluate((el, target) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const from = node.textContent!.indexOf(target); if (from < 0) continue;
			const range = document.createRange(); range.setStart(node, from); range.setEnd(node, from + target.length);
			const box = range.getBoundingClientRect(); return { x: box.left + .25, end: box.right - .25, y: box.top + box.height / 2 };
		}
		throw new Error('Selection target is missing');
	}, target);
	await page.mouse.move(points.x, points.y); await page.mouse.down();
	await page.mouse.move(points.end, points.y, { steps: 20 }); await page.mouse.up();
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(target);
	await page.keyboard.press('Backspace');
	for (const char of 'pilot') await page.keyboard.type(char);
	let expected = initial.replace('deployment', 'pilot');
	await expect.poll(() => source(page)).toBe(expected);
	await page.keyboard.press('End'); await page.keyboard.press('Shift+Enter');
	for (const char of 'Assign risk owner.') await page.keyboard.type(char);
	expected = expected.replace('>   > Review pilot tomorrow.', '>   > Review pilot tomorrow.\n>   > Assign risk owner.');
	await expect.poll(() => source(page)).toBe(expected);
	await page.locator('.cm-line', { hasText: 'Child bullet' }).click(); await page.keyboard.press('End');
	await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace'); await page.keyboard.type('e');
	await expect.poll(() => source(page)).toBe(expected);
	await page.getByRole('checkbox').click(); expected = expected.replace('[ ] Confirm', '[x] Confirm');
	await expect.poll(() => source(page)).toBe(expected);
	const cell = page.locator('.mlp-table td').last(); await cell.focus(); await page.keyboard.press('F2');
	await expect(cell).toHaveAttribute('contenteditable', 'true');
	for (const char of 'Reviewed') await page.keyboard.type(char);
	await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace'); await page.keyboard.type('e');
	await page.keyboard.press('Enter'); expected = expected.replace('| Alex | Pending |', '| Alex | Reviewed |');
	await expect.poll(() => source(page)).toBe(expected);
	const header = page.getByRole('button', { name: 'Risks callout', exact: true });
	await header.click(); await expect(page.locator('.mlp-table')).toHaveCount(0);
	await header.click(); await expect(page.locator('.mlp-table td').last()).toHaveText('Reviewed');
	await expect.poll(() => source(page)).toBe(expected);
	await page.screenshot({ path: info.outputPath('meeting-redraft.png'), fullPage: true });
	await expect.poll(() => page.evaluate(original => {
		for (const message of (window as any).__posted) if (message.type === 'edit') {
			for (const change of [...message.changes].reverse()) original = original.slice(0, change.from) + change.insert + original.slice(change.to);
		}
		return original;
	}, initial)).toBe(expected);
	expect(errors).toEqual([]);
});
