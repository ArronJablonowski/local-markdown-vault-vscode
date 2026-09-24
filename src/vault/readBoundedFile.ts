import { constants as bufferConstants } from 'node:buffer';
import type { FileHandle } from 'node:fs/promises';

/** Reads at most the authorized bytes plus one sentinel, including file growth. */
export async function readBoundedFile(handle: Pick<FileHandle, 'read'>, maxBytes: number): Promise<Buffer> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes >= bufferConstants.MAX_LENGTH) {
		throw new Error('The file size limit is invalid.');
	}
	const buffer = Buffer.alloc(maxBytes + 1);
	let length = 0;
	while (length <= maxBytes) {
		const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
		if (bytesRead === 0) {
			// A file may shrink after stat. Do not retain the larger authorized
			// allocation behind a tiny returned slice; ordinary full reads stay zero-copy.
			if (length < maxBytes) {
				const result = Buffer.alloc(length);
				buffer.copy(result, 0, 0, length);
				return result;
			}
			return buffer.subarray(0, length);
		}
		length += bytesRead;
		if (length > maxBytes) throw new Error('The vault file exceeds the size limit.');
	}
	throw new Error('The vault file exceeds the size limit.');
}
