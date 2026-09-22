import { EditorState, Annotation, type Extension, ChangeSet, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab, temporarilySetTabFocusMode } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
	search,
	closeSearchPanel,
	searchKeymap,
	findNext,
	findPrevious,
	selectNextOccurrence,
} from '@codemirror/search';
import { insertNewlineContinueMarkupCommand, markdown } from '@codemirror/lang-markdown';
import { GFM } from './gfmTableFix';
import {
	livePreviewPlugin,
	createLinkClickHandler,
	setRemoteMediaPolicy,
} from './livePreviewPlugin';
import { codeHighlightExtension, setCodeTokens } from './codeHighlightPlugin';
import { blockDecorationsField, dragReleaseRefresh } from './blockDecorations';
import { detectFrontmatter } from './frontmatterWidget';
import { headingSpaceInputHandler } from './headingSpacePlugin';
import { backtickInputHandler } from './backtickPairPlugin';
import { toggleEmphasisCommand } from './emphasisShortcuts';
import { createImagePasteHandler, type ImagePasteRejection } from './imagePasteHandler';
import { getWebviewState, postToHost, onHostMessage, setWebviewState } from './vscodeApi';
import { setDrawioFilePoster, handleDrawioFileMessage, clearDrawioFileCache } from './drawioFileClient';
import {
	searchRevealExtension,
	markingSearchSelection,
	openSearchPanelFocused,
} from './searchReveal';
import { t } from '../shared/i18n';
import { adaptMarkdownCss, sanitizePreviewCss, scopePreviewCss } from '../shared/cssAdapter';
import type { TextChange, VaultNoteSummary } from '../shared/messages';
import { setDiagramRenderingAllowed } from './diagramLang';
import { mathDecorationsField } from './math';
import { footnoteDecorations } from './footnotes';
import { setVaultNotes, setWikilinkOpener, wikilinkCompletionExtension, wikilinkDecorations } from './wikilinks';
import { clearWikiEmbedCache, handleWikiEmbedMessage, setWikiEmbedPoster } from './wikiEmbedClient';
import { clearLocalImageCache, handleLocalImageMessage, setLocalImageContext, setLocalImagePoster } from './localImageClient';
import { tagDecorations } from './tags';
import { makePersistedEditorState, parsePersistedEditorState } from './persistedState';
import {
	escapeFencedCode,
	exitFencedCodeOnBlankLine,
} from './codeFenceEditing';
import { escapeInlineHighlight, exitInlineHighlightOnEnter } from './inlineHighlightEditing';
import { insertSoftLineBreak } from './softLineBreak';
import { deleteFullySelectedFencedCode } from './blockSelection';
import { exitEmptyMarkdownSection } from './sectionEditing';
import { handleCodeClipboardResult, setCodeClipboardPoster } from './codeClipboard';

const remoteChange = Annotation.define<boolean>();
const FLUSH_DEBOUNCE_MS = 250;
// Match Obsidian's list editing: continue list and task markers on Enter, but
// leave a list immediately when its current item is empty. CodeMirror's default
// inserts an extra blank line before leaving a two-item tight list.
const continueMarkdownMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

let view: EditorView | undefined;
let baseVersion = 0;
let pending: ChangeSet | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let workspaceTrusted = false;
let vaultNotesChunkGeneration = -1;
let pendingVaultNoteChunks: VaultNoteSummary[] = [];
let editingAllowed = true;
let initialEditingModeReceived = false;
let modeButton: HTMLButtonElement | undefined;
const editingCompartment = new Compartment();

function flush() {
	flushTimer = undefined;
	if (!view || !pending || pending.empty) {
		pending = null;
		return;
	}
	const changes: TextChange[] = [];
	pending.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		changes.push({ from: fromA, to: toA, insert: inserted.toString() });
	});
	pending = null;
	postToHost({ type: 'edit', baseVersion, changes });
}

function scheduleFlush() {
	if (flushTimer) clearTimeout(flushTimer);
	flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
}

function flushNow() {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = undefined;
	}
	flush();
}

function applyUserCss(css: string) {
	let styleEl = document.getElementById('mlp-user-css') as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = 'mlp-user-css';
		document.head.appendChild(styleEl);
	}
	const sanitized = sanitizePreviewCss(css);
	styleEl.textContent = scopePreviewCss(adaptMarkdownCss(sanitized.css));
	setCssDiagnostic(sanitized.rejected);
}

function setImagePasteDiagnostic(reason?: ImagePasteRejection): void {
	let warning = document.getElementById('mlp-image-paste-warning');
	if (!warning) {
		warning = document.createElement('div');
		warning.id = 'mlp-image-paste-warning';
		warning.setAttribute('role', 'alert');
		document.body.appendChild(warning);
	}
	if (!reason) {
		warning.hidden = true;
		warning.textContent = '';
		return;
	}
	const messages: Record<ImagePasteRejection, Parameters<typeof t>[0]> = {
		unsupported: 'imagePaste.unsupported',
		empty: 'imagePaste.empty',
		tooMany: 'imagePaste.tooMany',
		tooLarge: 'imagePaste.tooLarge',
		unreadable: 'imagePaste.unreadable',
	};
	warning.textContent = t(messages[reason]);
	warning.hidden = false;
}

function setCssDiagnostic(rejected: boolean): void {
	let warning = document.getElementById('mlp-css-warning');
	if (!warning) {
		warning = document.createElement('div');
		warning.id = 'mlp-css-warning';
		warning.setAttribute('role', 'status');
		warning.setAttribute('aria-live', 'polite');
		warning.textContent = t('css.unsafeIgnored');
		document.body.appendChild(warning);
	}
	warning.hidden = !rejected;
}

function persistEditorUiState() {
	if (!view) return;
	const { anchor, head } = view.state.selection.main;
	const state = makePersistedEditorState(anchor, head, view.scrollDOM.scrollTop);
	if (state) setWebviewState(state);
}

function createExtensions(): Extension[] {
	const markdownSupport = markdown({ extensions: GFM });
	return [
		// Locked mode is enforced at the transaction boundary, not just by hiding
		// the caret. This also blocks edits dispatched by rendered task, property,
		// and table controls while still allowing authoritative host updates.
		EditorState.transactionFilter.of((transaction) =>
			editingAllowed || !transaction.docChanged || transaction.annotation(remoteChange)
				? transaction
				: [],
		),
		editingCompartment.of(EditorView.editable.of(editingAllowed)),
		markdownSupport,
		// Extend closeBrackets' default pair set (`( [ { ' "`) with the emphasis
		// marks so `*bold/italic*` and `_italic_` also auto-pair and wrap a
		// selection when typed — the same mechanism VS Code and most editors use
		// for quotes. Backtick is deliberately left out here: it's handled by its
		// own `backtickInputHandler` below (see that file for why).
		markdownSupport.language.data.of({ closeBrackets: { brackets: ['(', '[', '{', "'", '"', '*', '_'] } }),
		closeBrackets(),
		headingSpaceInputHandler,
		backtickInputHandler,
		livePreviewPlugin,
		wikilinkDecorations,
		wikilinkCompletionExtension,
		tagDecorations,
		blockDecorationsField,
		mathDecorationsField,
		footnoteDecorations,
		dragReleaseRefresh,
		codeHighlightExtension,
		Prec.highest(createLinkClickHandler((href) => postToHost({ type: 'openLink', href }))),
		createImagePasteHandler(
			(atPos, images, needsOwnParagraph) => {
				if (!editingAllowed) return;
				setImagePasteDiagnostic();
				postToHost({ type: 'pasteImages', atPos, images, needsOwnParagraph });
			},
			setImagePasteDiagnostic,
		),
		// Without this a state keeps only one selection range, so Mod-d's
		// multi-cursor search silently collapses to a single cursor — and the
		// multiple-cursor behavior Ctrl+B/Ctrl+I already document never had a way
		// to arise. `drawSelection` renders the extra carets, which the browser's
		// native selection cannot show.
		EditorState.allowMultipleSelections.of(true),
		drawSelection(),
		// Search matches the raw Markdown, which is what the file actually holds —
		// so `](url)` and a table's pipes are findable even while the preview
		// hides them. `searchRevealExtension` is what makes a match inside hidden
		// syntax actually show itself; see that file.
		search({ top: true }),
		searchRevealExtension,
		Prec.highest(keymap.of([
			{ key: 'Backspace', run: deleteFullySelectedFencedCode },
			{ key: 'Delete', run: deleteFullySelectedFencedCode },
			{
				// Obsidian uses Shift+Enter for a continuation inside the current
				// paragraph/list item. It inserts no new bullet, number, or checkbox.
				key: 'Shift-Enter',
				run: insertSoftLineBreak,
			},
			{
				key: 'Enter',
				run: (editor) => exitFencedCodeOnBlankLine(editor)
					|| exitInlineHighlightOnEnter(editor)
					|| exitEmptyMarkdownSection(editor)
					|| continueMarkdownMarkup(editor),
			},
			{
				key: 'Mod-Enter',
				run: (editor) => escapeFencedCode(editor) || escapeInlineHighlight(editor),
			},
		])),
		// The panel builds its own labels, so they are localized through
		// CodeMirror's phrases facet rather than by rendering them ourselves.
		EditorState.phrases.of({
			Find: t('search.find'),
			Replace: t('search.replace'),
			next: t('search.next'),
			previous: t('search.previous'),
			all: t('search.all'),
			'match case': t('search.matchCase'),
			regexp: t('search.regexp'),
			'by word': t('search.byWord'),
			replace: t('search.replaceButton'),
			'replace all': t('search.replaceAll'),
			close: t('search.close'),
			'current match': t('search.currentMatch'),
			'Go to line': t('search.gotoLine'),
			go: t('search.go'),
			'on line': t('search.onLine'),
		}),
		keymap.of([
			...closeBracketsKeymap,
			// Bound ahead of the defaults below so Mod-f reaches the panel rather
			// than any other handler, and so each jump can mark its selection as a
			// search match. Replace has no default binding in searchKeymap; VS Code
			// puts it on Mod-Alt-f, and the panel carries both fields either way.
			{ key: 'Mod-f', run: openSearchPanelFocused },
			{ key: 'Mod-Alt-f', run: openSearchPanelFocused },
			{ key: 'F3', run: markingSearchSelection(findNext), shift: markingSearchSelection(findPrevious) },
			{ key: 'Mod-g', run: markingSearchSelection(findNext), shift: markingSearchSelection(findPrevious) },
			{ key: 'Mod-d', run: markingSearchSelection(selectNextOccurrence) },
			// Escape closes the panel; it must not swallow the key when no panel is
			// open, so `closeSearchPanel`'s own false return is passed through.
			{ key: 'Escape', run: closeSearchPanel },
			// While focus is inside the panel the editor's own keymap never sees the
			// key: the panel routes what it receives through the "search-panel"
			// scope, which only these bindings serve. Without them Escape did
			// nothing once the field had focus.
			...searchKeymap.filter((binding) => binding.key === 'Escape'),
			// Flush any not-yet-sent keystrokes before asking the host to undo/redo —
			// otherwise the host's document is missing the latest edits when it acts,
			// undoing the wrong change and leaving the webview's local text duplicated
			// relative to what ends up in the file.
			{ key: 'Mod-z', run: () => { if (editingAllowed) { flushNow(); postToHost({ type: 'undo' }); } return true; } },
			{ key: 'Mod-y', run: () => { if (editingAllowed) { flushNow(); postToHost({ type: 'redo' }); } return true; } },
			{ key: 'Mod-Shift-z', run: () => { if (editingAllowed) { flushNow(); postToHost({ type: 'redo' }); } return true; } },
			{ key: 'Mod-b', run: toggleEmphasisCommand('**') },
			{ key: 'Mod-i', run: toggleEmphasisCommand('*') },
			indentWithTab,
			...defaultKeymap,
			// Tab indents Markdown, matching the requested Obsidian-style editing
			// behavior. Once the default Escape actions have had a chance to close a
			// panel or simplify a selection, a further Escape temporarily releases
			// Tab to the browser so keyboard users can reach rendered controls and
			// then leave the webview without a focus trap.
			{ key: 'Escape', run: temporarilySetTabFocusMode },
		]),
		EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				const isRemote = update.transactions.some((tr) => tr.annotation(remoteChange));
				if (!isRemote) {
					pending = pending ? pending.compose(update.changes) : update.changes;
					scheduleFlush();
				}
			}
			if (update.docChanged || update.selectionSet || update.viewportChanged) persistEditorUiState();
		}),
		EditorView.domEventHandlers({
			blur: () => { flushNow(); persistEditorUiState(); },
		}),
		EditorView.lineWrapping,
	];
}

function updateEditingModeUi(): void {
	const root = document.getElementById('mlp-root');
	root?.classList.toggle('mlp-editor-locked', !editingAllowed);
	if (!modeButton) return;
	const label = editingAllowed ? t('editor.mode.editing') : t('editor.mode.locked');
	modeButton.querySelectorAll<HTMLElement>('[data-editing-mode]').forEach((segment) => {
		segment.classList.toggle('is-selected', segment.dataset.editingMode === (editingAllowed ? 'editing' : 'locked'));
	});
	modeButton.title = label;
	modeButton.setAttribute('aria-label', label);
	modeButton.setAttribute('aria-pressed', String(!editingAllowed));
}

function setEditingAllowed(next: boolean): void {
	if (editingAllowed === next) {
		updateEditingModeUi();
		return;
	}
	if (!next) flushNow();
	editingAllowed = next;
	view?.dispatch({ effects: editingCompartment.reconfigure(EditorView.editable.of(editingAllowed)) });
	updateEditingModeUi();
}

function ensureEditingModeButton(): void {
	if (modeButton) return;
	modeButton = document.createElement('button');
	modeButton.type = 'button';
	modeButton.className = 'mlp-editing-mode-toggle';
	// Fixed local vector icons, never document-derived markup. Keep one native
	// toggle button so Space/Enter and its existing accessible state still work.
	for (const [mode, paths] of [
		['locked', ['M5 7V5a3 3 0 0 1 6 0v2', 'M4 7h8v7H4z', 'M8 10v1']],
		['editing', ['M3 10.5 10.5 3a1.4 1.4 0 0 1 2.5 2.5L5.5 13 2 14z', 'm9 4.5 2.5 2.5']],
	] as const) {
		const segment = document.createElement('span');
		segment.className = 'mlp-editing-mode-icon';
		segment.dataset.editingMode = mode;
		segment.setAttribute('aria-hidden', 'true');
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('viewBox', '0 0 16 16');
		icon.setAttribute('width', '16');
		icon.setAttribute('height', '16');
		icon.setAttribute('focusable', 'false');
		for (const geometry of paths) {
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', geometry);
			icon.appendChild(path);
		}
		segment.appendChild(icon);
		modeButton.appendChild(segment);
	}
	modeButton.addEventListener('click', () => setEditingAllowed(!editingAllowed));
	document.getElementById('mlp-root')?.appendChild(modeButton);
	updateEditingModeUi();
}

// A fresh EditorState's selection defaults to position 0 — i.e. line 1 — which
// is exactly where a leading frontmatter block's own range starts. Left as-is,
// `cursorTouchesRange` would read that default as "the cursor is touching the
// frontmatter block" and keep it as raw source on every load, never rendering
// the table until the user happened to move the cursor away first. Placing the
// initial selection just past the block (only when one is actually present)
// avoids that without touching the general cursor-reveals-source behavior.
// `fm.to` is the *end of the closing "---" line itself* (correct for the
// decoration range), so it's still on that line — the anchor must go one
// further, past its line break, to actually land outside the block.
function initialStateFor(text: string, persisted = parsePersistedEditorState(getWebviewState(), text.length)): EditorState {
	const state = EditorState.create({
		doc: text,
		selection: persisted ? { anchor: persisted.anchor, head: persisted.head } : undefined,
		extensions: createExtensions(),
	});
	if (persisted) return state;
	const fm = detectFrontmatter(state);
	if (!fm) return state;
	const anchor = Math.min(fm.to + 1, state.doc.length);
	return state.update({ selection: { anchor } }).state;
}

function restoreScrollPosition() {
	if (!view) return;
	const persisted = parsePersistedEditorState(getWebviewState(), view.state.doc.length);
	if (!persisted) return;
	requestAnimationFrame(() => {
		if (view) view.scrollDOM.scrollTop = persisted.scrollTop;
	});
}

function createView(text: string) {
	const root = document.getElementById('mlp-root')!;
	view = new EditorView({
		state: initialStateFor(text),
		parent: root,
	});
	ensureEditingModeButton();
	restoreScrollPosition();
}

function resetView(text: string) {
	if (!view) {
		createView(text);
		return;
	}
	pending = null;
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = undefined;
	}
	view.setState(initialStateFor(text));
	restoreScrollPosition();
}

// The drawio file client cannot reach the host on its own (it is imported by
// widget code that has no business acquiring the VS Code API); hand it the
// poster this module already owns.
setDrawioFilePoster((message) => postToHost(message as Parameters<typeof postToHost>[0]));
setWikilinkOpener((href) => postToHost({ type: 'openLink', href }));
setWikiEmbedPoster((message) => postToHost(message as Parameters<typeof postToHost>[0]));
setLocalImagePoster((message) => postToHost(message as Parameters<typeof postToHost>[0]));

setCodeClipboardPoster(postToHost);
onHostMessage((message) => {
	// `drawioFile` replies are routed to whichever widget requested them, not
	// handled by the switch below.
	if (handleDrawioFileMessage(message)) return;
	if (handleWikiEmbedMessage(message)) return;
	if (handleLocalImageMessage(message)) return;
	switch (message.type) {
		case 'copyCodeResult':
			handleCodeClipboardResult(message.requestId, message.ok);
			break;
		case 'init':
			workspaceTrusted = message.workspaceTrusted;
			baseVersion = message.version;
			vaultNotesChunkGeneration = -1;
			pendingVaultNoteChunks = [];
			setLocalImageContext(message.currentVaultPath);
			setRemoteMediaPolicy(message.remoteMedia);
			setDiagramRenderingAllowed(message.diagramRenderingAllowed);
			if (!initialEditingModeReceived) {
				editingAllowed = message.editingMode === 'editing';
				initialEditingModeReceived = true;
			}
			setVaultNotes(message.vaultNotes, message.currentVaultPath);
			applyUserCss(message.workspaceTrusted ? message.css : '');
			// A re-init means a different document (or the same one reloaded), so
			// files read for the previous one must not be served from cache.
			clearDrawioFileCache();
			clearWikiEmbedCache();
			clearLocalImageCache();
			resetView(message.text);
			updateEditingModeUi();
			break;
		case 'ackEdit':
			baseVersion = message.version;
			break;
		case 'externalUpdate': {
			if (!view) return;
			pending = null;
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			view.dispatch({
				changes: message.changes,
				annotations: remoteChange.of(true),
			});
			baseVersion = message.version;
			clearWikiEmbedCache();
			break;
		}
		case 'codeTokens':
			view?.dispatch({ effects: setCodeTokens.of(message.blocks), annotations: remoteChange.of(true) });
			break;
		case 'applyCss':
			if (workspaceTrusted) applyUserCss(message.css);
			break;
		case 'jumpToLine': {
			if (!view) return;
			const { doc } = view.state;
			if (message.line < 1 || message.line > doc.lines) return;
			const pos = doc.line(message.line).from;
			view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
			view.focus();
			break;
		}
		case 'setCursor': {
			if (!view) return;
			const pos = Math.max(0, Math.min(message.pos, view.state.doc.length));
			view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
			break;
		}
		case 'vaultNotes':
			vaultNotesChunkGeneration = -1;
			pendingVaultNoteChunks = [];
			clearWikiEmbedCache();
			setVaultNotes(message.notes);
			if (view) view.dispatch({ selection: view.state.selection });
			break;
		case 'vaultNotesChunk': {
			if (message.offset === 0) {
				vaultNotesChunkGeneration = message.generation;
				pendingVaultNoteChunks = [];
			}
			if (message.generation !== vaultNotesChunkGeneration || message.offset !== pendingVaultNoteChunks.length) break;
			pendingVaultNoteChunks.push(...message.notes);
			if (pendingVaultNoteChunks.length !== message.total) break;
			const complete = pendingVaultNoteChunks;
			pendingVaultNoteChunks = [];
			clearWikiEmbedCache();
			setVaultNotes(complete);
			if (view) view.dispatch({ selection: view.state.selection });
			break;
		}
	}
});

postToHost({ type: 'ready' });
