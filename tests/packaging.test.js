import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('Store package is a local WebView2 host and contains no remote app URL', async () => {
  const [host, project, manifest, index] = await Promise.all([
    read('packaging/WindowsApp/MainForm.cs'),
    read('packaging/WindowsApp/TCS.UploadFit.Host.csproj'),
    read('packaging/WindowsApp/Package.appxmanifest.template'),
    read('index.html')
  ]);
  assert.match(host, /SetVirtualHostNameToFolderMapping\(\s*"uploadfit\.example"/);
  assert.match(host, /CoreWebView2HostResourceAccessKind\.Allow/);
  assert.match(host, /core\.Navigate\("https:\/\/uploadfit\.example\/index\.html"\)/);
  assert.match(host, /target\.Host, "uploadfit\.example"/);
  assert.match(host, /target\.Scheme != Uri\.UriSchemeHttps/);
  assert.match(project, /<SelfContained>true<\/SelfContained>/);
  assert.match(project, /WebRootPath/);
  assert.match(manifest, /__IDENTITY_NAME__/);
  assert.match(manifest, /__PUBLISHER__/);
  assert.match(manifest, /__PUBLISHER_DISPLAY_NAME__/);
  assert.ok(!index.includes('https://tcs-uploadfit.vercel.app'));
});

test('Store build script rejects missing identity and does not sign the package', async () => {
  const script = await read('scripts/build-msix.ps1');
  assert.match(script, /partner-center\.identity\.json/);
  assert.match(script, /IdentityName/);
  assert.match(script, /PublisherDisplayName/);
  assert.match(script, /MakeAppx\.exe/);
  assert.match(script, /makeAppx\.FullName pack/);
  assert.match(script, /Compress-Archive/);
  assert.match(script, /Do not self-sign|unsigned MSIX|unsigned/i);
  assert.ok(!/signtool\s+sign/i.test(script));
});

test('Store identity example contains placeholders rather than fabricated publisher data', async () => {
  const example = JSON.parse(await read('packaging/partner-center.identity.example.json'));
  assert.match(example.IdentityName, /^</);
  assert.match(example.Publisher, /^</);
  assert.match(example.PublisherDisplayName, /^</);
});

test('Store assets are generated with contain sizing and transparent canvases', async () => {
  const assets = await read('scripts/generate-store-assets.ps1');
  assert.match(assets, /Transparent/);
  assert.match(assets, /\[Math\]::Min\(\$innerWidth \/ \$logo\.Width, \$innerHeight \/ \$logo\.Height\)/);
  assert.match(assets, /DrawImage\(\$logo, \$destination\)/);
  assert.match(assets, /7324f9660e9f1ee27212982ec310e71f1475a8161846e396be2ada7eb5b764be/);
  assert.match(assets, /\$logo\.Width -ne 1408/);
  assert.match(assets, /\$logo\.Height -ne 768/);
  assert.doesNotMatch(assets, /ImageAttributes|WrapMode|TileFlip/i);
});
