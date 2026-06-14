// Popup/player ↔ background messages (one-time request/response).
import type { CapturedStream } from './types';

export type Message =
  | { type: 'DETECT'; tabId: number } // active-tab scan via activeTab + scripting
  | { type: 'GET_STREAMS'; tabId: number }
  | { type: 'OPEN_PLAYER'; streams: CapturedStream[] } // popup → bg: open the player with a ranked mirror list
  | { type: 'GET_PLAYBACK' } // player → bg: fetch its tab's mirror list
  | { type: 'PREPARE_MIRROR'; index: number } // player → bg: install header injection for mirror N before it plays
  | { type: 'REMEMBER_WORKING'; index: number }; // player → bg: mirror N is playing healthily, persist its headers

export interface StreamsResponse {
  streams: CapturedStream[];
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
