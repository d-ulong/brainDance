"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";

import {
  fetchMediaBytes,
  issueMediaCapability,
  type MediaAttachmentDto,
} from "@/lib/client/m7-api";

export function MediaPreviewList({
  studentId,
  media,
  testIdPrefix,
}: {
  studentId: string;
  media: MediaAttachmentDto[];
  testIdPrefix: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragOrigin = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const pinchDistance = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    void (async () => {
      for (const item of media) {
        try {
          const issued = await issueMediaCapability(studentId, item.referenceId);
          const blob = await fetchMediaBytes(issued.capabilityToken);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          setUrls((prev) => ({ ...prev, [item.referenceId]: url }));
        } catch {
          if (!cancelled) {
            setFailed((prev) => ({ ...prev, [item.referenceId]: true }));
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [media, studentId]);

  if (!media.length) {
    return null;
  }

  return (
    <><ul className="bd-media-thumbnails" data-testid={`${testIdPrefix}-list`}>
      {media.map((item) => (
        <li key={item.referenceId} className="overflow-hidden">
          {urls[item.referenceId] ? (<button type="button" className="bd-media-thumbnail" aria-label="放大查看图片" onClick={() => { setPreviewUrl(urls[item.referenceId]); setScale(1); setOffset({ x: 0, y: 0 }); }}>
            <img
              src={urls[item.referenceId]}
              alt=""
              className="h-full w-full object-cover"
              data-testid={`${testIdPrefix}-${item.referenceId}`}
            /></button>
          ) : failed[item.referenceId] ? (
            <p className="text-sm text-neutral-500" data-testid={`${testIdPrefix}-failed`}>
              图片不可用
            </p>
          ) : (
            <p className="text-sm text-neutral-500" data-testid={`${testIdPrefix}-loading`}>
              加载图片…
            </p>
          )}
        </li>
      ))}
    </ul>{previewUrl ? <div className="bd-media-lightbox" role="dialog" aria-modal="true" aria-label="图片查看器" onClick={() => setPreviewUrl(null)}>
      <div className="bd-media-lightbox-toolbar" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setScale((value) => Math.max(1, value - .5))}>－</button><span>{Math.round(scale * 100)}%</span><button type="button" onClick={() => setScale((value) => Math.min(4, value + .5))}>＋</button><button type="button" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>还原</button><button type="button" onClick={() => setPreviewUrl(null)}>关闭</button></div>
      <div className="bd-media-lightbox-stage" onClick={(event) => event.stopPropagation()} onWheel={(event) => { event.preventDefault(); setScale((value) => Math.min(4, Math.max(1, value + (event.deltaY < 0 ? .25 : -.25)))); }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); dragOrigin.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }; }} onPointerMove={(event) => { if (!pointers.current.has(event.pointerId)) return; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); const points = [...pointers.current.values()]; if (points.length >= 2) { const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); if (pinchDistance.current) setScale((value) => Math.min(4, Math.max(1, value * distance / pinchDistance.current!))); pinchDistance.current = distance; } else if (scale > 1 && dragOrigin.current) setOffset({ x: dragOrigin.current.offsetX + event.clientX - dragOrigin.current.x, y: dragOrigin.current.offsetY + event.clientY - dragOrigin.current.y }); }} onPointerUp={(event) => { pointers.current.delete(event.pointerId); pinchDistance.current = null; dragOrigin.current = null; }} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); pinchDistance.current = null; dragOrigin.current = null; }}>
        <img src={previewUrl} alt="放大预览" draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
      </div>
    </div> : null}</>
  );
}
