import { NextResponse } from "next/server";

// GIF search proxy (Tenor). Keeps the key server-side. Degrades gracefully: with no
// TENOR_API_KEY set, returns an empty list + a flag so the UI can hide the GIF tab.
// Get a key at https://developers.google.com/tenor/guides/quickstart (free), set TENOR_API_KEY.
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  const key = process.env.TENOR_API_KEY;
  if (!key) return NextResponse.json({ gifs: [], configured: false });

  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80).trim();
  const base = q
    ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}`
    : `https://tenor.googleapis.com/v2/featured?`;
  const url = `${base}&key=${key}&client_key=statseer&limit=18&media_filter=tinygif,gif&contentfilter=medium`;

  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`tenor ${res.status}`);
    const data = await res.json();
    const gifs = (data.results ?? [])
      .map((r: { id: string; media_formats?: Record<string, { url?: string }> }) => ({
        id: r.id,
        preview: r.media_formats?.tinygif?.url ?? "",
        url: r.media_formats?.gif?.url ?? r.media_formats?.tinygif?.url ?? "",
      }))
      .filter((g: { url: string }) => g.url);
    return NextResponse.json({ gifs, configured: true });
  } catch {
    return NextResponse.json({ gifs: [], configured: true });
  }
}
