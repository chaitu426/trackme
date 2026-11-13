import { ImageResponse } from "next/og";
import { BRAND, markDataUri } from "@/lib/brand";
import { PALETTE } from "@trackme/landing/src/palette";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const RAMP = [".", ":", "+", "#"];
/** The band swells from faint to strong and back, the same shape as the one in the emails. */
const BAND = [0, 0, 1, 1, 2, 2, 3, 3, 3, 2, 2, 1, 1, 0, 0];

/** The social card: the mark, the line, and the glyph band, on the ink surface, in the palette and nothing else. */
export default function OpengraphImage() {
  const { surface, text } = PALETTE;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: surface.ink, padding: "72px 80px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markDataUri(7)} width={56} height={56} alt="" />
          <div style={{ display: "flex", marginLeft: 18, fontSize: 34, fontWeight: 500, color: text.strong }}>{BRAND.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 84, lineHeight: 1.08, fontWeight: 500, letterSpacing: -2.5, color: text.strong, maxWidth: 1000 }}>
            Analytics for every team,&nbsp;<span style={{ color: text.muted }}>not just the analyst.</span>
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 28, lineHeight: 1.4, color: text.body, maxWidth: 900 }}>
            One workspace for marketing, engineering and product. No tracking cookies.
          </div>
        </div>
        <div style={{ display: "flex", fontFamily: "monospace", fontSize: 34 }}>
          {BAND.map((level, i) => (
            <span key={i} style={{ marginRight: 22, color: text.strong, opacity: 0.12 + level * 0.2 }}>
              {RAMP[level]}
            </span>
          ))}
        </div>
      </div>
    ),
    size
  );
}
