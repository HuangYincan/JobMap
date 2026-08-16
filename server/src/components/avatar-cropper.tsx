"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { t, type Language } from "@/lib/i18n";
import styles from "./avatar-cropper.module.css";

export interface AvatarCropperProps {
  open: boolean;
  lang: Language;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

const OUTPUT = 256;
const VIEW = 280;

export function AvatarCropper({ open, lang, onClose, onSave }: AvatarCropperProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open) {
      setSrc(null);
      setNatural({ w: 0, h: 0 });
      setOffset({ x: 0, y: 0 });
      setZoom(1);
      dragRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const minCover = natural.w && natural.h ? Math.max(VIEW / natural.w, VIEW / natural.h) : 1;
  const scale = minCover * zoom;
  const drawW = natural.w * scale;
  const drawH = natural.h * scale;

  const clampOffset = (x: number, y: number) => {
    const maxX = Math.max(0, (drawW - VIEW) / 2);
    const maxY = Math.max(0, (drawH - VIEW) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const onPick = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        setSrc(url);
        setOffset({ x: 0, y: 0 });
        setZoom(1);
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!src) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset(clampOffset(drag.ox + (e.clientX - drag.x), drag.oy + (e.clientY - drag.y)));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const commit = () => {
    if (!src || !natural.w) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.beginPath();
      ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2);
      ctx.clip();
      const ratio = OUTPUT / VIEW;
      ctx.drawImage(
        img,
        OUTPUT / 2 - (drawW / 2 - offset.x) * ratio,
        OUTPUT / 2 - (drawH / 2 - offset.y) * ratio,
        drawW * ratio,
        drawH * ratio,
      );
      onSave(canvas.toDataURL("image/jpeg", 0.9));
      onClose();
    };
    img.src = src;
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={t("cropAvatar", lang)}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.title}>{t("cropAvatar", lang)}</h2>
        <input
          ref={fileRef}
          className={styles.file}
          type="file"
          accept="image/*"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <button type="button" className={styles.upload} onClick={() => fileRef.current?.click()}>
          {t("uploadPhoto", lang)}
        </button>
        <div
          className={styles.stage}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.photo}
              src={src}
              alt=""
              draggable={false}
              style={{
                width: drawW,
                height: drawH,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          ) : (
            <span className={styles.hint}>{t("uploadPhoto", lang)}</span>
          )}
          <div className={styles.mask} aria-hidden="true" />
        </div>
        <label className={styles.zoom}>
          <span>{t("zoom", lang)}</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.02}
            value={zoom}
            disabled={!src}
            onChange={(e) => {
              const next = Number(e.target.value);
              setZoom(next);
              setOffset((prev) => clampOffset(prev.x, prev.y));
            }}
          />
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            {t("cancel", lang)}
          </button>
          <button type="button" className={styles.save} disabled={!src} onClick={commit}>
            {t("saveCrop", lang)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
