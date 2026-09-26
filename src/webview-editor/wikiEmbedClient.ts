import type { HostToEditorMessage } from '../shared/messages';
import { t } from '../shared/i18n';

export interface WikiEmbedResult { sourcePath: string; text: string }
type Pending = { resolve: (result: WikiEmbedResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<number, Pending>();
const cache = new Map<string, Promise<WikiEmbedResult>>();
let nextRequestId = 1;
let post: ((message: unknown) => void) | undefined;
const MAX_PENDING_EMBEDS = 8;
const EMBED_REQUEST_TIMEOUT_MS = 10_000;

export function setWikiEmbedPoster(poster: (message: unknown) => void): void { post = poster; }

export function readWikiEmbed(body: string, contextPath: string): Promise<WikiEmbedResult> {
	// Relative links are resolved from the containing note, not just their visible label.
	const key = `${contextPath}\0${body}`;
	const existing = cache.get(key);
	if (existing) return existing;
	const promise = new Promise<WikiEmbedResult>((resolve, reject) => {
		if (!post) return reject(new Error(t('embed.noConnection')));
		if (pending.size >= MAX_PENDING_EMBEDS) return reject(new Error(t('embed.tooMany')));
		const requestId = nextRequestId++;
		const timer = setTimeout(() => {
			pending.delete(requestId);
			reject(new Error(t('embed.timeout')));
		}, EMBED_REQUEST_TIMEOUT_MS);
		pending.set(requestId, { resolve, reject, timer });
		post!({ type: 'readWikiEmbed', requestId, body, contextPath });
	});
	promise.catch(() => cache.delete(key));
	cache.set(key, promise);
	return promise;
}

export function handleWikiEmbedMessage(message: HostToEditorMessage): boolean {
	if (message.type !== 'wikiEmbed') return false;
	const request = pending.get(message.requestId);
	if (!request) return true;
	pending.delete(message.requestId);
	clearTimeout(request.timer);
	if (typeof message.text === 'string' && typeof message.sourcePath === 'string') {
		request.resolve({ sourcePath: message.sourcePath, text: message.text });
	} else request.reject(new Error(message.error ?? t('embed.readFailed')));
	return true;
}

export function clearWikiEmbedCache(): void {
	cache.clear();
	// Reject old promises as well as cached results when switching document context.
	for (const request of pending.values()) {
		clearTimeout(request.timer);
		request.reject(new Error(t('embed.readFailed')));
	}
	pending.clear();
}
