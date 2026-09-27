import type { ItemId } from "../game/items";

// Small painted glyphs for the prop set, matching the 3D colours.

export function ItemIcon({ id, size = 28 }: { id: ItemId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {GLYPHS[id]}
    </svg>
  );
}

const GLYPHS: Record<ItemId, React.ReactNode> = {
  kettle: (
    <g>
      <path d="M8 26 Q6 16 12 13 L20 13 Q26 16 24 26 Z" fill="#c84b3c" />
      <path d="M24 20 L29 13" stroke="#c84b3c" strokeWidth="3" strokeLinecap="round" />
      <path d="M11 13 Q16 3 21 13" stroke="#2a2622" strokeWidth="2" fill="none" />
    </g>
  ),
  teacups: (
    <g>
      <rect x="4" y="17" width="24" height="10" rx="2" fill="#4f7a58" />
      <path d="M7 10 h7 l-1 8 h-5 Z M18 10 h7 l-1 8 h-5 Z" fill="#efe4c8" />
    </g>
  ),
  biscuits: (
    <g>
      <rect x="5" y="11" width="22" height="15" rx="4" fill="#2f6f8a" />
      <rect x="4" y="9" width="24" height="5" rx="2" fill="#d9a441" />
    </g>
  ),
  blanket: (
    <g>
      <rect x="3" y="11" width="26" height="12" rx="6" fill="#b5423a" />
      <path d="M11 11 v12 M21 11 v12" stroke="#2f4f6a" strokeWidth="3" />
    </g>
  ),
  chair: (
    <g>
      <path d="M8 28 L24 10 M24 28 L8 10" stroke="#a8703f" strokeWidth="3" strokeLinecap="round" />
      <rect x="5" y="8" width="22" height="4" rx="1" fill="#d9a441" />
    </g>
  ),
  lamp: (
    <g>
      <path d="M11 4 h10 l4 8 h-18 Z" fill="#f1dfb8" stroke="#c84b3c" strokeWidth="1.5" />
      <path d="M16 12 V27" stroke="#c8a050" strokeWidth="2" />
      <rect x="11" y="26" width="10" height="3" rx="1.5" fill="#c8a050" />
    </g>
  ),
};
