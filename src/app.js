import { formatBytes, formatDimensions, processImage } from './processor.js';
import { createZip } from './zip.js';
import { translate } from './i18n.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const MAX_QUEUE = 5;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const STORAGE = {
  language: 'tcs-uploadfit-language-v1',
  presets: 'tcs-uploadfit-recipes-v1'
};

const DEFAULT_SETTINGS = Object.freeze({
  width: '', height: '', maxSize: '', sizeUnit: 'MB', format: 'image/jpeg', quality: 86,
  mode: 'fit', preserveRatio: true, noUpscale: true, background: '#f4f0e7'
});

const BUILT_IN = {
  email: { width: '', height: '', maxSize: '1', sizeUnit: 'MB', format: 'image/jpeg', quality: 82, mode: 'fit', preserveRatio: true, noUpscale: true, background: '#ffffff' },
  web: { width: '1600', height: '', maxSize: '500', sizeUnit: 'KB', format: 'image/webp', quality: 82, mode: 'fit', preserveRatio: true, noUpscale: true, background: '#ffffff' },
  catalog: { width: '2000', height: '2000', maxSize: '2', sizeUnit: 'MB', format: 'image/jpeg', quality: 88, mode: 'fit', preserveRatio: true, noUpscale: true, background: '#ffffff' }
};

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }

let language = storageGet(STORAGE.language) || (navigator.language?.toLowerCase().startsWith('id') ? 'id' : 'en');
let queue = [];
let selectedId = null;
let processing = false;
let toastTimer = null;
let previousSizeUnit = 'MB';
const MAX_BATCH_RESULT_BYTES = 50 * 1024 * 1024;

function tr(key, vars) { return translate(key, language, vars); }
function newId() { return crypto.randomUUID ? crypto.randomUUID() : `uf-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function itemById(id) { return queue.find(item => item.id === id) || null; }
function fileKind(file) {
  if (file.type.startsWith('image/')) return file.type.replace('image/', '').toUpperCase();
  return file.name.split('.').pop()?.toUpperCase() || 'IMAGE';
}

function applyLanguage() {
  document.documentElement.lang = language;
  $('#language-select').value = language;
  $$('[data-i18n]').forEach(node => {
    const value = tr(node.dataset.i18n);
    if (value.includes('\n')) node.innerHTML = value.split('\n').map(part => escapeHtml(part)).join('<br>');
    else node.textContent = value;
  });
  $('#page-title').setAttribute('aria-label', tr('headlineA'));
  $('#dropzone').setAttribute('aria-label', tr('dropHeadline'));
  document.title = language === 'id' ? 'TCS UploadFit — Meja persiapan gambar' : 'TCS UploadFit — Image preparation bench';
  renderQueue();
  renderSelected();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function showToast(message, kind = '') {
  const region = $('#toast-region');
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`.trim();
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { region.replaceChildren(); }, 3900);
}

function readSettings() {
  return {
    width: $('#width-input').value.trim(),
    height: $('#height-input').value.trim(),
    maxSize: $('#max-size').value.trim(),
    sizeUnit: $('#size-unit').value,
    format: $('#format-select').value,
    quality: Number($('#quality-range').value),
    mode: $('.mode-button.active')?.dataset.mode || 'fit',
    preserveRatio: true,
    noUpscale: $('#no-upscale').checked,
    background: $('#background-color').value
  };
}

function writeSettings(settings) {
  const value = { ...DEFAULT_SETTINGS, ...settings };
  previousSizeUnit = value.sizeUnit || 'MB';
  $('#width-input').value = value.width ?? '';
  $('#height-input').value = value.height ?? '';
  $('#max-size').value = value.maxSize ?? '';
  $('#size-unit').value = value.sizeUnit || 'MB';
  $('#format-select').value = value.format || 'image/jpeg';
  $('#quality-range').value = String(value.quality ?? 86);
  $('#quality-value').textContent = `${value.quality ?? 86}%`;
  $('#no-upscale').checked = value.noUpscale !== false;
  $('#background-color').value = value.background || '#f4f0e7';
  $$('.mode-button').forEach(button => {
    const active = button.dataset.mode === (value.mode || 'fit');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateModeNote();
  updateFormatControls();
  invalidateResults();
}

function updateModeNote() {
  const mode = $('.mode-button.active')?.dataset.mode || 'fit';
  const key = mode === 'fill' ? 'fillNote' : mode === 'stretch' ? 'stretchNote' : 'fitNote';
  $('#mode-note').textContent = tr(key);
}

function updateFormatControls() {
  const format = $('#format-select').value;
  $('#max-size').max = $('#size-unit').value === 'MB' ? '100' : '102400';
  $('#quality-block').hidden = format === 'image/png';
  $('#background-block').hidden = format !== 'image/jpeg';
}

function invalidateResults() {
  if (!queue.length || processing) return;
  for (const item of queue) {
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    item.outputUrl = null;
    item.result = null;
    item.status = 'queued';
    item.error = null;
  }
  renderQueue();
  renderSelected();
}

function settingsChanged() {
  $('#preset-select').value = 'custom';
  updateFormatControls();
  invalidateResults();
}

function addFiles(fileList) {
  if (processing) return;
  const incoming = [...(fileList || [])];
  if (!incoming.length) return;
  let added = 0;
  let skipped = 0;
  for (const file of incoming) {
    const supported = file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|avif)$/i.test(file.name || '');
    const extensionSupported = /\.(jpe?g|png|webp|bmp|avif)$/i.test(file.name || '');
    const mimeSupported = ['image/jpeg','image/png','image/webp','image/bmp','image/avif'].includes(file.type);
    if (!supported || (!mimeSupported && !extensionSupported) || file.size === 0 || file.size > MAX_INPUT_BYTES || queue.length >= MAX_QUEUE) {
      skipped += 1;
      continue;
    }
    const sourceUrl = URL.createObjectURL(file);
    queue.push({ id: newId(), file, sourceUrl, outputUrl: null, status: 'queued', result: null, error: null });
    added += 1;
  }
  if (!selectedId && queue.length) selectedId = queue[0].id;
  renderQueue();
  renderSelected();
  if (added) showToast(tr('added', { count: added }), 'success');
  if (skipped) showToast(tr('invalidFiles'), 'error');
}

function renderQueue() {
  const list = $('#queue-list');
  list.replaceChildren();
  $('#queue-count').textContent = String(queue.length).padStart(2, '0');
  $('#queue-summary').textContent = queue.length ? `${queue.filter(item => item.status === 'done').length} / ${queue.length} ${language === 'id' ? 'siap' : 'prepared'}` : tr('queueEmpty');
  $('#clear-files').disabled = !queue.length || processing;
  $('#process-all').disabled = !queue.some(item => item.status !== 'done') || processing;
  $('#browse-files').disabled = processing;
  $('#file-input').disabled = processing;
  $('#dropzone').classList.toggle('is-locked', processing);
  $('#dropzone').setAttribute('aria-disabled', String(processing));

  if (!queue.length) {
    const empty = document.createElement('li');
    empty.className = 'queue-empty';
    // Keep the queue empty; do not show instructional filler in the list.
  } else {
    queue.forEach((item, index) => {
      const row = document.createElement('li');
      row.className = `queue-row${item.id === selectedId ? ' selected' : ''}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-pressed', String(item.id === selectedId));
      row.addEventListener('click', () => selectItem(item.id));
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectItem(item.id); }
      });

      const source = document.createElement('span');
      source.className = 'file-source';
      const text = document.createElement('span');
      text.style.minWidth = '0';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = item.file.name;
      name.title = item.file.name;
      const detail = document.createElement('span');
      detail.className = 'file-detail';
      detail.textContent = `${String(index + 1).padStart(2, '0')} · ${fileKind(item.file)}`;
      text.append(name, detail);
      source.append(text);

      const size = document.createElement('span');
      size.className = 'row-size';
      size.textContent = formatBytes(item.file.size);

      const status = document.createElement('span');
      status.className = `row-status ${item.status}`;
      status.textContent = tr(item.status === 'queued' ? 'queued' : item.status === 'working' ? 'working' : item.status === 'done' ? 'done' : 'error');
      status.title = item.error || '';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-row';
      remove.textContent = tr('remove');
      remove.setAttribute('aria-label', `${tr('remove')} ${item.file.name}`);
      remove.disabled = processing;
      remove.addEventListener('click', event => { event.stopPropagation(); removeItem(item.id); });

      row.append(source, size, status, remove);
      list.append(row);
    });
  }

  $('#queue-selected').textContent = selectedId ? String(Math.max(0, queue.findIndex(item => item.id === selectedId) + 1)).padStart(2, '0') : '';
  $('#download-all').disabled = !queue.some(item => item.result) || processing;
  $('#process-all').textContent = processing ? (language === 'id' ? 'SEDANG MEMPROSES…' : 'PREPARING…') : tr('prepareAll');
}

function selectItem(id) {
  selectedId = id;
  renderQueue();
  renderSelected();
}

function removeItem(id) {
  if (processing) return;
  const index = queue.findIndex(item => item.id === id);
  if (index < 0) return;
  const [removed] = queue.splice(index, 1);
  URL.revokeObjectURL(removed.sourceUrl);
  if (removed.outputUrl) URL.revokeObjectURL(removed.outputUrl);
  if (selectedId === id) selectedId = queue[Math.min(index, queue.length - 1)]?.id || null;
  renderQueue();
  renderSelected();
}

function clearQueue() {
  if (processing) return;
  queue.forEach(item => {
    URL.revokeObjectURL(item.sourceUrl);
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
  });
  queue = [];
  selectedId = null;
  renderQueue();
  renderSelected();
}

function renderSelected() {
  const item = itemById(selectedId);
  const empty = $('#proof-empty');
  const comparison = $('#comparison');
  const proofState = $('#proof-state');
  const readout = $('#proof-message');

  if (!item) {
    empty.hidden = false;
    comparison.hidden = true;
    proofState.textContent = tr('notSelected');
    proofState.className = 'proof-state';
    readout.textContent = '—';
    $('#download-selected').disabled = true;
    $('#proof-readout').querySelector('span').textContent = tr('proofReadout');
    return;
  }

  empty.hidden = true;
  comparison.hidden = false;
  $('#source-preview').src = item.sourceUrl;
  $('#source-dimensions').textContent = item.sourceDimensions || '—';
  $('#source-size').textContent = formatBytes(item.file.size);
  const outputImage = $('#output-preview');
  const outputWait = $('#output-wait');

  if (item.result) {
    outputImage.hidden = false;
    outputWait.hidden = true;
    outputImage.src = item.outputUrl;
    $('#output-dimensions').textContent = formatDimensions(item.result.width, item.result.height);
    $('#output-size').textContent = formatBytes(item.result.size);
    proofState.textContent = item.result.metLimit ? tr('preparedState') : tr('limitMissed');
    proofState.className = `proof-state ${item.result.metLimit ? 'state-good' : 'state-bad'}`;
    $('#proof-readout').querySelector('span').textContent = item.result.metLimit ? tr('limitMet') : tr('limitMissed');
    const delta = item.result.reduction;
    readout.textContent = item.result.warning || `${formatDimensions(item.result.width, item.result.height)} · ${delta >= 0 ? `${delta.toFixed(1)}% smaller` : `${Math.abs(delta).toFixed(1)}% larger`} than source`;
  } else {
    outputImage.hidden = true;
    outputImage.removeAttribute('src');
    outputWait.hidden = false;
    $('#output-dimensions').textContent = '—';
    $('#output-size').textContent = tr('outputPending');
    proofState.textContent = item.status === 'error' ? tr('error') : tr('sourceOnly');
    proofState.className = `proof-state ${item.status === 'error' ? 'state-bad' : ''}`;
    $('#proof-readout').querySelector('span').textContent = tr('proofReadout');
    readout.textContent = item.error || tr('noOutput');
  }

  $('#download-selected').disabled = !item.result || processing;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function processQueue() {
  if (processing) return;
  if (!queue.length) { showToast(tr('noFiles'), 'error'); return; }

  let settings;
  try { settings = readSettings(); } catch (error) { showToast(error.message, 'error'); return; }

  processing = true;
  const controls = ['#width-input','#height-input','#max-size','#size-unit','#format-select','#quality-range','#no-upscale','#background-color','#preset-select','#reset-settings','#save-preset'];
  controls.forEach(selector => { $(selector).disabled = true; });
  $$('.mode-button').forEach(button => { button.disabled = true; });
  renderQueue();

  const pending = queue.filter(item => item.status !== 'done');
  let completed = 0;
  let failed = 0;
  for (const item of pending) {
    item.status = 'working';
    item.error = null;
    selectedId = item.id;
    renderQueue();
    renderSelected();
    $('#process-all').textContent = tr('processing', { current: completed + failed + 1, total: pending.length });
    try {
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      const result = await processImage(item.file, settings);
      const retainedBytes = queue.reduce((sum, entry) => sum + (entry.result?.size || 0), 0);
      if (retainedBytes + result.size > MAX_BATCH_RESULT_BYTES) {
        throw new Error('The prepared batch reached its 256 MB memory limit. Export or remove completed images before preparing more.');
      }
      item.result = result;
      item.outputUrl = URL.createObjectURL(result.blob);
      item.status = 'done';
      completed += 1;
    } catch (error) {
      item.result = null;
      item.outputUrl = null;
      item.status = 'error';
      item.error = error?.message || tr('imageError');
      failed += 1;
    }
    renderQueue();
    renderSelected();
  }

  processing = false;
  controls.forEach(selector => { $(selector).disabled = false; });
  $$('.mode-button').forEach(button => { button.disabled = false; });
  renderQueue();
  renderSelected();
  if (completed && !failed) showToast(tr('allDone'), 'success');
  else if (completed || failed) showToast(tr('someFailed'), failed ? 'error' : 'success');
}

function saveSelected() {
  const item = itemById(selectedId);
  if (!item?.result) { showToast(tr('noOutput'), 'error'); return; }
  downloadBlob(item.result.blob, item.result.outputName);
  showToast(tr('saved'), 'success');
}

async function exportBatch() {
  const prepared = queue.filter(item => item.result);
  if (!prepared.length) { showToast(tr('noPrepared'), 'error'); return; }
  const button = $('#download-all');
  button.disabled = true;
  const previousText = button.textContent;
  button.textContent = tr('exporting');
  try {
    const counts = new Map();
    const entries = prepared.map(item => {
      const base = item.result.outputName;
      const count = (counts.get(base) || 0) + 1;
      counts.set(base, count);
      const name = count === 1 ? base : base.replace(/(\.[^.]+)$/i, ` (${count})$1`);
      return { name, blob: item.result.blob };
    });
    const archive = await createZip(entries);
    downloadBlob(archive, 'TCS-UploadFit-Export.zip');
    showToast(tr('zipSaved'), 'success');
  } catch (error) {
    showToast(`${tr('presetNotSupported')} ${error.message || ''}`, 'error');
  } finally {
    button.textContent = previousText;
    renderQueue();
  }
}

function readCustomPresets() {
  try {
    const parsed = JSON.parse(storageGet(STORAGE.presets) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.name === 'string' && item.settings && typeof item.settings === 'object').slice(0, 30) : [];
  } catch {
    return [];
  }
}

let customPresets = readCustomPresets();
function persistPresets() {
  if (!storageSet(STORAGE.presets, JSON.stringify(customPresets))) showToast(language === 'id' ? 'Penyimpanan lokal penuh atau tidak tersedia.' : 'Local storage is full or unavailable.', 'error');
}

function applySelectedPreset() {
  const id = $('#preset-select').value;
  if (BUILT_IN[id]) {
    writeSettings(BUILT_IN[id]);
    return;
  }
  const preset = customPresets.find(item => item.id === id);
  if (preset) writeSettings(preset.settings);
  else writeSettings(DEFAULT_SETTINGS);
}

function refreshPresetOptions() {
  const select = $('#preset-select');
  const current = select.value;
  const previousCustom = customPresets.map(preset => preset.id);
  $$('.custom-preset-option', select).forEach(option => option.remove());
  customPresets.forEach(preset => {
    const option = document.createElement('option');
    option.className = 'custom-preset-option';
    option.value = preset.id;
    option.textContent = `LOCAL · ${preset.name}`;
    select.append(option);
  });
  if (current === 'custom' || BUILT_IN[current] || previousCustom.includes(current)) select.value = current;
  else select.value = 'custom';
}

function commitPreset(event) {
  event.preventDefault();
  const name = $('#preset-name').value.trim();
  if (!name) { showToast(tr('presetNameRequired'), 'error'); return; }
  if (customPresets.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { showToast(tr('presetNameExists'), 'error'); return; }
  if (customPresets.length >= 30) { showToast(tr('presetLimit'), 'error'); return; }
  customPresets.push({ id: `recipe-${newId()}`, name, settings: readSettings() });
  persistPresets();
  refreshPresetOptions();
  $('#preset-select').value = customPresets.at(-1).id;
  $('#preset-dialog').close();
  $('#preset-name').value = '';
  showToast(tr('presetSaved'), 'success');
}

function handleSettingsEvents() {
  ['#width-input','#height-input','#max-size','#format-select','#no-upscale','#background-color'].forEach(selector => {
    $(selector).addEventListener('change', settingsChanged);
  });
  $('#quality-range').addEventListener('input', () => {
    $('#quality-value').textContent = `${$('#quality-range').value}%`;
    settingsChanged();
  });
  $$('.mode-button').forEach(button => button.addEventListener('click', () => {
    $$('.mode-button').forEach(choice => {
      const active = choice === button;
      choice.classList.toggle('active', active);
      choice.setAttribute('aria-pressed', String(active));
    });
    updateModeNote();
    settingsChanged();
  }));
  $('#preset-select').addEventListener('change', applySelectedPreset);
  $('#size-unit').addEventListener('change', () => {
    const nextUnit = $('#size-unit').value;
    const sizeInput = $('#max-size');
    if (sizeInput.value.trim() !== '') {
      const numeric = Number(sizeInput.value);
      if (Number.isFinite(numeric)) {
        const converted = previousSizeUnit === 'MB' && nextUnit === 'KB' ? numeric * 1024 : previousSizeUnit === 'KB' && nextUnit === 'MB' ? numeric / 1024 : numeric;
        sizeInput.value = String(Number(converted.toFixed(3)));
      }
    }
    previousSizeUnit = nextUnit;
    settingsChanged();
  });
  $('#reset-settings').addEventListener('click', () => {
    $('#preset-select').value = 'custom';
    writeSettings(DEFAULT_SETTINGS);
    showToast(tr('settingsReset'));
  });
  $('#save-preset').addEventListener('click', () => {
    $('#preset-name').value = '';
    $('#preset-dialog').showModal();
    $('#preset-name').focus();
  });
  $('#preset-form').addEventListener('submit', commitPreset);
  $('#cancel-preset').addEventListener('click', () => $('#preset-dialog').close());
}

function handleFileEvents() {
  $('#browse-files').addEventListener('click', event => { event.stopPropagation(); if (!processing) $('#file-input').click(); });
  $('#dropzone').addEventListener('click', event => {
    if (processing || event.target.closest('button')) return;
    $('#file-input').click();
  });
  $('#dropzone').addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !processing) { event.preventDefault(); $('#file-input').click(); }
  });
  $('#file-input').addEventListener('change', event => {
    addFiles(event.target.files);
    event.target.value = '';
  });
  const dropzone = $('#dropzone');
  ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault();
    if (processing) return;
    event.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('drag-active');
  }));
  ['dragleave', 'dragend', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.remove('drag-active');
  }));
  dropzone.addEventListener('drop', event => { if (!processing) addFiles(event.dataTransfer.files); });
  $('#clear-files').addEventListener('click', clearQueue);
  $('#process-all').addEventListener('click', processQueue);
  $('#download-selected').addEventListener('click', saveSelected);
  $('#download-all').addEventListener('click', exportBatch);
}

function boot() {
  $('#source-preview').addEventListener('load', event => {
    const image = event.currentTarget;
    const item = itemById(selectedId);
    if (item && image.naturalWidth && image.naturalHeight) {
      item.sourceDimensions = formatDimensions(image.naturalWidth, image.naturalHeight);
      $('#source-dimensions').textContent = item.sourceDimensions;
    }
  });
  applyLanguage();
  refreshPresetOptions();
  writeSettings(DEFAULT_SETTINGS);
  $('#language-select').addEventListener('change', event => {
    language = event.target.value === 'id' ? 'id' : 'en';
    storageSet(STORAGE.language, language);
    applyLanguage();
  });
  handleSettingsEvents();
  handleFileEvents();
  renderQueue();
  renderSelected();
  window.addEventListener('pagehide', () => {
    queue.forEach(item => {
      URL.revokeObjectURL(item.sourceUrl);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    });
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

boot();
