'use client';
// 색 입력 한 쌍 (5.1 확정) — 왼쪽 hex 입력란 + 오른쪽 원형 색 버튼(자체 컬러피커)
// 컬러피커: 채도/명도 스펙트럼 + 색상(hue) 슬라이더, hex와 양방향 연동
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// setAlpha는 아래 투명도 상태 setter와 이름이 겹쳐 별칭으로 받는다
import { isValidColor, normalizeColor, setAlpha as applyAlpha, toRgba } from '@/lib/color';

/* HSV 기반 (스펙트럼 UI 관례) */
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const c = toRgba(hex);
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

export function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  // 투명도 (v2.0 사용자 요청) — 1이면 #rrggbb, 아니면 rgba()로 저장된다
  const [alpha, setAlpha] = useState(() => toRgba(value).a);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);

  // 외부 값 변경 → 내부 동기화
  useEffect(() => { setText(value); setHsv(hexToHsv(value)); setAlpha(toRgba(value).a); }, [value]);

  // 팝업 위치 — body 포털(fixed): 패널 overflow에 잘리지 않고, 아래 공간이 없으면 위로
  const POP_W = 216, POP_H = 226;   // 투명도 슬라이더 한 줄만큼 높아짐 (v2.0)
  const openAt = () => {
    const r = rootRef.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const top = below < POP_H + 14 ? Math.max(8, r.top - POP_H - 8) : r.bottom + 8;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)), top });
    setOpen(true);
  };

  // 바깥 클릭 시 닫기 + 스크롤 시 닫기 (위치 어긋남 방지 · 팝업 내부는 제외)
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const emit = (h: number, s: number, v: number, a: number) => {
    const hex = hsvToHex(h, s, v);
    const out = a >= 1 ? hex : applyAlpha(hex, a);
    setText(out);
    onChange(out);
  };
  const commitHsv = (h: number, s: number, v: number) => {
    setHsv({ h, s, v });
    emit(h, s, v, alpha);
  };
  const commitAlpha = (a: number) => {
    setAlpha(a);
    emit(hsv.h, hsv.s, hsv.v, a);
  };

  const dragSv = (e: React.PointerEvent) => {
    const el = svRef.current!;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      const s = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const v = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      commitHsv(hsv.h, s, v);
    };
    move(e);
    const up = () => {
      el.removeEventListener('pointermove', move as EventListener);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move as EventListener);
    el.addEventListener('pointerup', up);
  };

  const dragAlpha = (e: React.PointerEvent) => {
    const el = alphaRef.current!;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      commitAlpha(Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * 100) / 100);
    };
    move(e);
    const up = () => {
      el.removeEventListener('pointermove', move as EventListener);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move as EventListener);
    el.addEventListener('pointerup', up);
  };

  const dragHue = (e: React.PointerEvent) => {
    const el = hueRef.current!;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      const h = 360 * Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      commitHsv(h, hsv.s, hsv.v);
    };
    move(e);
    const up = () => {
      el.removeEventListener('pointermove', move as EventListener);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move as EventListener);
    el.addEventListener('pointerup', up);
  };

  return (
    <div className="color-field" ref={rootRef}>
      <input
        className="k-input"
        value={text}
        spellCheck={false}
        onChange={e => {
          const v = e.target.value;
          setText(v);
          // hex 말고 rgba(...)도 그대로 받는다 (v2.0 사용자 요청)
          if (isValidColor(v)) onChange(normalizeColor(v));
        }}
      />
      <button
        type="button"
        className="color-dot"
        /* 반투명이면 뒤의 격자가 비쳐 보이게 (v2.0) */
        style={{ backgroundImage: `linear-gradient(${value},${value}), var(--checker)` }}
        onClick={() => (open ? setOpen(false) : openAt())}
        aria-label="색상 선택"
      />
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div className="picker-pop" ref={popRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 140 }}>
          <div
            ref={svRef}
            className="picker-sv"
            style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
            onPointerDown={dragSv}
          >
            <div className="picker-cursor" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
          </div>
          <div ref={hueRef} className="picker-hue" onPointerDown={dragHue}>
            <div className="picker-hue-cursor" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h},100%,50%)` }} />
          </div>
          {/* 투명도 (v2.0 사용자 요청) — 왼쪽 끝이 완전 투명 */}
          <div ref={alphaRef} className="picker-alpha" onPointerDown={dragAlpha}
            style={{ ['--a-to' as string]: hsvToHex(hsv.h, hsv.s, hsv.v) }}>
            <div className="picker-hue-cursor" style={{ left: `${alpha * 100}%`, background: '#fff' }} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
