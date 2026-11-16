// Versionsvergleich für den Updater – eigene Datei, damit er ohne Electron testbar ist.

/** "1.10.2" > "1.9.0" – ein führendes "v" (Tag) wird ignoriert */
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

module.exports = { newer };
