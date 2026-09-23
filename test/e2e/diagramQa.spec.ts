import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const model = (label: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"><mxGeometry x="20" y="20" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel>`;
const fence = (language: string, source: string) => `Intro\n\n\`\`\`${language}\n${source}\n\`\`\`\n\nAfter\n`;
const examples: Record<string, string> = {
	flowchart: 'flowchart LR\nA[Start] --> B{Ready?}\nB -->|Yes| C[Finish]',
	sequence: 'sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Reply',
	class: 'classDiagram\nAnimal <|-- Duck\nAnimal : +int age',
	state: 'stateDiagram-v2\n[*] --> Idle\nIdle --> Active\nActive --> [*]',
	er: 'erDiagram\nCUSTOMER ||--o{ ORDER : places',
	gantt: 'gantt\ntitle Work\ndateFormat YYYY-MM-DD\nsection Plan\nDesign :a1, 2026-01-01, 3d',
	pie: 'pie title Counts\n"Alpha" : 40\n"Beta" : 60',
	journey: 'journey\ntitle Workday\nsection Morning\nCoffee: 5: Me',
	mindmap: 'mindmap\n  root((Main))\n    One\n    Two',
	timeline: 'timeline\ntitle History\n2025 : Start\n2026 : Finish',
};

for (const [family, source] of Object.entries(examples)) {
	test(`Mermaid ${family} preserves visible labels and geometry`, async ({ page }, testInfo) => {
		await mountEditor(page, fence('mermaid', source));
		const svg = page.locator('.mlp-mermaid-wrap svg');
		await expect(svg).toBeVisible({ timeout: 15000 });
		expect(await svg.locator('text').count()).toBeGreaterThan(0);
		expect((await svg.locator('text').allTextContents()).join('').trim().length).toBeGreaterThan(0);
		await expect(page.locator('.mlp-mermaid-error')).toHaveCount(0);
		await expect(svg.locator('style')).not.toHaveCount(0);
		const fills = await svg.locator('rect, circle, polygon, path').evaluateAll(elements =>
			elements.map(el => getComputedStyle(el).fill).filter(fill => fill !== 'none'));
		expect(fills.some(fill => fill !== 'rgb(0, 0, 0)')).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`${family}.png`) });
	});
}

for (const kind of ['mermaid', 'drawio']) {
	test(`${kind} mouse pan, zoom buttons, wheel, reset, and source controls`, async ({ page }) => {
		await mountEditor(page, fence(kind, kind === 'mermaid' ? examples.flowchart : model('Local box')));
		const wrap = page.locator('.mlp-mermaid-wrap');
		await expect(wrap.locator('svg')).toBeVisible({ timeout: 15000 });
		await wrap.getByRole('button', { name: 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)', exact: true }).click();
		const canvas = wrap.locator('.mlp-mermaid-canvas');
		await wrap.getByRole('button', { name: 'Zoom in (Ctrl+wheel also works)', exact: true }).click();
		await expect(canvas).toHaveAttribute('style', /scale\(1.2\)/);
		await wrap.getByRole('button', { name: 'Zoom out', exact: true }).click();
		await expect(canvas).toHaveAttribute('style', /scale\(1\)/);
		const before = await canvas.getAttribute('style');
		const box = (await wrap.locator('.mlp-mermaid').boundingBox())!;
		await page.mouse.move(box.x + 80, box.y + 70);
		await page.mouse.down();
		await page.mouse.move(box.x + 120, box.y + 90, { steps: 6 });
		await page.mouse.up();
		expect(await canvas.getAttribute('style')).not.toBe(before);
		await wrap.locator('.mlp-mermaid').dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
		await expect(canvas).toHaveAttribute('style', /scale\(1.1\)/);
		await wrap.getByRole('button', { name: 'Reset the view (fit to width)', exact: true }).click();
		await expect(wrap.locator('.mlp-mermaid-native')).toHaveCount(0);
		await expect(canvas).not.toHaveAttribute('style', /scale/);
		await wrap.locator('.mlp-code-mode-btn').click();
		await expect(page.locator('.cm-content')).toContainText(kind === 'mermaid' ? 'flowchart LR' : '<mxGraphModel>');
	});
}

test('draw.io page controls wrap around and preserve labels', async ({ page }) => {
	const xml = `<mxfile><diagram name="First">${model('Alpha')}</diagram><diagram name="Second">${model('Beta')}</diagram></mxfile>`;
	await mountEditor(page, fence('drawio', xml));
	const wrap = page.locator('.mlp-drawio-wrap');
	await expect(wrap.locator('svg')).toContainText('Alpha');
	await wrap.getByRole('button', { name: 'Next page', exact: true }).click();
	await expect(wrap.locator('svg')).toContainText('Beta');
	await expect(wrap.locator('.mlp-drawio-page-label')).toHaveText('2/2');
	await wrap.getByRole('button', { name: 'Next page', exact: true }).press('Enter');
	await expect(wrap.locator('svg')).toContainText('Alpha');
	await wrap.getByRole('button', { name: 'Previous page', exact: true }).click();
	await expect(wrap.locator('svg')).toContainText('Beta');
});

for (const xml of ['<mxGraphModel><broken>', '<!DOCTYPE x [<!ENTITY x "boom">]><mxGraphModel/>', '<mxfile><diagram>compressed-data</diagram></mxfile>']) {
	test(`draw.io rejects unsupported or hostile input: ${xml.slice(0, 25)}`, async ({ page }) => {
		await mountEditor(page, fence('drawio', xml));
		await expect(page.locator('.mlp-mermaid-error')).toBeVisible();
		await expect(page.locator('.mlp-mermaid-error')).toHaveAttribute('role', 'alert');
		await expect(page.locator('.cm-line', { hasText: /^After$/ })).toBeVisible();
	});
}

test('draw.io references correlate out-of-order host replies', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n![](one.drawio)\n\n![](two.drawio)\n\nAfter\n');
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'readDrawioFile').length)).toBe(2);
	const requests = await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'readDrawioFile'));
	for (const request of requests.reverse()) await postToWebview(page, { type: 'drawioFile', requestId: request.requestId, text: model(request.src) });
	await expect(page.locator('.mlp-drawio-wrap').nth(0).locator('svg')).toContainText('one.drawio');
	await expect(page.locator('.mlp-drawio-wrap').nth(1).locator('svg')).toContainText('two.drawio');
});

test('invalid Mermaid leaves no orphan renderer SVG in the surrounding editor', async ({ page }) => {
	await mountEditor(page, fence('mermaid', 'not a valid diagram {{{'));
	await expect(page.locator('.mlp-mermaid-error')).toBeVisible();
	const orphanIds = await page.evaluate(() => Array.from(document.querySelectorAll('svg[id^="mlp-mermaid-"]')).map(svg => svg.id));
	expect(orphanIds).toEqual([]);
});

test('draw.io refresh replaces cached content and ignores stale pending replies', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n![](one.drawio)\n\nAfter\n');
	const requests = () => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'readDrawioFile'));
	await expect.poll(async () => (await requests()).length).toBe(1);
	const first = (await requests())[0].requestId;
	await postToWebview(page, { type: 'invalidateDrawioFiles' });
	await expect.poll(async () => (await requests()).length).toBe(2);
	const second = (await requests())[1].requestId;
	await postToWebview(page, { type: 'drawioFile', requestId: second, text: model('Fresh') });
	await postToWebview(page, { type: 'drawioFile', requestId: first, text: model('Stale') });
	await expect(page.locator('.mlp-drawio-wrap svg')).toContainText('Fresh');
	await postToWebview(page, { type: 'invalidateDrawioFiles' });
	await expect.poll(async () => (await requests()).length).toBe(3);
	await postToWebview(page, { type: 'drawioFile', requestId: (await requests())[2].requestId, text: model('Updated') });
	await expect(page.locator('.mlp-drawio-wrap svg')).toContainText('Updated');
});

test('mixed Mermaid diagrams render independently in one note', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n' + ['flowchart', 'sequence', 'class', 'state'].map(name => fence('mermaid', examples[name])).join('\n'));
	await expect(page.locator('.mlp-mermaid-wrap svg')).toHaveCount(4);
	await expect(page.locator('.mlp-mermaid-error')).toHaveCount(0);
});

test('SVG sanitizing preserves safe paint but discards animations, network rules, and host selectors', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', req => { if (req.url().includes('tracker.invalid')) requests.push(req.url()); });
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><style>@import "https://tracker.invalid/a.css"; @keyframes pulse {from {opacity:0}} :host {position:fixed} rect {fill:#123456; animation:pulse 1s infinite; background-image:url(https://tracker.invalid/pixel)} text {fill:#ffffff}</style><rect width="100" height="100"/><text x="10" y="30">Safe</text></svg>';
	await mountEditor(page, fence('mermaid', examples.flowchart), { mermaidChunk: `window.mlpMermaid={initialize(){},async render(){return {svg:${JSON.stringify(svg)}}}};` });
	const rectangle = page.locator('.mlp-mermaid-wrap svg rect');
	await expect(rectangle).toHaveCSS('fill', 'rgb(18, 52, 86)');
	await expect(rectangle).toHaveCSS('animation-name', 'none');
	const css = await page.locator('.mlp-mermaid-wrap svg style').textContent();
	expect(css).not.toMatch(/tracker|@keyframes|:host|animation/);
	expect(requests).toEqual([]);
});

test('Mermaid input limits fail visibly without hiding surrounding text', async ({ page }) => {
	await mountEditor(page, fence('mermaid', 'graph TD;\n' + 'A-->B\n'.repeat(501)));
	await expect(page.locator('.mlp-mermaid-error')).toBeVisible();
	await expect(page.locator('.cm-line', { hasText: /^After$/ })).toBeVisible();
});
