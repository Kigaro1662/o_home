'use client';
// 플레이기록 추가 (4.16) — 페이지형 등록
import React, { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useMenuSettings, canWriteAt, writeKeyOf } from '@/lib/menuStore';
import { useSectionParam, secStamp, secQuery , useSectionTitle } from '@/lib/sectionStore';
import { useLocalList, newId } from '@/lib/postStore';
import { PlayRecord, PLAYLOG_SEED } from '@/lib/galleryStore';
import { PlaylogForm } from '@/components/trpg/PlaylogForm';
import { useToast } from '@/components/ui/Toast';
import { PageTitle, EditableDesc } from '@/components/ui/PageText';

function PlaylogNewPageInner() {
  // 어느 섹션에서 눌러 왔는지 (v2.0) — 새 항목을 그 목록에 넣는다
  const sec = useSectionParam('playlog');
  // 큰 글씨 — 추가 섹션이면 그 이름, 눌렀을 때도 그 목록으로 (v2.0 사용자 제보)
  const tt = useSectionTitle('playlog', sec.id, 'ADD RECORD');
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [records, setRecords] = useLocalList<PlayRecord>('ohome.playlog.v1', PLAYLOG_SEED);
  // 등록 권한 (커플홈) — 환경설정 「권한」에서 (기본: 관리자) · ADD 버튼과 같은 판정으로 주소 직접 진입도 막는다
  const [menuSet, , menuLoaded] = useMenuSettings();

  if (!menuLoaded) return <section className="page" />;
  if (!user || !canWriteAt(menuSet, writeKeyOf('/playlog', sec.id), { loggedIn: true, isAdmin, id: user.id }, 'admin')) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle href={tt.href}>{tt.title}</PageTitle><p>허용된 회원만 등록할 수 있습니다</p></div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-head"><PageTitle href={tt.href}>{tt.title}</PageTitle><EditableDesc k="playlog-new-desc" def="플레이기록 추가" /></div>
      <PlaylogForm initial={null} records={records}
        onCancel={() => router.push('/playlog' + secQuery('playlog', sec.id))}
        onSave={v => {
          // 등록한 사람을 남긴다 (커플홈) — 수정·삭제는 본인과 관리자
          setRecords([...records, { id: newId(), ...v, ...secStamp(sec.id), authorId: user.id }]);
          toast('기록이 추가되었습니다');
          router.push('/playlog' + secQuery('playlog', sec.id));
        }} />
    </section>
  );
}

export default function PlaylogNewPage() {
  return <Suspense fallback={<section className="page" />}><PlaylogNewPageInner /></Suspense>;
}
