import type { HostToEditorMessage } from '../shared/messages';
import { t } from '../shared/i18n';
import { hasRasterImageSignature, hasSafeRasterImageDimensions } from '../shared/imageAssets';

type Pending = { resolve: (uri: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<number, Pending>();
const cache = new Map<string, Promise<string>>();
const objectUrls = new Set<string>();
const MAX_PENDING_IMAGES = 4;
export const LOCAL_IMAGE_REQUEST_TIMEOUT_MS = 10_000;
let nextRequestId = 1;
let post: ((message: unknown) => void) | undefined;
let currentContextPath = '';

export function setLocalImagePoster(poster: (message: unknown) => void): void { post = poster; }
export function setLocalImageContext(contextPath: string): void { currentContextPath = contextPath; }

export function resolveLocalImage(src: string, contextPath = currentContextPath): Promise<string> {
	const key = `${contextPath}\0${src}`;
	const existing = cache.get(key);
	if (existing) return existing;
	const promise = new Promise<string>((resolve, reject) => {
		if (!post || !contextPath) return reject(new Error(t('image.noConnection')));
		if (pending.size >= MAX_PENDING_IMAGES) return reject(new Error(t('image.tooMany')));
		const requestId = nextRequestId++;
		const timer = setTimeout(() => {
			pending.delete(requestId);
			reject(new Error(t('image.timeout')));
		}, LOCAL_IMAGE_REQUEST_TIMEOUT_MS);
		pending.set(requestId, { resolve, reject, timer });
		post!({ type: 'resolveLocalImage', requestId, src, contextPath });
	});
	promise.catch(() => cache.delete(key));
	cache.set(key, promise);
	return promise;
}

export function handleLocalImageMessage(message: HostToEditorMessage): boolean {
	if (message.type !== 'localImage') return false;
	const request = pending.get(message.requestId);
	if (!request) return true;
	pending.delete(message.requestId);
	clearTimeout(request.timer);
	if (typeof message.dataBase64 === 'string' && typeof message.mimeType === 'string') {
		try {
			const decoded = atob(message.dataBase64);
			const bytes = new Uint8Array(decoded.length);
			for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
			if (!hasRasterImageSignature(message.mimeType, bytes) || !hasSafeRasterImageDimensions(message.mimeType, bytes)) {
				throw new Error('Invalid raster image.');
			}
			const uri = URL.createObjectURL(new Blob([bytes], { type: message.mimeType }));
			objectUrls.add(uri);
			request.resolve(uri);
		} catch {
			request.reject(new Error(t('image.unavailable')));
		}
	} else request.reject(new Error(message.error ?? t('image.unavailable')));
	return true;
}

export function clearLocalImageCache(): void {
	cache.clear();
	for (const uri of objectUrls) URL.revokeObjectURL(uri);
	objectUrls.clear();
	for (const request of pending.values()) {
		clearTimeout(request.timer);
		request.reject(new Error(t('image.unavailable')));
	}
	pending.clear();
}
