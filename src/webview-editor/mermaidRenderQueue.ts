import { t } from '../shared/i18n';
import { DIAGRAM_RENDER_TIMEOUT_MS, DiagramLimitError } from './diagramSecurity';
import { isDiagramHidden, onDiagramHostVisibilityChange } from './diagramVisibility';

/** Mermaid keeps process-global renderer state, so render one diagram at a time. */
export const MAX_QUEUED_MERMAID_RENDERS = 16;

interface RenderEntry<T> {
	task: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
	timer?: ReturnType<typeof setTimeout>;
	deadline: number;
	remaining: number;
	settled: boolean;
	active: boolean;
}

const queue: Array<RenderEntry<unknown>> = [];
let active: RenderEntry<unknown> | undefined;
let listeningDocument: Document | undefined;
let stopHostListener: (() => void) | undefined;

function stopListeningIfIdle(): void {
	if (active || queue.length) return;
	listeningDocument?.removeEventListener('visibilitychange', onVisibilityChange);
	listeningDocument = undefined;
	stopHostListener?.();
	stopHostListener = undefined;
}

function expire(entry: RenderEntry<unknown>): void {
	if (entry.settled) return;
	entry.settled = true;
	clearTimeout(entry.timer);
	if (!entry.active) {
		const index = queue.indexOf(entry);
		if (index >= 0) queue.splice(index, 1);
	}
	entry.reject(new DiagramLimitError(t('diagram.renderTimeout')));
	stopListeningIfIdle();
}

function arm(entry: RenderEntry<unknown>): void {
	entry.deadline = Date.now() + entry.remaining;
	entry.timer = setTimeout(() => expire(entry), entry.remaining);
}

function onVisibilityChange(): void {
	for (const entry of queue) {
		if (isDiagramHidden()) {
			if (entry.timer === undefined) continue;
			entry.remaining = Math.max(0, entry.deadline - Date.now());
			clearTimeout(entry.timer);
			entry.timer = undefined;
		} else if (entry.timer === undefined) arm(entry);
	}
	startNext();
}

function startNext(): void {
	if (active || isDiagramHidden()) return;
	while (queue.length) {
		const next = queue.shift()!;
		if (next.settled) continue;
		if (next.timer === undefined) arm(next);
		if (Date.now() >= next.deadline) { expire(next); continue; }
		start(next);
		return;
	}
	stopListeningIfIdle();
}

/**
 * Serializes Mermaid work and applies one deadline from enqueue through output,
 * excluding time a queued task waits for a hidden document to become visible.
 * Already-running renderers retain their deadline even when the tab is hidden.
 * A timed-out renderer retains the active slot until its underlying promise
 * settles, preventing a renderer that ignored the deadline from overlapping a
 * later task and multiplying main-thread work.
 */
export function renderMermaidBounded<T>(task: () => Promise<T>): Promise<T> {
	if (queue.length >= MAX_QUEUED_MERMAID_RENDERS) {
		return Promise.reject(new DiagramLimitError(t('diagram.tooMany')));
	}

	return new Promise<T>((resolve, reject) => {
		const entry: RenderEntry<T> = {
			task,
			resolve,
			reject,
			deadline: 0,
			remaining: DIAGRAM_RENDER_TIMEOUT_MS,
			settled: false,
			active: false,
		};
		if (!listeningDocument && typeof document !== 'undefined') {
			listeningDocument = document;
			listeningDocument.addEventListener('visibilitychange', onVisibilityChange);
		}
		stopHostListener ??= onDiagramHostVisibilityChange(onVisibilityChange);
		if (!isDiagramHidden()) arm(entry as RenderEntry<unknown>);
		queue.push(entry as RenderEntry<unknown>);
		startNext();
	});
}

function start(entry: RenderEntry<unknown>): void {
	active = entry;
	entry.active = true;
	Promise.resolve()
		.then(entry.task)
		.then(
			(value) => {
				if (!entry.settled) {
					entry.settled = true;
					clearTimeout(entry.timer);
					// A synchronous renderer can prevent the timer callback from running.
					// Check elapsed wall time again once control returns to the queue.
					if (Date.now() >= entry.deadline) entry.reject(new DiagramLimitError(t('diagram.renderTimeout')));
					else entry.resolve(value);
				}
			},
			(error) => {
				if (!entry.settled) {
					entry.settled = true;
					clearTimeout(entry.timer);
					entry.reject(error);
				}
			},
		)
		.finally(() => {
			clearTimeout(entry.timer);
			entry.active = false;
			if (active === entry) active = undefined;
			startNext();
			stopListeningIfIdle();
		});
}
