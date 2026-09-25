import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Visible diagram" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="50" as="geometry"/></mxCell></root></mxGraphModel>';

test('hidden retained documents defer Mermaid, draw.io parsing, and file reads until visible', async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 1600 });
	let mermaidLoads = 0;
	page.on('request', request => { if (request.url().endsWith('mermaid-chunk.js')) mermaidLoads++; });
	await mountEditor(page, '# Loading');
	expect(await page.evaluate(() => document.hidden)).toBe(false);
	await postToWebview(page, { type: 'panelVisibility', visible: false });
	await postToWebview(page, {
		type: 'init', protocolVersion: 1, version: 1,
		text: `# Diagrams\n\n\`\`\`mermaid\nflowchart LR\nA-->B\n\`\`\`\n\n\`\`\`drawio\n${xml}\n\`\`\`\n\n![File](diagram.drawio)\n\nTail`,
		css: '', codeTheme: 'dark-plus', remoteMedia: 'block', workspaceTrusted: true,
		diagramRenderingAllowed: true, editingMode: 'editing', vaultNotes: [], currentVaultPath: '',
	});
	await expect(page.locator('.mlp-drawio-wrap')).toHaveCount(2);
	await page.waitForTimeout(2200); // Longer than a Mermaid render deadline, but no render has begun.
	expect(mermaidLoads).toBe(0);
	expect(await page.locator('.mlp-mermaid-wrap svg').count()).toBe(0);
	expect(await page.locator('.mlp-mermaid-error').count()).toBe(0);
	expect(await page.evaluate(() => (window as any).__posted.some((message: any) => message.type === 'readDrawioFile'))).toBe(false);
	await postToWebview(page, { type: 'panelVisibility', visible: true });
	await expect.poll(() => mermaidLoads).toBe(1);
	await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readDrawioFile'))).toBeTruthy();
	const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readDrawioFile').requestId);
	await postToWebview(page, { type: 'drawioFile', requestId, text: xml });
	await expect(page.locator('.mlp-mermaid-wrap svg')).toHaveCount(3);
	await expect(page.locator('.mlp-mermaid-error')).toHaveCount(0);
});
