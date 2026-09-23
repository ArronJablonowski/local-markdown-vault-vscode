import * as assert from 'assert';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { symlink } from 'node:fs/promises';

suite('vault drag and drop', () => {
	let provider: any;
	let controller: vscode.TreeDragAndDropController<any> & vscode.Disposable;
	let VaultEntry: any;
	let root: vscode.Uri;
	let cancellation: vscode.CancellationTokenSource;
	setup(async () => {
		const api = await vscode.extensions.getExtension('arronjablonowski.local-markdown-vault')!.activate();
		const types = api.getDragDropTestTypes();
		VaultEntry = types.VaultEntry;
		const { VaultTreeProvider, VaultDragAndDropController } = types;
		provider = new VaultTreeProvider();
		await provider.initialize();
		assert.ok(provider.service);
		root = vscode.Uri.joinPath(provider.service.rootUri, `.drag-qa-${randomUUID()}`);
		await vscode.workspace.fs.createDirectory(root);
		controller = new VaultDragAndDropController(provider);
		cancellation = new vscode.CancellationTokenSource();
	});
	teardown(async () => {
		controller.dispose(); provider.dispose(); cancellation.dispose();
		for (const document of vscode.workspace.textDocuments) {
			if (document.uri.path.startsWith(`${root.path}/`) && document.isDirty) await document.save();
		}
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.workspace.fs.delete(root, { recursive: true });
	});
	async function folder(path: string) {
		const uri = vscode.Uri.joinPath(root, path);
		await vscode.workspace.fs.createDirectory(uri); return uri;
	}
	async function note(path: string, text = '# Unchanged\n') {
		const uri = vscode.Uri.joinPath(root, path);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(text)); return uri;
	}
	async function entry(uri: vscode.Uri) {
		return new VaultEntry(uri, (await vscode.workspace.fs.stat(uri)).type,
			vscode.Uri.file(dirname(uri.fsPath)), provider.service!.relativePath(uri)!);
	}
	async function drop(sources: vscode.Uri[], target?: vscode.Uri) {
		const data = new vscode.DataTransfer();
		await controller.handleDrag!(await Promise.all(sources.map(entry)), data, cancellation.token);
		const serialized = await data.get(controller.dragMimeTypes[0])!.asString();
		assert.deepStrictEqual(JSON.parse(serialized), sources.map(uri => uri.toString()));
		await controller.handleDrop!(target ? await entry(target) : undefined, data, cancellation.token);
	}
	async function text(uri: vscode.Uri) { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); }
	async function missing(uri: vscode.Uri) { await assert.rejects(Promise.resolve(vscode.workspace.fs.stat(uri))); }
	test('moves a file onto a folder and updates Markdown links', async () => {
		const target = await folder('Target');
		const source = await note('Source.md');
		const index = await note('Index.md', '[Source](Source.md)\n');
		await drop([source], target);
		await missing(source);
		assert.strictEqual(await text(vscode.Uri.joinPath(target, 'Source.md')), '# Unchanged\n');
		assert.ok((await vscode.workspace.openTextDocument(index)).getText().includes('(Target/Source.md)'));
	});
	test('moves a selected folder and child only once, preserving the hierarchy', async () => {
		const source = await folder('Source');
		const child = await note('Source/Child.md');
		const target = await folder('Target');
		await drop([child, source], target);
		await missing(source);
		assert.strictEqual(await text(vscode.Uri.joinPath(target, 'Source/Child.md')), '# Unchanged\n');
		await missing(vscode.Uri.joinPath(target, 'Child.md'));
	});
	test('moves multiple files, duplicate selections, and space-containing names onto a file parent', async () => {
		const a = await note('First note.md'), b = await note('Second.md');
		await folder('Target');
		const target = await note('Target/Existing.md');
		await drop([a, b, a], target);
		await missing(a); await missing(b);
		assert.strictEqual(await text(vscode.Uri.joinPath(root, 'Target/First note.md')), '# Unchanged\n');
		assert.strictEqual(await text(vscode.Uri.joinPath(root, 'Target/Second.md')), '# Unchanged\n');
	});
	test('rejects the whole batch on a collision without overwriting anything', async () => {
		const a = await note('A.md'), b = await note('B.md');
		const target = await folder('Target');
		const existing = await note('Target/B.md', 'Keep me');
		await drop([a, b], target);
		assert.strictEqual(await text(a), '# Unchanged\n');
		assert.strictEqual(await text(b), '# Unchanged\n');
		assert.strictEqual(await text(existing), 'Keep me');
		await missing(vscode.Uri.joinPath(target, 'A.md'));
	});
	test('rejects self and descendant drops and ignores same-parent moves', async () => {
		const source = await folder('Source'), child = await folder('Source/Child');
		const file = await note('Source/Note.md');
		await drop([source], source);
		await drop([source], child);
		await drop([file], source);
		assert.strictEqual(await text(file), '# Unchanged\n');
		await missing(vscode.Uri.joinPath(child, 'Source'));
	});
	test('ignores malformed and stale drag payloads', async () => {
		const source = await note('Source.md');
		const data = new vscode.DataTransfer();
		await controller.handleDrag!([await entry(source)], data, cancellation.token);
		await vscode.workspace.fs.delete(source);
		const target = await folder('Target');
		await controller.handleDrop!(await entry(target), data, cancellation.token);
		data.set(controller.dropMimeTypes[0], new vscode.DataTransferItem({ uri: source }));
		await controller.handleDrop!(await entry(target), data, cancellation.token);
		assert.deepStrictEqual(await vscode.workspace.fs.readDirectory(target), []);
	});
	test('canceled drags do not move files', async () => {
		const source = await note('Source.md'), target = await folder('Target');
		cancellation.cancel();
		await drop([source], target);
		assert.strictEqual(await text(source), '# Unchanged\n');
		assert.deepStrictEqual(await vscode.workspace.fs.readDirectory(target), []);
	});
	test('rejects symbolic-link destinations rather than moving to their parent', async function () {
		if (process.platform === 'win32') this.skip();
		const origin = await folder('Origin');
		const source = await note('Origin/Source.md'), target = await folder('Target');
		const link = vscode.Uri.joinPath(root, 'Shortcut');
		await symlink(target.fsPath, link.fsPath);
		await drop([source], link);
		assert.strictEqual(await text(vscode.Uri.joinPath(origin, 'Source.md')), '# Unchanged\n');
		await missing(vscode.Uri.joinPath(root, 'Source.md'));
	});
	test('oversized selections are rejected without moving a source', async () => {
		const source = await note('Source.md'), target = await folder('Target');
		await drop(Array.from({ length: 257 }, () => source), target);
		assert.strictEqual(await text(source), '# Unchanged\n');
		assert.deepStrictEqual(await vscode.workspace.fs.readDirectory(target), []);
	});
	test('rejects hostile serialized payloads without changing the destination', async () => {
		const target = await folder('Target');
		for (const payload of ['not JSON', '{}', '[null]', '[42]', '["command:workbench.action.closeWindow"]', '["https://example.invalid/note.md"]', ' '.repeat(1_048_577)]) {
			const data = new vscode.DataTransfer();
			data.set(controller.dropMimeTypes[0], new vscode.DataTransferItem(payload));
			await controller.handleDrop!(await entry(target), data, cancellation.token);
		}
		assert.deepStrictEqual(await vscode.workspace.fs.readDirectory(target), []);
	});
	test('an empty-space drop moves to the vault root', async () => {
		const name = `drag-root-${randomUUID()}.md`;
		const source = await note(name);
		const target = vscode.Uri.joinPath(provider.service!.rootUri, name);
		try {
			await drop([source]);
			await missing(source);
			assert.strictEqual(await text(target), '# Unchanged\n');
		} finally { await vscode.workspace.fs.delete(target); }
	});
});
