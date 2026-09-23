import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';

const CORPUS_ROOT = join(__dirname, '..', 'security-corpus');
interface CorpusEntry {
	file: string;
	visibleText: string;
	frontmatterError: boolean;
	repeatText?: string;
	repeatCount?: number;
	maxMountMs?: number;
}
const CORPUS = JSON.parse(readFileSync(join(CORPUS_ROOT, 'manifest.json'), 'utf8')) as CorpusEntry[];
const corpusSource = (file: string): string => readFileSync(join(CORPUS_ROOT, file), 'utf8');
const materializeCorpus = (entry: CorpusEntry): string => {
	const source = corpusSource(entry.file);
	if (!entry.repeatText || !entry.repeatCount) return source;
	if (!Number.isSafeInteger(entry.repeatCount) || entry.repeatCount < 1 || entry.repeatCount > 10_000) {
		throw new Error(`Invalid repeat count in security corpus: ${entry.file}`);
	}
	return `${source}\n${entry.repeatText.repeat(entry.repeatCount)}\n`;
};
const MALICIOUS_YAML_ALIAS = corpusSource('malicious-yaml-alias.md');
const HARNESS_RESOURCES = new Set([
	'https://example.invalid/mermaid-chunk.js',
	'https://example.invalid/aws4-shapes.json',
]);

test.describe('hostile Markdown boundaries', () => {
	test('bounds highlight decorations from a malicious single line', async ({ page }) => {
		await mountEditor(page, `Intro\n\n${'==x=='.repeat(2_048)}\n`);
		await expect(page.locator('.mlp-highlight')).toHaveCount(512);
		await expect(page.locator('.cm-content')).toContainText('==x==');
	});

	for (const fixture of CORPUS) {
		test(`keeps ${fixture.file} inert, bounded, and network silent`, async ({ page }) => {
			const networkRequests: string[] = [];
			const uncaughtErrors: string[] = [];
			page.on('request', (request) => {
				if (/^https?:/i.test(request.url()) && !HARNESS_RESOURCES.has(request.url())) networkRequests.push(request.url());
			});
			page.on('pageerror', (error) => uncaughtErrors.push(error.message));
			const started = Date.now();
			await mountEditor(page, materializeCorpus(fixture));
			const mountMs = Date.now() - started;
			await page.waitForTimeout(250);

			expect(networkRequests).toEqual([]);
			expect(uncaughtErrors).toEqual([]);
			if (fixture.maxMountMs !== undefined) expect(mountMs).toBeLessThan(fixture.maxMountMs);
			await expect(page.locator([
				'.cm-content script', '.cm-content iframe', '.cm-content object', '.cm-content embed',
				'.cm-content form', '.cm-content foreignObject', '.mlp-mermaid-wrap script',
				'.mlp-mermaid-wrap foreignObject', '.mlp-drawio-wrap script', '.mlp-drawio-wrap foreignObject',
			].join(', '))).toHaveCount(0);
			expect(await page.evaluate(() => ({
				script: (window as unknown as { __markdownScriptRan?: boolean }).__markdownScriptRan,
				handler: (window as unknown as { __markdownHandlerRan?: boolean }).__markdownHandlerRan,
			}))).toEqual({ script: undefined, handler: undefined });
			await expect(page.locator('.cm-content')).toContainText(fixture.visibleText);
			if (fixture.frontmatterError) await expect(page.locator('.mlp-frontmatter-error')).toBeVisible();
		});
	}

	test('circular YAML aliases fail closed without breaking the editor', async ({ page }) => {
		await mountEditor(page, MALICIOUS_YAML_ALIAS);
		const error = page.locator('.mlp-frontmatter-error');
		await expect(error).toHaveAttribute('role', 'alert');
		await expect(error).toContainText('Could not parse the front matter');
		await expect(error).toContainText('YAML aliases must not form a circular reference.');
		await expect(page.locator('.cm-content')).toContainText('The editor must stay responsive');
	});

	test('remote images are inert by default and make no request', async ({ page }) => {
		const requests: string[] = [];
		page.on('request', (request) => {
			if (request.url().startsWith('https://tracker.invalid/')) requests.push(request.url());
		});
		await mountEditor(page, 'Intro\n\n![tracking](https://tracker.invalid/pixel.png)\n');
		await expect(page.locator('.cm-content .mlp-image-blocked').first()).toBeVisible();
		await expect(page.locator('.cm-content img[src*="tracker.invalid"]')).toHaveCount(0);
		expect(requests).toEqual([]);
	});

	test('HTTPS opt-in still rejects malformed remote image URLs', async ({ page }) => {
		const requests: string[] = [];
		await page.route('https://tracker.invalid/**', async (route) => {
			requests.push(route.request().url());
			await route.abort();
		});
		await mountEditor(page, [
			'![malformed](https:tracker.invalid/malformed.png)',
			'![allowed](https://tracker.invalid/allowed.png)',
		].join('\n'), { remoteMedia: 'https' });
		await expect(page.locator('.cm-content img[src*="malformed.png"]')).toHaveCount(0);
		await expect(page.locator('.cm-content')).toContainText('https:tracker.invalid/malformed.png');
		await expect(page.locator('.cm-content img[src="https://tracker.invalid/allowed.png"]')).toHaveCount(1);
		await expect.poll(() => [...requests]).toEqual(['https://tracker.invalid/allowed.png']);
	});

	test('HTTPS image redirects cannot downgrade to HTTP', async ({ page }) => {
		const httpsRequests: string[] = [];
		const downgradedRequests: string[] = [];
		await page.route('https://redirect.invalid/**', async (route) => {
			httpsRequests.push(route.request().url());
			await route.fulfill({
				status: 302,
				headers: { location: 'http://tracker.invalid/downgraded.png' },
			});
		});
		await page.route('http://tracker.invalid/**', async (route) => {
			downgradedRequests.push(route.request().url());
			await route.abort();
		});

		await mountEditor(page, 'Intro\n\n![redirect](https://redirect.invalid/pixel.png)', { remoteMedia: 'https' });
		const image = page.locator('.cm-content img[src="https://redirect.invalid/pixel.png"]');
		await expect(image).toHaveCount(1);
		await expect.poll(() => [...httpsRequests]).toEqual(['https://redirect.invalid/pixel.png']);
		await page.waitForTimeout(250);
		expect(downgradedRequests).toEqual([]);
		expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(0);
	});

	test('HTTPS image permission does not let custom CSS initiate requests', async ({ page }) => {
		const requests: string[] = [];
		page.on('request', (request) => {
			if (request.url().includes('tracker.invalid')) requests.push(request.url());
		});
		await mountEditor(page, '# Styled heading\n', {
			remoteMedia: 'https',
			css: 'h1 { background-image: image-set("https://tracker.invalid/css-pixel.png" 1x); }',
		});
		await page.waitForTimeout(250);
		expect(requests).toEqual([]);
		const background = await page.locator('.cm-line', { hasText: 'Styled heading' })
			.evaluate((element) => getComputedStyle(element).backgroundImage);
		expect(background).toBe('none');
		const warning = page.locator('#mlp-css-warning');
		await expect(warning).toBeVisible();
		await expect(warning).toContainText('Unsafe CSS theme rules were ignored');

		await postToWebview(page, {
			type: 'applyCss',
			css: 'h1 { color: rgb(4, 5, 6); }\ndiv { --cover: fixed; position: var(--cover); opacity: 0; }',
		});
		const heading = page.locator('.cm-line', { hasText: 'Styled heading' });
		await expect(heading).toHaveCSS('color', 'rgb(4, 5, 6)');
		const appliedCss = await page.locator('#mlp-user-css').evaluate((element) => element.textContent ?? '');
		expect(appliedCss).not.toContain('--cover');
		await expect(warning).toBeVisible();

		// CSS nesting can otherwise move `&` into an ancestor selector and escape
		// the document-content scope applied by the extension.
		await postToWebview(page, {
			type: 'applyCss',
			css: 'h1 { body:has(&) { display: none; } }',
		});
		expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe('none');
		expect(await page.locator('#mlp-user-css').evaluate((element) => element.textContent ?? '')).not.toContain('body:has');
		await expect(warning).toBeVisible();

		await postToWebview(page, { type: 'applyCss', css: 'h1 { color: rgb(1, 2, 3); }' });
		await expect(warning).toBeHidden();
	});

	test('HTTPS image permission does not let Mermaid labels initiate requests', async ({ page }) => {
		const networkRequests: string[] = [];
		page.on('request', (request) => {
			if (/^https?:/i.test(request.url()) && !HARNESS_RESOURCES.has(request.url())) networkRequests.push(request.url());
		});
		await mountEditor(page, [
			'Intro',
			'',
			'```mermaid',
			'graph TD',
			'A["<img src=https://network.invalid/mermaid-label onerror=alert(1)>"] --> B',
			'```',
			'',
		].join('\n'), { remoteMedia: 'https' });
		await expect(page.locator('.mlp-mermaid-wrap')).toBeVisible();
		await page.waitForTimeout(250);
		expect(networkRequests).toEqual([]);
		await expect(page.locator('.mlp-mermaid-wrap img')).toHaveCount(0);
	});

	test('raw HTML remains text and cannot create active DOM', async ({ page }) => {
		await mountEditor(
			page,
			'Intro\n\n<script>window.__rawHtmlRan = 1</script>\n<img src="https://tracker.invalid/x" onerror="window.__rawHtmlRan=2">\n',
		);
		await expect(page.locator('.cm-content script, .cm-content img')).toHaveCount(0);
		expect(await page.evaluate(() => (window as unknown as { __rawHtmlRan?: number }).__rawHtmlRan)).toBeUndefined();
	});

	test('only bare line breaks render inside table cells; other HTML stays inert', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| Value |\n| --- |\n| x<br>y <img src=x onerror="window.__tableHtmlRan=1"> |\n');
		const cell = page.locator('.mlp-table td');
		await expect(cell).toContainText('xy');
		await expect(cell).toContainText('<img src=x');
		await expect(cell.locator('br')).toHaveCount(1);
		await expect(cell.locator('img')).toHaveCount(0);
		expect(await page.evaluate(() => (window as unknown as { __tableHtmlRan?: number }).__tableHtmlRan)).toBeUndefined();
	});

	test('malformed host messages are rejected without changing the document', async ({ page }) => {
		await mountEditor(page, 'unchanged');
		await postToWebview(page, {
			type: 'externalUpdate',
			version: 2,
			changes: [{ from: 0, to: 9999, insert: 'compromised' }],
		});
		await expect(page.locator('.cm-content')).toContainText('unchanged');
		await expect(page.locator('.cm-content')).not.toContainText('compromised');
	});

	test('rejects non-canonical vault metadata before it can resolve a link', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n[[Injected]]');
		await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(1);
		await postToWebview(page, {
			type: 'vaultNotes',
			notes: [{ path: '../Injected.md', basename: 'Injected', aliases: [], headings: [], blockIds: [] }],
		});
		await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(1);
	});

	test('rejects a non-canonical embedded-note source path without consuming the request', async ({ page }) => {
		const note = { path: 'Note.md', basename: 'Note', aliases: [], headings: [], blockIds: [] };
		await mountEditor(page, 'Intro\n\n![[Note]]', { vaultNotes: [note], currentVaultPath: 'Current.md' });
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'readWikiEmbed'))).toBe(true);
		const requestId = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.find((message) => message.type === 'readWikiEmbed')!.requestId!);
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: '../Note.md', text: '# Injected' });
		await expect(page.locator('.mlp-wiki-embed-content')).toHaveCount(0);
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Note.md', text: '# Safe' });
		await expect(page.locator('.mlp-wiki-embed-content')).toContainText('Safe');
	});

	test('local images load only from validated host-delivered raster bytes', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n![local](assets/picture.png)\n', { currentVaultPath: 'Current.md' });
		const image = page.locator('.cm-content .mlp-image');
		await expect(image).not.toHaveAttribute('src');
		const request = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.find((message) => message.type === 'resolveLocalImage')!);
		await postToWebview(page, { type: 'localImage', requestId: request.requestId, uri: 'file:///etc/passwd' });
		await expect(image).not.toHaveAttribute('src');
		await postToWebview(page, {
			type: 'localImage', requestId: request.requestId,
			mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB',
		});
		await expect(image).toHaveAttribute('src', /^blob:/);
	});

	test('restricted mode keeps diagrams and CSS inert', async ({ page }) => {
		await mountEditor(
			page,
			'Intro\n\n# Heading\n\n```mermaid\ngraph TD; A-->B\n```\n\n![](diagram.drawio)\n',
			{ workspaceTrusted: false, css: 'h1 { color: rgb(1, 2, 3); }' },
		);
		await expect(page.locator('.mlp-mermaid-wrap, .mlp-drawio-wrap')).toHaveCount(0);
		await expect(page.locator('.cm-line', { hasText: 'graph TD' })).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'readDrawioFile')))
			.toBe(false);
		const headingColor = await page.locator('.cm-line', { hasText: 'Heading' }).evaluate((element) => getComputedStyle(element).color);
		expect(headingColor).not.toBe('rgb(1, 2, 3)');

		await postToWebview(page, { type: 'applyCss', css: 'h1 { color: rgb(1, 2, 3); }' });
		const colorAfterForgedMessage = await page.locator('.cm-line', { hasText: 'Heading' }).evaluate((element) => getComputedStyle(element).color);
		expect(colorAfterForgedMessage).not.toBe('rgb(1, 2, 3)');

		const editor = page.locator('.cm-content');
		await editor.click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type('\nrestricted plain edit');
		await expect(editor).toContainText('restricted plain edit');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'edit')))
			.toBe(true);
	});
});
