// ------------------------------------------------------------------
// Service worker
// ------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.error('Service worker registration failed', err);
    });
  });

  // Auto-reload when a new SW takes control so updates land without a second refresh.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

// ------------------------------------------------------------------
// Database
// ------------------------------------------------------------------
const db = new Dexie('Plants');
db.version(1).stores({
  rooms:       '++id, &uuid, order',
  plants:      '++id, &uuid, room_id',
  care_events: '++id, &uuid, plant_id, timestamp',
});

// ------------------------------------------------------------------
// State + DOM refs
// ------------------------------------------------------------------
const els = {
  tabs:         document.querySelectorAll('.tab-btn'),
  panes:        document.querySelectorAll('.tab-pane'),
  plantsPane:   document.querySelector('[data-pane="plants"]'),
  overlay:      document.getElementById('plant-overlay'),
  overlayPanel: document.getElementById('plant-overlay-panel'),
};

let currentTab = 'today';
let modalMode  = null; // 'add' | 'edit' | 'room-edit'
let editingId  = null; // plant id or room id

// ------------------------------------------------------------------
// Data access
// ------------------------------------------------------------------
async function getRooms() {
  return db.rooms.orderBy('order').toArray();
}

async function getPlants(room_id) {
  return db.plants.where('room_id').equals(room_id).sortBy('created_at');
}

async function getAllPlants() {
  return db.plants.toArray();
}

async function addRoom(name) {
  const maxOrderRoom = await db.rooms.orderBy('order').last();
  const order = maxOrderRoom ? maxOrderRoom.order + 1 : 0;
  const now = new Date().toISOString();
  const id = await db.rooms.add({ uuid: crypto.randomUUID(), name, order, created_at: now });
  window.scheduleBackup?.();
  return id;
}

async function updateRoom(id, changes) {
  const result = await db.rooms.update(id, changes);
  window.scheduleBackup?.();
  return result;
}

async function deleteRoom(id) {
  const count = await db.plants.where('room_id').equals(id).count();
  if (count > 0) throw new Error('Remove all plants from this room first.');
  const result = await db.rooms.delete(id);
  window.scheduleBackup?.();
  return result;
}

async function addPlant(fields) {
  const now = new Date().toISOString();
  const id = await db.plants.add({ uuid: crypto.randomUUID(), created_at: now, ...fields });
  window.scheduleBackup?.();
  return id;
}

async function updatePlant(id, changes) {
  const result = await db.plants.update(id, changes);
  window.scheduleBackup?.();
  return result;
}

async function deletePlant(id) {
  const result = await db.plants.delete(id);
  window.scheduleBackup?.();
  return result;
}

async function logCareEvent(plant_id, kind) {
  const id = await db.care_events.add({
    uuid: crypto.randomUUID(),
    plant_id,
    kind,
    timestamp: new Date().toISOString(),
  });
  window.scheduleBackup?.();
  return id;
}

async function getLastCareEventsMap() {
  const events = await db.care_events.orderBy('timestamp').toArray();
  const map = new Map();
  for (const ev of events) {
    const entry = map.get(ev.plant_id) || { water: null, feed: null };
    const ts = new Date(ev.timestamp);
    if (ev.kind === 'water' && (!entry.water || ts > entry.water)) entry.water = ts;
    if (ev.kind === 'feed'  && (!entry.feed  || ts > entry.feed))  entry.feed  = ts;
    map.set(ev.plant_id, entry);
  }
  return map;
}

async function addPlantWithNewRoom(plantFields, roomName) {
  const result = await db.transaction('rw', db.rooms, db.plants, async () => {
    const maxOrderRoom = await db.rooms.orderBy('order').last();
    const order = maxOrderRoom ? maxOrderRoom.order + 1 : 0;
    const now = new Date().toISOString();
    const roomId = await db.rooms.add({ uuid: crypto.randomUUID(), name: roomName, order, created_at: now });
    await db.plants.add({ uuid: crypto.randomUUID(), created_at: now, ...plantFields, room_id: roomId });
  });
  window.scheduleBackup?.();
  return result;
}

// ------------------------------------------------------------------
// Gemini AI
// ------------------------------------------------------------------
function getGeminiKey() { return (localStorage.getItem('plants.geminiKey') || '').trim(); }
function getAiContext() { return (localStorage.getItem('plants.aiContext') || '').trim(); }

async function requestPlantAutofill(promptText, roomName) {
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error('No API key configured');

  const prompt = `You are a houseplant-care assistant. Given a short description of a plant, return prettified details and sensible UK indoor care cadences.\n\n[AI CONTEXT]\n${getAiContext() || 'No standing context set.'}\n\n[ROOM]\n${roomName || 'unspecified'}\n\n[INPUT]\n${promptText}\n\nRespond with a JSON object matching this exact schema:\n{\n  "name": "<short prettified plant name>",\n  "emoji": "<single emoji that best characterises this plant — NOT limited to leaf/plant glyphs; e.g. 🦜 for a bird of paradise, 🌵 for a cactus, 🍃 for a trailing pothos>",\n  "water_days": <integer days>,\n  "feed_days": <integer days or null if it doesn't need feeding>,\n  "feed_label": "<the kind of feed, e.g. tomato feed, 4:4:4 liquid feed, ericaceous feed; empty if none>",\n  "notes": "<one or two short care lines: light, humidity, watering style>"\n}`;

  const base = 'https://generativelanguage.googleapis.com/v1beta/models';
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  const fetchModel = (model) => fetch(`${base}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const isQuotaError = (status) => status === 429 || status === 403;

  let res = await fetchModel('gemini-2.5-flash');
  let modelUsed = 'gemini-2.5-flash';
  if (isQuotaError(res.status)) {
    console.warn(`[ai] ${modelUsed} quota hit (${res.status}), falling back to gemini-2.0-flash`);
    res = await fetchModel('gemini-2.0-flash');
    modelUsed = 'gemini-2.0-flash';
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status} (${modelUsed}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Empty response from Gemini');
  return JSON.parse(raw);
}

// ------------------------------------------------------------------
// Due logic
// ------------------------------------------------------------------
function calendarDaysBetween(fromDate, toDate) {
  const from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const to   = new Date(toDate.getFullYear(),   toDate.getMonth(),   toDate.getDate());
  return Math.round((to - from) / 86400000);
}

function dueStatus(plant, kind, lastEventDate, today) {
  const cadence = kind === 'water' ? plant.water_days : plant.feed_days;
  if (!cadence) return { status: 'na', daysSince: null, daysUntil: null, label: '' };

  let daysSince;
  let neverLogged = false;
  if (lastEventDate) {
    daysSince = calendarDaysBetween(lastEventDate, today);
  } else {
    neverLogged = true;
    daysSince = calendarDaysBetween(new Date(plant.created_at), today);
  }

  const daysUntil = cadence - daysSince;

  let status, label;
  if (daysUntil < 0) {
    status = 'overdue';
    const late = Math.abs(daysUntil);
    label = neverLogged ? `never ${kind}ed` : `${late} day${late !== 1 ? 's' : ''} late`;
  } else if (daysUntil === 0) {
    status = 'due';
    label = neverLogged ? `never ${kind}ed` : 'due today';
  } else {
    status = 'future';
    label = `in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;
  }

  return { status, daysSince, daysUntil, label };
}

// ------------------------------------------------------------------
// Today tab — render
// ------------------------------------------------------------------
const WATER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l4.5 6.5a5.5 5.5 0 1 1-9 0z"/></svg>`;
const FEED_SVG  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21V11a5 5 0 0 1 10 0v10"/><path d="M12 11V3"/></svg>`;

async function renderToday() {
  const todayPane = document.querySelector('[data-pane="today"]');
  const today = new Date();

  const [plants, rooms, lastEventsMap] = await Promise.all([
    getAllPlants(),
    getRooms(),
    getLastCareEventsMap(),
  ]);

  const roomsById = new Map(rooms.map(r => [r.id, r]));

  // Compute statuses for each plant
  const entries = plants.map(plant => {
    const last = lastEventsMap.get(plant.id) || { water: null, feed: null };
    const water = dueStatus(plant, 'water', last.water, today);
    const feed  = dueStatus(plant, 'feed',  last.feed,  today);
    return { plant, water, feed };
  });

  // Filter to plants with at least one due/overdue action
  const due = entries.filter(e =>
    e.water.status === 'due' || e.water.status === 'overdue' ||
    e.feed.status  === 'due' || e.feed.status  === 'overdue'
  );

  // Sort: overdue first (by urgency desc), then due (by name)
  due.sort((a, b) => {
    const aWorst = worstUrgency(a);
    const bWorst = worstUrgency(b);
    if (aWorst !== bWorst) return bWorst - aWorst; // more urgent first
    return (a.plant.name || '').localeCompare(b.plant.name || '');
  });

  // Count action buttons
  let totalActions = 0;
  let overdueActions = 0;
  for (const e of due) {
    if (e.water.status === 'due' || e.water.status === 'overdue') {
      totalActions++;
      if (e.water.status === 'overdue') overdueActions++;
    }
    if (e.feed.status === 'due' || e.feed.status === 'overdue') {
      totalActions++;
      if (e.feed.status === 'overdue') overdueActions++;
    }
  }

  todayPane.innerHTML = '';

  // Headline
  const headline = document.createElement('div');
  headline.className = 'today-headline';
  const dateStr = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const metaStr = due.length === 0
    ? 'All caught up'
    : `<strong>${totalActions}</strong> task${totalActions !== 1 ? 's' : ''} today${overdueActions > 0 ? ` &middot; <strong>${overdueActions}</strong> overdue` : ''}`;
  headline.innerHTML = `
    <h1 class="today-headline-date">${escHtml(dateStr)}</h1>
    <p class="today-headline-meta">${metaStr}</p>
  `;
  todayPane.appendChild(headline);

  if (due.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'Nothing due today 🌱';
    todayPane.appendChild(empty);
    return;
  }

  for (const entry of due) {
    todayPane.appendChild(buildPlantCard(entry, roomsById));
  }

  // Spacer so last card scrolls above nav
  const spacer = document.createElement('div');
  spacer.style.height = '32px';
  spacer.setAttribute('aria-hidden', 'true');
  todayPane.appendChild(spacer);
}

function worstUrgency(entry) {
  // Higher = more urgent. overdue beats due; more days overdue beats fewer.
  let score = 0;
  for (const kind of ['water', 'feed']) {
    const s = entry[kind];
    if (s.status === 'overdue') score = Math.max(score, 1000 + (s.daysSince - (kind === 'water' ? entry.plant.water_days : entry.plant.feed_days)));
    else if (s.status === 'due') score = Math.max(score, 1);
  }
  return score;
}

function buildPlantCard(entry, roomsById) {
  const { plant, water, feed } = entry;
  const room = roomsById.get(plant.room_id);

  const article = document.createElement('article');
  const cardOverdue = water.status === 'overdue' || feed.status === 'overdue';
  article.className = 'plant-card' + (cardOverdue ? ' is-overdue' : '');

  // Card head
  const head = document.createElement('div');
  head.className = 'plant-card-head';

  const emojiSpan = document.createElement('span');
  emojiSpan.className = 'plant-emoji';
  emojiSpan.textContent = plant.emoji || '🌱';

  const titles = document.createElement('div');
  titles.className = 'plant-titles';
  const nameEl = document.createElement('h2');
  nameEl.className = 'plant-name';
  nameEl.textContent = plant.name;
  if (plant.quantity > 1) {
    const qty = document.createElement('span');
    qty.className = 'qty';
    qty.textContent = `×${plant.quantity}`;
    nameEl.appendChild(document.createTextNode(' '));
    nameEl.appendChild(qty);
  }
  const metaEl = document.createElement('p');
  metaEl.className = 'plant-meta';
  const roomName = room ? room.name : '';
  metaEl.textContent = `${roomName} · water every ${plant.water_days}d`;

  titles.appendChild(nameEl);
  titles.appendChild(metaEl);

  // Best status pill (water wins if both active)
  const pillStatus = water.status === 'overdue' || water.status === 'due' ? water.status : feed.status;
  const pillLabel  = water.status === 'overdue' || water.status === 'due' ? water.label : feed.label;
  const pill = document.createElement('span');
  pill.className = `status-pill is-${pillStatus}`;
  pill.textContent = pillLabel;

  head.appendChild(emojiSpan);
  head.appendChild(titles);
  head.appendChild(pill);
  article.appendChild(head);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'plant-actions';

  if (water.status !== 'na') {
    actions.appendChild(buildActionBtn('water', water, plant, article));
  }
  if (feed.status !== 'na') {
    actions.appendChild(buildActionBtn('feed', feed, plant, article));
  }

  article.appendChild(actions);
  return article;
}

function buildActionBtn(kind, statusObj, plant, cardEl) {
  const btn = document.createElement('button');
  btn.className = `action-btn is-${statusObj.status}`;
  btn.type = 'button';

  const row = document.createElement('span');
  row.className = 'action-btn-row';
  row.innerHTML = kind === 'water' ? WATER_SVG : FEED_SVG;

  const labelText = kind === 'water' ? 'Water' : (plant.feed_label ? `Feed (${plant.feed_label})` : 'Feed');
  row.appendChild(document.createTextNode(` ${labelText}`));

  const sub = document.createElement('span');
  sub.className = 'action-btn-status';
  if (statusObj.status === 'overdue' || statusObj.status === 'due') {
    sub.textContent = `${statusObj.label} · tap to log`;
  } else {
    sub.textContent = statusObj.label;
  }

  btn.appendChild(row);
  btn.appendChild(sub);

  if (statusObj.status === 'overdue' || statusObj.status === 'due') {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      await logCareEvent(plant.id, kind);
      renderToday();
      renderPlants();
    });
  }

  return btn;
}

// ------------------------------------------------------------------
// Tab switching
// ------------------------------------------------------------------
function setTab(tab) {
  currentTab = tab;
  els.tabs.forEach((btn) => {
    btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false');
  });
  els.panes.forEach((pane) => {
    pane.hidden = pane.dataset.pane !== tab;
  });
  if (tab === 'plants') renderPlants();
  if (tab === 'today')  renderToday();
}

// ------------------------------------------------------------------
// Plants tab — render
// ------------------------------------------------------------------
async function renderPlants() {
  const pane = els.plantsPane;
  const [rooms, allPlants, lastEventsMap] = await Promise.all([getRooms(), getAllPlants(), getLastCareEventsMap()]);

  pane.innerHTML = '';

  const headline = document.createElement('div');
  headline.className = 'plants-headline';
  if (allPlants.length === 0 && rooms.length === 0) {
    headline.innerHTML = '<h2>All plants</h2><p>No plants yet — tap + to add one</p>';
  } else {
    const rc = rooms.length;
    const pc = allPlants.length;
    headline.innerHTML = `<h2>All plants</h2><p>${rc} room${rc !== 1 ? 's' : ''} &middot; ${pc} plant${pc !== 1 ? 's' : ''}</p>`;
  }
  pane.appendChild(headline);

  for (const room of rooms) {
    const plants = await getPlants(room.id);
    pane.appendChild(buildRoomSection(room, plants, lastEventsMap));
  }

  // Spacer so the last room scrolls above the FAB
  const spacer = document.createElement('div');
  spacer.style.height = '96px';
  spacer.setAttribute('aria-hidden', 'true');
  pane.appendChild(spacer);

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Add plant');
  fab.textContent = '+';
  fab.addEventListener('click', () => openAddModal());
  pane.appendChild(fab);
}

function buildRoomSection(room, plants, lastEventsMap) {
  const section = document.createElement('section');
  section.className = 'room';

  const header = document.createElement('header');
  header.className = 'room-head';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.innerHTML = `
    <h3 class="room-name">${escHtml(room.name)}</h3>
    <span class="room-count">${plants.length} plant${plants.length !== 1 ? 's' : ''}</span>
  `;
  header.addEventListener('click', () => openRoomEditModal(room));
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRoomEditModal(room); }
  });
  section.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'plant-list';
  for (const plant of plants) {
    const lastEvents = lastEventsMap ? (lastEventsMap.get(plant.id) || { water: null, feed: null }) : { water: null, feed: null };
    list.appendChild(buildPlantRow(plant, lastEvents));
  }
  section.appendChild(list);
  return section;
}

function buildPlantRow(plant, lastEvents) {
  const li = document.createElement('li');
  li.className = 'plant-row';

  let schedule = `Water every ${plant.water_days}d`;
  if (plant.feed_days) {
    schedule += ` · Feed every ${plant.feed_days}d`;
    if (plant.feed_label) schedule += ` (${escHtml(plant.feed_label)})`;
  }

  const qty = plant.quantity > 1 ? ` <span class="qty">×${plant.quantity}</span>` : '';
  li.innerHTML = `
    <span class="plant-row-emoji">${escHtml(plant.emoji || '🌱')}</span>
    <div>
      <h4 class="plant-row-name">${escHtml(plant.name)}${qty}</h4>
      <p class="plant-row-schedule">${schedule}</p>
    </div>
    <span class="plant-row-meta">${lastWateredLabel(lastEvents && lastEvents.water)}</span>
  `;
  li.addEventListener('click', () => openEditModal(plant));
  return li;
}

function lastWateredLabel(waterDate) {
  if (!waterDate) return 'never';
  const today = new Date();
  const days = calendarDaysBetween(waterDate, today);
  if (days === 0) return 'today';
  return `${days}d ago`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------
// Add/Edit plant modal
// ------------------------------------------------------------------
function openAddModal() {
  modalMode = 'add';
  editingId = null;
  renderModal({ mode: 'add' });
  showOverlay();
}

function openEditModal(plant) {
  modalMode = 'edit';
  editingId = plant.id;
  renderModal({ mode: 'edit', plant });
  showOverlay();
}

function openRoomEditModal(room) {
  modalMode = 'room-edit';
  editingId = room.id;
  renderModal({ mode: 'room-edit', room });
  showOverlay();
}

function showOverlay() {
  els.overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeOverlay() {
  els.overlay.hidden = true;
  document.body.style.overflow = '';
  modalMode = null;
  editingId = null;
}

async function renderModal(opts) {
  const rooms = await getRooms();
  if (opts.mode === 'room-edit') {
    renderRoomEditModal(opts.room, rooms);
  } else {
    renderPlantModal(opts, rooms);
  }
}

function renderRoomEditModal(room, _rooms) {
  els.overlayPanel.innerHTML = `
    <div class="settings-header">
      <button class="btn btn-ghost" id="modal-close-btn" type="button">Close</button>
      <h2 class="modal-title">Edit room</h2>
      <div class="modal-header-spacer" aria-hidden="true"></div>
    </div>
    <div class="settings-body">
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-room-name">Room name</label>
        <input class="ai-config-input" id="field-room-name" type="text" value="${escHtml(room.name)}" maxlength="60" autocomplete="off">
        <p class="field-error" id="field-room-name-error" hidden></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modal-save-btn" type="button">Save</button>
      </div>
      <div id="delete-area">
        <button class="btn btn-danger" id="modal-delete-btn" type="button">Delete room</button>
      </div>
    </div>
  `;

  const panel = els.overlayPanel;
  panel.querySelector('#modal-close-btn').addEventListener('click', closeOverlay);

  panel.querySelector('#modal-save-btn').addEventListener('click', async () => {
    const nameEl = panel.querySelector('#field-room-name');
    const errEl  = panel.querySelector('#field-room-name-error');
    const name   = nameEl.value.trim();
    if (!name) { showFieldError(errEl, 'Name is required.'); return; }
    await updateRoom(room.id, { name });
    closeOverlay();
    renderPlants();
  });

  panel.querySelector('#modal-delete-btn').addEventListener('click', async () => {
    const deleteArea = panel.querySelector('#delete-area');
    try {
      await deleteRoom(room.id);
      closeOverlay();
      renderPlants();
    } catch (e) {
      deleteArea.innerHTML = `<p class="field-error">${escHtml(e.message)}</p>`;
    }
  });
}

function renderPlantModal(opts, rooms) {
  const plant  = opts.plant || {};
  const isEdit = opts.mode === 'edit';
  const title  = isEdit ? 'Edit plant' : 'Add plant';
  const panel  = els.overlayPanel;

  const roomOptions = rooms.map(r =>
    `<option value="${r.id}"${plant.room_id === r.id ? ' selected' : ''}>${escHtml(r.name)}</option>`
  ).join('');

  panel.innerHTML = `
    <div class="settings-header">
      <button class="btn btn-ghost" id="modal-close-btn" type="button">Close</button>
      <h2 class="modal-title">${title}</h2>
      <div class="modal-header-spacer" aria-hidden="true"></div>
    </div>
    <div class="settings-body">
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-ai-prompt">Describe it, let AI fill the rest</label>
        <div class="ai-prompt-wrap">
          <textarea class="ai-config-input" id="field-ai-prompt" rows="2" placeholder="medium calathea in a 20cm pot">${escHtml(plant.ai_prompt || '')}</textarea>
          <button id="ai-generate-btn" class="ai-button" type="button" aria-label="Fill plant details with AI">&#10024;</button>
        </div>
        <p id="ai-status" class="sync-status" aria-live="polite"></p>
      </div>
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-name">Name</label>
        <input class="ai-config-input" id="field-name" type="text" value="${escHtml(plant.name || '')}" maxlength="80" autocomplete="off">
        <p class="field-error" id="field-name-error" hidden></p>
      </div>
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-emoji">Emoji</label>
        <input class="ai-config-input" id="field-emoji" type="text" value="${escHtml(plant.emoji || '🌱')}" maxlength="4" autocomplete="off">
      </div>
      <div class="ai-config-section" id="room-section">
        <label class="ai-config-label" for="field-room">Room</label>
        <select class="ai-config-input" id="field-room">
          ${roomOptions}
          <option value="__new__">+ New room…</option>
        </select>
        <p class="field-error" id="field-room-error" hidden></p>
      </div>
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-quantity">Quantity</label>
        <input class="ai-config-input" id="field-quantity" type="number" min="1" value="${plant.quantity || 1}">
      </div>
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-water-days">Water every (days)</label>
        <input class="ai-config-input" id="field-water-days" type="number" min="1" value="${plant.water_days || 7}">
        <p class="field-error" id="field-water-days-error" hidden></p>
      </div>
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-feed-days">Feed every (days) <span class="ai-config-hint">optional</span></label>
        <input class="ai-config-input" id="field-feed-days" type="number" min="1" value="${plant.feed_days || ''}">
      </div>
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-feed-label">Feed label <span class="ai-config-hint">optional, e.g. tomato</span></label>
        <input class="ai-config-input" id="field-feed-label" type="text" value="${escHtml(plant.feed_label || '')}" maxlength="40" autocomplete="off">
      </div>
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-notes">Notes <span class="ai-config-hint">optional</span></label>
        <textarea class="ai-config-input" id="field-notes" rows="3">${escHtml(plant.notes || '')}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modal-save-btn" type="button">${isEdit ? 'Save changes' : 'Add plant'}</button>
      </div>
      ${isEdit ? `
        <div id="delete-area"><button class="btn btn-danger" id="modal-delete-btn" type="button">Delete plant</button></div>
        <div id="dev-area">
          <p class="dev-area-label">Testing</p>
          <div class="dev-area-btns">
            <button class="btn btn-ghost dev-btn" id="dev-water-btn" type="button">Water due today</button>
            ${plant.feed_days ? '<button class="btn btn-ghost dev-btn" id="dev-feed-btn" type="button">Feed due today</button>' : ''}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const roomSection  = panel.querySelector('#room-section');
  const roomSelectEl = panel.querySelector('#field-room');

  // Auto-swap to text input when there are no existing rooms
  if (rooms.length === 0) {
    swapRoomSelectForInput(roomSection, rooms);
  } else {
    roomSelectEl.addEventListener('change', () => {
      if (roomSelectEl.value === '__new__') swapRoomSelectForInput(roomSection, rooms);
    });
  }

  panel.querySelector('#modal-close-btn').addEventListener('click', closeOverlay);
  panel.querySelector('#modal-save-btn').addEventListener('click', () => savePlantModal(panel, isEdit, rooms));

  const aiBtn    = panel.querySelector('#ai-generate-btn');
  const aiStatus = panel.querySelector('#ai-status');
  const setAiStatus = (text, tone) => {
    aiStatus.textContent = text || '';
    aiStatus.classList.remove('is-info', 'is-error', 'is-ok');
    if (tone) aiStatus.classList.add(`is-${tone}`);
  };
  aiBtn.addEventListener('click', async () => {
    const promptText = panel.querySelector('#field-ai-prompt').value.trim();
    if (!promptText) { setAiStatus('Describe the plant first.', 'error'); return; }

    const roomNewEl    = panel.querySelector('#field-room-new');
    const roomSelectEl = panel.querySelector('#field-room');
    let roomName = 'unspecified';
    if (roomNewEl) {
      roomName = roomNewEl.value.trim() || 'unspecified';
    } else if (roomSelectEl) {
      const room = rooms.find(r => String(r.id) === roomSelectEl.value);
      if (room) roomName = room.name;
    }

    aiBtn.disabled = true;
    aiBtn.textContent = '⏳';
    setAiStatus('Generating…', 'info');
    try {
      const result = await requestPlantAutofill(promptText, roomName);
      if (result.name != null)  panel.querySelector('#field-name').value  = result.name;
      if (result.emoji)         panel.querySelector('#field-emoji').value = result.emoji;
      if (result.water_days != null) panel.querySelector('#field-water-days').value = result.water_days;
      panel.querySelector('#field-feed-days').value  = result.feed_days != null ? result.feed_days : '';
      panel.querySelector('#field-feed-label').value = result.feed_label || '';
      panel.querySelector('#field-notes').value      = result.notes || '';
      setAiStatus('Filled — review and save.', 'ok');
    } catch (err) {
      const msg = /No API key/.test(err.message)
        ? 'Set your Gemini key in Settings.'
        : `Couldn't generate: ${err.message.slice(0, 80)}`;
      setAiStatus(msg, 'error');
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = '✨';
    }
  });

  if (isEdit) {
    panel.querySelector('#modal-delete-btn').addEventListener('click', () => {
      showDeleteConfirm(panel, async () => {
        await deletePlant(editingId);
        closeOverlay();
        renderPlants();
      });
    });

    panel.querySelector('#dev-water-btn').addEventListener('click', async () => {
      await markDueToday(plant.id, 'water', plant.water_days);
    });
    panel.querySelector('#dev-feed-btn')?.addEventListener('click', async () => {
      await markDueToday(plant.id, 'feed', plant.feed_days);
    });
  }
}

async function markDueToday(plant_id, kind, cadence) {
  await db.care_events.where('plant_id').equals(plant_id).filter(e => e.kind === kind).delete();
  await db.care_events.add({
    uuid: crypto.randomUUID(),
    plant_id,
    kind,
    timestamp: new Date(Date.now() - cadence * 86400000).toISOString(),
  });
  closeOverlay();
  renderToday();
  renderPlants();
}

function swapRoomSelectForInput(roomSection, rooms) {
  const select = roomSection.querySelector('#field-room');
  const label  = roomSection.querySelector('label');

  const input = document.createElement('input');
  input.className = 'ai-config-input';
  input.id = 'field-room-new';
  input.type = 'text';
  input.maxLength = 60;
  input.placeholder = 'New room name';
  input.autocomplete = 'off';
  select.replaceWith(input);
  input.focus();

  if (rooms.length > 0) {
    const revert = document.createElement('button');
    revert.className = 'btn btn-ghost';
    revert.type = 'button';
    revert.textContent = 'Use existing room';
    revert.style.alignSelf = 'flex-start';
    revert.style.marginTop = '2px';
    revert.addEventListener('click', () => {
      input.replaceWith(select);
      revert.remove();
      // Re-attach change listener since the element was re-inserted
      select.addEventListener('change', () => {
        if (select.value === '__new__') swapRoomSelectForInput(roomSection, rooms);
      }, { once: true });
    });
    label.insertAdjacentElement('afterend', revert);
    // Move error p back to end
    const errEl = roomSection.querySelector('#field-room-error');
    if (errEl) roomSection.appendChild(errEl);
  }
}

async function savePlantModal(panel, isEdit, rooms) {
  const nameEl      = panel.querySelector('#field-name');
  const emojiEl     = panel.querySelector('#field-emoji');
  const quantityEl  = panel.querySelector('#field-quantity');
  const waterEl     = panel.querySelector('#field-water-days');
  const feedEl      = panel.querySelector('#field-feed-days');
  const feedLabelEl = panel.querySelector('#field-feed-label');
  const notesEl     = panel.querySelector('#field-notes');
  const aiPromptEl  = panel.querySelector('#field-ai-prompt');

  const nameErrEl  = panel.querySelector('#field-name-error');
  const waterErrEl = panel.querySelector('#field-water-days-error');
  const roomErrEl  = panel.querySelector('#field-room-error');

  // Validate
  const name = nameEl.value.trim();
  if (!name) { showFieldError(nameErrEl, 'Name is required.'); nameEl.focus(); return; }
  hideFieldError(nameErrEl);

  const water_days = parseInt(waterEl.value, 10);
  if (!water_days || water_days < 1) { showFieldError(waterErrEl, 'Must be at least 1.'); waterEl.focus(); return; }
  hideFieldError(waterErrEl);

  const emoji      = emojiEl.value.trim() || '🌱';
  const quantity   = Math.max(1, parseInt(quantityEl.value, 10) || 1);
  const feed_days  = parseInt(feedEl.value, 10) || null;
  const feed_label = feedLabelEl.value.trim() || null;
  const notes      = notesEl.value.trim() || null;
  const ai_prompt  = aiPromptEl.value.trim() || null;

  const roomNewEl    = panel.querySelector('#field-room-new');
  const roomSelectEl = panel.querySelector('#field-room');

  if (roomNewEl) {
    const roomName = roomNewEl.value.trim();
    if (!roomName) { showFieldError(roomErrEl, 'Enter a room name.'); roomNewEl.focus(); return; }
    hideFieldError(roomErrEl);
    const fields = { name, emoji, quantity, water_days, feed_days, feed_label, notes, ai_prompt };
    if (isEdit) {
      const newRoomId = await addRoom(roomName);
      await updatePlant(editingId, { ...fields, room_id: newRoomId });
    } else {
      await addPlantWithNewRoom(fields, roomName);
    }
  } else if (roomSelectEl) {
    const room_id = parseInt(roomSelectEl.value, 10);
    if (isNaN(room_id)) { showFieldError(roomErrEl, 'Select a room.'); return; }
    hideFieldError(roomErrEl);
    const fields = { name, emoji, quantity, water_days, feed_days, feed_label, notes, ai_prompt, room_id };
    if (isEdit) {
      await updatePlant(editingId, fields);
    } else {
      await addPlant(fields);
    }
  }

  closeOverlay();
  renderPlants();
}

function showDeleteConfirm(panel, onConfirm) {
  const deleteArea = panel.querySelector('#delete-area');
  deleteArea.innerHTML = `
    <div class="delete-confirm-row">
      <button class="btn btn-ghost" id="delete-cancel-btn" type="button">Cancel</button>
      <button class="btn btn-danger" id="delete-confirm-btn" type="button">Delete</button>
    </div>
  `;
  deleteArea.querySelector('#delete-cancel-btn').addEventListener('click', () => {
    deleteArea.innerHTML = '<button class="btn btn-danger" id="modal-delete-btn" type="button">Delete plant</button>';
    deleteArea.querySelector('#modal-delete-btn').addEventListener('click', () => showDeleteConfirm(panel, onConfirm));
  });
  deleteArea.querySelector('#delete-confirm-btn').addEventListener('click', onConfirm);
}

function showFieldError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideFieldError(el) {
  if (!el) return;
  el.hidden = true;
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
function init() {
  els.tabs.forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    window.openSettings?.();
  });

  // Close overlay on backdrop tap or Escape
  els.overlay.addEventListener('click', (e) => {
    if (e.target === els.overlay) closeOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.overlay.hidden) closeOverlay();
  });

  setTab('today');
}

init();
