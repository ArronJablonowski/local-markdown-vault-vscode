import * as assert from 'assert';
import * as vscode from 'vscode';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Frame, type Page } from 'playwright';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let browser: Browser | undefined;
let sequence = 0;

suite('native Markdown save durability', () => {
	if (process.env.MDLP_SAVE_DURABILITY_TEST !== '1') return;
	let vault: vscode.Uri;
	const ownedDocuments = new Set<string>();
	const measurements: { label: string; milliseconds: number }[] = [];
	const artifacts = process.env.MDLP_SAVE_TEST_ARTIFACTS!;

	suiteSetup(async function () {
		this.timeout(30_000);
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root && root.scheme === 'file', 'an isolated local vault is required');
		assert.ok(root.fsPath.startsWith(process.env.MDLP_SAVE_TEST_TEMPORARY!));
		vault = root;
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, 'Local Markdown Vault is not installed');
		await extension.activate();
		await (await workbench()).bringToFront();
		assert.strictEqual(vscode.workspace.getConfiguration('files').get('autoSave'), 'off');
		assert.strictEqual(vscode.workspace.getConfiguration('mdLivePreview').get('autoSave'), true);
	});

	teardown(async function () {
		if (this.currentTest?.state === 'failed') {
			await mkdir(artifacts, { recursive: true });
			const label = this.currentTest.title.replace(/[^a-z0-9]/gi, '-').slice(0, 96);
			await (await workbench()).screenshot({ path: join(artifacts, `${label}.png`) });
			const buffers = vscode.workspace.textDocuments.filter(document => ownedDocuments.has(document.uri.toString()))
				.map(document => ({ uri: document.uri.toString(), dirty: document.isDirty, text: document.getText() }));
			await writeFile(join(artifacts, `${label}.json`), JSON.stringify(buffers, null, 2));
		}
		// Failure snapshots are captured before cleanup. Do not use save() here:
		// cleanup must not make an unsuccessful autosave assertion appear successful.
		for (const document of vscode.workspace.textDocuments) {
			if (ownedDocuments.has(document.uri.toString()) && document.isDirty) {
				await vscode.window.showTextDocument(document, { preview: false });
				await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			}
		}
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.workspace.getConfiguration('mdLivePreview').update('autoSave', true, vscode.ConfigurationTarget.Global);
	});

	suiteTeardown(async () => {
		await mkdir(artifacts, { recursive: true });
		await writeFile(join(artifacts, 'save-latencies.json'), JSON.stringify(measurements, null, 2));
	});

	test('continuous character-by-character typing saves before typing stops and preserves the final byte', async () => {
		const note = await fixture('continuous', 'Continuous save: ');
		const frame = await openLive(note, 'Continuous save:');
		await focusEnd(frame);
		const suffix = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let complete = false;
		const typing = frame.page().keyboard.type(suffix, { delay: 55 }).then(() => { complete = true; });
		await waitFor(async () => (await disk(note)).includes('abc'), 'typing never reached disk while keys were being pressed');
		assert.strictEqual(complete, false, 'automatic saving must not wait for an idle keyboard');
		await typing;
		await assertSaved(note, 'Continuous save: ' + suffix, 'continuous typing');
	});

	test('rapid typing survives twelve immediate switches without losing, duplicating, or reordering text', async function () {
		this.timeout(120_000);
		const notes = [await fixture('switch-a', 'Switch A: '), await fixture('switch-b', 'Switch B: ')];
		const expected = ['Switch A: ', 'Switch B: '];
		const page = await workbench();
		const inputEvidence: string[] = [];
		const record = (message: { text(): string }) => {
			if (message.text().startsWith('MDLP_SAVE_INPUT ')) inputEvidence.push(message.text());
		};
		page.on('console', record);
		try {
			for (let round = 0; round < 12; round++) {
				const index = round % 2;
				const frame = await openLive(notes[index], index === 0 ? 'Switch A:' : 'Switch B:');
				await focusEnd(frame);
				// Record input synchronously in the renderer. This adds no awaited
				// call between the final key and the switch, preserving the race.
				await frame.evaluate(currentRound => {
					const content = document.querySelector('.cm-content')!;
					content.addEventListener('input', event => {
						const data = (event as InputEvent).data;
						if (data === ';' || data === ' ') console.log('MDLP_SAVE_INPUT ' + JSON.stringify({
							round: currentRound, data, active: document.activeElement?.className,
							text: content.textContent?.slice(-2_000),
						}));
					});
				}, round);
				const suffix = `round-${round.toString().padStart(2, '0')}-abcdefghijklmnopqrstuvwxyz; `;
				await frame.page().keyboard.type(suffix, { delay: 0 });
				expected[index] += suffix;
				// No save, pause, or disk wait before switching away from the editor.
				await vscode.commands.executeCommand('vscode.openWith', notes[1 - index], 'mdLivePreview.editor', { preview: false });
			}
			await assertSaved(notes[0], expected[0], 'rapid alternating A');
			await assertSaved(notes[1], expected[1], 'rapid alternating B');
		} finally {
			page.off('console', record);
			await mkdir(artifacts, { recursive: true });
			await writeFile(join(artifacts, 'rapid-switch-input-evidence.json'), JSON.stringify(inputEvidence, null, 2));
		}
	});

	test('immediate close and reopen retains the complete final keystroke sequence', async () => {
		const note = await fixture('close-reopen', 'Close probe: ');
		const frame = await openLive(note, 'Close probe:');
		await focusEnd(frame);
		const suffix = 'The final characters must survive a closing tab.';
		await frame.page().keyboard.type(suffix, { delay: 1 });
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		await assertSaved(note, 'Close probe: ' + suffix, 'close before waiting for save');
		const reopened = await openLive(note, suffix);
		assert.ok((await reopened.locator('.cm-content').textContent())?.includes(suffix));
		assert.strictEqual((await vscode.workspace.openTextDocument(note)).isDirty, false);
	});

	test('UTF-8 BOM, CRLF, Unicode, combining marks, and trailing spaces survive edits byte-for-byte', async () => {
		const original = '\uFEFF# Unicode note\r\n\r\nExisting caf\u00e9 \u6771\u4eac \u{1f9ed}\r\nTail: ';
		const note = await fixture('unicode-crlf', original);
		const document = await vscode.workspace.openTextDocument(note);
		assert.strictEqual(document.eol, vscode.EndOfLine.CRLF);
		const frame = await openLive(note, 'Unicode note');
		await focusEnd(frame);
		const suffix = 'na\u00efve e\u0301 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u{1f600} \u{1f469}\u{1f3fd}\u200d\u{1f4bb}  ';
		await frame.page().keyboard.type(suffix, { delay: 8 });
		await frame.page().keyboard.press('Enter');
		await frame.page().keyboard.type('Last line', { delay: 5 });
		await assertSaved(note, original + suffix + '\r\nLast line', 'Unicode and CRLF');
		assert.deepStrictEqual(await readFile(note.fsPath), Buffer.from(original + suffix + '\r\nLast line', 'utf8'));
	});

	test('checkbox clicks followed by immediate switching save exactly the task-marker change', async () => {
		const source = '# Checkbox persistence\n\n- [ ] First task\n- [ ] Second task\n';
		const note = await fixture('checkbox', source);
		const other = await fixture('checkbox-other', 'Another file');
		const frame = await openLive(note, 'Checkbox persistence');
		await frame.locator('.mlp-checkbox').first().click();
		await vscode.commands.executeCommand('vscode.openWith', other, 'mdLivePreview.editor', { preview: false });
		await assertSaved(note, source.replace('- [ ] First task', '- [x] First task'), 'checkbox immediately switched');
		const restored = await openLive(note, 'Checkbox persistence');
		assert.strictEqual(await restored.locator('.mlp-checkbox').first().getAttribute('aria-checked'), 'true');
	});

	test('property commits followed by immediate switching preserve the entire YAML document', async () => {
		const source = '---\npriority: 2\nstatus: draft\n---\n\n# Property persistence\n\nUnchanged body.\n';
		const note = await fixture('properties', source);
		const other = await fixture('properties-other', 'Other properties file');
		const frame = await openLive(note, 'Property persistence');
		await frame.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
		await frame.getByRole('textbox', { name: 'Edit priority', exact: true }).fill('7');
		await frame.page().keyboard.press('Enter');
		await vscode.commands.executeCommand('vscode.openWith', other, 'mdLivePreview.editor', { preview: false });
		await assertSaved(note, source.replace('priority: 2', 'priority: 7'), 'property immediately switched');
	});

	test('table cell commits followed by immediate switching preserve surrounding Markdown', async () => {
		const source = '# Table persistence\n\n| Name | Value |\n| --- | --- |\n| Alpha | 3 |\n\nUnchanged tail.\n';
		const note = await fixture('table', source);
		const other = await fixture('table-other', 'Other table file');
		const frame = await openLive(note, 'Table persistence');
		await frame.locator('.mlp-table td').first().focus();
		await frame.page().keyboard.press('F2');
		await frame.page().keyboard.type('**Beta**<br>Second line', { delay: 3 });
		await frame.page().keyboard.press('Enter');
		await vscode.commands.executeCommand('vscode.openWith', other, 'mdLivePreview.editor', { preview: false });
		await assertSaved(note, source.replace('Alpha', '**Beta**<br>Second line'), 'table immediately switched');
	});

	test('uncommitted property text survives switching away without pressing Enter', async () => {
		const source = '---\nstatus: draft\n---\n\n# Property draft persistence\n\nUnchanged body.\n';
		const note = await fixture('property-draft', source);
		const other = await fixture('property-draft-other', 'Another draft file');
		const frame = await openLive(note, 'Property draft persistence');
		const valueCell = frame.getByRole('button', { name: 'Edit status', exact: true });
		// Visibility does not imply native iframe focus: the initial host focus
		// handoff can still be pending when CodeMirror's content first appears.
		// Establish the precise value target before one double-click, not after
		// a missed click or after typing (which could hide real draft loss).
		await valueCell.focus();
		await waitFor(() => valueCell.evaluate(element => document.hasFocus() && document.activeElement === element
			&& document.querySelector<HTMLElement>('.cm-content')?.isContentEditable === true),
		'the property value cell must be focused in an editable Live Preview before editing');
		await valueCell.dblclick();
		const input = frame.getByRole('textbox', { name: 'Edit status', exact: true });
		await input.selectText();
		assert.ok(await input.evaluate(element => {
			const field = element as HTMLInputElement;
			return document.hasFocus() && document.activeElement === field && field.value === 'draft'
				&& field.selectionStart === 0 && field.selectionEnd === field.value.length;
		}), 'the original property value must be focused and fully selected before typing');
		await frame.page().keyboard.type('reviewed', { delay: 4 });
		// Switching tabs is the commit gesture. The user need not know that a
		// property field uses a separate DOM input before it reaches Markdown.
		await vscode.commands.executeCommand('vscode.openWith', other, 'mdLivePreview.editor', { preview: false });
		await assertSaved(note, source.replace('status: draft', 'status: reviewed'), 'uncommitted property switch');
		await openLive(note, 'Property draft persistence');
	});

	test('uncommitted table text survives immediate close and reopen without pressing Enter', async () => {
		const source = '# Table draft persistence\n\n| Name | Value |\n| --- | --- |\n| Alpha | 3 |\n\nUnchanged tail.\n';
		const note = await fixture('table-draft', source);
		const frame = await openLive(note, 'Table draft persistence');
		await frame.locator('.mlp-table td').first().focus();
		await frame.page().keyboard.press('F2');
		await frame.page().keyboard.type('Retain this draft', { delay: 3 });
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		await assertSaved(note, source.replace('Alpha', 'Retain this draft'), 'uncommitted table close');
		const reopened = await openLive(note, 'Table draft persistence');
		assert.strictEqual((await reopened.locator('.mlp-table td').first().textContent())?.trim(), 'Retain this draft');
	});

	test('active property and table drafts survive configuration-triggered webview rebuilds', async () => {
		const source = '---\npriority: 2\n---\n\n# Configuration durability\n\n| Name | Value |\n| --- | --- |\n| Alpha | 3 |\n\nUnchanged tail.\n';
		const note = await fixture('configuration-rebuild', source);
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const previous = config.inspect<string>('diagramRendering')?.globalValue;
		await config.update('diagramRendering', 'safe', vscode.ConfigurationTarget.Global);
		try {
			let frame = await openLive(note, 'Configuration durability');
			await frame.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
			await frame.getByRole('textbox', { name: 'Edit priority', exact: true }).fill('8');
			await config.update('diagramRendering', 'off', vscode.ConfigurationTarget.Global);
			let expected = source.replace('priority: 2', 'priority: 8');
			await assertSaved(note, expected, 'property draft during configuration rebuild');
			await waitFor(() => frame.isDetached(), 'diagram settings did not rebuild the original property iframe');
			// Merely find the new iframe: executing openWith here could itself
			// flush a draft and mask a configuration-boundary regression.
			frame = await findLiveFrame('Configuration durability');
			await frame.locator('.mlp-table td').first().focus();
			await frame.page().keyboard.press('F2');
			await frame.page().keyboard.type('Survives configuration', { delay: 3 });
			await config.update('diagramRendering', 'safe', vscode.ConfigurationTarget.Global);
			expected = expected.replace('Alpha', 'Survives configuration');
			await assertSaved(note, expected, 'table draft during configuration rebuild');
			await waitFor(() => frame.isDetached(), 'diagram settings did not rebuild the original table iframe');
			const rebuilt = await findLiveFrame('Configuration durability');
			// Restoring the caret inside the table correctly reveals its source.
			// Move outside without editing before checking the rendered cell.
			await rebuilt.locator('.cm-content').focus();
			await rebuilt.page().keyboard.press(`${mod}+End`);
			assert.strictEqual((await rebuilt.locator('.mlp-table td').first().textContent())?.trim(), 'Survives configuration');
		} finally { await config.update('diagramRendering', previous, vscode.ConfigurationTarget.Global); }
	});

	test('edits arriving during a slow native save participant are not lost after the first save finishes', async () => {
		const note = await fixture('slow-participant', 'Slow participant: ');
		let calls = 0;
		const participant = vscode.workspace.onWillSaveTextDocument(event => {
			if (event.document.uri.toString() === note.toString() && calls++ < 3) {
				event.waitUntil(delay(120).then(() => []));
			}
		});
		try {
			const frame = await openLive(note, 'Slow participant:');
			await focusEnd(frame);
			const suffix = 'abcdefghij'.repeat(12);
			await frame.page().keyboard.type(suffix, { delay: 3 });
			await assertSaved(note, 'Slow participant: ' + suffix, 'edits during native save');
			assert.ok(calls > 0, 'the delayed native save participant was never exercised');
		} finally { participant.dispose(); }
	});

	test('native Text Editor keyboard edits autosave with VS Code files.autoSave disabled', async () => {
		const observed = new Set<string>();
		const events: Record<string, unknown>[] = [];
		const reads: Promise<void>[] = [];
		const record = (kind: string, document: vscode.TextDocument, changes?: readonly vscode.TextDocumentContentChangeEvent[]) => {
			if (!observed.has(document.uri.toString())) return;
			const entry: Record<string, unknown> = {
				order: events.length, time: Date.now(), kind, uri: document.uri.toString(),
				version: document.version, dirty: document.isDirty, text: document.getText(),
				...(changes ? { changes: changes.map(change => ({ offset: change.rangeOffset, length: change.rangeLength, text: change.text })) } : {}),
			};
			events.push(entry);
			if (kind === 'didSave') reads.push(readFile(document.uri.fsPath, 'utf8').then(text => {
				entry.disk = text; entry.diskReadFinished = Date.now();
			}, error => { entry.diskError = String(error); }));
		};
		const listeners = [
			vscode.workspace.onDidChangeTextDocument(event => record('change', event.document, event.contentChanges)),
			vscode.workspace.onWillSaveTextDocument(event => record('willSave', event.document)),
			vscode.workspace.onDidSaveTextDocument(document => record('didSave', document)),
		];
		try {
			for (let round = 0; round < 12; round++) {
				const initial = `Native text ${round}: `;
				const note = await fixture(`native-text-${round}`, initial);
				observed.add(note.toString());
				const document = await vscode.workspace.openTextDocument(note);
				await vscode.window.showTextDocument(document, { preview: false });
				const page = await focusNativeEnd(document);
				await page.keyboard.type('typed through the native editor, not WorkspaceEdit.', { delay: 4 });
				await assertSaved(note, initial + 'typed through the native editor, not WorkspaceEdit.', `native Text Editor ${round}`);
			}
		} finally {
			for (const listener of listeners) listener.dispose();
			await Promise.all(reads);
			await mkdir(artifacts, { recursive: true });
			await writeFile(join(artifacts, 'native-editor-save-events.json'), JSON.stringify(events, null, 2));
		}
	});

	test('undo and redo each settle to the exact corresponding disk snapshot', async () => {
		const original = '# History persistence\n\n- [ ] Review\n';
		const note = await fixture('history', original);
		const frame = await openLive(note, 'History persistence');
		await frame.locator('.mlp-checkbox').click();
		const edited = original.replace('[ ]', '[x]');
		await assertSaved(note, edited, 'before undo');
		await frame.locator('.cm-content').focus();
		await frame.page().keyboard.press(`${mod}+z`);
		await assertSaved(note, original, 'undo to disk');
		await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
		await assertSaved(note, edited, 'redo to disk');
	});

	test('disabling autosave preserves dirty changes and re-enabling saves the complete pending buffer', async () => {
		const original = 'Autosave preference: ';
		const note = await fixture('preference', original);
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		await config.update('autoSave', false, vscode.ConfigurationTarget.Global);
		try {
			const frame = await openLive(note, 'Autosave preference:');
			await focusEnd(frame);
			await frame.page().keyboard.type('Keep this pending text.', { delay: 4 });
			const document = await vscode.workspace.openTextDocument(note);
			await waitFor(() => document.getText() === original + 'Keep this pending text.', 'edit never reached host');
			await delay(300);
			assert.strictEqual(await disk(note), original, 'disabled autosave unexpectedly wrote to disk');
			assert.strictEqual(document.isDirty, true, 'unsaved changes must remain visibly dirty');
			await config.update('autoSave', true, vscode.ConfigurationTarget.Global);
			await assertSaved(note, original + 'Keep this pending text.', 're-enable autosave');
		} finally { await config.update('autoSave', true, vscode.ConfigurationTarget.Global); }
	});

	test('manual Save with autosave off commits plain text, an active property draft, and an active table draft', async () => {
		const original = '---\npriority: 2\n---\n\n# Explicit Save\n\n| Name | Value |\n| --- | --- |\n| Alpha | 3 |\n\nTail: ';
		const note = await fixture('manual-save', original);
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		await config.update('autoSave', false, vscode.ConfigurationTarget.Global);
		try {
			const frame = await openLive(note, 'Explicit Save');
			await focusEnd(frame);
			await frame.page().keyboard.type('A manual text save.', { delay: 2 });
			await frame.page().keyboard.press(`${mod}+s`);
			let expected = original + 'A manual text save.';
			await assertSaved(note, expected, 'manual Save while autosave off');
			await frame.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
			await frame.getByRole('textbox', { name: 'Edit priority', exact: true }).fill('8');
			await frame.page().keyboard.press(`${mod}+s`);
			expected = expected.replace('priority: 2', 'priority: 8');
			await assertSaved(note, expected, 'manual Save active property while autosave off');
			await frame.locator('.mlp-table td').first().focus();
			await frame.page().keyboard.press('F2');
			await frame.page().keyboard.type('Beta draft', { delay: 2 });
			await frame.page().keyboard.press(`${mod}+s`);
			expected = expected.replace('Alpha', 'Beta draft');
			await assertSaved(note, expected, 'manual Save active table while autosave off');
		} finally { await config.update('autoSave', true, vscode.ConfigurationTarget.Global); }
	});

	test('invalid property text remains recoverable without corrupting YAML or overwriting the original note', async () => {
		const original = '---\npriority: 2\n---\n\n# Invalid property recovery\n\nKeep the source intact.\n';
		const note = await fixture('invalid-property-recovery', original);
		const frame = await openLive(note, 'Invalid property recovery');
		await frame.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
		await frame.getByRole('textbox', { name: 'Edit priority', exact: true }).fill('two-not-a-number');
		await frame.page().keyboard.press(`${mod}+s`);
		await waitFor(async () => /preserved|saved/i.test(await frame.locator('#mlp-recovery-notice').innerText()), 'invalid property draft was not preserved', 10_000);
		assert.strictEqual(await disk(note), original, 'an invalid numeric property must not replace typed YAML');
		await vscode.commands.executeCommand('mdLivePreview.openRecoveredDrafts');
		const page = await workbench();
		const picker = page.locator('.quick-input-widget');
		await picker.waitFor({ state: 'visible' });
		const filename = note.path.slice(note.path.lastIndexOf('/') + 1);
		const query = picker.locator('.quick-input-box input');
		await query.fill(filename);
		await picker.locator('.quick-input-list .monaco-list-row.focused').filter({ hasText: filename }).first().waitFor({ state: 'visible' });
		await query.press('Enter');
		await waitFor(() => vscode.window.activeTextEditor?.document.isUntitled === true, 'recovery command did not open a separate unsaved copy');
		const recovered = vscode.window.activeTextEditor!.document;
		ownedDocuments.add(recovered.uri.toString());
		assert.ok(recovered.getText().startsWith(original), 'recovered copy lost the surrounding note');
		assert.ok(recovered.getText().includes('Uncommitted property priority:\ntwo-not-a-number'), 'invalid typed value was omitted from recovery');
		assert.strictEqual(await disk(note), original, 'opening recovery overwrote the original source');
		// Opening a copy must not consume/delete the retained local snapshot.
		await vscode.commands.executeCommand('mdLivePreview.openRecoveredDrafts');
		await picker.waitFor({ state: 'visible' });
		assert.ok(await picker.locator('.quick-input-list .monaco-list-row').filter({ hasText: filename }).count());
		await page.keyboard.press('Escape');
	});

	test('untitled Markdown remains dirty and intact without inventing an automatic save path', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Unsaved draft\n' });
		ownedDocuments.add(document.uri.toString());
		await vscode.window.showTextDocument(document, { preview: false });
		const page = await focusNativeEnd(document);
		await page.keyboard.type('Retain the untitled draft.', { delay: 5 });
		await waitFor(() => document.getText() === '# Unsaved draft\nRetain the untitled draft.', 'untitled typing failed');
		await delay(300);
		assert.strictEqual(document.isUntitled, true);
		assert.strictEqual(document.isDirty, true, 'unsupported auto-save must never clear the dirty buffer');
		assert.strictEqual(document.getText(), '# Unsaved draft\nRetain the untitled draft.');
	});

	test('outside-vault Markdown is not silently written and manual Save retains every character', async () => {
		const original = 'Outside-vault source: ';
		const note = vscode.Uri.file(join(process.env.MDLP_SAVE_TEST_TEMPORARY!, 'outside-vault.md'));
		await writeFile(note.fsPath, original, 'utf8');
		ownedDocuments.add(note.toString());
		const document = await vscode.workspace.openTextDocument(note);
		await vscode.window.showTextDocument(document, { preview: false });
		const page = await focusNativeEnd(document);
		await page.keyboard.type('Explicit user save only.', { delay: 4 });
		await waitFor(() => document.getText() === original + 'Explicit user save only.', 'outside-vault typing failed');
		await delay(300);
		assert.strictEqual(await disk(note), original, 'outside-vault edits must not be silently written');
		assert.strictEqual(document.isDirty, true);
		await page.keyboard.press(`${mod}+s`);
		await assertSaved(note, original + 'Explicit user save only.', 'outside-vault manual Save');
	});

	test('a denied filesystem write retains dirty text and a later explicit Save recovers it', async function () {
		// Windows ACLs need a separate implementation; chmod does not establish a
		// real permission failure there. This is an actual POSIX filesystem test.
		if (process.platform === 'win32' || process.getuid?.() === 0) this.skip();
		const folder = vscode.Uri.joinPath(vault, `permissions-${++sequence}`);
		await vscode.workspace.fs.createDirectory(folder);
		const note = vscode.Uri.joinPath(folder, 'denied.md');
		const original = 'Permission failure: ';
		await writeFile(note.fsPath, original, 'utf8');
		ownedDocuments.add(note.toString());
		const document = await vscode.workspace.openTextDocument(note);
		const frame = await openLive(note, 'Permission failure:');
		const folderMode = (await stat(folder.fsPath)).mode & 0o777;
		const fileMode = (await stat(note.fsPath)).mode & 0o777;
		try {
			await chmod(note.fsPath, 0o444);
			await chmod(folder.fsPath, 0o555);
			await focusEnd(frame);
			await frame.page().keyboard.type('Never discard this edit.', { delay: 5 });
			await waitFor(() => document.getText() === original + 'Never discard this edit.', 'denied-write edit did not reach host');
			await delay(500);
			assert.strictEqual(await disk(note), original, 'the permissions test did not prevent a real write');
			assert.strictEqual(document.isDirty, true, 'a failed write must leave the full buffer dirty');
			assert.strictEqual(document.getText(), original + 'Never discard this edit.');
		} finally {
			await chmod(folder.fsPath, folderMode);
			await chmod(note.fsPath, fileMode);
		}
		await frame.page().keyboard.press(`${mod}+s`);
		await assertSaved(note, original + 'Never discard this edit.', 'manual recovery after denied write');
	});

	test('full recovery storage opens an exact unsaved fallback when an additional invalid draft is closed', async function () {
		this.timeout(120_000);
		const source = '---\npriority: 2\n---\n\n# Recovery capacity\n\nNever overwrite this source.\n';
		const note = await fixture('recovery-capacity', source);
		const page = await workbench();
		const countRecoveryCopies = async (expectNonempty = false): Promise<number> => {
			await vscode.commands.executeCommand('mdLivePreview.openRecoveredDrafts');
			const picker = page.locator('.quick-input-widget');
			const empty = page.getByText('There are no recovered Markdown drafts in this workspace.', { exact: true });
			await waitFor(async () => await picker.isVisible() || !expectNonempty && await empty.count() > 0, 'recovery picker did not report its contents');
			if (!await picker.isVisible()) return 0;
			const first = picker.locator('.quick-input-list .monaco-list-row:visible').first();
			await first.waitFor({ state: 'visible' });
			// The list is virtualized. Its native accessibility set size reports
			// all recovery entries, not merely the rows currently on screen.
			const count = Number(await first.getAttribute('aria-setsize'));
			assert.ok(Number.isInteger(count) && count > 0 && count <= 20, `unexpected public recovery count: ${count}`);
			await picker.locator('.quick-input-box input').press('Escape');
			await picker.waitFor({ state: 'hidden' });
			return count;
		};
		const existing = await countRecoveryCopies();
		const frame = await openLive(note, 'Recovery capacity');
		await frame.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
		const input = frame.getByRole('textbox', { name: 'Edit priority', exact: true });
		// Earlier cases may already have preserved a public recovery fixture.
		// Fill the remaining slots through actual property input and Save; never
		// write private extension state or evict an existing recovery entry.
		for (let index = existing; index < 20; index++) {
			await input.fill(`quota-entry-${index}`);
			await page.keyboard.press(`${mod}+s`);
			await waitFor(async () => /preserved|saved/i.test(await frame.locator('#mlp-recovery-notice').innerText()), `recovery entry ${index} was not preserved`, 10_000);
			assert.strictEqual(await countRecoveryCopies(true), index + 1, 'distinct invalid drafts did not occupy distinct recovery entries');
		}
		assert.strictEqual(await disk(note), source);
		const residual = 'KEEP-THIS-FINAL-DRAFT-AT-CAPACITY';
		await input.fill(residual);
		// No Enter, manual Save, idle pause, or extra blur before closing.
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		const expected = source + '\n\nUncommitted property priority:\n' + residual;
		await waitFor(() => vscode.window.activeTextEditor?.document.isUntitled === true &&
			vscode.window.activeTextEditor.document.getText() === expected,
		'quota fallback did not open the exact final draft as an unsaved document', 10_000);
		const fallback = vscode.window.activeTextEditor!.document;
		ownedDocuments.add(fallback.uri.toString());
		assert.strictEqual(fallback.languageId, 'markdown');
		assert.strictEqual(fallback.isDirty, true);
		assert.strictEqual(vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview, false, 'fallback must be pinned, not replaceable preview content');
		assert.strictEqual(await disk(note), source, 'quota fallback overwrote the original Markdown file');
		assert.strictEqual(await countRecoveryCopies(true), 20, 'quota handling must retain all earlier recovery copies');
	});

	async function fixture(name: string, text: string): Promise<vscode.Uri> {
		const uri = vscode.Uri.joinPath(vault, `${++sequence}-${name}.md`);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
		ownedDocuments.add(uri.toString());
		return uri;
	}

	async function assertSaved(uri: vscode.Uri, expected: string, label: string): Promise<void> {
		const start = Date.now();
		await waitFor(async () => await disk(uri) === expected, `${label}: disk did not match the complete expected bytes`, 10_000)
			.catch(async error => {
				const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString());
				throw new Error(`${String(error)}; expected=${JSON.stringify(expected)}; actual=${JSON.stringify(await disk(uri))}; host=${JSON.stringify(document?.getText())}; dirty=${document?.isDirty}`);
			});
		measurements.push({ label, milliseconds: Date.now() - start });
		assert.deepStrictEqual(await readFile(uri.fsPath), Buffer.from(expected, 'utf8'), `${label}: byte comparison failed`);
		const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString());
		if (document) await waitFor(() => !document.isDirty, `${label}: successful native save left the buffer dirty`);
	}
});

async function disk(uri: vscode.Uri): Promise<string> {
	return (await readFile(uri.fsPath)).toString('utf8');
}

async function openLive(uri: vscode.Uri, marker: string): Promise<Frame> {
	await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor', { preview: false });
	await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
	return findLiveFrame(marker);
}

async function findLiveFrame(marker: string): Promise<Frame> {
	let selected: Frame | undefined;
	await waitFor(async () => {
		for (const page of (await debugBrowser()).contexts().flatMap(context => context.pages())) {
			for (const frame of page.frames()) {
				if (frame.isDetached()) continue;
				try {
					const content = frame.locator('.cm-content');
					if (await content.count() && await content.isVisible() && (await content.textContent())?.includes(marker)) {
						selected = frame; return true;
					}
				} catch (error) {
					// VS Code destroys hidden iframes asynchronously. A candidate may
					// detach after the synchronous check but before the DOM query;
					// retry discovery, never a save assertion or a typing operation.
					if (!frame.isDetached() && !/Frame was detached|Execution context was destroyed/.test(String(error))) throw error;
				}
			}
		}
		return false;
	}, `Live Preview did not display ${marker}`, 15_000);
	return selected!;
}

async function focusEnd(frame: Frame): Promise<void> {
	await frame.locator('.cm-content').click();
	await frame.page().keyboard.press(`${mod}+End`);
}

async function focusNativeEnd(document: vscode.TextDocument): Promise<Page> {
	await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
	const page = await workbench();
	// Native Monaco uses Cmd+Down on macOS; Cmd+End is a CodeMirror binding,
	// not a portable native-editor navigation shortcut. Verify the selection
	// before typing so a navigation failure cannot masquerade as lost data.
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
	await waitFor(() => {
		const editor = vscode.window.activeTextEditor;
		return editor?.document === document && editor.selection.isEmpty &&
			document.offsetAt(editor.selection.active) === document.getText().length;
	}, 'native document-end shortcut did not place the caret at the exact end');
	return page;
}

async function workbench(): Promise<Page> {
	const pages = (await debugBrowser()).contexts().flatMap(context => context.pages());
	assert.ok(pages.length, 'the isolated workbench has no page');
	return pages[0];
}

async function debugBrowser(): Promise<Browser> {
	if (browser) return browser;
	const port = Number(process.env.MDLP_VSCODE_DEBUG_PORT);
	assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535);
	await waitFor(async () => {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return true; } catch { return false; }
	}, 'unable to connect to the isolated native workbench', 15_000);
	return browser!;
}

async function waitFor(check: () => boolean | Promise<boolean>, message: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await delay(25);
	}
	assert.fail(message);
}
