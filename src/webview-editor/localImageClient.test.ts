import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearLocalImageCache,
	handleLocalImageMessage,
	LOCAL_IMAGE_REQUEST_TIMEOUT_MS,
	resolveLocalImage,
	setLocalImageContext,
	setLocalImagePoster,
} from './localImageClient';

describe('local image request client', () => {
	const posted: Array<{ type: string; requestId: number; src: string; contextPath: string }> = [];

	beforeEach(() => {
		clearLocalImageCache();
		posted.length = 0;
		setLocalImageContext('Notes/Current.md');
		setLocalImagePoster((message) => posted.push(message as typeof posted[number]));
	});

	afterEach(() => {
		clearLocalImageCache();
		vi.useRealTimers();
	});

	it('correlates a validated host reply, creates a local blob, and caches it', async () => {
		const first = resolveLocalImage('../Assets/picture.png');
		expect(posted).toEqual([{
			type: 'resolveLocalImage', requestId: expect.any(Number),
			src: '../Assets/picture.png', contextPath: 'Notes/Current.md',
		}]);
		const requestId = posted[0].requestId;
		expect(handleLocalImageMessage({
			type: 'localImage', requestId, mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB',
		})).toBe(true);
		const resolved = await first;
		expect(resolved).toMatch(/^blob:/);
		await expect(resolveLocalImage('../Assets/picture.png')).resolves.toBe(resolved);
		expect(posted).toHaveLength(1);
	});

	it('times out an unanswered request and permits a later retry', async () => {
		vi.useFakeTimers();
		const first = resolveLocalImage('missing.png');
		const timedOut = expect(first).rejects.toThrow(/timed out/i);
		await vi.advanceTimersByTimeAsync(LOCAL_IMAGE_REQUEST_TIMEOUT_MS);
		await timedOut;
		const retry = resolveLocalImage('missing.png');
		expect(posted).toHaveLength(2);
		const requestId = posted[1].requestId;
		handleLocalImageMessage({ type: 'localImage', requestId, error: 'Unavailable' });
		await expect(retry).rejects.toThrow('Unavailable');
	});

	it('cancels pending work when a document is reinitialized', async () => {
		const pending = resolveLocalImage('old.png');
		const canceled = expect(pending).rejects.toThrow(/could not be loaded/i);
		clearLocalImageCache();
		await canceled;
	});

	it('rejects forged host content whose bytes do not match the declared raster type', async () => {
		const image = resolveLocalImage('disguised.png');
		const requestId = posted[0].requestId;
		handleLocalImageMessage({
			type: 'localImage', requestId, mimeType: 'image/png', dataBase64: 'PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+',
		});
		await expect(image).rejects.toThrow(/could not be loaded/i);
	});

	it('rejects a valid raster header whose decoded canvas exceeds the safety limit', async () => {
		const image = resolveLocalImage('oversized.png');
		const requestId = posted[0].requestId;
		handleLocalImageMessage({
			type: 'localImage', requestId, mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAAASUhEUgAATiAAAAAB',
		});
		await expect(image).rejects.toThrow(/could not be loaded/i);
	});

	it('bounds concurrent image requests and releases the queue on reinitialization', async () => {
		const active = Array.from({ length: 4 }, (_, index) => resolveLocalImage(`image-${index}.png`));
		const rejected = resolveLocalImage('image-5.png');
		expect(posted).toHaveLength(4);
		await expect(rejected).rejects.toThrow(/too many/i);
		const cancellations = active.map((request) => expect(request).rejects.toThrow(/could not be loaded/i));
		clearLocalImageCache();
		await Promise.all(cancellations);
	});
});
