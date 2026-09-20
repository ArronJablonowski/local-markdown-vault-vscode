import { t } from '../shared/i18n';
import { DIAGRAM_RENDER_TIMEOUT_MS, DiagramLimitError } from './diagramSecurity';

/** Mermaid keeps process-global renderer state, so render one diagram at a time. */
export const MAX_QUEUED_MERMAID_RENDERS = 16;

interface RenderEntry<T> {
	task: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
	deadline: number;
	settled: boolean;
	active: boolean;
}

const queue: Array<RenderEntry<unknown>> = [];
let active: RenderEntry<unknown> | undefined;

/**
 * Serializes Mermaid work and applies one deadline from enqueue through output.
 * A timed-out renderer retains the active slot until its underlying promise
 * settles, preventing a renderer that ignored the deadline from overlapping a
 * later task and multiplying main-thread work.
 */
export function renderMermaidBounded<T>(task: () => Promise<T>): Promise<T> {
	if (active && queue.length >= MAX_QUEUED_MERMAID_RENDERS) {
		return Promise.reject(new DiagramLimitError(t('diagram.tooMany')));
	}

	return new Promise<T>((resolve, reject) => {
		const entry: RenderEntry<T> = {
			task,
			resolve,
			reject,
			deadline: Date.now() + DIAGRAM_RENDER_TIMEOUT_MS,
			settled: false,
			active: false,
			timer: setTimeout(() => {
				if (entry.settled) return;
				entry.settled = true;
				if (!entry.active) {
					const index = queue.indexOf(entry as RenderEntry<unknown>);
					if (index >= 0) queue.splice(index, 1);
				}
				reject(new DiagramLimitError(t('diagram.renderTimeout')));
			}, DIAGRAM_RENDER_TIMEOUT_MS),
		};
		if (active) queue.push(entry as RenderEntry<unknown>);
		else start(entry as RenderEntry<unknown>);
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
			const next = queue.shift();
			if (next) start(next);
		});
}
