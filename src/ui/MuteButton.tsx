import { useSyncExternalStore } from "react";
import { sound } from "../audio/sound";

// Persistent sound toggle, top-left in every phase. The M key does the same.

export function MuteButton() {
  const muted = useSyncExternalStore(sound.subscribe, sound.getMuted);
  return (
    <button
      type="button"
      aria-pressed={muted}
      aria-label={muted ? "Sound off. Turn sound on (M)" : "Sound on. Mute (M)"}
      title={muted ? "Sound off (M)" : "Sound on (M)"}
      onClick={() => sound.toggleMuted()}
      className="patch pointer-events-auto absolute top-3 left-3 flex h-11 w-11 items-center justify-center mt-[env(safe-area-inset-top)]"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="#3a2a1e" />
        {muted ? (
          <path d="M16 9l5 6M21 9l-5 6" stroke="#c84b3c" strokeWidth="2.4" strokeLinecap="round" />
        ) : (
          <path
            d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
            stroke="#3a2a1e"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}
