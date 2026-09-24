import { test, expect, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';

const words = Array.from({ length: 40 }, (_, i) => `Wrap${String(i).padStart(2, '0')}`).join(' ');

async function wrappedEdges(line: Locator): Promise<number[]> {
	return line.evaluate(element => {
		const rows = new Map<number, number>();
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			for (const match of node.textContent!.matchAll(/Wrap\d+/g)) {
				const range = document.createRange();
				range.setStart(node, match.index!);
				range.setEnd(node, match.index! + 1);
				const rect = range.getBoundingClientRect();
				const top = Math.round(rect.top);
				rows.set(top, Math.min(rows.get(top) ?? Infinity, rect.left));
			}
		}
		return [...rows].sort((a, b) => a[0] - b[0]).map(row => row[1]);
	});
}

async function expectAligned(line: Locator): Promise<void> {
	await expect.poll(async () => {
		const edges = await wrappedEdges(line);
		return edges.length > 1 ? Math.max(...edges) - Math.min(...edges) : Infinity;
	}).toBeLessThan(1.5);
}

for (const theme of ['', 'obsidian-dark.css', 'github-like.css']) {
	for (const editingMode of ['editing', 'locked'] as const) {
		test(`wrapped bullets, numbers, and tasks align with their text: ${theme || 'default'}, ${editingMode}`, async ({ page }, info) => {
			await page.setViewportSize({ width: 520, height: 1800 });
			const text = `Intro\n\n- ${words}\n  - ${words}\n    - ${words}\n\n123. ${words}\n\n- [ ] ${words}\n- [x] ${words}\n\nAfter`;
			await mountEditor(page, text, { editingMode, css: theme ? readFileSync(join(__dirname, '../../media/sample-styles', theme), 'utf8') : '' });
			for (const width of [520, 380, 640]) {
				await page.setViewportSize({ width, height: 1800 });
				const rows = page.locator('.cm-line[data-mlp-list-text-offset]');
				await expect(rows).toHaveCount(6);
				for (const row of await rows.all()) await expectAligned(row);
			}
			await page.screenshot({ path: info.outputPath('hanging-indent.png') });
		});
	}
}

test('hanging indentation follows source reveal, inline formatting, themes, and Tab/Shift+Tab', async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 1200 });
	await mountEditor(page, `Intro\n\n- Parent\n- Wrap00 **Wrap01** ${words.slice(14)}\n\nAfter`);
	const line = page.locator('.cm-line').filter({ hasText: 'Wrap00' });
	await expectAligned(line);
	await line.click();
	await page.keyboard.press('Home');
	await expectAligned(line);
	await page.keyboard.press('Tab');
	await expectAligned(line);
	await page.keyboard.press('Shift+Tab');
	await expectAligned(line);
	await postToWebview(page, { type: 'applyCss', css: 'body { font-family: Arial; font-size: 19px; } ul { padding-left: 35px; }' });
	await expectAligned(line);
	await page.locator('.cm-line', { hasText: 'After' }).click();
	await expectAligned(line);
});

test('quoted callout bullets wrap without moving the callout panel or neighboring text', async ({ page }) => {
	await page.setViewportSize({ width: 450, height: 1200 });
	await mountEditor(page, `Intro\n\n> [!warning] Review\n> - ${words}\n>   - ${words}\n>\n> Ordinary callout paragraph.\n\nAfter`);
	const lines = page.locator('.cm-line[data-mlp-list-text-offset]');
	await expect(lines).toHaveCount(2);
	for (const line of await lines.all()) await expectAligned(line);
	const boxes = await page.locator('.mlp-line-callout').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().left));
	expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(1);
	await expect(page.locator('.cm-line', { hasText: 'After' })).not.toHaveAttribute('style', /text-indent/);
});

test('removing and retyping a bullet restores ordinary paragraph wrapping without stale indentation', async ({ page }) => {
	await page.setViewportSize({ width: 450, height: 1000 });
	await mountEditor(page, `- ${words}`);
	const line = page.locator('.cm-line').filter({ hasText: 'Wrap00' });
	await expectAligned(line);
	await page.locator('.cm-content').focus();
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Backspace');
	await expect(line).not.toHaveAttribute('data-mlp-list-text-offset');
	await expect.poll(() => line.evaluate(el => (el as HTMLElement).style.textIndent)).toBe('');
	await expectAligned(line);
	await page.keyboard.type('- ');
	await expect(line).toHaveAttribute('data-mlp-list-text-offset', '2');
	await expectAligned(line);
});
