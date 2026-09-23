import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

const note = '# Everyday editing\n\nA **bold** sentence, *italic* text, ==highlight==, and `inline code`.\n\n## Checklist\n- [ ] Review the table\n- [x] Prepare test notes\n- Parent bullet\n  - Child bullet\n\n## Budget\n| Item | Cost |\n| --- | ---: |\n| Notebook | $12 |\n| Pens | $5 |\n\n> [!warning]+ Local test\n> Keep all changes in the disposable vault.\n> - [ ] Confirm autosave\n\nFinal paragraph.';

test('table cell editing preserves the next callout header', async ({ page }) => {
	await page.setViewportSize({ width: 680, height: 700 });
	await mountEditor(page, note);
	await page.locator('.mlp-checkbox').first().click();
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press('F2');
	await page.keyboard.type('Journal');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Local test callout', exact: true })).toBeVisible();
});

test('property edits preserve footnote navigation and callout controls', async ({ page }) => {
	await mountEditor(page, '---\nstatus: draft\n---\n\n# Research\n\nA reference[^one].\n\n> [!abstract]+ Summary\n> Details.\n\n[^one]: A local footnote.\n\nAfter');
	await page.getByRole('button', { name: 'Edit status', exact: true }).dblclick();
	await page.getByRole('textbox', { name: 'Edit status', exact: true }).fill('reviewed');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Summary callout', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Go to footnote one', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Go to footnote one', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Return to footnote reference one', exact: true })).toBeVisible();
});

test('diagram source button places the keyboard caret inside the source', async ({ page }) => {
	await mountEditor(page, '# Diagrams\n\n```mermaid\nflowchart LR\nA[Start] --> B[Review]\n```\n\nAfter');
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
	await page.locator('.mlp-mermaid-wrap .mlp-code-mode-btn').click();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.type('A[Start] --> B[Verified]');
	await page.locator('.cm-line', { hasText: 'After' }).click();
	await expect(page.locator('.mlp-mermaid-wrap svg')).toContainText('Verified');
});

for (const kind of ['table', 'drawio'] as const) {
	test(`${kind} source stays open while selecting and replacing text`, async ({ page }) => {
		const vertex = '<mxCell id="2" value="Original" vertex="1" parent="1">';
		const xml = `<mxGraphModel>\n<root>\n<mxCell id="0"/>\n<mxCell id="1" parent="0"/>\n${vertex}\n<mxGeometry x="20" y="20" width="140" height="60" as="geometry"/>\n</mxCell>\n</root>\n</mxGraphModel>`;
		const source = kind === 'table' ? '| Name |\n| --- |\n| Original |' : `\`\`\`drawio\n${xml}\n\`\`\``;
		await mountEditor(page, `Intro\n\n${source}\n\nAfter`);
		const block = kind === 'table' ? '.mlp-table-wrap' : '.mlp-drawio-wrap';
		await page.locator(`${block} .mlp-code-mode-btn`).click();
		const line = page.locator('.cm-line', { hasText: kind === 'table' ? '| Original |' : vertex });
		await line.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await expect(page.locator(block)).toHaveCount(0);
		await page.keyboard.type(kind === 'table' ? '| Verified |' : vertex.replace('Original', 'Verified'));
		await page.locator('.cm-line', { hasText: 'After' }).click();
		await expect(page.locator(kind === 'table' ? '.mlp-table td' : '.mlp-drawio-wrap svg')).toContainText('Verified');
	});
}
