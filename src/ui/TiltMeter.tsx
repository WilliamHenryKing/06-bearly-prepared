// The load gauge: a painted arc with the safe band (nothing slides), the sliding band and
// the topple edge. The needle is the load; the small marker is the bear's lean. When the
// load tips, the side to lean toward nudges.

interface Props {
  tilt: number;
  lean: number;
  safe: number;
  limit: number;
}

const RANGE = 1.1;
const R = 70;
const CX = 90;
const CY = 86;

const at = (a: number, r = R) => {
  const t = (Math.max(-RANGE, Math.min(RANGE, a)) / RANGE) * (Math.PI / 2);
  return [CX + Math.sin(t) * r, CY - Math.cos(t) * r] as const;
};

function arc(a0: number, a1: number) {
  const [x0, y0] = at(a0);
  const [x1, y1] = at(a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export function TiltMeter({ tilt, lean, safe, limit }: Props) {
  const [nx, ny] = at(tilt, R - 6);
  const [lx, ly] = at(lean * 0.5, R + 12);
  const worry = Math.abs(tilt) > safe * 0.7;
  const leanLeft = tilt > 0;
  const label = Math.abs(tilt) < 0.03 ? "level" : tilt > 0 ? "tipping right" : "tipping left";
  return (
    <div className="patch pointer-events-none flex w-[190px] flex-col items-center px-2 pt-1 pb-2">
      <svg width="180" height="96" viewBox="0 0 180 96" role="img" aria-label={`Load ${label}`}>
        <path d={arc(-limit, -safe)} stroke="#d9a441" strokeWidth="12" fill="none" />
        <path d={arc(safe, limit)} stroke="#d9a441" strokeWidth="12" fill="none" />
        <path d={arc(-safe, safe)} stroke="#4f7a58" strokeWidth="12" fill="none" />
        <path d={arc(-RANGE, -limit)} stroke="#c84b3c" strokeWidth="12" fill="none" />
        <path d={arc(limit, RANGE)} stroke="#c84b3c" strokeWidth="12" fill="none" />
        <circle cx={lx} cy={ly} r="5" fill="#2f6f8a" />
        <line
          x1={CX}
          y1={CY}
          x2={nx}
          y2={ny}
          stroke="#3a2a1e"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r="7" fill="#3a2a1e" />
      </svg>
      <div className="flex h-5 w-full items-center justify-between px-1 text-xs font-extrabold text-berry-dark">
        <span className={worry && leanLeft ? "nudge" : "invisible"}>◀ lean left</span>
        <span
          className={worry && !leanLeft ? "nudge" : "invisible"}
          style={{ "--nudge": "6px" } as React.CSSProperties}
        >
          lean right ▶
        </span>
      </div>
    </div>
  );
}
