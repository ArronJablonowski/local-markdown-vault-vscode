import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

interface DevelopmentApi {
	renameOrMoveMany(requests: readonly { source: vscode.Uri; destination: vscode.Uri; isFolder: boolean }[]): Promise<boolean>;
}

suite('vault undo preserves unopened incoming links', () => {
	// Opt-in failing regression for a confirmed native VS Code limitation. The
	// ordinary integration suite must not silently claim this behavior passes.
	if (process.env.MDLP_VAULT_UNDO_LIFETIME_TEST !== '1') return;
	for (const opened of [false, true]) test(`one undo restores saved incoming links when index was ${opened ? 'opened' : 'never displayed'}`, async function () {
		this.timeout(30_000);
		const extension = vscode.extensions.getExtension<DevelopmentApi>('arronjablonowski.local-markdown-vault');
		assert.ok(extension);
		const api = await extension.activate();
		const root = vscode.workspace.workspaceFolders![0].uri;
		const fixture = vscode.Uri.joinPath(root, `undo-lifetime-${randomUUID()}`);
		const archive = vscode.Uri.joinPath(fixture, 'Archive');
		const source = vscode.Uri.joinPath(fixture, 'Alpha.md');
		const second = vscode.Uri.joinPath(fixture, 'Beta.md');
		const index = vscode.Uri.joinPath(fixture, 'Index.md');
		const destination = vscode.Uri.joinPath(archive, 'Alpha.md');
		const secondDestination = vscode.Uri.joinPath(archive, 'Beta.md');
		const original = '[Alpha](Alpha.md) and [Beta](Beta.md)\n';
		const events: string[] = [];
		const describe = (name: string, document: vscode.TextDocument) => {
			if (document.uri.path.startsWith(fixture.path + '/')) events.push(`${name} ${document.uri.path.split('/').pop()} dirty=${document.isDirty} closed=${document.isClosed} v${document.version}: ${JSON.stringify(document.getText())}`);
		};
		const listeners = [
			vscode.workspace.onDidOpenTextDocument(d => describe('open', d)),
			vscode.workspace.onDidChangeTextDocument(e => describe(`change${e.reason ?? ''}`, e.document)),
			vscode.workspace.onDidSaveTextDocument(d => describe('save', d)),
			vscode.workspace.onDidCloseTextDocument(d => describe('close', d)),
		];
		const disk = async () => Buffer.from(await vscode.workspace.fs.readFile(index)).toString('utf8');
		try {
			await vscode.workspace.fs.createDirectory(archive);
			await vscode.workspace.fs.writeFile(source, Buffer.from('# Alpha\n'));
			await vscode.workspace.fs.writeFile(second, Buffer.from('# Beta\n'));
			await vscode.workspace.fs.writeFile(index, Buffer.from(original));
			if (opened) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(index));
			await vscode.commands.executeCommand('vscode.openWith', source, 'mdLivePreview.editor');
			assert.equal(await api.renameOrMoveMany([
				{ source, destination, isFolder: false }, { source: second, destination: secondDestination, isFolder: false },
			]), true);
			await wait(async () => await disk() === '[Alpha](Archive/Alpha.md) and [Beta](Archive/Beta.md)\n');
			await delay(1000);
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			await vscode.commands.executeCommand('undo');
			await wait(async () => await disk() === original);
			await vscode.workspace.fs.stat(source);
			await vscode.workspace.fs.stat(second);
		} catch (error) {
			console.log(events.join('\n'));
			console.log('Final disk:', JSON.stringify(await disk()));
			throw error;
		} finally {
			for (const listener of listeners) listener.dispose();
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(fixture, { recursive: true });
		}
	});
});

async function wait(condition: () => Promise<boolean>): Promise<void> {
	for (let i = 0; i < 100; i++) { if (await condition()) return; await delay(100); }
	throw new Error('Timed out waiting for exact persisted incoming links.');
}
