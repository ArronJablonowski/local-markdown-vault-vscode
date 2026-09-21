import type { DefaultEditorSetting } from './messages';

export const DEFAULT_EDITOR_SETTINGS: readonly DefaultEditorSetting[] = [
	'prompt',
	'textEditor',
	'markdownPreview',
	'markdownEditor',
	'livePreview',
];

/** Converts the pre-0.2.0 `default` value, whose UI promised Markdown Editor. */
export function normalizeDefaultEditorSetting(value: string | undefined): DefaultEditorSetting {
	if (value === 'default') return 'markdownEditor';
	return DEFAULT_EDITOR_SETTINGS.includes(value as DefaultEditorSetting)
		? value as DefaultEditorSetting
		: 'prompt';
}

/** Returns the VS Code editor view type for an explicit viewing-mode choice. */
export function editorViewType(value: string | undefined): string | undefined {
	switch (normalizeDefaultEditorSetting(value)) {
		case 'textEditor': return 'default';
		case 'markdownPreview': return 'vscode.markdown.preview.editor';
		case 'markdownEditor': return 'vscode.markdown.editor';
		case 'livePreview': return 'mdLivePreview.editor';
		default: return undefined;
	}
}

export function configuredEditorViewTypeForPath(
	path: string,
	defaultEditor: DefaultEditorSetting | string | undefined,
): string | undefined {
	return /\.(?:md|markdown)$/i.test(path) ? editorViewType(defaultEditor) : undefined;
}

/**
 * Decides whether a verified local resource should be opened in this
 * extension's custom editor. Attachments deliberately remain with VS Code's
 * normal opener even when Live Preview is the preferred Markdown editor.
 */
export function shouldOpenInLivePreview(
	path: string,
	defaultEditor: DefaultEditorSetting | string | undefined,
): boolean {
	return configuredEditorViewTypeForPath(path, defaultEditor) === 'mdLivePreview.editor';
}
