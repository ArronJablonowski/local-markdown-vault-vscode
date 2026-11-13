import type { EditorToHostMessage, HostToEditorMessage } from '../shared/messages';
import { validateHostToEditorMessage } from '../shared/messageValidation';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Share one private bridge; widgets receive callbacks instead of the privileged API object.
const api = acquireVsCodeApi();
let documentLength = 0;
// This identity changes only when the JavaScript context is recreated.
const instanceId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
let initialized = false;
let readyTimer: ReturnType<typeof setTimeout> | undefined;
let readyAttempts = 0;

/** Retry a lost/throttled startup message without resetting an initialized editor. */
export function announceReady(): void {
	if (initialized || readyAttempts >= 4) return;
	readyAttempts++;
	if (readyAttempts < 4) readyTimer = setTimeout(announceReady, 2000);
	postToHost({ type: 'ready', instanceId });
}

export function getWebviewState(): unknown {
	return api.getState();
}

export function setWebviewState(state: unknown): void {
	api.setState(state);
}

export function postToHost(message: EditorToHostMessage): void {
	api.postMessage(message);
	// Local edits already exist in the renderer, so subsequent host undo and
	// token ranges must be validated against the updated protocol document.
	if (message.type === 'edit') {
		for (const change of message.changes) documentLength += change.insert.length - (change.to - change.from);
	}
}

export function onHostMessage(handler: (message: HostToEditorMessage) => void): void {
	window.addEventListener('message', (event: MessageEvent<unknown>) => {
		const parsed = validateHostToEditorMessage(event.data, documentLength);
		if (!parsed.ok) return;
		if (parsed.value.type === 'init') {
			documentLength = parsed.value.text.length;
			initialized = true;
			if (readyTimer !== undefined) clearTimeout(readyTimer);
		}
		if (parsed.value.type === 'externalUpdate') {
			for (const change of parsed.value.changes) documentLength += change.insert.length - (change.to - change.from);
		}
		handler(parsed.value);
	});
}
