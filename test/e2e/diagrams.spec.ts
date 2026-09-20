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
		await expect(page.locator('.mlp-mermaid-error')).toHaveAttribute('role', 'alert');
		await expect(page.locator('.mlp-mermaid-error')).not.toContainText('{{{');
		await expect(page.locator('.mlp-mermaid-error')).toContainText('could not be rendered');
		await expect(page.locator('.cm-line', { hasText: 'After' })).toBeVisible();
	});

	test('sanitizes active content from renderer SVG before DOM insertion', async ({ page }) => {
		const trackerRequests: string[] = [];
		page.on('request', (request) => {
			if (request.url().includes('tracker.invalid')) trackerRequests.push(request.url());
		});
		const hostileRenderer = `window.mlpMermaid = {
			initialize: function () {},
			render: async function () { return { svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:renamed="http://www.w3.org/1999/xlink" onload="window.__svgRan=1"><script>window.__svgRan=2<\\/script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hostile</div></foreignObject><style>.mlp-code-mode-btn, body { --renderer-escaped:yes }</style><style id="host-escape">:host { position:fixed!important; inset:0 }</style><style id="network-style">rect { background-image:image-set("https://tracker.invalid/pixel" 1x) }</style><a href="https://tracker.invalid/x"><text>link</text></a><a renamed:href="https://tracker.invalid/renamed-xlink"><text>renamed namespace link</text></a><g xml:base="https://tracker.invalid/external.svg"><path id="local-shape" d="M0 0h1v1z"/><use href="#local-shape"/></g><rect style="fill:url(https://tracker.invalid/pixel)" width="10" height="10"/></svg>' }; }
		};`;
		await mountEditor(page, 'Intro\n\n```mermaid\ngraph TD; A-->B\n```\n', { mermaidChunk: hostileRenderer });
		await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible({ timeout: 10_000 });
		await expect(page.locator('.mlp-mermaid-wrap script, .mlp-mermaid-wrap foreignObject')).toHaveCount(0);
		await expect(page.locator('.mlp-mermaid-wrap [onload], .mlp-mermaid-wrap [href^="http"]')).toHaveCount(0);
		expect(await page.locator('.mlp-mermaid-wrap svg').evaluate((svg) =>
			Array.from(svg.querySelectorAll('*')).flatMap((element) => Array.from(element.attributes))
				.filter((attribute) => attribute.localName.toLowerCase() === 'href' && !attribute.value.startsWith('#'))
				.map((attribute) => ({ name: attribute.name, namespace: attribute.namespaceURI, value: attribute.value })),
		)).toEqual([]);
		await expect(page.locator('.mlp-mermaid-wrap style#host-escape')).toHaveCount(0);
		await expect(page.locator('.mlp-mermaid-wrap style#network-style')).toHaveCount(0);
		expect(await page.locator('.mlp-mermaid-wrap svg').evaluate((svg) =>
			Array.from(svg.querySelectorAll('*')).some((element) =>
				element.hasAttributeNS('http://www.w3.org/XML/1998/namespace', 'base')),
		)).toBe(false);
		await expect(page.locator('.mlp-mermaid-wrap use[href="#local-shape"]')).toHaveCount(1);
		await expect(page.locator('.mlp-mermaid-wrap .mlp-code-mode-btn')).toBeVisible();
		expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe('none');
		expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--renderer-escaped'))).toBe('');
		expect(await page.evaluate(() => (window as unknown as { __svgRan?: number }).__svgRan)).toBeUndefined();
		expect(trackerRequests).toEqual([]);
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

	test('diagram glyph controls expose descriptive accessible names', async ({ page }) => {
		const xml = [
			'<mxGraphModel><root>',
			'<mxCell id="0"/><mxCell id="1" parent="0"/>',
			'<mxCell id="2" value="Box" vertex="1" parent="1">',
			'<mxGeometry x="10" y="10" width="80" height="40" as="geometry"/>',
			'</mxCell>',
			'</root></mxGraphModel>',
		].join('');
		await mountEditor(page, `Intro\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n\n\`\`\`drawio\n${xml}\n\`\`\`\n`);
		await expect(page.locator('.mlp-mermaid-wrap svg')).toHaveCount(2, { timeout: 20_000 });

		const wrappers = page.locator('.mlp-mermaid-wrap');
		for (let index = 0; index < 2; index++) {
			const wrapper = wrappers.nth(index);
			await expect(wrapper.getByRole('button', { name: 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)' })).toHaveCount(1);
			await expect(wrapper.locator('button[aria-label="Zoom in (Ctrl+wheel also works)"]')).toHaveCount(1);
			await expect(wrapper.locator('button[aria-label="Zoom out"]')).toHaveCount(1);
			await expect(wrapper.locator('button[aria-label="Reset the view (fit to width)"]')).toHaveCount(1);
		}

		const toggle = wrappers.first().getByRole('button', { name: 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)' });
		await toggle.click();
		await expect(wrappers.first().getByRole('button', { name: 'Back to fitted view (scaled to the available width, no scrolling)' })).toHaveCount(1);
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
		await postToWebview(page, { type: 'drawioFile', requestId, error: 'forged <secret> source text' });
		await expect(page.locator('.mlp-mermaid-error')).toContainText('Could not read the file.', {
			timeout: 10_000,
		});
		await expect(page.locator('.mlp-mermaid-error')).not.toContainText('forged');
		await expect(page.locator('.mlp-mermaid-error')).toHaveAttribute('role', 'alert');
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
