'use client';
// 공통 드래그 정렬 리스트 (v1.9 — 들어 올림 + 빈 자리 + FLIP)
// 행 안의 .drag-h 핸들을 잡아 세로로 끌면 다른 행이 부드럽게 밀려나며 삽입 위치를 보여줌.
// 놓으면 정확한 슬롯 위치로 안착 애니메이션 후 커밋 — 커밋 프레임은 transition을 죽여 튀지 않게 (v1.9)
import React, { useRef, useState } from 'react';

export function DragList<T>({ items, keyOf, render, onReorder, disabled }: {
  items: T[];
  keyOf: (t: T) => string;
  render: (t: T, i: number) => React.ReactNode;
  onReorder: (items: T[]) => void;
  disabled?: boolean;
}) {
  const contRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: string; from: number; to: number; dy: number; h: number; settling?: boolean } | null>(null);
  const [frozen, setFrozen] = useState(false);   // 커밋 직후 1프레임 — transform 해제가 애니메이션되지 않게

  const onPointerDown = (e: React.PointerEvent, index: number) => {
    if (disabled || e.button !== 0) return;
    if (!(e.target as HTMLElement).closest('.drag-h')) return;
    e.preventDefault();
    e.stopPropagation();   // 중첩 DragList(메뉴 트리 등)에서 바깥 리스트가 같이 끌리지 않게
    const rows = Array.from(contRef.current!.children) as HTMLElement[];
    const tops = rows.map(r => r.getBoundingClientRect().top);
    const heights = rows.map(r => r.getBoundingClientRect().height);
    const startY = e.clientY;
    const key = keyOf(items[index]);
    setDrag({ key, from: index, to: index, dy: 0, h: heights[index] });

    const mv = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const centerY = tops[index] + heights[index] / 2 + dy;
      let to = index;
      for (let j = 0; j < rows.length; j++) {
        const c = tops[j] + heights[j] / 2;
        if (j < index && centerY < c) to = Math.min(to, j);
        if (j > index && centerY > c) to = Math.max(to, j);
      }
      setDrag(d => (d ? { ...d, dy, to } : d));
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      // 들어 올린 행을 정확한 도착 슬롯 오프셋으로 부드럽게 안착시킨 뒤 커밋
      setDrag(d => {
        if (!d) return null;
        const target = d.to === d.from ? 0
          : (tops[d.to] - tops[d.from]) + (d.to > d.from ? heights[d.to] - heights[d.from] : 0);
        return { ...d, dy: target, settling: true };
      });
      window.setTimeout(() => {
        setFrozen(true);
        setDrag(d => {
          if (d && d.to !== d.from) {
            const arr = [...items];
            const [m] = arr.splice(d.from, 1);
            arr.splice(d.to, 0, m);
            onReorder(arr);
          }
          return null;
        });
        // 커밋 리렌더(transform 해제 + DOM 순서 교체)가 그려진 다음 프레임에 transition 복원
        requestAnimationFrame(() => requestAnimationFrame(() => setFrozen(false)));
      }, 170);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={contRef}>
      {items.map((it, i) => {
        let style: React.CSSProperties = frozen ? { transition: 'none' } : {};
        let cls = 'dl-row';
        if (drag) {
          if (keyOf(it) === drag.key) {
            style = {
              transform: `translateY(${drag.dy}px) scale(1.02)`,
              transition: drag.settling ? 'transform .16s ease' : 'none',
            };
            cls += ' lift';
          } else if (drag.from < drag.to && i > drag.from && i <= drag.to) {
            style = { transform: `translateY(${-drag.h}px)` };
          } else if (drag.from > drag.to && i >= drag.to && i < drag.from) {
            style = { transform: `translateY(${drag.h}px)` };
          }
        }
        return (
          <div key={keyOf(it)} className={cls} style={style} onPointerDown={e => onPointerDown(e, i)}>
            {render(it, i)}
          </div>
        );
      })}
    </div>
  );
}
