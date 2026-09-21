import type { DefaultEditorSetting } from './messages';

/**
 * Decides whether a verified local resource should be opened in this
 * extension's custom editor. Attachments deliberately remain with VS Code's
 * normal opener even when Live Preview is the preferred Markdown editor.
 */
export function shouldOpenInLivePreview(
	path: string,
	defaultEditor: DefaultEditorSetting | string | undefined,
): boolean {
	return defaultEditor === 'livePreview' && /\.(?:md|markdown)$/i.test(path);
}
