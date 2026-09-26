import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = parseInputs(process.argv.slice(2));
const [manifestText, lockText, notices] = await Promise.all([
	readFile(inputs.manifest, 'utf8'),
	readFile(inputs.lock, 'utf8'),
	readFile(inputs.notices, 'utf8'),
]);
const manifest = JSON.parse(manifestText);
const lock = JSON.parse(lockText);

assert(lock.lockfileVersion === 3, 'package-lock.json must use lockfileVersion 3.');
assert(lock.packages && typeof lock.packages === 'object', 'package-lock.json has no packages map.');
const rootRecord = lock.packages[''];
assert(rootRecord && typeof rootRecord === 'object', 'package-lock.json has no root package record.');

for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'engines']) {
	assert(equalRecords(manifest[field], rootRecord[field]), `package.json ${field} does not match package-lock.json.`);
}

const approvedProductionLicenses = new Set([
	'MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', 'Unlicense', '(MPL-2.0 OR Apache-2.0)',
]);
const productionLicenseExceptions = new Map([
	['node_modules/khroma', {
		version: '2.1.0',
		integrity: 'sha512-Ls993zuzfayK269Svk9hzpeGUKob/sIgZzyHYdjQoAdQetRKpOLj+k/QQQ/6Qi0Yz65mlROrfd+Ev+1+7dz9Kw==',
		license: 'MIT',
	}],
]);
// Approvals bind both version and integrity; package upgrades require a fresh review.
const approvedInstallScriptPackages = new Map([
	['node_modules/@vscode/vsce-sign', ['2.0.9', 'sha512-8IvaRvtFyzUnGGl3f5+1Cnor3LqaUWvhaUjAYO8Y39OUYlOf3cRd+dowuQYLpZcP3uwSG+mURwjEBOSq4SOJ0g==']],
	['node_modules/esbuild', ['0.28.2', 'sha512-HKVLS8dvII+xoKW9kmqxbRKrnWEXfJJr/FZhhJmiqIB0e053QNYFqOBouTMO/k5sID4MvCiUCvv8b9M4h32wIA==']],
	['node_modules/fsevents', ['2.3.3', 'sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==']],
	['node_modules/keytar', ['7.9.0', 'sha512-VPD8mtVtm5JNtA2AErl6Chp06JBfy7diFQ7TQQhdpWOl6MrCRB+eRbvAZUsbGQS9kiMq0coJsy0W0vHpDCkWsQ==']],
	['node_modules/libxmljs2', ['0.37.0', 'sha512-Xb78V8GZouoZFrq8cCwx7+G3WYOcJG0xb3YUbweSyE4z2EIrQCZMr3Ye/dHn4mESs6YxUMeQeUZm5IXg+iLHog==']],
]);

let productionPackages = 0;
const observedInstallScriptPackages = new Set();
for (const [path, record] of Object.entries(lock.packages)) {
	if (!path) continue;
	assert(record && typeof record === 'object', `Invalid lockfile record: ${path}`);
	assert(typeof record.version === 'string' && record.version.length > 0, `Missing version: ${path}`);
	assert(typeof record.resolved === 'string', `Missing resolved URL: ${path}`);
	const resolved = new URL(record.resolved);
	assert(resolved.protocol === 'https:' && resolved.origin === 'https://registry.npmjs.org', `Unapproved package source: ${path}`);
	assert(typeof record.integrity === 'string' && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(record.integrity), `Missing SHA-512 integrity: ${path}`);

	if (record.hasInstallScript === true) {
		observedInstallScriptPackages.add(path);
		const approved = approvedInstallScriptPackages.get(path);
		assert(approved?.[0] === record.version && approved?.[1] === record.integrity, `Unreviewed install script package: ${path}@${record.version}`);
	}

	if (record.dev !== true) {
		productionPackages++;
		if (typeof record.license === 'string' && approvedProductionLicenses.has(record.license)) continue;
		const exception = productionLicenseExceptions.get(path);
		assert(
			exception?.version === record.version && exception?.integrity === record.integrity,
			`Missing or unapproved production license: ${path}@${record.version} (${record.license ?? 'not declared'})`,
		);
		assert(notices.includes('khroma') && notices.includes(exception.license), 'The khroma license exception is missing from THIRD-PARTY-NOTICES.md.');
	}
}

for (const path of approvedInstallScriptPackages.keys()) {
	assert(observedInstallScriptPackages.has(path), `Stale install-script approval: ${path}`);
}

console.log(`Dependency policy verified: ${Object.keys(lock.packages).length - 1} locked packages, ${productionPackages} production packages, ${observedInstallScriptPackages.size} disabled install-script packages.`);

function equalRecords(left, right) {
	return JSON.stringify(sortRecord(left)) === JSON.stringify(sortRecord(right));
}

function sortRecord(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function parseInputs(args) {
	const values = {
		manifest: resolve(root, 'package.json'),
		lock: resolve(root, 'package-lock.json'),
		notices: resolve(root, 'THIRD-PARTY-NOTICES.md'),
	};
	const names = new Set(Object.keys(values));
	for (let index = 0; index < args.length; index += 2) {
		const option = args[index];
		const name = option?.startsWith('--') ? option.slice(2) : '';
		const value = args[index + 1];
		assert(names.has(name) && typeof value === 'string' && value.length > 0, `Invalid dependency-policy argument: ${option ?? ''}`);
		values[name] = resolve(value);
	}
	return values;
}
