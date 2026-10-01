import { beforeEach, expect, it, vi } from 'vitest';
import { BoundedSerialQueue } from '../shared/boundedSerialQueue';

const mocks = vi.hoisted(() => ({ apply: vi.fn(), warning: vi.fn(), resolve: vi.fn(), create: vi.fn(), remove: vi.fn(), release: vi.fn() }));
vi.mock('vscode', async () => {
  const { resolve } = await import('node:path');
  const uri = (fsPath: string) => ({ scheme: 'file', fsPath, toString: () => `file://${fsPath}` });
  return {
    Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(resolve(base.fsPath, ...parts)) },
    workspace: { isTrusted: true, applyEdit: mocks.apply, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    window: { showWarningMessage: mocks.warning }, l10n: { t: (text: string) => text }, EndOfLine: { CRLF: 2 },
    WorkspaceEdit: class { insert = vi.fn(); },
  };
});
vi.mock('./shikiHost', () => ({}));
vi.mock('../vault/VaultService', () => ({ VaultService: { resolve: mocks.resolve } }));
vi.mock('../vault/CaseRenameCoordinator', () => ({}));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited: vi.fn() }));
vi.mock('./configuredDocumentOpen', () => ({}));
vi.mock('./workspaceVault', () => ({ localWorkspaceVaultRoot: () => ({ scheme: 'file', fsPath: '/vault', toString: () => 'file:///vault' }) }));
import { DocumentSyncSession } from './documentSync';

// Passive 1x1 PNG: the real signature/dimension checks remain enabled.
const images = [{ mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVb0AAAAASUVORK5CYII=' }];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.apply.mockResolvedValue(true); mocks.warning.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (_dir, name) => ({ uri: { fsPath: `/vault/assets/${name}` } }));
  mocks.remove.mockResolvedValue(undefined); mocks.release.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue({ available: true, service: {
    rootUri: { fsPath: '/vault' }, ensureDirectoryInside: async (uri: unknown) => uri,
    readDirectoryInside: async () => [], createFileExclusive: mocks.create,
    removeCreatedFile: mocks.remove, releaseCreatedFile: mocks.release,
  } });
});
function harness() {
  const document = { version: 1, text: 'Before After', isClosed: false, eol: 1,
    uri: { scheme: 'file', fsPath: '/vault/Note.md' }, getText() { return this.text; }, positionAt: (n: number) => n };
  // Exercise real queued host behavior without unrelated editor construction.
  const session = Object.assign(Object.create(DocumentSyncSession.prototype), {
    document, documentText: document.text, disposed: false, closing: false,
    mutationQueue: new BoundedSerialQueue(64), post: vi.fn(),
  });
  return { document, session };
}
it('accepts an image only against the source version that supplied its offset', async () => {
  const { session } = harness();
  session.enqueuePastedImages(7, images, false, 1); await session.mutationQueue.drain();
  expect(mocks.apply).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.warning).not.toHaveBeenCalled();
});
it('rejects an already stale webview version before creating attachments', async () => {
  const { session } = harness();
  session.enqueuePastedImages(7, images, false, 0); await session.mutationQueue.drain();
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('paste the image again'));
});
it('rechecks the captured snapshot after waiting behind another mutation', async () => {
  const { session, document } = harness();
  session.enqueueMutation(async () => { document.version++; document.text = 'New prefix Before After'; });
  session.enqueuePastedImages(7, images, false); await session.mutationQueue.drain();
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
});
for (const change of ['version', 'text', 'closed', 'disposed']) {
  it(`rolls back created attachments if ${change} changes during filesystem I/O`, async () => {
    const { session, document } = harness();
    mocks.create.mockImplementationOnce(async () => {
      if (change === 'version') document.version++;
      if (change === 'text') document.text = 'Other source';
      if (change === 'closed') document.isClosed = true;
      if (change === 'disposed') session.disposed = true;
      return { uri: { fsPath: '/vault/assets/test.png' } };
    });
    session.enqueuePastedImages(7, images, false, 1); await session.mutationQueue.drain();
    expect(mocks.apply).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.release).not.toHaveBeenCalled(); expect(session.post).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('paste the image again'));
  });
}
it('does not apply a second queued image at a stale offset after the first insertion', async () => {
  const { session, document } = harness();
  mocks.apply.mockImplementation(async () => { document.version++; document.text = 'Before ![](first.png)After'; return true; });
  session.enqueuePastedImages(7, images, false, 1); session.enqueuePastedImages(7, images, false, 1);
  await session.mutationQueue.drain();
  expect(mocks.apply).toHaveBeenCalledOnce(); expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.warning).toHaveBeenCalledOnce();
});

for (const failure of ['false', 'throw']) {
  it(`rolls back every created image if the document edit returns ${failure}`, async () => {
    const { session, document } = harness();
    const before = document.text;
    const created = [
      { uri: { fsPath: '/vault/assets/first.png' } },
      { uri: { fsPath: '/vault/assets/second.png' } },
    ];
    mocks.create.mockResolvedValueOnce(created[0]).mockResolvedValueOnce(created[1]);
    if (failure === 'false') mocks.apply.mockResolvedValueOnce(false);
    else mocks.apply.mockRejectedValueOnce(new Error('Synthetic document edit failure'));
    session.enqueuePastedImages(7, [images[0], images[0]], false, 1);
    await session.mutationQueue.drain();
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(mocks.remove.mock.calls.map(([file]) => file)).toEqual([...created].reverse());
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith('The pasted image could not be inserted. Please paste it again.');
    expect(session.post).not.toHaveBeenCalled();
    expect(document.text).toBe(before); expect(document.version).toBe(1);
  });
}

it('rolls back the earlier images if a later file in the batch cannot be created', async () => {
  const { session, document } = harness();
  const before = document.text;
  const created = [
    { uri: { fsPath: '/vault/assets/first.png' } },
    { uri: { fsPath: '/vault/assets/second.png' } },
  ];
  mocks.create.mockResolvedValueOnce(created[0]).mockResolvedValueOnce(created[1])
    .mockRejectedValueOnce(Object.assign(new Error('Synthetic attachment write failure'), { code: 'EACCES' }));
  session.enqueuePastedImages(7, [images[0], images[0], images[0]], false, 1);
  await session.mutationQueue.drain();
  expect(mocks.create).toHaveBeenCalledTimes(3);
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.remove.mock.calls.map(([file]) => file)).toEqual([...created].reverse());
  expect(mocks.release).not.toHaveBeenCalled(); expect(session.post).not.toHaveBeenCalled();
  expect(mocks.warning).toHaveBeenCalledWith('The pasted image could not be saved securely.');
  expect(document.text).toBe(before); expect(document.version).toBe(1);
});

for (const closing of [false, true]) {
  it(`routes text queued during image I/O to ${closing ? 'exact closing-draft recovery' : 'open-editor resync'} instead of stale offsets`, async () => {
    const { session, document } = harness();
    const before = document.text;
    const created = { uri: { fsPath: '/vault/assets/first.png' } };
    let reachedFileWrite!: () => void, finishFileWrite!: () => void;
    const fileWriteStarted = new Promise<void>(resolve => { reachedFileWrite = resolve; });
    const fileWritePending = new Promise<void>(resolve => { finishFileWrite = resolve; });
    mocks.create.mockImplementationOnce(async () => {
      reachedFileWrite(); await fileWritePending; return created;
    });
    mocks.apply.mockImplementationOnce(async () => {
      document.version++; document.text = 'Before ![](assets/first.png)After'; return true;
    });
    // Only the outbound full-snapshot routine is mocked. Queue dispatch,
    // stale-version detection, and closing-draft reconstruction are real.
    session.sendInit = vi.fn();
    session.preserveDraft = vi.fn().mockResolvedValue(undefined);
    const recover = vi.spyOn(session, 'recoverRejectedEdit');
    session.enqueuePastedImages(7, images, false, 1);
    await fileWriteStarted;
    const changes = [{ from: 7, to: 7, insert: 'Typed after paste ' }];
    session.handleMessage({ type: 'edit', baseVersion: 1, changes });
    session.closing = closing;
    finishFileWrite(); await session.mutationQueue.drain();
    expect(mocks.apply).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledExactlyOnceWith(created);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(document.text).toBe('Before ![](assets/first.png)After'); expect(document.version).toBe(2);
    expect(recover).toHaveBeenCalledExactlyOnceWith(before, changes);
    expect(session.post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ackEdit' }));
    if (closing) {
      expect(session.preserveDraft).toHaveBeenCalledExactlyOnceWith('Before Typed after paste After');
      expect(session.sendInit).not.toHaveBeenCalled();
    } else {
      expect(session.sendInit).toHaveBeenCalledOnce();
      expect(session.preserveDraft).not.toHaveBeenCalled();
    }
  });
}
