import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';

const root = join(__dirname, '../fixtures/complex-qa');
const notes = [
	{ path: 'Targets/Linked Note.md', basename: 'Linked Note', aliases: ['Property Fixture'], headings: [{ text: 'Detailed section', line: 8 }], blockIds: ['linked-block'] },
	{ path: 'Targets/Embed Source.md', basename: 'Embed Source', aliases: [], headings: [{ text: 'Selected heading', line: 5 }], blockIds: ['selected-block', 'selected-list'] },
];
async function answerEmbeds(page: Page, seen: Set<string>): Promise<void> {
	const requests = await page.evaluate(() => (window as any).__posted.filter((m: any) => ['readWikiEmbed', 'readDrawioFile', 'resolveLocalImage'].includes(m.type)));
	for (const request of requests) {
		const key = `${request.type}:${request.requestId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (request.type === 'readDrawioFile') await postToWebview(page, { type: 'drawioFile', requestId: request.requestId,
			text: readFileSync(join(root, 'assets/local-architecture.drawio'), 'utf8') });
		else if (request.type === 'resolveLocalImage') await postToWebview(page, { type: 'localImage', requestId: request.requestId,
			mimeType: 'image/png', dataBase64: readFileSync(join(root, 'assets/local-icon.png')).toString('base64') });
		else await postToWebview(page, { type: 'wikiEmbed', requestId: request.requestId,
			sourcePath: 'Targets/Embed Source.md', text: readFileSync(join(root, 'Targets/Embed Source.md'), 'utf8') });
	}
}

for (const name of readdirSync(root).filter(n => n.endsWith('.md'))) {
	for (const editingMode of ['editing', 'locked'] as const) {
		test(`complex note ${name} renders through a complete scroll in ${editingMode} mode`, async ({ page }, testInfo) => {
			test.setTimeout(90000);
			const errors: string[] = [];
			const requests: string[] = [];
			page.on('pageerror', error => errors.push(error.message));
			page.on('request', request => {
				if (/^https?:/.test(request.url()) && !/example\.invalid\/(mermaid-chunk\.js|aws4-shapes\.json)$/.test(request.url())) requests.push(request.url());
			});
			await mountEditor(page, readFileSync(join(root, name), 'utf8'), { editingMode, vaultNotes: notes, currentVaultPath: name });
			const seen = new Set<string>();
			const rendered = new Set<string>();
			for (let step = 0; step < 120; step++) {
				await answerEmbeds(page, seen);
				await page.waitForTimeout(80);
				await expect(page.locator('.mlp-mermaid-error, .mlp-math-error')).toHaveCount(0);
				for (const selector of ['.mlp-table', '.mlp-mermaid-wrap svg', '.mlp-drawio-wrap svg', '.mlp-math math', '.mlp-checkbox', '.mlp-frontmatter']) {
					if (await page.locator(selector).count()) rendered.add(selector);
				}
				const end = await page.locator('.cm-scroller').evaluate(el => {
					if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return true;
					el.scrollTop += 450;
					return false;
				});
				if (end) break;
			}
			for (const selector of ['.mlp-table', '.mlp-mermaid-wrap svg', '.mlp-drawio-wrap svg']) expect(rendered.has(selector), selector).toBe(true);
			expect(errors).toEqual([]);
			expect(requests).toEqual([]);
			await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = 0; });
			await page.screenshot({ path: testInfo.outputPath(`${name}-${editingMode}.png`) });
		});
	}
}

test('an embedded wide table scrolls without widening its parent note', async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 700 });
	await mountEditor(page, 'Intro\n\n![[Targets/Embed Source]]\n\nAfter', { vaultNotes: notes });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'readWikiEmbed').length)).toBe(1);
	const request = await page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed'));
	const source = '| '+ Array.from({length: 12}, (_,i) => `Long column ${i}`).join(' | ')+' |\n| '+Array(12).fill('---').join(' | ')+' |\n| '+Array(12).fill('Readable content').join(' | ')+' |';
	await postToWebview(page, { type: 'wikiEmbed', requestId: request.requestId, sourcePath: 'Targets/Embed Source.md', text: source });
	await expect(page.locator('.mlp-embed-table')).toBeVisible();
	await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(2);
	const viewport = page.locator('.mlp-wiki-note-embed .mlp-table-viewport');
	await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth; });
	expect(await viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
});

async function bringIntoView(page: Page, target: Locator): Promise<void> {
	await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = 0; });
	await page.waitForTimeout(80);
	for (let step = 0; step < 100; step++) {
		if (await target.count()) { await target.scrollIntoViewIfNeeded(); return; }
		await page.locator('.cm-scroller').evaluate(el => { el.scrollTop += 400; });
		await page.waitForTimeout(30);
	}
	throw new Error(`Could not find ${target}`);
}

test('properties, tables, tasks, and diagrams stay interactive after preceding content changes', async ({ page }) => {
	test.setTimeout(60000);
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await mountEditor(page, readFileSync(join(root, '01-research-workbench.md'), 'utf8'), { vaultNotes: notes });
	const published = page.locator('.mlp-frontmatter tr', { hasText: 'published' }).locator('input');
	await published.click();
	await expect(published).not.toBeChecked();
	const priority = page.locator('.mlp-frontmatter tr', { hasText: 'priority' }).locator('td');
	await priority.focus();
	await page.keyboard.press('F2');
	await priority.locator('input').fill('17');
	await priority.locator('input').press('Enter');
	await expect(priority).toHaveText('17');
	const table = page.locator('.mlp-table-wrap').filter({ hasText: 'Feature' });
	await bringIntoView(page, table);
	await table.locator('td').first().focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('**Updated**<br>Second line');
	await page.keyboard.press('Enter');
	await expect(table.locator('td').first().locator('strong')).toHaveText('Updated');
	const task = page.locator('.mlp-checkbox').first();
	await bringIntoView(page, task);
	await task.click();
	await expect(task).toHaveClass(/mlp-checkbox-checked/);
	const mermaid = page.locator('.mlp-mermaid-wrap:not(.mlp-drawio-wrap)').first();
	await bringIntoView(page, mermaid);
	await expect(mermaid.locator('svg')).toBeVisible({ timeout: 15000 });
	await expect(mermaid.locator('svg')).toContainText('NOTE');
	await mermaid.getByRole('button', { name: 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)', exact: true }).click();
	await mermaid.getByRole('button', { name: 'Zoom in (Ctrl+wheel also works)', exact: true }).click();
	await expect(mermaid.locator('.mlp-mermaid-canvas')).toHaveAttribute('style', /scale\(1.2\)/);
	await mermaid.getByRole('button', { name: 'Reset the view (fit to width)', exact: true }).click();
	const drawio = page.locator('.mlp-drawio-wrap').first();
	await bringIntoView(page, drawio);
	await expect(drawio.locator('svg')).toContainText('Editor');
	await drawio.getByRole('button', { name: 'Next page', exact: true }).click();
	await expect(drawio.locator('svg')).toContainText('Preview');
	await drawio.getByRole('button', { name: 'Previous page', exact: true }).press('Enter');
	await expect(drawio.locator('svg')).toContainText('Editor');
	await drawio.locator('.mlp-code-mode-btn').click();
	await expect(page.locator('.cm-content')).toContainText('<mxfile>');
	expect(errors).toEqual([]);
});

test('embedded tables preserve alignment and rectangular rows', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n![[Targets/Embed Source]]\n\nAfter', { vaultNotes: notes });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'readWikiEmbed').length)).toBe(1);
	const request = await page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed'));
	await postToWebview(page, { type: 'wikiEmbed', requestId: request.requestId, sourcePath: 'Targets/Embed Source.md', text: '| Left | Center | Right |\n| :--- | :---: | ---: |\n| one |\n| a | b | c | extra |' });
	const cells = page.locator('.mlp-embed-table tbody tr').first().locator('td');
	await expect(cells).toHaveCount(3);
	for (const [index, align] of ['left', 'center', 'right'].entries()) await expect(cells.nth(index)).toHaveCSS('text-align', align);
	await expect(page.locator('.mlp-embed-table tbody tr').last().locator('td')).toHaveCount(3);
});

for (const themeKind of ['dark', 'light'] as const) {
	test(`Mermaid entity tables have readable connectors in ${themeKind} mode`, async ({ page }, testInfo) => {
		await mountEditor(page, 'Intro\n\n```mermaid\nerDiagram\nNOTE ||--o{ LINK : contains\nNOTE {\n string path PK\n string title\n}\nLINK {\n string target\n}\n```\n\nAfter', { themeKind });
		if (themeKind === 'light') await page.addStyleTag({ content: ':root { --vscode-editor-background: #fff; --vscode-editor-foreground: #222; } html, body { background: #fff; }' });
		const svg = page.locator('.mlp-mermaid-wrap svg');
		await expect(svg).toBeVisible();
		await expect(svg).toContainText('path');
		const strokes = await svg.locator('path').evaluateAll(paths => paths.map(path => getComputedStyle(path).stroke).filter(stroke => stroke !== 'none'));
		expect(strokes.length).toBeGreaterThan(0);
		if (themeKind === 'dark') expect(strokes.some(stroke => stroke !== 'rgb(0, 0, 0)' && stroke !== 'rgb(51, 51, 51)')).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`entity-table-${themeKind}.png`) });
	});
}

for (const source of [
	'Intro\n\n> [!info] Diagram callout\n>\n> ```mermaid\n> flowchart LR\n> A[Start] --> B[End]\n> ```\n\nAfter',
	'Intro\n\n- Diagram item\n\n  ```mermaid\n  flowchart LR\n  A[Start] --> B[End]\n  ```\n\nAfter',
]) {
	test(`nested Mermaid renders within ${source.includes('callout') ? 'a callout' : 'a list'}`, async ({ page }) => {
		await mountEditor(page, source);
		await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.mlp-mermaid-error')).toHaveCount(0);
		await page.locator('.mlp-mermaid-wrap .mlp-code-mode-btn').click();
		await expect(page.locator('.mlp-mermaid-wrap')).toHaveCount(0);
		await expect(page.locator('.cm-content')).toContainText('flowchart LR');
	});
}

for (const prefix of ['> ', '  ']) {
	test(`nested draw.io renders and reveals source with ${prefix === '> ' ? 'quoted' : 'indented'} content`, async ({ page }) => {
		const xml = readFileSync(join(root, 'assets/local-architecture.drawio'), 'utf8');
		const source = 'Intro\n\n' + (prefix === '> ' ? '> [!info] Diagram\n>\n' : '- Diagram\n\n')
			+ ['```drawio', ...xml.trimEnd().split('\n'), '```'].map(line => prefix + line).join('\n') + '\n\nAfter';
		await mountEditor(page, source);
		await expect(page.locator('.mlp-drawio-wrap svg')).toContainText('Editor');
		await page.locator('.mlp-drawio-wrap .mlp-code-mode-btn').click();
		await expect(page.locator('.mlp-drawio-wrap')).toHaveCount(0);
		await expect(page.locator('.cm-content')).toContainText('<mxfile>');
	});
}
