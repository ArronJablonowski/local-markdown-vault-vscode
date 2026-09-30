import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Theme review" vertex="1" parent="1"><mxGeometry x="20" y="20" width="180" height="70" as="geometry"/></mxCell></root></mxGraphModel>';

for (const kind of ['mermaid', 'drawio']) {
	test(`${kind} follows live host theme changes without resetting zoom or editing text`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on('pageerror', error => errors.push(error.message));
		const code = kind === 'mermaid' ? 'flowchart LR\n A[Theme review] --> B[Keep editing]' : xml;
		await mountEditor(page, `Intro\n\n\`\`\`${kind}\n${code}\n\`\`\`\n\nAfter\n`);
		const wrap = page.locator('.mlp-mermaid-wrap');
		const shape = wrap.locator(kind === 'mermaid' ? 'svg .node rect' : 'svg rect').first();
		await expect(shape).toBeVisible();
		const darkFill = await shape.evaluate(el => getComputedStyle(el).fill);
		await wrap.getByRole('button', { name: 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)', exact: true }).click();
		await wrap.getByRole('button', { name: 'Zoom in (Ctrl+wheel also works)', exact: true }).click();
		const canvas = wrap.locator('.mlp-mermaid-canvas');
		const transform = await canvas.evaluate(el => (el as HTMLElement).style.transform);
		// VS Code updates these host-owned classes; the harness models that notification.
		await page.evaluate(() => document.body.classList.replace('vscode-dark', 'vscode-light'));
		await expect.poll(() => shape.evaluate(el => getComputedStyle(el).fill)).not.toBe(darkFill);
		expect(await canvas.evaluate(el => (el as HTMLElement).style.transform)).toBe(transform);
		await page.evaluate(() => document.body.classList.replace('vscode-light', 'vscode-dark'));
		await expect.poll(() => shape.evaluate(el => getComputedStyle(el).fill)).toBe(darkFill);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
		expect(errors).toEqual([]);
		await page.screenshot({ path: info.outputPath(`${kind}-theme-restored.png`) });
	});
}

test('hidden diagrams retain their initial render and use the latest host palette when reopened', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 1500 });
	await mountEditor(page, 'Loading');
	await postToWebview(page, { type: 'panelVisibility', visible: false });
	await postToWebview(page, {
		type: 'init', protocolVersion: 1, version: 1,
		text: `Intro\n\n\`\`\`mermaid\nflowchart LR\n A[Theme review] --> B[Reopen]\n\`\`\`\n\n\`\`\`drawio\n${xml}\n\`\`\`\n\nAfter\n`,
		css: '', codeTheme: 'dark-plus', remoteMedia: 'block', workspaceTrusted: true,
		diagramRenderingAllowed: true, editingMode: 'editing', vaultNotes: [], currentVaultPath: '',
	});
	await expect(page.locator('.mlp-mermaid-wrap')).toHaveCount(2);
	await page.evaluate(() => document.body.classList.replace('vscode-dark', 'vscode-light'));
	await expect(page.locator('.mlp-mermaid-wrap svg')).toHaveCount(0);
	await postToWebview(page, { type: 'panelVisibility', visible: true });
	await expect(page.locator('.mlp-mermaid-wrap svg')).toHaveCount(2);
	const drawio = page.locator('.mlp-drawio-wrap svg rect').first();
	await expect(drawio).toHaveCSS('fill', 'rgb(255, 255, 255)');
	await expect(page.locator('.mlp-mermaid-error')).toHaveCount(0);
});

test('draw.io keeps the selected page through repeated palette changes', async ({ page }) => {
	const pages = `<mxfile><diagram name="First">${xml}</diagram><diagram name="Second">${xml.replace('Theme review', 'Second page')}</diagram></mxfile>`;
	await mountEditor(page, `Intro\n\n\`\`\`drawio\n${pages}\n\`\`\`\n\nAfter`);
	const wrap = page.locator('.mlp-drawio-wrap');
	await wrap.getByRole('button', { name: 'Next page', exact: true }).click();
	await expect(wrap.locator('svg')).toContainText('Second page');
	for (const light of [true, false, true, false, true]) {
		await page.evaluate(light => {
			document.body.classList.toggle('vscode-dark', !light);
			document.body.classList.toggle('vscode-light', light);
		}, light);
		await expect(wrap.locator('svg rect').first()).toHaveCSS('fill', light ? 'rgb(255, 255, 255)' : 'rgb(43, 49, 64)');
		await expect(wrap.locator('.mlp-drawio-page-label')).toHaveText('2/2');
		await expect(wrap.locator('svg')).toContainText('Second page');
	}
});

test('rapid Mermaid palette changes settle without blanking the previous diagram', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```mermaid\nclassDiagram\n class Note {\n  +String title\n  +save()\n }\n```\n\nAfter');
	const wrap = page.locator('.mlp-mermaid-wrap');
	await expect(wrap.locator('svg')).toHaveCount(1);
	const initialFill = await wrap.locator('svg rect').first().evaluate(el => getComputedStyle(el).fill);
	// Separate host notifications exercise invalidation while an async render is in flight.
	for (const light of [true, false, true, false, true]) {
		await page.evaluate(light => {
			document.body.classList.toggle('vscode-dark', !light);
			document.body.classList.toggle('vscode-light', light);
		}, light);
		await expect(wrap.locator('svg')).toHaveCount(1);
	}
	await expect.poll(() => wrap.locator('svg rect').first().evaluate(el => getComputedStyle(el).fill)).not.toBe(initialFill);
	await expect(wrap.locator('svg')).toContainText('title');
	await expect(page.locator('.mlp-mermaid-error')).toHaveCount(0);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});

test('a failed Mermaid theme repaint visibly replaces the old SVG and can recover', async ({ page }, info) => {
	// Fault injection covers an async renderer failure after a successful isolated SVG.
	const chunk = `let renders = 0; window.mlpMermaid = {
		initialize() {},
		async render() {
			if (++renders === 2) throw new Error('Simulated render failure');
			return {svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60"/><text x="10" y="30">Ready</text></svg>'};
		}
	};`;
	await mountEditor(page, 'Intro\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nAfter', { mermaidChunk: chunk });
	const wrap = page.locator('.mlp-mermaid-wrap');
	await expect(wrap.locator('svg')).toBeVisible();
	await page.evaluate(() => document.body.classList.replace('vscode-dark', 'vscode-light'));
	await expect(wrap.locator('[role="alert"]')).toBeVisible();
	await expect(wrap.locator('svg')).toHaveCount(0);
	await expect.poll(() => wrap.locator('[role="alert"]').evaluate(el => el.shadowRoot?.textContent)).toMatch(/Diagram error/);
	await page.screenshot({ path: info.outputPath('visible-repaint-error.png') });
	await page.evaluate(() => document.body.classList.replace('vscode-light', 'vscode-dark'));
	await expect(wrap.locator('svg')).toContainText('Ready');
	await expect(wrap.locator('[role="alert"]')).toHaveCount(0);
});
