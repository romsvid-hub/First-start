document.getElementById('nextStep').addEventListener('click', async () => {
  const hour = parseInt(document.getElementById('hour').value);
  await chrome.storage.local.set({ refreshHour: hour, refreshMinute: 0 });
  document.getElementById('step1').classList.remove('active');
  document.getElementById('step2').classList.add('active');
  loadChannels();
});

async function loadChannels() {
  const { token } = await chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' });
  if (!token) {
    document.getElementById('channelList').innerHTML = '<div class="loading">Потрібна авторизація Google</div>';
    return;
  }

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

  const list = document.getElementById('channelList');
  if (!channels.length) {
    list.innerHTML = '<div class="loading">Підписок не знайдено</div>';
    return;
  }

  list.innerHTML = channels.map(ch => `
    <div class="channel-item">
      <img src="${ch.snippet.thumbnails?.default?.url || ''}" alt="">
      <span>${ch.snippet.title}</span>
      <input type="checkbox" value="${ch.snippet.resourceId.channelId}" checked>
    </div>
  `).join('');
}

document.getElementById('saveSetup').addEventListener('click', async () => {
  const checked = [...document.querySelectorAll('#channelList input:checked')].map(i => i.value);
  const hour = parseInt((await chrome.storage.local.get('refreshHour')).refreshHour ?? 21);
  await chrome.storage.local.set({ selectedChannels: checked, setupDone: true });
  chrome.runtime.sendMessage({ type: 'SETUP_DONE', hour, minute: 0 });
  window.close();
});
