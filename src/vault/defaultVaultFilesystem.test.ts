import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createSafeDefaultVaultDirectory } from './defaultVaultFilesystem';

const cleanup: string[] = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('createSafeDefaultVaultDirectory', () => {
	it('creates and returns an ordinary canonical directory', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mdlp-default-vault-'));
		cleanup.push(root);
		const path = join(root, 'Documents', 'Markdown Vault');
		expect(await createSafeDefaultVaultDirectory(path)).toBe(await realpath(path));
	});

	it('accepts an existing ordinary directory', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mdlp-default-vault-'));
		cleanup.push(root);
		const path = join(root, 'Markdown Vault');
		await mkdir(path);
		expect(await createSafeDefaultVaultDirectory(path)).toBe(await realpath(path));
	});

	it('rejects a pre-positioned symlink instead of opening its target', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mdlp-default-vault-'));
		const outside = await mkdtemp(join(tmpdir(), 'mdlp-default-vault-outside-'));
		cleanup.push(root, outside);
		const path = join(root, 'Markdown Vault');
		await symlink(outside, path, process.platform === 'win32' ? 'junction' : 'dir');
		await expect(createSafeDefaultVaultDirectory(path)).rejects.toThrow(/ordinary directory/);
	});

	it('rejects an existing non-directory entry', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mdlp-default-vault-'));
		cleanup.push(root);
		const path = join(root, 'Markdown Vault');
		await writeFile(path, 'not a directory');
		await expect(createSafeDefaultVaultDirectory(path)).rejects.toThrow();
	});
});
