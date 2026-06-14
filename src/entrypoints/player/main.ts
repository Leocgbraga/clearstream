import './style.css';

// Phase 0 stub. Phase 2 wires hls.js here: a custom pLoader that strips #EXT-X-ENDLIST on every
// poll (live-ify), header injection via DNR session rules (Chrome) / blocking webRequest (FF),
// quality selector, PiP, and the auto-failover state machine.
// See docs/research/07-player-engine.md.
const params = new URLSearchParams(location.hash.slice(1));
const src = params.get('src');
const hint = document.getElementById('hint');
if (hint) {
  hint.textContent = src
    ? `Player stub — would play: ${src}`
    : 'Player stub — open this from the popup with a detected stream.';
}
