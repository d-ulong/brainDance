"use client";

import { useEffect, useState } from "react";

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
    <ul className="flex flex-col gap-2" data-testid={`${testIdPrefix}-list`}>
      {media.map((item) => (
        <li key={item.referenceId} className="overflow-hidden">
          {urls[item.referenceId] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={urls[item.referenceId]}
              alt=""
              className="max-h-64 w-full object-contain"
              data-testid={`${testIdPrefix}-${item.referenceId}`}
            />
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
    </ul>
  );
}
