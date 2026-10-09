'use client';
/**
 * 캐입 댓글 (커플홈) — 다이어리처럼 두 사람이 같이 쓰는 곳의 댓글. 감상타래 댓글과 같은 모양이다:
 * 한 단계 답글 · 손님은 닉네임으로 · 로그인했으면 「누구로 쓸지」(본인 / 캐릭터)를 고른다.
 * 권한(수정·삭제)은 쓴 회원 기준이고, 캐릭터로 쓴 댓글은 화면에 캐릭터만 보인다.
 *
 * 댓글 목록(rows)은 부모가 한 번만 불러 넘긴다 — 펼친 글마다 따로 부르면 같은 컬렉션을 여러 번 받는다.
 */
import React, { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Comment, CommentRow, commentsFor, newId, fmtDate, useLocalList } from '@/lib/postStore';
import { Character, inCharChoices, Relation, REL_SEED, faceCropOf } from '@/lib/charStore';
import { pushNotif, notifyAdmins } from '@/lib/notifStore';
import { KInput, KSelect } from '@/components/ui/Kit';
import { GuestIdBar } from '@/components/ui/GuestId';
import { CroppedBlobImg } from '@/components/ui/CropEditor';
import { useConfirmDelete } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

/** 댓글 이름 — 캐입이면 캐릭터 얼굴(없으면 테마색 원) + 이름, 캐릭터가 지워졌으면 쓸 당시 이름 */
function Who({ c, chars, rels }: { c: Comment; chars: Character[]; rels: Relation[] }) {
  const ch = c.charId ? chars.find(x => x.id === c.charId) : undefined;
  if (!ch) return <b>{c.author}</b>;
  return (
    <b className="cmt-char as-char">
      <span className="cf" style={{ background: ch.color, ['--cc' as string]: ch.color }}>
        {/* 얼굴칸 위치는 자관(·AU)에서 잡아 둔 값 (커플홈 사용자 제보) */}
        {ch.thumbId && <CroppedBlobImg fileRef={ch.thumbId} crop={faceCropOf(ch, rels, { auKey: c.auKey })} />}
      </span>
      {ch.name}
    </b>
  );
}

export function CharComments({ target, targetId, rows, setRows, chars, notify }: {
  target: CommentRow['target'];
  targetId: string;
  rows: CommentRow[];
  setRows: (next: CommentRow[]) => void;
  chars: Character[];
  /** 새 댓글 알림 — 제목·이동 주소·받을 회원(본인은 알아서 뺀다) · admins면 관리자에게도 */
  notify: { title: string; href: string; toIds: string[]; admins?: boolean };
}) {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const del = useConfirmDelete();
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);   // 얼굴칸 위치(자관 faceCrop)용 (커플홈)
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [gName, setGName] = useState('');
  const guestMode = !user;
  const choices = user ? inCharChoices(chars, { isAdmin, id: user.id }) : [];
  const [asId, setAsId] = useState('me');
  const speakAs = choices.find(c => c.id === asId);   // 고른 캐릭터가 사라졌으면 본인으로
  const comments = commentsFor(rows, target, targetId);
  const roots = comments.filter(c => !c.parentId);
  const childrenOf = (pid: string) => comments.filter(c => c.parentId === pid);

  const add = () => {
    if (!text.trim()) return;
    if (guestMode && !gName.trim()) { toast('닉네임을 입력해 주세요'); return; }
    const base = { id: newId(), text: text.trim(), date: new Date().toISOString(), parentId: replyTo ?? undefined, target, targetId };
    const c: CommentRow = user
      ? { ...base, authorId: user.id, author: speakAs?.name ?? user.nickname, ...(speakAs ? { charId: speakAs.id } : {}) }
      : { ...base, authorId: '', author: gName.trim() };
    setRows([...rows, c]);
    const me = user?.id ?? '';
    const body = `${c.author} — ${c.text.slice(0, 50)}`;
    const sent = new Set<string>([me]);
    for (const to of notify.toIds) {
      if (!to || sent.has(to)) continue;
      sent.add(to);
      pushNotif({ type: 'comment', toUserId: to, href: notify.href, title: notify.title, body });
    }
    if (notify.admins) notifyAdmins({ type: 'comment', href: notify.href, title: notify.title, body });
    // 답글이면 그 대화에 참여한 사람에게도 (게시판·타래와 같은 규칙)
    if (replyTo) {
      const rootAuthor = comments.find(x => x.id === replyTo)?.authorId;
      for (const t of comments.filter(x => x.id === replyTo || x.parentId === replyTo)) {
        const to = t.authorId;
        if (!to || sent.has(to)) continue;
        sent.add(to);
        pushNotif({
          type: 'comment', toUserId: to, href: notify.href,
          title: to === rootAuthor ? '내 댓글에 답글이 달렸습니다' : '참여한 댓글에 새 답글이 달렸습니다', body,
        });
      }
    }
    setText(''); setReplyTo(null);
  };
  // 삭제 — 답글도 함께. 손님 댓글은 관리자만 지운다 (게시판과 같은 규칙)
  const remove = (c: Comment) =>
    del.ask('이 댓글을 삭제하시겠습니까?', () => setRows(rows.filter(x => !(x.id === c.id || x.parentId === c.id))));

  return (
    <div className="char-cmts">
      <h4>COMMENTS {comments.length > 0 && <span>{comments.length}</span>}</h4>
      {roots.map(c => (
        <React.Fragment key={c.id}>
          {[c, ...childrenOf(c.id)].map((x, i) => (
            <div key={x.id} className={`cmt ${i > 0 ? 'reply-depth' : ''}`}>
              <Who rels={rels} c={x} chars={chars} /><small>{fmtDate(x.date)}</small>
              {i === 0 && (
                <small style={{ cursor: 'var(--cur-pointer,pointer)', color: 'var(--accent)', marginLeft: 8 }}
                  onClick={() => setReplyTo(replyTo === x.id ? null : x.id)}>
                  {replyTo === x.id ? '답글 취소' : '답글'}
                </small>
              )}
              {(isAdmin || (user && x.authorId === user.id)) && (
                <small style={{ cursor: 'var(--cur-pointer,pointer)', marginLeft: 8 }} onClick={() => remove(x)}>삭제</small>
              )}
              <p>{x.text}</p>
            </div>
          ))}
        </React.Fragment>
      ))}
      <div className={`cmt-input ${guestMode ? 'guest' : ''}`}>
        {guestMode && <GuestIdBar name={gName} onName={setGName} />}
        <div className="ci-row" style={guestMode ? undefined : { display: 'contents' }}>
          {user && choices.length > 0 && (
            <KSelect minWidth={110} maxWidth={150} value={speakAs ? speakAs.id : 'me'} onChange={setAsId}
              options={[
                { value: 'me', label: `나 (${user.nickname})` },
                ...choices.map(c => ({
                  value: c.id,
                  label: <span className="dot-lbl"><i className="cmt-dot" style={{ background: c.color }} />{c.name}</span>,
                })),
              ]} />
          )}
          <KInput placeholder={replyTo ? '답글 작성...' : '댓글 남기기...'} value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <button className="btn btn-dark" onClick={add}>POST</button>
        </div>
      </div>
      {del.element}
    </div>
  );
}
