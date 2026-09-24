import type { HeadingItem } from './headings';

export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

export interface CodeToken {
	from: number;
	to: number;
	style: string;
}

export interface CodeBlockTokens {
	from: number;
	to: number;
	tokens: CodeToken[];
}

export type RemoteMediaPolicy = 'block' | 'https';
export const EDITOR_PROTOCOL_VERSION = 1;

export interface VaultNoteSummary {
	path: string;
	basename: string;
	aliases: string[];
	headings: Array<{ text: string; line: number }>;
	blockIds: string[];
}

export interface PastedImagePayload {
	mimeType: string;
	dataBase64: string;
}

export type HostToEditorMessage =
	| { type: 'draftPreserved'; requestId: number; ok: boolean }
	| { type: 'setWhitespace'; enabled: boolean }
	| { type: 'copyCodeResult'; requestId: number; ok: boolean }
	| {
			type: 'init';
			protocolVersion: typeof EDITOR_PROTOCOL_VERSION;
			text: string;
			version: number;
			css: string;
			codeTheme: string;
			remoteMedia: RemoteMediaPolicy;
			workspaceTrusted: boolean;
			diagramRenderingAllowed: boolean;
			editingMode: EditingModeSetting;
			vaultNotes: VaultNoteSummary[];
			currentVaultPath: string;
	  }
	| { type: 'externalUpdate'; changes: TextChange[]; version: number }
	| { type: 'ackEdit'; version: number }
	| { type: 'codeTokens'; blocks: CodeBlockTokens[] }
	| { type: 'applyCss'; css: string }
	| { type: 'jumpToLine'; line: number }
	// Reply to `readDrawioFile`. `text` is the file's contents, or `error` says
	// why it could not be read; exactly one of the two is set. `requestId`
	// matches the reply to the widget that asked, since several diagrams in one
	// document can have requests in flight at the same time.
	| { type: 'drawioFile'; requestId: number; text?: string; error?: string }
	| { type: 'invalidateDrawioFiles' }
	| { type: 'wikiEmbed'; requestId: number; sourcePath?: string; text?: string; error?: string }
	| { type: 'localImage'; requestId: number; mimeType?: string; dataBase64?: string; error?: string }
	| { type: 'setCursor'; pos: number }
	| { type: 'vaultNotes'; notes: VaultNoteSummary[] }
	| { type: 'vaultNotesChunk'; generation: number; offset: number; total: number; notes: VaultNoteSummary[] };

export type EditorToHostMessage =
	| { type: 'draftSnapshot'; text: string; baselineText: string; requiresSeparatePreservation?: true }
	| { type: 'checkpoint'; requestId: number; text: string; baselineText: string }
	| { type: 'preserveDraft'; requestId: number; text: string }
	| { type: 'resync' }
	| { type: 'save' }
	| { type: 'copyCode'; requestId: number; text: string }
	| { type: 'ready' }
	| { type: 'edit'; baseVersion: number; changes: TextChange[] }
	| { type: 'undo' }
	| { type: 'redo' }
	| { type: 'openLink'; href: string }
	| { type: 'pasteImage'; atPos: number; mimeType: string; dataBase64: string; needsOwnParagraph: boolean }
	| { type: 'pasteImages'; atPos: number; images: PastedImagePayload[]; needsOwnParagraph: boolean }
	// A `![](diagram.drawio)` reference: the webview cannot read workspace files
	// itself, and an <img> cannot render mxGraph XML, so the host reads the file
	// and sends its text back for the widget to parse. `src` is the raw, relative
	// path exactly as written in the Markdown; the host resolves it.
	| { type: 'readDrawioFile'; requestId: number; src: string }
	| { type: 'readWikiEmbed'; requestId: number; body: string; contextPath: string }
	| { type: 'resolveLocalImage'; requestId: number; src: string; contextPath: string };

export interface StyleEntry {
	id: string;
	name: string;
	enabled: boolean;
	/** Raw CSS content, used by the sidebar to render a live preview thumbnail. */
	css: string;
}

/** The extension settings the sidebar surfaces and can change. */
export type DefaultEditorSetting =
	| 'prompt'
	| 'textEditor'
	| 'markdownPreview'
	| 'vscodeMarkdownEditor'
	| 'markdownEditor'
	| 'livePreview';
export type EditingModeSetting = 'editing' | 'locked';
export type CodeThemeSetting = 'auto' | 'dark-plus' | 'light-plus' | 'github-dark' | 'github-light';
export type VaultOpenBehaviorSetting = 'reuseTab' | 'newTab';
export interface SidebarSettings {
	showWhitespace: 'off' | 'on';
	defaultEditor: DefaultEditorSetting;
	defaultEditingMode: EditingModeSetting;
	codeTheme: CodeThemeSetting;
	vaultOpenBehavior: VaultOpenBehaviorSetting;
}

/** Which VS Code theme is active, so previews gate `body.vscode-*` rules correctly. */
export type ThemeKind = 'vscode-light' | 'vscode-dark' | 'vscode-high-contrast';

export type HostToSidebarMessage = {
	type: 'init';
	styles: StyleEntry[];
	settings: SidebarSettings;
	themeKind: ThemeKind;
	workspaceTrusted: boolean;
};

export type SidebarToHostMessage =
	| { type: 'ready' }
	| { type: 'toggle'; id: string; enabled: boolean }
	| { type: 'newStyle' }
	| { type: 'openStyle'; id: string }
	| { type: 'duplicateStyle'; id: string }
	| { type: 'renameStyle'; id: string }
	| { type: 'deleteStyle'; id: string }
	| { type: 'setSetting'; key: keyof SidebarSettings; value: string };

// Live CSS-theme preview panel (opened beside the CSS file while editing it).
export type HostToPreviewMessage =
	| { type: 'update'; css: string; themeKind: ThemeKind; name: string }
	// Glow the preview elements matching the selector of the rule under the cursor
	// (null clears the highlight).
	| { type: 'highlight'; selector: string | null };
export type PreviewToHostMessage = { type: 'ready' };

// Outline (heading list) sidebar view.
export type HostToOutlineMessage =
	| { type: 'update'; headings: HeadingItem[] }
	// No Markdown Live Preview panel is currently active (none open, or focus
	// moved away from any of them).
	| { type: 'noDocument' };

export type OutlineToHostMessage = { type: 'ready' } | { type: 'jumpToHeading'; line: number };
