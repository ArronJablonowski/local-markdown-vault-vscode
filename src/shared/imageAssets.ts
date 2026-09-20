const MIME_TO_EXTENSION: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/bmp': 'bmp',
};

/** Decode ceilings applied before a local or pasted raster reaches the browser. */
export const MAX_RASTER_IMAGE_DIMENSION = 16_384;
export const MAX_RASTER_IMAGE_PIXELS = 64 * 1024 * 1024;

/** Maps a known image MIME type to a file extension; `undefined` for anything unrecognized. */
export function extensionForMimeType(mimeType: string): string | undefined {
	return MIME_TO_EXTENSION[mimeType.toLowerCase()];
}

/** Returns the passive raster MIME for a filename/path, or `undefined`. */
export function rasterMimeTypeForPath(path: string): string | undefined {
	const match = /\.([^.\\/]+)$/.exec(path);
	if (!match) return undefined;
	const extension = match[1].toLowerCase();
	return Object.entries(MIME_TO_EXTENSION).find(([, candidate]) => candidate === extension ||
		(extension === 'jpeg' && candidate === 'jpg'))?.[0];
}

/**
 * Confirms that clipboard bytes have the signature of the declared passive
 * raster format. The browser-provided MIME type is attacker-controlled input;
 * checking it alone would allow HTML, XML, or another active format to be
 * written with a trusted-looking image extension.
 */
export function hasRasterImageSignature(mimeType: string, bytes: Uint8Array): boolean {
	switch (mimeType.toLowerCase()) {
		case 'image/png':
			return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		case 'image/jpeg':
			return startsWith(bytes, [0xff, 0xd8, 0xff]);
		case 'image/gif':
			return startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
				startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
		case 'image/webp':
			return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
				bytes.length >= 12 && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]);
		case 'image/bmp':
			return startsWith(bytes, [0x42, 0x4d]);
		default:
			return false;
	}
}

/**
 * Reads dimensions from bounded raster headers without invoking an image
 * decoder. A small compressed image can otherwise advertise a huge canvas and
 * consume hundreds of megabytes when the browser expands it. Malformed,
 * truncated, dimensionless, or over-budget files fail closed.
 */
export function hasSafeRasterImageDimensions(mimeType: string, bytes: Uint8Array): boolean {
	const dimensions = rasterImageDimensions(mimeType, bytes);
	return dimensions !== undefined && dimensions.width > 0 && dimensions.height > 0 &&
		dimensions.width <= MAX_RASTER_IMAGE_DIMENSION && dimensions.height <= MAX_RASTER_IMAGE_DIMENSION &&
		dimensions.width * dimensions.height <= MAX_RASTER_IMAGE_PIXELS;
}

export function rasterImageDimensions(
	mimeType: string,
	bytes: Uint8Array,
): { width: number; height: number } | undefined {
	if (!hasRasterImageSignature(mimeType, bytes)) return undefined;
	switch (mimeType.toLowerCase()) {
		case 'image/png':
			return bytes.length >= 24 && ascii(bytes, 12, 'IHDR')
				? { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) }
				: undefined;
		case 'image/gif':
			return bytes.length >= 10
				? { width: readU16LE(bytes, 6), height: readU16LE(bytes, 8) }
				: undefined;
		case 'image/bmp':
			return bmpDimensions(bytes);
		case 'image/webp':
			return webpDimensions(bytes);
		case 'image/jpeg':
			return jpegDimensions(bytes);
		default:
			return undefined;
	}
}

function bmpDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (bytes.length < 22) return undefined;
	const dibSize = readU32LE(bytes, 14);
	if (dibSize === 12) return { width: readU16LE(bytes, 18), height: readU16LE(bytes, 20) };
	if (dibSize < 40 || bytes.length < 26) return undefined;
	const width = readI32LE(bytes, 18);
	const height = readI32LE(bytes, 22);
	if (width <= 0 || height === 0 || height === -0x80000000) return undefined;
	return { width, height: Math.abs(height) };
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const chunk = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
		const size = readU32LE(bytes, offset + 4);
		const data = offset + 8;
		if (size > bytes.length - data) return undefined;
		if (chunk === 'VP8X' && size >= 10) {
			return { width: 1 + readU24LE(bytes, data + 4), height: 1 + readU24LE(bytes, data + 7) };
		}
		if (chunk === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
			const bits = readU32LE(bytes, data + 1);
			return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
		}
		if (chunk === 'VP8 ' && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
			return { width: readU16LE(bytes, data + 6) & 0x3fff, height: readU16LE(bytes, data + 8) & 0x3fff };
		}
		offset = data + size + (size & 1);
	}
	return undefined;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
	let offset = 2;
	while (offset < bytes.length) {
		if (bytes[offset++] !== 0xff) return undefined;
		while (offset < bytes.length && bytes[offset] === 0xff) offset++;
		if (offset >= bytes.length) return undefined;
		const marker = bytes[offset++];
		if (marker === 0xd9 || marker === 0xda) return undefined;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
		if (offset + 2 > bytes.length) return undefined;
		const length = readU16BE(bytes, offset);
		if (length < 2 || length > bytes.length - offset) return undefined;
		if (isJpegStartOfFrame(marker)) {
			if (length < 7) return undefined;
			return { height: readU16BE(bytes, offset + 3), width: readU16BE(bytes, offset + 5) };
		}
		offset += length;
	}
	return undefined;
}

function isJpegStartOfFrame(marker: number): boolean {
	return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
	return offset + value.length <= bytes.length && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function readU16BE(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readU32LE(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] * 0x1000000)) >>> 0;
}

function readI32LE(bytes: Uint8Array, offset: number): number {
	return readU32LE(bytes, offset) | 0;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
	return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Picks a file name that isn't already in `existingNames`: `image-<timestamp>.<ext>`,
 * falling back to `image-<timestamp>-1.<ext>`, `-2`, … on collision.
 */
export function generateImageFileName(existingNames: ReadonlySet<string>, timestampMs: number, ext: string): string {
	const base = `image-${timestampMs}`;
	let candidate = `${base}.${ext}`;
	let counter = 1;
	while (existingNames.has(candidate)) {
		candidate = `${base}-${counter}.${ext}`;
		counter++;
	}
	return candidate;
}
