import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

/**
 * Mermaid and draw.io: the two block widgets that fetch something before they
 * can draw. Both were verified only by eye (README manual step 5), and both are
 * among the least-covered files in the project.
 */
test.describe('diagram widgets', () => {
	test('a mermaid fence renders an SVG diagram', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n\nAfter\n');
		// Mermaid is loaded lazily and lays out asynchronously, so the assertion
		// waits rather than sampling once.
		await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible({ timeout: 20_000 });
	});

	test('putting the caret in a mermaid fence shows its source', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n\nAfter\n');
		await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible({ timeout: 20_000 });
		// The rendered widget replaces the fence, so the caret is put on the line
		// through the code-mode button the widget itself offers.
		await page.locator('.mlp-mermaid-wrap').hover();
		await page.locator('.mlp-code-mode-btn').first().click();
		await expect(page.locator('.cm-line', { hasText: 'graph TD;' })).toBeVisible();
	});

	test('a broken mermaid fence reports an error rather than vanishing', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n```mermaid\nnot a diagram at all {{{\n```\n\nAfter\n');
		// What must not happen is a blank space where the block was: the widget
		// reports the failure in place, so the surrounding document stays intact.
		await expect(page.locator('.mlp-mermaid-error')).toBeVisible({ timeout: 20_000 });
		await expect(page.locator('.cm-line', { hasText: 'After' })).toBeVisible();
	});

	test('a drawio fence renders without the draw.io app', async ({ page }) => {
		const xml = [
			'<mxGraphModel><root>',
			'<mxCell id="0"/><mxCell id="1" parent="0"/>',
			'<mxCell id="2" value="Box" style="rounded=0" vertex="1" parent="1">',
			'<mxGeometry x="10" y="10" width="80" height="40" as="geometry"/>',
			'</mxCell>',
			'</root></mxGraphModel>',
		].join('');
		await mountEditor(page, `Intro\n\n\`\`\`drawio\n${xml}\n\`\`\`\n\nAfter\n`);
		await expect(page.locator('.mlp-drawio-wrap svg')).toBeVisible({ timeout: 15_000 });
	});

	test('a drawio file reference asks the host to read it', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n![](diagram.drawio)\n\nAfter\n');
		// The widget cannot read the file itself; it posts a request and waits.
		await expect
			.poll(
				async () =>
					await page.evaluate(() =>
						(window as unknown as { __posted: Array<{ type: string }> }).__posted.some(
							(m) => m.type === 'readDrawioFile',
						),
					),
				{ timeout: 10_000 },
			)
			.toBe(true);
	});

	test('a drawio file that cannot be read shows the error', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n![](missing.drawio)\n\nAfter\n');
		const requestId = await requestIdFor(page);
		await postToWebview(page, { type: 'drawioFile', requestId, error: 'File not found.' });
		await expect(page.locator('.mlp-mermaid-error')).toContainText('File not found.', {
			timeout: 10_000,
		});
	});
});

/** The id the widget used when it asked the host for a file. */
async function requestIdFor(page: import('@playwright/test').Page): Promise<number> {
	return await page.evaluate(async () => {
		const posted = (window as unknown as { __posted: Array<{ type: string; requestId?: number }> })
			.__posted;
		for (let i = 0; i < 100; i++) {
			const message = posted.find((m) => m.type === 'readDrawioFile');
			if (message?.requestId !== undefined) return message.requestId;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error('the widget never asked the host for the file');
	});
}
