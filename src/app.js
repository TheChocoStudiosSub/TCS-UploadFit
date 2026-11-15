import { formatBytes, formatDimensions, normalizeSettings, processImage } from './processor.js';
import { createZip } from './zip.js';
import { translate } from './i18n.js';
import { EDITION } from './edition.js';
import { validateIncomingFiles } from './file-validation.js';
import { filterValidPresets } from './presets.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const MAX_QUEUE = EDITION.maxImages;
const MAX_INPUT_BYTES = EDITION.maxInputBytes;
const STORAGE = {
  language: 'tcs-uploadfit-language-v1',
  presets: 'tcs-uploadfit-recipes-v1'
};

const DEFAULT_SETTINGS = Object.freeze({
  width: '', height: '', maxSize: '', sizeUnit: 'MB', format: 'image/jpeg', quality: 86,
  targetMode: 'max', mode: 'fit', background: '#f4f0e7'
});

const BUILT_IN = {
  email: { width: '', height: '', maxSize: '1', sizeUnit: 'MB', format: 'image/jpeg', quality: 82, targetMode: 'max', mode: 'fit', background: '#ffffff' },
  web: { width: '1600', height: '', maxSize: '500', sizeUnit: 'KB', format: 'image/webp', quality: 82, targetMode: 'max', mode: 'fit', background: '#ffffff' },
  catalog: { width: '2000', height: '2000', maxSize: '2', sizeUnit: 'MB', format: 'image/jpeg', quality: 88, targetMode: 'frame', mode: 'fit', background: '#ffffff' }
};

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }

let language = storageGet(STORAGE.language) || (navigator.language?.toLowerCase().startsWith('id') ? 'id' : 'en');
let queue = [];
let selectedId = null;
let processing = false;
let processController = null;
let activeWorker = null;
let cancelRequested = false;
let toastTimer = null;
let previousSizeUnit = 'MB';
const MAX_BATCH_RESULT_BYTES = EDITION.maxBatchOutputBytes;

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
  document.title = EDITION.title[language] || EDITION.title.en;
  const description = $('meta[name="description"]');
  if (description) description.content = EDITION.description[language] || EDITION.description.en;
  $$('[data-edition-badge]').forEach(node => {
    node.hidden = !EDITION.showDemoBadge;
    node.textContent = EDITION.badgeText;
  });
  updateModeNote();
  updatePresetDeleteButton();
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
    targetMode: $('.target-mode-button.active')?.dataset.targetMode || 'max',
    mode: $('.mode-button.active')?.dataset.mode || 'fit',
    background: $('#background-color').value
  };
}

function writeSettings(settings) {
  const targetMode = settings.targetMode || (Object.hasOwn(settings, 'mode') ? 'frame' : 'max');
  const value = { ...DEFAULT_SETTINGS, ...settings, targetMode };
  previousSizeUnit = value.sizeUnit || 'MB';
  $('#width-input').value = value.width ?? '';
  $('#height-input').value = value.height ?? '';
  $('#max-size').value = value.maxSize ?? '';
  $('#size-unit').value = value.sizeUnit || 'MB';
  $('#format-select').value = value.format || 'image/jpeg';
  $('#quality-range').value = String(value.quality ?? 86);
  $('#quality-value').textContent = `${value.quality ?? 86}%`;
  $('#background-color').value = value.background || '#f4f0e7';
  $$('.target-mode-button').forEach(button => {
    const active = button.dataset.targetMode === (value.targetMode || (settings.mode ? 'frame' : 'max'));
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
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
  const targetMode = $('.target-mode-button.active')?.dataset.targetMode || 'max';
  $('#frame-mode-controls').hidden = targetMode !== 'frame';
  $('#target-note').textContent = tr(targetMode === 'max' ? 'maxModeNote' : 'exactModeNote');
  if (targetMode !== 'frame') return;
  const mode = $('.mode-button.active')?.dataset.mode || 'fit';
  const key = mode === 'fill' ? 'fillNote' : mode === 'stretch' ? 'stretchNote' : 'fitNote';
  $('#mode-note').textContent = tr(key);
}

function updateFormatControls() {
  const format = $('#format-select').value;
  $('#max-size').max = String($('#size-unit').value === 'MB'
    ? MAX_BATCH_RESULT_BYTES / (1024 * 1024)
    : MAX_BATCH_RESULT_BYTES / 1024);
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
  const { accepted, skipped } = validateIncomingFiles(
    incoming, queue.map(item => item.file), MAX_QUEUE, MAX_INPUT_BYTES
  );
  for (const file of accepted) {
    const sourceUrl = URL.createObjectURL(file);
    queue.push({ id: newId(), file, sourceUrl, outputUrl: null, status: 'queued', result: null, error: null });
  }
  if (!selectedId && queue.length) selectedId = queue[0].id;
  renderQueue();
  renderSelected();
  if (accepted.length) showToast(tr('added', { count: accepted.length }), 'success');
  if (Object.values(skipped).some(count => count > 0)) showToast(tr('fileSkippedSummary', skipped), 'error');
}


function renderQueue() {
  const list = $('#queue-list');
  list.replaceChildren();
  $('#queue-count').textContent = String(queue.length).padStart(2, '0');
  const preparedCount = queue.filter(item => item.status === 'done').length;
  $('#queue-summary').textContent = queue.length
    ? tr('queueSummary', { prepared: preparedCount, total: queue.length })
    : tr('queueEmpty');
  $('#queue-status').textContent = queue.length
    ? tr('queueSummary', { prepared: preparedCount, total: queue.length })
    : tr('queueEmpty');
  $('#clear-files').disabled = !queue.length || processing;
  $('#process-all').disabled = !queue.some(item => item.status !== 'done') || processing;
  $('#browse-files').disabled = processing;
  $('#file-input').disabled = processing;
  $('#dropzone').classList.toggle('is-locked', processing);
  $('#dropzone').setAttribute('aria-disabled', String(processing));
  $('#cancel-process').hidden = !processing;

  if (queue.length) {
    queue.forEach((item, index) => {
      const row = document.createElement('li');
      row.className = `queue-row${item.id === selectedId ? ' selected' : ''}`;
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'queue-select';
      choose.setAttribute('aria-pressed', String(item.id === selectedId));
      choose.setAttribute('aria-label', tr('selectQueueItem', {
        name: item.file.name,
        selected: item.id === selectedId ? tr('selected') : ''
      }));
      choose.addEventListener('click', () => selectItem(item.id));

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

      choose.append(source, size, status);
      row.append(choose, remove);
      list.append(row);
    });
  }

  $('#queue-selected').textContent = selectedId ? String(Math.max(0, queue.findIndex(item => item.id === selectedId) + 1)).padStart(2, '0') : '';
  $('#download-all').disabled = !queue.some(item => item.result) || processing;
  $('#process-all').textContent = processing ? tr('preparing') : tr('prepareAll');
  updatePresetDeleteButton();
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
    readout.textContent = item.result.downscaled
      ? [tr('resolutionDownscaled', {
          from: formatDimensions(item.result.sourceWidth, item.result.sourceHeight),
          to: formatDimensions(item.result.width, item.result.height)
        }), item.result.warning].filter(Boolean).join(' ')
      : item.result.warning || tr('reductionSummary', {
          dimensions: formatDimensions(item.result.width, item.result.height),
          percent: Math.abs(delta).toFixed(1),
          direction: delta >= 0 ? tr('smaller') : tr('larger')
        });
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

function abortError() {
  const error = new Error(tr('processingCancelled'));
  error.name = 'AbortError';
  return error;
}

function processImageInWorker(file, settings, signal) {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') {
    return processImage(file, settings, { signal, language });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker?.terminate();
      if (activeWorker === worker) activeWorker = null;
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    try {
      worker = new Worker(new URL('./processor.worker.js', import.meta.url), { type: 'module' });
      activeWorker = worker;
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = event => {
        finish();
        if (event.data?.ok) resolve(event.data.result);
        else {
          const error = new Error(event.data?.error || tr('imageError'));
          error.name = event.data?.name || 'Error';
          reject(error);
        }
      };
      worker.onerror = event => {
        finish();
        reject(new Error(event.message || tr('imageError')));
      };
      worker.postMessage({ file, settings, language });
    } catch (error) {
      finish();
      if (error?.name === 'AbortError') reject(error);
      else processImage(file, settings, { signal, language }).then(resolve, reject);
    }
  });
}

function cancelProcessQueue() {
  if (!processing) return;
  cancelRequested = true;
  processController?.abort();
  activeWorker?.terminate();
  activeWorker = null;
}

async function processQueue() {
  if (processing) return;
  if (!queue.length) { showToast(tr('noFiles'), 'error'); return; }

  let settings;
  try {
    settings = { ...normalizeSettings(readSettings(), language), _normalized: true };
  } catch (error) {
    showToast(error.message || tr('invalidSettings'), 'error');
    return;
  }

  processing = true;
  cancelRequested = false;
  processController = new AbortController();
  const controls = ['#width-input','#height-input','#max-size','#size-unit','#format-select','#quality-range','#background-color','#preset-select','#reset-settings','#save-preset'];
  let completed = 0;
  let failed = 0;
  const pending = queue.filter(item => item.status !== 'done');
  controls.forEach(selector => { $(selector).disabled = true; });
  $$('.mode-button, .target-mode-button').forEach(button => { button.disabled = true; });
  $('#cancel-process').hidden = false;
  $('#cancel-process').disabled = false;

  try {
    renderQueue();
    for (const item of pending) {
      if (cancelRequested) break;
      item.status = 'working';
      item.error = null;
      selectedId = item.id;
      renderQueue();
      renderSelected();
      $('#process-all').textContent = tr('processing', { current: completed + failed + 1, total: pending.length });
      try {
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
        const result = await processImageInWorker(item.file, settings, processController.signal);
        if (cancelRequested) throw abortError();
        const retainedBytes = queue.reduce((sum, entry) => sum + (entry.id === item.id ? 0 : (entry.result?.size || 0)), 0);
        if (retainedBytes + result.size > MAX_BATCH_RESULT_BYTES) {
          throw new Error(tr('batchLimitReached', { maxOutputSize: formatBytes(MAX_BATCH_RESULT_BYTES) }));
        }
        item.result = result;
        item.outputUrl = URL.createObjectURL(result.blob);
        item.status = 'done';
        completed += 1;
      } catch (error) {
        if (error?.name === 'AbortError' || cancelRequested) {
          item.status = 'queued';
          item.error = null;
          break;
        }
        item.result = null;
        item.outputUrl = null;
        item.status = 'error';
        item.error = error?.message || tr('imageError');
        failed += 1;
      }
      renderQueue();
      renderSelected();
    }
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(error?.message || tr('imageError'), 'error');
  } finally {
    activeWorker?.terminate();
    activeWorker = null;
    processController = null;
    processing = false;
    controls.forEach(selector => { $(selector).disabled = false; });
    $$('.mode-button, .target-mode-button').forEach(button => { button.disabled = false; });
    $('#cancel-process').hidden = true;
    $('#cancel-process').disabled = true;
    try {
      renderQueue();
      renderSelected();
    } catch (error) {
      console.error(tr('queueRefreshFailed'), error);
    }
  }

  if (cancelRequested) showToast(tr('processingCancelled'), 'success');
  else if (completed && !failed) showToast(tr('allDone'), 'success');
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
      return { name, blob: item.result.blob, lastModified: item.file.lastModified };
    });
    const archive = await createZip(entries, { language });
    downloadBlob(archive, 'TCS-UploadFit-Export.zip');
    showToast(tr('zipSaved'), 'success');
  } catch (error) {
    showToast(error?.message || tr('zipNotSupported'), 'error');
  } finally {
    button.textContent = previousText;
    renderQueue();
  }
}

function readCustomPresets() {
  try {
    const parsed = JSON.parse(storageGet(STORAGE.presets) || '[]');
    return filterValidPresets(parsed, settings => normalizeSettings(settings, language), 30);
  } catch {
    return [];
  }
}

let customPresets = readCustomPresets();
function persistPresets() {
  if (!storageSet(STORAGE.presets, JSON.stringify(customPresets))) showToast(tr('storageUnavailable'), 'error');
}

function applySelectedPreset() {
  const id = $('#preset-select').value;
  if (BUILT_IN[id]) {
    writeSettings(BUILT_IN[id]);
    return;
  }
  const preset = customPresets.find(item => item.id === id);
  if (preset) {
    try {
      normalizeSettings(preset.settings, language);
      writeSettings(preset.settings);
    } catch {
      customPresets = customPresets.filter(item => item.id !== preset.id);
      persistPresets();
      refreshPresetOptions();
      $('#preset-select').value = 'custom';
      showToast(tr('invalidPreset'), 'error');
    }
  } else writeSettings(DEFAULT_SETTINGS);
  updatePresetDeleteButton();
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
    option.textContent = tr('customPresetOption', { name: preset.name });
    select.append(option);
  });
  if (current === 'custom' || BUILT_IN[current] || previousCustom.includes(current)) select.value = current;
  else select.value = 'custom';
  updatePresetDeleteButton();
}

function updatePresetDeleteButton() {
  const selected = $('#preset-select')?.value;
  $('#delete-preset').disabled = processing || !customPresets.some(preset => preset.id === selected);
}

function deleteSelectedPreset() {
  const selected = $('#preset-select').value;
  if (!customPresets.some(item => item.id === selected)) return;
  customPresets = customPresets.filter(item => item.id !== selected);
  persistPresets();
  refreshPresetOptions();
  $('#preset-select').value = 'custom';
  updatePresetDeleteButton();
  showToast(tr('presetDeleted'), 'success');
}

function commitPreset(event) {
  event.preventDefault();
  const name = $('#preset-name').value.trim();
  if (!name) { showToast(tr('presetNameRequired'), 'error'); return; }
  if (customPresets.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { showToast(tr('presetNameExists'), 'error'); return; }
  if (customPresets.length >= 30) { showToast(tr('presetLimit'), 'error'); return; }
  const settings = readSettings();
  try {
    normalizeSettings(settings, language);
  } catch (error) {
    showToast(error.message || tr('invalidSettings'), 'error');
    return;
  }
  customPresets.push({ id: `recipe-${newId()}`, name, settings });
  persistPresets();
  refreshPresetOptions();
  $('#preset-select').value = customPresets.at(-1).id;
  updatePresetDeleteButton();
  $('#preset-dialog').close();
  $('#preset-name').value = '';
  showToast(tr('presetSaved'), 'success');
}

function handleSettingsEvents() {
  ['#width-input','#height-input','#max-size','#format-select','#background-color'].forEach(selector => {
    $(selector).addEventListener('change', settingsChanged);
  });
  $('#quality-range').addEventListener('input', () => {
    $('#quality-value').textContent = `${$('#quality-range').value}%`;
    settingsChanged();
  });
  $$('.target-mode-button').forEach(button => button.addEventListener('click', () => {
    $$('.target-mode-button').forEach(choice => {
      const active = choice === button;
      choice.classList.toggle('active', active);
      choice.setAttribute('aria-pressed', String(active));
    });
    updateModeNote();
    settingsChanged();
  }));
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
  $('#delete-preset').addEventListener('click', deleteSelectedPreset);
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
  $('#cancel-process').addEventListener('click', cancelProcessQueue);
  $('#download-selected').addEventListener('click', saveSelected);
  $('#download-all').addEventListener('click', exportBatch);
}

function boot() {
  $('#width-input').max = String(EDITION.maxOutputEdge);
  $('#height-input').max = String(EDITION.maxOutputEdge);
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
