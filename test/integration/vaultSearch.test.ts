import * as assert from 'assert';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Frame, type Locator, type Page } from 'playwright';

interface SearchRecord { path: string; basename: string; searchTokens: readonly string[] }
interface SearchResult { record: SearchRecord; line?: number; context?: string; heading?: string }
interface SearchBatch { status: string; results: readonly SearchResult[]; total: number; scanned: number; matches: number; unreadable: number }
interface DevelopmentApi {
	getVaultService(): { rootUri: vscode.Uri } | undefined;
	getVaultIndexRecords(): readonly SearchRecord[];
	searchVaultDocuments(query: string): Promise<SearchBatch>;
}

suite('Vault title and content search', () => {
	if (process.env.MDLP_VAULT_SEARCH_TEST !== '1') return;
	let api: DevelopmentApi;
	let root: vscode.Uri;
	let fixture: vscode.Uri;
	let browser: Browser;
	let page: Page;
	let key: string;

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension<DevelopmentApi>('arronjablonowski.local-markdown-vault');
		assert.ok(extension, 'the development extension must be available');
		api = await extension.activate();
		const vault = api.getVaultService();
		assert.ok(vault, 'the disposable local workspace must be a vault');
		root = vault.rootUri;
		const port = Number(process.env.MDLP_VSCODE_DEBUG_PORT);
		assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535);
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		page = browser.contexts().flatMap(context => context.pages())[0];
		assert.ok(page, 'the isolated workbench must be available');
		await page.bringToFront();
	});

	setup(async () => {
		key = `search${randomUUID().replace(/-/g, '')}`;
		fixture = vscode.Uri.joinPath(root, `QA-${key.slice(-8)}`);
		await vscode.workspace.fs.createDirectory(fixture);
	});

	teardown(async function () {
		if (this.currentTest?.state === 'failed') {
			await page.screenshot({ path: join(process.env.MDLP_SEARCH_TEST_ARTIFACTS!, `${this.currentTest.title.slice(0, 64).replace(/[^a-z0-9]/gi, '-')}.png`) });
		}
		await page.keyboard.press('Escape');
		for (const document of vscode.workspace.textDocuments) {
			if (document.uri.path.startsWith(fixture.path + '/') && document.isDirty) await document.save();
		}
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.workspace.fs.delete(fixture, { recursive: true });
		await waitFor(() => !api.getVaultIndexRecords().some(record => record.path.startsWith(relative(fixture) + '/')), 'deleted fixture stayed in the index');
	});

	test('finds filename-only, heading-only, body-only, and combined matches without case sensitivity or duplicates', async () => {
		const name = await note(`${key} Title Only`, '# Other heading\nUnrelated body.');
		const heading = await note('Heading only', `# ${key.toUpperCase()}\nUnrelated body.`);
		const body = await note('Body only', `# Other heading\n\nA paragraph containing ${key.toUpperCase()} here.`);
		const both = await note(`${key} Combined`, `# ${key}\n\nRepeated ${key} ${key}.`);
		await note('Unrelated', '# Not a match\nNo matching keyword.');
		const found = await find(key.toUpperCase());
		assert.deepStrictEqual(found.map(item => item.record.path).sort(), [name, heading, body, both].map(relative).sort());
		assert.strictEqual(found.find(item => item.record.path === relative(body))?.line, 3);
		assert.match(found.find(item => item.record.path === relative(body))?.context ?? '', /A paragraph containing/);
		assert.strictEqual(found.filter(item => item.record.path === relative(both)).length, 1);
	});

	test('finds late content beyond the token cap and literal emoji or punctuation', async () => {
		const late = await note('Long research', Array.from({ length: 10_100 }, (_, i) => `uniqueterm${i}`).join(' ') + `\nTail ${key}.`);
		const record = api.getVaultIndexRecords().find(item => item.path === relative(late));
		assert.ok(record && !record.searchTokens.includes(key), 'fixture must exceed the lightweight token boundary');
		assert.deepStrictEqual((await find(key)).map(item => item.record.path), [relative(late)]);
		const special = await note('Symbols', '# Symbols\nA 🧪 sample with C++ and ☂.');
		for (const query of ['🧪', 'C++', '☂']) {
			assert.deepStrictEqual((await find(query)).map(item => item.record.path), [relative(special)], query);
		}
	});

	test('returns more than 200 documents and verifies phrases beyond 500 candidate notes', async function () {
		this.timeout(120_000);
		const count = 525;
		for (let offset = 0; offset < count; offset += 25) {
			await Promise.all(Array.from({ length: Math.min(25, count - offset) }, (_, i) => {
				const number = offset + i;
				return write(`Record ${String(number).padStart(3, '0')}`, `# Record ${number}\n${key} separated words promised.\n`);
			}));
		}
		const final = await write('ZZZ Exact phrase', `# Last note\n${key} promised\n`);
		await waitFor(() => api.getVaultIndexRecords().filter(record => record.path.startsWith(relative(fixture) + '/')).length === count + 1, 'large fixture index did not settle', 45_000);
		const all = await find(key);
		assert.strictEqual(all.length, count + 1, 'search must not stop at the former 200-result limit');
		assert.strictEqual(new Set(all.map(item => item.record.path)).size, count + 1);
		const phrase = await find(`${key} promised`);
		assert.deepStrictEqual(phrase.map(item => item.record.path), [relative(final)], 'the matching phrase must survive over 500 earlier false candidates');
	});

	test('searches the latest unsaved document text immediately without forcing a save', async () => {
		const target = await note('Unsaved current text', '# Initial\nOriginal content.');
		const document = await vscode.workspace.openTextDocument(target);
		await vscode.window.showTextDocument(document);
		const edit = new vscode.WorkspaceEdit();
		edit.insert(target, document.positionAt(document.getText().length), `\n${key}`);
		assert.ok(await vscode.workspace.applyEdit(edit));
		assert.ok(document.isDirty);
		const found = await find(key);
		assert.deepStrictEqual(found.map(item => item.record.path), [relative(target)]);
		assert.strictEqual(found[0].line, 3);
		assert.ok(document.isDirty, 'search must not save or mutate a document');
		assert.ok(!Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8').includes(key));
	});

	test('reflects external file edits and deletions without reopening a document', async () => {
		const target = await note('External changes', `# External\n${key} old`);
		assert.strictEqual((await find(key)).length, 1);
		await vscode.workspace.fs.writeFile(target, bytes(`# External\n${key}new`));
		await waitFor(async () => (await find(`${key}new`)).length === 1, 'external edit did not reach search');
		await vscode.workspace.fs.delete(target);
		await waitFor(async () => (await find(key)).length === 0, 'deleted note remained searchable');
	});

	test('excludes configured folders and refuses a symlink outside the vault', async function () {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const original = config.inspect<string[]>('vault.exclude')?.globalValue;
		const excluded = vscode.Uri.joinPath(fixture, 'Private');
		await vscode.workspace.fs.createDirectory(excluded);
		try {
			await config.update('vault.exclude', [...(original ?? []), `${relative(fixture)}/Private/**`], vscode.ConfigurationTarget.Global);
			await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(excluded, 'Hidden.md'), bytes(`# Hidden\n${key}`));
			const visible = await note('Public', `# Public\n${key}`);
			await delay(500);
			assert.deepStrictEqual((await find(key)).map(item => item.record.path), [relative(visible)]);
			const outside = vscode.Uri.file(join(process.env.MDLP_SEARCH_TEST_TEMPORARY!, `Outside-${key}.md`));
			await vscode.workspace.fs.writeFile(outside, bytes(`# Outside\n${key}secret`));
			try {
				await symlink(outside.fsPath, vscode.Uri.joinPath(fixture, 'Escape.md').fsPath, 'file');
			} catch (error) {
				if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
				console.log('Windows did not grant symlink creation; containment behavior is covered by the unit security suite.');
				return;
			}
			await delay(500);
			assert.deepStrictEqual(await find(`${key}secret`), [], 'external symlink contents must not be searched');
		} finally {
			await config.update('vault.exclude', original, vscode.ConfigurationTarget.Global);
		}
	});

	test('opens search from the Vault toolbar, types a query, shows paths and snippets, clears and cancels', async () => {
		const first = await note('UI title match', `# Notes\nParagraph with ${key}.`);
		await note(`${key} file name`, '# Other\nNo body match.');
		await vscode.commands.executeCommand('mdLivePreview.vault.focus');
		const searchButton = page.getByRole('button', { name: /Search Document Vault/ });
		await searchButton.first().click();
		const picker = widget();
		await picker.waitFor({ state: 'visible' });
		await picker.locator('input').pressSequentially(key, { delay: 12 });
		const row = picker.locator('.monaco-list-row').filter({ hasText: 'UI title match' });
		await row.waitFor({ state: 'visible' });
		assert.ok((await row.innerText()).includes(relative(first)), 'search should show the vault-relative path');
		assert.ok((await row.innerText()).includes(`Paragraph with ${key}`), 'body matches should show their text context');
		await waitFor(async () => (await picker.innerText()).includes('2 matching documents'), 'the search title did not show the complete document count');
		await picker.locator('input').fill(`${key}notfound`);
		await waitFor(async () => await picker.locator('.monaco-list-row').filter({ hasText: 'UI title match' }).count() === 0
			&& await picker.locator('.monaco-list-row').filter({ hasText: `${key} file name` }).count() === 0, 'a no-match query retained stale results');
		await picker.locator('input').fill('');
		await waitFor(async () => await picker.locator('input').inputValue() === '', 'query did not clear');
		await page.screenshot({ path: join(process.env.MDLP_SEARCH_TEST_ARTIFACTS!, 'search-toolbar-clear.png') });
		await picker.locator('input').press('Escape');
		await picker.waitFor({ state: 'hidden' });
		assert.strictEqual(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, 0, 'canceling search should not open a note');
	});

	test('keyboard acceptance opens paragraph, callout, and fenced-code matches at their Live Preview lines', async () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const original = config.inspect<string>('defaultEditor')?.globalValue;
		const examples = [
			{ title: 'Keyboard paragraph target', keyword: `${key}paragraph`, text: `Body ${key}paragraph here.` },
			{ title: 'Keyboard callout target', keyword: `${key}callout`, text: `> [!warning]+ Search inside callout\n> A matching ${key}callout paragraph.\n> Final callout line.` },
			{ title: 'Keyboard code target', keyword: `${key}code`, text: '```javascript\n' + Array.from({ length: 12 }, (_, i) => i === 6 ? `// ${key}code` : `const value${i} = ${i};`).join('\n') + '\n```' },
		];
		try {
			await config.update('defaultEditor', 'livePreview', vscode.ConfigurationTarget.Global);
			for (const example of examples) {
				const target = await note(example.title, '# Search target\n\n' + Array.from({ length: 75 }, (_, i) => `Filler line ${i}`).join('\n') + `\n${example.text}\n`);
				await vscode.commands.executeCommand('mdLivePreview.vaultSearch');
				await search(example.keyword, example.title);
				await widget().locator('input').press('Enter');
				await waitFor(() => activeUri()?.toString() === target.toString(), 'keyboard search acceptance did not open the note');
				const frame = await livePreview(example.keyword);
				await waitFor(() => frame.evaluate(phrase => {
					const anchor = window.getSelection()?.anchorNode;
					const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
					return parent?.closest('.cm-line')?.textContent?.includes(phrase) === true;
				}, example.keyword), `Live Preview did not place the caret on the matching line in ${example.title}`);
			}
			await page.screenshot({ path: join(process.env.MDLP_SEARCH_TEST_ARTIFACTS!, 'search-keyboard-body-line.png') });
		} finally {
			await config.update('defaultEditor', original, vscode.ConfigurationTarget.Global);
		}
	});

	test('mouse acceptance opens the filename-only result in the configured Text Editor', async () => {
		const target = await note(`${key} Mouse target`, '# Independent heading\nOrdinary body text.');
		await vscode.commands.executeCommand('mdLivePreview.vaultSearch');
		await search(key, 'Mouse target');
		await widget().locator('.monaco-list-row').filter({ hasText: 'Mouse target' }).click();
		await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === target.toString(), 'mouse search acceptance did not open the configured Text Editor');
	});

	test('advanced syntax is explicit and refresh updates a changed search without reopening the picker', async () => {
		const tag = `qa-${key}`;
		const target = await note('Tagged search target', `---\ntags: [${tag}]\n---\n# Tagged note\nOriginal paragraph.`);
		await vscode.commands.executeCommand('mdLivePreview.vaultSearch');
		const picker = widget();
		await picker.locator('input').fill(`tag:${tag}`);
		await waitFor(async () => (await picker.innerText()).includes('No matching documents'), 'default keyword search interpreted filter syntax');
		await picker.getByRole('button', { name: 'Use advanced search syntax', exact: true }).click();
		await picker.locator('.monaco-list-row').filter({ hasText: 'Tagged search target' }).waitFor({ state: 'visible' });
		assert.ok((await picker.locator('input').getAttribute('placeholder'))?.includes('Advanced search'));
		for (const emptyQuery of ['OR', '""']) {
			await picker.locator('input').fill(emptyQuery);
			await waitFor(async () => {
				const contents = await picker.innerText();
				return contents.includes('Enter at least one search term') && !contents.includes('searching…');
			}, 'empty advanced syntax must show instructions and clear the busy title');
		}
		await picker.locator('input').fill(`tag:${tag}`);
		await picker.locator('.monaco-list-row').filter({ hasText: 'Tagged search target' }).waitFor({ state: 'visible' });
		await picker.getByRole('button', { name: 'Use keyword search', exact: true }).click();
		await waitFor(async () => (await picker.innerText()).includes('No matching documents'), 'returning to keyword mode retained advanced results');
		await picker.locator('input').fill(`${key}fresh`);
		await vscode.workspace.fs.writeFile(target, bytes(`# Updated note\n${key}fresh`));
		await picker.getByRole('button', { name: 'Refresh search', exact: true }).click();
		await picker.locator('.monaco-list-row').filter({ hasText: 'Tagged search target' }).waitFor({ state: 'visible' });
		assert.ok((await picker.innerText()).includes(`${key}fresh`));
		await vscode.workspace.fs.delete(target);
		await waitFor(async () => (await picker.innerText()).includes('No matching documents'), 'an open search did not update after external deletion');
		await picker.locator('input').press('Escape');
	});

	test('changing exclusions closes an active picker and prevents stale results from opening', async () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const original = config.inspect<string[]>('vault.exclude')?.globalValue;
		const source = `# Private after settings change\n${key}\n`;
		const target = await note('Visibility changed', source);
		await vscode.commands.executeCommand('mdLivePreview.vaultSearch');
		await search(key, 'Visibility changed');
		try {
			await config.update('vault.exclude', [...(original ?? []), `${relative(fixture)}/**`], vscode.ConfigurationTarget.Global);
			await widget().waitFor({ state: 'hidden' });
			await vscode.commands.executeCommand('mdLivePreview.vaultSearch');
			await widget().locator('input').fill(key);
			await waitFor(async () => (await widget().innerText()).includes('No matching documents'), 'an excluded note remained available in new search results');
			await widget().locator('input').press('Enter');
			assert.strictEqual(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, 0, 'a search status row opened an excluded note');
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8'), source);
		} finally {
			await config.update('vault.exclude', original, vscode.ConfigurationTarget.Global);
		}
	});

	test('rapid query replacement and malformed expressions never show stale matches or break search', async () => {
		await note('First result', `# First\n${key}first`);
		await note('Last result', `# Last\n${key}last`);
		await vscode.commands.executeCommand('mdLivePreview.vaultSearch');
		const input = widget().locator('input');
		await input.fill(`${key}first`);
		await input.fill(`${key}last`);
		await widget().locator('.monaco-list-row').filter({ hasText: 'Last result' }).waitFor({ state: 'visible' });
		assert.strictEqual(await widget().locator('.monaco-list-row').filter({ hasText: 'First result' }).count(), 0);
		for (const query of ['/[/i', '/(a+)+$/i', 'x'.repeat(2_049), '"unclosed', 'command:workbench.action.closeWindow', '../../outside']) {
			await input.fill(query);
			await delay(30);
		}
		await input.fill('x'.repeat(2_049));
		await waitFor(async () => (await widget().innerText()).includes('Invalid or oversized search'), 'oversized input did not display a useful validation message');
		await widget().getByRole('button', { name: 'Use advanced search syntax', exact: true }).click();
		await input.fill('/[/i');
		await waitFor(async () => (await widget().innerText()).includes('Invalid or oversized search'), 'an invalid regular expression did not display a validation message');
		await widget().getByRole('button', { name: 'Use keyword search', exact: true }).click();
		await search(`${key}last`, 'Last result');
		assert.strictEqual(await widget().locator('.monaco-list-row').filter({ hasText: 'First result' }).count(), 0);
		await input.press('Escape');
	});

	test('shows untrusted note snippets as inert text and leaves all note bytes unchanged', async () => {
		const source = `# Hostile snippet\n${key} <img src="https://example.invalid/pixel" onerror="alert(1)"> [link](command:workbench.action.closeWindow)\n`;
		const target = await note('Untrusted snippet', source);
		await vscode.commands.executeCommand('mdLivePreview.vaultSearch');
		await search(key, 'Untrusted snippet');
		const row = widget().locator('.monaco-list-row').filter({ hasText: 'Untrusted snippet' });
		assert.ok((await row.innerText()).includes('<img src='));
		assert.strictEqual(await row.locator('img').count(), 0, 'note HTML must not become workbench elements');
		assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8'), source);
		await widget().locator('input').press('Escape');
	});

	function relative(uri: vscode.Uri): string { return uri.path.slice(root.path.length + 1); }
	async function find(query: string): Promise<readonly SearchResult[]> {
		const batch = await api.searchVaultDocuments(query);
		assert.strictEqual(batch.status, 'complete', 'a valid search must complete');
		assert.strictEqual(batch.matches, batch.results.length, 'the returned match count must match all results');
		assert.strictEqual(batch.scanned, batch.total, 'search must scan every indexed document');
		return batch.results;
	}
	async function write(name: string, text: string): Promise<vscode.Uri> {
		const target = vscode.Uri.joinPath(fixture, `${name}.md`);
		await vscode.workspace.fs.writeFile(target, bytes(text));
		return target;
	}
	async function note(name: string, text: string): Promise<vscode.Uri> {
		const target = await write(name, text);
		await waitFor(() => api.getVaultIndexRecords().some(record => record.path === relative(target)), `note ${name} did not reach the index`);
		return target;
	}
	function widget(): Locator { return page.locator('.quick-input-widget:visible'); }
	async function search(query: string, title: string): Promise<void> {
		await widget().waitFor({ state: 'visible' });
		await widget().locator('input').fill(query);
		await widget().locator('.monaco-list-row').filter({ hasText: title }).waitFor({ state: 'visible', timeout: 15_000 });
	}
	async function livePreview(expectedText: string): Promise<Frame> {
		let result: Frame | undefined;
		await waitFor(async () => {
			for (const context of browser.contexts()) for (const candidate of context.pages()) for (const frame of candidate.frames()) {
				if (!frame.isDetached() && await frame.locator('.cm-content').count() > 0
					&& (await frame.locator('.cm-content').textContent())?.includes(expectedText)) { result = frame; return true; }
			}
			return false;
		}, 'Live Preview frame did not mount');
		return result!;
	}
});

function bytes(text: string): Uint8Array { return new TextEncoder().encode(text); }
function activeUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}
async function waitFor(predicate: () => boolean | Promise<boolean>, message: string, timeout = 15_000): Promise<void> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await delay(50);
	}
	assert.fail(message);
}
