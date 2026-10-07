import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const source = '---\npriority: 2\n---\n\nKeep the source intact.';
const vaultPath = 'QA/Pending property recovery.md';
const snapshot = (value: string): string => `${source}\n\nUncommitted property priority:\n${value}`;

async function messages(page: Page, type: string): Promise<any[]> {
	return page.evaluate(kind => (window as any).__posted.filter((message: any) => message.type === kind), type);
}

async function pendingPropertyRecovery(page: Page) {
	await mountEditor(page, source, { currentVaultPath: vaultPath });
	await page.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
	const input = page.getByRole('textbox', { name: 'Edit priority', exact: true });
	await input.fill('first-invalid-value');
	await page.keyboard.press(`${modifier}+s`);
	await expect.poll(() => messages(page, 'preserveDraft')).toHaveLength(1);
	const request = (await messages(page, 'preserveDraft'))[0];
	expect(request.text).toBe(snapshot('first-invalid-value'));
	// The harness deliberately does not acknowledge preservation. The editor
	// locks source edits, but this existing property field remains editable.
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	await expect(input).toBeEditable();
	return { input, request };
}

test('an editable property journals newer invalid input while its earlier recovery request is pending', async ({ page }) => {
	const { input, request } = await pendingPropertyRecovery(page);
	await input.fill('newest-invalid-value');
	await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)).toEqual({
		type: 'draftSnapshot', baselineText: source,
		text: snapshot('newest-invalid-value'), requiresSeparatePreservation: true,
	});
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText))
		.toBe(snapshot('newest-invalid-value'));
	expect(await messages(page, 'edit')).toHaveLength(0);
	// An acknowledgement for the older value must not erase the newer journal.
	await postToWebview(page, { type: 'draftPreserved', requestId: request.requestId, ok: true });
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText))
		.toBe(snapshot('newest-invalid-value'));
	expect(await messages(page, 'edit')).toHaveLength(0);
});

test('an older recovery acknowledgement preserves the newer residual after the field loses focus', async ({ page }) => {
	const { input, request } = await pendingPropertyRecovery(page);
	for (const value of ['newer-invalid-value', 'newest-invalid-value']) await input.fill(value);
	await page.locator('.cm-line').filter({ hasText: 'Keep the source intact.' }).click();
	// Inputs coalesce into one journal while the earlier request is outstanding.
	expect(await messages(page, 'preserveDraft')).toHaveLength(1);
	await postToWebview(page, { type: 'draftPreserved', requestId: request.requestId, ok: true });
	await expect.poll(() => messages(page, 'preserveDraft')).toHaveLength(2);
	const newest = (await messages(page, 'preserveDraft'))[1];
	expect(newest.text).toBe(snapshot('newest-invalid-value'));
	expect(newest.requestId).not.toBe(request.requestId);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText))
		.toBe(snapshot('newest-invalid-value'));
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	await postToWebview(page, { type: 'draftPreserved', requestId: newest.requestId, ok: true });
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
	expect(await messages(page, 'edit')).toHaveLength(0);
});

test('failed preservation still journals later field input and retries the latest residual', async ({ page }) => {
	const { input, request } = await pendingPropertyRecovery(page);
	await input.fill('newer-invalid-value');
	await postToWebview(page, { type: 'draftPreserved', requestId: request.requestId, ok: false });
	await input.fill('newest-invalid-value');
	await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)?.text)
		.toBe(snapshot('newest-invalid-value'));
	await page.getByRole('button', { name: 'Retry preserving draft' }).click();
	await expect.poll(async () => (await messages(page, 'preserveDraft')).at(-1)?.text)
		.toBe(snapshot('newest-invalid-value'));
	expect(await messages(page, 'edit')).toHaveLength(0);
});

test('correcting the field back to its original value cannot leave a failed older recovery locking editing', async ({ page }) => {
	const { input, request } = await pendingPropertyRecovery(page);
	await input.fill('2');
	await expect.poll(async () => (await messages(page, 'draftSnapshot')).at(-1)?.text).toBe(source);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
	await postToWebview(page, { type: 'draftPreserved', requestId: request.requestId, ok: false });
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
	await expect(page.getByRole('button', { name: 'Retry preserving draft' })).toHaveCount(0);
	await input.fill('3');
	await input.press('Enter');
	await expect.poll(async () => (await messages(page, 'edit')).length).toBeGreaterThan(0);
});

test('an unrelated host conflict keeps the original invalid-property journal through blur and retry', async ({ page }) => {
	await mountEditor(page, source, { currentVaultPath: vaultPath });
	await page.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
	await page.getByRole('textbox', { name: 'Edit priority', exact: true }).fill('original-invalid-value');
	const hostText = source.replace('Keep the source intact.', 'Independent host changes.');
	await postToWebview(page, {
		type: 'init', protocolVersion: 1, text: hostText, version: 20, css: '', codeTheme: 'dark-plus', remoteMedia: 'block',
		workspaceTrusted: true, diagramRenderingAllowed: true, editingMode: 'editing', vaultNotes: [], currentVaultPath: vaultPath,
	});
	await expect.poll(() => messages(page, 'preserveDraft')).toHaveLength(1);
	const request = (await messages(page, 'preserveDraft'))[0];
	expect(request.text).toBe(snapshot('original-invalid-value'));
	await expect(page.locator('.cm-content')).toContainText('Independent host changes.');
	await expect(page.locator('.mlp-property-input')).toHaveCount(0);
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await postToWebview(page, { type: 'draftPreserved', requestId: request.requestId, ok: false });
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText))
		.toBe(snapshot('original-invalid-value'));
	await page.getByRole('button', { name: 'Retry preserving draft' }).click();
	await expect.poll(() => messages(page, 'preserveDraft')).toHaveLength(2);
	expect((await messages(page, 'preserveDraft'))[1].text).toBe(request.text);
	expect(await messages(page, 'edit')).toHaveLength(0);
});
