import { useEffect, useState } from "react";
import { FileIcon } from "./Icons";
import { formatBytes, resolveUrls } from "@/lib/attachments";
import type { Attachment } from "@/lib/types";

/** Attachment chips on a sent message. Image URLs are resolved in one batched
 *  `files.urls()` call per message rather than one redirect per thumbnail. */

export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  const imageNames = attachments.filter((a) => a.kind === "image").map((a) => a.id);
  const imageKey = imageNames.join(",");

  useEffect(() => {
    if (!imageKey) return;
    let active = true;
    resolveUrls(imageKey.split(","))
      .then((resolved) => {
        if (active) setUrls(resolved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [imageKey]);

  if (attachments.length === 0) return null;

  return (
    <div className="attach-row">
      {attachments.map((att) =>
        att.kind === "image" && urls[att.id] ? (
          <a
            key={att.id}
            className="attach-thumb"
            href={urls[att.id]}
            target="_blank"
            rel="noreferrer noopener"
          >
            <img src={urls[att.id]} alt={att.name} loading="lazy" />
          </a>
        ) : (
          <span className="attach-chip" key={att.id}>
            <FileIcon size={13} />
            <span className="attach-name">{att.name}</span>
            <span className="attach-size mono">{formatBytes(att.size)}</span>
          </span>
        ),
      )}
    </div>
  );
}
