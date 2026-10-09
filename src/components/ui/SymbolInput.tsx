'use client';
// 특수문자 인풋 (v1.9) — 클릭하면 프리셋 리스트가 떠서 골라 넣고, 직접 입력도 그대로 가능.
// 캐릭터 탭 아이콘·무드 아이콘 등 아이콘 한 글자 입력 공용.
// · 팝업은 body 포털(fixed) — 패널·행의 overflow에 잘리지 않음 (v1.9 무드 리스트 잘림 수정)
// · 프리셋은 페이지(카테고리)로 확장 — 이모지 없이 유니코드 기호만 (v1.9 사용자 요청)
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KInput } from './Kit';

const SYM_PAGES: { label: string; syms: string[] }[] = [
  {
    label: '별·장식',
    syms: [
      '✦', '✧', '★', '☆', '✵', '✶', '✷', '✸', '✹', '✺', '✻', '✼', '✽', '✳', '✴', '❆',
      '❅', '❄', '❋', '❊', '✿', '❀', '✾', '❁', '⁂', '❃', '❇', '❈', '❉', '☘', '⚜', '࿔',
    ],
  },
  {
    // 이모지로 렌더될 수 있는 문자(❤·날씨 기호 등) 전부 제외 — 텍스트 글리프만 (v1.9 사용자 지적)
    label: '하트·음표',
    syms: [
      '♡', '♥', '❥', '❣', 'ღ', '♤', '♠', '♧', '♣', '♢', '♦', '☙', '❦', '❧', '୨', '୧',
      '♪', '♫', '♩', '♬', '♭', '♮', '♯', '☾', '☽', '☼', '♔', '♕', '♚', '♛', 'ஐ', '༄',
    ],
  },
  {
    label: '도형',
    syms: [
      '●', '○', '◉', '◎', '◐', '◑', '◒', '◓', '■', '□', '▣', '▤', '▥', '▦', '▧', '◈',
      '◆', '◇', '▲', '△', '▼', '▽', '◀', '▶', '◁', '▷', '◢', '◣', '◤', '◥', '▰', '▱',
    ],
  },
  {
    label: '화살표·수식',
    syms: [
      '←', '↑', '→', '↓', '↔', '↕', '↖', '↗', '↘', '↙', '⇐', '⇒', '⇔', '↺', '↻', '⇶',
      '∴', '∵', '∞', '≒', '≠', '≡', '±', '×', '÷', '√', '∫', '∮', '∂', '∇', '∑', '∏',
    ],
  },
  {
    label: '부호·괄호',
    syms: [
      '※', '†', '‡', '•', '◦', '‣', '⁃', '∙', '·', '˚', '°', '′', '″', '¶', '§', '¤',
      '「', '」', '『', '』', '【', '】', '〈', '〉', '《', '》', '〔', '〕', '❛', '❜', '❝', '❞',
    ],
  },
];

// 팝업 크기 (CSS와 동기) — 8열×30px+gap2 + padding 16 + border 2 + 페이지 탭 줄(26)
const COLS = 8;
const MAX_ROWS = Math.max(...SYM_PAGES.map(p => Math.ceil(p.syms.length / COLS)));
const POP_W = COLS * 30 + (COLS - 1) * 2 + 16 + 2;
const POP_H = MAX_ROWS * 30 + (MAX_ROWS - 1) * 2 + 16 + 2 + 30;

export function SymbolInput({ value, onChange, maxLength = 2, style }: {
  value: string; onChange: (v: string) => void; maxLength?: number; style?: React.CSSProperties;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [page, setPage] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const openAt = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
    const top = r.bottom + 6 + POP_H > window.innerHeight
      ? Math.max(8, r.top - 6 - POP_H)   // 아래 공간 부족 — 위로
      : r.bottom + 6;
    setPos({ left, top });
  };

  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) setPos(null);
    };
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;   // 팝업 내부 스크롤은 무시
      setPos(null);   // 페이지 스크롤 시 닫기 (fixed 좌표라 따라가지 않음)
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [pos]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <KInput value={value} style={style}
        onChange={e => onChange(e.target.value.slice(0, maxLength))}
        onFocus={openAt} onClick={openAt} />
      {pos && typeof document !== 'undefined' && createPortal(
        <div ref={popRef} className="sym-pop" style={{ left: pos.left, top: pos.top }}>
          <div className="sym-tabs">
            {SYM_PAGES.map((p, i) => (
              <button key={p.label} type="button" className={i === page ? 'on' : ''}
                onMouseDown={e => e.preventDefault()}
                onClick={() => setPage(i)}>{p.label}</button>
            ))}
          </div>
          <div className="sym-grid">
            {SYM_PAGES[page].syms.map(s => (
              <button key={s} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(s); setPos(null); }}>{s}</button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
