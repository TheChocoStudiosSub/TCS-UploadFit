export function filterValidPresets(value, validateSettings, maximum = 30) {
  if (!Array.isArray(value) || !Number.isInteger(maximum) || maximum < 1) return [];
  const valid = [];
  const ids = new Set();

  for (const item of value) {
    if (!item || typeof item.id !== 'string' || !item.id.startsWith('recipe-')
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40
      || !item.settings || typeof item.settings !== 'object' || Array.isArray(item.settings)
      || ids.has(item.id)) continue;
    try {
      const settings = { ...item.settings };
      delete settings._normalized;
      validateSettings(settings);
      valid.push({ id: item.id, name: item.name.trim(), settings });
      ids.add(item.id);
    } catch {
      // Invalid or outdated local data is ignored rather than applied to the controls.
    }
    if (valid.length >= maximum) break;
  }
  return valid;
}
