import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';

const checklist = '<ul><li>Confirm the process identity</li><li>Review the parent process</li><li>Check the connection</li></ul>';
const note = (cell: string) => `Intro\n\n| Actions | Result |\n| --- | --- |\n| ${cell} | Neighbor stays |\n\nAfter`;

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}

test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
});

for (const themed of [false, true]) {
	test(`HTML unordered lists render compact, properly indented table items, theme=${themed}`, async ({ page }, info) => {
		const css = themed ? readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8') : '';
		const original = note(checklist);
		await mountEditor(page, original, { css });
		const cell = page.locator('.mlp-table td').first();
		await expect(cell.locator('ul.mlp-cell-list > li')).toHaveText([
			'Confirm the process identity', 'Review the parent process', 'Check the connection',
		]);
		expect(await cell.innerText()).not.toContain('<li>');
		const geometry = await cell.evaluate(element => {
			const list = element.querySelector('ul')!;
			const items = Array.from(list.children);
			const style = getComputedStyle(list);
			return { marginTop: style.marginTop, marginBottom: style.marginBottom, marker: style.listStyleType,
				padding: parseFloat(style.paddingLeft), font: parseFloat(style.fontSize),
				lefts: items.map(item => item.getBoundingClientRect().left),
				gaps: items.slice(1).map((item, index) => item.getBoundingClientRect().top - items[index].getBoundingClientRect().bottom) };
		});
		expect(geometry.marginTop).toBe('0px');
		expect(geometry.marginBottom).toBe('0px');
		expect(geometry.marker).toBe('disc');
		expect(geometry.padding).toBeGreaterThan(geometry.font);
		expect(Math.max(...geometry.lefts) - Math.min(...geometry.lefts)).toBeLessThanOrEqual(1);
		expect(Math.max(...geometry.gaps)).toBeLessThanOrEqual(1);
		expect(await source(page)).toBe(original);
		await page.screenshot({ path: info.outputPath('rendered-table-list.png') });
	});
}

test('nested table lists preserve inline formatting and distinct bullet levels', async ({ page }) => {
	const nested = '<ul><li>Outer **bold**<ul><li>Middle `code`<ul><li>Inner [note](Note.md)</li></ul></li></ul></li><li>Next<ol><li>First</li><li>Second</li></ol></li></ul>';
	await mountEditor(page, note(nested));
	const cell = page.locator('.mlp-table td').first();
	await expect(cell.locator('li')).toHaveCount(6);
	await expect(cell.locator('strong')).toHaveText('bold');
	await expect(cell.locator('code')).toHaveText('code');
	await expect(cell.locator('a')).toHaveAttribute('data-href', 'Note.md');
	await expect(cell.locator('a')).not.toHaveAttribute('href');
	expect(await cell.locator('ul').evaluateAll(lists => lists.map(list => getComputedStyle(list).listStyleType))).toEqual(['disc', 'circle', 'square']);
	expect(await cell.locator('ol').evaluate(list => getComputedStyle(list).listStyleType)).toBe('decimal');
	const lefts = await cell.locator('ul').evaluateAll(lists => lists.map(list => list.getBoundingClientRect().left));
	expect(lefts[1]).toBeGreaterThan(lefts[0]);
	expect(lefts[2]).toBeGreaterThan(lefts[1]);
});

test('table list headings and surrounding prose retain their content', async ({ page }) => {
	const original = 'Intro\n\n| <ul><li>Header A</li><li>Header B</li></ul> | Other |\n| --- | --- |\n| Before<ul><li>One<br>continued</li><li>Two</li></ul>After | Keep |\n\nEnd';
	await mountEditor(page, original);
	await expect(page.locator('.mlp-table th').first().locator('li')).toHaveText(['Header A', 'Header B']);
	const cell = page.locator('.mlp-table td').first();
	await expect(cell.locator('li')).toHaveText(['Onecontinued', 'Two']);
	await expect(cell.locator('br')).toHaveCount(1);
	await expect(cell).toHaveText('BeforeOnecontinuedTwoAfter');
	expect(await source(page)).toBe(original);
});

test('escaped and code-formatted list examples stay literal inside tables', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n| Code | Escaped |\n| --- | --- |\n| `<ul><li>Literal</li></ul>` | \\<ul\\>\\<li\\>Escaped\\</li\\>\\</ul\\> |\n\nAfter');
	await expect(page.locator('.mlp-table td ul, .mlp-table td li')).toHaveCount(0);
	await expect(page.locator('.mlp-table td code')).toHaveText('<ul><li>Literal</li></ul>');
	await expect(page.locator('.mlp-table td').last()).toHaveText('<ul><li>Escaped</li></ul>');
});

test('malformed list structure and attributes cannot create active table markup', async ({ page }) => {
	const values = [
		'<ul onclick="window.__tableListExecuted=true"><li>Attributes</li></ul>',
		'<ul><li style="position:fixed">Styled</li></ul>',
		'<ul><li>Unclosed</ul>',
		'<ul><li>Wrong close</li></ol>',
		'<li>Orphan</li>',
	];
	const original = `Intro\n\n| Case |\n| --- |\n${values.map(value => `| ${value} |`).join('\n')}\n\nAfter`;
	await mountEditor(page, original);
	await expect(page.locator('.mlp-table td')).toHaveText(values);
	await expect(page.locator('.mlp-table td ul, .mlp-table td li, .mlp-table td [onclick], .mlp-table td [style]')).toHaveCount(0);
	expect(await page.evaluate(() => (window as any).__tableListExecuted)).toBeUndefined();
	expect(await source(page)).toBe(original);
});

test('unrelated HTML inside a table list remains inert with no remote request', async ({ page }) => {
	const requests: string[] = [];
	await page.route('**/table-list-tracker.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
	const hostile = '<ul><li><img src="https://table-list-tracker.invalid/pixel" onerror="window.__tableListExecuted=true"></li><li><script>window.__tableListExecuted=true</script></li></ul>';
	await mountEditor(page, note(hostile));
	const cell = page.locator('.mlp-table td').first();
	await expect(cell.locator('img, script, svg, iframe, [onerror]')).toHaveCount(0);
	await expect(cell).toContainText('<img');
	await expect(cell).toContainText('<script>');
	expect(await page.evaluate(() => (window as any).__tableListExecuted)).toBeUndefined();
	expect(requests).toEqual([]);
});

test('table list source survives no-op editing, cancellation, and a committed replacement', async ({ page }) => {
	const original = note(checklist);
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.focus();
	await page.keyboard.press('F2');
	await expect(cell).toHaveText(checklist);
	await page.keyboard.press('Enter');
	await expect(cell.locator('li')).toHaveCount(3);
	expect(await source(page)).toBe(original);
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Discard this draft');
	await page.keyboard.press('Escape');
	await expect(cell.locator('li')).toHaveCount(3);
	expect(await source(page)).toBe(original);
	const replacement = '<ul><li>Changed **first**</li><li>New second</li></ul>';
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type(replacement);
	await page.keyboard.press('Enter');
	await expect(cell.locator('li')).toHaveText(['Changed first', 'New second']);
	await expect.poll(() => source(page)).toBe(original.replace(checklist, replacement));
	await expect(page.locator('.mlp-table td').last()).toHaveText('Neighbor stays');
});

test('editing a neighboring cell and adding a row preserve authored list syntax', async ({ page }) => {
	await mountEditor(page, note(checklist));
	const neighbor = page.locator('.mlp-table td').last();
	await neighbor.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Updated neighbor');
	await page.keyboard.press('Enter');
	await page.locator('.mlp-table-add-row').click();
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(2);
	await expect(page.locator('.mlp-table td').first().locator('li')).toHaveCount(3);
	expect(await source(page)).toContain(`| ${checklist} | Updated neighbor |`);
});

test('copying a selected table keeps list source rather than flattened rendered text', async ({ page }) => {
	await mountEditor(page, note(checklist));
	await page.getByRole('button', { name: 'Table options', exact: true }).click();
	await page.getByRole('button', { name: 'Select entire table', exact: true }).click();
	// This event-local transfer never touches the user's operating-system clipboard.
	const copied = await page.locator('.mlp-table-wrap').evaluate(element => {
		const data = new DataTransfer();
		element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
		return data.getData('text/plain');
	});
	expect(copied).toBe(`| Actions | Result |\n| --- | --- |\n| ${checklist} | Neighbor stays |`);
});

test('embedded note tables use the same safe, compact list renderer', async ({ page }) => {
	const original = 'Intro\n\n![[Targets/List note]]\n\nAfter';
	await mountEditor(page, original, { vaultNotes: [
		{ path: 'Targets/List note.md', basename: 'List note', aliases: [], headings: [], blockIds: [] },
	] });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'readWikiEmbed').length)).toBe(1);
	const request = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed'));
	await postToWebview(page, { type: 'wikiEmbed', requestId: request.requestId, sourcePath: 'Targets/List note.md',
		text: `| Action |\n| --- |\n| ${checklist} |` });
	const table = page.locator('.mlp-embed-table');
	await expect(table.locator('li')).toHaveText([
		'Confirm the process identity', 'Review the parent process', 'Check the connection',
	]);
	await expect(table.locator('ul')).toHaveCSS('margin-top', '0px');
	await expect(table.locator('ul')).toHaveCSS('list-style-type', 'disc');
	await expect(table.locator('[contenteditable="true"]')).toHaveCount(0);
	expect(await source(page)).toBe(original);
});

test('sticky list headers preserve height and horizontal alignment in a large wide table', async ({ page }) => {
	await page.setViewportSize({ width: 550, height: 620 });
	const headings = Array.from({ length: 8 }, (_, column) => `<ul><li>Header ${column}</li><li>Additional heading ${column}</li></ul>`);
	const rows = Array.from({ length: 45 }, (_, row) => `| ${headings.map((_, column) => `<ul><li>Row ${row} column ${column}</li><li>Detail</li></ul>`).join(' | ')} |`);
	await mountEditor(page, `Intro\n\n| ${headings.join(' | ')} |\n| ${headings.map(() => '---').join(' | ')} |\n${rows.join('\n')}\n\nAfter`, { stickyTableHeaders: true });
	const wrap = page.locator('.mlp-table-wrap');
	await expect(wrap.locator('.mlp-table th li')).toHaveCount(16);
	await expect(wrap.locator('.mlp-table-viewport')).toHaveClass(/mlp-table-scrollable/);
	for (const top of [200, 700]) {
		await page.locator('.cm-scroller').evaluate((element, scrollTop) => { element.scrollTop = scrollTop; }, top);
		await expect(wrap.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
		for (const left of [0, 400, 10000]) {
			await wrap.locator('.mlp-table-viewport').evaluate((element, scrollLeft) => { element.scrollLeft = scrollLeft; }, left);
			await expect.poll(() => wrap.evaluate(element => {
				const original = Array.from(element.querySelectorAll('.mlp-table th'));
				const sticky = Array.from(element.querySelectorAll('.mlp-sticky-table th'));
				return Math.max(...original.flatMap((cell, index) => {
					const a = cell.getBoundingClientRect(), b = sticky[index].getBoundingClientRect();
					return [Math.abs(a.left - b.left), Math.abs(a.width - b.width), Math.abs(a.height - b.height)];
				}));
			})).toBeLessThanOrEqual(2);
		}
	}
});
