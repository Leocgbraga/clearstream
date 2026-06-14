// Popup ↔ background messages (one-time request/response).
import type { CapturedStream } from './types';

export type Message =
  | { type: 'DETECT'; tabId: number } // active-tab scan via activeTab + scripting
  | { type: 'GET_STREAMS'; tabId: number }
  | { type: 'OPEN_PLAYER'; url: string };

export interface StreamsResponse {
  streams: CapturedStream[];
}
