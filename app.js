// ------------------------------------------------------------------
// Service worker
// ------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.error('Service worker registration failed', err);
    });
  });

  // Auto-reload when a new SW takes control, so updates land without a manual
  // second refresh.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

// ------------------------------------------------------------------
// State + DOM refs
// ------------------------------------------------------------------
const els = {
  tabs: document.querySelectorAll('.tab-btn'),
  panes: document.querySelectorAll('.tab-pane'),
};

let currentTab = 'today';

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
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
function init() {
  els.tabs.forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
  setTab('today');
}

init();
