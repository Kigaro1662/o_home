'use client';
// 태그 입력칸 (커플홈 사용자 요청 — RP LOG 태그: "입력할 때 비슷한 이름의 태그가 있으면 아래에 자동으로 드롭다운 … 자동완성").
// 고른 태그는 칩으로, 그 뒤에 입력칸. 입력 중 기존 태그 중 글자가 들어 있는 것을 아래 목록으로 띄우고 ↑↓·Enter·클릭으로 고른다.
// Enter·쉼표는 입력한 글 그대로 추가, 빈 칸에서 Backspace는 마지막 칩을 뺀다. 태그 앞의 #은 알아서 뗀다.
import React, { useEffect, useMemo, useRef, useState } from 'react';

const norm = (s: string) => s.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();

export function TagInput({ value, onChange, suggestions, placeholder, maxTags = 20 }: {
  value: string[];
  onChange: (next: string[]) => void;
  /** 자동완성 후보 — 다른 글에 이미 쓰인 태그들 (많이 쓰인 순으로 넘기면 그 순서로 뜬다) */
  suggestions: string[];
  placeholder?: string;
  maxTags?: number;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = norm(text).toLowerCase();
  const list = useMemo(() => {
    const seen = new Set(value.map(v => v.toLowerCase()));
    const cands = suggestions.filter(s => !seen.has(s.toLowerCase()));
    if (!q) return cands.slice(0, 8);
    // 앞글자가 같은 것 먼저, 그다음 글자가 들어 있는 것
    const starts = cands.filter(s => s.toLowerCase().startsWith(q));
    const rest = cands.filter(s => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q));
    return [...starts, ...rest].slice(0, 8);
  }, [suggestions, value, q]);
  useEffect(() => { setHi(0); }, [q, list.length]);

  const add = (raw: string) => {
    const t = norm(raw);
    if (!t) return;
    if (value.some(v => v.toLowerCase() === t.toLowerCase())) { setText(''); return; }
    if (value.length >= maxTags) return;
    onChange([...value, t]);
    setText('');
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  // 바깥을 누르면 목록 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;   // 한글 조합 중 Enter는 무시
    if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); setOpen(true); setHi(h => (h + 1) % list.length); return; }
    if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); setOpen(true); setHi(h => (h - 1 + list.length) % list.length); return; }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      // 목록이 떠 있고 입력과 다른 후보를 골랐으면 그것, 아니면 입력한 글 그대로
      if (open && list[hi] && q && list[hi].toLowerCase() !== q) add(list[hi]);
      else if (open && list[hi] && !q) add(list[hi]);
      else add(text);
      return;
    }
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'Backspace' && !text && value.length) { remove(value.length - 1); }
  };

  const showList = open && list.length > 0;
  return (
    <div ref={boxRef} className="tagin" onClick={() => inputRef.current?.focus()}>
      {value.map((t, i) => (
        <span key={t} className="tagin-chip">#{t}<button type="button" aria-label="태그 빼기" onClick={ev => { ev.stopPropagation(); remove(i); }}>×</button></span>
      ))}
      <input ref={inputRef} className="tagin-in" value={text} placeholder={value.length ? '' : (placeholder ?? '태그 (Enter로 추가)')}
        onChange={e => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        onBlur={() => { if (norm(text)) add(text); }} />
      {showList && (
        <div className="tagin-list" role="listbox">
          {list.map((s, i) => (
            <button type="button" key={s} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
              onMouseDown={ev => ev.preventDefault()}   // 입력칸 blur(=입력 글 추가)보다 먼저 막는다
              onMouseEnter={() => setHi(i)}
              onClick={() => { add(s); inputRef.current?.focus(); }}>
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
