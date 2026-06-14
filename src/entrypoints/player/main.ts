import './style.css';
// media-chrome registers the controls + rendition (quality) menu custom elements (bundled).
import 'media-chrome';
import 'media-chrome/menu';
import { browser } from 'wxt/browser';
import type { ErrorData } from 'hls.js';
import { createPlayer } from '@/core/player/hls-controller';
import type { PlaybackResponse } from '@/core/messages';

const video = document.getElementById('video') as HTMLVideoElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;

function setHint(text: string): void {
  hint.textContent = text;
  hint.hidden = !text;
}

async function start(): Promise<void> {
  // Direct-link fallback (#src=…) for streams opened without the popup flow.
  const fallback = new URLSearchParams(location.hash.slice(1)).get('src');
  let url = fallback ?? '';

  // GET_PLAYBACK returns this tab's stream AND installs header injection for it before responding,
  // so the rule is live before hls.js makes its first request.
  try {
    const pb = (await browser.runtime.sendMessage({ type: 'GET_PLAYBACK' })) as PlaybackResponse;
    if (pb?.stream?.manifestUrl) url = pb.stream.manifestUrl;
  } catch {
    /* fall back to the #src hash */
  }

  if (!url) {
    setHint('Open this from the ClearStream popup with a detected stream.');
    return;
  }

  try {
    createPlayer(video, url, {
      onError: (d: ErrorData) => {
        if (d.fatal) {
          setHint(
            `Playback error (${d.type}: ${d.details}). Some CDNs validate Origin/Sec-Fetch, which can't be forged in-browser.`,
          );
        }
      },
    });
    setHint('');
  } catch (e) {
    setHint((e as Error).message);
  }
}

void start();
