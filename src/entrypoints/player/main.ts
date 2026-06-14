import './style.css';
// media-chrome registers the controls + rendition (quality) menu custom elements (bundled).
import 'media-chrome';
import 'media-chrome/menu';
import type { ErrorData } from 'hls.js';
import { createPlayer } from '@/core/player/hls-controller';

// Phase 2: full player — live-ify pLoader (ENDLIST strip each poll) + hls.levels wired to the
// media-chrome quality menu. Phase 3 adds header injection (DNR/webRequest) so locked CDNs play;
// Phase 4 adds auto-failover across detected mirrors.
const video = document.getElementById('video') as HTMLVideoElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;
const src = new URLSearchParams(location.hash.slice(1)).get('src');

function setHint(text: string): void {
  hint.textContent = text;
  hint.hidden = !text;
}

if (!src) {
  setHint('Open this from the ClearStream popup with a detected stream.');
} else {
  try {
    createPlayer(video, src, {
      onError: (d: ErrorData) => {
        if (d.fatal) {
          setHint(`Playback error (${d.type}: ${d.details}). Locked CDNs need header injection — coming in Phase 3.`);
        }
      },
    });
    setHint('');
  } catch (e) {
    setHint((e as Error).message);
  }
}
