const API_KEY_PLACEHOLDER = 'YOUR_YOUTUBE_API_KEY';

chrome.runtime.onInstalled.addListener(async () => {
  const { setupDone } = await chrome.storage.local.get('setupDone');
  if (!setupDone) {
    chrome.action.setPopup({ popup: 'onboarding.html' });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SETUP_DONE') {
    chrome.action.setPopup({ popup: 'popup.html' });
    scheduleDaily(msg.hour, msg.minute);
    fetchAndStore();
  }
  if (msg.type === 'FETCH_HOURS') {
    fetchAndStore(msg.hours).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'GET_AUTH_TOKEN') {
    getToken().then(token => sendResponse({ token })).catch(() => sendResponse({ token: null }));
    return true;
  }
  if (msg.type === 'YOUTUBE_PLAYING') {
    handleYouTubeSync(msg.videoId);
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'daily-refresh') fetchAndStore();
});

function scheduleDaily(hour, minute) {
  chrome.alarms.clear('daily-refresh');
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delayMs = next - now;
  chrome.alarms.create('daily-refresh', {
    delayInMinutes: delayMs / 60000,
    periodInMinutes: 1440
  });
}

async function getToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, token => {
      if (chrome.runtime.lastError || !token) {
        chrome.identity.getAuthToken({ interactive: true }, t => {
          if (chrome.runtime.lastError || !t) reject();
          else resolve(t);
        });
      } else {
        resolve(token);
      }
    });
  });
}

async function fetchAndStore(hours = 24) {
  try {
    const token = await getToken();
    const { selectedChannels = [] } = await chrome.storage.local.get('selectedChannels');
    if (!selectedChannels.length) return;

    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    let videos = [];

    for (const channelId of selectedChannels) {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&publishedAfter=${since}&maxResults=10`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!data.items) continue;

      const ids = data.items.map(i => i.id.videoId).join(',');
      const details = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${ids}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const dData = await details.json();

      for (const item of (dData.items || [])) {
        const dur = item.contentDetails.duration;
        const isShort = parseDuration(dur) <= 60;
        const isLive = item.snippet.liveBroadcastContent !== 'none';
        if (isShort || isLive) continue;

        videos.push({
          id: item.id,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          channelId: item.snippet.channelId,
          thumbnail: item.snippet.thumbnails?.medium?.url || '',
          duration: dur,
          publishedAt: item.snippet.publishedAt,
          isNew: true,
          watched: false
        });
      }
    }

    videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const { playlist = [] } = await chrome.storage.local.get('playlist');
    const existingIds = new Set(playlist.map(v => v.id));
    const newVideos = videos.filter(v => !existingIds.has(v.id));
    const merged = [...newVideos, ...playlist].slice(0, 30);

    await chrome.storage.local.set({ playlist: merged, lastFetch: Date.now() });
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return (parseInt(m?.[1] || 0) * 3600) + (parseInt(m?.[2] || 0) * 60) + parseInt(m?.[3] || 0);
}

async function handleYouTubeSync(videoId) {
  const { playlist = [] } = await chrome.storage.local.get('playlist');
  const exists = playlist.find(v => v.id === videoId);
  if (!exists) {
    const token = await getToken().catch(() => null);
    if (!token) return;
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return;
    const synced = {
      id: videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      channelId: item.snippet.channelId,
      thumbnail: item.snippet.thumbnails?.medium?.url || '',
      duration: item.contentDetails.duration,
      publishedAt: item.snippet.publishedAt,
      isNew: true,
      watched: false,
      syncedFromYT: true
    };
    await chrome.storage.local.set({ playlist: [synced, ...playlist] });
  }
  await chrome.storage.local.set({ currentVideoId: videoId });
}
