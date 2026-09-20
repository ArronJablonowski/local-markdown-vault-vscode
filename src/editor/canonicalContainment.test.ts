import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isCanonicalPathInside } from './canonicalContainment';

const cleanup: string[] = [];
afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('canonical filesystem containment', () => {
	it('accepts a real descendant and rejects a symlink escape', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mlp-vault-'));
		const outside = await mkdtemp(join(tmpdir(), 'mlp-outside-'));
		cleanup.push(root, outside);
		await mkdir(join(root, 'notes'));
		await writeFile(join(root, 'notes', 'inside.md'), 'inside');
		await writeFile(join(outside, 'secret.md'), 'secret');
		await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

		await expect(isCanonicalPathInside(root, join(root, 'notes', 'inside.md'))).resolves.toBe(true);
		await expect(isCanonicalPathInside(root, join(root, 'escape', 'secret.md'))).resolves.toBe(false);
	});

	it('fails closed for a missing target', async () => {
		const root = await mkdtemp(join(tmpdir(), 'mlp-vault-'));
		cleanup.push(root);
		await expect(isCanonicalPathInside(root, join(root, 'missing.md'))).resolves.toBe(false);
	});
});
