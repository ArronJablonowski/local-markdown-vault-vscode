/**
 * Holds at most one line jump while a Live Preview webview is starting or
 * hidden. The latest user navigation wins and no unbounded work can queue.
 */
export class PendingLineNavigation {
	private pending: number | undefined;

	request(line: number, lineCount: number, canDeliver: boolean): number | undefined {
		if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) return undefined;
		if (canDeliver) return line;
		this.pending = line;
		return undefined;
	}

	flush(canDeliver: boolean): number | undefined {
		if (!canDeliver || this.pending === undefined) return undefined;
		const line = this.pending;
		this.pending = undefined;
		return line;
	}
}
