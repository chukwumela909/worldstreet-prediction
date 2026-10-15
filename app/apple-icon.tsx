import { ImageResponse } from "next/og";

/**
 * Home-screen icon: the WorldStreet mark (app/icon.svg) rasterised, since
 * apple-icon has to be a bitmap. Same lime tile and W path, drawn at the
 * 180px Apple asks for; iOS rounds the corners itself, so the tile is
 * square here.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#DFE745",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 32 32" fill="none">
          <path
            d="M12.8082 8.90894H3.58984L11.7446 23.0911L15.2901 14.9364H16.7083L20.6084 22.7365L28.4086 8.90894H19.1902L16.7083 14.2272H15.2901L12.8082 8.90894Z"
            fill="#020207"
            stroke="black"
            strokeWidth="0.709108"
          />
        </svg>
      </div>
    ),
    size,
  );
}
