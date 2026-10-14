import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

// Exercise real key events: continuing a list must preserve its quote and indent.
for (const quote of ['', '> ', '> > ']) {
	for (const indent of ['', '    ', '\t']) {
		for (const marker of ['-', '*', '+', '- [ ]', '- [x]']) {
			test(`Enter preserves sibling alignment ${JSON.stringify({ quote, indent, marker })}`, async ({ page }) => {
				const header = quote ? `${quote}[!note]+ Meeting\n` : '';
				const parent = indent ? `${quote}- Parent\n` : '';
				const initial = `Intro\n\n${header}${parent}${quote}${indent}${marker} First decision`;
				await mountEditor(page, initial);
				await page.locator('.cm-content').focus();
				await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
				await page.keyboard.press('Enter');
				await expect.poll(() => page.locator('.cm-content').evaluate(el => {
					const view = (el as any).cmTile.root.view;
					const caret = view.coordsAtPos(view.state.selection.main.head);
					const prior = view.state.doc.line(view.state.doc.lines - 1);
					const text = view.coordsAtPos(prior.to - 'First decision'.length);
					return caret && text ? Math.abs(caret.left - text.left) : Infinity;
				})).toBeLessThanOrEqual(1);
				await page.keyboard.type('Next decision', { delay: 12 });
				await expect.poll(() => page.locator('.cm-content').evaluate(el => {
					const view = (el as any).cmTile.root.view;
					const last = view.state.doc.line(view.state.doc.lines);
					const prior = view.state.doc.line(view.state.doc.lines - 1);
					const a = view.coordsAtPos(prior.to - 'First decision'.length);
					const b = view.coordsAtPos(last.to - 'Next decision'.length);
					return a && b ? Math.abs(a.left - b.left) : Infinity;
				})).toBeLessThanOrEqual(1);
				const nextMarker = marker === '- [x]' ? '- [ ]' : marker;
				await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
					.toBe(`${initial}\n${quote}${indent === '\t' ? ' '.repeat(4 - quote.length % 4) : indent}${nextMarker} Next decision`);
				// Moving away reveals both rendered markers instead of comparing source text to a widget.
				await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
				const first = page.locator('.cm-line', { hasText: 'First decision' });
				const next = page.locator('.cm-line', { hasText: 'Next decision' });
				const selector = marker.includes('[') ? '[role=checkbox]' : '.mlp-bullet';
				await expect(first.locator(selector)).toBeVisible();
				await expect(next.locator(selector)).toBeVisible();
				const a = await first.locator(selector).boundingBox();
				const b = await next.locator(selector).boundingBox();
				expect(Math.abs(a!.x - b!.x)).toBeLessThanOrEqual(1);
			});
		}
	}
}
