'use client';
// 캐릭터 (커플홈) — 목록 페이지를 두지 않는다. 캐릭터는 자관 페이지의 멤버 카드에서 연다.
// 옛 주소나 캐릭터 상세의 큰 제목(CHARACTERS)으로 들어오면 자관 페이지로 보낸다.
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CharsPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/rels'); }, [router]);
  return <section className="page" />;
}
