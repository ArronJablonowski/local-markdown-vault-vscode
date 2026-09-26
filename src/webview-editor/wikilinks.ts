import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { autocompletion } from '@codemirror/autocomplete';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { VaultNoteSummary } from '../shared/messages';
import { isSafeWikiAlias, parseWikiLinkBody, resolveWikiLinkSummary } from '../vault/LinkResolver';
import { readWikiEmbed } from './wikiEmbedClient';
import { renderEmbeddedMarkdown } from './embeddedMarkdown';
import { resolveImageSrcForCurrentPolicy } from './livePreviewPlugin';
import { t } from '../shared/i18n';
import { rebaseEmbeddedLink } from '../shared/embeddedLink';
import { resolveLocalImage } from './localImageClient';
import { isOpenOnlyAttachmentTarget } from '../shared/openOnlyAttachment';
import { emojiCompletions } from './emojiCompletion';
import { refreshPreview } from './previewRefresh';

let vaultNotes: VaultNoteSummary[] = [];
let currentVaultPath = '';
let openWikilink: ((href: string) => void) | undefined;
let embedRevision = 0;
let wikilinkPreviewSequence = 0;
const MAX_WIKILINK_COMPLETIONS = 200;
const MAX_WIKI_IMAGE_DIMENSION = 4096;

export interface WikiImageSize { width: number; height?: number }

/** Parses Obsidian's `|width` and `|widthxheight` image-embed suffixes. */
export function parseWikiImageSize(value: string): WikiImageSize | undefined {
	const match = /^(\d{1,4})(?:[xX](\d{1,4}))?$/.exec(value.trim());
	if (!match) return undefined;
	const width = Number(match[1]);
	const height = match[2] === undefined ? undefined : Number(match[2]);
	if (width < 1 || width > MAX_WIKI_IMAGE_DIMENSION || (height !== undefined && (height < 1 || height > MAX_WIKI_IMAGE_DIMENSION))) {
		return undefined;
	}
	return { width, ...(height === undefined ? {} : { height }) };
}

export function setVaultNotes(notes: VaultNoteSummary[], currentPath = currentVaultPath): void {
	vaultNotes = notes;
	currentVaultPath = currentPath;
	embedRevision++;
}

export function setWikilinkOpener(opener: (href: string) => void): void {
	openWikilink = opener;
}

export const wikilinkCompletionExtension: Extension = autocompletion({
	override: [wikilinkCompletions, emojiCompletions],
	activateOnTyping: true,
	maxRenderedOptions: 100,
});

export function wikilinkCompletions(context: CompletionContext): CompletionResult | null {
	const match = context.matchBefore(/\[\[([^\]\n]*)$/);
	if (!match) return null;
	// Bracket pairs in code, HTML, and link destinations are literal content,
	// not requests to insert a vault note. A completion there could consume
	// Enter and replace code the user is still writing.
	for (let node = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent!) {
		if (/Code|HTML/.test(node.name) || node.name === 'URL') return null;
		// Auto-paired closing brackets make Markdown parse [[Note]] as the
		// shorthand Link [Note] inside an extra pair of brackets. ![[Note]]
		// likewise gets a shorthand Image parent. These are the wikilink being
		// completed, not an enclosing Markdown link/image destination.
		if (node.name === 'Link' && (node.from !== match.from + 1 || node.getChild('URL'))) return null;
		if (node.name === 'Image' && (node.from !== match.from - 1 || node.getChild('URL'))) return null;
	}
	const body = match.text.slice(2);
	if (body.includes('|')) return null;
	const headingAt = body.indexOf('#');
	const blockAt = body.indexOf('^');
	const separatorAt = headingAt < 0 ? blockAt : blockAt < 0 ? headingAt : Math.min(headingAt, blockAt);
	if (separatorAt >= 0) {
		const noteTarget = body.slice(0, separatorAt);
		const resolution = resolveWikiLinkSummary(noteTarget || currentVaultPath, vaultNotes);
		if (resolution.kind !== 'resolved') return { from: match.from + 2 + separatorAt + 1, options: [] };
		const fragmentQuery = body.slice(separatorAt + 1);
		const options = fragmentCompletionOptions(body[separatorAt] === '^' ? 'block' : 'heading', fragmentQuery, resolution.note);
		// Recompute on each typed character. Returning a capped empty-query list
		// with `validFor` would let CodeMirror reuse only those first 200 entries,
		// making later headings or block IDs permanently undiscoverable.
		return { from: match.from + 2 + separatorAt + 1, options };
	}

	const options = noteCompletionOptions(body, vaultNotes);
	// Deliberately omit `validFor`: rebuilding on each typed character lets a
	// bounded result set discover an alias or deep path anywhere in a 10k-note
	// vault instead of permanently reusing the first 200 empty-query options.
	return { from: match.from + 2, options };
}

export function noteCompletionOptions(body: string, notes: readonly VaultNoteSummary[]): Completion[] {
	const basenameCounts = new Map<string, number>();
	for (const note of notes) {
		const key = note.basename.toLocaleLowerCase();
		basenameCounts.set(key, (basenameCounts.get(key) ?? 0) + 1);
	}
	const query = body.trim().toLocaleLowerCase();
	const options: Completion[] = [];
	const push = (option: Completion): boolean => {
		options.push(option);
		return options.length >= MAX_WIKILINK_COMPLETIONS;
	};
	for (const note of notes) {
		const pathWithoutExtension = note.path.replace(/\.(?:md|markdown)$/i, '');
		const shortestTarget = basenameCounts.get(note.basename.toLocaleLowerCase()) === 1
			? note.basename
			: pathWithoutExtension;
		const safeAliases = note.aliases.filter(isSafeWikiAlias);
		const basenameMatch = !query || note.basename.toLocaleLowerCase().includes(query);
		const pathMatch = query && pathWithoutExtension.toLocaleLowerCase().includes(query);
		const matchingAliases = query
			? safeAliases.filter((alias) => alias.toLocaleLowerCase().includes(query))
			: [];

		for (const alias of matchingAliases) {
			if (push({
				...completion(alias, 'text', `${shortestTarget}|${alias}`),
				detail: `${note.path} · ${t('completion.aliasFor', note.basename)}`,
				boost: alias.toLocaleLowerCase().startsWith(query) ? 20 : 12,
			})) return options;
		}
		if (basenameMatch || matchingAliases.length) {
			if (push({
				...completion(shortestTarget, 'file'),
				displayLabel: note.basename,
				detail: [note.path, safeAliases.length ? t('completion.aliases', safeAliases.join(', ')) : ''].filter(Boolean).join(' · '),
				boost: note.basename.toLocaleLowerCase().startsWith(query) ? 10 : 0,
			})) return options;
		}
		if (pathMatch && pathWithoutExtension !== shortestTarget) {
			if (push({
				...completion(pathWithoutExtension, 'file'),
				displayLabel: note.basename,
				detail: note.path,
				boost: pathWithoutExtension.toLocaleLowerCase().startsWith(query) ? 8 : 0,
			})) return options;
		}
	}
	return options;
}

export function fragmentCompletionOptions(
	kind: 'heading' | 'block',
	queryText: string,
	note: VaultNoteSummary,
): Completion[] {
	const query = queryText.trim().toLocaleLowerCase();
	const options: Completion[] = [];
	if (kind === 'block') {
		for (const id of note.blockIds) {
			const normalized = id.toLocaleLowerCase();
			if (query && !normalized.includes(query)) continue;
			options.push({ ...completion(id, 'reference'), boost: normalized.startsWith(query) ? 10 : 0 });
			if (options.length >= MAX_WIKILINK_COMPLETIONS) break;
		}
		return options;
	}
	for (const heading of note.headings) {
		const normalized = heading.text.toLocaleLowerCase();
		if (query && !normalized.includes(query)) continue;
		options.push({
			...completion(heading.text, 'text'),
			detail: t('completion.line', String(heading.line)),
			boost: normalized.startsWith(query) ? 10 : 0,
		});
		if (options.length >= MAX_WIKILINK_COMPLETIONS) break;
	}
	return options;
}

function completion(label: string, type: string, insertLabel = label): Completion {
	return {
		label,
		type,
		apply(view, _completion, from, to) {
			const after = view.state.sliceDoc(to, Math.min(to + 2, view.state.doc.length));
			const inserted = after === ']]' ? insertLabel : `${insertLabel}]]`;
			view.dispatch({
				changes: { from, to, insert: inserted },
				selection: { anchor: from + inserted.length },
			});
		},
	};
}

class WikiLinkWidget extends WidgetType {
	constructor(
		private readonly label: string,
		private readonly href: string,
		private readonly className: string,
	) { super(); }
	eq(other: WikiLinkWidget): boolean {
		return this.label === other.label && this.href === other.href && this.className === other.className;
	}
	toDOM(): HTMLElement {
		const link = document.createElement('a');
		link.className = this.className;
		link.textContent = this.label;
		link.dataset.href = this.href;
		link.setAttribute('role', 'link');
		link.tabIndex = 0;
		return link;
	}
	ignoreEvent(): boolean { return false; }
}

class WikiImageEmbedWidget extends WidgetType {
	constructor(private readonly target: string, private readonly alias: string) { super(); }
	eq(other: WikiImageEmbedWidget): boolean { return this.target === other.target && this.alias === other.alias; }
	toDOM(view: EditorView): HTMLElement {
		return createWikiImageElement(this.target, this.alias, currentVaultPath, () => view.requestMeasure());
	}
	ignoreEvent(): boolean { return false; }
}

function createWikiImageElement(
	target: string,
	alias: string,
	contextPath: string,
	onMeasure?: () => void,
): HTMLImageElement {
	const image = document.createElement('img');
	image.className = 'mlp-image mlp-wiki-image-embed';
	const size = parseWikiImageSize(alias);
	image.alt = size ? target : alias || target;
	if (size) {
		image.width = size.width;
		if (size.height !== undefined) image.height = size.height;
	}
	image.classList.add('mlp-image-blocked');
	const normalized = target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
	void resolveLocalImage(`/${normalized}`, contextPath).then((uri) => {
		image.src = uri;
		image.classList.remove('mlp-image-blocked');
		onMeasure?.();
	}).catch(() => undefined);
	const measure = () => onMeasure?.();
	image.addEventListener('load', measure);
	image.addEventListener('error', measure);
	return image;
}

class WikiNoteEmbedWidget extends WidgetType {
	constructor(
		private readonly body: string,
		private readonly revision: number,
		private readonly ancestors: string[],
	) { super(); }
	eq(other: WikiNoteEmbedWidget): boolean {
		return this.body === other.body && this.revision === other.revision &&
			JSON.stringify(this.ancestors) === JSON.stringify(other.ancestors);
	}
	toDOM(view: EditorView): HTMLElement {
		const aside = document.createElement('aside');
		aside.className = 'mlp-wiki-note-embed';
		aside.setAttribute('role', 'group');
		void mountNoteEmbed(aside, this.body, 1, this.ancestors).finally(() => view.requestMeasure());
		return aside;
	}
	ignoreEvent(): boolean { return false; }
}

async function mountNoteEmbed(container: HTMLElement, body: string, depth: number, ancestors: string[]): Promise<void> {
	container.replaceChildren();
	const status = document.createElement('div');
	status.className = 'mlp-wiki-embed-status';
	status.textContent = t('embed.loading');
	container.appendChild(status);
	try {
		const result = await readWikiEmbed(body, ancestors.at(-1) ?? currentVaultPath);
		if (!container.isConnected) return;
		const key = result.sourcePath.toLocaleLowerCase();
		if (ancestors.some((path) => path.toLocaleLowerCase() === key)) {
			showEmbedPlaceholder(container, t('embed.cycle'));
			return;
		}
		container.replaceChildren();
		const source = document.createElement('a');
		source.className = 'mlp-wikilink mlp-wiki-embed-source';
		source.dataset.href = `wikilink:${encodeURIComponent(body)}`;
		source.textContent = result.sourcePath;
		source.setAttribute('role', 'link');
		source.setAttribute('tabindex', '0');
		source.setAttribute('aria-label', t('embed.openSource', result.sourcePath));
		container.appendChild(source);
		const content = document.createElement('div');
		content.className = 'mlp-wiki-embed-content';
		container.appendChild(content);
		renderEmbeddedMarkdown(content, result.text, {
			resolveImageSrc: (src) => resolveEmbeddedImageSrc(src),
			resolveImageSrcAsync: (src) => isPotentialEmbeddedLocalImage(src)
				? resolveLocalImage(src, result.sourcePath)
				: Promise.resolve(undefined),
			resolveLinkHref: (href) => rebaseEmbeddedLink(result.sourcePath, currentVaultPath, href),
			renderNested: (parent, nestedBody) => {
				const parsed = parseWikiLinkBody(nestedBody);
				if (parsed && isWikiRasterTarget(parsed.target)) {
					parent.appendChild(createWikiImageElement(parsed.target, parsed.alias, result.sourcePath));
					return;
				}
				const nested = document.createElement('aside');
				nested.className = 'mlp-wiki-note-embed mlp-wiki-note-embed-nested';
				parent.appendChild(nested);
				if (depth >= 3) showEmbedPlaceholder(nested, t('embed.nestingLimit'));
				else void mountNoteEmbed(nested, nestedBody, depth + 1, [...ancestors, result.sourcePath]);
			},
		});
	} catch {
		if (container.isConnected) showEmbedPlaceholder(container, t('embed.readFailed'));
	}
}

function showEmbedPlaceholder(container: HTMLElement, message: string): void {
	container.replaceChildren();
	const status = document.createElement('div');
	status.className = 'mlp-wiki-embed-status mlp-wiki-embed-error';
	status.setAttribute('role', 'status');
	status.textContent = message;
	container.appendChild(status);
}

function resolveEmbeddedImageSrc(src: string): string | undefined {
	return resolveImageSrcForCurrentPolicy(src);
}

function isPotentialEmbeddedLocalImage(src: string): boolean {
	const trimmed = src.trim();
	return !!trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('\\\\') && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

function buildDecorations(view: EditorView): DecorationSet {
	const ranges: Range<Decoration>[] = [];
	const seen = new Set<number>();
	const frontmatterEnd = frontmatterBoundary(view.state);
	for (const visible of view.visibleRanges) {
		const from = view.state.doc.lineAt(visible.from).from;
		const to = view.state.doc.lineAt(visible.to).to;
		const text = view.state.sliceDoc(from, to);
		for (const match of text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
			const start = from + (match.index ?? 0);
			const end = start + match[0].length;
			if (seen.has(start) || start < frontmatterEnd || isEscaped(view.state, start) || isCode(view.state, start)) continue;
			seen.add(start);
			if (view.state.selection.ranges.some((selection) => selection.from <= end && selection.to >= start)) continue;
			const body = match[2];
			const parsed = parseWikiLinkBody(body);
			if (!parsed) continue;
			const openOnlyAttachment = isOpenOnlyAttachmentTarget(parsed.target);
			const resolved = openOnlyAttachment || resolveWikiLinkSummary(parsed.target || currentVaultPath, vaultNotes).kind === 'resolved';
			const label = parsed.alias || body;
			const className = ['mlp-link', 'mlp-wikilink', match[1] ? 'mlp-wikilink-embed' : '', openOnlyAttachment ? 'mlp-wikilink-open-only' : '', resolved ? '' : 'mlp-wikilink-unresolved']
				.filter(Boolean).join(' ');
			const href = `wikilink:${encodeURIComponent(body)}`;
			const widget = match[1] && isWikiRasterTarget(parsed.target)
				? new WikiImageEmbedWidget(parsed.target, parsed.alias || parsed.target)
				: match[1] && resolved && !openOnlyAttachment
					? new WikiNoteEmbedWidget(body, embedRevision, currentVaultPath ? [currentVaultPath] : [])
					: new WikiLinkWidget(label, href, className);
			ranges.push(Decoration.replace({ widget }).range(start, end));
		}
	}
	return Decoration.set(ranges, true);
}

function isWikiRasterTarget(target: string): boolean {
	return /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(target);
}

function isCode(state: EditorState, position: number): boolean {
	let node = syntaxTree(state).resolveInner(position, 1);
	while (node) {
		if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
		node = node.parent!;
	}
	return false;
}

function isEscaped(state: EditorState, position: number): boolean {
	let slashes = 0;
	for (let index = position - 1; index >= 0 && state.sliceDoc(index, index + 1) === '\\'; index--) slashes++;
	return slashes % 2 === 1;
}

function frontmatterBoundary(state: EditorState): number {
	const first = state.doc.line(1).text.replace(/\r$/, '');
	if (first !== '---') return 0;
	for (let line = 2; line <= Math.min(state.doc.lines, 10_000); line++) {
		if (state.doc.line(line).text.replace(/\r$/, '') === '---') return state.doc.line(line).to;
	}
	return 0;
}

export const wikilinkDecorations = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private hoverTarget: HTMLElement | undefined;
	private hoverPreview: HTMLElement | undefined;
	private pointerTarget: HTMLElement | undefined;
	private focusTarget: HTMLElement | undefined;
	private hoverGeneration = 0;
	private readonly pointer = (event: MouseEvent) => {
		if (event.button !== 0) return;
		const link = (event.target as HTMLElement | null)?.closest('.mlp-wikilink') as HTMLElement | null;
		const href = link?.getAttribute('data-href');
		if (!href) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		openWikilink?.(href);
	};
	private readonly keyboard = (event: KeyboardEvent) => {
		if (event.key !== 'Enter') return;
		const link = (event.target as HTMLElement | null)?.closest('.mlp-wikilink') as HTMLElement | null;
		const href = link?.getAttribute('data-href');
		if (!href) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		openWikilink?.(href);
	};
	private readonly hover = (event: MouseEvent) => {
		const link = (event.target as HTMLElement | null)?.closest('.mlp-wikilink:not(.mlp-wikilink-unresolved):not(.mlp-wikilink-open-only)') as HTMLElement | null;
		if (!link) return;
		this.pointerTarget = link;
		this.syncHoverTarget();
	};
	private readonly unhover = (event: MouseEvent) => {
		const link = (event.target as HTMLElement | null)?.closest('.mlp-wikilink') as HTMLElement | null;
		if (!link || link !== this.pointerTarget || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return;
		this.pointerTarget = undefined;
		this.syncHoverTarget();
	};
	private readonly focus = (event: FocusEvent) => {
		const link = (event.target as HTMLElement | null)?.closest('.mlp-wikilink:not(.mlp-wikilink-unresolved):not(.mlp-wikilink-open-only)') as HTMLElement | null;
		if (!link) return;
		this.focusTarget = link;
		this.syncHoverTarget();
	};
	private readonly blur = (event: FocusEvent) => {
		const link = (event.target as HTMLElement | null)?.closest('.mlp-wikilink') as HTMLElement | null;
		if (!link || link !== this.focusTarget || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return;
		this.focusTarget = undefined;
		this.syncHoverTarget();
	};
	private syncHoverTarget(): void {
		const next = this.focusTarget ?? this.pointerTarget;
		if (next === this.hoverTarget) return;
		this.clearHover();
		if (!next) return;
		this.hoverTarget = next;
		const generation = this.hoverGeneration;
		this.hoverTimer = setTimeout(() => void this.showHover(next, generation), 500);
	}
	private async showHover(link: HTMLElement, generation: number): Promise<void> {
		const href = link.dataset.href;
		if (!href?.startsWith('wikilink:') || link !== this.hoverTarget || generation !== this.hoverGeneration) return;
		let body: string;
		try { body = decodeURIComponent(href.slice('wikilink:'.length)); } catch { return; }
		try {
			const result = await readWikiEmbed(body, currentVaultPath);
			if (link !== this.hoverTarget || generation !== this.hoverGeneration || !link.isConnected) return;
			const preview = document.createElement('div');
			preview.className = 'mlp-wikilink-hover';
			preview.setAttribute('role', 'tooltip');
			preview.id = `mlp-wikilink-preview-${++wikilinkPreviewSequence}`;
			const title = document.createElement('div');
			title.className = 'mlp-wikilink-hover-title';
			title.textContent = result.sourcePath;
			preview.appendChild(title);
			const content = document.createElement('div');
			content.className = 'mlp-wikilink-hover-content';
			preview.appendChild(content);
			renderEmbeddedMarkdown(content, result.text, {
				// A hover must never perform a network request. Local images are also
				// omitted so merely moving the pointer cannot read additional files.
				resolveImageSrc: () => undefined,
				resolveLinkHref: (href) => rebaseEmbeddedLink(result.sourcePath, currentVaultPath, href),
				renderNested: (parent) => {
					const placeholder = document.createElement('div');
					parent.appendChild(placeholder);
					showEmbedPlaceholder(placeholder, t('embed.hoverNested'));
				},
			});
			document.body.appendChild(preview);
			const box = link.getBoundingClientRect();
			const previewBox = preview.getBoundingClientRect();
			preview.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - previewBox.width - 8))}px`;
			preview.style.top = `${Math.max(8, Math.min(box.bottom + 6, window.innerHeight - previewBox.height - 8))}px`;
			link.setAttribute('aria-describedby', preview.id);
			this.hoverPreview = preview;
		} catch { /* Missing or ambiguous notes simply have no preview. */ }
	}
	private clearHover(): void {
		this.hoverGeneration++;
		if (this.hoverTimer) clearTimeout(this.hoverTimer);
		this.hoverTimer = undefined;
		const target = this.hoverTarget;
		const previewId = this.hoverPreview?.id;
		if (target && previewId && target.getAttribute('aria-describedby') === previewId) {
			target.removeAttribute('aria-describedby');
		}
		this.hoverTarget = undefined;
		this.hoverPreview?.remove();
		this.hoverPreview = undefined;
	}
	constructor(private readonly view: EditorView) {
		this.decorations = buildDecorations(view);
		view.dom.addEventListener('mousedown', this.pointer, true);
		view.dom.addEventListener('keydown', this.keyboard, true);
		view.dom.addEventListener('mouseover', this.hover, true);
		view.dom.addEventListener('mouseout', this.unhover, true);
		view.dom.addEventListener('focus', this.focus, true);
		view.dom.addEventListener('blur', this.blur, true);
	}
	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshPreview)))) this.decorations = buildDecorations(update.view);
	}
	destroy() {
		this.view.dom.removeEventListener('mousedown', this.pointer, true);
		this.view.dom.removeEventListener('keydown', this.keyboard, true);
		this.view.dom.removeEventListener('mouseover', this.hover, true);
		this.view.dom.removeEventListener('mouseout', this.unhover, true);
		this.view.dom.removeEventListener('focus', this.focus, true);
		this.view.dom.removeEventListener('blur', this.blur, true);
		this.pointerTarget = undefined;
		this.focusTarget = undefined;
		this.clearHover();
	}
}, { decorations: (plugin) => plugin.decorations });
