let playlist = [];
let deletedStack = [];
let undoTimer = null;
let dragSrcIndex = null;

const accordionEl = document.getElementById('accordion');
const accordionToggle = document.getElementById('accordionToggle');
const channelListEl = document.getElementById('channelList');
const selectedCountEl = document.getElementById('selectedCount');
const playlistEl = document.getElementById('playlist');
const emptyStateEl = document.getElementById('emptyState');
const undoToast = document.getElementById('undoToast');
const undoBtn = document.getElementById('undoBtn');
const undoText = document.getElementById('undoText');
const refreshTimeEl = document.getElementById('refreshTime');
const openInYTBtn = document.getElementById('openInYT');

// --- INIT ---
async function init() {
  const data = await chrome.storage.local.get(['playlist', 'selectedChannels', 'lastFetch', 'refreshHour', 'currentVideoId']);
  playlist = data.playlist || [];
  currentIndex = 0;

  updateRefreshTime(data.lastFetch, data.refreshHour);
  renderPlaylist();
  loadChannelList(data.selectedChannels || []);

  updateOpenButton();
}

// --- ACCORDION ---
accordionToggle.addEventListener('click', () => {
  accordionEl.classList.toggle('open');
});

async function loadChannelList(selected) {
  const { token } = await chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' }).catch(() => ({ token: null }));
  if (!token) { channelListEl.innerHTML = '<div style="color:#555;font-size:13px">Потрібен вхід через Google</div>'; return; }

  let channels = [];
  let pageToken = '';
  do {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50&pageToken=${pageToken}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    channels = channels.concat(data.items || []);
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  const selectedSet = new Set(selected);
  selectedCountEl.textContent = selected.length ? `· ${selected.length} обрано` : '';

  channelListEl.innerHTML = channels.map(ch => {
    const chId = ch.snippet.resourceId.channelId;
    return `<div class="channel-item">
      <img src="${ch.snippet.thumbnails?.default?.url || ''}" alt="">
      <span>${ch.snippet.title}</span>
      <input type="checkbox" value="${chId}" ${selectedSet.has(chId) ? 'checked' : ''}>
    </div>`;
  }).join('');
}

document.getElementById('saveChannels').addEventListener('click', async () => {
  const checked = [...document.querySelectorAll('#channelList input:checked')].map(i => i.value);
  await chrome.storage.local.set({ selectedChannels: checked });
  selectedCountEl.textContent = checked.length ? `· ${checked.length} обрано` : '';
  accordionEl.classList.remove('open');
});

// --- FETCH ---
document.getElementById('fetchNow').addEventListener('click', async () => {
  const { selectedChannels = [] } = await chrome.storage.local.get('selectedChannels');
  if (!selectedChannels.length) { accordionEl.classList.add('open'); return; }

  const confirmed = confirm('Готові до незворотніх змін? Поточний плейлист буде замінено.');
  if (!confirmed) return;

  const hours = parseInt(document.getElementById('hoursSelect').value);
  const btn = document.getElementById('fetchNow');
  btn.textContent = '...';
  btn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'FETCH_HOURS', hours });
  const data = await chrome.storage.local.get(['playlist', 'lastFetch', 'refreshHour']);
  playlist = data.playlist || [];
  updateRefreshTime(data.lastFetch, data.refreshHour);
  renderPlaylist();
  btn.textContent = 'Оновити';
  btn.disabled = false;
});

function updateRefreshTime(lastFetch, hour) {
  if (!lastFetch) { refreshTimeEl.textContent = ''; return; }
  const d = new Date(lastFetch);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  refreshTimeEl.textContent = `↻ ${hh}:${mm}`;
}

// --- RENDER PLAYLIST ---
function renderPlaylist() {
  const items = playlist.filter(v => !v.deleted);

  if (!items.length) {
    playlistEl.innerHTML = '';
    playlistEl.appendChild(emptyStateEl);
    emptyStateEl.style.display = 'flex';
    playerEl.classList.remove('active');
    return;
  }

  emptyStateEl.style.display = 'none';
  playlistEl.innerHTML = items.map((v, i) => `
    <div class="track" draggable="true" data-index="${i}" data-id="${v.id}">
      <span class="drag-handle" title="Перетягнути">⠿</span>
      <div class="thumb-wrap">
        <img src="${v.thumbnail}" alt="">
        <span class="duration">${formatDuration(v.duration)}</span>
      </div>
      <div class="track-info">
        <div class="track-title">
          ${v.isNew && !v.watched ? '<span class="new-dot"></span>' : ''}
          ${escHtml(v.title)}
        </div>
        <div class="track-channel">${escHtml(v.channel)}</div>
        ${v.syncedFromYT ? '<div class="synced-badge">● з YouTube</div>' : ''}
      </div>
      <button class="btn-delete" data-id="${v.id}" title="Видалити">✕</button>
    </div>
  `).join('');

  playlistEl.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteTrack(btn.dataset.id); });
  });

  playlistEl.querySelectorAll('.track').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('btn-delete') || e.target.classList.contains('drag-handle')) return;
      const idx = parseInt(el.dataset.index);
      playTrack(idx);
    });
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragend', onDragEnd);
  });

  updateOpenButton();
}

// --- DELETE / UNDO ---
function deleteTrack(id) {
  const idx = playlist.findIndex(v => v.id === id);
  if (idx === -1) return;
  const removed = playlist.splice(idx, 1)[0];
  deletedStack.push({ video: removed, index: idx, time: Date.now() });
  chrome.storage.local.set({ playlist });
  renderPlaylist();
  showUndo();
}

function showUndo() {
  clearTimeout(undoTimer);
  undoToast.classList.add('visible');
  undoText.textContent = `Видалено`;
  undoTimer = setTimeout(() => {
    undoToast.classList.remove('visible');
    const cutoff = Date.now() - 15 * 60 * 1000;
    deletedStack = deletedStack.filter(d => d.time > cutoff);
  }, 15 * 60 * 1000);
}

undoBtn.addEventListener('click', () => {
  if (!deletedStack.length) return;
  const last = deletedStack.pop();
  playlist.splice(last.index, 0, last.video);
  chrome.storage.local.set({ playlist });
  renderPlaylist();
  if (!deletedStack.length) undoToast.classList.remove('visible');
});

// --- DRAG & DROP ---
function onDragStart(e) {
  dragSrcIndex = parseInt(this.dataset.index);
  this.classList.add('dragging');
}
function onDragOver(e) {
  e.preventDefault();
  document.querySelectorAll('.track').forEach(t => t.classList.remove('drag-over'));
  this.classList.add('drag-over');
}
function onDrop(e) {
  e.preventDefault();
  const targetIndex = parseInt(this.dataset.index);
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
  const items = playlist.filter(v => !v.deleted);
  const [moved] = items.splice(dragSrcIndex, 1);
  items.splice(targetIndex, 0, moved);
  playlist = items;
  chrome.storage.local.set({ playlist });
  renderPlaylist();
}
function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.track').forEach(t => t.classList.remove('drag-over'));
  dragSrcIndex = null;
}

// --- PLAYER ---
function playTrack(idx) {
  const items = playlist.filter(v => !v.deleted);
  const ordered = [...items.slice(idx), ...items.slice(0, idx)];
  const ids = ordered.map(v => v.id).join(',');
  ordered.forEach(v => { v.watched = true; v.isNew = false; });
  chrome.storage.local.set({ playlist });
  renderPlaylist();
  chrome.tabs.create({ url: `https://www.youtube.com/watch_videos?video_ids=${ids}` });
}

function updateOpenButton() {
  const items = playlist.filter(v => !v.deleted);
  if (!items.length) {
    openInYTBtn.disabled = true;
    openInYTBtn.textContent = '▶ Відкрити в YouTube';
    return;
  }
  openInYTBtn.disabled = false;
  openInYTBtn.textContent = `▶ Відкрити в YouTube (${items.length})`;
}

openInYTBtn.addEventListener('click', () => {
  playTrack(0);
});

// --- UTILS ---
function formatDuration(iso) {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const h = parseInt(m?.[1] || 0);
  const min = parseInt(m?.[2] || 0);
  const s = parseInt(m?.[3] || 0);
  if (h) return `${h}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${min}:${String(s).padStart(2,'0')}`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
