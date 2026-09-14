"use client";

import { useState } from "react";
import { classifyVideoUrl } from "@/lib/client/video-url";

export function VideoLinkPreview({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const video = classifyVideoUrl(url);
  if (!video) return <a className="bd-push-link" href={url} target="_blank" rel="noreferrer">查看附加链接 →</a>;
  if (!playing) return <button type="button" className="bd-video-preview" onClick={() => setPlaying(true)}><span aria-hidden="true">▶</span><span><strong>播放视频</strong><small>{video.kind === "embed" ? video.provider : "视频文件"} · 点击开始播放</small></span></button>;
  return <div className="bd-video-player">{video.kind === "direct" ? <video src={video.src} controls autoPlay playsInline /> : <iframe src={video.src} title={`${video.provider} 视频`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}</div>;
}
