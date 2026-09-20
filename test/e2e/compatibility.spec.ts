import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const fixture = readFileSync(join(__dirname, '..', 'fixtures', 'obsidian-core.md'), 'utf8');
const notes = [
	{ path: 'Note.md', basename: 'Note', aliases: [], headings: [{ text: 'Details', line: 1 }], blockIds: ['block-1'] },
	{ path: 'Embedded.md', basename: 'Embedded', aliases: [], headings: [], blockIds: [] },
];

type CompatibilityCheck = {
	readonly name: string;
	readonly passes: (page: Page) => Promise<boolean>;
};

async function count(page: Page, selector: string): Promise<boolean> {
	return (await page.locator(selector).count()) > 0;
}

test('renders at least 95 percent of the documented core Obsidian syntax fixture', async ({ page }) => {
	await mountEditor(page, fixture, { vaultNotes: notes, currentVaultPath: 'Compatibility.md' });

	await expect.poll(() => page.evaluate(() =>
		(window as unknown as { __posted: Array<{ type: string }> }).__posted
			.some((message) => message.type === 'readWikiEmbed'))).toBe(true);
	const requestId = await page.evaluate(() =>
		(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
			.find((message) => message.type === 'readWikiEmbed')!.requestId!);
	await postToWebview(page, {
		type: 'wikiEmbed', requestId, sourcePath: 'Embedded.md',
		text: '## Embedded section\n\nRead-only local content.\n',
	});

	const checks: readonly CompatibilityCheck[] = [
		{ name: 'typed YAML properties', passes: (p) => count(p, '.mlp-frontmatter') },
		{ name: 'heading', passes: (p) => count(p, '.mlp-line-h1') },
		{ name: 'strong emphasis', passes: (p) => count(p, '.mlp-strong') },
		{ name: 'emphasis', passes: (p) => count(p, '.mlp-em') },
		{ name: 'strikethrough', passes: (p) => count(p, '.mlp-strikethrough') },
		{ name: 'inline code', passes: (p) => count(p, '.mlp-inline-code') },
		{ name: 'blockquote', passes: (p) => count(p, '.mlp-line-quote') },
		{ name: 'bullet and ordered lists', passes: async (p) => (await p.locator('.mlp-line-list').count()) >= 2 },
		{ name: 'interactive task', passes: (p) => count(p, '.mlp-checkbox') },
		{ name: 'Markdown link', passes: (p) => count(p, '.mlp-link[data-href="https://example.com"]') },
		{ name: 'inline tag', passes: (p) => count(p, '.mlp-tag[data-tag="work/active"]') },
		{ name: 'note wikilink', passes: (p) => count(p, '.mlp-wikilink[data-href="wikilink:Note"]') },
		{ name: 'aliased wikilink', passes: (p) => count(p, '.mlp-wikilink[data-href="wikilink:Note%7CAlias"]') },
		{ name: 'heading wikilink', passes: (p) => count(p, '.mlp-wikilink[data-href="wikilink:Note%23Details"]') },
		{ name: 'block wikilink', passes: (p) => count(p, '.mlp-wikilink[data-href="wikilink:Note%5Eblock-1"]') },
		{ name: 'read-only note embed', passes: (p) => count(p, '.mlp-wiki-note-embed') },
		{ name: 'open-only PDF link', passes: (p) => count(p, '.mlp-wikilink-open-only[data-href="wikilink:Paper.pdf%7CReference%20PDF"]') },
		{ name: 'callout', passes: (p) => count(p, '.mlp-callout-header') },
		{ name: 'inline math', passes: (p) => count(p, '.mlp-math-inline math') },
		{ name: 'block math', passes: (p) => count(p, '.mlp-math-block math') },
		{ name: 'footnote reference', passes: (p) => count(p, '.mlp-footnote-reference') },
		{ name: 'footnote definition', passes: (p) => count(p, '.mlp-footnote-definition-label') },
		{ name: 'GFM table', passes: (p) => count(p, '.mlp-table') },
		{
			name: 'inert raw HTML',
			passes: async (p) => (await p.locator('script').evaluateAll((scripts) =>
				scripts.every((script) => !script.textContent?.includes('__compatibilityAttack')))) &&
				(await p.locator('.cm-content').textContent())?.includes('<script>window.__compatibilityAttack = true</script>') === true &&
				await p.evaluate(() => !(window as unknown as { __compatibilityAttack?: boolean }).__compatibilityAttack),
		},
	];

	const results = await Promise.all(checks.map(async (check) => ({ name: check.name, passed: await check.passes(page) })));
	const failed = results.filter((result) => !result.passed).map((result) => result.name);
	const ratio = (results.length - failed.length) / results.length;
	expect(failed, `Compatibility failures: ${failed.join(', ')}`).toEqual([]);
	expect(ratio).toBeGreaterThanOrEqual(0.95);
});
