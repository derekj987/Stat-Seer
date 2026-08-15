// Turf tab icon: a flag-yellow "S" on the deep field green. Generated via next/og.
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
          background: "#0c2b1c",
          color: "#f4c430",
          fontSize: 46,
          fontFamily: "sans-serif",
          borderRadius: 14,
        }}
      >
        S
      </div>
    ),
    { ...size },
  );
}
