import type { EditorToHostMessage, HostToEditorMessage } from '../shared/messages';
import { validateHostToEditorMessage } from '../shared/messageValidation';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();
let documentLength = 0;

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
		if (parsed.value.type === 'init') documentLength = parsed.value.text.length;
		if (parsed.value.type === 'externalUpdate') {
			for (const change of parsed.value.changes) documentLength += change.insert.length - (change.to - change.from);
		}
		handler(parsed.value);
	});
}
