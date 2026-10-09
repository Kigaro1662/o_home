'use client';
// 맞춤법 검사 밑줄 (v2.0 사용자 요청) — 환경설정 > 디자인에서 「숨김」이면
// 페이지 전체의 빨간 물결줄을 끈다. spellcheck는 상속되는 속성이라 body에 한 번만 걸면
// 그 아래 인풋·텍스트에리어·에디터가 모두 따라온다.
import { useEffect } from 'react';
import { useSiteSettings } from '@/lib/siteStore';

export function SpellCheck() {
  const [site] = useSiteSettings();
  const off = !!site.noSpell;
  useEffect(() => {
    document.body.setAttribute('spellcheck', off ? 'false' : 'true');
  }, [off]);
  return null;
}
