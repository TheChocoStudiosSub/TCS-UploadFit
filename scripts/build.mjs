import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedEdition = process.argv.find(arg => arg.startsWith('--edition='))?.split('=')[1] || null;
const outIndex = process.argv.indexOf('--out');
const outputRoot = outIndex >= 0 && process.argv[outIndex + 1]
  ? path.resolve(process.argv[outIndex + 1])
  : path.join(root, 'dist');

const { EDITIONS } = await import(pathToFileURL(path.join(root, 'src/edition.js')).href);
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const editionIds = requestedEdition ? [requestedEdition] : Object.keys(EDITIONS);
if (editionIds.some(id => !EDITIONS[id])) throw new Error(`Unknown edition: ${requestedEdition}`);

async function listSourceFiles(directory, base = directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (base === root && ['.git', '.github', 'node_modules', 'dist'].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listSourceFiles(full, base));
    else found.push(full);
  }
  return found;
}

const digest = createHash('sha256');
for (const file of (await listSourceFiles(root)).sort()) {
  digest.update(path.relative(root, file));
  digest.update(await readFile(file));
}
const sourceHash = digest.digest('hex').slice(0, 12);
const version = packageJson.version || '0.0.0';

async function buildEdition(id) {
  const edition = EDITIONS[id];
  const destination = path.join(outputRoot, id);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  // Copy individual files so the default dist output can safely live inside the source root.
  const excludedTopLevel = new Set(['scripts', 'tests']);
  const excludedFiles = new Set([
    'package.json', 'package-lock.json', 'README.md', 'STORE-LISTING.md', 'LICENSE'
  ]);
  for (const sourceFile of await listSourceFiles(root)) {
    const relative = path.relative(root, sourceFile);
    const topLevel = relative.split(path.sep)[0];
    if (excludedTopLevel.has(topLevel) || excludedFiles.has(relative)) continue;
    const destinationFile = path.join(destination, relative);
    await mkdir(path.dirname(destinationFile), { recursive: true });
    await cp(sourceFile, destinationFile);
  }

  const editionFile = path.join(destination, 'src/edition.js');
  let editionSource = await readFile(editionFile, 'utf8');
  editionSource = editionSource.replace(
    "export const ACTIVE_EDITION = 'demo';",
    `export const ACTIVE_EDITION = '${id}';`
  );
  if (!editionSource.includes(`export const ACTIVE_EDITION = '${id}';`)) {
    throw new Error(`Could not select the ${id} edition.`);
  }
  await writeFile(editionFile, editionSource);

  const indexFile = path.join(destination, 'index.html');
  let html = await readFile(indexFile, 'utf8');
  html = html.replace('__EDITION_TITLE__', edition.title.en);
  html = html.replace('__EDITION_DESCRIPTION__', edition.description.en);
  html = html.replaceAll('__MAX_OUTPUT_EDGE__', String(edition.maxOutputEdge));
  if (html.includes('__EDITION_') || html.includes('__MAX_OUTPUT_EDGE__')) throw new Error('An edition placeholder was not replaced.');
  await writeFile(indexFile, html);

  const workerFile = path.join(destination, 'sw.js');
  let worker = await readFile(workerFile, 'utf8');
  const cacheVersion = `${id}-v${version}-${sourceHash}`;
  worker = worker.replace('__CACHE_VERSION__', cacheVersion);
  if (worker.includes('__CACHE_VERSION__')) throw new Error('Service-worker cache version was not injected.');
  await writeFile(workerFile, worker);

  await writeFile(path.join(destination, 'edition-build.json'), JSON.stringify({
    edition: id,
    version,
    sourceHash,
    maxImages: edition.maxImages,
    maxInputBytes: edition.maxInputBytes,
    maxBatchOutputBytes: edition.maxBatchOutputBytes,
    maxImagePixels: edition.maxImagePixels,
    maxOutputEdge: edition.maxOutputEdge
  }, null, 2) + '\n');
  console.log(`Built ${id}: ${edition.maxImages} images, ${edition.maxInputBytes} bytes/input, ${edition.maxBatchOutputBytes} bytes/output (${sourceHash}).`);
}

for (const id of editionIds) await buildEdition(id);
