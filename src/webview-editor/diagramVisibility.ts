let hostVisible = true;
const hostVisibilityListeners = new Set<() => void>();

/** VS Code can hide a retained iframe without changing document.hidden. */
export function setDiagramHostVisibility(visible: boolean): void {
	if (typeof visible !== 'boolean' || hostVisible === visible) return;
	hostVisible = visible;
	for (const listener of [...hostVisibilityListeners]) listener();
}

export function isDiagramHidden(owner: Pick<Document, 'hidden'> | undefined = typeof document === 'undefined' ? undefined : document): boolean {
	return !hostVisible || Boolean(owner?.hidden);
}

export function onDiagramHostVisibilityChange(listener: () => void): () => void {
	hostVisibilityListeners.add(listener);
	return () => { hostVisibilityListeners.delete(listener); };
}

/** One cancelable deferred stage per mounted widget; no polling or hidden timers. */
export class DiagramVisibilityGate {
	private pending: (() => void) | undefined;
	private listening = false;
	private disposed = false;
	private stopHostListener: (() => void) | undefined;

	constructor(
		private readonly owner: Document = document,
		private readonly onError?: (error: unknown) => void,
	) {}

	get isDisposed(): boolean { return this.disposed; }

	run(task: () => void): void {
		if (this.disposed) return;
		this.pending = task;
		if (isDiagramHidden(this.owner)) {
			if (!this.listening) {
				this.listening = true;
				this.owner.addEventListener('visibilitychange', this.resume);
				this.stopHostListener = onDiagramHostVisibilityChange(this.resume);
			}
		} else this.resume();
	}

	private readonly resume = (): void => {
		if (this.disposed || isDiagramHidden(this.owner)) return;
		this.stopListening();
		const task = this.pending;
		this.pending = undefined;
		try { task?.(); }
		catch (error) {
			if (this.onError) this.onError(error);
			else throw error;
		}
	};

	private stopListening(): void {
		if (!this.listening) return;
		this.listening = false;
		this.owner.removeEventListener('visibilitychange', this.resume);
		this.stopHostListener?.();
		this.stopHostListener = undefined;
	}

	dispose(): void {
		this.disposed = true;
		this.pending = undefined;
		this.stopListening();
	}
}

// CodeMirror can transfer an equal widget's DOM to a new WidgetType instance.
// Cleanup therefore belongs to the DOM identity, never the creating instance.
const cleanup = new WeakMap<HTMLElement, () => void>();

export function trackDiagramVisibility(dom: HTMLElement, gate: DiagramVisibilityGate, onDispose?: () => void): void {
	cleanup.set(dom, () => { gate.dispose(); onDispose?.(); });
}

export function disposeDiagramVisibility(dom: HTMLElement): void {
	cleanup.get(dom)?.();
	cleanup.delete(dom);
}
