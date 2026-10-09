'use client';
/**
 * 글자 모양만큼 자리를 잡는 글씨 (커플홈 사용자 제보 — 「폰트 자체 크기가 크면 영역을 침범한다」).
 *
 * 줄 높이는 글자 크기의 배수(예: 1.1배)라서, 필기체처럼 머리·꼬리가 긴 폰트는 실제 글자가 그 칸을 넘어
 * 위 여백이나 아래 줄을 덮는다. 폰트 파일에 적힌 높이 정보(ascent/descent)도 폰트마다 제각각이라
 * CSS 줄 높이만으로는 못 맞춘다 — 그려질 글자를 캔버스로 재서, 칸을 넘는 만큼 + 적당한 여백을 위아래에 더한다.
 * 칸 안에 넉넉히 들어가는 보통 폰트는 거의 그대로다. 폰트 파일은 늦게 도착하므로 도착할 때마다 다시 잰다.
 */
import React, { useEffect, useRef, useState } from 'react';

export function InkFit({ as = 'div', text, className, style, gap = 0.08 }: {
  as?: 'div' | 'b' | 'span' | 'h1';
  text: string;
  className?: string;
  style?: React.CSSProperties;
  /** 글자와 칸 끝 사이에 둘 여백 — 글자 크기의 배수 */
  gap?: number;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [pad, setPad] = useState({ t: 0, b: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx || !size) return;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText(text || ' ');
      const fa = m.fontBoundingBoxAscent;
      const fd = m.fontBoundingBoxDescent;
      if (fa === undefined || fd === undefined) return;   // 오래된 브라우저 — 예전 그대로 둔다
      const lh = cs.lineHeight === 'normal' ? fa + fd : parseFloat(cs.lineHeight);
      const base = (lh - (fa + fd)) / 2 + fa;              // 줄 칸 안에서 기준선의 높이
      const top = base - m.actualBoundingBoxAscent;         // 글자 맨 위 — 음수면 칸 위로 튀어나온 것
      const bottom = base + m.actualBoundingBoxDescent;     // 글자 맨 아래
      const g = size * gap;
      const t = Math.ceil(Math.max(0, g - top));
      const b = Math.ceil(Math.max(0, bottom + g - lh));
      setPad(p => (p.t === t && p.b === b ? p : { t, b }));
    };
    measure();
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    void fonts?.ready.then(measure);
    fonts?.addEventListener?.('loadingdone', measure);
    // 글자 크기가 바뀌면(사이트 글자 배율 등) 칸 크기도 바뀐다 — 다시 잰다
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      alive = false;
      fonts?.removeEventListener?.('loadingdone', measure);
      ro?.disconnect();
    };
  }, [text, gap, style?.fontFamily, style?.fontSize, style?.fontWeight]);

  return React.createElement(as, {
    ref, className,
    style: { ...style, paddingTop: pad.t || undefined, paddingBottom: pad.b || undefined },
  }, text);
}

/**
 * 세로 칸이 정해진 자리의 글씨 (커플홈 사용자 요청 — 「세로값은 고정, 폰트 크기를 거기 맞춰」).
 *
 * InkFit은 칸을 글자만큼 늘리지만, 나란히 놓인 두 칸(다이어리 캐릭터 머리 등)은 폰트마다 높이가 달라지면
 * 줄이 어긋난다. 여기서는 칸 높이(CSS height)를 그대로 두고, 글자 모양이 칸보다 크면(필기체 등) 글자를
 * 줄여 끼워 넣은 뒤 글자 모양의 가운데를 칸 가운데에 맞춘다. 칸 안에 들어가는 폰트는 원래 크기 그대로다.
 * 원래 크기(최대)는 바깥 요소의 CSS font-size다. 한 줄 글씨 전용.
 */
export function FitHeight({ text, className, style, pad = 0.06 }: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  /** 글자와 칸 위아래 끝 사이 여백 — 칸 높이의 비율 */
  pad?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [fit, setFit] = useState<{ size: number; dy: number; lh: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const cs = getComputedStyle(el);
      const H = el.getBoundingClientRect().height;   // 고정 세로값 (CSS height)
      const base = parseFloat(cs.fontSize);          // 원래 글자 크기 = 최대
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx || !H || !base) return;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${base}px ${cs.fontFamily}`;
      const m = ctx.measureText(text || ' ');
      const fa = m.fontBoundingBoxAscent;
      const fd = m.fontBoundingBoxDescent;
      if (fa === undefined || fd === undefined) return;   // 오래된 브라우저 — 예전 그대로
      const ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      const room = H * (1 - pad * 2);
      let k = ink > room && ink > 0 ? room / ink : 1;      // 칸보다 크면 줄인다 (작으면 그대로)
      let A = m.actualBoundingBoxAscent * k;
      let D = m.actualBoundingBoxDescent * k;
      if (k < 1) {
        // 줄인 크기로 한 번 더 잰다 — 글자 모양은 크기에 딱 비례하지 않아 칸 끝에 닿을 수 있다
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${base * k}px ${cs.fontFamily}`;
        const m2 = ctx.measureText(text || ' ');
        const s2 = Math.min(1, room / (m2.actualBoundingBoxAscent + m2.actualBoundingBoxDescent));
        k *= s2;
        A = m2.actualBoundingBoxAscent * s2;
        D = m2.actualBoundingBoxDescent * s2;
      }
      // 줄 칸 높이를 H로 두면 기준선은 (H - 글꼴 높이)/2 + 윗부분 — 글자 모양의 가운데가 칸 가운데로 오게 옮긴다
      const naturalBase = (H - (fa + fd) * k) / 2 + fa * k;
      const wantBase = (H - (A + D)) / 2 + A;
      const next = {
        size: Math.round(base * k * 10) / 10,
        dy: Math.round((wantBase - naturalBase) * 10) / 10,
        lh: Math.round(H),
      };
      setFit(f => (f && f.size === next.size && f.dy === next.dy && f.lh === next.lh ? f : next));
    };
    measure();
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    void fonts?.ready.then(measure);
    fonts?.addEventListener?.('loadingdone', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      alive = false;
      fonts?.removeEventListener?.('loadingdone', measure);
      ro?.disconnect();
    };
  }, [text, pad, style?.fontFamily, style?.fontWeight]);

  return (
    <span ref={ref} className={className} style={style}>
      <span style={{
        display: 'block', whiteSpace: 'nowrap',
        ...(fit ? {
          fontSize: fit.size, lineHeight: `${fit.lh}px`,
          transform: fit.dy ? `translateY(${fit.dy}px)` : undefined,
        } : null),
      }}>{text}</span>
    </span>
  );
}
