// ---- Google Sheets sync ----
const CLIENT_ID = '58841586776-1vdq0r1ns3aa0j6upk273v8eavcanbto.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';

const SHEET_ID_KEY      = 'plants.sheetId';
const EMAIL_KEY         = 'plants.email';
const BACKUP_PENDING_KEY = 'plants.backupPending';
// Token cached in sessionStorage so SW-triggered reloads don't re-fire the silent OAuth flow.
const TOKEN_CACHE_KEY   = 'plants.sync.token';

const SHEET_SCHEMA_VERSION = 1;

const ROOMS_HEADER       = ['uuid', 'name', 'order', 'created_at'];
const PLANTS_HEADER      = ['uuid', 'room_uuid', 'name', 'emoji', 'quantity', 'water_days', 'feed_days', 'feed_label', 'notes', 'created_at'];
const CARE_EVENTS_HEADER = ['uuid', 'plant_uuid', 'kind', 'timestamp'];

let tokenClient    = null;
let accessToken    = null;
let tokenExpiresAt = 0;

const syncUI = {
  overlay: null,
  url:     null,
  connect: null,
  backup:  null,
  restore: null,
  forget:  null,
  link:    null,
  status:  null,
};

// ---- localStorage helpers ----
function getSheetId()   { return localStorage.getItem(SHEET_ID_KEY); }
function setSheetId(id) { localStorage.setItem(SHEET_ID_KEY, id); }
function clearSheetId() { localStorage.removeItem(SHEET_ID_KEY); }

function getEmail()    { return localStorage.getItem(EMAIL_KEY); }
function setEmail(e)   { localStorage.setItem(EMAIL_KEY, e); }
function clearEmail()  { localStorage.removeItem(EMAIL_KEY); }

// ---- Token management (ported from food-and-weight/sync.js) ----
function tokenValid() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

function loadCachedToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return false;
    const { token, expiresAt } = JSON.parse(raw);
    if (token && expiresAt && Date.now() < expiresAt) {
      accessToken    = token;
      tokenExpiresAt = expiresAt;
      return true;
    }
    sessionStorage.removeItem(TOKEN_CACHE_KEY);
  } catch {
    sessionStorage.removeItem(TOKEN_CACHE_KEY);
  }
  return false;
}

function saveCachedToken() {
  if (!accessToken || !tokenExpiresAt) return;
  try {
    sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ token: accessToken, expiresAt: tokenExpiresAt }));
  } catch {}
}

function clearCachedToken() {
  try { sessionStorage.removeItem(TOKEN_CACHE_KEY); } catch {}
}

function ensureClient() {
  if (tokenClient) return true;
  if (!window.google?.accounts?.oauth2) return false;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    use_fedcm_for_prompt: true,
    callback: () => {},
    error_callback: () => {},
  });
  return true;
}

function requestToken({ silent }) {
  return new Promise((resolve, reject) => {
    if (!ensureClient()) { reject(new Error('GIS not ready')); return; }
    let settled = false;
    const settle = (fn) => (...args) => { if (settled) return; settled = true; fn(...args); };

    tokenClient.callback = settle((resp) => {
      if (resp.error) { reject(new Error(`${resp.error}: ${resp.error_description || ''}`)); return; }
      accessToken    = resp.access_token;
      tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
      saveCachedToken();
      resolve(resp);
    });
    tokenClient.error_callback = settle((err) => {
      reject(new Error(`${err?.type || 'error'}: ${err?.message || JSON.stringify(err)}`));
    });
    if (silent) {
      setTimeout(settle(() => reject(new Error('silent attempt timed out'))), 8000);
    }
    const params = { prompt: silent ? '' : 'consent' };
    const hint = getEmail();
    if (hint) params.hint = hint;
    tokenClient.requestAccessToken(params);
  });
}

async function captureEmailIfNeeded() {
  if (getEmail()) return;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.email) {
      setEmail(data.email);
      console.log('[sync] Account pinned:', data.email);
    }
  } catch (err) {
    console.warn('[sync] Email capture failed:', err.message);
  }
}

async function ensureFreshToken() {
  if (tokenValid()) return accessToken;
  await requestToken({ silent: true });
  return accessToken;
}

// ---- API wrapper ----
async function apiCall(url, opts = {}) {
  const token = await ensureFreshToken();
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err  = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    err.status  = res.status;
    throw err;
  }
  return res.json();
}

// ---- Sheet bootstrap ----
async function ensureSheet() {
  if (getSheetId()) return;
  console.log('[sync] Creating sheet…');
  const data = await apiCall('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: 'Plants log' },
      sheets: [
        { properties: { title: 'Rooms' } },
        { properties: { title: 'Plants' } },
        { properties: { title: 'CareEvents' } },
        { properties: { title: 'Metadata' } },
      ],
    }),
  });
  const sid = data.spreadsheetId;
  setSheetId(sid);
  console.log('[sync] Sheet created:', sid);

  await apiCall(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/Rooms!A1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [ROOMS_HEADER] }) }
  );
  await apiCall(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/Plants!A1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [PLANTS_HEADER] }) }
  );
  await apiCall(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/CareEvents!A1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [CARE_EVENTS_HEADER] }) }
  );
  await apiCall(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/Metadata!A1:B1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [['schema_version', SHEET_SCHEMA_VERSION]] }) }
  );
}

function extractSheetId(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  const m = trimmed.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

async function attachToSheet(input) {
  const sheetId = extractSheetId(input);
  if (!sheetId) throw new Error('Could not find a sheet ID in that URL');

  await ensureFreshToken();
  const meta = await apiCall(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`
  );
  const metadataTab = (meta.sheets || []).find(s => s.properties?.title === 'Metadata');
  if (!metadataTab) throw new Error('Sheet has no "Metadata" tab — wrong file?');

  setSheetId(sheetId);
}

// ---- Backup (local → sheet, full replace) ----
async function backupToSheet() {
  if (!getSheetId()) return;
  if (!navigator.onLine) {
    localStorage.setItem(BACKUP_PENDING_KEY, '1');
    console.log('[sync] Offline — backup queued');
    return;
  }

  try {
    await ensureFreshToken();
    const sid = getSheetId();

    const [rooms, plants, careEvents] = await Promise.all([
      getRooms(),
      getAllPlants(),
      db.care_events.toArray(),
    ]);

    const roomIdToUuid  = new Map(rooms.map(r => [r.id, r.uuid]));
    const plantIdToUuid = new Map(plants.map(p => [p.id, p.uuid]));

    const roomRows = rooms.map(r => [r.uuid, r.name, r.order ?? 0, r.created_at]);
    const plantRows = plants.map(p => [
      p.uuid,
      roomIdToUuid.get(p.room_id) || '',
      p.name,
      p.emoji || '',
      p.quantity ?? 1,
      p.water_days ?? '',
      p.feed_days ?? '',
      p.feed_label || '',
      p.notes || '',
      p.created_at,
    ]);
    const careRows = careEvents.map(e => [
      e.uuid,
      plantIdToUuid.get(e.plant_id) || '',
      e.kind,
      e.timestamp,
    ]);

    const now = new Date().toISOString();

    async function replaceTab(tab, header, rows) {
      await apiCall(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchClear`,
        { method: 'POST', body: JSON.stringify({ ranges: [`${tab}!A:Z`] }) }
      );
      await apiCall(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${tab}!A1?valueInputOption=RAW`,
        { method: 'PUT', body: JSON.stringify({ values: [header, ...rows] }) }
      );
    }

    await replaceTab('Rooms', ROOMS_HEADER, roomRows);
    await replaceTab('Plants', PLANTS_HEADER, plantRows);
    await replaceTab('CareEvents', CARE_EVENTS_HEADER, careRows);

    await apiCall(
      `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/Metadata!A1:B2?valueInputOption=RAW`,
      {
        method: 'PUT',
        body: JSON.stringify({
          values: [
            ['schema_version', SHEET_SCHEMA_VERSION],
            ['last_backup_at', now],
          ],
        }),
      }
    );

    localStorage.removeItem(BACKUP_PENDING_KEY);
    setSyncStatus(`Backed up at ${new Date(now).toLocaleTimeString()}`, 'ok');
    renderSyncUI();
    console.log('[sync] Backup complete');
  } catch (err) {
    localStorage.setItem(BACKUP_PENDING_KEY, '1');
    console.warn('[sync] Backup failed:', err.message);
    setSyncStatus(`Backup failed: ${err.message.slice(0, 100)}`, 'error');
  }
}

let backupTimer = null;
function scheduleBackup() {
  if (!getSheetId()) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupToSheet().catch(err => console.warn('[sync] scheduleBackup error:', err.message));
  }, 2000);
}
window.scheduleBackup = scheduleBackup;

// ---- Restore (sheet → local, full replace) ----
async function restoreFromSheet() {
  if (!getSheetId()) { setSyncStatus('No sheet connected.', 'error'); return; }

  setSyncStatus('Restoring…', 'info');
  try {
    await ensureFreshToken();
    const sid = getSheetId();

    const [roomsData, plantsData, careData] = await Promise.all([
      apiCall(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/Rooms!A:Z`),
      apiCall(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/Plants!A:Z`),
      apiCall(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/CareEvents!A:Z`),
    ]);

    const roomRows  = (roomsData.values  || []).slice(1);
    const plantRows = (plantsData.values || []).slice(1);
    const careRows  = (careData.values   || []).slice(1);

    await db.transaction('rw', db.rooms, db.plants, db.care_events, async () => {
      await db.rooms.clear();
      await db.plants.clear();
      await db.care_events.clear();

      const roomUuidToId  = new Map();
      const plantUuidToId = new Map();
      const now = new Date().toISOString();

      for (const row of roomRows) {
        const [uuid, name, order, created_at] = row;
        if (!uuid) continue;
        const id = await db.rooms.add({
          uuid,
          name: name || '',
          order: Number(order) || 0,
          created_at: created_at || now,
        });
        roomUuidToId.set(uuid, id);
      }

      for (const row of plantRows) {
        const [uuid, room_uuid, name, emoji, quantity, water_days, feed_days, feed_label, notes, created_at] = row;
        if (!uuid) continue;
        const room_id = roomUuidToId.get(room_uuid);
        if (room_id == null) continue;
        const id = await db.plants.add({
          uuid,
          room_id,
          name: name || '',
          emoji: emoji || '🌱',
          quantity: Number(quantity) || 1,
          water_days: Number(water_days) || null,
          feed_days: Number(feed_days) || null,
          feed_label: feed_label || null,
          notes: notes || null,
          created_at: created_at || now,
        });
        plantUuidToId.set(uuid, id);
      }

      for (const row of careRows) {
        const [uuid, plant_uuid, kind, timestamp] = row;
        if (!uuid) continue;
        const plant_id = plantUuidToId.get(plant_uuid);
        if (plant_id == null) continue;
        await db.care_events.add({ uuid, plant_id, kind: kind || 'water', timestamp: timestamp || now });
      }
    });

    if (typeof renderToday  === 'function') renderToday();
    if (typeof renderPlants === 'function') renderPlants();

    const rc = roomRows.filter(r => r[0]).length;
    const pc = plantRows.filter(r => r[0]).length;
    const ec = careRows.filter(r => r[0]).length;
    setSyncStatus(`Restored ${rc} rooms, ${pc} plants, ${ec} events.`, 'ok');
    console.log('[sync] Restore complete');
  } catch (err) {
    console.warn('[sync] Restore failed:', err.message);
    setSyncStatus(`Restore failed: ${err.message.slice(0, 100)}`, 'error');
  }
}

// ---- Sync UI controller ----
function setSyncStatus(text, tone) {
  if (!syncUI.status) return;
  syncUI.status.textContent = text || '';
  syncUI.status.classList.remove('is-error', 'is-info', 'is-ok');
  if (tone) syncUI.status.classList.add(`is-${tone}`);
}

function renderSyncUI() {
  const connected = !!getSheetId();
  if (syncUI.link) {
    syncUI.link.hidden = !connected;
    if (connected) syncUI.link.href = `https://docs.google.com/spreadsheets/d/${getSheetId()}/edit`;
  }
  if (syncUI.forget)  syncUI.forget.hidden    = !connected;
  if (syncUI.backup)  syncUI.backup.disabled  = !connected;
  if (syncUI.restore) syncUI.restore.disabled = !connected;
  if (syncUI.connect) syncUI.connect.textContent = connected ? 'Reconnect' : 'Connect';
}

function openSettings() {
  if (!syncUI.overlay) return;
  renderSyncUI();
  syncUI.overlay.hidden = false;
}

function closeSettings() {
  if (!syncUI.overlay) return;
  syncUI.overlay.hidden = true;
}

window.openSettings  = openSettings;
window.closeSettings = closeSettings;

async function actionConnect() {
  setSyncStatus('', '');
  const inputVal = syncUI.url?.value || '';
  try {
    if (inputVal.trim()) {
      setSyncStatus('Attaching…', 'info');
      await requestToken({ silent: false });
      await captureEmailIfNeeded();
      await attachToSheet(inputVal);
      if (syncUI.url) syncUI.url.value = '';
      renderSyncUI();
      setSyncStatus('Attached. Running first backup…', 'info');
      await backupToSheet();
    } else {
      setSyncStatus('Creating sheet…', 'info');
      await requestToken({ silent: false });
      await captureEmailIfNeeded();
      await ensureSheet();
      renderSyncUI();
      setSyncStatus('Connected. Running first backup…', 'info');
      await backupToSheet();
    }
  } catch (err) {
    console.warn('[sync] Connect failed:', err.message);
    setSyncStatus(`Connect failed: ${err.message.slice(0, 120)}`, 'error');
  }
}

async function actionBackup() {
  if (!getSheetId()) { setSyncStatus('No sheet connected.', 'error'); return; }
  setSyncStatus('Backing up…', 'info');
  await backupToSheet();
}

async function actionRestore() {
  if (!getSheetId()) { setSyncStatus('No sheet connected.', 'error'); return; }
  if (!confirm('This will wipe all local data and replace it with the Google Sheet. Continue?')) return;
  await restoreFromSheet();
}

function actionForget() {
  clearSheetId();
  clearEmail();
  clearCachedToken();
  localStorage.removeItem(BACKUP_PENDING_KEY);
  accessToken    = null;
  tokenExpiresAt = 0;
  tokenClient    = null;
  console.log('[sync] Disconnected');
  renderSyncUI();
  setSyncStatus('Disconnected.', 'info');
}

function bindSyncUI() {
  syncUI.overlay = document.getElementById('settings-overlay');
  syncUI.url     = document.getElementById('sync-url');
  syncUI.connect = document.getElementById('sync-connect');
  syncUI.backup  = document.getElementById('sync-backup');
  syncUI.restore = document.getElementById('sync-restore');
  syncUI.forget  = document.getElementById('sync-forget');
  syncUI.link    = document.getElementById('sync-sheet-link');
  syncUI.status  = document.getElementById('sync-status');

  const closeBtn = document.getElementById('settings-close');
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  if (syncUI.overlay) {
    syncUI.overlay.addEventListener('click', (e) => {
      if (e.target === syncUI.overlay) closeSettings();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && syncUI.overlay && !syncUI.overlay.hidden) closeSettings();
  });

  if (syncUI.connect) syncUI.connect.addEventListener('click', actionConnect);
  if (syncUI.backup)  syncUI.backup.addEventListener('click',  actionBackup);
  if (syncUI.restore) syncUI.restore.addEventListener('click', actionRestore);
  if (syncUI.forget)  syncUI.forget.addEventListener('click',  actionForget);
}

function initOnLoad() {
  if (!window.google?.accounts?.oauth2) {
    setTimeout(initOnLoad, 200);
    return;
  }
  bindSyncUI();
  renderSyncUI();
  if (!getSheetId()) return;

  const hadCachedToken = loadCachedToken();
  (async () => {
    if (!tokenValid()) {
      await requestToken({ silent: true });
      console.log('[sync] Silent re-auth ok');
    } else {
      console.log('[sync] Reusing cached token (skipping OAuth)');
    }
    await captureEmailIfNeeded();
    if (localStorage.getItem(BACKUP_PENDING_KEY)) {
      console.log('[sync] Retrying pending backup');
      await backupToSheet();
    }
  })().catch((err) => {
    console.warn('[sync] init failed:', err.message);
    if (hadCachedToken) {
      accessToken    = null;
      tokenExpiresAt = 0;
      clearCachedToken();
    }
  });
}

initOnLoad();
