import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({
	setting: false as unknown, getConfiguration: vi.fn(), execute: vi.fn(),
	listener: undefined as undefined | ((event: { affectsConfiguration(name: string): boolean }) => void),
	dispose: vi.fn(), diagnostic: vi.fn(),
}));
vi.mock('vscode', () => ({
	workspace: {
		getConfiguration: mocks.getConfiguration,
		onDidChangeConfiguration: (listener: typeof mocks.listener) => {
			mocks.listener = listener;
			return { dispose: mocks.dispose };
		},
	},
	commands: { executeCommand: mocks.execute },
}));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited: mocks.diagnostic }));
import { createMarkdownPreviewSupport, STICKY_PREVIEW_TABLE_CLASS, type MarkdownItPreview } from './markdownPreviewSupport';

function parser(): MarkdownItPreview {
	return {
		renderer: {
			rules: {},
			renderToken: (tokens, index) => `<table${tokens[index].attrs?.map(([name, value]) => ` ${name}="${value}"`).join('') ?? ''}>`,
		},
	};
}
function changed(name = 'mdLivePreview.stickyTableHeaders') {
	mocks.listener?.({ affectsConfiguration: candidate => candidate === name });
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}

describe('built-in Markdown Preview sticky-header integration', () => {
	let support: ReturnType<typeof createMarkdownPreviewSupport>;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks(); mocks.setting = false;
		mocks.getConfiguration.mockReturnValue({ get: (_key: string, fallback: unknown) => mocks.setting ?? fallback });
		mocks.execute.mockResolvedValue(undefined);
		support = createMarkdownPreviewSupport();
	});
	afterEach(() => { support.dispose(); vi.useRealTimers(); });

	it('defaults off and re-renders the same cached token off/on/off without mutation', () => {
		const md = parser();
		expect(support.extendMarkdownIt(md)).toBe(md);
		const tokens = [{ attrs: null }];
		const render = () => md.renderer.rules.table_open!(tokens, 0, {}, undefined, md.renderer);
		expect(render()).toBe('<table>');
		mocks.setting = true;
		expect(render()).toBe(`<table class="${STICKY_PREVIEW_TABLE_CLASS}">`);
		expect(tokens[0].attrs).toBeNull();
		mocks.setting = false;
		expect(render()).toBe('<table>');
	});

	it('uses the Markdown engine document URI and accepts only boolean true', () => {
		const md = support.extendMarkdownIt(parser());
		const uri = { scheme: 'file', path: '/vault/note.md' } as vscode.Uri;
		for (const value of [false, undefined, 'true', ['true'], 1, {}]) {
			mocks.setting = value;
			expect(md.renderer.rules.table_open!([{ attrs: null }], 0, {}, { currentDocument: uri }, md.renderer)).toBe('<table>');
		}
		expect(mocks.getConfiguration).toHaveBeenLastCalledWith('mdLivePreview', uri);
	});

	it('preserves other classes, attributes, renderer arguments, and cached attribute identity', () => {
		mocks.setting = true;
		const md = parser();
		const previous = vi.fn((...args: Parameters<NonNullable<MarkdownItPreview['renderer']['rules'][string]>>) => md.renderer.renderToken(args[0], args[1], args[2]));
		md.renderer.rules.table_open = previous;
		support.extendMarkdownIt(md);
		const attrs: [string, string][] = [['class', 'other-plugin'], ['data-line', '42']];
		const tokens = [{ attrs }];
		const options = {}; const env = {};
		expect(md.renderer.rules.table_open!(tokens, 0, options, env, md.renderer))
			.toBe(`<table class="other-plugin ${STICKY_PREVIEW_TABLE_CLASS}" data-line="42">`);
		expect(previous).toHaveBeenCalledWith(tokens, 0, options, env, md.renderer);
		expect(tokens[0].attrs).toBe(attrs);
		expect(attrs).toEqual([['class', 'other-plugin'], ['data-line', '42']]);
	});

	it('restores cached attributes even when another renderer throws', () => {
		mocks.setting = true;
		const md = parser();
		md.renderer.rules.table_open = () => { throw new Error('third-party renderer'); };
		support.extendMarkdownIt(md);
		const tokens = [{ attrs: null }];
		expect(() => md.renderer.rules.table_open!(tokens, 0, {}, undefined, md.renderer)).toThrow('third-party renderer');
		expect(tokens[0].attrs).toBeNull();
	});

	it('does not wrap a parser twice or alter unrelated rendering rules', () => {
		const md = parser(); const fence = vi.fn(() => '<pre>safe</pre>');
		md.renderer.rules.fence = fence;
		support.extendMarkdownIt(md);
		const rule = md.renderer.rules.table_open;
		support.extendMarkdownIt(md);
		expect(md.renderer.rules.table_open).toBe(rule);
		expect(md.renderer.rules.fence).toBe(fence);
	});

	it('refreshes open built-in previews on changes without writing settings', async () => {
		changed('mdLivePreview.autoSave'); expect(mocks.execute).not.toHaveBeenCalled();
		changed(); await vi.advanceTimersByTimeAsync(350);
		expect(mocks.execute).toHaveBeenCalledTimes(1);
		expect(mocks.execute).toHaveBeenCalledWith('markdown.preview.refresh');
	});

	it('coalesces rapid changes and reruns after an in-flight refresh', async () => {
		const waiting = deferred(); mocks.execute.mockReturnValueOnce(waiting.promise);
		changed(); await vi.advanceTimersByTimeAsync(350);
		changed(); changed(); await vi.advanceTimersByTimeAsync(350);
		expect(mocks.execute).toHaveBeenCalledTimes(1);
		waiting.resolve();
		await Promise.resolve(); await Promise.resolve();
		expect(mocks.execute).toHaveBeenCalledTimes(2);
	});

	it('catches refresh failure and permits a later retry', async () => {
		mocks.execute.mockRejectedValueOnce(new Error('built-in extension disabled'));
		changed(); await vi.advanceTimersByTimeAsync(350);
		expect(mocks.diagnostic).toHaveBeenCalledTimes(1);
		changed(); await vi.advanceTimersByTimeAsync(350);
		expect(mocks.execute).toHaveBeenCalledTimes(2);
	});

	it('disposes the listener and stops pending refresh/render enablement', async () => {
		const md = support.extendMarkdownIt(parser());
		const waiting = deferred(); mocks.execute.mockReturnValueOnce(waiting.promise);
		changed(); await vi.advanceTimersByTimeAsync(350);
		changed(); support.dispose(); mocks.setting = true;
		waiting.resolve(); await Promise.resolve(); await Promise.resolve();
		changed(); await vi.advanceTimersByTimeAsync(1_000);
		expect(mocks.execute).toHaveBeenCalledTimes(1);
		expect(mocks.dispose).toHaveBeenCalled();
		expect(md.renderer.rules.table_open!([{ attrs: null }], 0, {}, undefined, md.renderer)).toBe('<table>');
	});

	it('waits for the built-in ordinary refresh window and coalesces rapid configuration toggles', async () => {
		changed(); await vi.advanceTimersByTimeAsync(300);
		expect(mocks.execute).not.toHaveBeenCalled();
		changed(); await vi.advanceTimersByTimeAsync(349);
		expect(mocks.execute).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.execute).toHaveBeenCalledTimes(1);
	});

	it('does not leave a trailing refresh timer after disposal', async () => {
		changed(); support.dispose();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(mocks.execute).not.toHaveBeenCalled();
	});
});
