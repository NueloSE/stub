/**
 * The four landing illustrations.
 *
 * Drawn rather than sourced, in the product's own vocabulary — a coin held, a public record
 * under glass, a seal and its one key, a lock that was never shut.
 *
 * These are built as objects, not outlines. Three things do that work, and all three are what
 * separate a rendered icon from a line drawing:
 *
 *   - metal is never one colour. Each gold surface runs from a near-white specular through the
 *     body tone into shadow, and back up into a warm bounce at the far edge.
 *   - thickness is drawn. Every solid shape has an unlit copy offset behind it, so the object
 *     has a side as well as a face.
 *   - the object sits somewhere. A contact shadow underneath and a bloom behind put it in a
 *     space rather than on a background.
 *
 * Gradient and filter ids are namespaced per illustration: two inline SVGs sharing an id would
 * resolve to whichever mounted first. Every gradient is `userSpaceOnUse`, because the default
 * `objectBoundingBox` silently refuses to paint a shape with a zero-height bounding box — which
 * is any perfectly horizontal stroke.
 */
type ArtProps = { className?: string };

function Material({ id }: { id: string }) {
  return (
    <>
      <radialGradient id={`${id}-halo`} cx="120" cy="92" r="94" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffdf58" stopOpacity="0.20" />
        <stop offset="55%" stopColor="#ffdf58" stopOpacity="0.05" />
        <stop offset="100%" stopColor="#ffdf58" stopOpacity="0" />
      </radialGradient>

      {/* Lit gold: specular, body, shadow, then the bounce light off the ground. */}
      <linearGradient id={`${id}-gold`} x1="70" y1="26" x2="156" y2="180" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fffdf1" />
        <stop offset="16%" stopColor="#ffefa4" />
        <stop offset="40%" stopColor="#ffdf58" />
        <stop offset="66%" stopColor="#e4bb44" />
        <stop offset="86%" stopColor="#b98e28" />
        <stop offset="100%" stopColor="#ffe58c" />
      </linearGradient>

      {/* The same metal turned away from the light — for edges and thickness. */}
      <linearGradient id={`${id}-gold-deep`} x1="88" y1="34" x2="164" y2="184" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#c6982f" />
        <stop offset="60%" stopColor="#8f6618" />
        <stop offset="100%" stopColor="#66450f" />
      </linearGradient>

      {/* A struck face, lit from the upper left. */}
      <radialGradient id={`${id}-gold-face`} cx="96" cy="66" r="92" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fff9dd" />
        <stop offset="45%" stopColor="#ffdf58" />
        <stop offset="100%" stopColor="#cd9c31" />
      </radialGradient>

      <linearGradient id={`${id}-glass`} x1="70" y1="28" x2="172" y2="178" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
        <stop offset="46%" stopColor="#ffffff" stopOpacity="0.06" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.17" />
      </linearGradient>
      <linearGradient id={`${id}-glass-edge`} x1="66" y1="18" x2="158" y2="182" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
        <stop offset="48%" stopColor="#ffffff" stopOpacity="0.14" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.5" />
      </linearGradient>

      <linearGradient id={`${id}-paper`} x1="34" y1="30" x2="140" y2="172" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fffefb" />
        <stop offset="55%" stopColor="#f3efe2" />
        <stop offset="100%" stopColor="#dbd4c0" />
      </linearGradient>

      <filter id={`${id}-cast`} x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="9" stdDeviation="9" floodColor="#000000" floodOpacity="0.55" />
      </filter>
      <filter id={`${id}-soft`} x="-70%" y="-70%" width="240%" height="240%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
      <filter id={`${id}-bloom`} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="9" />
      </filter>
    </>
  );
}

/** The deposit, held rather than spent — a struck coin inside a glass ring. */
export function ArtPrincipal({ className }: ArtProps) {
  const id = "art-principal";
  const cx = 120;
  const cy = 90;
  const r = 45;
  return (
    <svg viewBox="0 0 240 200" className={className} fill="none" aria-hidden>
      <defs>
        <Material id={id} />
      </defs>
      <circle cx="120" cy="92" r="92" fill={`url(#${id}-halo)`} />
      <ellipse cx="122" cy="168" rx="52" ry="9" fill="#000000" opacity="0.5" filter={`url(#${id}-soft)`} />

      {/* The ring encloses; it does not touch. Nothing is taken out to fund a draw. */}
      <circle cx={cx} cy={cy} r="66" stroke="#ffdf58" strokeOpacity="0.3" strokeWidth="13" filter={`url(#${id}-bloom)`} />
      <circle cx={cx} cy={cy} r="66" stroke={`url(#${id}-glass-edge)`} strokeWidth="9" />

      <g filter={`url(#${id}-cast)`}>
        <circle cx={cx + 7} cy={cy + 7} r={r} fill={`url(#${id}-gold-deep)`} />
        <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-gold)`} />
        <circle cx={cx} cy={cy} r={r - 6} fill={`url(#${id}-gold-face)`} />
        <circle cx={cx} cy={cy} r={r - 6} stroke="#8f6618" strokeOpacity="0.3" strokeWidth="1.5" />
      </g>

      {/* Struck, not printed: a dark impression under a lit face. */}
      <text
        x={cx}
        y={cy + 17}
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="44"
        fontWeight="700"
        fill="#8a6512"
        opacity="0.45"
      >
        $
      </text>
      <text
        x={cx}
        y={cy + 15}
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="44"
        fontWeight="700"
        fill="#fff7d4"
      >
        $
      </text>

      <path
        d={`M${cx - 33} ${cy - 20} a 40 40 0 0 1 28 -20`}
        stroke="#ffffff"
        strokeOpacity="0.72"
        strokeWidth="7"
        strokeLinecap="round"
        filter={`url(#${id}-soft)`}
      />
      <path
        d={`M${cx + 28} ${cy + 27} a 40 40 0 0 0 13 -19`}
        stroke="#fffbe8"
        strokeOpacity="0.5"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The public record, under a lens that genuinely magnifies it. */
export function ArtCheck({ className }: ArtProps) {
  const id = "art-check";
  const lx = 134;
  const ly = 84;
  const lr = 42;
  const bars = (
    <>
      <rect x="44" y="68" width="70" height="9" rx="4.5" fill="#07070b" opacity="0.24" />
      <rect x="44" y="90" width="96" height="10" rx="5" fill="#07070b" opacity="0.36" />
      <rect x="44" y="114" width="56" height="9" rx="4.5" fill="#07070b" opacity="0.16" />
    </>
  );
  return (
    <svg viewBox="0 0 240 200" className={className} fill="none" aria-hidden>
      <defs>
        <Material id={id} />
        <clipPath id={`${id}-lens`}>
          <circle cx={lx} cy={ly} r={lr - 4} />
        </clipPath>
      </defs>
      <circle cx="120" cy="92" r="92" fill={`url(#${id}-halo)`} />
      <ellipse cx="112" cy="166" rx="60" ry="9" fill="#000000" opacity="0.45" filter={`url(#${id}-soft)`} />

      <g filter={`url(#${id}-cast)`}>
        <rect x="28" y="46" width="146" height="94" rx="13" fill={`url(#${id}-paper)`} />
      </g>
      <rect x="28.5" y="46.5" width="145" height="93" rx="12.5" stroke="#ffffff" strokeOpacity="0.75" />
      {bars}

      {/* Under the glass the same marks are larger, and the glass tints what it covers. */}
      <g clipPath={`url(#${id}-lens)`}>
        <rect x="28" y="46" width="146" height="94" rx="13" fill={`url(#${id}-paper)`} />
        <g transform={`translate(${lx} ${ly}) scale(1.6) translate(${-lx} ${-ly})`}>{bars}</g>
        <circle cx={lx} cy={ly} r={lr} fill={`url(#${id}-glass)`} />
      </g>

      {/* Handle first, so the rim covers the joint. */}
      <g filter={`url(#${id}-cast)`}>
        <path d="M164 114l28 28" stroke={`url(#${id}-gold-deep)`} strokeWidth="19" strokeLinecap="round" />
        <path d="M164 114l28 28" stroke={`url(#${id}-gold)`} strokeWidth="13" strokeLinecap="round" />
        <path d="M166 110l26 26" stroke="#fff8d8" strokeOpacity="0.5" strokeWidth="3.5" strokeLinecap="round" />
      </g>

      <circle cx={lx} cy={ly} r={lr} stroke={`url(#${id}-gold-deep)`} strokeWidth="15" />
      <circle cx={lx} cy={ly} r={lr} stroke={`url(#${id}-gold)`} strokeWidth="10" />
      <path
        d={`M${lx - 29} ${ly - 23} a 38 38 0 0 1 25 -16`}
        stroke="#fffdf2"
        strokeOpacity="0.85"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d={`M${lx - 25} ${ly + 13} a 32 32 0 0 1 23 -33`}
        stroke="#ffffff"
        strokeOpacity="0.38"
        strokeWidth="9"
        strokeLinecap="round"
        filter={`url(#${id}-soft)`}
      />
    </svg>
  );
}

/** One seal, and the single key that reads it. */
export function ArtOnlyYou({ className }: ArtProps) {
  const id = "art-onlyyou";
  return (
    <svg viewBox="0 0 240 200" className={className} fill="none" aria-hidden>
      <defs>
        <Material id={id} />
        <radialGradient id={`${id}-seal`} cx="98" cy="46" r="140" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2e2e3c" />
          <stop offset="100%" stopColor="#08080d" />
        </radialGradient>
      </defs>
      <circle cx="120" cy="92" r="92" fill={`url(#${id}-halo)`} />
      <ellipse cx="128" cy="186" rx="62" ry="7" fill="#000000" opacity="0.45" filter={`url(#${id}-soft)`} />

      {/* The seal: the same ink as the covered half of a stub. */}
      <g filter={`url(#${id}-cast)`}>
        <circle cx="126" cy="78" r="56" fill={`url(#${id}-seal)`} />
      </g>
      <circle cx="126" cy="78" r="56" stroke="#ffffff" strokeOpacity="0.17" strokeWidth="1.5" />
      <circle cx="126" cy="78" r="46" stroke="#ffdf58" strokeOpacity="0.24" strokeWidth="1.5" strokeDasharray="3 7" />
      <path
        d="M92 40a56 56 0 0 1 34 -18"
        stroke="#ffffff"
        strokeOpacity="0.3"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Lit from inside — the result exists and is simply not readable from here. */}
      <g filter={`url(#${id}-bloom)`} opacity="0.85">
        <circle cx="126" cy="68" r="15" fill="#ffdf58" />
        <path d="M118 80h16l4 24h-24z" fill="#ffdf58" />
      </g>
      <circle cx="126" cy="68" r="13" fill={`url(#${id}-gold)`} />
      <path d="M119.5 78h13l3.5 22h-20z" fill={`url(#${id}-gold)`} />

      {/* The key: bow, shaft, bit — each with an unlit under-edge below the lit face. */}
      <g filter={`url(#${id}-cast)`}>
        <circle cx="60" cy="160" r="16" stroke={`url(#${id}-gold-deep)`} strokeWidth="15" />
        <circle cx="60" cy="158" r="16" stroke={`url(#${id}-gold)`} strokeWidth="11" />
        <rect x="74" y="152" width="94" height="15" rx="7.5" fill={`url(#${id}-gold-deep)`} />
        <rect x="74" y="150" width="94" height="13" rx="6.5" fill={`url(#${id}-gold)`} />
        <rect x="140" y="161" width="11" height="17" rx="4" fill={`url(#${id}-gold)`} />
        <rect x="157" y="161" width="10" height="12" rx="4" fill={`url(#${id}-gold)`} />
        <rect x="80" y="152" width="80" height="3.5" rx="1.75" fill="#fff9dc" opacity="0.7" />
      </g>
    </svg>
  );
}

/** A lock that was never shut — no term, no penalty, nothing held in. */
export function ArtWithdraw({ className }: ArtProps) {
  const id = "art-withdraw";
  return (
    <svg viewBox="0 0 240 200" className={className} fill="none" aria-hidden>
      <defs>
        <Material id={id} />
      </defs>
      <circle cx="120" cy="92" r="92" fill={`url(#${id}-halo)`} />
      <ellipse cx="116" cy="176" rx="52" ry="9" fill="#000000" opacity="0.5" filter={`url(#${id}-soft)`} />

      {/* The shackle stands open: one leg seated, the other clear of the body. */}
      <g filter={`url(#${id}-cast)`}>
        <path
          d="M92 96V62a25 25 0 0 1 50 0v14"
          stroke={`url(#${id}-gold-deep)`}
          strokeWidth="20"
          strokeLinecap="round"
        />
        <path
          d="M92 96V62a25 25 0 0 1 50 0v14"
          stroke={`url(#${id}-gold)`}
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M86 90V62a19 19 0 0 1 17 -19"
          stroke="#fff8d8"
          strokeOpacity="0.55"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </g>

      <g filter={`url(#${id}-cast)`}>
        <rect x="56" y="96" width="104" height="78" rx="19" fill={`url(#${id}-gold-deep)`} />
        <rect x="56" y="93" width="104" height="75" rx="19" fill={`url(#${id}-gold)`} />
      </g>
      <rect x="65" y="101" width="86" height="59" rx="14" stroke="#8f6618" strokeOpacity="0.26" strokeWidth="1.5" />
      <rect x="68" y="99" width="80" height="5" rx="2.5" fill="#fffaea" opacity="0.62" />
      <rect x="63" y="106" width="5" height="46" rx="2.5" fill="#fffaea" opacity="0.35" />

      <circle cx="108" cy="122" r="11" fill="#6d4a10" opacity="0.75" />
      <path d="M102 131h12l4 20h-20z" fill="#6d4a10" opacity="0.75" />
    </svg>
  );
}
