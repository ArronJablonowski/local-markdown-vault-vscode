import * as assert from 'assert';
import * as vscode from 'vscode';
import { isAbsolute, relative, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type Browser, type Frame, type Locator, type Page } from 'playwright';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
const mode = process.env.MDLP_VSIX_SMOKE_MODE;
const vsixOnly = mode === 'trusted' || mode === 'restricted' ? test : test.skip;
const disabledOnly = mode === 'disabled' ? test : test.skip;
// Linux Electron exposes editor webviews to the loopback CDP session but not
// sidebar WebviewView out-of-process frames. The same packaged keyboard path is
// enforced on macOS and Windows; Linux still runs the sidebar DOM/E2E suite and
// verifies that the installed view can be revealed through the extension host.
const cssThemesKeyboardOnly = mode === 'trusted' && process.platform !== 'linux' ? test : test.skip;
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
		// Do not explicitly activate first: that hid a missing startup trigger
		// whenever the user opened only VS Code's built-in Markdown Editor.
		const activationDeadline = Date.now() + 15_000;
		while (!extension.isActive && Date.now() < activationDeadline) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.strictEqual(extension.isActive, true, 'the packaged extension did not activate automatically');
		const productionApi = await extension.activate();
		assert.strictEqual(extension.isActive, true);
		assert.deepStrictEqual(Object.keys(productionApi ?? {}), ['extendMarkdownIt'],
			'the packaged extension exposed an API beyond its Markdown renderer hook');
		assert.strictEqual(typeof productionApi.extendMarkdownIt, 'function',
			'the packaged extension did not expose its Markdown renderer hook');
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
	vsixOnly('highlights YAML and yml code fences using the packaged local grammar', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
		await connectToDebugBrowser();
		const code = 'service:\n  name: local-vault\n  enabled: true\n  port: 8080\ntags:\n  - notes\n  - local\ndescription: |\n  Local only.';
		for (const [index, language] of ['yaml', 'yml', 'YAML', 'YML'].entries()) {
			// Fresh notes avoid racing disposal and reopening of one custom editor.
			const uri = vscode.Uri.joinPath(root, `YAML code QA ${index}.md`);
			const source = '# YAML code QA\n\n```' + language + '\n' + code + '\n```\n\nAfter';
			const bytes = Buffer.from(source); await vscode.workspace.fs.writeFile(uri, bytes);
			try {
				await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
				const frame = await connectToLivePreviewFrame('YAML code QA');
				await waitFor(async () => await frame.locator('.mlp-line-code [style*="color"]').count() > 3, 'YAML syntax colors did not arrive from the packaged grammar');
				assert.strictEqual(await frame.locator('.mlp-code-language').textContent(), language);
				assert.strictEqual(await frame.locator('.mlp-frontmatter').count(), 0);
				await frame.getByRole('button', { name: 'Expand code block', exact: true }).click();
				await frame.getByRole('button', { name: 'Collapse code block', exact: true }).click();
				assert.strictEqual(await frame.getByRole('button', { name: 'Expand code block', exact: true }).count(), 1);
				assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), bytes);
			} finally {
				await vscode.commands.executeCommand('workbench.action.closeAllEditors');
				await vscode.workspace.fs.delete(uri, { useTrash: false });
			}
		}
	});
	vsixOnly('highlights YAML inside callout containers with exact source offsets', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
		await connectToDebugBrowser();
		const uri = vscode.Uri.joinPath(root, 'Nested YAML QA.md');
		for (const [header, prefix] of [['> [!warning]+ Configuration', '> '], ['> [!note]+ Outer\n>\n> > [!tip]+ Configuration', '> > '], ['- > [!note]+ Configuration', '  > ']]) {
			const source = '# Nested YAML QA\n\n' + header + '\n' + ['```yaml', 'service:', '  enabled: true', '  port: 8080', 'tags:', '  - notes', '```', '', '| Notes | Owner |', '| --- | --- |', '| **Review**<br>Follow up | Team |'].map(line => prefix + line).join('\n') + '\n\nAfter';
			const bytes = Buffer.from(source); await vscode.workspace.fs.writeFile(uri, bytes);
			try {
				await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
				const frame = await connectToLivePreviewFrame('Nested YAML QA');
				await waitFor(async () => await frame.locator('.mlp-line-code [style*="color"]').count() > 3, 'nested YAML did not receive syntax highlighting');
				assert.strictEqual(await frame.locator('.mlp-table td').last().textContent(), 'Team');
				assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), bytes);
			} finally { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); }
		}
		await vscode.workspace.fs.delete(uri, { useTrash: false });
	});
	vsixOnly('saves a YAML scalar edit while preserving callout bullets and table widths', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
		await connectToDebugBrowser();
		const uri = vscode.Uri.joinPath(root, 'YAML scalar edit QA.md');
		const source = '# YAML scalar edit QA\n\n> [!warning]+ Configuration\n> - [ ] Review\n>     - Compare\n>\n> ````yaml\n> description: |\n>   > [!note] Literal\n>   - [ ] Literal task\n>   ```text\n>   literal code\n>   ```\n> enabled: true\n> ````\n>\n> | Notes | Owner |\n> | --- | --- |\n> | **Decision**<br>Follow up | Team |\n\nOutside';
		await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('YAML scalar edit QA');
			await frame.getByRole('button', { name: 'Expand code block', exact: true }).click();
			const handle = frame.getByRole('separator', { name: 'Resize column 1', exact: true });
			await handle.focus(); for (let n = 0; n < 55; n++) await frame.page().keyboard.press('Shift+ArrowLeft');
			await frame.locator('.cm-line').filter({ hasText: 'enabled: true' }).click();
			await frame.page().keyboard.press('End');
			for (let n = 0; n < 4; n++) await frame.page().keyboard.press('Shift+ArrowLeft');
			await frame.page().keyboard.type('falseX', { delay: 25 });
			await frame.page().keyboard.press('ArrowLeft'); await frame.page().keyboard.press('ArrowRight'); await frame.page().keyboard.press('Backspace');
			const expected = source.replace('enabled: true', 'enabled: false');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8') === expected, 'YAML scalar edit did not save exactly');
			await waitFor(async () => await frame.locator('.mlp-line-code').filter({ hasText: 'enabled: false' }).locator('[style*="color"]').count() > 0, 'YAML colors did not refresh after editing');
			await frame.locator('.cm-line').filter({ hasText: /^Outside$/ }).click();
			const callout = frame.getByRole('button', { name: 'Configuration callout', exact: true });
			await callout.click(); await callout.click();
			assert.strictEqual(await handle.getAttribute('aria-valuenow'), '64');
			assert.strictEqual(await frame.locator('.mlp-table td').last().textContent(), 'Team');
			assert.strictEqual(await frame.locator('.mlp-checkbox').count(), 1);
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'), expected);
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});
	vsixOnly('undoes and redoes saved YAML, table, and task edits without losing neighboring content', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
		await connectToDebugBrowser();
		const uri = vscode.Uri.joinPath(root, 'Mixed undo QA.md');
		const source = '# Mixed undo QA\n\n> [!warning]+ Configuration\n> - [ ] Review\n>     - Compare\n>\n> ```yaml\n> service:\n>   name: demo\n>   enabled: true\n> ```\n>\n> | Notes | Owner |\n> | --- | --- |\n> | Review<br>Details | Team |\n\nOutside';
		await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Mixed undo QA');
			const key = process.platform === 'darwin' ? 'Meta' : 'Control';
			const saved = async (expected: string) => {
				try {
					await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8') === expected
						&& await frame.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString()) === expected, 'mixed Undo/Redo did not preserve and save the expected source');
				} catch (error) {
					const actual = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
					const editor = await frame.locator('.cm-content').evaluate((el: any) => ({ text: el.cmTile.root.view.state.doc.toString(), selection: el.cmTile.root.view.state.selection.toJSON(), focus: document.activeElement?.className }));
					throw new Error(`${String(error)}; synthetic fixture diagnostics: ${JSON.stringify({ expected, actual, editor })}`);
				}
			};
			const handle = frame.getByRole('separator', { name: 'Resize column 1', exact: true });
			await handle.focus(); for (let n = 0; n < 55; n++) await frame.page().keyboard.press('Shift+ArrowLeft');
			await frame.locator('.cm-line').filter({ hasText: 'name: demo' }).click();
			await frame.page().keyboard.press('End'); await frame.page().keyboard.type('X');
			const yamlEdited = source.replace('name: demo', 'name: demoX'); await saved(yamlEdited);
			await frame.page().keyboard.press(`${key}+z`); await saved(source);
			await frame.page().keyboard.press(`${key}+Shift+z`); await saved(yamlEdited);
			await frame.locator('.mlp-table td').first().click(); await frame.page().keyboard.press('End'); await frame.page().keyboard.type('X'); await frame.page().keyboard.press('Enter');
			const tableEdited = yamlEdited.replace('Review<br>Details', 'Review<br>DetailsX'); await saved(tableEdited);
			await frame.page().keyboard.press(`${key}+z`); await saved(yamlEdited);
			await frame.page().keyboard.press(`${key}+Shift+z`); await saved(tableEdited);
			await frame.locator('.mlp-checkbox').click();
			const taskEdited = tableEdited.replace('[ ] Review', '[x] Review'); await saved(taskEdited);
			await frame.page().keyboard.press(`${key}+z`); await saved(tableEdited);
			await frame.page().keyboard.press(`${key}+Shift+z`); await saved(taskEdited);
			// History may restore an editing selection; leave source before measuring widgets.
			await frame.locator('.cm-line').filter({ hasText: /^Outside$/ }).click();
			assert.strictEqual(await handle.getAttribute('aria-valuenow'), '64');
			assert.strictEqual(await frame.locator('.mlp-table td').last().textContent(), 'Team');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});
	vsixOnly('opens, sorts, refreshes, and leaves packaged CSV data unchanged', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root);
		const uri = vscode.Uri.joinPath(root, 'Packaged CSV.csv');
		const source = 'Name,Count,Notes\r\nZebra,10,"<img src=x onerror=alert(1)>"\r\nApple,2,=SUM(A1:A2)\r\nBlank,,Retained\r\n';
		const before = Buffer.from(source, 'utf8');
		await vscode.workspace.fs.writeFile(uri, before);
		try {
			// Attach before creating the webview so CDP observes its inner frame.
			// Late attachment can intermittently enumerate only VS Code's outer shell.
			const browser = await connectToDebugBrowser();
			await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
			await waitFor(() => {
				const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
				return input instanceof vscode.TabInputCustom && input.viewType === 'mdLivePreview.csv';
			}, 'CSV did not use its default custom editor');
			let frame: Frame | undefined;
			await waitFor(async () => {
				for (const page of browser.contexts().flatMap(context => context.pages())) for (const candidate of page.frames()) {
					try { if (await candidate.locator('table[aria-label="CSV data"] #rows tr').count() === 3) { frame = candidate; return true; } } catch { /* A replaced editor frame may detach. */ }
				}
				return false;
			}, 'CSV rows did not render').catch(async error => {
				const snapshots: unknown[] = [];
				for (const page of browser.contexts().flatMap(context => context.pages())) for (const candidate of page.frames()) {
					try { snapshots.push({ url: candidate.url(), text: (await candidate.locator('body').textContent({ timeout: 500 }))?.slice(0, 1500) }); } catch { /* Detached diagnostics frame. */ }
				}
				console.error('CSV startup diagnostics', JSON.stringify(snapshots));
				throw error;
			});
			assert.ok(frame);
			await frame.locator('#head button').nth(1).click();
			assert.strictEqual(await frame.locator('#rows tr').first().textContent(), '3Apple2=SUM(A1:A2)');
			await frame.locator('#head button').nth(1).press('Enter');
			assert.match(await frame.locator('#rows tr').first().textContent() ?? '', /Zebra10/);
			assert.strictEqual(await frame.locator('#rows img, #rows script, #rows a').count(), 0);
			const document = await vscode.workspace.openTextDocument(uri);
			assert.strictEqual(document.isDirty, false);
			assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), before, 'sorting changed CSV bytes');
			// VS Code preserves the document's existing CRLF convention during edits.
			const replacement = 'Name,Count,Notes\r\nUpdated,4,"Multiline\r\nfield"\r\n';
			const edit = new vscode.WorkspaceEdit();
			edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), replacement);
			assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
			await waitFor(async () => (await frame!.locator('#rows tr').count()) === 1 && (await frame!.locator('#rows').textContent())?.includes('Updated') === true, 'CSV did not refresh from the text buffer');
			assert.strictEqual(await document.save(), true);
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'), replacement);
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(root, 'README.md'), { preview: false });
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.csv');
			await waitFor(async () => {
				for (const page of browser.contexts().flatMap(context => context.pages())) for (const candidate of page.frames()) {
					try { if ((await candidate.locator('#rows').textContent({ timeout: 200 }))?.includes('Updated')) { frame = candidate; return true; } } catch { /* Wait for the rebuilt CSV frame. */ }
				}
				return false;
			}, 'CSV did not restore its data after switching tabs');
			assert.strictEqual(await frame.locator('#head th').nth(2).getAttribute('aria-sort'), 'descending');
			await (await getWorkbenchPage()).screenshot({ path: join(tmpdir(), `vault-csv-${mode}.png`) });
			await frame.getByRole('button', { name: 'Open Text', exact: true }).click();
			await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText, 'CSV Open Text did not switch to the source');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});
	vsixOnly('collapses packaged Markdown tables to five rows without changing source', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root);
		const uri = vscode.Uri.joinPath(root, 'Table collapse.md');
		const source = '# Table collapse smoke\n\n| Name | Notes |\n| --- | --- |\n' + Array.from({ length: 12 }, (_, n) => `| Row ${n + 1} | Detail ${n + 1} |`).join('\n') + '\n\nAfter';
		const bytes = Buffer.from(source);
		await vscode.workspace.fs.writeFile(uri, bytes);
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Table collapse smoke');
			await frame.getByRole('button', { name: 'Collapse table', exact: true }).click();
			assert.strictEqual(await frame.locator('.mlp-table tbody tr:visible').count(), 5);
			assert.strictEqual(await frame.locator('.mlp-table tbody tr').count(), 12);
			assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), bytes);
			await frame.getByRole('button', { name: 'Expand table', exact: true }).press('Enter');
			assert.strictEqual(await frame.locator('.mlp-table tbody tr:visible').count(), 12);
			await frame.getByRole('button', { name: 'Collapse all collapsible objects' }).click();
			await waitFor(async () => await frame.locator('.mlp-table tbody tr:visible').count() === 5, 'global fold did not collapse the table');
			await frame.getByRole('button', { name: 'Expand all collapsible objects' }).click();
			await waitFor(async () => await frame.locator('.mlp-table tbody tr:visible').count() === 12, 'global unfold did not restore the table');
			const resize = frame.getByRole('separator', { name: 'Resize column 1', exact: true });
			await resize.focus();
			const width = await resize.evaluate(handle => handle.closest('th')!.getBoundingClientRect().width);
			await resize.press('Shift+ArrowRight');
			await waitFor(async () => Math.abs(await resize.evaluate(handle => handle.closest('th')!.getBoundingClientRect().width) - width - 40) < 2, 'packaged column did not resize');
			await resize.dblclick();
			await waitFor(async () => await resize.evaluate(handle => Math.abs(Number(handle.getAttribute('aria-valuenow')) - Math.round(handle.closest('th')!.getBoundingClientRect().width))) <= 1, 'packaged reset reported a stale accessible width');
			assert.strictEqual((await vscode.workspace.openTextDocument(uri)).isDirty, false);
			assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), bytes);
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});
	vsixOnly('saves selected callout list indentation without moving quote markers', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
		const uri = vscode.Uri.joinPath(root, 'List indentation QA.md');
		const block = '> - Child\n>   Continued **detail**';
		const source = '# List indentation QA\n\n> [!note] Agenda\n> - Parent\n' + block + '\n> - Sibling';
		await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('List indentation QA');
			await frame.locator('.cm-content').evaluate((el: any, range) => { const view = el.cmTile.root.view; view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus(); }, { from: source.indexOf(block), to: source.indexOf(block) + block.length });
			await frame.page().keyboard.press('Tab');
			const expected = source.replace(block, '>     - Child\n>       Continued **detail**');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8') === expected, 'selected list indentation did not save correctly');
			await frame.page().keyboard.press('Shift+Tab');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8') === source, 'selected list outdent did not restore the original file');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});
	vsixOnly('retains six code lines when collapsed without rewriting the file', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root);
		const uri = vscode.Uri.joinPath(root, 'Code preview.md');
		const source = '# Code six-line smoke\n\n```text\n' + Array.from({ length: 12 }, (_, n) => `preview_${n + 1}();`).join('\n') + '\n```\n\nAfter';
		const bytes = Buffer.from(source);
		await vscode.workspace.fs.writeFile(uri, bytes);
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Code six-line smoke');
			await frame.getByRole('button', { name: 'Collapse code block', exact: true }).click();
			let text = await frame.locator('.cm-content').textContent() ?? '';
			for (let n = 1; n <= 6; n++) assert.ok(text.includes(`preview_${n}();`));
			assert.ok(!text.includes('preview_7();'));
			await frame.getByRole('button', { name: 'Expand code block', exact: true }).press('Enter');
			text = await frame.locator('.cm-content').textContent() ?? '';
			assert.ok(text.includes('preview_12();'));
			assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), bytes);
			const document = await vscode.workspace.openTextDocument(uri);
			assert.strictEqual(document.isDirty, false);
			await frame.getByRole('button', { name: 'Collapse code block', exact: true }).click();
			const offset = source.indexOf('preview_2();');
			const edit = new vscode.WorkspaceEdit(); edit.insert(uri, document.positionAt(offset), 'Inserted\n');
			assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
			await waitFor(async () => {
				const rendered = await frame.locator('.cm-content').textContent() ?? '';
				return rendered.includes('Inserted') && rendered.includes('preview_5();') && !rendered.includes('preview_6();');
			}, 'edited code preview did not return to six lines');
			assert.strictEqual(await document.save(), true);
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'), source.slice(0, offset) + 'Inserted\n' + source.slice(offset));
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});

	vsixOnly('types and saves a quoted code fence without stray backticks', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
		const uri = vscode.Uri.joinPath(root, 'Quoted fence QA.md');
		const source = '# Quoted fence QA\n\n> [!note]+ Meeting\n> ';
		await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Quoted fence QA');
			await frame.locator('.cm-content').evaluate((el: any) => { const view = el.cmTile.root.view; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus(); });
			await frame.page().keyboard.type('```js', { delay: 20 });
			await frame.page().keyboard.press('Shift+Enter'); await frame.page().keyboard.type('const retained = true;', { delay: 10 });
			await frame.page().keyboard.press('Shift+Enter'); await frame.page().keyboard.type('```', { delay: 20 });
			const expected = source + '```js\n> const retained = true;\n> ```';
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8') === expected, 'quoted fence did not save exactly the typed delimiters');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});
	vsixOnly('deleting a folded callout keeps its surviving neighbor expanded', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
		const uri = vscode.Uri.joinPath(root, 'Callout neighbor QA.md');
		const block = '> [!note]+ Meeting\n> - [ ] Retained task\n>\n> | Notes | Owner |\n> | --- | --- |\n> | Retained | Team |';
		const source = '# Callout neighbor QA\n\n' + block + '\n\n' + block;
		await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Callout neighbor QA');
			const meetings = frame.getByRole('button', { name: 'Meeting callout', exact: true });
			await meetings.first().click();
			const document = await vscode.workspace.openTextDocument(uri);
			const from = source.indexOf(block), to = from + block.length + 2;
			const edit = new vscode.WorkspaceEdit(); edit.delete(uri, new vscode.Range(document.positionAt(from), document.positionAt(to)));
			assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
			await waitFor(async () => await meetings.count() === 1 && await meetings.getAttribute('aria-expanded') === 'true', 'surviving callout inherited deleted fold state');
			assert.strictEqual(await frame.locator('.mlp-table td').last().textContent(), 'Team');
			assert.strictEqual(await document.save(), true);
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'), source.slice(0, from) + source.slice(to));
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});
	vsixOnly('globally folds tables nested inside callouts using their widget anchors', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root);
		const uri = vscode.Uri.joinPath(root, 'Nested table QA.md');
		const source = '# Nested table QA\n\n> [!note] Meeting\n>\n> | Name | Status |\n> | --- | --- |\n' + Array.from({ length: 10 }, (_, n) => `> | Row ${n + 1} | Retained |`).join('\n') + '\n\nAfter';
		const bytes = Buffer.from(source); await vscode.workspace.fs.writeFile(uri, bytes);
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Nested table QA');
			await frame.getByRole('button', { name: 'Collapse all collapsible objects' }).click();
			await frame.getByRole('button', { name: 'Meeting callout', exact: true }).click();
			await waitFor(async () => await frame.locator('.mlp-table tbody tr:visible').count() === 5, 'nested table was not collapsed');
			await frame.getByRole('button', { name: 'Expand table', exact: true }).click();
			assert.strictEqual(await frame.locator('.mlp-table tbody tr:visible').count(), 10);
			assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), bytes);
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(uri, { useTrash: false });
		}
	});

	(mode === 'trusted' ? test : test.skip)('toggles packaged built-in Markdown Preview table headers live from the off default', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'Accessibility.md');
		const config = vscode.workspace.getConfiguration('mdLivePreview', note);
		const prior = config.inspect<boolean>('stickyTableHeaders')?.workspaceValue;
		assert.strictEqual(config.get('stickyTableHeaders'), false, 'sticky headers were not off in the clean profile');
		const before = await vscode.workspace.fs.readFile(note);
		try {
			// This checks configuration refresh of one fixed fixture, not the
			// unlocked preview's follow-active-editor behavior. A delayed editor
			// activation from the preceding test must not change this resource.
			await vscode.commands.executeCommand('markdown.showPreview', note, undefined, { locked: true });
			await assertBuiltInPreviewStickyState(false);
			await config.update('stickyTableHeaders', true, vscode.ConfigurationTarget.Workspace);
			await assertBuiltInPreviewStickyState(true);
			await config.update('stickyTableHeaders', false, vscode.ConfigurationTarget.Workspace);
			await assertBuiltInPreviewStickyState(false);
			assert.deepStrictEqual(await vscode.workspace.fs.readFile(note), before,
				'toggling built-in preview headers changed the Markdown source');
		} finally {
			await config.update('stickyTableHeaders', prior, vscode.ConfigurationTarget.Workspace);
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
	});

	vsixOnly('matches the requested clean-profile trust state', async () => {
		assert.strictEqual(vscode.workspace.isTrusted, mode === 'trusted');
	});

	(mode === 'trusted' ? test : test.skip)('registers packaged vault and knowledge commands in trusted mode', async () => {
		const commands = new Set(await vscode.commands.getCommands(true));
		for (const command of [
			'mdLivePreview.vault.refresh',
			'mdLivePreview.vault.undoMove',
			'mdLivePreview.vault.redoMove',
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
		await waitFor(async () => {
			try {
				await vscode.workspace.fs.stat(note);
				return true;
			} catch {
				return false;
			}
		}, 'the packaged Document Vault did not create a note');
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(note)), '',
			'the packaged Document Vault did not create an empty Markdown note');
		await waitFor(() => activeTabUri()?.toString() === note.toString(),
			'the packaged Document Vault did not open its created note');

		await page.bringToFront();
		await vscode.commands.executeCommand('workbench.view.extension.mdLivePreview');
		await vscode.commands.executeCommand('mdLivePreview.vault.focus');
		const createFolder = vscode.commands.executeCommand('mdLivePreview.vault.newFolder');
		await acceptNativeInputBox(page, folderName);
		await createFolder;
		await waitFor(async () => {
			try {
				return Boolean((await vscode.workspace.fs.stat(folder)).type & vscode.FileType.Directory);
			} catch {
				return false;
			}
		}, 'the packaged Document Vault did not create a folder');

		await selectWorkbenchTreeItemWithKeyboard(page, `File: ${noteName}.md`);
		await page.keyboard.press('Enter');
		await waitFor(() => activeTabUri()?.toString() === note.toString(),
			'the packaged Document Vault did not open its created note with Enter');
		await selectWorkbenchTreeItemWithKeyboard(page, `Folder: ${folderName}`);
		await page.keyboard.press('ArrowRight');
		// Expansion crosses the extension-host/filesystem boundary. Observe the
		// result of this one gesture, rather than sampling its initial collapsed
		// state or sending another key that could hide a lost expansion request.
		const expansionTrace: unknown[] = [];
		const expansionStarted = Date.now();
		try {
			await waitFor(async () => {
				const snapshot = await page.getByRole('treeitem', { name: `Folder: ${folderName}`, exact: true }).evaluateAll(items => {
					const row = items[0];
					const tree = row?.closest('[role="tree"]');
					return {
						rowCount: items.length, rowId: row?.id, expanded: row?.getAttribute('aria-expanded'),
						activeDescendant: tree?.getAttribute('aria-activedescendant'), busy: tree?.getAttribute('aria-busy'),
					};
				});
				expansionTrace.push({ elapsedMs: Date.now() - expansionStarted, ...snapshot });
				return snapshot.expanded === 'true';
			}, 'the packaged Document Vault did not expand its created folder with ArrowRight');
		} catch (error) {
			assert.fail(`${error instanceof Error ? error.message : String(error)}\nTree expansion observations: ${JSON.stringify(expansionTrace)}`);
		}
		await vscode.workspace.fs.stat(folder);

		// Exercise native selection and prompts, not direct VaultService calls.
		await selectWorkbenchTreeItemWithKeyboard(page, `File: ${noteName}.md`);
		// Native macOS context menus are outside Chromium's automation surface.
		// Pass the same validated context argument, then operate the real prompt.
		const rename = vscode.commands.executeCommand('mdLivePreview.vault.rename', { uri: note });
		await acceptNativeInputBox(page, 'Packaged Renamed Note.md');
		await rename;
		const renamed = vscode.Uri.joinPath(root, 'Packaged Renamed Note.md');
		await waitFor(async () => { try { await vscode.workspace.fs.stat(renamed); return true; } catch { return false; } }, 'rename did not complete');
		await assert.rejects(async () => vscode.workspace.fs.stat(note));
		await selectWorkbenchTreeItemWithKeyboard(page, 'File: Packaged Renamed Note.md');
		const move = vscode.commands.executeCommand('mdLivePreview.vault.move', { uri: renamed });
		await acceptNativeInputBox(page, folderName);
		await move;
		const moved = vscode.Uri.joinPath(folder, 'Packaged Renamed Note.md');
		await waitFor(async () => { try { await vscode.workspace.fs.stat(moved); return true; } catch { return false; } }, 'move did not complete');
		await assert.rejects(async () => vscode.workspace.fs.stat(renamed));
		// VS Code refuses modal confirmations in extension-test mode. The normal
		// installed-app workflow in run-vault-ui-qa.mjs covers confirmed trash.
	});

	cssThemesKeyboardOnly('operates packaged CSS Themes through keyboard input', async () => {
		const page = await getWorkbenchPage();
		await page.bringToFront();
		await vscode.commands.executeCommand('workbench.view.extension.mdLivePreview');
		await vscode.commands.executeCommand('mdLivePreview.styleManager.focus');
		await expandWorkbenchPaneWithKeyboard(page, 'CSS Themes');
		const frame = await connectToCssThemesFrame();
		const radios = frame.getByRole('radio');
		await waitFor(async () => await radios.count() >= 2,
			'the packaged CSS Themes sidebar did not expose its bundled radio controls');
		const radioCount = await radios.count();
		const originalIndex = await firstCheckedRadioIndex(radios);
		assert.ok(originalIndex >= 0, 'the packaged CSS Themes sidebar had no selected theme');
		// Move to an adjacent radio so the assertion remains correct when bundled
		// theme additions change the size of this native radio group.
		const targetIndex = originalIndex < radioCount - 1 ? originalIndex + 1 : originalIndex - 1;
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

		const quickPick = await openQuickSwitcher(page);
		await typeNativeQuickInput(page, 'Packaged Target');
		await quickPick.locator('.monaco-list-row').filter({ hasText: 'Packaged Target' })
			.waitFor({ state: 'visible', timeout: 5_000 });
		await page.keyboard.press('Escape');
		await quickPick.waitFor({ state: 'hidden', timeout: 5_000 });

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
				const inTableMenu = await control.evaluate(element => Boolean(element.closest('.mlp-table-toolbar')));
				if (inTableMenu) {
					await focusControlWithKeyboard(frame, '.mlp-table-options-btn');
					await frame.page().keyboard.press('Enter');
					await frame.page().keyboard.press('Tab');
				}
				await control.waitFor({ state: 'visible', timeout: 5_000 });
				await control.scrollIntoViewIfNeeded();
				if (!inTableMenu) await focusControlWithKeyboard(frame, selector);
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

		await frame.getByRole('button', { name: 'Expand YAML properties', exact: true }).click();
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
			let frame: Frame;
			try {
				frame = await connectToLivePreviewFrame('Packaged smoke', 5_000);
			} catch {
				// Some Electron hosts restore the custom-editor tab before attaching
				// its out-of-process frame. Reopening that same local document is a
				// bounded recovery that also verifies the packaged provider can be
				// resolved repeatedly in Restricted Mode.
				await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
				await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(root, 'README.md'), 'mdLivePreview.editor');
				await waitFor(() => activeTabUri()?.toString() === vscode.Uri.joinPath(root, 'README.md').toString(),
					'the retried Restricted Mode Live Preview did not become active');
				frame = await connectToLivePreviewFrame('Packaged smoke');
			}
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

async function assertBuiltInPreviewStickyState(enabled: boolean): Promise<void> {
	const browser = await connectToDebugBrowser();
	let lastTables: unknown[] = [];
	let lastPreviews: unknown[] = [];
	try {
		await waitFor(async () => {
			lastPreviews = [];
			for (const context of browser.contexts()) {
				for (const page of context.pages()) {
					for (const frame of page.frames()) {
						if (frame.isDetached()) continue;
						try {
							// Exclude our editor and find only the built-in read-only preview.
							const body = frame.locator('body.vscode-body');
							if (!await body.count()) continue;
							const headings = await body.locator('h1').allTextContents();
							lastPreviews.push({ url: frame.url(), headings, tableCount: await body.locator('table').count() });
							if (!headings[0]?.includes('Packaged accessibility')) continue;
							lastTables = await frame.locator('table').evaluateAll(tables => tables.map(table => ({
								classes: table.className,
								headings: Array.from(table.querySelectorAll('thead th')).map(header => ({ text: header.textContent, position: getComputedStyle(header).position })),
								text: table.textContent?.slice(0, 100),
							})));
							// YAML frontmatter also renders as a table; test the authored one.
							const table = frame.locator('table').filter({ has: frame.getByRole('columnheader', { name: 'name', exact: true }) }).first();
							if (!await table.count()) continue;
							const state = await table.evaluate(table => {
								const header = table.querySelector('thead th');
								return { marked: table.classList.contains('lmv-sticky-table-headers'), position: header ? getComputedStyle(header).position : '' };
							});
							if (state.marked === enabled && (enabled ? state.position === 'sticky' : state.position !== 'sticky')) return true;
						} catch (error) {
							// A live configuration refresh can replace the preview frame.
							if (!frame.isDetached() && !String(error).includes('Execution context was destroyed')) throw error;
						}
					}
				}
			}
			return false;
		}, `the packaged built-in Markdown Preview did not render sticky headers ${enabled ? 'on' : 'off'}`, 20_000);
	} catch (error) {
		throw new Error(`${String(error)}; observed built-in previews: ${JSON.stringify(lastPreviews)}; rendered table state: ${JSON.stringify(lastTables)}`);
	}
}

async function connectToLivePreviewFrame(expectedText: string, timeoutMs = 20_000): Promise<Frame> {
	const browser = await connectToDebugBrowser();
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue;
					try {
						const editor = frame.locator('.cm-content');
						// CodeMirror virtualizes lines; a scrolled heading may be absent from the DOM.
						if (await editor.count() > 0 && await editor.evaluate((element: any, text) =>
							element.cmTile?.root?.view?.state.doc.toString().includes(text) === true, expectedText)) return frame;
					} catch (error) {
						// VS Code replaces webview frames while restoring or refreshing an
						// editor. Resume discovery when that happens between enumeration
						// and the locator query, but retain every unrelated Playwright error.
						if (!frame.isDetached()) throw error;
					}
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
					try {
						if (await frame.locator('#mlp-sidebar-root').count() > 0) return frame;
					} catch (error) {
						if (!frame.isDetached()) throw error;
					}
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
	for (const page of pages) {
		try {
			if (await page.locator('.monaco-workbench').count() > 0) return page;
		} catch {
			// A background page can close while the workbench is being selected.
		}
	}
	assert.fail('the installed VSIX workbench page is unavailable');
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
	const headers = page.locator('#workbench\\.parts\\.sidebar .pane-header:visible');
	const header = headers.filter({ hasText: title }).first();
	await header.waitFor({ state: 'visible', timeout: 5_000 });
	for (let index = 0; index < await headers.count(); index++) {
		const sibling = headers.nth(index);
		if ((await sibling.textContent())?.includes(title)) continue;
		if (await sibling.getAttribute('aria-expanded') !== 'true') continue;
		await sibling.focus();
		await page.keyboard.press('Enter');
		await waitFor(
			async () => await sibling.getAttribute('aria-expanded') === 'false',
			`a sibling pane did not collapse before opening packaged ${title}`,
		);
	}
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
	const visited: string[] = [];
	for (let index = 0; index < 100; index++) {
		if (await control.evaluate((element) => document.activeElement === element)) return;
		visited.push(await frame.evaluate(() => `${document.activeElement?.tagName}: ${document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.className}`));
		if (index === 0 && await frame.evaluate(() => document.activeElement === document.body)) await body.press('Tab');
		else {
			// Use the direction toward the target within this webview. Always
			// tabbing forward could leave the sidebar and traverse the entire
			// workbench before reaching an earlier theme's action buttons.
			const backwards = await control.evaluate(element => Boolean(document.activeElement
				&& element.compareDocumentPosition(document.activeElement) & Node.DOCUMENT_POSITION_FOLLOWING));
			await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
		}
	}
	assert.fail(`the packaged sidebar control could not be reached through keyboard Tab navigation: ${await control.getAttribute('aria-label')}; visited: ${JSON.stringify(visited)}`);
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
		// Send the real workbench key without waiting on a transient :focus
		// locator; a rendered control can replace itself between those steps.
		await frame.page().keyboard.press('Tab');
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
	const targetPage = await findNativeQuickInputPage(page);
	const widget = targetPage.locator('.quick-input-widget:visible');
	await typeNativeQuickInput(targetPage, value);
	await targetPage.evaluate(() => {
		const widgets = Array.from(document.querySelectorAll<HTMLElement>('.quick-input-widget'));
		const visible = widgets.find((candidate) => {
			const style = getComputedStyle(candidate);
			return style.display !== 'none' && style.visibility !== 'hidden' && candidate.getClientRects().length > 0;
		});
		visible?.querySelector<HTMLInputElement>('.quick-input-box input')?.focus();
	});
	await targetPage.keyboard.press('Enter');
	await widget.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function findNativeQuickInputPage(preferredPage: Page): Promise<Page> {
	const browser = await connectToDebugBrowser();
	// Hosted Linux can take several seconds to reveal a second native input
	// immediately after opening the note created by the first one.
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const pages = browser.contexts().flatMap((context) => context.pages());
		const candidates = [preferredPage, ...pages.filter((page) => page !== preferredPage)];
		for (const page of candidates) {
			try {
				if (await page.locator('.quick-input-widget:visible').count() > 0) return page;
			} catch {
				// Ignore pages that close while VS Code presents the native overlay.
			}
		}
		await delay(50);
	}
	assert.fail('VS Code did not present the native input box on an active workbench page');
}

async function openQuickSwitcher(page: Page): Promise<Locator> {
	const widget = page.locator('.quick-input-widget:visible');
	for (let attempt = 0; attempt < 2; attempt++) {
		await vscode.commands.executeCommand('mdLivePreview.quickSwitcher');
		try {
			await widget.waitFor({ state: 'visible', timeout: 5_000 });
			return widget;
		} catch {
			if (attempt === 1) throw new Error('VS Code did not present the native Quick Switcher input');
			await page.keyboard.press('Escape');
			await delay(100);
		}
	}
	throw new Error('VS Code did not present the native Quick Switcher input');
}

async function typeNativeQuickInput(page: Page, value: string): Promise<void> {
	await page.bringToFront();
	// Drive the input through the workbench keyboard. Locator-scoped fill/press
	// waits for actionability while VS Code animates and later tears down this
	// transient overlay, which can race indefinitely on headless Linux.
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const focused = await page.evaluate(() => {
			const widgets = Array.from(document.querySelectorAll<HTMLElement>('.quick-input-widget'));
			const visible = widgets.find((candidate) => {
				const style = getComputedStyle(candidate);
				return style.display !== 'none' && style.visibility !== 'hidden' && candidate.getClientRects().length > 0;
			});
			const input = visible?.querySelector<HTMLInputElement>('.quick-input-box input');
			if (!input) return false;
			input.focus();
			input.select();
			return document.activeElement === input;
		});
		if (!focused) {
			await delay(50);
			continue;
		}
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.type(value, { delay: 30 });
		for (let attempt = 0; attempt < 10; attempt++) {
			const accepted = await page.evaluate((expected) => {
				const widgets = Array.from(document.querySelectorAll<HTMLElement>('.quick-input-widget'));
				const visible = widgets.find((candidate) => {
					const style = getComputedStyle(candidate);
					return style.display !== 'none' && style.visibility !== 'hidden' && candidate.getClientRects().length > 0;
				});
				return visible?.querySelector<HTMLInputElement>('.quick-input-box input')?.value === expected;
			}, value);
			if (accepted) return;
			await delay(50);
		}
	}
	assert.fail(`VS Code did not accept keyboard text in the native input: ${await page.evaluate(() => JSON.stringify({
		focused: document.activeElement?.outerHTML,
		inputs: Array.from(document.querySelectorAll<HTMLInputElement>('.quick-input-box input')).map(input => ({ value: input.value, placeholder: input.placeholder })),
	}))}`);
}
