import { ImageResponse } from "next/og";

export const alt = "Stub — everyone gets a stub, only you can open yours";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The unfurl card, drawn as the product's own object rather than as a logo on a background:
 * one paper stub, torn down the middle, readable on the left and covered on the right. It is
 * the same argument the app makes, at a glance and without a wallet.
 *
 * Satori supports flexbox only — no grid, and no shorthand that resolves to multiple layers —
 * so everything here is explicit.
 */
/**
 * The mark, as a data URI. Satori renders JSX to an image and does not support inline SVG
 * children with masks or gradients, but it will rasterise an <img>. Kept in step with
 * StubMark in components/shell.tsx and with app/icon.svg.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="6" x2="0" y2="26" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#fff3ad"/><stop offset="55%" stop-color="#ffdf58"/><stop offset="100%" stop-color="#e0b93f"/>
    </linearGradient>
    <mask id="n">
      <rect x="3" y="7.5" width="26" height="17" rx="4.5" fill="#fff"/>
      <circle cx="3" cy="16" r="3.1" fill="#000"/><circle cx="29" cy="16" r="3.1" fill="#000"/>
    </mask>
  </defs>
  <rect x="3" y="7.5" width="26" height="17" rx="4.5" fill="url(#g)" mask="url(#n)"/>
  <path d="M10.5 13.4h11M10.5 18h7" stroke="#07070b" stroke-width="1.8" stroke-linecap="round" opacity="0.66"/>
</svg>`;

const MARK_URI = `data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#07070b",
          backgroundImage: "radial-gradient(ellipse 70% 60% at 50% -10%, #3a3208, #07070b 70%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK_URI} width={46} height={46} alt="" />
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: 6,
              color: "#edecf2",
              textTransform: "uppercase",
            }}
          >
            Stub
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                display: "flex",
                fontSize: 62,
                lineHeight: 1.04,
                letterSpacing: -2.4,
                color: "#edecf2",
                maxWidth: 560,
              }}
            >
              Everyone gets a stub. Only you can open yours.
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 24, color: "#9a99ab", maxWidth: 520 }}>
              Confidential prize savings on Zama&apos;s fhEVM. Keep your principal — the pooled
              yield is the prize.
            </div>
          </div>

          {/* The stub itself. */}
          <div
            style={{
              display: "flex",
              width: 420,
              height: 236,
              borderRadius: 16,
              backgroundColor: "#f5f1e6",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                width: 218,
                padding: 26,
              }}
            >
              <div style={{ display: "flex", fontSize: 14, letterSpacing: 2.4, color: "#07070b73" }}>
                YOUR TICKET
              </div>
              <div style={{ display: "flex", marginTop: 12, fontSize: 42, color: "#07070b" }}>
                8412996
              </div>
              <div style={{ display: "flex", marginTop: 14, fontSize: 15, color: "#07070b8c" }}>
                Public. Anyone can check it.
              </div>
            </div>

            <div style={{ display: "flex", width: 3, backgroundColor: "#c9c2ad" }} />

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                flex: 1,
                padding: 26,
                backgroundColor: "#07070b0f",
              }}
            >
              <div style={{ display: "flex", fontSize: 14, letterSpacing: 2.4, color: "#07070b73" }}>
                SEALED
              </div>
              <div style={{ display: "flex", marginTop: 14, gap: 6 }}>
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      width: 24,
                      height: 34,
                      borderRadius: 4,
                      backgroundColor: "#07070b38",
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", marginTop: 16, fontSize: 15, color: "#07070b8c" }}>
                Readable by one key.
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
