import * as assert from 'assert';
import * as vscode from 'vscode';
import { isAbsolute, relative } from 'node:path';
import { chromium, type Browser, type Frame, type Page } from 'playwright';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
const mode = process.env.MDLP_VSIX_SMOKE_MODE;
const vsixOnly = mode === 'trusted' || mode === 'restricted' ? test : test.skip;
const disabledOnly = mode === 'disabled' ? test : test.skip;
const NOTE_SOURCE = [
	'# Packaged smoke',
	'',
	'[[Packaged Target]]',
	'',
	'> [!NOTE]- Packaged details',
	'> Keyboard-reachable callout.',
	'',
	'- [ ] Packaged task',
	'',
	'| name | value |',
	'| --- | ---: |',
	'| alpha | 1 |',
	'',
	'![Packaged local image](pixel.png)',
	'',
	'![Blocked remote image](https://mdlp-vsix.invalid/tracker.png)',
	'',
	'```mermaid',
	'graph TD',
	'  A --> B',
	'```',
	'',
].join('\n');
const OBSIDIAN_SOURCE = '{"livePreview":true,"legacyEditor":false,"theme":"moonstone"}\n';
const ACCESSIBILITY_SOURCE = [
	'---',
	'priority: 3',
	'related: "[[Packaged Target]]"',
	'---',
	'# Packaged accessibility',
	'',
	'> [!NOTE]- Keyboard details',
	'> Keyboard-reachable callout.',
	'',
	'- [ ] Keyboard task',
	'',
	'| name | value |',
	'| --- | ---: |',
	'| alpha | 1 |',
	'',
	'A keyboard claim[^1].',
	'',
	'[^1]: Local keyboard evidence.',
	'',
	'```mermaid',
	'graph TD',
	'  A --> B',
	'```',
	'',
].join('\n');
let debugBrowser: Browser | undefined;

suite('Installed VSIX clean-profile smoke', () => {
	suiteTeardown(async () => {
		await debugBrowser?.close();
		debugBrowser = undefined;
	});

	vsixOnly('loads the packaged extension rather than the development checkout', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		const installedRoot = process.env.MDLP_VSIX_EXTENSIONS_DIR;
		assert.ok(installedRoot, 'the VSIX smoke runner did not identify its isolated extension directory');
		const installedRelative = relative(installedRoot, extension.extensionPath);
		assert.ok(
			installedRelative && !isAbsolute(installedRelative) && installedRelative !== '..' &&
				!installedRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
			`the target extension was not loaded from the isolated VSIX directory: ${extension.extensionPath}`,
		);
		assert.strictEqual(extension.packageJSON.version, process.env.MDLP_VSIX_VERSION);
		const productionApi = await extension.activate();
		assert.strictEqual(extension.isActive, true);
		assert.strictEqual(productionApi, undefined, 'the packaged extension exposed its development-only test API');
	});

	vsixOnly('opens packaged Live Preview from a clean profile', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'README.md');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom, 'the packaged Live Preview custom editor did not open');
		assert.strictEqual(input.viewType, 'mdLivePreview.editor');
	});

	vsixOnly('matches the requested clean-profile trust state', async () => {
		assert.strictEqual(vscode.workspace.isTrusted, mode === 'trusted');
	});

	(mode === 'trusted' ? test : test.skip)('registers packaged vault and knowledge commands in trusted mode', async () => {
		const commands = new Set(await vscode.commands.getCommands(true));
		for (const command of [
			'mdLivePreview.vault.refresh',
			'mdLivePreview.quickSwitcher',
			'mdLivePreview.vaultSearch',
			'mdLivePreview.vault.rebuildIndex',
		]) {
			assert.ok(commands.has(command), `missing packaged command ${command}`);
		}
		await vscode.commands.executeCommand('mdLivePreview.vault.refresh');
		await vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
	});

	(mode === 'trusted' ? test : test.skip)('creates notes and folders in the packaged Document Vault', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const page = await getWorkbenchPage();
		await page.bringToFront();
		const noteName = 'Packaged Created Note';
		const note = vscode.Uri.joinPath(root, `${noteName}.md`);
		const folderName = 'Packaged Created Folder';
		const folder = vscode.Uri.joinPath(root, folderName);

		const createNote = vscode.commands.executeCommand('mdLivePreview.vault.newNote');
		await acceptNativeInputBox(page, noteName);
		await createNote;
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(note)), '',
			'the packaged Document Vault did not create an empty Markdown note');
		await waitFor(() => activeTabUri()?.toString() === note.toString(),
			'the packaged Document Vault did not open its created note');

		const createFolder = vscode.commands.executeCommand('mdLivePreview.vault.newFolder');
		await acceptNativeInputBox(page, folderName);
		await createFolder;
		assert.ok((await vscode.workspace.fs.stat(folder)).type & vscode.FileType.Directory,
			'the packaged Document Vault did not create a folder');

		await selectWorkbenchTreeItemWithKeyboard(page, `File: ${noteName}.md`);
		await page.keyboard.press('Enter');
		await waitFor(() => activeTabUri()?.toString() === note.toString(),
			'the packaged Document Vault did not open its created note with Enter');
		await selectWorkbenchTreeItemWithKeyboard(page, `Folder: ${folderName}`);
		await page.keyboard.press('ArrowRight');
		assert.strictEqual(
			await page.getByRole('treeitem', { name: `Folder: ${folderName}`, exact: true }).getAttribute('aria-expanded'),
			'true',
			'the packaged Document Vault did not expand its created folder with ArrowRight',
		);
		await vscode.workspace.fs.stat(folder);
	});

	(mode === 'trusted' ? test : test.skip)('operates packaged CSS Themes through keyboard input', async () => {
		const page = await getWorkbenchPage();
		await page.bringToFront();
		await vscode.commands.executeCommand('workbench.view.extension.mdLivePreview');
		await vscode.commands.executeCommand('mdLivePreview.styleManager.focus');
		await expandWorkbenchPaneWithKeyboard(page, 'CSS Themes');
		const frame = await connectToCssThemesFrame();
		const radios = frame.getByRole('radio');
		await waitFor(async () => await radios.count() >= 2,
			'the packaged CSS Themes sidebar did not expose its bundled radio controls');
		const originalIndex = await firstCheckedRadioIndex(radios);
		assert.ok(originalIndex >= 0, 'the packaged CSS Themes sidebar had no selected theme');
		const targetIndex = originalIndex === 0 ? 1 : 0;
		const original = radios.nth(originalIndex);
		const target = radios.nth(targetIndex);
		const targetName = await target.getAttribute('aria-label');
		assert.ok(targetName, 'the packaged CSS theme radio had no accessible name');

		await focusFrameControlWithKeyboard(page, frame, original);
		await page.keyboard.press(targetIndex > originalIndex ? 'ArrowRight' : 'ArrowLeft');
		await waitFor(async () => await target.isChecked(),
			'Arrow-key navigation did not select the packaged CSS theme');
		assert.strictEqual(await target.evaluate((element) => document.activeElement === element), true,
			'Arrow-key navigation did not retain focus on the selected packaged CSS theme');
		assert.strictEqual(await original.isChecked(), false,
			'the packaged CSS theme radio group did not remain exclusive');

		const editButton = frame.getByRole('button', { name: 'Edit CSS' }).first();
		const duplicateButton = frame.getByRole('button', { name: 'Duplicate' }).first();
		const renameButton = frame.getByRole('button', { name: 'Rename' }).first();
		const deleteButton = frame.getByRole('button', { name: 'Delete' }).first();
		for (const control of [editButton, duplicateButton, renameButton, deleteButton]) {
			await focusFrameControlWithKeyboard(page, frame, control);
		}

		await focusFrameControlWithKeyboard(page, frame, target);
		await page.keyboard.press(targetIndex > originalIndex ? 'ArrowLeft' : 'ArrowRight');
		await waitFor(async () => await original.isChecked(),
			'Arrow-key navigation did not restore the original packaged CSS theme');
	});

	(mode === 'trusted' ? test : test.skip)('walks the packaged trusted vault, editor, media, diagrams, index, and knowledge views', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'README.md');
		const target = vscode.Uri.joinPath(root, 'Packaged Target.md');
		const page = await getWorkbenchPage();
		await page.bringToFront();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await waitFor(() => activeTabUri()?.toString() === note.toString(),
			'the installed trusted Live Preview did not become active');

		const frame = await connectToLivePreviewFrame('Packaged smoke');
		await frame.locator('.cm-content').waitFor({ state: 'visible', timeout: 10_000 });
		const localImage = frame.locator('.mlp-image[alt="Packaged local image"]');
		await waitFor(async () => (await localImage.getAttribute('src'))?.startsWith('blob:') === true,
			'the installed VSIX did not render validated local image bytes');
		await frame.locator('.mlp-mermaid-wrap svg').waitFor({ state: 'visible', timeout: 20_000 });

		const link = frame.locator('.mlp-wikilink[data-href="wikilink:Packaged%20Target"]');
		await link.waitFor({ state: 'visible', timeout: 5_000 });
		await focusControlWithKeyboard(frame, '.mlp-wikilink[data-href="wikilink:Packaged%20Target"]');
		const preview = frame.locator('.mlp-wikilink-hover[role="tooltip"]');
		await preview.waitFor({ state: 'visible', timeout: 5_000 });
		const previewId = await preview.getAttribute('id');
		assert.ok(previewId?.startsWith('mlp-wikilink-preview-'),
			'the installed VSIX did not give its keyboard wikilink preview a stable accessible identity');
		assert.strictEqual(await link.getAttribute('aria-describedby'), previewId,
			'the installed VSIX did not associate its local wikilink preview with keyboard focus');
		assert.match(await preview.textContent() ?? '', /Packaged Target/,
			'the installed VSIX did not expose its local wikilink preview through keyboard focus');
		await link.click();
		await waitFor(() => activeTabUri()?.toString() === target.toString(),
			'the installed VSIX did not navigate its rendered wikilink');

		await vscode.commands.executeCommand('mdLivePreview.vault.focus');
		await visibleWorkbenchRow(page, 'Packaged Target.md').waitFor({ state: 'visible', timeout: 5_000 });

		await vscode.commands.executeCommand('mdLivePreview.quickSwitcher');
		const quickPick = page.locator('.quick-input-widget:visible');
		await quickPick.waitFor({ state: 'visible', timeout: 5_000 });
		const quickInput = quickPick.locator('.quick-input-box input');
		await quickInput.fill('Packaged Target');
		await quickPick.locator('.monaco-list-row').filter({ hasText: 'Packaged Target' })
			.waitFor({ state: 'visible', timeout: 5_000 });
		await quickInput.press('Escape');

		await vscode.commands.executeCommand('mdLivePreview.backlinks.focus');
		await page.getByRole('treeitem', { name: /^Linked mention in README\.md, line 3$/ })
			.waitFor({ state: 'visible', timeout: 5_000 });
		await vscode.commands.executeCommand('mdLivePreview.tags.focus');
		await page.getByRole('treeitem', { name: /^Tag packaged, 1 note\(s\)$/ })
			.waitFor({ state: 'visible', timeout: 5_000 });
	});

	(mode === 'trusted' ? test : test.skip)('keeps packaged controls reachable in high contrast at 200 percent zoom', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const page = await getWorkbenchPage();
		await page.bringToFront();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(root, 'README.md'), 'mdLivePreview.editor');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		const frame = await connectToLivePreviewFrame('Packaged smoke');
		await frame.locator('.cm-content').waitFor({ state: 'visible', timeout: 10_000 });

		const workbench = vscode.workspace.getConfiguration('workbench');
		const previousTheme = workbench.inspect<string>('colorTheme')?.globalValue;
		const highContrastTheme = findHighContrastTheme();
		await vscode.commands.executeCommand('workbench.action.zoomReset');
		const baselineWidth = await page.evaluate(() => window.innerWidth);
		try {
			await workbench.update('colorTheme', highContrastTheme, vscode.ConfigurationTarget.Global);
			await waitFor(() => frame.evaluate(() => document.body.classList.contains('vscode-high-contrast')),
				'the packaged webview did not receive the real VS Code high-contrast theme', 15_000);
			for (let index = 0; index < 4; index++) {
				await vscode.commands.executeCommand('workbench.action.zoomIn');
				await delay(100);
			}
			await waitFor(async () => baselineWidth / await page.evaluate(() => window.innerWidth) >= 1.9,
				'the packaged workbench did not reach at least 200 percent effective zoom', 10_000);

			for (const selector of ['.mlp-checkbox', '.mlp-callout-header', '.mlp-table-cell', '.mlp-code-mode-btn']) {
				const control = frame.locator(selector).first();
				await control.waitFor({ state: 'visible', timeout: 5_000 });
				await control.scrollIntoViewIfNeeded();
				await focusControlWithKeyboard(frame, selector);
				assert.strictEqual(await control.evaluate((element) => document.activeElement === element), true,
					`${selector} could not receive keyboard focus at 200 percent zoom`);
				const focusAndBounds = await control.evaluate((element) => {
					const style = getComputedStyle(element);
					const bounds = element.getBoundingClientRect();
					return {
						outlineStyle: style.outlineStyle,
						outlineWidth: Number.parseFloat(style.outlineWidth),
						focusVisible: element.matches(':focus-visible'),
						outlineColor: style.outlineColor,
						visible: bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 &&
							bounds.left < window.innerWidth && bounds.top < window.innerHeight,
					};
				});
				assert.ok(focusAndBounds.visible, `${selector} was clipped out of the zoomed viewport`);
				assert.notStrictEqual(focusAndBounds.outlineStyle, 'none',
					`${selector} had no visible focus style: ${JSON.stringify(focusAndBounds)}`);
				// Chromium reports CSS-pixel widths after applying the workbench zoom;
				// a declared 1px outline is just under 1 CSS px at this scale.
				assert.ok(focusAndBounds.outlineWidth > 0.5,
					`${selector} had no visible focus width: ${JSON.stringify(focusAndBounds)}`);
			}
			const sourceButtons = frame.locator('.mlp-code-mode-btn');
			assert.ok(await sourceButtons.count() >= 2, 'rendered blocks did not retain source-mode escape controls');
			for (let index = 0; index < await sourceButtons.count(); index++) {
				assert.ok(await sourceButtons.nth(index).getAttribute('aria-label'),
					'a source-mode escape control had no accessible name');
			}
		} finally {
			await vscode.commands.executeCommand('workbench.action.zoomReset');
			await workbench.update('colorTheme', previousTheme, vscode.ConfigurationTarget.Global);
		}
	});

	(mode === 'trusted' ? test : test.skip)('operates packaged Live Preview controls through keyboard input', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'Accessibility.md');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		const frame = await connectToLivePreviewFrame('Packaged accessibility');
		await frame.locator('.cm-content').waitFor({ state: 'visible', timeout: 10_000 });
		await frame.locator('.mlp-mermaid-wrap svg').waitFor({ state: 'visible', timeout: 20_000 });

		const property = frame.locator('.mlp-property-number');
		await focusControlWithKeyboard(frame, '.mlp-property-number');
		await property.press('Enter');
		const propertyInput = property.locator('input');
		await propertyInput.fill('not a number');
		await propertyInput.press('Enter');
		assert.strictEqual(await propertyInput.getAttribute('aria-invalid'), 'true',
			'the packaged typed property did not expose keyboard validation state');
		const describedBy = await propertyInput.getAttribute('aria-describedby');
		assert.match(describedBy ?? '', /^mlp-property-error-/,
			'the packaged typed-property error was not associated with its input');
		assert.strictEqual(await property.locator(`#${describedBy}`).getAttribute('role'), 'alert');
		await propertyInput.press('Escape');
		assert.strictEqual((await property.textContent())?.trim(), '3',
			'Escape did not cancel the packaged property edit');
		assert.strictEqual(await property.evaluate((element) => document.activeElement === element), true,
			'Escape did not return focus to the packaged property control');

		const callout = frame.locator('.mlp-callout-header');
		await focusControlWithKeyboard(frame, '.mlp-callout-header');
		assert.strictEqual(await callout.getAttribute('aria-expanded'), 'false');
		await callout.press('Enter');
		assert.strictEqual(await callout.getAttribute('aria-expanded'), 'true',
			'Enter did not expand the packaged callout');
		await callout.press('Space');
		assert.strictEqual(await callout.getAttribute('aria-expanded'), 'false',
			'Space did not collapse the packaged callout');

		const task = frame.locator('.mlp-checkbox');
		await focusControlWithKeyboard(frame, '.mlp-checkbox');
		assert.strictEqual(await task.getAttribute('aria-checked'), 'false');
		await task.press('Space');
		await waitFor(async () => await task.getAttribute('aria-checked') === 'true',
			'Space did not check the packaged task');
		await task.press('Space');
		await waitFor(async () => await task.getAttribute('aria-checked') === 'false',
			'Space did not restore the packaged task');

		const firstCell = frame.locator('.mlp-table-cell').first();
		await focusControlWithKeyboard(frame, '.mlp-table-cell');
		await firstCell.press('ArrowRight');
		const secondHeader = frame.locator('.mlp-table th').nth(1);
		assert.strictEqual(await secondHeader.evaluate((element) => document.activeElement === element), true,
			'ArrowRight did not move through the packaged table grid');
		await secondHeader.press('ArrowDown');
		const secondValue = frame.locator('.mlp-table td').nth(1);
		assert.strictEqual(await secondValue.evaluate((element) => document.activeElement === element), true,
			'ArrowDown did not move through the packaged table grid');
		await secondValue.press('F2');
		assert.strictEqual(await secondValue.getAttribute('contenteditable'), 'true',
			'F2 did not begin packaged table-cell editing');
		await secondValue.press('Escape');
		assert.strictEqual((await secondValue.textContent())?.trim(), '1',
			'Escape did not cancel the packaged table-cell edit');

		const reference = frame.locator('.mlp-footnote-reference');
		await focusControlWithKeyboard(frame, '.mlp-footnote-reference');
		await reference.press('Enter');
		assert.strictEqual(await frame.locator('.cm-content').evaluate((element) => document.activeElement === element), true,
			'Enter on the packaged footnote reference did not return focus to its editor target');
		await focusControlWithKeyboard(frame, '.mlp-footnote-definition-label');
		await frame.locator('.mlp-footnote-definition-label').press('Enter');
		assert.strictEqual(await frame.locator('.cm-content').evaluate((element) => document.activeElement === element), true,
			'Enter on the packaged footnote return did not restore editor focus');

		const diagramSource = frame.locator('.mlp-mermaid-wrap .mlp-code-mode-btn');
		await focusControlWithKeyboard(frame, '.mlp-mermaid-wrap .mlp-code-mode-btn');
		assert.ok(await diagramSource.getAttribute('aria-label'),
			'the packaged diagram source escape had no accessible name');
		await diagramSource.press('Enter');
		await waitFor(async () => await frame.locator('.mlp-mermaid-wrap').count() === 0,
			'Enter did not reveal the packaged diagram source');
		assert.ok((await frame.locator('.cm-content').textContent())?.includes('graph TD'),
			'the packaged diagram source was not available after its keyboard escape');

		const openedDocument = vscode.workspace.textDocuments
			.find((candidate) => candidate.uri.toString() === note.toString());
		assert.ok(openedDocument, 'the packaged accessibility note was not open');
		assert.strictEqual(openedDocument.getText(), ACCESSIBILITY_SOURCE,
			'the packaged keyboard journey did not restore the accessibility fixture in memory');
		// Checking and then unchecking a task is two legitimate text edits. VS Code
		// therefore keeps the document dirty even though its content is byte-for-byte
		// back at the saved value; persist that identical value before the disk check.
		await openedDocument.save();
		assert.strictEqual(openedDocument.isDirty, false,
			'the restored packaged accessibility note did not save cleanly');
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(note)), ACCESSIBILITY_SOURCE,
			'the packaged keyboard journey changed the accessibility fixture');
	});

	(mode === 'restricted' ? test : test.skip)('blocks packaged vault mutations in Restricted Mode', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const before = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).sort();
		await vscode.commands.executeCommand('mdLivePreview.vault.newFolder');
		const after = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).sort();
		assert.deepStrictEqual(after, before, 'the packaged extension mutated an untrusted workspace');
	});

	(mode === 'restricted' ? test : test.skip)('keeps packaged editing local and disables restricted renderers', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const page = await getWorkbenchPage();
		await page.bringToFront();
		const remoteRequests: string[] = [];
		await page.route('https://mdlp-vsix.invalid/**', async (route) => {
			remoteRequests.push(route.request().url());
			await route.abort();
		});
		try {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(root, 'README.md'), 'mdLivePreview.editor');
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			await waitFor(() => activeTabUri()?.toString() === vscode.Uri.joinPath(root, 'README.md').toString(),
				'the installed Restricted Mode Live Preview did not become active');
			const frame = await connectToLivePreviewFrame('Packaged smoke');
			await frame.locator('.cm-content').waitFor({ state: 'visible', timeout: 10_000 });
			await waitFor(async () => (await frame.locator('.mlp-image[alt="Packaged local image"]').getAttribute('src'))?.startsWith('blob:') === true,
				'Restricted Mode did not retain secure local-image rendering');
			await frame.locator('.mlp-image-blocked').waitFor({ state: 'visible', timeout: 5_000 });
			await delay(750);
			assert.strictEqual(await frame.locator('img[src^="https://mdlp-vsix.invalid/"]').count(), 0,
				'Restricted Mode inserted a remote image URL');
			assert.deepStrictEqual(remoteRequests, [], 'Restricted Mode emitted a remote image request');
			assert.strictEqual(await frame.locator('.mlp-mermaid-wrap, .mlp-drawio-wrap').count(), 0,
				'Restricted Mode executed a diagram renderer');
			assert.ok((await frame.locator('.cm-content').textContent())?.includes('graph TD'),
				'Restricted Mode did not preserve editable diagram source');
		} finally {
			await page.unroute('https://mdlp-vsix.invalid/**');
		}
	});

	disabledOnly('leaves an Obsidian vault usable as ordinary files when disabled', async () => {
		assert.strictEqual(vscode.extensions.getExtension(EXTENSION_ID), undefined,
			'the target extension remained enabled in the disabled-profile smoke test');
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the disabled VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'README.md');
		const document = await vscode.workspace.openTextDocument(note);
		assert.strictEqual(document.getText(), NOTE_SOURCE, 'the disabled extension left unreadable or changed Markdown');
		await vscode.window.showTextDocument(document);
		assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText,
			'the disabled extension prevented the note from opening in VS Code\'s text editor');
		assert.strictEqual(
			new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.obsidian', 'app.json'))),
			OBSIDIAN_SOURCE,
			'the disabled extension changed Obsidian settings',
		);
	});
});

async function connectToLivePreviewFrame(expectedText: string): Promise<Frame> {
	const browser = await connectToDebugBrowser();
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue;
					const editor = frame.locator('.cm-content');
					if (await editor.count() > 0 && (await editor.textContent())?.includes(expectedText)) return frame;
				}
			}
		}
		await delay(100);
	}
	assert.fail('could not find the installed Live Preview CodeMirror frame');
}

async function connectToCssThemesFrame(): Promise<Frame> {
	const browser = await connectToDebugBrowser();
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue;
					if (await frame.locator('#mlp-sidebar-root').count() > 0) return frame;
				}
			}
		}
		await delay(100);
	}
	assert.fail('could not find the installed CSS Themes sidebar frame');
}

async function getWorkbenchPage(): Promise<Page> {
	const browser = await connectToDebugBrowser();
	const pages = browser.contexts().flatMap((context) => context.pages());
	assert.ok(pages.length > 0, 'the installed VSIX workbench page is unavailable');
	return pages[0];
}

async function connectToDebugBrowser(): Promise<Browser> {
	if (debugBrowser) return debugBrowser;
	const port = Number(process.env.MDLP_VSCODE_DEBUG_PORT);
	assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535,
		'the installed VSIX runner did not provide a debugging port');
	const deadline = Date.now() + 10_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			debugBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
			return debugBrowser;
		} catch (error) {
			lastError = error;
		}
		await delay(100);
	}
	assert.fail(`could not connect to the installed VSIX workbench: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function activeTabUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

function visibleWorkbenchRow(page: Page, text: string) {
	return page.locator('.monaco-list-row:visible').filter({ hasText: text });
}

async function selectWorkbenchTreeItemWithKeyboard(page: Page, accessibleLabel: string): Promise<void> {
	await vscode.commands.executeCommand('mdLivePreview.vault.focus');
	const target = page.getByRole('treeitem', { name: accessibleLabel, exact: true });
	await target.waitFor({ state: 'visible', timeout: 5_000 });
	const tree = target.locator('xpath=ancestor::*[@role="tree"][1]');
	const targetId = await target.getAttribute('id');
	assert.ok(targetId, `the packaged Document Vault row had no active-descendant identity: ${accessibleLabel}`);
	await tree.press('Home');
	for (let index = 0; index < 500; index++) {
		if (await tree.getAttribute('aria-activedescendant') === targetId) return;
		await tree.press('ArrowDown');
	}
	assert.fail(`the packaged Document Vault could not reach ${accessibleLabel} with arrow-key navigation`);
}

async function expandWorkbenchPaneWithKeyboard(page: Page, title: string): Promise<void> {
	const header = page.locator('.pane-header:visible').filter({ hasText: title }).first();
	await header.waitFor({ state: 'visible', timeout: 5_000 });
	if (await header.getAttribute('aria-expanded') === 'true') return;
	await header.focus();
	await page.keyboard.press('Enter');
	await waitFor(
		async () => await header.getAttribute('aria-expanded') === 'true',
		`the packaged ${title} pane did not expand with Enter`,
	);
}

async function firstCheckedRadioIndex(radios: ReturnType<Frame['getByRole']>): Promise<number> {
	for (let index = 0; index < await radios.count(); index++) {
		if (await radios.nth(index).isChecked()) return index;
	}
	return -1;
}

async function focusFrameControlWithKeyboard(
	page: Page,
	frame: Frame,
	control: ReturnType<Frame['getByRole']>,
): Promise<void> {
	await control.waitFor({ state: 'visible', timeout: 5_000 });
	const body = frame.locator('body');
	for (let index = 0; index < 100; index++) {
		if (await control.evaluate((element) => document.activeElement === element)) return;
		if (index === 0 && await frame.evaluate(() => document.activeElement === document.body)) await body.press('Tab');
		else await page.keyboard.press('Tab');
	}
	assert.fail(`the packaged sidebar control could not be reached through keyboard Tab navigation: ${await control.getAttribute('aria-label')}`);
}

function findHighContrastTheme(): string {
	for (const extension of vscode.extensions.all) {
		const themes = extension.packageJSON?.contributes?.themes;
		if (!Array.isArray(themes)) continue;
		for (const theme of themes) {
			if (theme?.uiTheme !== 'hc-black') continue;
			if (typeof theme.id === 'string' && theme.id) return theme.id;
			if (typeof theme.label === 'string' && theme.label) return theme.label;
		}
	}
	assert.fail('VS Code did not expose a built-in high-contrast theme');
}

async function focusControlWithKeyboard(frame: Frame, selector: string): Promise<void> {
	const prepared = await frame.evaluate((targetSelector) => {
		const target = document.querySelector<HTMLElement>(targetSelector);
		if (!target) return false;
		const style = getComputedStyle(target);
		if (style.display === 'none' || style.visibility === 'hidden' || target.getClientRects().length === 0) return false;
		return true;
	}, selector);
	assert.ok(prepared, `${selector} was not present in the keyboard tab order`);
	const visited: string[] = [];
	// Tab remains an indentation command while editing. Escape temporarily puts
	// CodeMirror into tab-focus mode so the following real Tab key reaches the
	// rendered controls rather than becoming a synthetic focus assertion.
	const editor = frame.locator('.cm-content');
	await editor.focus();
	await editor.press('Escape');
	await editor.press('Tab');
	visited.push(await frame.evaluate(() => {
		const active = document.activeElement as HTMLElement | null;
		return active ? `${active.tagName.toLowerCase()}.${active.className}` : 'none';
	}));
	if (await frame.evaluate((targetSelector) => document.activeElement?.matches(targetSelector) === true, selector)) return;
	for (let index = 1; index < 200; index++) {
		await frame.locator(':focus').press('Tab');
		if (visited.length < 40) visited.push(await frame.evaluate(() => {
			const active = document.activeElement as HTMLElement | null;
			return active ? `${active.tagName.toLowerCase()}.${active.className}` : 'none';
		}));
		if (await frame.evaluate((targetSelector) => document.activeElement?.matches(targetSelector) === true, selector)) return;
	}
	assert.fail(`${selector} could not be reached through the packaged webview's keyboard tab order: ${visited.join(' -> ')}`);
}

async function waitFor(check: () => boolean | Promise<boolean>, message: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await delay(50);
	}
	assert.fail(message);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acceptNativeInputBox(page: Page, value: string): Promise<void> {
	const widget = page.locator('.quick-input-widget:visible');
	await widget.waitFor({ state: 'visible', timeout: 5_000 });
	const input = widget.locator('.quick-input-box input');
	await input.fill(value);
	await input.press('Enter');
	await widget.waitFor({ state: 'hidden', timeout: 5_000 });
}
