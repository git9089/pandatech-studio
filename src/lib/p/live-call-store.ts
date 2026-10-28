import { useSyncExternalStore } from "react";

/** Shared state for P's live voice call (owned by PLiveCall in the shell). */
export type LiveCallState = {
  active: boolean;
  status: string;
  heard: string;
  said: string;
  pointTarget: string | null;
};

let state: LiveCallState = { active: false, status: "idle", heard: "", said: "", pointTarget: null };
const listeners = new Set<() => void>();

export function setLiveCall(patch: Partial<LiveCallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useLiveCall<T>(select: (s: LiveCallState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
    () => select(state),
  );
}

/** P's live voice loudness 0..1, updated every animation frame (read without re-rendering). */
export const pVoiceLevel = { value: 0, live: false, analyser: false, lastSpeechText: 0, loop: false, error: "" };

let sharedCtx: AudioContext | null = null;
/** Must first be called from a click so the browser lets the audio analyser run. */
export function getLiveAudioContext(): AudioContext | null {
  try {
    sharedCtx ??= new AudioContext();
    if (sharedCtx.state === "suspended") void sharedCtx.resume();
    return sharedCtx;
  } catch (e) {
    pVoiceLevel.error = String(e);
    return null;
  }
}
