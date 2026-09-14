export type VideoSource =
  | { kind: "direct"; src: string }
  | { kind: "embed"; src: string; provider: "YouTube" | "哔哩哔哩" }
  | null;

export function classifyVideoUrl(value: string | null | undefined): VideoSource {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) return { kind: "direct", src: url.href };
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id ? { kind: "embed", provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1` } : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = url.searchParams.get("v");
    return id ? { kind: "embed", provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1` } : null;
  }
  if (host === "bilibili.com" || host === "m.bilibili.com") {
    const id = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1];
    return id ? { kind: "embed", provider: "哔哩哔哩", src: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(id)}&autoplay=1` } : null;
  }
  return null;
}
