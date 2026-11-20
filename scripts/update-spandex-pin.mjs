import { readFileSync, writeFileSync } from 'node:fs';

const sha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Expected a full Spandex Git commit SHA.');

const manifestPath = 'packages/api/package.json';
const workspacePath = 'pnpm-workspace.yaml';
const manifest = readFileSync(manifestPath, 'utf8');
const workspace = readFileSync(workspacePath, 'utf8');
const specifier = JSON.parse(manifest).dependencies['@spandex/core'];
const specifierPattern = /^github:SatoshiAndKin\/spandex#([a-f0-9]{40})&path:\/packages\/core$/;
const old = specifierPattern.exec(specifier)?.[1];
if (!old) throw new Error('Spandex manifest is not a full Git SHA pin.');

const tarball = (commit) => `https://codeload.github.com/SatoshiAndKin/spandex/tar.gz/${commit}#path:/packages/core`;
const oldBuild = `"@spandex/core@${tarball(old)}": true`;
const newBuild = `"@spandex/core@${tarball(sha)}": true`;

function exactlyOnce(text, needle) {
  if (text.split(needle).length !== 2) throw new Error('Expected exactly one current Spandex pin.');
}

exactlyOnce(manifest, specifier);
exactlyOnce(workspace, oldBuild);
if (process.argv[3] === '--check-lock') {
  if (old !== sha) throw new Error('Manifest does not match the selected Spandex SHA.');
  const lock = readFileSync('pnpm-lock.yaml', 'utf8');
  if (!lock.includes(`specifier: ${specifier}`) || !lock.includes(tarball(sha))) {
    throw new Error('Lockfile does not match the selected Spandex SHA.');
  }
} else if (old !== sha) {
  writeFileSync(manifestPath, manifest.replace(specifier, specifier.replace(old, sha)));
  writeFileSync(workspacePath, workspace.replace(oldBuild, newBuild));
}
process.stdout.write(old + '\n');
