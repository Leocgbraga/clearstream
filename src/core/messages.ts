// Popup/player ↔ background messages (one-time request/response).
import type { CapturedStream } from './types';
import type { EventItem } from './resolver/events';

export type { EventItem };

export type Message =
  | { type: 'DETECT'; tabId: number } // active-tab scan via activeTab + scripting
  | { type: 'GET_STREAMS'; tabId: number }
  | { type: 'OPEN_PLAYER'; streams: CapturedStream[] } // popup → bg: open the player with a ranked mirror list
  | { type: 'GET_PLAYBACK' } // player → bg: fetch its tab's mirror list
  | { type: 'PREPARE_MIRROR'; index: number } // player → bg: install header injection for mirror N before it plays
  | { type: 'REMEMBER_WORKING'; index: number } // player → bg: mirror N is playing healthily, persist its headers
  | { type: 'CONTENT_STREAM'; url: string; pageUrl: string } // deep-capture content script → bg: found an .m3u8
  | { type: 'RESOLVE_PAGE'; tabId: number; urls?: string[] } // popup → bg (POWER): resolve mirrors → ranked streams
  | { type: 'LIST_EVENTS'; tabId: number } // popup → bg (POWER): parse the page's schedule → game list
  | { type: 'RESOLVE_EVENT'; url: string; tabId: number } // popup → bg (POWER): resolve one game → ranked streams
  | { type: 'EVENTS_DEBUG'; tabId: number }; // popup(debug) → bg (POWER): event-scan diagnostics for the 🔧 panel

export interface StreamsResponse {
  streams: CapturedStream[];
}
/** POWER build only: the parsed game list for a schedule page. */
export interface EventsResponse {
  events: EventItem[];
}
/** POWER + debug only: what the event scan saw per frame, so the 🔧 panel can show why a real site
 *  did/didn't list games (anchors vs. clickable divs vs. matchups-as-other-tags, and which frame). */
export interface EventsDebugResponse {
  parsed: number;
  frames: { frame: string; anchors: number; clickish: number; vsCount: number; vsSample: string[] }[];
}
export interface PlaybackResponse {
  streams: CapturedStream[];
}
export interface OkResponse {
  ok: true;
}
/** Returned when the background handler rejects, so callers never hang on an unanswered port. */
export interface ErrorResponse {
  error: string;
}

/** POWER build only: live resolve progress the background writes to storage.session (`resolve:<tabId>`)
 *  and the popup subscribes to. Folds out of store builds with the rest of the resolver. */
export interface ResolveProgress {
  phase: 'harvest' | 'resolve' | 'done';
  done: number; // mirrors resolved so far
  total: number; // mirrors being resolved (after harvest + cap)
  found: number; // distinct streams captured so far
}
