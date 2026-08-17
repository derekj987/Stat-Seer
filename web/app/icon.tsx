// Tab icon: a gold "S" on near-black, matching the logo mark's black-and-gold
// world. Kept an emblem (not her face) because a portrait is an unreadable blob
// at 16px. Generated via next/og.
import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#221812",
          color: "#f0c35a",
          fontSize: 46,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: "50%",
          border: "3px solid #e0b24e",
        }}
      >
        S
      </div>
    ),
    { ...size },
  );
}
