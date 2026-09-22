import { MAX_EDITOR_MESSAGE_TEXT_BYTES } from '../shared/messageValidation';
import type { EditorToHostMessage } from '../shared/messages';

let nextRequestId = 0;
let pending: { id: number; finish: (ok: boolean) => void } | undefined;
let post: ((message: EditorToHostMessage) => void) | undefined;

export function setCodeClipboardPoster(poster: (message: EditorToHostMessage) => void): void { post = poster; }

export function handleCodeClipboardResult(requestId: number, ok: boolean): void {
	if (pending?.id === requestId) pending.finish(ok);
}

/** One bounded clipboard write at a time; only the host confirms success. */
export function copyCodeToClipboard(text: string): Promise<boolean> {
	if (!post || pending || text.length > MAX_EDITOR_MESSAGE_TEXT_BYTES
		|| new TextEncoder().encode(text).byteLength > MAX_EDITOR_MESSAGE_TEXT_BYTES) return Promise.resolve(false);
	return new Promise((resolve) => {
		const id = ++nextRequestId;
		const timer = setTimeout(() => finish(false), 5_000);
		const finish = (ok: boolean) => {
			clearTimeout(timer);
			pending = undefined;
			resolve(ok);
		};
		pending = { id, finish };
		try { post!({ type: 'copyCode', requestId: id, text }); }
		catch { finish(false); }
	});
}
