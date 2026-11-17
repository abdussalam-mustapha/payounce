/** Deterministic two-tone avatar derived from an address. */
export function hues(address: string): [number, number] {
  const h = parseInt(address.slice(2, 10), 16) || 0;
  const a = h % 360;
  return [a, (a + 40 + ((h >> 9) % 80)) % 360];
}

export function Avatar({ address, size = 28 }: { address: string; size?: number }) {
  const [a, b] = hues(address);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(from ${a}deg, hsl(${a} 62% 52%), hsl(${b} 70% 62%), hsl(${a} 62% 52%))`,
      }}
      aria-hidden
    />
  );
}
