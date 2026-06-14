import './style.css';
// media-chrome registers the controls + rendition (quality) menu custom elements (bundled).
import 'media-chrome';
import 'media-chrome/menu';
import Hls from 'hls.js';

// Phase 1: basic playback so detect→Watch works end-to-end on CORS-open streams.
// Phase 2 adds the custom pLoader (live ENDLIST-strip), Phase 3 header injection (DNR/webRequest)
// and hls.levels→media-chrome rendition wiring + auto-failover. See docs/research/07-player-engine.md.
const video = document.getElementById('video') as HTMLVideoElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;
const src = new URLSearchParams(location.hash.slice(1)).get('src');

function setHint(text: string): void {
  hint.textContent = text;
  hint.hidden = !text;
}

if (!src) {
  setHint('Open this from the ClearStream popup with a detected stream.');
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Native HLS (Safari) — no loader hook, but plays directly.
  video.src = src;
  setHint('');
} else if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(src);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    setHint('');
    void video.play().catch(() => {});
  });
  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal) setHint(`Playback error (${data.type}: ${data.details}). Phase 3 adds header injection for protected CDNs.`);
  });
} else {
  setHint('This browser cannot play HLS (no MSE support).');
}
