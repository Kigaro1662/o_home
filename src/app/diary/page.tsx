'use client';
// 다이어리 (4.14) — 아코디언 목록: 제목+무드+날짜 한 줄, 클릭 시 그 자리에서 펼침 · 공개범위(비공개는 관리자만)
// 커플홈: 두 사람이 같이 쓰는 일기 — 대표 자관의 왼쪽/오른쪽 캐릭터 칸으로 반씩 나눠 쓴다.
//   · 칸 머리의 ＋ WRITE는 그 캐릭터로 쓸 수 있는 사람에게만 (관리자는 자캐, 상대 오너는 권한 받은 캐릭터)
//   · 구분 탭(환경설정 > 다이어리 — 「전체」 없이, 맨 위 구분이 처음 화면) · 칸마다 5개씩 페이지 · 댓글(캐입 가능)
//   · 무드는 일기마다 붙는 표시로만 — 거르는 탭은 두지 않는다 (탭이 두 종류면 복잡하다, 커플홈 사용자 요청)
//   · 페어 자관이 없으면 예전처럼 한 칸
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSectionParam, filterSection, sectionSetter, secQuery, sectionHref } from '@/lib/sectionStore';
import { useLocalList, CommentRow, COMMENT_KEY, COMMENT_SEED } from '@/lib/postStore';
import {
  DiaryPost, DIARY_SEED, Mood, MOOD_SEED, moodTint, DIARY_PER_PAGE, useDiarySettings, diaryOrder,
} from '@/lib/diaryStore';
import {
  Character, CHAR_SEED, Relation, REL_SEED, openableRels, pairSides, inCharChoices, charGrant, charPath, charInAu, auParamOf, faceCropOf,
} from '@/lib/charStore';
import { useFonts } from '@/lib/fontStore';
import { renderBody } from '@/lib/sanitize';
import { SearchBar, Pager } from '@/components/ui/Kit';
import { ConfirmModal } from '@/components/ui/Modal';
import { Lightbox } from '@/components/ui/Lightbox';
import { BlobImg } from '@/lib/blobStore';
import { CroppedBlobImg } from '@/components/ui/CropEditor';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { CharComments } from '@/components/ui/CharComments';
import { FitHeight } from '@/components/ui/InkFit';

type Side = 'l' | 'r' | 'one';

function MoodIcon({ mood, size = 30 }: { mood?: Mood; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      // 줄높이를 1로 눌러야 글자 상자가 아니라 글자 자체가 가운데로 온다 (v2.0 사용자 발견)
      display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
      fontSize: size * 0.45,
      background: moodTint(mood?.color ?? '#888'), color: mood?.color ?? 'var(--sub)',
    }}>{mood?.icon ?? '·'}</span>
  );
}

function DiaryBody({ p, onOpen }: { p: DiaryPost; onOpen: (ids: string[], idx: number) => void }) {
  const html = useMemo(() => renderBody('md', p.body), [p.body]);
  return (
    <div className="dy-body">
      <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />
      {/* 이미지는 썸네일 리스트로 — 클릭하면 뷰어(좌우 넘김) (v1.9 사용자 확정) */}
      {p.imgIds.length > 0 && (
        <div className="dy-thumbs">
          {p.imgIds.map((id, i) => (
            <div key={id} className="dy-thumb" onClick={() => onOpen(p.imgIds, i)}>
              <BlobImg fileRef={id} ph="" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiaryPageInner() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const { familyOf } = useFonts();
  const [postsAll, setPostsAll, loaded] = useLocalList<DiaryPost>('ohome.diary.v1', DIARY_SEED);
  // 여러 개로 만든 섹션 (v2.0) — 주소의 ?s= 가 가리키는 것만 보여 준다
  const sec = useSectionParam('diary');
  const posts = filterSection(postsAll, sec.id);
  // 저장은 이 섹션 자리만 교체 — 걸러진 목록을 그대로 넘겨도 다른 섹션이 지워지지 않는다
  const setPosts = sectionSetter(postsAll, sec.id, setPostsAll);
  const [moods] = useLocalList<Mood>('ohome.moods.v1', MOOD_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  // 댓글 — 한 번만 불러 펼친 일기마다 나눠 준다 (게시판·타래와 같은 컬렉션, target 'diary')
  const [cmtRows, setCmtRows] = useLocalList<CommentRow>(COMMENT_KEY, COMMENT_SEED);
  const [dset, , dsetLoaded] = useDiarySettings();
  // 펼친 일기 — 칸마다 하나씩 (커플홈 사용자 요청: 양쪽을 다 열어 둘 수 있고, 같은 칸의 다른 일기를 누르면 그쪽만 바뀐다)
  const [open, setOpen] = useState<Record<Side, string | null>>({ l: null, r: null, one: null });
  const [fCat, setFCat] = useState<string | null>(null);   // null = 아직 안 고름 → 맨 위 구분
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<Record<Side, number>>({ l: 1, r: 1, one: 1 });
  const [delFor, setDelFor] = useState<DiaryPost | null>(null);
  const [lb, setLb] = useState<{ srcs: string[]; idx: number } | null>(null); // 이미지 뷰어 (v1.9)

  /* 구분 탭 — 「전체」는 없다 (커플홈 사용자 요청). 처음 화면은 환경설정에서 맨 위에 둔 구분.
     구분이 하나도 없으면 탭 없이 전부, 구분 없는 일기는 「구분 없음」 탭(있을 때만)에서 본다 */
  const effCat = dset.cats.length === 0 ? 'all'
    : fCat === 'none' || (fCat && dset.cats.some(c => c.id === fCat)) ? fCat : dset.cats[0].id;
  const jumpRef = useRef<string | null>(null);   // #id로 들어온 일기 — 그 일기가 보이는 페이지로 옮길 때까지 기억

  /* ---------- 칸 나눔 — 이 다이어리에 연결한 자관(환경설정 > 다이어리)의 왼쪽·오른쪽 캐릭터.
     연결하지 않았거나 그 자관이 없어졌으면 이 사람이 열 수 있는 첫 자관 ---------- */
  const linkedId = dset.relBySec?.[sec.id];
  const rel = (linkedId && rels.find(r => r.id === linkedId)) || openableRels(rels, { isAdmin, loggedIn: !!user })[0];
  const sides = pairSides(rel);
  const charOf = (id?: string) => chars.find(c => c.id === id);
  const choices = user ? inCharChoices(chars, { isAdmin, id: user.id }) : [];
  const canWriteAs = (cid: string) => choices.some(c => c.id === cid);
  /** 이 일기가 어느 칸인지 — 쓴 캐릭터로. 캐릭터 없이 쓴 예전 일기는 쓴 사람이 권한을 가진 쪽, 그다음 자캐 쪽 */
  const sideOf = (p: DiaryPost): Side => {
    if (!sides) return 'one';
    if (p.charId === sides[0]) return 'l';
    if (p.charId === sides[1]) return 'r';
    const L = charOf(sides[0]);
    const R = charOf(sides[1]);
    if (p.authorId && R && charGrant(R, p.authorId)) return 'r';
    if (p.authorId && L && charGrant(L, p.authorId)) return 'l';
    return R?.own && !L?.own ? 'r' : 'l';
  };

  const query = q.trim().toLowerCase();
  // 내가 쓴 나만보기 일기는 나에게도 보인다 (두 사람이 같이 쓰므로)
  const canSee = (p: DiaryPost) => isAdmin || p.visibility === 'public'
    || (p.visibility === 'member' && !!user) || (!!user && p.authorId === user.id);
  const canEdit = (p: DiaryPost) => isAdmin || (!!user && p.authorId === user.id);
  const seen = posts.filter(canSee);
  const visible = seen
    .filter(p => effCat === 'all' || (effCat === 'none' ? !p.catId : p.catId === effCat))
    .filter(p => !query || p.title.toLowerCase().includes(query))
    .sort(diaryOrder);

  // 메인 위젯·알림에서 특정 일기로 진입 — /diary#id (4.14). 그 일기가 있는 칸에서 펼치고, 구분 탭도 그 일기 쪽으로
  useEffect(() => {
    if (!loaded || !dsetLoaded) return;
    const h = window.location.hash.slice(1);
    const p = h ? posts.find(x => x.id === h) : undefined;
    if (!p) return;
    jumpRef.current = p.id;
    setOpen(o => ({ ...o, [sideOf(p)]: p.id }));
    if (dset.cats.length) setFCat(p.catId && dset.cats.some(c => c.id === p.catId) ? p.catId : 'none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, dsetLoaded]);
  // 거르는 조건이 바뀌면 모든 칸을 첫 페이지부터 — #id로 들어온 일기가 있으면 그 일기가 있는 페이지로
  useEffect(() => {
    const t = jumpRef.current;
    const p = t ? posts.find(x => x.id === t) : undefined;
    const side = p ? sideOf(p) : null;
    const idx = p && side ? visible.filter(x => sideOf(x) === side).findIndex(x => x.id === t) : -1;
    if (p && side && idx >= 0) {
      jumpRef.current = null;
      setPages({ l: 1, r: 1, one: 1, [side]: Math.floor(idx / DIARY_PER_PAGE) + 1 });
      setTimeout(() => document.getElementById(p.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
    } else setPages({ l: 1, r: 1, one: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effCat, q, loaded, dsetLoaded]);

  if (!loaded) return <section className="page" />;

  const moodOf = (id: string) => moods.find(m => m.id === id);
  const cntCat = (cid: string) => seen.filter(p => cid === 'all' || (cid === 'none' ? !p.catId : p.catId === cid)).length;
  // 쓰기 — 그 칸의 캐릭터와 지금 보고 있는 구분을 골라 둔 채로 연다
  const writeHref = (cid?: string) => {
    const qs = new URLSearchParams();
    const s = new URLSearchParams(secQuery('diary', sec.id).slice(1)).get('s');
    if (s) qs.set('s', s);
    if (cid) qs.set('char', cid);
    if (effCat !== 'all' && effCat !== 'none') qs.set('cat', effCat);
    const str = qs.toString();
    return `/diary/write${str ? `?${str}` : ''}`;
  };
  const listHref = sectionHref('diary', sec.id);

  /** 일기 한 줄 (펼치면 본문 · 수정/삭제 · 댓글) */
  const renderRow = (p: DiaryPost, side: Side) => {
    const m = moodOf(p.moodId);
    const opened = open[side] === p.id;
    return (
      <div key={p.id} id={p.id} className={`dy-row ${opened ? 'open' : ''}`}>
        {/* 접힘: 제목 세로 중앙 / 펼침: 위 정렬 (4.14 v1.8) */}
        <div className="hd" onClick={() => setOpen(o => ({ ...o, [side]: o[side] === p.id ? null : p.id }))}>
          <MoodIcon mood={m} />
          <b className="tt">{p.title}</b>
          {/* 구분 뱃지는 두지 않는다 (사용자 확정) — 위에 구분 탭이 있어 겹친다 */}
          {p.visibility !== 'public' && (
            <span className="pill" style={{ flexShrink: 0 }}>{p.visibility === 'member' ? '멤버' : '비공개'}</span>
          )}
          <small className="dt">{p.date.replace(/-/g, '.')}{m ? ` · ${m.name}` : ''}</small>
          <span className={`arr ${opened ? 'up' : ''}`} />
        </div>
        {/* 항상 렌더 + grid-rows 트랜지션으로 부드럽게 펼침 (덜컥임 방지) */}
        <div className="dy-fold" aria-hidden={!opened}>
          <div className="dy-fold-in">
            <DiaryBody p={p} onOpen={(ids, idx) => setLb({ srcs: ids, idx })} />
            {canEdit(p) && (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', padding: '0 0 12px' }}>
                <button className="btn btn-ghost" style={{ padding: '4px 11px', fontSize: 10.5 }}
                  onClick={() => router.push(`/diary/${p.id}/edit`)}>EDIT</button>
                <button className="btn btn-ghost" style={{ padding: '4px 11px', fontSize: 10.5 }}
                  onClick={() => setDelFor(p)}>DELETE</button>
              </div>
            )}
            {/* 댓글 — 펼쳤을 때만 그린다. 알림은 이 일기를 쓴 사람과 관리자에게 */}
            {opened && (
              <CharComments target="diary" targetId={p.id} rows={cmtRows} setRows={setCmtRows} chars={chars}
                notify={{
                  title: `「${p.title}」 일기에 새 댓글`, href: `${listHref}#${p.id}`,
                  toIds: p.authorId ? [p.authorId] : [], admins: true,
                }} />
            )}
          </div>
        </div>
      </div>
    );
  };

  /** 한 칸 — 머리(캐릭터 · ＋ WRITE) + 5개씩 페이지 */
  const renderCol = (side: Side, cid?: string) => {
    const list = visible.filter(p => sideOf(p) === side);
    const total = Math.max(1, Math.ceil(list.length / DIARY_PER_PAGE));
    const cur = Math.min(pages[side], total);
    const shown = list.slice((cur - 1) * DIARY_PER_PAGE, cur * DIARY_PER_PAGE);
    // 구분 탭에 AU를 연결해 뒀으면(환경설정) 그 탭에서는 칸 머리의 캐릭터를 그 AU 모습으로 (커플홈 사용자 요청).
    // 다른 자관의 AU면 무시한다 — 이 다이어리의 자관에 속한 AU만
    const catAu = dset.cats.find(c => c.id === effCat)?.auKey;
    const baseCh = charOf(cid);
    const ch = baseCh && catAu && rel && catAu.startsWith(`${rel.id}:`) ? charInAu(baseCh, rels, catAu) : baseCh;
    return (
      <div className="dy-col" key={side}>
        {side !== 'one' && (
          <div className="dy-col-hd">
            {/* 프로필 사진을 누르면 캐릭터 페이지로 (커플홈 사용자 요청) */}
            <span className={`cf ${ch ? 'go' : ''}`} data-tip={ch ? '프로필 보기' : undefined}
              style={{ background: ch?.color ?? 'var(--line)', ['--cc' as string]: ch?.color ?? 'var(--line)' }}
              onClick={() => {
                // AU 탭이면 그 AU 프로필로 바로 (사용자 제보 — 원래 프로필로 갔다)
                if (!baseCh) return;
                router.push(catAu && ch !== baseCh ? `${charPath(baseCh)}?au=${encodeURIComponent(auParamOf(baseCh, rels, catAu))}` : charPath(baseCh));
              }}>
              {/* 얼굴칸 위치는 자관(·그 탭의 AU)에서 잡아 둔 값 (커플홈 사용자 제보) */}
              {ch?.thumbId && <CroppedBlobImg fileRef={ch.thumbId} crop={faceCropOf(ch, rels, { relId: rel?.id, auKey: catAu })} />}
            </span>
            {/* 세로값 고정 + 글자 크기를 거기에 맞춘다 (커플홈 사용자 요청) — 두 칸 이름의 폰트가 달라도
                머리 줄 높이가 같아서 아래 목록이 어긋나지 않는다 */}
            <FitHeight className="nm" text={ch?.name ?? '—'} style={{
              fontFamily: familyOf(ch?.fontId) ?? 'var(--serif-base)',
              fontWeight: (ch?.nameBold ?? true) ? 700 : 400,
            }} />
            <small>{list.length}</small>
            {cid && canWriteAs(cid) && (
              <button className="btn btn-dark" onClick={() => router.push(writeHref(cid))}>＋ WRITE</button>
            )}
          </div>
        )}
        <div className="panel" style={{ padding: '6px 20px' }}>
          {shown.map(p => renderRow(p, side))}
          {shown.length === 0 && <p className="hint" style={{ padding: 16 }}>{query ? '검색 결과가 없습니다' : '일기가 없습니다'}</p>}
        </div>
        {total > 1 && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
            <Pager page={cur} total={total} onChange={n => setPages(s => ({ ...s, [side]: n }))} />
          </div>
        )}
      </div>
    );
  };

  // 한 칸일 때 쓰기 — 관리자이거나 캐입할 캐릭터가 있는 사람
  const canWriteOne = isAdmin || choices.length > 0;

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle>{sec.id === 'main' ? 'DIARY' : sec.name}</PageTitle>
        <EditableDesc k="diary-desc" def="무드 일기 — 클릭하면 그 자리에서 펼쳐집니다" />
      </div>

      {/* 구분 탭 (커플홈 — 환경설정 > 다이어리에서 관리 · 순서도 거기서) + 검색·WRITE.
          탭에는 숫자를 붙이지 않는다 — 이름과 붙어 읽혀 구분이 안 됐다 (커플홈 사용자 요청) */}
      <div className="toolrow" style={{ marginBottom: 16 }}>
        {dset.cats.length > 0 ? (
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {dset.cats.map(c => (
              <button key={c.id} className={effCat === c.id ? 'on' : ''} onClick={() => setFCat(c.id)}>
                {c.name}
              </button>
            ))}
            {cntCat('none') > 0 && (
              <button className={effCat === 'none' ? 'on' : ''} onClick={() => setFCat('none')}>구분 없음</button>
            )}
          </div>
        ) : <span />}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SearchBar placeholder="제목 검색" onSearch={v => setQ(v)} />
          {!sides && canWriteOne && <button className="btn btn-dark" onClick={() => router.push(writeHref())}>＋ WRITE</button>}
        </div>
      </div>

      {/* 왼쪽 캐릭터 칸 | 오른쪽 캐릭터 칸 — 자관 상세와 같은 좌우 (좌우 바꾸기 반영). 페어가 아니면 한 칸 */}
      {sides
        ? <div className="dy-split">{renderCol('l', sides[0])}{renderCol('r', sides[1])}</div>
        : renderCol('one')}

      <ConfirmModal open={delFor !== null} title="일기를 삭제하시겠습니까?"
        body={`"${delFor?.title}" — 삭제하면 복구할 수 없습니다.`}
        onClose={() => setDelFor(null)}
        buttons={[
          { label: 'DELETE', kind: 'accent', onClick: () => {
            const gone = delFor!;
            setPosts(posts.filter(x => x.id !== gone.id));
            // 달린 댓글도 함께 — 남의 댓글은 관리자만 지울 수 있어, 관리자가 아니면 내 댓글만 정리한다
            const drop = (c: CommentRow) => c.target === 'diary' && c.targetId === gone.id
              && (isAdmin || c.authorId === user?.id);
            if (cmtRows.some(drop)) setCmtRows(cmtRows.filter(c => !drop(c)));
            setDelFor(null);
          } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setDelFor(null) },
        ]} />
      {/* 이미지 뷰어 — 썸네일 클릭 시 (v1.9 사용자 확정) */}
      {lb && <Lightbox srcs={lb.srcs} index={lb.idx} onClose={() => setLb(null)} />}
    </section>
  );
}

/** ?s= 를 읽으므로 Suspense 경계가 필요하다 (Next App Router) */
export default function DiaryPage() {
  return <Suspense fallback={<section className="page" />}><DiaryPageInner /></Suspense>;
}
