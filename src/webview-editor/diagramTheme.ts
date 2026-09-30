interface ThemeSubscription {
	dark: boolean;
	observer: MutationObserver;
	listeners: Set<() => void>;
}

const subscriptions = new WeakMap<Document, ThemeSubscription>();

export function isDarkDiagramTheme(owner: Document = document): boolean {
	return owner.body.classList.contains('vscode-dark') || owner.body.classList.contains('vscode-high-contrast');
}

/** One observer per webview; unrelated body classes must not rerender every diagram. */
export function onDiagramThemeChange(listener: () => void, owner: Document = document): () => void {
	let subscription = subscriptions.get(owner);
	if (!subscription) {
		const listeners = new Set<() => void>();
		const observer = new MutationObserver(() => {
			const current = subscriptions.get(owner);
			if (!current) return;
			const dark = isDarkDiagramTheme(owner);
			if (dark === current.dark) return;
			current.dark = dark;
			for (const callback of [...current.listeners]) callback();
		});
		subscription = { dark: isDarkDiagramTheme(owner), observer, listeners };
		subscriptions.set(owner, subscription);
		observer.observe(owner.body, { attributes: true, attributeFilter: ['class'] });
	}
	subscription.listeners.add(listener);
	const owned = subscription;
	return () => {
		owned.listeners.delete(listener);
		if (owned.listeners.size === 0) {
			owned.observer.disconnect();
			if (subscriptions.get(owner) === owned) subscriptions.delete(owner);
		}
	};
}
