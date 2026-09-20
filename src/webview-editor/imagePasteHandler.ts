import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { EditorState } from '@codemirror/state';
import type { PastedImagePayload } from '../shared/messages';
import {
	MAX_PASTED_IMAGE_BYTES,
	MAX_PASTED_IMAGE_COUNT,
	MAX_PASTED_IMAGE_OPERATION_BYTES,
} from '../shared/messageValidation';

export type ImagePasteCallback = (
	atPos: number,
	images: PastedImagePayload[],
	needsOwnParagraph: boolean,
) => void;

export type ImagePasteRejection = 'unsupported' | 'empty' | 'tooMany' | 'tooLarge' | 'unreadable';

export interface InsertionPoint {
	pos: number;
	/** True when `pos` was moved out of a table — the caller should separate
	 * the inserted text from surrounding content with a blank line. */
	needsOwnParagraph: boolean;
}

/**
 * If `pos` sits inside a `Table` block, relocates the insertion point to
 * just after the table instead. Inserting `![](...)` at a raw position
 * inside a table's source gets absorbed as literal cell/row text — it
 * doesn't render as an image, and the malformed row can make the table
 * appear to lose content the next time it's re-parsed (e.g. entering it to
 * edit again). Any other ancestor block (paragraph, list item, blockquote,
 * fenced code) is left alone; only a `Table` is structurally fragile enough
 * for a stray inserted line to corrupt.
 */
export function escapeTable(state: EditorState, pos: number): InsertionPoint {
	let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
	while (node) {
		if (node.name === 'Table') return { pos: node.to, needsOwnParagraph: true };
		node = node.parent;
	}
	return { pos, needsOwnParagraph: false };
}

const SUPPORTED_RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

type ImageFileSelection =
	| { kind: 'none' }
	| { kind: 'invalid'; reason: ImagePasteRejection }
	| { kind: 'valid'; files: File[] };

function validateImageFiles(files: File[], sawImage: boolean): ImageFileSelection {
	if (!sawImage) return { kind: 'none' };
	if (files.length === 0) return { kind: 'invalid', reason: 'unreadable' };
	if (files.length > MAX_PASTED_IMAGE_COUNT) return { kind: 'invalid', reason: 'tooMany' };
	let totalBytes = 0;
	for (const file of files) {
		if (!SUPPORTED_RASTER_MIMES.has(file.type.toLowerCase())) return { kind: 'invalid', reason: 'unsupported' };
		if (!Number.isSafeInteger(file.size) || file.size < 0) return { kind: 'invalid', reason: 'unreadable' };
		if (file.size === 0) return { kind: 'invalid', reason: 'empty' };
		if (file.size > MAX_PASTED_IMAGE_BYTES ||
			totalBytes > MAX_PASTED_IMAGE_OPERATION_BYTES - file.size) return { kind: 'invalid', reason: 'tooLarge' };
		totalBytes += file.size;
	}
	return { kind: 'valid', files };
}

function selectImageItems(items: DataTransferItemList | undefined | null): ImageFileSelection {
	if (!items) return { kind: 'none' };
	const files: File[] = [];
	let sawImage = false;
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item.kind === 'file' && item.type.toLowerCase().startsWith('image/')) {
			sawImage = true;
			const file = item.getAsFile();
			if (!file) return { kind: 'invalid', reason: 'unreadable' };
			files.push(file);
		}
	}
	return validateImageFiles(files, sawImage);
}

export function selectDroppedImageFiles(files: FileList | undefined | null): ImageFileSelection {
	if (!files) return { kind: 'none' };
	const images: File[] = [];
	let sawImage = false;
	for (let i = 0; i < files.length; i++) {
		if (files[i].type.toLowerCase().startsWith('image/')) {
			sawImage = true;
			images.push(files[i]);
		}
	}
	return validateImageFiles(images, sawImage);
}

// `FileReader.readAsDataURL` is used (rather than hand-rolling base64 from
// `arrayBuffer()`) because the browser implements the encoding natively —
// cheaper than building a giant string via `String.fromCharCode` per byte for
// a multi-megabyte screenshot.
function readAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			const comma = result.indexOf(',');
			resolve(comma === -1 ? result : result.slice(comma + 1));
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

async function readImages(files: File[]): Promise<PastedImagePayload[]> {
	const images: PastedImagePayload[] = [];
	// Read sequentially so a maximum-sized operation never creates several
	// simultaneous FileReader buffers on the webview's UI thread.
	for (const file of files) images.push({ mimeType: file.type, dataBase64: await readAsBase64(file) });
	return images;
}

/** Intercepts a bounded image batch and hands one atomic operation to the host. */
export function createImagePasteHandler(
	onImages: ImagePasteCallback,
	onRejected: (reason: ImagePasteRejection) => void = () => undefined,
) {
	return EditorView.domEventHandlers({
		paste(event, view) {
			const selection = selectImageItems(event.clipboardData?.items);
			if (selection.kind === 'none') return false; // not an image — let normal text paste proceed untouched
			event.preventDefault();
			if (selection.kind === 'invalid') {
				onRejected(selection.reason);
				return true;
			}
			const { pos, needsOwnParagraph } = escapeTable(view.state, view.state.selection.main.from);
			void readImages(selection.files)
				.then((images) => onImages(pos, images, needsOwnParagraph))
				.catch(() => onRejected('unreadable'));
			return true;
		},
		drop(event, view) {
			const selection = selectDroppedImageFiles(event.dataTransfer?.files);
			if (selection.kind === 'none') return false;
			event.preventDefault();
			if (selection.kind === 'invalid') {
				onRejected(selection.reason);
				return true;
			}
			const dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
			const { pos, needsOwnParagraph } = escapeTable(view.state, dropPos);
			void readImages(selection.files)
				.then((images) => onImages(pos, images, needsOwnParagraph))
				.catch(() => onRejected('unreadable'));
			return true;
		},
	});
}
