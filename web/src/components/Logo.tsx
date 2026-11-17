import { Link } from "react-router-dom";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Payounce home">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
        <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="3.5" opacity=".9" />
        <circle className="logo-dot" cx="16" cy="5" r="4" fill="var(--gold)" />
      </svg>
      <span>Payounce</span>
    </Link>
  );
}
