'use client';
// 스티커 메모장 (4.6) — 포스트잇 보드: 드래그 자유 배치 · 색/크기 · 랜덤 기울기 ·
// 클릭 = 맨 위로 · 우클릭 자체 컨텍스트 메뉴(순서/수정/삭제) · 우측 메모 리스트 · 작성 권한 옵션
// 커플홈: 페이지(종류)별 메모판 — 위쪽 탭(관리자는 추가·이름 바꾸기·삭제) · 캐입 메모(캐릭터 이름으로 남기기)
//         · 메모 코멘트 — 자관 문답의 부연처럼 모서리 색 점 + 호버 툴팁, 점을 누르면 코멘트 창
import React, { Suspense, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId, CommentRow, COMMENT_KEY, COMMENT_SEED, commentsFor } from '@/lib/postStore';
import {
  StickyMemo, MEMO_SEED, MEMO_COLORS, MEMO_SIZE_W, useMemoSettings,
} from '@/lib/memoStore';
import { Character, CHAR_SEED, inCharChoices, Relation, REL_SEED, charInAu, charAuOptions } from '@/lib/charStore';
import { useSectionParam, useSections, filterSection, sectionSetter, sectionHref, MAIN_SEC } from '@/lib/sectionStore';
import { useMenuSettings, canViewHref } from '@/lib/menuStore';
import { useFonts } from '@/lib/fontStore';
import { fmtMD } from '@/lib/threadStore';
import { Modal, useConfirmDelete } from '@/components/ui/Modal';
import { KTextarea, KInput, KSelect } from '@/components/ui/Kit';
import { ColorField } from '@/components/ui/ColorField';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { useToast } from '@/components/ui/Toast';
import { CharComments } from '@/components/ui/CharComments';
import { notifyMembers } from '@/lib/notifStore';
import { useMembers } from '@/lib/members';

/** 메모에 적힌 이름 — 캐입 메모면 캐릭터(테마색 점 + 이름)를 **그 캐릭터의 이름 폰트**로 (커플홈 사용자 요청 —
 *  캐릭터 글씨로 서명한 것처럼), 아니면 쓴 사람. 캐릭터가 지워졌으면 쓸 당시 이름(author)으로 */
function MemoWho({ m, chars, rels }: { m: StickyMemo; chars: Character[]; rels: Relation[] }) {
  const { familyOf } = useFonts();
  const base = m.charId ? chars.find(c => c.id === m.charId) : undefined;
  const ch = base ? charInAu(base, rels, m.auKey) : undefined;   // AU 캐릭터로 남긴 메모는 그 AU의 이름·색·폰트로 (커플홈)
  return ch
    ? (
      <b className="as-char" style={{ fontFamily: familyOf(ch.fontId) ?? 'var(--serif-base)' }}>
        <span className="dot-lbl"><i className="cmt-dot" style={{ background: ch.color }} />{ch.name}</span>
      </b>
    )
    : <b>{m.author}</b>;
}

function MemoInner() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const del = useConfirmDelete();
  const [memosAll, setMemosAll, loaded] = useLocalList<StickyMemo>('ohome.memo.v1', MEMO_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);   // AU 캐릭터로 남기기 (커플홈) — 자관의 AU 목록
  // 페이지(종류)별 메모판 (커플홈) — 주소의 ?s= 가 가리키는 페이지 것만 보여 준다
  const sec = useSectionParam('memo');
  const members = useMembers();   // 새 메모 알림 받을 사람들 (커플홈)
  const memos = filterSection(memosAll, sec.id);
  // 저장은 이 페이지 자리만 교체 — 새 메모에는 이 페이지 소속이 찍힌다
  const setMemos = sectionSetter(memosAll, sec.id, setMemosAll);
  const { list: secList, setList: setSecList } = useSections();
  const [menuSet] = useMenuSettings();
  const [settings] = useMemoSettings();
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  // 메모 코멘트 (커플홈) — 게시판·타래와 같은 댓글 컬렉션, target 'memo'
  const [cmtRows, setCmtRows] = useLocalList<CommentRow>(COMMENT_KEY, COMMENT_SEED);
  const [cmtFor, setCmtFor] = useState<StickyMemo | null>(null);   // 코멘트 창을 연 메모
  const cmtsOf = (m: StickyMemo) => commentsFor(cmtRows, 'memo', m.id);
  const cmtName = (c: { author: string; charId?: string }) => (c.charId && chars.find(x => x.id === c.charId)?.name) || c.author;
  /** 메모에 적을 이름 — 캐입이면 (AU 모습까지 합친) 캐릭터 이름, 아니면 쓴 사람 */
  const memoName = (m: StickyMemo) => {
    const base = m.charId ? chars.find(c => c.id === m.charId) : undefined;
    return base ? charInAu(base, rels, m.auKey).name : m.author;
  };
  const boardRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const canWrite = isAdmin || (!!user && settings.allowMember);
  const canTouch = (m: StickyMemo) => isAdmin || (!!user && m.authorId === user.id);
  const maxZ = () => Math.max(0, ...memos.map(m => m.z));

  /* ---------- 페이지 탭 (커플홈) — 메뉴에서 이 사람에게 감춘 페이지는 탭에도 없다 ---------- */
  const viewer = { loggedIn: !!user, isAdmin, id: user?.id };
  const pages = sec.items.filter(s => canViewHref(menuSet, sectionHref('memo', s.id), viewer));
  const [pageCtx, setPageCtx] = useState<{ id: string; x: number; y: number } | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const addPage = () => {
    const cur = secList('memo');
    const id = newId();
    setSecList('memo', [...cur, { id, name: `새 페이지 ${cur.length}` }]);
    router.push(sectionHref('memo', id));
  };
  const saveRename = () => {
    if (!rename) return;
    const name = rename.name.trim();
    if (!name) { toast('이름을 입력해 주세요'); return; }
    setSecList('memo', secList('memo').map(s => (s.id === rename.id ? { ...s, name } : s)));
    setRename(null);
  };
  /** 페이지 삭제 — 거기 붙은 메모는 버리지 않고 기본 페이지로 옮긴다 */
  const removePage = (id: string) => {
    setPageCtx(null);
    const name = secList('memo').find(s => s.id === id)?.name ?? '';
    const inPage = memosAll.filter(m => m.secId === id);
    del.ask(`페이지 「${name}」를 삭제하시겠습니까?`, () => {
      if (inPage.length) setMemosAll(memosAll.map(m => (m.secId === id ? { ...m, secId: undefined } : m)));
      setSecList('memo', secList('memo').filter(s => s.id !== id));
      router.push(sectionHref('memo', MAIN_SEC));
    }, inPage.length ? `이 페이지의 메모 ${inPage.length}개는 기본 페이지로 옮겨집니다.` : undefined);
  };

  /* ---------- 드래그 (배치 저장 — 모두에게 동일) ---------- */
  const onDown = (e: React.PointerEvent, m: StickyMemo) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const board = boardRef.current!;
    const br = board.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const movable = canTouch(m);
    if (movable) document.body.classList.add('drag-move');   // 드래그 중 커서 고정 (v1.9)
    let fx = m.x, fy = m.y;
    const mv = (ev: PointerEvent) => {
      if (!movable) return;
      const px = Math.max(0, Math.min(br.width - r.width, ev.clientX - br.left - ox));
      const py = Math.max(0, Math.min(br.height - r.height, ev.clientY - br.top - oy));
      fx = (px / br.width) * 100;
      fy = (py / br.height) * 100;
      el.style.left = `${fx}%`;
      el.style.top = `${fy}%`;
    };
    const up = () => {
      document.body.classList.remove('drag-move');
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      // 이동 커밋 + 맨 위로 (클릭만 해도 맨 위로 — 4.6 겹침 순서)
      setMemos(memos.map(x => x.id === m.id ? { ...x, x: fx, y: fy, z: maxZ() + 1 } : x));
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };

  /* ---------- 우클릭 컨텍스트 메뉴 (자체 스타일 — 4.6 v1.8) ---------- */
  // list: 우측 리스트에서 열림 — 순서 항목 없이 수정/삭제만
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number; list?: boolean } | null>(null);
  const onCtx = (e: React.MouseEvent, m: StickyMemo, list = false) => {
    e.preventDefault();
    if (!canTouch(m) && !user) return;   // 손님은 메뉴 없음 — 코멘트도 로그인해야 남긴다
    setCtx({ id: m.id, x: e.clientX, y: e.clientY, list });
  };
  const zOrder = (mode: 'up' | 'down' | 'top' | 'bottom') => {
    if (!ctx) return;
    const cur = memos.find(m => m.id === ctx.id);
    if (!cur) return;
    const zs = memos.map(m => m.z);
    let next = memos;
    if (mode === 'top') next = memos.map(m => m.id === cur.id ? { ...m, z: Math.max(...zs) + 1 } : m);
    if (mode === 'bottom') next = memos.map(m => m.id === cur.id ? { ...m, z: Math.min(...zs) - 1 } : m);
    if (mode === 'up') {
      const hi = zs.filter(z => z > cur.z);
      if (hi.length) {
        const nz = Math.min(...hi);
        next = memos.map(m => m.z === nz ? { ...m, z: cur.z } : m.id === cur.id ? { ...m, z: nz } : m);
      }
    }
    if (mode === 'down') {
      const lo = zs.filter(z => z < cur.z);
      if (lo.length) {
        const nz = Math.max(...lo);
        next = memos.map(m => m.z === nz ? { ...m, z: cur.z } : m.id === cur.id ? { ...m, z: nz } : m);
      }
    }
    setMemos(next);
    setCtx(null);
  };

  /* ---------- 등록/수정 모달 ---------- */
  const [mOpen, setMOpen] = useState(false);
  const [mId, setMId] = useState<string | null>(null); // null = 새 메모
  const [mText, setMText] = useState('');
  const [mColor, setMColor] = useState(MEMO_COLORS[0]);
  const [mSize, setMSize] = useState<StickyMemo['size']>('m');
  /* 누구로 남길지 (커플홈 캐입) — 관리자는 자캐로, 상대 오너는 권한 받은 캐릭터로.
     권한(이동·수정·삭제)은 그대로 쓴 회원 기준. 마지막으로 고른 것을 기억한다 */
  const charChoices = user ? inCharChoices(chars, { isAdmin, id: user.id }) : [];
  // AU 캐릭터로도 남긴다 (커플홈 사용자 요청) — 원래 모습 + 자관 AU마다 하나씩. 고른 값은 `charId` 또는 `charId|relId:auId`
  const asOptions = charAuOptions(charChoices, rels);
  const optKey = (o: { charId: string; auKey?: string }) => (o.auKey ? `${o.charId}|${o.auKey}` : o.charId);
  const [mAs, setMAs] = useState('me');
  const mPick = asOptions.find(o => optKey(o) === mAs);   // 고른 캐릭터가 사라졌으면 본인으로
  // 누구로 쓸지는 새 메모이거나 내가 쓴 메모일 때만 고른다 — 관리자가 남의 메모를 고칠 때 바꾸면 안 된다
  const editingOthers = !!mId && memos.find(m => m.id === mId)?.authorId !== user?.id;
  const openNew = () => {
    setMId(null); setMText('');
    setMColor(MEMO_COLORS[memos.length % MEMO_COLORS.length]); setMSize('m');
    setMOpen(true);
  };
  const openEdit = (m: StickyMemo) => {
    setMId(m.id); setMText(m.text); setMColor(m.color); setMSize(m.size);
    if (m.authorId === user?.id) setMAs(m.charId ? (m.auKey ? `${m.charId}|${m.auKey}` : m.charId) : 'me');
    setMOpen(true); setCtx(null);
  };
  const save = () => {
    if (!mText.trim()) { toast('내용을 입력해 주세요'); return; }
    const who = mPick
      ? { author: mPick.char.name, charId: mPick.charId, auKey: mPick.auKey }
      : { author: user?.nickname ?? '관리자', charId: undefined, auKey: undefined };
    if (mId) {
      setMemos(memos.map(m => m.id === mId
        ? { ...m, text: mText.trim(), color: mColor, size: mSize, ...(editingOthers ? {} : who) } : m));
    } else {
      const m: StickyMemo = {
        id: newId(), text: mText.trim(),
        ...who, authorId: user?.id ?? 'admin',
        color: mColor, size: mSize,
        x: 6 + Math.random() * 55, y: 6 + Math.random() * 55,
        rot: Math.round((Math.random() * 6 - 3) * 10) / 10, // 랜덤 기울기 (4.6)
        z: maxZ() + 1, date: new Date().toISOString(),
      };
      setMemos([...memos, m]);
      // 상대방에게 알림 (커플홈 사용자 요청) — 새 메모만, 고치거나 옮긴 것은 아니다
      notifyMembers({
        type: 'memo', href: sectionHref('memo', sec.id),
        title: `${m.author}의 새 메모`, body: m.text.slice(0, 60),
      }, members);
    }
    setMOpen(false);
  };
  const remove = (m: StickyMemo) => {
    setCtx(null);
    del.ask('메모를 삭제하시겠습니까?', () => {
      setMemos(memos.filter(x => x.id !== m.id));
      // 달린 코멘트도 — 남의 코멘트는 관리자만 지울 수 있어, 관리자가 아니면 내 것만 정리한다
      const drop = (c: CommentRow) => c.target === 'memo' && c.targetId === m.id && (isAdmin || c.authorId === user?.id);
      if (cmtRows.some(drop)) setCmtRows(cmtRows.filter(c => !drop(c)));
    });
  };

  const focus = (id: string) => {
    setMemos(memos.map(m => m.id === id ? { ...m, z: maxZ() + 1 } : m));
    setFocusId(id);
    setTimeout(() => setFocusId(f => (f === id ? null : f)), 900);
  };

  if (!loaded) return <section className="page" />;

  const sorted = [...memos].sort((a, b) => b.date.localeCompare(a.date));
  // 캐입 메모의 캐릭터 이름은 「작성자 표시」를 꺼도 보인다 — 캐릭터로 남긴 것 자체가 내용이다
  const showWho = (m: StickyMemo) => settings.showAuthor || !!m.charId;

  return (
    <section className="page" onClick={() => { setCtx(null); setPageCtx(null); }}>
      <div className="page-head">
        {/* 큰 글씨는 페이지를 나눠도 늘 STICKY NOTES(또는 메뉴 관리에서 메모장에 정한 타이틀) (사용자 확정) — 페이지 이름은 아래 탭에 있다 */}
        <PageTitle lookupHref="/memo">STICKY NOTES</PageTitle>
        <EditableDesc k="memo-desc" def="드래그 자유 배치 · 색상/기울기 · 작성 권한 옵션" />
      </div>

      {/* 페이지(종류) 탭 (커플홈) — 페이지가 둘 이상이거나 관리자일 때. 관리자는 우클릭으로 이름 바꾸기·삭제 */}
      {(pages.length > 1 || isAdmin) && (
        <div className="seg memo-pages">
          {pages.map(s => (
            <button key={s.id} className={s.id === sec.id ? 'on' : ''}
              onClick={() => { if (s.id !== sec.id) router.push(sectionHref('memo', s.id)); }}
              onContextMenu={e => {
                if (!isAdmin) return;
                e.preventDefault(); e.stopPropagation();
                setCtx(null);
                setPageCtx({ id: s.id, x: e.clientX, y: e.clientY });
              }}>
              {s.name}
            </button>
          ))}
          {isAdmin && <button className="add" data-tip="페이지 추가 — 우클릭으로 이름 바꾸기·삭제" onClick={addPage}>＋</button>}
        </div>
      )}

      <div className="memo-layout">
        {/* 보드 — 배치·순서 저장, 모두에게 동일 (4.6) */}
        <div className="memoboard" ref={boardRef}
          onContextMenu={e => { if (!(e.target as Element).closest('.postit')) setCtx(null); }}>
          {memos.map(m => (
            <div key={m.id}
              className={`postit ${focusId === m.id ? 'hl' : ''} ${canTouch(m) ? '' : 'ro'}`}
              style={{
                left: `${m.x}%`, top: `${m.y}%`, zIndex: m.z,
                transform: `rotate(${m.rot}deg)`, background: m.color, width: MEMO_SIZE_W[m.size],
              }}
              onPointerDown={e => onDown(e, m)}
              onContextMenu={e => onCtx(e, m)}>
              {showWho(m) && <MemoWho m={m} chars={chars} rels={rels} />}
              {m.text}
              {/* 코멘트 점 (커플홈) — 자관 문답의 부연처럼 모서리에. 색은 마지막 코멘트의 캐릭터 색, 없으면 포인트색.
                  올리면 툴팁(공용 tip-pop, 줄바꿈 유지), 누르면 코멘트 창 */}
              {(() => {
                const cs = cmtsOf(m);
                if (!cs.length) return null;
                const last = cs[cs.length - 1];
                const col = (last.charId && chars.find(x => x.id === last.charId)?.color) || undefined;
                const tip = cs.slice(-5).map(c => `${cmtName(c)}: ${c.text}`).join('\n')
                  + (cs.length > 5 ? `\n… 외 ${cs.length - 5}개` : '');
                return (
                  <span className="cm-dot" data-tip={tip} style={col ? { background: col } : undefined}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); setCmtFor(m); }} />
                );
              })()}
            </div>
          ))}
        </div>
        {/* 우측 메모 리스트 (v1.8) — 클릭 시 보드의 메모가 맨 위로 + 하이라이트 */}
        <div className="panel" style={{ padding: 12 }}>
          <h4 style={{ fontSize: 11, letterSpacing: '.14em', color: 'var(--faint)', padding: '4px 6px 10px' }}>MEMO LIST</h4>
          {sorted.map(m => (
            <div key={m.id} className="memo-list-item" onClick={() => focus(m.id)}
              onContextMenu={e => onCtx(e, m, true)}>
              <span className="cdot" style={{ background: m.color }} />
              <div style={{ minWidth: 0 }}>
                <b>{memoName(m)} · {fmtMD(m.date)}</b>
                <p>{m.text}</p>
              </div>
            </div>
          ))}
          {canWrite && (
            <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={openNew}>＋ MEMO</button>
          )}
        </div>
      </div>

      {/* 우클릭 순서 메뉴 — 위로/아래로/맨위로/맨아래로 + 수정/삭제 (권한자) */}
      {ctx && (
        <div className="ctx-menu on" style={{ left: ctx.x, top: ctx.y }} onClick={e => e.stopPropagation()}>
          {/* 순서 항목은 보드에서 열었을 때만 — 리스트에서는 수정/삭제만 */}
          {(() => { const m = memos.find(x => x.id === ctx.id); return m && user ? (
            <button onClick={() => { setCtx(null); setCmtFor(m); }}>코멘트 남기기{cmtsOf(m).length ? ` (${cmtsOf(m).length})` : ''}</button>
          ) : null; })()}
          {(() => { const m = memos.find(x => x.id === ctx.id); return m && canTouch(m) && user ? <div className="sep" /> : null; })()}
          {!ctx.list && (() => { const m = memos.find(x => x.id === ctx.id); return !!m && canTouch(m); })() && (
            <>
              <button onClick={() => zOrder('up')}>위로</button>
              <button onClick={() => zOrder('down')}>아래로</button>
              <div className="sep" />
              <button onClick={() => zOrder('top')}>맨위로</button>
              <button onClick={() => zOrder('bottom')}>맨아래로</button>
              <div className="sep" />
            </>
          )}
          {(() => { const m = memos.find(x => x.id === ctx.id); return !!m && canTouch(m); })() && (
            <>
              <button onClick={() => { const m = memos.find(x => x.id === ctx.id); if (m) openEdit(m); }}>수정</button>
              <button onClick={() => { const m = memos.find(x => x.id === ctx.id); if (m) remove(m); }}>삭제</button>
            </>
          )}
        </div>
      )}

      {/* 코멘트 창 (커플홈) — 메모 내용 + 코멘트 목록·입력 (캐입 가능) */}
      {cmtFor && (
        <Modal open onClose={() => setCmtFor(null)} small title="메모 코멘트"
          actions={<button className="btn btn-ghost" onClick={() => setCmtFor(null)}>CLOSE</button>}>
          <div className="postit static" style={{ background: cmtFor.color }}>
            {showWho(cmtFor) && <MemoWho m={cmtFor} chars={chars} rels={rels} />}
            {cmtFor.text}
          </div>
          <CharComments target="memo" targetId={cmtFor.id} rows={cmtRows} setRows={setCmtRows} chars={chars}
            notify={{
              title: '메모에 새 코멘트', href: sectionHref('memo', cmtFor.secId ?? MAIN_SEC),
              toIds: cmtFor.authorId ? [cmtFor.authorId] : [], admins: true,
            }} />
        </Modal>
      )}

      {/* 페이지 탭 우클릭 메뉴 (관리자) — 기본 페이지는 지울 수 없다 */}
      {pageCtx && (
        <div className="ctx-menu on" style={{ left: pageCtx.x, top: pageCtx.y }} onClick={e => e.stopPropagation()}>
          <button onClick={() => {
            setRename({ id: pageCtx.id, name: secList('memo').find(s => s.id === pageCtx.id)?.name ?? '' });
            setPageCtx(null);
          }}>이름 바꾸기</button>
          {pageCtx.id !== MAIN_SEC && (
            <button className="danger" onClick={() => removePage(pageCtx.id)}>페이지 삭제</button>
          )}
        </div>
      )}

      {/* 페이지 이름 바꾸기 */}
      <Modal open={rename !== null} onClose={() => setRename(null)} small title="페이지 이름"
        actions={<>
          <button className="btn btn-ghost" onClick={() => setRename(null)}>CANCEL</button>
          <button className="btn btn-dark" onClick={saveRename}>SAVE</button>
        </>}>
        <KInput value={rename?.name ?? ''} onChange={e => setRename(r => (r ? { ...r, name: e.target.value } : r))}
          onKeyDown={e => { if (e.key === 'Enter') saveRename(); }} />
      </Modal>

      {/* 메모 등록/수정 모달 — 누구로 + 내용 + 색 + 크기 */}
      <Modal open={mOpen} onClose={() => setMOpen(false)} small title={mId ? '메모 수정' : '메모 붙이기'} dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setMOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={save}>{mId ? 'SAVE' : 'ADD'}</button>
        </>}>
        <div style={{ display: 'grid', gap: 12 }}>
          {/* 누구로 남길지 (커플홈 캐입) — 캐릭터가 있고, 새 메모이거나 내 메모일 때만 */}
          {user && charChoices.length > 0 && !editingOthers && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="cp-lb">남기는 사람</span>
              <KSelect minWidth={140} maxWidth={220} value={mPick ? optKey(mPick) : 'me'} onChange={setMAs}
                options={[
                  { value: 'me', label: `나 (${user.nickname})` },
                  // 원래 모습 + 자관 AU마다 (커플홈) — AU 항목은 「AU 이름 · AU」, 색은 그 AU의 색
                  ...asOptions.map(o => ({
                    value: optKey(o),
                    label: <span className="dot-lbl"><i className="cmt-dot" style={{ background: o.char.color }} />{o.label}</span>,
                  })),
                ]} />
            </div>
          )}
          <KTextarea style={{ minHeight: 90 }} value={mText} onChange={e => setMText(e.target.value)} />
          <div className="memo-chips">
            {MEMO_COLORS.map(c => (
              <span key={c} className={`c ${mColor === c ? 'on' : ''}`} style={{ background: c }}
                onClick={() => setMColor(c)} />
            ))}
            <ColorField value={mColor} onChange={setMColor} />
          </div>
          <div className="mini-seg" style={{ justifySelf: 'start' }}>
            <button className={mSize === 's' ? 'on' : ''} onClick={() => setMSize('s')}>작게</button>
            <button className={mSize === 'm' ? 'on' : ''} onClick={() => setMSize('m')}>보통</button>
            <button className={mSize === 'l' ? 'on' : ''} onClick={() => setMSize('l')}>크게</button>
          </div>
        </div>
      </Modal>
      {del.element}
    </section>
  );
}

/** ?s= 를 읽으므로 Suspense 경계가 필요하다 (Next App Router) */
export default function MemoPage() {
  return <Suspense fallback={<section className="page" />}><MemoInner /></Suspense>;
}
