import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;

const requiredFiles = new Set([
	'extension/package.json',
	'extension/dist/extension.js',
		'extension/SECURITY.md',
		'extension/docs/ACCESSIBILITY.md',
		'extension/docs/MIGRATION.md',
		'extension/docs/NATIVE_VAULT_UNDO_LIMITATION.md',
		'extension/docs/OBSIDIAN_COMPATIBILITY.md',
		'extension/THIRD-PARTY-NOTICES.md',
	'extension/LICENSE.txt',
	'extension/LICENSE-SHAPES',
	'extension/vendor/aws4-LICENSE.txt',
	'extension/readme.md',
	'extension/changelog.md',
]);

const forbiddenPaths = [
	/^extension\/(?:src|test|tests|coverage|test-results|playwright-report|node_modules|scripts|releases|\.github|\.vscode|\.vscode-test|doc|specs|sample|plans)(?:\/|$)/i,
	/^extension\/(?:package-lock\.json|(?:markdown-live-preview-editor|local-markdown-vault)\.cdx\.json)$/i,
	/^extension\/(?:esbuild\.js|playwright\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json|vitest\.config\.[^/]+|\.vscode-test\.mjs)$/i,
	/(?:^|\/)\.env(?:\.|$)/i,
	/\.(?:map|ts|tsx|vsix|pem|key|p12|pfx)$/i,
	/(?:^|\/)\.DS_Store$/i,
];

function fail(message) {
	throw new Error(`VSIX verification failed: ${message}`);
}

function assertSafeArchivePath(path) {
	if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/')) {
		fail(`unsafe archive path ${JSON.stringify(path)}`);
	}
	const segments = path.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
		fail(`non-canonical archive path ${JSON.stringify(path)}`);
	}
	if (path !== 'extension.vsixmanifest' && path !== '[Content_Types].xml' && !path.startsWith('extension/')) {
		fail(`unexpected top-level file ${JSON.stringify(path)}`);
	}
}

async function verifyVsix(archivePath) {
	const archive = await readFile(archivePath);
	if (archive.byteLength > MAX_ARCHIVE_BYTES) {
		fail(`archive is ${archive.byteLength} bytes; limit is ${MAX_ARCHIVE_BYTES}`);
	}

	const zip = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
	const files = Object.values(zip.files).filter((entry) => !entry.dir);
	if (files.length === 0) fail('archive contains no files');

	let totalUncompressedBytes = 0;
	const names = new Set();
	for (const entry of files) {
		// Inspect the original ZIP path so parser normalization cannot hide traversal.
		const originalName = entry.unsafeOriginalName ?? entry.name;
		assertSafeArchivePath(originalName);
		if (entry.name !== originalName) fail(`path was rewritten by ZIP parser: ${JSON.stringify(originalName)}`);
		if (names.has(entry.name)) fail(`duplicate archive entry ${JSON.stringify(entry.name)}`);
		names.add(entry.name);

		const mode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
		if ((mode & 0o170000) === 0o120000) fail(`symbolic link entry ${JSON.stringify(entry.name)}`);
		if (forbiddenPaths.some((pattern) => pattern.test(entry.name))) {
			fail(`development or sensitive file was packaged: ${entry.name}`);
		}

		const content = await entry.async('uint8array');
		if (content.byteLength > MAX_ENTRY_BYTES) {
			fail(`${entry.name} is ${content.byteLength} bytes; per-file limit is ${MAX_ENTRY_BYTES}`);
		}
		totalUncompressedBytes += content.byteLength;
		if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
			fail(`uncompressed content exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes`);
		}
	}

	for (const path of requiredFiles) {
		if (!names.has(path)) fail(`required release file is missing: ${path}`);
		const content = await zip.file(path)?.async('uint8array');
		if (!content?.byteLength) fail(`required release file is empty: ${path}`);
	}

	const sourceManifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
	const packagedManifest = JSON.parse(await zip.file('extension/package.json').async('string'));
	for (const field of ['name', 'version', 'publisher', 'main']) {
		if (packagedManifest[field] !== sourceManifest[field]) {
			fail(`packaged manifest ${field} does not match source manifest`);
		}
	}
	const mainPath = `extension/${String(packagedManifest.main).replace(/^\.\//, '')}`;
	if (!names.has(mainPath)) fail(`packaged extension entry point is missing: ${mainPath}`);
	if (packagedManifest.capabilities?.untrustedWorkspaces?.supported !== 'limited') {
		fail('packaged manifest does not declare limited untrusted-workspace support');
	}
	if (packagedManifest.capabilities?.virtualWorkspaces?.supported !== false) {
		fail('packaged manifest does not reject unsupported virtual workspaces');
	}

	process.stdout.write(
		`Verified ${archivePath}: ${files.length} files, ${archive.byteLength} compressed bytes, ` +
			`${totalUncompressedBytes} uncompressed bytes.\n`,
	);
}

const sourceManifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const defaultArchive = `${sourceManifest.name}-${sourceManifest.version}.vsix`;
await verifyVsix(resolve(process.argv[2] ?? defaultArchive));
