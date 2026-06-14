// Ambient augmentation: `media-tracks/polyfill` adds these to every HTMLMediaElement at runtime
// (so media-chrome's <media-rendition-menu> can read them). Declare them for TypeScript.
import type { VideoRenditionList, VideoTrack, VideoTrackList } from 'media-tracks';

declare global {
  interface HTMLMediaElement {
    videoTracks: VideoTrackList;
    videoRenditions: VideoRenditionList;
    addVideoTrack(kind: string, label?: string, language?: string): VideoTrack;
    removeVideoTrack(track: VideoTrack): void;
  }
}

export {};
