import { ImageResponse } from "next/og";
import { BRAND, markDataUri } from "@/lib/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home-screen icon: the mark on the ink surface, with room around it so the rounded tile reads as a tile. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.ink }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markDataUri(7)} width={128} height={128} alt="" />
      </div>
    ),
    size
  );
}
