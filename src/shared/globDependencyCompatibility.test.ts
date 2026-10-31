import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as esmGlob from 'glob';
import * as esmMinimatch from 'minimatch';

const require = createRequire(import.meta.url);
let fixture: string;
beforeAll(async () => {
	fixture = await mkdtemp(join(tmpdir(), 'vault-glob-compat-'));
	for (const name of ['notes/alpha.md', 'notes/beta.MD', 'notes/.hidden.md', 'notes/nested/gamma.md', 'assets/a.png', 'src/main.ts', 'src/main.test.ts', 'node_modules/ignored.md']) {
		await mkdir(join(fixture, name, '..'), { recursive: true });
		await writeFile(join(fixture, name), 'synthetic fixture');
	}
});
afterAll(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); });

describe('patched development glob dependencies', () => {
	for (const [mode, glob, matcher] of [['ESM', esmGlob, esmMinimatch], ['CommonJS', require('glob'), require('minimatch')]] as const) {
		it(`${mode}: discovery APIs retain braces, ignores, hidden-file policy and matching`, async () => {
			const options = { cwd: fixture, ignore: ['node_modules/**'], posix: true };
			const expected = ['notes/alpha.md', 'notes/beta.MD', 'notes/nested/gamma.md'];
			expect(glob.globSync('**/*.{md,MD}', options).sort()).toEqual(expected);
			expect((await glob.glob('**/*.{md,MD}', options)).sort()).toEqual(expected);
			const streamed: string[] = [];
			for await (const name of glob.globStream('**/*.{md,MD}', options)) streamed.push(name);
			expect(streamed.sort()).toEqual(expected);
			expect(matcher.minimatch('notes/nested/gamma.md', '**/*.{md,MD}')).toBe(true);
			expect(matcher.minimatch('notes/.hidden.md', '**/*.md')).toBe(false);
			expect(matcher.minimatch('notes/beta.MD', '**/*.md', { nocase: true })).toBe(true);
		});
		for (const stream of [false, true]) it(`${mode}: ${stream ? 'stream' : 'async'} abort stops directory reads`, async () => {
			const controller = new AbortController();
			let reads = 0;
			const readdir = (path: fs.PathLike, options: any, callback: any) => {
				reads++;
				fs.readdir(path, options, (error, entries) => {
					controller.abort(new Error('synthetic stop'));
					callback(error, entries);
				});
			};
			const options = { cwd: fixture, signal: controller.signal, fs: { ...fs, readdir } };
			const operation = stream ? (async () => { for await (const _ of glob.globStream('**/*', options)) { /* Drain until cancellation. */ } })()
				: glob.glob('**/*', options);
			await expect(operation).rejects.toThrow('synthetic stop');
			await new Promise(resolve => setTimeout(resolve, 20));
			// Aborting the first read must not launch reads of its child directories.
			expect(reads).toBe(1);
		});
	}
	it('coverage exclusion retains synchronous and async discovery through its CommonJS adapter', async () => {
		const TestExclude = require('test-exclude');
		const exclude = new TestExclude({ cwd: fixture, include: ['**/*.ts'], exclude: ['**/*.test.ts'], extension: ['.ts'] });
		expect(exclude.globSync().sort()).toEqual(['src/main.ts']);
		expect((await exclude.glob()).sort()).toEqual(['src/main.ts']);
	});
	it('adversarial optimization patterns finish or reject within a separate-process budget', async () => {
		const code = `const {Minimatch} = require('minimatch');
for (const pattern of ['**/../'.repeat(20)+'target', 'a/**/../'.repeat(12)+'*.md']) {
  try { new Minimatch(pattern, {optimizationLevel:2}); }
  catch (error) { if (!/complex|limit|pattern|length/i.test(error.message)) throw error; }
}
process.stdout.write('bounded');`;
		const result = await promisify(execFile)(process.execPath, ['-e', code], { cwd: process.cwd(), timeout: 4000 });
		expect(result.stdout).toBe('bounded');
	});
});
