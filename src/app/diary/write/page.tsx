'use client';
// 일기 쓰기 (4.14) — 페이지형
// 커플홈: 두 사람이 쓴다 — 관리자, 그리고 캐릭터 권한을 받은 회원(상대 오너). 일기는 그 사람이 쓸 수 있는
// 캐릭터 이름으로 쓰고, 칸 머리의 ＋ WRITE로 들어오면(?char=) 그 캐릭터가 골라져 있다. 섹션(?s=)도 따라간다
import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId } from '@/lib/postStore';
import { DiaryPost, DIARY_SEED, Mood, MOOD_SEED, useDiarySettings, diaryDraftKey } from '@/lib/diaryStore';
import { Character, CHAR_SEED, inCharChoices } from '@/lib/charStore';
import { useSectionParam, secStamp, sectionHref } from '@/lib/sectionStore';
import { DiaryForm } from '@/components/diary/DiaryForm';
import { useToast } from '@/components/ui/Toast';
import { PageTitle, EditableDesc } from '@/components/ui/PageText';
import { notifyMembers } from '@/lib/notifStore';
import { useMembers } from '@/lib/members';

function DiaryWriteInner() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [posts, setPosts] = useLocalList<DiaryPost>('ohome.diary.v1', DIARY_SEED);
  const [moods] = useLocalList<Mood>('ohome.moods.v1', MOOD_SEED);
  const [chars, , charsLoaded] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const [dset] = useDiarySettings();
  const sec = useSectionParam('diary');
  const members = useMembers();   // 새 일기 알림 받을 사람들 (커플홈)
  const sp = useSearchParams();
  const wantChar = sp.get('char') ?? undefined;
  const wantCat = sp.get('cat') ?? undefined;   // 보고 있던 구분 탭
  const listHref = sectionHref('diary', sec.id);

  if (!charsLoaded) return <section className="page" />;
  const choices = user ? inCharChoices(chars, { isAdmin, id: user.id }) : [];
  if (!isAdmin && choices.length === 0) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle>DIARY</PageTitle><p>일기는 관리자와 캐릭터 권한을 받은 회원이 쓸 수 있습니다</p></div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-head"><PageTitle>WRITE DIARY</PageTitle><EditableDesc k="diary-write-desc" def="일기 쓰기" /></div>
      <DiaryForm initial={null} moods={moods} cats={dset.cats} charChoices={choices} initialCharId={wantChar} initialCatId={wantCat}
        draftKey={diaryDraftKey(user?.id, `new:${sec.id}`)}
        onCancel={() => router.push(listHref)}
        onSave={v => {
          // 쓴 사람을 남긴다 — 두 사람이 같이 쓰므로 수정·삭제 권한과 칸 판정에 쓴다
          const p: DiaryPost = { id: newId(), ...v, authorId: user?.id, createdAt: new Date().toISOString(), ...secStamp(sec.id) };
          setPosts([p, ...posts]);
          // 상대방에게 알림 (커플홈 사용자 요청) — 나만보기 일기는 있다는 것도 알리지 않는다
          if (p.visibility !== 'private') {
            const who = chars.find(c => c.id === p.charId)?.name ?? user?.nickname ?? '누군가';
            notifyMembers({
              type: 'diary', href: listHref,
              title: `${who}의 새 일기 「${p.title || p.date}」`,
              body: p.body.replace(/[#*_>`[\]()!]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60),
            }, members);
          }
          toast('일기가 등록되었습니다');
          router.push(listHref);
        }} />
    </section>
  );
}

/** ?s=·?char= 를 읽으므로 Suspense 경계가 필요하다 (Next App Router) */
export default function DiaryWritePage() {
  return <Suspense fallback={<section className="page" />}><DiaryWriteInner /></Suspense>;
}
