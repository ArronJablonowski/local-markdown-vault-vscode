import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	extensionForMimeType,
	generateImageFileName,
	hasRasterImageSignature,
	hasSafeRasterImageDimensions,
	MAX_RASTER_IMAGE_DIMENSION,
	rasterImageDimensions,
	rasterMimeTypeForPath,
} from './imageAssets';

describe('extensionForMimeType', () => {
	it('maps known image MIME types to their extension', () => {
		expect(extensionForMimeType('image/png')).toBe('png');
		expect(extensionForMimeType('image/jpeg')).toBe('jpg');
		expect(extensionForMimeType('image/gif')).toBe('gif');
		expect(extensionForMimeType('image/webp')).toBe('webp');
		expect(extensionForMimeType('image/bmp')).toBe('bmp');
		// SVG is active XML rather than a passive raster image. It must go through
		// a dedicated sanitizer before this feature may accept it.
		expect(extensionForMimeType('image/svg+xml')).toBeUndefined();
	});

	it('is case-insensitive', () => {
		expect(extensionForMimeType('IMAGE/PNG')).toBe('png');
	});

	it('returns undefined for an unrecognized MIME type', () => {
		expect(extensionForMimeType('application/pdf')).toBeUndefined();
		expect(extensionForMimeType('text/plain')).toBeUndefined();
	});
});

describe('rasterMimeTypeForPath', () => {
	it.each([
		['note.PNG', 'image/png'],
		['photo.jpg', 'image/jpeg'],
		['photo.jpeg', 'image/jpeg'],
		['animation.gif', 'image/gif'],
		['image.webp', 'image/webp'],
		['bitmap.bmp', 'image/bmp'],
	])('maps %s to %s', (path, mimeType) => {
		expect(rasterMimeTypeForPath(path)).toBe(mimeType);
	});

	it('rejects active and unknown formats', () => {
		expect(rasterMimeTypeForPath('active.svg')).toBeUndefined();
		expect(rasterMimeTypeForPath('no-extension')).toBeUndefined();
	});
});

describe('hasRasterImageSignature', () => {
	it.each([
		['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
		['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
		['image/gif', [...Buffer.from('GIF87a')]],
		['image/gif', [...Buffer.from('GIF89a')]],
		['image/webp', [...Buffer.from('RIFF0000WEBP')]],
		['image/bmp', [...Buffer.from('BM')]],
	] as const)('accepts a valid %s signature', (mimeType, signature) => {
		expect(hasRasterImageSignature(mimeType, Uint8Array.from(signature))).toBe(true);
	});

	it('rejects active or mismatched content regardless of its declared type', () => {
		const html = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
		for (const mimeType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']) {
			expect(hasRasterImageSignature(mimeType, html)).toBe(false);
		}
		expect(hasRasterImageSignature('image/png', Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(false);
		expect(hasRasterImageSignature('image/svg+xml', html)).toBe(false);
	});

	it('does not accept truncated signatures', () => {
		expect(hasRasterImageSignature('image/png', Uint8Array.from([0x89, 0x50, 0x4e]))).toBe(false);
		expect(hasRasterImageSignature('image/webp', new TextEncoder().encode('RIFF'))).toBe(false);
	});
});

describe('raster image dimension limits', () => {
	it.each([
		['image/png', png(640, 480)],
		['image/gif', gif(320, 200)],
		['image/bmp', bmp(800, 600)],
		['image/webp', webpExtended(1024, 768)],
		['image/webp', webpLossless(1024, 768)],
		['image/webp', webpLossy(1024, 768)],
		['image/jpeg', jpeg(1920, 1080)],
	] as const)('reads and accepts bounded %s dimensions', (mimeType, bytes) => {
		expect(rasterImageDimensions(mimeType, bytes)).toBeDefined();
		expect(hasSafeRasterImageDimensions(mimeType, bytes)).toBe(true);
	});

	it('rejects oversized dimensions even when the signature and header are valid', () => {
		expect(hasSafeRasterImageDimensions('image/png', png(MAX_RASTER_IMAGE_DIMENSION + 1, 1))).toBe(false);
		expect(hasSafeRasterImageDimensions('image/png', png(10_000, 10_000))).toBe(false);
		expect(hasSafeRasterImageDimensions('image/gif', gif(0, 10))).toBe(false);
	});

	it('rejects malformed or truncated dimension headers', () => {
		expect(hasSafeRasterImageDimensions('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
		expect(hasSafeRasterImageDimensions('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(false);
		expect(hasSafeRasterImageDimensions('image/webp', new TextEncoder().encode('RIFF0000WEBP'))).toBe(false);
	});
});

function png(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set(new TextEncoder().encode('IHDR'), 12);
	new DataView(bytes.buffer).setUint32(16, width);
	new DataView(bytes.buffer).setUint32(20, height);
	return bytes;
}

function gif(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(10);
	bytes.set(new TextEncoder().encode('GIF89a'));
	new DataView(bytes.buffer).setUint16(6, width, true);
	new DataView(bytes.buffer).setUint16(8, height, true);
	return bytes;
}

function bmp(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(26);
	bytes.set(new TextEncoder().encode('BM'));
	const view = new DataView(bytes.buffer);
	view.setUint32(14, 40, true);
	view.setInt32(18, width, true);
	view.setInt32(22, height, true);
	return bytes;
}

function webpExtended(width: number, height: number): Uint8Array {
	const bytes = webpChunk('VP8X', 10);
	writeU24LE(bytes, 24, width - 1);
	writeU24LE(bytes, 27, height - 1);
	return bytes;
}

function webpLossless(width: number, height: number): Uint8Array {
	const bytes = webpChunk('VP8L', 5);
	bytes[20] = 0x2f;
	const bits = (width - 1) | ((height - 1) << 14);
	new DataView(bytes.buffer).setUint32(21, bits, true);
	return bytes;
}

function webpLossy(width: number, height: number): Uint8Array {
	const bytes = webpChunk('VP8 ', 10);
	bytes.set([0x9d, 0x01, 0x2a], 23);
	new DataView(bytes.buffer).setUint16(26, width, true);
	new DataView(bytes.buffer).setUint16(28, height, true);
	return bytes;
}

function webpChunk(type: string, size: number): Uint8Array {
	const bytes = new Uint8Array(20 + size + (size & 1));
	bytes.set(new TextEncoder().encode('RIFF'), 0);
	new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
	bytes.set(new TextEncoder().encode('WEBP'), 8);
	bytes.set(new TextEncoder().encode(type), 12);
	new DataView(bytes.buffer).setUint32(16, size, true);
	return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(13);
	bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x09, 0x08], 0);
	const view = new DataView(bytes.buffer);
	view.setUint16(7, height);
	view.setUint16(9, width);
	bytes.set([0x01, 0x11], 11);
	return bytes;
}

function writeU24LE(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = value & 0xff;
	bytes[offset + 1] = (value >>> 8) & 0xff;
	bytes[offset + 2] = (value >>> 16) & 0xff;
}

describe('generateImageFileName', () => {
	it('uses the plain "image-<timestamp>.<ext>" name when nothing collides', () => {
		expect(generateImageFileName(new Set(), 1700000000000, 'png')).toBe('image-1700000000000.png');
	});

	it('appends "-1" when the plain name is already taken', () => {
		const existing = new Set(['image-1700000000000.png']);
		expect(generateImageFileName(existing, 1700000000000, 'png')).toBe('image-1700000000000-1.png');
	});

	// Domain generators (PBT-07): realistic timestamps and known extensions,
	// with a controlled number of pre-existing collisions constructed to force
	// the counter loop through 0..N steps.
	const timestampArb = fc.integer({ min: 0, max: 9_999_999_999_999 });
	const extArb = fc.constantFrom('png', 'jpg', 'gif', 'webp', 'bmp');
	const collisionCountArb = fc.integer({ min: 0, max: 5 });

	it('never returns a name already present, and picks the next free slot in sequence (PBT-03 invariant)', () => {
		fc.assert(
			fc.property(timestampArb, extArb, collisionCountArb, (timestamp, ext, collisions) => {
				const base = `image-${timestamp}`;
				const existing = new Set<string>([`${base}.${ext}`]);
				for (let i = 1; i <= collisions; i++) existing.add(`${base}-${i}.${ext}`);

				const name = generateImageFileName(existing, timestamp, ext);

				expect(existing.has(name)).toBe(false);
				expect(name).toBe(`${base}-${collisions + 1}.${ext}`);
			}),
		);
	});
});
