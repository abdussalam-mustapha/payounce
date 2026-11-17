import type { ReactNode } from "react";
import { hues } from "./Avatar";

export type SeatState = "paid-out" | "current" | "upcoming" | "defaulted" | "open";

export type Seat = { address?: string; state: SeatState; you?: boolean; paidThisRound?: boolean };

type Props = {
  seats: Seat[];
  size?: number;
  /** 0..1 progress of the current round, drawn as an arc. */
  progress?: number;
  center?: ReactNode;
  compact?: boolean;
  /** Makes open seats clickable (seat picker). */
  onSeatClick?: (index: number) => void;
  selected?: number;
};

/**
 * The rotation dial: members sit around a ring in payout order. Paid-out seats are filled,
 * the current recipient glows, and the arc shows how much of the round has elapsed.
 */
export function Dial({ seats, size = 360, progress, center, compact, onSeatClick, selected }: Props) {
  const n = Math.max(seats.length, 1);
  const c = size / 2;
  const ringR = c - (compact ? 10 : 34);
  const nodeR = Math.min(compact ? 7 : 24, ((2 * Math.PI * ringR) / n) * (compact ? 0.28 : 0.34));
  const circ = 2 * Math.PI * ringR;
  const uid = `d${size}${n}`;

  return (
    <div className={`dial ${compact ? "compact" : ""}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Payout rotation">
        <defs>
          {!compact &&
            seats.map((s, i) => {
              if (!s.address) return null;
              const [a, b] = hues(s.address);
              return (
                <linearGradient key={i} id={`${uid}g${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor={`hsl(${a} 62% 52%)`} />
                  <stop offset="1" stopColor={`hsl(${b} 70% 62%)`} />
                </linearGradient>
              );
            })}
        </defs>

        <circle cx={c} cy={c} r={ringR} className="dial-track" strokeWidth={compact ? 2 : 2} />
        {progress !== undefined && (
          <circle
            cx={c}
            cy={c}
            r={ringR}
            className="dial-progress"
            strokeWidth={compact ? 3 : 4}
            strokeDasharray={`${circ * Math.min(Math.max(progress, 0), 1)} ${circ}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
        )}

        {seats.map((s, i) => {
          const ang = (-90 + (360 / n) * i) * (Math.PI / 180);
          const x = c + ringR * Math.cos(ang);
          const y = c + ringR * Math.sin(ang);
          const fill =
            s.state === "open"
              ? "var(--surface)"
              : compact
                ? undefined
                : s.address
                  ? `url(#${uid}g${i})`
                  : "var(--line)";
          const pickable = !!onSeatClick && s.state === "open";
          return (
            <g
              key={i}
              className={`seat ${s.state} ${pickable ? "pickable" : ""} ${selected === i ? "selected" : ""}`}
              transform={`translate(${x} ${y})`}
              onClick={pickable ? () => onSeatClick(i) : undefined}
              role={pickable ? "button" : undefined}
              aria-label={pickable ? `Choose seat ${i + 1}` : undefined}
            >
              {s.state === "current" && <circle r={nodeR + (compact ? 4 : 9)} className="seat-glow" />}
              {selected === i && <circle r={nodeR + 7} className="seat-selected" />}
              <circle r={nodeR} className="seat-dot" style={fill ? { fill } : undefined} />
              {!compact && s.state === "open" && (
                <text y={5} textAnchor="middle" className="seat-num">{i + 1}</text>
              )}
              {!compact && s.state === "paid-out" && (
                <path d={`M${-nodeR * 0.35} 0 l${nodeR * 0.25} ${nodeR * 0.25} l${nodeR * 0.45} ${-nodeR * 0.5}`} className="seat-check" />
              )}
              {!compact && s.state === "defaulted" && (
                <path d={`M${-nodeR * 0.3} ${-nodeR * 0.3} L${nodeR * 0.3} ${nodeR * 0.3} M${nodeR * 0.3} ${-nodeR * 0.3} L${-nodeR * 0.3} ${nodeR * 0.3}`} className="seat-x" />
              )}
              {!compact && s.paidThisRound && <circle r={4.5} cx={nodeR * 0.75} cy={-nodeR * 0.75} className="seat-paid" />}
              {!compact && s.you && (
                <text y={nodeR + 16} textAnchor="middle" className="seat-you">you</text>
              )}
            </g>
          );
        })}
      </svg>
      {center && <div className="dial-center">{center}</div>}
    </div>
  );
}
