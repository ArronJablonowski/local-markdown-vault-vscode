import { test, expect, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const vaultPath = 'QA/Save safety.md';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function messages(page: Page, type: string): Promise<any[]> {
	return page.evaluate(kind => (window as any).__posted.filter((message: any) => message.type === kind), type);
}

function applyEdits(initial: string, edits: any[]): string {
	let text = initial;
	for (const edit of edits) {
		for (const change of [...edit.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
	}
	return text;
}

async function init(page: Page, text: string, version = 20): Promise<void> {
	await postToWebview(page, {
		type: 'init', protocolVersion: 1, text, version, css: '', codeTheme: 'dark-plus', remoteMedia: 'block',
		workspaceTrusted: true, diagramRenderingAllowed: true, editingMode: 'editing', vaultNotes: [], currentVaultPath: vaultPath,
	});
}

async function typeWithUnsentTail(page: Page): Promise<void> {
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await page.locator('.cm-content').click();
	await page.keyboard.press('End');
	await page.keyboard.type('A');
	await expect.poll(() => messages(page, 'edit')).toHaveLength(1);
	await page.keyboard.type('BC');
	await expect(page.locator('.cm-content')).toContainText('Start ABC');
	expect(await messages(page, 'edit')).toHaveLength(1);
}

test('a conflicting host snapshot preserves the entire local note, including the unsent tail', async ({ page }) => {
	await mountEditor(page, 'Start ', { currentVaultPath: vaultPath });
	await typeWithUnsentTail(page);
	await init(page, 'External edit');
	await expect.poll(async () => (await messages(page, 'preserveDraft')).map(message => message.text)).toContain('Start ABC');
	const preserved = (await messages(page, 'preserveDraft')).find(message => message.text === 'Start ABC');
	expect(Number.isSafeInteger(preserved.requestId)).toBe(true);
	// A conflict must not turn the local offset-based patch into an overwrite of
	// the independently changed host document.
	expect((await messages(page, 'edit')).filter(message => message.baseVersion === 20)).toHaveLength(0);
});

test('a failed conflict preservation keeps the draft recoverable and permits an explicit retry', async ({ page }) => {
	await mountEditor(page, 'Start ', { currentVaultPath: vaultPath });
	await typeWithUnsentTail(page);
	await init(page, 'External edit');
	await expect.poll(() => messages(page, 'preserveDraft')).not.toHaveLength(0);
	const first = (await messages(page, 'preserveDraft')).at(-1)!;
	await postToWebview(page, { type: 'draftPreserved', requestId: first.requestId, ok: false });
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText)).toBe('Start ABC');
	await page.getByRole('button', { name: 'Retry preserving draft' }).click();
	await expect.poll(async () => (await messages(page, 'preserveDraft')).length).toBeGreaterThan(1);
	const retry = (await messages(page, 'preserveDraft')).at(-1)!;
	expect(retry.text).toBe('Start ABC');
	expect(retry.requestId).not.toBe(first.requestId);
	await postToWebview(page, { type: 'draftPreserved', requestId: retry.requestId, ok: true });
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
});

test('leaving the window during conflict preservation does not replace the request that unlocks editing', async ({ page }) => {
	await mountEditor(page, 'Start ', { currentVaultPath: vaultPath });
	await typeWithUnsentTail(page);
	await init(page, 'External edit');
	await expect.poll(() => messages(page, 'preserveDraft')).not.toHaveLength(0);
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	const request = (await messages(page, 'preserveDraft')).at(-1)!;
	await postToWebview(page, { type: 'draftPreserved', requestId: request.requestId, ok: true });
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
});

test('external changes never apply stale host offsets to locally ahead text', async ({ page }) => {
	await mountEditor(page, 'Start ', { currentVaultPath: vaultPath });
	await typeWithUnsentTail(page);
	await postToWebview(page, { type: 'externalUpdate', version: 8, changes: [{ from: 0, to: 5, insert: 'Changed' }] });
	await expect.poll(() => messages(page, 'resync')).not.toHaveLength(0);
	await expect(page.locator('.cm-content')).toContainText('Start ABC');
	await expect(page.locator('.cm-content')).not.toContainText('Changed ABC');
	await init(page, 'Changed ');
	await expect.poll(async () => (await messages(page, 'preserveDraft')).map(message => message.text)).toContain('Start ABC');
});

test('clean host updates replace the host checkpoint instead of retaining a stale local snapshot', async ({ page }) => {
	await mountEditor(page, 'Before', { currentVaultPath: vaultPath });
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'After' }] });
	await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)).toEqual({
		type: 'draftSnapshot', text: 'After', baselineText: 'After',
	});
	await init(page, 'Newest');
	await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)).toEqual({
		type: 'draftSnapshot', text: 'Newest', baselineText: 'Newest',
	});
	expect(await messages(page, 'preserveDraft')).toHaveLength(0);
});

test('typing during a slow save journals the full draft before the host acknowledges', async ({ page }) => {
	await mountEditor(page, 'Start ', { currentVaultPath: vaultPath });
	await typeWithUnsentTail(page);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toEqual({
		version: 1, baselineText: 'Start A', draftText: 'Start ABC', currentVaultPath: vaultPath,
	});
	// The journal is independent of the outbound batch, which currently contains
	// only A while BC still lives in the renderer's pending queue.
	expect(applyEdits('Start ', await messages(page, 'edit'))).toBe('Start A');
});

test('explicit Save waits for every pending edit acknowledgement, including a queued typing tail', async ({ page }) => {
	await mountEditor(page, 'Start ', { currentVaultPath: vaultPath });
	await typeWithUnsentTail(page);
	await page.keyboard.press(`${modifier}+s`);
	expect(await messages(page, 'save')).toHaveLength(0);
	await postToWebview(page, { type: 'ackEdit', version: 1 });
	await expect.poll(() => messages(page, 'edit')).toHaveLength(2);
	expect(await messages(page, 'save')).toHaveLength(0);
	await postToWebview(page, { type: 'ackEdit', version: 2 });
	await expect.poll(() => messages(page, 'save')).toHaveLength(1);
	expect(applyEdits('Start ', await messages(page, 'edit'))).toBe('Start ABC');
});

test('a stale acknowledgement after resynchronization cannot discard a newly replayed draft', async ({ page }) => {
	await mountEditor(page, 'Start ', { currentVaultPath: vaultPath });
	await typeWithUnsentTail(page);
	await init(page, 'Start A', 1);
	await expect.poll(() => messages(page, 'edit')).toHaveLength(2);
	await postToWebview(page, { type: 'ackEdit', version: 1 });
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText)).toBe('Start ABC');
	await page.keyboard.type('D');
	expect(await messages(page, 'edit')).toHaveLength(2);
	await postToWebview(page, { type: 'ackEdit', version: 2 });
	await expect.poll(() => messages(page, 'edit')).toHaveLength(3);
	expect((await messages(page, 'edit')).at(-1)?.baseVersion).toBe(2);
});

test('replacing selected text with identical contents does not leave Save waiting for a nonexistent version', async ({ page }) => {
	await mountEditor(page, 'Same text', { currentVaultPath: vaultPath });
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await page.locator('.cm-content').click();
	await page.keyboard.press(`${modifier}+a`);
	await page.locator('.cm-content').evaluate(element => {
		const clipboardData = new DataTransfer();
		clipboardData.setData('text/plain', 'Same text');
		element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
	});
	await page.keyboard.press(`${modifier}+s`);
	await expect.poll(() => messages(page, 'save')).toHaveLength(1);
	expect(await messages(page, 'edit')).toHaveLength(0);
	await expect(page.locator('.cm-content')).toHaveText('Same text');
});

test('an oversized paste cannot clear the current local recovery journal', async ({ page }) => {
	await mountEditor(page, 'Start ', { currentVaultPath: vaultPath });
	await typeWithUnsentTail(page);
	await page.locator('.cm-content').evaluate(element => {
		const clipboardData = new DataTransfer();
		clipboardData.setData('text/plain', 'Z'.repeat(20 * 1024 * 1024 + 1));
		element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
	});
	await expect(page.locator('.cm-content')).toHaveText('Start ABC');
	await expect(page.locator('#mlp-recovery-notice')).toContainText('20 MiB');
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText)).toBe('Start ABC');
	expect(await messages(page, 'edit')).toHaveLength(1);
});

for (const widget of ['property', 'table'] as const) {
	const source = widget === 'property'
		? '---\ntitle: Before\n---\n\nBody'
		: 'Intro\n\n| Name | Value |\n| --- | --- |\n| Before | Value |\n\nBody';
	const replacement = 'Draft typed without leaving the field';

	async function editFocusedWidget(page: Page): Promise<void> {
		if (widget === 'property') {
			await page.locator('.mlp-frontmatter td').focus();
			await page.keyboard.press('Enter');
			await page.locator('.mlp-property-input').fill(replacement);
		} else {
			await page.locator('.mlp-table td').first().focus();
			await page.keyboard.press('F2');
			await page.keyboard.type(replacement);
		}
	}

	test(`${widget} typing synchronously checkpoints a reconstructable draft without leaving the field`, async ({ page }) => {
		await mountEditor(page, source, { currentVaultPath: vaultPath });
		await editFocusedWidget(page);
		await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)?.text).toContain(replacement);
		const latest = (await messages(page, 'draftSnapshot')).at(-1)!;
		expect(latest.baselineText).toBe(source);
		expect(latest.requiresSeparatePreservation).toBeUndefined();
		await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText)).toContain(replacement);
		await expect(widget === 'property' ? page.locator('.mlp-property-input') : page.locator('.mlp-table td').first()).toBeFocused();
	});

	test(`${widget} Escape cancels the checkpoint as well as the visible field draft`, async ({ page }) => {
		await mountEditor(page, source, { currentVaultPath: vaultPath });
		await editFocusedWidget(page);
		await page.keyboard.press('Escape');
		await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)?.text).toBe(source);
		await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
		expect(await messages(page, 'edit')).toHaveLength(0);
	});

	test(`${widget} drafts participate in explicit Save even while the field has focus`, async ({ page }) => {
		await mountEditor(page, source, { currentVaultPath: vaultPath });
		await editFocusedWidget(page);
		await page.keyboard.press(`${modifier}+s`);
		await expect.poll(async () => applyEdits(source, await messages(page, 'edit'))).toContain(replacement);
		await expect.poll(() => messages(page, 'save')).not.toHaveLength(0);
	});

	test(`incoming host snapshots preserve a focused ${widget} draft before replacing the widget`, async ({ page }) => {
		await mountEditor(page, source, { currentVaultPath: vaultPath });
		await page.evaluate(() => { (window as any).__holdEditAck = true; });
		await editFocusedWidget(page);
		await init(page, source.replace('Body', 'Externally changed body'));
		await expect.poll(async () => (await messages(page, 'preserveDraft')).some(message => message.text.includes(replacement))).toBe(true);
		const preserved = (await messages(page, 'preserveDraft')).find(message => message.text.includes(replacement));
		expect(preserved.text).toContain('Body');
		expect(preserved.text).not.toContain('Externally changed body');
		expect((await messages(page, 'edit')).filter(message => message.baseVersion === 20)).toHaveLength(0);
	});
}

const baseline = 'Original note\n';
const draft = 'Original note\nRecovered local paragraph 🙂\n';
const persisted = {
	version: 1, anchor: 0, head: 0, scrollTop: 0,
	recovery: { version: 1, baselineText: baseline, draftText: draft, currentVaultPath: vaultPath },
};

test('invalid property input is preserved separately and is never replayed into Markdown source', async ({ page }) => {
	const source = '---\npriority: 1\n---\n\nBody';
	await mountEditor(page, source, { currentVaultPath: vaultPath });
	await page.locator('.mlp-frontmatter td').focus();
	await page.keyboard.press('Enter');
	await page.locator('.mlp-property-input').fill('not-a-number');
	await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)?.requiresSeparatePreservation).toBe(true);
	await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)?.text).toContain('not-a-number');
	await page.keyboard.press(`${modifier}+s`);
	await expect.poll(async () => (await messages(page, 'preserveDraft')).some(message => message.text.includes('not-a-number'))).toBe(true);
	expect(await messages(page, 'edit')).toHaveLength(0);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.requiresSeparatePreservation)).toBe(true);
	const residual = await page.evaluate(() => (window as any).__webviewState);
	await mountEditor(page, source, { currentVaultPath: vaultPath, persistedState: residual });
	await expect.poll(async () => (await messages(page, 'preserveDraft')).some(message => message.text.includes('not-a-number'))).toBe(true);
	expect(await messages(page, 'edit')).toHaveLength(0);
	await expect(page.locator('.cm-content')).not.toContainText('not-a-number');
});

test('non-string YAML tag values do not throw or lose their edited snapshot', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	const source = '---\ntags: [1, 2]\n---\n\nBody';
	await mountEditor(page, source, { currentVaultPath: vaultPath });
	await page.locator('.mlp-frontmatter td').focus();
	await page.keyboard.press('Enter');
	await page.locator('.mlp-property-input').fill('1, 2, 3');
	await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)?.text).toContain('3');
	await page.keyboard.press(`${modifier}+s`);
	await expect.poll(async () => applyEdits(source, await messages(page, 'edit'))).toContain('3');
	expect(errors).toEqual([]);
});

test('invalid property input survives moving focus and continuing to edit the note', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	const source = '---\npriority: 1\n---\n\nBody';
	await mountEditor(page, source, { currentVaultPath: vaultPath });
	await page.locator('.mlp-frontmatter td').focus();
	await page.keyboard.press('Enter');
	await page.locator('.mlp-property-input').fill('not-a-number');
	await page.locator('.cm-line').filter({ hasText: 'Body' }).click();
	await expect.poll(async () => (await messages(page, 'preserveDraft')).some(message => message.text.includes('not-a-number'))).toBe(true);
	const preserved = (await messages(page, 'preserveDraft')).at(-1)!;
	await postToWebview(page, { type: 'draftPreserved', requestId: preserved.requestId, ok: true });
	await page.locator('.cm-line').filter({ hasText: 'Body' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await expect.poll(async () => applyEdits(source, await messages(page, 'edit'))).toContain('Body edited');
	expect(applyEdits(source, await messages(page, 'edit'))).not.toContain('not-a-number');
	expect(preserved.text).toContain('Uncommitted property priority:\nnot-a-number');
	expect(errors).toEqual([]);
});

test('Escape intentionally cancels invalid property input without preserving it on blur', async ({ page }) => {
	const source = '---\npriority: 1\n---\n\nBody';
	await mountEditor(page, source, { currentVaultPath: vaultPath });
	await page.locator('.mlp-frontmatter td').focus();
	await page.keyboard.press('Enter');
	await page.locator('.mlp-property-input').fill('not-a-number');
	await page.keyboard.press('Escape');
	await page.locator('.cm-line').filter({ hasText: 'Body' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await expect.poll(async () => applyEdits(source, await messages(page, 'edit'))).toContain('Body edited');
	expect(await messages(page, 'preserveDraft')).toHaveLength(0);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
});

test('a recreated hidden editor replays its draft only against an unchanged host baseline', async ({ page }) => {
	await mountEditor(page, baseline, { currentVaultPath: vaultPath, persistedState: persisted });
	await expect(page.locator('.cm-content')).toContainText('Recovered local paragraph 🙂');
	await expect.poll(async () => applyEdits(baseline, await messages(page, 'edit'))).toBe(draft);
	expect(await messages(page, 'preserveDraft')).toHaveLength(0);
});

test('a recreated hidden editor preserves a divergent draft separately without overwriting the host', async ({ page }) => {
	const hostText = 'Different note content saved by another editor\n';
	await mountEditor(page, hostText, { currentVaultPath: vaultPath, persistedState: persisted });
	await expect.poll(async () => (await messages(page, 'preserveDraft')).map(message => message.text)).toContain(draft);
	await expect(page.locator('.cm-content')).toContainText(hostText.trim());
	expect(await messages(page, 'edit')).toHaveLength(0);
});

test('an already-saved recovered draft is not replayed or duplicated', async ({ page }) => {
	await mountEditor(page, draft, { currentVaultPath: vaultPath, persistedState: persisted });
	await expect(page.locator('.cm-content')).toContainText('Recovered local paragraph 🙂');
	expect(await messages(page, 'edit')).toHaveLength(0);
	expect(await messages(page, 'preserveDraft')).toHaveLength(0);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
});

test('a recovered draft for a different vault path is never replayed into the current note', async ({ page }) => {
	await mountEditor(page, baseline, { currentVaultPath: 'Different note.md', persistedState: persisted });
	expect(await messages(page, 'edit')).toHaveLength(0);
	await expect(page.locator('.cm-content')).not.toContainText('Recovered local paragraph');
	// A stale identity is not authority to mutate a different file. It must still
	// remain recoverable, either in its retained journal or a separate recovery.
	await expect.poll(async () => {
		const state = await page.evaluate(() => (window as any).__webviewState?.recovery?.draftText);
		return state === draft || (await messages(page, 'preserveDraft')).some(message => message.text === draft);
	}).toBe(true);
});
