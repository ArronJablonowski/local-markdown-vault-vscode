import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const notes = [
	{ path: 'Note.md', basename: 'Note', aliases: ['Primary'], headings: [{ text: 'Details', line: 3 }], blockIds: ['block-1'] },
	{ path: 'Folder/Other.md', basename: 'Other', aliases: [], headings: [], blockIds: [] },
];

test.describe('Obsidian-style wikilinks', () => {
	test('applies ordered vault-note chunks only after a complete generation', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n[[Chunked]]\n');
		await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(1);
		const chunked = { path: 'Chunked.md', basename: 'Chunked', aliases: [], headings: [], blockIds: [] };
		await postToWebview(page, { type: 'vaultNotesChunk', generation: 1, offset: 1, total: 1, notes: [] });
		await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(1);
		await postToWebview(page, { type: 'vaultNotesChunk', generation: 2, offset: 0, total: 1, notes: [chunked] });
		await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(0);
		await expect(page.locator('.mlp-wikilink')).toHaveText('Chunked');
		await postToWebview(page, { type: 'vaultNotesChunk', generation: 3, offset: 0, total: 0, notes: [] });
		await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(1);
	});

	test('renders resolved, aliased, embedded, and unresolved links safely', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n[[Note]] [[Folder/Other|Alias]] ![[Note]] [[Missing]]\n', { vaultNotes: notes });
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.find((message) => message.type === 'readWikiEmbed'))).not.toBeUndefined();
		const requestId = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.find((message) => message.type === 'readWikiEmbed')!.requestId!);
		await postToWebview(page, {
			type: 'wikiEmbed', requestId, sourcePath: 'Note.md',
			text: '# Included\n\n**Safe** content\n\n<script>window.pwned = true</script>\n\n![[Folder/Other]]',
		});
		await expect(page.locator('.mlp-wiki-note-embed').first().locator('h1')).toHaveText('Included');
		await expect(page.locator('.mlp-wiki-note-embed').first().locator('strong')).toHaveText('Safe');
		await expect(page.locator('.mlp-wiki-note-embed script')).toHaveCount(0);
		await expect(page.locator('.mlp-embed-raw-html')).toContainText('<script>');
		const sourceLink = page.locator('.mlp-wiki-embed-source').first();
		await expect(sourceLink).toHaveAttribute('role', 'link');
		await expect(sourceLink).toHaveAttribute('tabindex', '0');
		await sourceLink.focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted
				.filter((message) => message.type === 'openLink').at(-1),
		)).toMatchObject({ type: 'openLink', href: 'wikilink:Note' });

		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.filter((message) => message.type === 'readWikiEmbed').length)).toBe(2);
		const nestedRequestId = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.filter((message) => message.type === 'readWikiEmbed')[1].requestId!);
		await postToWebview(page, { type: 'wikiEmbed', requestId: nestedRequestId, sourcePath: 'Folder/Other.md', text: '![[Note]]' });
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.filter((message) => message.type === 'readWikiEmbed').length)).toBe(3);
		const cycleRequestId = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.filter((message) => message.type === 'readWikiEmbed')[2].requestId!);
		await postToWebview(page, { type: 'wikiEmbed', requestId: cycleRequestId, sourcePath: 'Note.md', text: '# Included' });
		await expect(page.locator('.mlp-wiki-embed-error')).toContainText('cycle blocked');
		await expect(page.locator('.mlp-wikilink')).toHaveCount(5);
		await expect(page.locator('.mlp-wikilink').nth(0)).toHaveText('Note');
		await expect(page.locator('.mlp-wikilink').nth(1)).toHaveText('Alias');
		await expect(page.locator('.mlp-wiki-note-embed')).toHaveCount(3);
		await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(1);
		await expect(page.locator('.cm-content')).not.toContainText('[[Note]]');
	});

	test('opens a rendered wikilink with pointer or keyboard activation', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n[[Note]]\n', { vaultNotes: notes });
		const link = page.locator('.mlp-wikilink');
		await link.click();
		await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted.at(-1)))
			.toMatchObject({ type: 'openLink', href: 'wikilink:Note' });

		await link.focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted.filter((message) => message.type === 'openLink').length))
			.toBe(2);
	});

	test('keeps PDF and audio embeds as open-only links', async ({ page }) => {
		await mountEditor(page, 'Attachments\n\n![[References/Paper.pdf]] [[Recording.mp3|Recording]]\n', { vaultNotes: notes });
		const links = page.locator('.mlp-wikilink-open-only');
		await expect(links).toHaveCount(2);
		await expect(page.locator('.mlp-wikilink-unresolved')).toHaveCount(0);
		await expect(page.locator('.mlp-wiki-note-embed')).toHaveCount(0);
		await links.first().hover();
		await page.waitForTimeout(600);
		expect(await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'readWikiEmbed'))).toBe(false);
		await links.first().click();
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted.at(-1)))
			.toMatchObject({ type: 'openLink', href: 'wikilink:References%2FPaper.pdf' });
	});

	test('offers note, alias, path, heading, and block completions while typing', async ({ page }) => {
		await mountEditor(page, 'Start\n', { vaultNotes: notes });
		await page.locator('.cm-line').first().click();
		await page.keyboard.press('End');
		await page.keyboard.type(' [[No');
		await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
		await expect(page.locator('.cm-completionLabel', { hasText: 'Note' })).toBeVisible();
		await page.keyboard.press('Escape');
		await page.keyboard.type('te#');
		await expect(page.locator('.cm-completionLabel', { hasText: 'Details' })).toBeVisible();
		await page.keyboard.press('Escape');
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('Start [[Pri');
		await expect(page.locator('.cm-completionLabel', { hasText: 'Primary' })).toBeVisible();
		// Visibility can precede CodeMirror's selected-option state by one render
		// under load. Enter is specified to accept the selected completion, so wait
		// for that accessible state rather than racing the tooltip transition.
		await expect(page.locator('.cm-tooltip-autocomplete [role="option"][aria-selected="true"] .cm-completionLabel'))
			.toHaveText('Primary');
		await page.keyboard.press('Enter');
		// CodeMirror may wrap one logical line into multiple visual `.cm-line`
		// nodes while the completion tooltip is closing. Assert the authoritative
		// editor content rather than depending on that transient layout.
		await expect(page.locator('.cm-content')).toContainText('[[Note|Primary]]');
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('Start [[Folder/');
		await expect(page.locator('.cm-completionLabel', { hasText: 'Other' })).toBeVisible();
		await page.keyboard.press('Escape');
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('Start [[Note^');
		await expect(page.locator('.cm-completionLabel', { hasText: 'block-1' })).toBeVisible();
	});

	test('re-filters bounded fragment completions while typing in a large note', async ({ page }) => {
		const largeNote = {
			path: 'Large.md', basename: 'Large', aliases: [],
			headings: Array.from({ length: 1_000 }, (_, index) => ({ text: `Heading ${index}`, line: index + 1 })),
			blockIds: Array.from({ length: 1_000 }, (_, index) => `block-${index}`),
		};
		await mountEditor(page, 'Start\n', { vaultNotes: [largeNote] });
		await page.locator('.cm-line').first().click();
		await page.keyboard.press('End');
		await page.keyboard.type(' [[Large#');
		await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
		expect(await page.locator('.cm-completionLabel').count()).toBeLessThanOrEqual(100);
		await page.keyboard.type('999');
		await expect(page.locator('.cm-completionLabel', { hasText: 'Heading 999' })).toBeVisible();
		await page.keyboard.press('Escape');
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('Start [[Large^999');
		await expect(page.locator('.cm-completionLabel', { hasText: 'block-999' })).toBeVisible();
	});

	test('shows a delayed, sanitized, network-inert hover preview', async ({ page }) => {
		let remoteRequests = 0;
		await page.route('https://tracker.invalid/**', async (route) => { remoteRequests++; await route.abort(); });
		await mountEditor(page, 'Intro\n\n[[Note]]\n', { vaultNotes: notes, currentVaultPath: 'Current.md', remoteMedia: 'https' });
		await page.locator('.mlp-wikilink').hover();
		await page.waitForTimeout(200);
		expect(await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'readWikiEmbed'))).toBe(false);
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'readWikiEmbed'))).toBe(true);
		const requestId = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.find((message) => message.type === 'readWikiEmbed')!.requestId!);
		await postToWebview(page, {
			type: 'wikiEmbed', requestId, sourcePath: 'Note.md',
			text: '# Preview\n\n![tracker](https://tracker.invalid/pixel.png)\n\n<script>bad()</script>\n\n![[Other]]',
		});
		await expect(page.locator('.mlp-wikilink-hover')).toBeVisible();
		await expect(page.locator('.mlp-wikilink-hover h1')).toHaveText('Preview');
		await expect(page.locator('.mlp-wikilink-hover script')).toHaveCount(0);
		await expect(page.locator('.mlp-wikilink-hover img')).not.toHaveAttribute('src');
		expect(remoteRequests).toBe(0);
	});

	test('renders bounded raster wikilink embeds and Obsidian dimensions from the local vault root', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n![[Assets/picture.png]] ![[Assets/sized.png|320x180]] ![[Assets/huge.png|9999x1]]\n', {
			vaultNotes: notes,
			currentVaultPath: 'Current.md',
		});
		const images = page.locator('.mlp-wiki-image-embed');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.filter((message) => message.type === 'resolveLocalImage').length)).toBe(3);
		const requests = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number; src?: string; contextPath?: string }> }).__posted
				.filter((message) => message.type === 'resolveLocalImage'));
		expect(requests[0]).toMatchObject({ src: '/Assets/picture.png', contextPath: 'Current.md' });
		for (const request of requests) {
			await postToWebview(page, {
				type: 'localImage', requestId: request.requestId,
				mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB',
			});
		}
		await expect(images).toHaveCount(3);
		await expect(images.nth(0)).toHaveAttribute('src', /^blob:/);
		await expect(images.nth(0)).toHaveAttribute('alt', 'Assets/picture.png');
		await expect(images.nth(1)).toHaveAttribute('width', '320');
		await expect(images.nth(1)).toHaveAttribute('height', '180');
		await expect(images.nth(1)).toHaveAttribute('alt', 'Assets/sized.png');
		await expect(images.nth(2)).not.toHaveAttribute('width');
		await expect(images.nth(2)).toHaveAttribute('alt', '9999x1');
	});

	test('resolves ordinary links from the embedded note without allowing vault escape', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n![[Folder/Other]]\n', {
			vaultNotes: notes,
			currentVaultPath: 'Notes/Parent.md',
		});
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'readWikiEmbed'))).toBe(true);
		const requestId = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.find((message) => message.type === 'readWikiEmbed')!.requestId!);
		await postToWebview(page, {
			type: 'wikiEmbed', requestId, sourcePath: 'Folder/Other.md',
			text: '[Sibling](Sibling.md#part) [outside](../../outside.md)',
		});
		const links = page.locator('.mlp-wiki-note-embed .mlp-link');
		await expect(links.nth(0)).toHaveAttribute('data-href', '../Folder/Sibling.md#part');
		await expect(links.nth(1)).toHaveAttribute('aria-disabled', 'true');
		await expect(links.nth(1)).not.toHaveAttribute('data-href', /.+/);
		await links.nth(0).click();
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted.at(-1)))
			.toMatchObject({ type: 'openLink', href: '../Folder/Sibling.md#part' });
	});

	test('renders an embedded-note wiki image through the same bounded local-image boundary', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n![[Folder/Other]]\n', {
			vaultNotes: notes,
			currentVaultPath: 'Notes/Parent.md',
		});
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.filter((message) => message.type === 'readWikiEmbed').length)).toBe(1);
		const requestId = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.find((message) => message.type === 'readWikiEmbed')!.requestId!);
		await postToWebview(page, {
			type: 'wikiEmbed', requestId, sourcePath: 'Folder/Other.md', text: '![[Assets/sized.png|240x120]]',
		});
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.filter((message) => message.type === 'resolveLocalImage').length)).toBe(1);
		expect(await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; src?: string; contextPath?: string }> }).__posted
				.find((message) => message.type === 'resolveLocalImage'))).toMatchObject({
			src: '/Assets/sized.png', contextPath: 'Folder/Other.md',
		});
		expect(await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.filter((message) => message.type === 'readWikiEmbed').length)).toBe(1);
		const imageRequestId = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
				.find((message) => message.type === 'resolveLocalImage')!.requestId!);
		await postToWebview(page, {
			type: 'localImage', requestId: imageRequestId,
			mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB',
		});
		const image = page.locator('.mlp-wiki-note-embed .mlp-wiki-image-embed');
		await expect(image).toHaveAttribute('src', /^blob:/);
		await expect(image).toHaveAttribute('width', '240');
		await expect(image).toHaveAttribute('height', '120');
		await expect(image).toHaveAttribute('alt', 'Assets/sized.png');
	});

	test('caps nested note embeds at three levels', async ({ page }) => {
		const nestedNotes = [
			...notes,
			{ path: 'Third.md', basename: 'Third', aliases: [], headings: [], blockIds: [] },
			{ path: 'Fourth.md', basename: 'Fourth', aliases: [], headings: [], blockIds: [] },
		];
		await mountEditor(page, 'Intro\n\n![[Note]]\n', { vaultNotes: nestedNotes, currentVaultPath: 'Root.md' });
		for (const [index, response] of [
			{ sourcePath: 'Note.md', text: '![[Folder/Other]]' },
			{ sourcePath: 'Folder/Other.md', text: '![[Third]]' },
			{ sourcePath: 'Third.md', text: '![[Fourth]]' },
		].entries()) {
			await expect.poll(() => page.evaluate(() =>
				(window as unknown as { __posted: Array<{ type: string }> }).__posted.filter((message) => message.type === 'readWikiEmbed').length)).toBe(index + 1);
			const requestId = await page.evaluate((requestIndex) =>
				(window as unknown as { __posted: Array<{ type: string; requestId?: number }> }).__posted
					.filter((message) => message.type === 'readWikiEmbed')[requestIndex].requestId!, index);
			await postToWebview(page, { type: 'wikiEmbed', requestId, ...response });
		}
		await expect(page.locator('.mlp-wiki-embed-error')).toContainText('nesting limit');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.filter((message) => message.type === 'readWikiEmbed').length)).toBe(3);
	});
});
