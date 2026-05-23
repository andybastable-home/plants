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
  return db.rooms.add({ uuid: crypto.randomUUID(), name, order, created_at: now });
}

async function updateRoom(id, changes) {
  return db.rooms.update(id, changes);
}

async function deleteRoom(id) {
  const count = await db.plants.where('room_id').equals(id).count();
  if (count > 0) throw new Error('Remove all plants from this room first.');
  return db.rooms.delete(id);
}

async function addPlant(fields) {
  const now = new Date().toISOString();
  return db.plants.add({ uuid: crypto.randomUUID(), created_at: now, ...fields });
}

async function updatePlant(id, changes) {
  return db.plants.update(id, changes);
}

async function deletePlant(id) {
  return db.plants.delete(id);
}

async function addPlantWithNewRoom(plantFields, roomName) {
  return db.transaction('rw', db.rooms, db.plants, async () => {
    const maxOrderRoom = await db.rooms.orderBy('order').last();
    const order = maxOrderRoom ? maxOrderRoom.order + 1 : 0;
    const now = new Date().toISOString();
    const roomId = await db.rooms.add({ uuid: crypto.randomUUID(), name: roomName, order, created_at: now });
    await db.plants.add({ uuid: crypto.randomUUID(), created_at: now, ...plantFields, room_id: roomId });
  });
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
}

// ------------------------------------------------------------------
// Plants tab — render
// ------------------------------------------------------------------
async function renderPlants() {
  const pane = els.plantsPane;
  const [rooms, allPlants] = await Promise.all([getRooms(), getAllPlants()]);

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
    pane.appendChild(buildRoomSection(room, plants));
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

function buildRoomSection(room, plants) {
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
    list.appendChild(buildPlantRow(plant));
  }
  section.appendChild(list);
  return section;
}

function buildPlantRow(plant) {
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
    <span class="plant-row-meta"></span>
  `;
  li.addEventListener('click', () => openEditModal(plant));
  return li;
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
      <button class="btn btn-primary" id="modal-save-btn" type="button">Save</button>
    </div>
    <div class="settings-body">
      <div class="ai-config-section">
        <label class="ai-config-label" for="field-room-name">Room name</label>
        <input class="ai-config-input" id="field-room-name" type="text" value="${escHtml(room.name)}" maxlength="60" autocomplete="off">
        <p class="field-error" id="field-room-name-error" hidden></p>
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
      <button class="btn btn-primary" id="modal-save-btn" type="button">${isEdit ? 'Save' : 'Add'}</button>
    </div>
    <div class="settings-body">
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
      ${isEdit ? '<div id="delete-area"><button class="btn btn-danger" id="modal-delete-btn" type="button">Delete plant</button></div>' : ''}
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

  if (isEdit) {
    panel.querySelector('#modal-delete-btn').addEventListener('click', () => {
      showDeleteConfirm(panel, async () => {
        await deletePlant(editingId);
        closeOverlay();
        renderPlants();
      });
    });
  }
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

  const roomNewEl    = panel.querySelector('#field-room-new');
  const roomSelectEl = panel.querySelector('#field-room');

  if (roomNewEl) {
    const roomName = roomNewEl.value.trim();
    if (!roomName) { showFieldError(roomErrEl, 'Enter a room name.'); roomNewEl.focus(); return; }
    hideFieldError(roomErrEl);
    const fields = { name, emoji, quantity, water_days, feed_days, feed_label, notes };
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
    const fields = { name, emoji, quantity, water_days, feed_days, feed_label, notes, room_id };
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
