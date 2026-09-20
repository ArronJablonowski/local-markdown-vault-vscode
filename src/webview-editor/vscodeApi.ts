import type { EditorToHostMessage, HostToEditorMessage } from '../shared/messages';
import { validateHostToEditorMessage } from '../shared/messageValidation';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function getWebviewState(): unknown {
	return api.getState();
}

export function setWebviewState(state: unknown): void {
	api.setState(state);
}

export function postToHost(message: EditorToHostMessage): void {
	api.postMessage(message);
}

export function onHostMessage(handler: (message: HostToEditorMessage) => void): void {
	let documentLength = 0;
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
