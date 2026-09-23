import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';

// A deliberately small, offline convenience menu. Any Unicode emoji may also
// be pasted or entered using the operating system's character picker.
const EMOJI: ReadonlyArray<readonly [string, string]> = [
	['smile', '😄'], ['grinning', '😀'], ['laughing', '😆'], ['joy', '😂'],
	['wink', '😉'], ['thinking', '🤔'], ['sunglasses', '😎'], ['sad', '😢'],
	['heart', '❤️'], ['broken_heart', '💔'], ['thumbsup', '👍'], ['thumbsdown', '👎'],
	['clap', '👏'], ['wave', '👋'], ['pray', '🙏'], ['muscle', '💪'],
	['tada', '🎉'], ['rocket', '🚀'], ['fire', '🔥'], ['star', '⭐'],
	['sparkles', '✨'], ['warning', '⚠️'], ['check', '✅'], ['x', '❌'],
	['question', '❓'], ['bulb', '💡'], ['memo', '📝'], ['books', '📚'],
	['calendar', '📅'], ['folder', '📁'], ['lock', '🔒'], ['key', '🔑'],
	['bug', '🐛'], ['computer', '💻'], ['coffee', '☕'], ['eyes', '👀'],
];

export function emojiCompletions(context: CompletionContext): CompletionResult | null {
	const match = context.matchBefore(/:[a-z_]{1,32}:?$/);
	if (!match) return null;
	// Do not offer replacements in URLs, identifiers, code, or link targets.
	if (match.from > 0 && !/[\s([{]/.test(context.state.sliceDoc(match.from - 1, match.from))) return null;
	for (let node = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent!) {
		if (/Code|Link|Image|HTML/.test(node.name)) return null;
	}
	const query = match.text.slice(1).replace(/:$/, '');
	const options = EMOJI.filter(([name]) => name.startsWith(query)).map(([name, emoji]) => ({
		label: `:${name}:`, detail: emoji, apply: emoji, type: 'text',
	}));
	return options.length ? { from: match.from, to: context.pos, options } : null;
}
