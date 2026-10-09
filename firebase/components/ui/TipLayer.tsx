'use client';
// 전역 커스텀 툴팁 (7장 — 브라우저 기본 title 툴팁 금지)
// [data-tip] 속성이 있는 요소에 호버하면 body 레벨 고정 팝업으로 표시 —
// 부모 overflow에 잘리지 않고, 화면 밖으로 나가지 않으며, 공간이 없으면 아래로 뜸.
// 드롭다운 색 변형은 data-tip-dd(또는 기존 .tipd-dd 클래스).
import { useEffect } from 'react';

export function TipLayer() {
  useEffect(() => {
    const pop = document.createElement('div');
    pop.className = 'tip-pop';
    document.body.appendChild(pop);
    let cur: Element | null = null;

    const hide = () => {
      cur = null;
      pop.classList.remove('on');
    };

    const show = (el: Element) => {
      const txt = el.getAttribute('data-tip');
      if (!txt) { hide(); return; }
      cur = el;
      pop.textContent = txt;
      pop.classList.toggle('dd', el.hasAttribute('data-tip-dd') || el.classList.contains('tipd-dd'));
      // 먼저 화면 밖에서 크기 측정 후 배치
      pop.style.left = '0px';
      pop.style.top = '-9999px';
      pop.classList.add('on');
      const r = el.getBoundingClientRect();
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      const x = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 8));
      let y = r.top - ph - 9;
      if (y < 8) y = r.bottom + 9; // 위 공간이 없으면 아래로
      pop.style.left = `${Math.round(x)}px`;
      pop.style.top = `${Math.round(y)}px`;
    };

    const onOver = (e: Event) => {
      const t = e.target as Element | null;
      const hit = t?.closest?.('[data-tip]') ?? null;
      if (!hit) { if (cur) hide(); return; }
      if (hit !== cur) show(hit);
    };
    // 클릭·스크롤·창 이탈 시 즉시 숨김 (클릭으로 문구가 바뀌거나 요소가 사라지는 경우 포함)
    const onDown = () => hide();
    const onScroll = () => hide();
    const onLeave = (e: PointerEvent) => { if (!e.relatedTarget) hide(); };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerout', onLeave, true);
    window.addEventListener('blur', onDown);
    return () => {
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerout', onLeave, true);
      window.removeEventListener('blur', onDown);
      pop.remove();
    };
  }, []);
  return null;
}
