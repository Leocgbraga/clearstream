import './style.css';
// media-chrome registers the controls + rendition (quality) menu + live button (bundled).
import 'media-chrome';
import 'media-chrome/menu';
import { browser } from 'wxt/browser';
import type { CapturedStream } from '@/core/types';
import type { PlaybackResponse } from '@/core/messages';
import { createFailoverController, type FailoverStatus } from '@/core/player/failover';
import { createPlayer } from '@/core/player/hls-controller';
import { safeHttpUrl } from '@/core/url-safety';
import { classifyManifestBody, scoreStream } from '@/core/detection';
import { loadVolume, saveVolume } from '@/core/prefs';
import { t } from '@/core/i18n';

const video = document.getElementById('video') as HTMLVideoElement;
const controller = document.getElementById('controller') as HTMLElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;
const shortcuts = document.getElementById('shortcuts') as HTMLParagraphElement;
const titleEl = document.getElementById('title') as HTMLHeadingElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const sourcesRow = document.getElementById('sourcesRow') as HTMLLabelElement;
const sourcesSel = document.getElementById('sources') as HTMLSelectElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;
const unmuteBtn = document.getElementById('unmute') as HTMLButtonElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const spinner = document.getElementById('spinner') as HTMLDivElement;
const overlayMsg = document.getElementById('overlayMsg') as HTMLParagraphElement;
const overlayBtn = document.getElementById('overlayBtn') as HTMLButtonElement;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function setHint(text: string): void {
  hint.textContent = text;
  hint.hidden = !text;
}
function setStatus(text: string): void {
  statusEl.textContent = text;
  statusEl.hidden = !text;
}
function setTitle(host: string): void {
  titleEl.textContent = host;
  document.title = host ? `${host} — ClearStream` : 'ClearStream Player';
}
function showOverlay(opts: { spin?: boolean; msg: string; action?: { label: string; onClick: () => void } }): void {
  spinner.hidden = !opts.spin;
  overlayMsg.textContent = opts.msg;
  if (opts.action) {
    overlayBtn.textContent = opts.action.label;
    overlayBtn.onclick = opts.action.onClick;
    overlayBtn.hidden = false;
  } else {
    overlayBtn.hidden = true;
    overlayBtn.onclick = null;
  }
  overlay.hidden = false;
}
function hideOverlay(): void {
  overlay.hidden = true;
}

/** Body-sniff the top candidates to pick the real master when the URL hint is ambiguous. Bounded so
 *  the common case (a master detected by URL) plays instantly; gated manifests just fall back. */
async function refineRanking(streams: CapturedStream[]): Promise<CapturedStream[]> {
  if (streams.length < 2 || streams[0]!.kind === 'master') return streams;
  await Promise.all(
    streams.slice(0, 4).map(async (s) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1200);
        // No credentials on the probe: a cookie-gated manifest just falls back to URL ranking, and
        // credentials:'include' both leaks cookies cross-origin and fails CORS-wildcard manifests.
        const res = await fetch(s.manifestUrl, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          const kind = classifyManifestBody(await res.text());
          if (kind !== 'unknown') s.kind = kind;
        }
      } catch {
        /* gated/slow manifest → keep the URL-based kind */
      }
    }),
  );
  return [...streams]
    .map((s) => ({ ...s, score: scoreStream(s) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function applyI18n(): void {
  copyBtn.textContent = t('copyUrl');
  unmuteBtn.textContent = t('tapForSound');
  shortcuts.textContent = t('shortcuts');
}

async function start(): Promise<void> {
  applyI18n();
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
  if (!streams.length && fallback) {
    streams = [
      { key: fallback, manifestUrl: fallback, tabId: -1, frameId: 0, pageUrl: '', replayHeaders: {}, createdAt: 0 },
    ];
  }
  if (!streams.length) {
    setTitle('');
    showOverlay({ msg: t('noStream') });
    return;
  }

  showOverlay({ spin: true, msg: t('connecting') });
  // Refine to the real master when the URL hint is ambiguous — but never let the probes delay the
  // first frame: race them against a short deadline and start with the URL ranking if they're slow.
  streams = await Promise.race([
    refineRanking(streams),
    new Promise<CapturedStream[]>((resolve) => setTimeout(() => resolve(streams), 700)),
  ]);

  setHint('');
  shortcuts.hidden = false;
  let currentIndex = 0;
  setTitle(hostOf(streams[0]!.manifestUrl));

  // Copy the playing stream URL (trust signal + power-user affordance).
  copyBtn.hidden = false;
  copyBtn.addEventListener('click', () => {
    const url = streams[currentIndex]?.manifestUrl ?? streams[0]!.manifestUrl;
    void navigator.clipboard.writeText(url).then(
      () => {
        copyBtn.textContent = t('copied');
        setTimeout(() => (copyBtn.textContent = t('copyUrl')), 1500);
      },
      () => {},
    );
  });

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

  // Autoplay reliably by starting muted (a freshly-opened tab has no user activation, so sound would
  // be blocked); restore the remembered volume level and invite one tap for sound.
  video.muted = true;
  const pref = await loadVolume();
  if (pref) video.volume = Math.min(1, Math.max(0, pref.volume));
  unmuteBtn.hidden = false;
  const enableSound = (): void => {
    video.muted = false;
    unmuteBtn.hidden = true;
  };
  unmuteBtn.addEventListener('click', enableSound);
  video.addEventListener('volumechange', () => {
    if (!video.muted) unmuteBtn.hidden = true;
    void saveVolume({ volume: video.volume, muted: video.muted });
  });

  // Keyboard: media-chrome handles Space/F/M/←→/↑↓ once focused; add P for picture-in-picture.
  controller.focus();
  controller.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key.toLowerCase() === 'p') {
      void video.requestPictureInPicture?.().catch(() => {});
    }
  });

  const prepareMirror = (i: number): Promise<void> =>
    Promise.race([
      browser.runtime.sendMessage({ type: 'PREPARE_MIRROR', index: i }).then(() => undefined),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('header-injection timed out')), 4000)),
    ]);

  const controllerHandle = createFailoverController(
    video,
    streams,
    {
      prepareMirror: stashed ? prepareMirror : async () => {},
      onStatus: (st: FailoverStatus) => {
        currentIndex = st.index;
        sourcesSel.value = String(st.index);
        if (st.failed) {
          setStatus('');
          showOverlay({
            msg: t('allFailed'),
            action: { label: t('tryAgain'), onClick: () => location.reload() },
          });
        } else if (st.message) {
          setStatus(st.message); // a switch is happening
          showOverlay({ spin: true, msg: t('switching') });
        }
      },
      onHealthy: (i: number) => {
        currentIndex = i;
        hideOverlay();
        setTitle(hostOf(streams[i]!.manifestUrl));
        setStatus('');
        if (stashed) void browser.runtime.sendMessage({ type: 'REMEMBER_WORKING', index: i });
      },
    },
    { createPlayer },
  );

  sourcesSel.addEventListener('change', () => controllerHandle.select(Number(sourcesSel.value)));
}

void start();
