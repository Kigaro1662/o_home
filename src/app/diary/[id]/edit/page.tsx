'use client';
// 일기 수정 (4.14) — 페이지형
// 커플홈: 쓴 사람 본인 또는 관리자. 관리자가 남의 일기를 고칠 때는 「누구의 일기」를 바꾸지 않는다
import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList } from '@/lib/postStore';
import { useSectionTitle } from '@/lib/sectionStore';
import { DiaryPost, DIARY_SEED, Mood, MOOD_SEED, useDiarySettings, diaryDraftKey } from '@/lib/diaryStore';
import { Character, CHAR_SEED, inCharChoices } from '@/lib/charStore';
import { DiaryForm } from '@/components/diary/DiaryForm';
import { useToast } from '@/components/ui/Toast';
import { PageTitle } from '@/components/ui/PageText';

export default function DiaryEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [posts, setPosts, loaded] = useLocalList<DiaryPost>('ohome.diary.v1', DIARY_SEED);
  // 큰 글씨 — 추가 섹션 항목이면 그 이름, 눌렀을 때도 그 목록으로 (v2.0 사용자 제보)
  const tt = useSectionTitle('diary', posts.find(x => x.id === id)?.secId, 'EDIT DIARY');
  const [moods] = useLocalList<Mood>('ohome.moods.v1', MOOD_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const [dset] = useDiarySettings();
  const p = posts.find(x => x.id === id);

  if (!loaded) return <section className="page" />;
  const mine = !!p && !!user && p.authorId === user.id;
  if (!p || !(isAdmin || mine)) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle href={tt.href}>{tt.title}</PageTitle><p>일기를 찾을 수 없거나 권한이 없습니다</p></div>
      </section>
    );
  }
  const choices = user ? inCharChoices(chars, { isAdmin, id: user.id }) : [];
  // 옛 일기(쓴 사람 기록이 없는 것)는 관리자 것이라 관리자가 캐릭터를 골라 줄 수 있다
  const lockChar = !mine && !!p.authorId;

  return (
    <section className="page">
      <div className="page-head"><PageTitle href={tt.href}>{tt.title}</PageTitle><p>{p.title}</p></div>
      <DiaryForm initial={p} moods={moods} cats={dset.cats} charChoices={choices} lockChar={lockChar}
        draftKey={diaryDraftKey(user?.id, p.id)}
        onCancel={() => router.push(tt.href)}
        onSave={v => {
          setPosts(posts.map(x => (x.id === p.id ? { ...x, ...v } : x)));
          toast('저장되었습니다');
          router.push(tt.href);
        }} />
    </section>
  );
}
