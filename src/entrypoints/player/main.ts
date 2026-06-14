import './style.css';
// media-chrome registers the controls + rendition (quality) menu custom elements (bundled).
import 'media-chrome';
import 'media-chrome/menu';
import { browser } from 'wxt/browser';
import type { CapturedStream } from '@/core/types';
import type { PlaybackResponse } from '@/core/messages';
import { createFailoverController, type FailoverStatus } from '@/core/player/failover';
import { createPlayer } from '@/core/player/hls-controller';
import { safeHttpUrl } from '@/core/url-safety';

const video = document.getElementById('video') as HTMLVideoElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const sourcesRow = document.getElementById('sourcesRow') as HTMLLabelElement;
const sourcesSel = document.getElementById('sources') as HTMLSelectElement;

function setHint(text: string): void {
  hint.textContent = text;
  hint.hidden = !text;
}
function setStatus(text: string): void {
  statusEl.textContent = text;
  statusEl.hidden = !text;
}
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function start(): Promise<void> {
  const fallback = safeHttpUrl(new URLSearchParams(location.hash.slice(1)).get('src'));

  // GET_PLAYBACK returns this tab's ranked mirror list (set by the popup's Watch).
  let streams: CapturedStream[] = [];
  let stashed = false;
  try {
    const pb = (await browser.runtime.sendMessage({ type: 'GET_PLAYBACK' })) as PlaybackResponse;
    if (pb?.streams?.length) {
      streams = pb.streams;
      stashed = true;
    }
  } catch {
    /* fall back to the #src hash */
  }

  // Direct-link fallback (no popup flow): a single stream from #src, no header injection.
  if (!streams.length && fallback) {
    streams = [
      { key: fallback, manifestUrl: fallback, tabId: -1, frameId: 0, pageUrl: '', replayHeaders: {}, createdAt: 0 },
    ];
  }
  if (!streams.length) {
    setHint('Open this from the ClearStream popup with a detected stream.');
    return;
  }
  setHint('');

  // Manual "Sources" dropdown (the failover escape hatch) when there's more than one mirror.
  if (streams.length > 1) {
    sourcesRow.hidden = false;
    streams.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i + 1}. ${hostOf(s.manifestUrl)}`;
      sourcesSel.append(opt);
    });
  }

  // Don't let a silent/slow background wedge playback: time-box the header-injection round-trip.
  // On timeout/reject the failover controller advances to the next mirror (its own try/catch).
  const prepareMirror = (i: number): Promise<void> =>
    Promise.race([
      browser.runtime.sendMessage({ type: 'PREPARE_MIRROR', index: i }).then(() => undefined),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('header-injection timed out')), 4000),
      ),
    ]);

  const controller = createFailoverController(
    video,
    streams,
    {
      prepareMirror: stashed ? prepareMirror : async () => {},
      onStatus: (st: FailoverStatus) => {
        sourcesSel.value = String(st.index);
        if (st.failed) {
          setStatus('');
          setHint('All sources failed. Try another from the popup.');
        } else {
          setStatus(st.message);
        }
      },
    },
    { createPlayer },
  );

  sourcesSel.addEventListener('change', () => controller.select(Number(sourcesSel.value)));
}

void start();
