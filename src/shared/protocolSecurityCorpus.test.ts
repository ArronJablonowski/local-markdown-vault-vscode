import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BoundedSerialQueue } from './boundedSerialQueue';
import { validateEditorToHostMessage, validateHostToEditorMessage } from './messageValidation';

interface CorpusRepeat {
	field: string;
	character: string;
	length: number;
}

interface CorpusMessage {
	name: string;
	direction: 'editorToHost' | 'hostToEditor';
	documentLength: number;
	currentDocumentVersion?: number;
	message: unknown;
	repeat?: CorpusRepeat;
}

interface ProtocolCorpus {
	messages: CorpusMessage[];
	queueFlood: { limit: number; attempts: number };
}

const corpusPath = join(__dirname, '..', '..', 'test', 'security-corpus', 'protocol-messages.json');
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as ProtocolCorpus;

function materialize(entry: CorpusMessage): unknown {
	if (!entry.repeat) return entry.message;
	if (typeof entry.message !== 'object' || entry.message === null || Array.isArray(entry.message)) {
		throw new Error(`Repeat descriptor requires an object message: ${entry.name}`);
	}
	if (entry.repeat.character.length !== 1 || !Number.isSafeInteger(entry.repeat.length) || entry.repeat.length < 0) {
		throw new Error(`Invalid repeat descriptor: ${entry.name}`);
	}
	return {
		...entry.message,
		[entry.repeat.field]: entry.repeat.character.repeat(entry.repeat.length),
	};
}

describe('checked-in malicious protocol corpus', () => {
	it.each(corpus.messages)('rejects $name', (entry) => {
		const message = materialize(entry);
		const result = entry.direction === 'editorToHost'
			? validateEditorToHostMessage(message, entry.documentLength, entry.currentDocumentVersion)
			: validateHostToEditorMessage(message, entry.documentLength);
		expect(result.ok).toBe(false);
	});

	it('bounds the privileged queue during the declared flood', async () => {
		const { limit, attempts } = corpus.queueFlood;
		expect(Number.isSafeInteger(limit) && limit > 0).toBe(true);
		expect(Number.isSafeInteger(attempts) && attempts > limit).toBe(true);

		let releaseFirst!: () => void;
		const blocker = new Promise<void>((resolve) => { releaseFirst = resolve; });
		const queue = new BoundedSerialQueue(limit);
		let accepted = 0;
		for (let index = 0; index < attempts; index++) {
			if (queue.tryEnqueue(index === 0 ? () => blocker : () => undefined)) accepted++;
			expect(queue.pendingCount).toBeLessThanOrEqual(limit);
		}

		expect(accepted).toBe(limit);
		expect(queue.pendingCount).toBe(limit);
		releaseFirst();
		await queue.drain();
		expect(queue.pendingCount).toBe(0);
	});
});
