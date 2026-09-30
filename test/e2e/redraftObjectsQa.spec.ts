import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountEditor } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

test.use({ actionTimeout: 10000 });

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const model = (label: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"><mxGeometry x="20" y="20" width="240" height="80" as="geometry"/></mxCell></root></mxGraphModel>`;
const diagrams = {
	er: 'erDiagram\n    REPORT ||--o{ REVISION : contains\n    REPORT {\n        string title\n        int revision_count\n    }\n    REVISION {\n        string author\n        string summary\n    }',
	class: 'classDiagram\n    class DraftReport {\n        +String title\n        +int revisionCount\n        +publish()\n    }\n    DraftReport --> Reviewer : reviewed by\n    class Reviewer {\n        +String name\n    }',
	sequence: 'sequenceDiagram\n    participant Author\n    participant Reviewer\n    Author->>Reviewer: Initial draft\n    Reviewer-->>Author: Request changes',
	flow: 'flowchart LR\n    A[Initial draft] --> B{Approved?}\n    B -->|Yes| C[Publish]\n    B -->|No| D[Revise]',
};

// Reconstruction only observes outgoing edits; interaction never changes editor state directly.
async function currentSource(page: Page, initial: string): Promise<string> {
	return page.evaluate(original => {
		let text = original;
		for (const message of (window as any).__posted) if (message.type === 'edit') {
			for (const change of [...message.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
		}
		return text;
	}, initial);
}

async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-line').first().click();
	await page.keyboard.press(`${mod}+f`);
	const input = page.locator('.cm-search input[name="search"]');
	await expect(input).toBeVisible();
	await input.click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type(text, { delay: 3 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
}

async function replaceLine(page: Page, line: Locator, text: string): Promise<void> {
	await line.click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.press('Backspace');
	await page.keyboard.type(text, { delay: 4 });
}

test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
});

test('completed diagrams do not announce a perpetual loading message', async ({ page }) => {
	await mountEditor(page, 'Before\n\n```mermaid\nflowchart LR\nA[Ready] --> B[Reviewed]\n```\n\nAfter');
	const diagram = page.locator('.mlp-mermaid-wrap');
	await expect(diagram.locator('svg')).toContainText('Reviewed');
	const accessibility = await page.context().newCDPSession(page);
	const tree = await accessibility.send('Accessibility.getFullAXTree');
	const loading = tree.nodes.filter(node => !node.ignored && node.name?.value === 'Rendering diagram…');
	expect(loading).toEqual([]);
});

for (const family of ['er', 'class', 'sequence', 'flow'] as const) {
	test(`large report: ${family} diagram survives invalid-to-valid keyboard redrafts`, async ({ page }, info) => {
		test.setTimeout(90000);
		const initial = `# Review canvas\n\n\`\`\`mermaid\n${diagrams[family]}\n\`\`\`\n\nReturn to prose.\n\n${largeMixedDocument(80)}`;
		await mountEditor(page, initial);
		const diagram = page.locator('.mlp-mermaid-wrap').first();
		await expect(diagram.locator('svg')).toBeVisible({ timeout: 15000 });
		await diagram.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
		const declaration = diagrams[family].split('\n')[0];
		await replaceLine(page, page.locator('.cm-line', { hasText: declaration }).first(), 'temporarily_invalid');
		await page.locator('.cm-line', { hasText: /^Return to prose\.$/ }).click();
		await expect(diagram.locator('.mlp-mermaid-error')).toBeVisible();
		await diagram.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
		await replaceLine(page, page.locator('.cm-line', { hasText: 'temporarily_invalid' }), declaration);
		await page.locator('.cm-line', { hasText: /^Return to prose\.$/ }).click();
		await expect(diagram.locator('svg')).toBeVisible({ timeout: 15000 });
		await expect(diagram.locator('.mlp-mermaid-error')).toHaveCount(0);
		expect(await currentSource(page, initial)).toBe(initial);
		await diagram.getByRole('button', { name: 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)', exact: true }).click();
		await diagram.getByRole('button', { name: 'Zoom in (Ctrl+wheel also works)', exact: true }).click();
		const box = await diagram.locator('.mlp-mermaid').boundingBox();
		await page.mouse.move(box!.x + 80, box!.y + 50);
		await page.mouse.down();
		await page.mouse.move(box!.x + 140, box!.y + 75, { steps: 12 });
		await page.mouse.up();
		await diagram.getByRole('button', { name: 'Reset the view (fit to width)', exact: true }).click();
		await page.setViewportSize({ width: 480, height: 760 });
		await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(2);
		await page.screenshot({ path: info.outputPath(`${family}-redraft-narrow.png`) });
		await page.setViewportSize({ width: 1200, height: 800 });
		await find(page, 'Final editable paragraph.');
		await page.keyboard.press('End');
		await page.keyboard.type(' Review complete.', { delay: 5 });
		await expect.poll(() => currentSource(page, initial)).toBe(initial.replace('Final editable paragraph.', 'Final editable paragraph. Review complete.'));
	});
}

test('large report: create an ER table diagram a key at a time and redraft its attributes', async ({ page }, info) => {
	test.setTimeout(90000);
	const initial = `# Diagram authoring\n\nDraft here.\n\n${largeMixedDocument(100)}`;
	await mountEditor(page, initial);
	await replaceLine(page, page.locator('.cm-line', { hasText: /^Draft here\.$/ }), '```mermaid');
	await page.keyboard.press('Enter');
	for (const line of ['erDiagram', 'NOTE {', 'string title']) {
		await page.keyboard.type(line, { delay: 6 });
		await page.keyboard.press('Enter');
	}
	await page.keyboard.type('int priority', { delay: 6 });
	// The opening brace already inserted its partner; move past it instead of duplicating it.
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	expect((await currentSource(page, initial)).slice(0, 300)).toMatch(/```mermaid\nerDiagram\n\s*NOTE \{\n\s*string title\n\s*int priority\n\s*\}\n\s*```/);
	const diagram = page.locator('.mlp-mermaid-wrap').first();
	await expect(diagram.locator('svg')).toContainText('priority', { timeout: 15000 });
	await diagram.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
	await replaceLine(page, page.locator('.cm-line', { hasText: /^\s*int priority$/ }), '        boolean approved');
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('string reviewer', { delay: 8 });
	await find(page, 'Large mixed QA');
	await expect(diagram.locator('svg')).toContainText('approved', { timeout: 15000 });
	await expect(diagram.locator('svg')).toContainText('reviewer');
	await expect(diagram.locator('svg')).not.toContainText('priority');
	await page.screenshot({ path: info.outputPath('typed-er-table.png') });
	const source = await currentSource(page, initial);
	expect(source).toContain('boolean approved\n        string reviewer');
	expect(source).toContain('Final editable paragraph.');
});

test('large report: draw.io source replacements update labels without leaking old render output', async ({ page }, info) => {
	test.setTimeout(90000);
	const initial = `# Drawing revisions\n\n\`\`\`drawio\n${model('Draft architecture')}\n\`\`\`\n\nReturn to prose.\n\n${largeMixedDocument(80)}`;
	await mountEditor(page, initial);
	const drawing = page.locator('.mlp-drawio-wrap').first();
	await expect(drawing.locator('svg')).toContainText('Draft architecture');
	let oldLabel = 'Draft architecture';
	for (const label of ['Revised architecture', 'Final architecture', 'Approved architecture']) {
		await drawing.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
		await find(page, oldLabel);
		await page.keyboard.type(label, { delay: 8 });
		await page.locator('.cm-line', { hasText: /^Return to prose\.$/ }).click();
		await expect(drawing.locator('svg')).toContainText(label);
		await expect(drawing.locator('svg')).toHaveCount(1);
		await expect(drawing.locator('.mlp-mermaid-error')).toHaveCount(0);
		oldLabel = label;
	}
	await page.screenshot({ path: info.outputPath('drawio-redraft.png') });
	await expect.poll(() => currentSource(page, initial)).toBe(initial.replace('Draft architecture', 'Approved architecture'));
});

test('large report: wide-table cell redrafts, row deletion, source, and resize stay consistent', async ({ page }, info) => {
	test.setTimeout(90000);
	await page.setViewportSize({ width: 700, height: 800 });
	const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
	const table = [row(Array.from({ length: 12 }, (_, c) => `Report column ${c}`)), row(Array(12).fill('---')),
		...Array.from({ length: 160 }, (_, r) => row(Array.from({ length: 12 }, (_, c) => `Entry ${r}-${c} **review**<br>Second line`)))].join('\n');
	const initial = `# Table editing lab\n\n${table}\n\nTable ends here.\n\n${largeMixedDocument(80)}`;
	await mountEditor(page, initial, { stickyTableHeaders: true });
	const wrap = page.locator('.mlp-table-wrap').first();
	await expect(wrap.locator('tbody tr')).toHaveCount(160);
	const first = wrap.locator('.mlp-table tbody tr').first().locator('td').first();
	await first.click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type('**Revised title**<br>Ready for approval', { delay: 6 });
	await page.keyboard.press('Tab');
	await page.keyboard.type('`final_value`', { delay: 6 });
	await page.keyboard.press('Enter');
	await expect(first.locator('strong')).toHaveText('Revised title');
	await expect(first.locator('br')).toHaveCount(1);
	await expect(wrap.locator('.mlp-table td').nth(1).locator('code')).toHaveText('final_value');
	await first.click();
	await page.keyboard.press('Escape');
	await wrap.getByRole('button', { name: 'Table options', exact: true }).click();
	await wrap.getByRole('button', { name: 'Insert row below selected row', exact: true }).click();
	await expect(wrap.locator('tbody tr')).toHaveCount(161);
	await wrap.locator('.mlp-table tbody tr').nth(1).locator('td').first().click();
	await page.keyboard.type('Temporary row', { delay: 6 });
	await page.keyboard.press('Enter');
	await wrap.locator('.mlp-table tbody tr').nth(1).locator('td').first().click();
	await page.keyboard.press('Escape');
	await wrap.getByRole('button', { name: 'Table options', exact: true }).click();
	await wrap.getByRole('button', { name: 'Delete selected row', exact: true }).click();
	await expect(wrap.locator('tbody tr')).toHaveCount(160);
	await wrap.getByRole('button', { name: 'Show Markdown source', exact: true }).click();
	await expect(page.locator('.cm-line', { hasText: '| Report column 0 | Report column 1 |' })).toBeVisible();
	await find(page, 'Table editing lab');
	await expect(wrap.locator('.mlp-table tbody tr')).toHaveCount(160);
	await page.mouse.move(580, 450);
	await page.mouse.wheel(600, 0);
	await expect.poll(() => wrap.locator('.mlp-table-viewport').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
	await page.mouse.wheel(0, 450);
	await expect(wrap.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
	for (const width of [480, 1200, 700]) {
		await page.setViewportSize({ width, height: 800 });
		await expect.poll(() => wrap.evaluate(el => {
			const cells = Array.from(el.querySelectorAll('.mlp-table th'));
			const headers = Array.from(el.querySelectorAll('.mlp-sticky-table th'));
			return Math.max(...cells.map((cell, i) => Math.abs(cell.getBoundingClientRect().left - headers[i].getBoundingClientRect().left)));
		})).toBeLessThanOrEqual(2);
	}
	await page.screenshot({ path: info.outputPath('wide-table-edited-sticky.png') });
	const source = await currentSource(page, initial);
	expect(source).not.toContain('Temporary row');
	expect(source).toBe(initial.replace('Entry 0-0 **review**<br>Second line', '**Revised title**<br>Ready for approval').replace('Entry 0-1 **review**<br>Second line', '`final_value`'));
});
