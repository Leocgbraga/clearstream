// Popup/player ↔ background messages (one-time request/response).
import type { CapturedStream } from './types';

export type Message =
  | { type: 'DETECT'; tabId: number } // active-tab scan via activeTab + scripting
  | { type: 'GET_STREAMS'; tabId: number }
  | { type: 'OPEN_PLAYER'; stream: CapturedStream } // popup → bg: open the clean player for a stream
  | { type: 'GET_PLAYBACK' }; // player → bg: fetch its stream + install header injection for its tab

export interface StreamsResponse {
  streams: CapturedStream[];
}
export interface PlaybackResponse {
  stream: CapturedStream | null;
}
export interface OkResponse {
  ok: true;
}
