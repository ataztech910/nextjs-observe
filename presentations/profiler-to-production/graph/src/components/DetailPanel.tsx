import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import type { DeckNode } from "@/deck/types";
import { cn } from "@/lib/utils";

/** `large`: the side-by-side layout of a card with a photo — bigger type, no inner scroll. */
export function DetailPanel({
  detail,
  reduced,
  large = false,
}: {
  detail: NonNullable<DeckNode["detail"]>;
  reduced: boolean;
  large?: boolean;
}) {
  // A missing QR image falls back to a generated code, so the slide is never blank.
  const [qrImgFailed, setQrImgFailed] = useState(false);
  const qrSrc = detail.qr?.src && !qrImgFailed ? detail.qr.src : null;
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.35, ease: [0.2, 0.7, 0.2, 1] }}
      className="overflow-hidden"
    >
      <motion.div
        initial={{ opacity: 0, y: reduced ? 0 : 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.3 }}
        className={
          large
            ? "mt-5 border-t border-hairline pt-5"
            : "detail-scroll mt-5 max-h-[640px] overflow-y-auto border-t border-hairline pt-5 pr-1"
        }
      >
        {detail.heading && (
          <h3
            className={cn(
              "font-semibold text-ink",
              large ? "text-[30px] leading-tight" : "text-[24px]",
            )}
          >
            {detail.heading}
          </h3>
        )}
        {detail.bullets && (
          <ul className="mt-4 space-y-3">
            {detail.bullets.map((b, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: reduced ? 0 : -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.18 + i * 0.06 }}
                className={cn(
                  "flex gap-3 leading-snug text-ink-dim",
                  large ? "text-[24px]" : "text-[20px]",
                )}
              >
                <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />
                {b}
              </motion.li>
            ))}
          </ul>
        )}
        {detail.code && (
          <pre className={cn("code-block mt-4", large && "code-block--large")}>
            <code>{detail.code.text}</code>
          </pre>
        )}
        {detail.images && (
          <div
            className="mt-5 grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${detail.images.length}, minmax(0, 1fr))`,
            }}
          >
            {detail.images.map((img, i) => (
              <motion.figure
                key={img.src}
                initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.08, duration: 0.4 }}
                className="m-0"
              >
                <img
                  src={img.src}
                  alt={img.caption ?? ""}
                  className="photo-frame"
                />
                {img.caption && (
                  <figcaption className="mono mt-2.5 text-[15px] text-ink-faint">
                    {img.caption}
                  </figcaption>
                )}
              </motion.figure>
            ))}
          </div>
        )}
        {detail.qr && (
          <motion.div
            initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: 0.3,
              type: "spring",
              stiffness: 260,
              damping: 20,
            }}
            className="mt-6 flex items-center gap-5"
          >
            <div
              className={
                detail.qr.dark && qrSrc ? "qr-frame qr-frame--dark" : "qr-frame"
              }
            >
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt="QR code"
                  onError={() => setQrImgFailed(true)}
                  className="block"
                />
              ) : detail.qr.value ? (
                <QRCodeSVG
                  value={detail.qr.value}
                  size={168}
                  bgColor="#ffffff"
                  fgColor="#0a0a0a"
                  level="M"
                />
              ) : null}
            </div>
            {detail.qr.caption && (
              <div className="mono max-w-[420px] text-[19px] leading-snug text-amber">
                {detail.qr.caption}
              </div>
            )}
          </motion.div>
        )}
        {detail.image && (
          <img
            src={detail.image}
            alt=""
            className="mt-4 w-full rounded-lg border border-hairline"
          />
        )}
      </motion.div>
    </motion.div>
  );
}
