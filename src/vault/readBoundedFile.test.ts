import { describe, expect, it } from 'vitest';
import { appendFile, mkdtemp, open, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBoundedFile } from './readBoundedFile';

function reader(source: string, chunkSize = Number.MAX_SAFE_INTEGER) {
	const bytes = Buffer.from(source);
	let position = 0;
	let requested = 0;
	let allocated = 0;
	const handle = {
		read: async (buffer: Buffer, offset: number, length: number) => {
			requested += length;
			allocated = Math.max(allocated, buffer.byteLength);
			const bytesRead = Math.min(length, chunkSize, bytes.length - position);
			bytes.copy(buffer, offset, position, position + bytesRead);
			position += bytesRead;
			return { bytesRead, buffer };
		},
	} as unknown as Pick<FileHandle, 'read'>;
	return { handle, consumed: () => position, requested: () => requested, allocated: () => allocated };
}

describe('bounded vault file reads', () => {
	it('returns exact bytes, including a file that fills its entire limit', async () => {
		const input = reader('exact bytes');
		await expect(readBoundedFile(input.handle, 11)).resolves.toEqual(Buffer.from('exact bytes'));
		expect(input.allocated()).toBe(12);
	});

	it('continues short reads until EOF without losing bytes', async () => {
		const input = reader('multiple chunks', 2);
		await expect(readBoundedFile(input.handle, 15)).resolves.toEqual(Buffer.from('multiple chunks'));
	});

	it('does not retain a large backing buffer when the authorized file shrinks', async () => {
		const input = reader('tiny');
		const result = await readBoundedFile(input.handle, 1_000_000);
		expect(result.toString()).toBe('tiny');
		expect(result.buffer.byteLength).toBe(4);
	});

	it('rejects content that grew after the authorized stat and consumes only one extra byte', async () => {
		const input = reader('a'.repeat(100_000));
		await expect(readBoundedFile(input.handle, 4)).rejects.toThrow(/size limit/);
		expect(input.consumed()).toBe(5);
		expect(input.requested()).toBe(5);
		expect(input.allocated()).toBe(5);
	});

	it('rejects a real file that grows after its handle snapshot', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'mdlp-bounded-read-'));
		const path = join(directory, 'growth.md');
		try {
			await writeFile(path, 'safe');
			const handle = await open(path, 'r');
			try {
				const snapshot = await handle.stat();
				await appendFile(path, ' unexpected growth');
				await expect(readBoundedFile(handle, snapshot.size)).rejects.toThrow(/size limit/);
				// The old unbounded readFile() would have consumed the entire growth.
				expect((await handle.stat()).size).toBeGreaterThan(snapshot.size + 1);
			} finally { await handle.close(); }
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	it('handles empty files and rejects growth from an empty snapshot', async () => {
		await expect(readBoundedFile(reader('').handle, 0)).resolves.toEqual(Buffer.alloc(0));
		await expect(readBoundedFile(reader('unexpected').handle, 0)).rejects.toThrow(/size limit/);
	});

	it('rejects invalid bounds before reading', async () => {
		for (const limit of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER]) {
			const input = reader('private');
			await expect(readBoundedFile(input.handle, limit)).rejects.toThrow(/size limit is invalid/);
			expect(input.requested()).toBe(0);
		}
	});
});
