import './style.css';
// media-chrome registers the <media-controller> + control-bar custom elements (bundled, no remote code).
import 'media-chrome';
// menu module registers <media-rendition-menu> / <media-rendition-menu-button> (the quality selector).
import 'media-chrome/menu';

// Phase 0/1: the player shell + controls render. Phase 2 wires hls.js here:
//  - custom pLoader strips #EXT-X-ENDLIST each poll (live-ify)
//  - header injection via DNR session rules (Chrome) / blocking webRequest (Firefox)
//  - populate media-chrome renditions from hls.levels; auto-failover state machine
// See docs/research/07-player-engine.md.
const params = new URLSearchParams(location.hash.slice(1));
const src = params.get('src');
const hint = document.getElementById('hint');
if (hint) {
  hint.textContent = src
    ? `Controls ready (media-chrome). Phase 2 will play: ${src}`
    : 'Open this from the popup with a detected stream. Phase 2 adds hls.js playback.';
}
