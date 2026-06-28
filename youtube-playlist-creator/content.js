let lastVideoId = null;

function checkCurrentVideo() {
  const url = new URL(window.location.href);
  const videoId = url.searchParams.get('v');
  if (videoId && videoId !== lastVideoId) {
    lastVideoId = videoId;
    chrome.runtime.sendMessage({ type: 'YOUTUBE_PLAYING', videoId });
  }
}

checkCurrentVideo();
const observer = new MutationObserver(checkCurrentVideo);
observer.observe(document.body, { subtree: true, childList: true });
window.addEventListener('yt-navigate-finish', checkCurrentVideo);
