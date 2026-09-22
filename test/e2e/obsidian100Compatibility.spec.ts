import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

type FixtureRecord = {
	id: number;
	path: string;
	category: string;
	variant: number;
	bytes: number;
	assertions: string[];
	interactions: string[];
};

const root = join(__dirname, '..', 'fixtures', 'obsidian-comparison-100');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
	schemaVersion: number;
	fileCount: number;
	records: FixtureRecord[];
};
const fixture = (record: FixtureRecord) => readFileSync(join(root, record.path), 'utf8');
const vaultNotes = manifest.records.map((record) => ({
	path: record.path,
	basename: record.path.split('/').at(-1)!.replace(/\.md$/, ''),
	aliases: [],
	headings: [{ text: `Compatibility ${String(record.id).padStart(3, '0')}`, line: record.category === 'properties-and-tags' ? 10 : 1 }],
	blockIds: [`block-${record.id}`],
}));
const categories = [
	'basic-formatting',
	'lists-and-tasks',
	'links-and-wikilinks',
	'tables',
	'callouts-and-quotes',
	'properties-and-tags',
	'code-and-literals',
	'math-and-footnotes',
	'embeds-and-navigation',
	'unicode-stress-and-security',
];

test.describe('100-note Obsidian comparison vault', () => {
	test('manifest describes exactly 100 varied, bounded Markdown notes', async () => {
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.fileCount).toBe(100);
		expect(manifest.records).toHaveLength(100);
		expect(new Set(manifest.records.map((record) => record.path)).size).toBe(100);
		expect(new Set(manifest.records.map((record) => record.category)).size).toBe(10);
		expect(Math.min(...manifest.records.map((record) => record.bytes))).toBeLessThan(300);
		expect(Math.max(...manifest.records.map((record) => record.bytes))).toBeGreaterThan(20_000);
	});

	for (const category of categories) {
		test(`renders every ${category} note without browser errors or unsolicited network access`, async ({ page }) => {
			const errors: string[] = [];
			const forbiddenRequests: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('request', (request) => {
				if (request.url().includes('tracker.invalid')) forbiddenRequests.push(request.url());
			});

			for (const record of manifest.records.filter((item) => item.category === category)) {
				await mountEditor(page, fixture(record), {
					currentVaultPath: record.path,
					diagramRenderingAllowed: false,
				});
				await expect(page.locator('.cm-content')).toContainText(`Compatibility ${String(record.id).padStart(3, '0')}`);
				await expect(page.locator('.cm-editor')).toBeVisible();
			}

			expect(errors).toEqual([]);
			expect(forbiddenRequests).toEqual([]);
		});

		test(`renders the representative ${category} note`, async ({ page }) => {
			const record = manifest.records.find((item) => item.category === category && item.variant === 5);
			expect(record).toBeDefined();
			const neededNoteIds = category === 'links-and-wikilinks' ? [35] : category === 'embeds-and-navigation' ? [75, 85] : [];
			await mountEditor(page, fixture(record!), {
				currentVaultPath: record!.path,
				diagramRenderingAllowed: category === 'unicode-stress-and-security',
				vaultNotes: vaultNotes.filter((_note, index) => neededNoteIds.includes(index + 1)),
			});

			switch (category) {
				case 'basic-formatting':
					await expect(page.locator('.mlp-strong')).not.toHaveCount(0);
					await expect(page.locator('.mlp-em')).not.toHaveCount(0);
					await expect(page.locator('.mlp-strikethrough')).not.toHaveCount(0);
					await expect(page.locator('.mlp-highlight')).not.toHaveCount(0);
					break;
				case 'lists-and-tasks':
					await expect(page.locator('.mlp-bullet-2')).not.toHaveCount(0);
					await expect(page.locator('.mlp-bullet-3')).not.toHaveCount(0);
					await expect(page.locator('.mlp-checkbox')).toHaveCount(3);
					await expect(page.locator('.mlp-line-task-complete')).toHaveCount(2);
					break;
				case 'links-and-wikilinks':
					await expect(page.locator('.mlp-wikilink')).toHaveCount(3);
					await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(1);
					break;
				case 'tables':
					await expect(page.locator('.mlp-table')).toHaveCount(1);
					await expect(page.getByRole('row')).toHaveCount(6);
					break;
				case 'callouts-and-quotes':
					await expect(page.getByRole('button', { name: /callout/i })).toHaveCount(3);
					await expect(page.getByRole('button', { name: /Folded tip/i })).toHaveAttribute('aria-expanded', 'false');
					break;
				case 'properties-and-tags':
					await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
					await expect(page.locator('.mlp-property-number')).toHaveCount(1);
					await expect(page.locator('.mlp-property-boolean')).toHaveCount(1);
					await expect(page.locator('.mlp-tag')).toHaveCount(2);
					break;
				case 'code-and-literals':
					await expect(page.locator('.mlp-inline-code')).not.toHaveCount(0);
					await expect(page.getByRole('button', { name: 'Copy code block' })).toHaveCount(2);
					break;
				case 'math-and-footnotes':
					await expect(page.locator('.mlp-math-inline math')).not.toHaveCount(0);
					await expect(page.locator('.mlp-math-block math')).not.toHaveCount(0);
					await expect(page.locator('.mlp-footnote-reference')).not.toHaveCount(0);
					break;
				case 'embeds-and-navigation':
					await expect.poll(() => page.evaluate(() =>
						(window as unknown as { __posted: Array<{ type: string }> }).__posted
							.filter((message) => message.type === 'readWikiEmbed').length)).toBe(2);
					await expect(page.locator('img[src*="tracker.invalid"]')).toHaveCount(0);
					await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(0);
					break;
				case 'unicode-stress-and-security':
					await expect(page.locator('.cm-content')).toContainText('👩🏽‍💻');
					await expect(page.getByRole('button', { name: 'Do not run' })).toHaveCount(0);
					await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
					await expect(page.locator('a[href^="command:"]')).toHaveCount(0);
					break;
			}
		});
	}

	test('keyboard selection, insertion, undo, and redo behave like a Markdown editor', async ({ page }) => {
		await mountEditor(page, 'Alpha bravo charlie');
		const editor = page.locator('.cm-content');
		await page.evaluate(() => {
			document.addEventListener('copy', () => {
				(window as unknown as { __copiedSelection: string }).__copiedSelection = window.getSelection()?.toString() ?? '';
			}, { once: true });
		});
		await editor.click();
		await page.keyboard.press('Home');
		for (let index = 0; index < 5; index += 1) await page.keyboard.press('Shift+ArrowRight');
		expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Alpha');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
		expect(await page.evaluate(() => (window as unknown as { __copiedSelection: string }).__copiedSelection)).toBe('Alpha');
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.insertText('Alpha');
		await expect(editor).toContainText('Alpha bravo charlieAlpha');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted
				.filter((message) => message.type === 'undo' || message.type === 'redo')
				.map((message) => message.type),
		)).toEqual(['undo', 'redo']);
	});

	test('keyboard list, task, highlight, and code-block flows match the documented Obsidian behavior', async ({ page }) => {
		await mountEditor(page, '3. Ordered\n\n- Parent\n- Child\n\n- [ ] Task\n\n==highlighted==\n\n```text\ncode\n```');

		await page.locator('.cm-line', { hasText: 'Ordered' }).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await expect(page.locator('.cm-line', { hasText: '4.' })).toHaveCount(1);

		await page.locator('.cm-line', { hasText: 'Child' }).click();
		await page.keyboard.press('Tab');
		await page.locator('.cm-line', { hasText: 'Ordered' }).click();
		await expect(page.locator('.mlp-bullet-2')).toHaveCount(1);

		const checkbox = page.getByRole('checkbox');
		await checkbox.focus();
		await page.keyboard.press('Space');
		await expect(page.locator('.cm-line', { hasText: 'Task' })).toHaveCSS('text-decoration-line', 'line-through');

		await page.locator('.mlp-highlight').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await page.keyboard.type('after highlight');
		await expect(page.locator('.cm-line', { hasText: 'after highlight' })).not.toHaveClass(/mlp-line-code/);

		await page.locator('.cm-line', { hasText: 'code' }).click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await page.keyboard.type('after code');
		await expect(page.locator('.cm-line', { hasText: 'after code' })).not.toHaveClass(/mlp-line-code/);
	});
});
