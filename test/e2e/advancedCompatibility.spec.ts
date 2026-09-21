import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const fixtureRoot = join(__dirname, '..', 'fixtures', 'obsidian-advanced');
const fixture = (name: string) => readFileSync(join(fixtureRoot, name), 'utf8');
const notes = [
	{ path: 'Targets/Linked Note.md', basename: 'Linked Note', aliases: ['Linked Alias'], headings: [{ text: 'Detailed section', line: 2 }], blockIds: ['linked-block'] },
	{ path: 'Targets/Embed Source.md', basename: 'Embed Source', aliases: [], headings: [{ text: 'Selected heading', line: 2 }], blockIds: ['selected-block', 'selected-list'] },
	{ path: '03-properties.md', basename: '03-properties', aliases: ['Property Fixture', 'Typed Metadata'], headings: [], blockIds: [] },
];

test.describe('checked-in Obsidian advanced compatibility vault', () => {
	test('renders advanced inline formatting, highlight, tags, and quote structure', async ({ page }) => {
		await mountEditor(page, fixture('00-formatting.md'));
		await page.getByText('Paragraph with a block identifier.').click();
		await expect(page.locator('.mlp-strong')).not.toHaveCount(0);
		await expect(page.locator('.mlp-em')).not.toHaveCount(0);
		await expect(page.locator('.mlp-strikethrough')).toHaveCount(1);
		await expect(page.locator('.mlp-highlight')).toHaveText('highlighted text');
		await expect(page.locator('.mlp-line-quote')).toHaveCount(3);
		await expect(page.locator('.mlp-tag')).toHaveCount(2);
	});

	test('renders nested marker shapes and every Obsidian task status', async ({ page }) => {
		await mountEditor(page, fixture('01-lists-and-tasks.md'));
		await expect(page.locator('.mlp-bullet-1')).not.toHaveCount(0);
		await expect(page.locator('.mlp-bullet-2')).not.toHaveCount(0);
		await expect(page.locator('.mlp-bullet-3')).not.toHaveCount(0);
		await expect(page.locator('.mlp-checkbox')).toHaveCount(5);
		await expect(page.locator('.mlp-checkbox-checked')).toHaveCount(3);
	});

	test('renders all documented callout families and folding controls', async ({ page }) => {
		await mountEditor(page, fixture('02-callouts.md'), { vaultNotes: notes, currentVaultPath: '02-callouts.md' });
		await expect(page.locator('.mlp-callout-note')).not.toHaveCount(0);
		await expect(page.locator('.mlp-callout-tip')).not.toHaveCount(0);
		await expect(page.locator('.mlp-callout-success')).not.toHaveCount(0);
		await page.locator('.cm-scroller').evaluate((scroller) => { scroller.scrollTop = scroller.scrollHeight; });
		await expect(page.locator('.mlp-callout-danger')).not.toHaveCount(0);
		await expect(page.locator('.mlp-callout-example')).not.toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Collapsed by default callout' })).toHaveAttribute('aria-expanded', 'false');
	});

	test('renders typed properties from the YAML fixture', async ({ page }) => {
		await mountEditor(page, fixture('03-properties.md'), { vaultNotes: notes, currentVaultPath: '03-properties.md' });
		await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
		await expect(page.locator('.mlp-property-boolean')).toHaveCount(2);
		await expect(page.locator('.mlp-property-number')).toHaveCount(2);
		await expect(page.locator('.mlp-property-date')).not.toHaveCount(0);
		await expect(page.locator('.mlp-property-tag')).toHaveCount(2);
	});

	test('resolves advanced wikilinks and requests local embeds from the host', async ({ page }) => {
		await mountEditor(page, fixture('04-links-and-embeds.md'), { vaultNotes: notes, currentVaultPath: '04-links-and-embeds.md' });
		await expect(page.locator('.mlp-wikilink')).not.toHaveCount(0);
		await expect(page.locator('.mlp-wikilink-unresolved[data-href="wikilink:A%20note%20that%20does%20not%20exist"]')).toHaveCount(1);
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted
				.filter((message) => message.type === 'readWikiEmbed').length)).toBe(4);
	});

	test('renders the advanced table, math, and footnote fixture', async ({ page }) => {
		await mountEditor(page, fixture('05-tables-math-and-footnotes.md'), { vaultNotes: notes, currentVaultPath: '05-tables-math-and-footnotes.md' });
		await expect(page.locator('.mlp-table')).toHaveCount(1);
		await expect(page.locator('.mlp-math-inline math')).not.toHaveCount(0);
		await expect(page.locator('.mlp-math-block math')).not.toHaveCount(0);
		await expect(page.locator('.mlp-footnote-reference')).toHaveCount(2);
		await expect(page.locator('.mlp-footnote-definition-label')).toHaveCount(2);
	});

	test('keeps the malicious comparison fixture inert and offline', async ({ page }) => {
		const requests: string[] = [];
		page.on('request', (request) => requests.push(request.url()));
		await mountEditor(page, fixture('07-security-differences.md'));
		await expect(page.locator('.cm-content')).toContainText("Raw HTML button");
		await expect(page.getByRole('button', { name: 'Raw HTML button' })).toHaveCount(0);
		await expect(page.locator('img[src*="tracker.invalid"]')).toHaveCount(0);
		await expect.poll(() => requests.filter((url) => url.includes('tracker.invalid')).length).toBe(0);
	});
});
