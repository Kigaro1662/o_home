'use client';
// 역극 (4.9) — 실시간 채팅형. 방 개설(자관 기반/자유) · 참여자에게만 존재 노출 ·
// 캐릭터 선택 발화(테마색 말풍선) · 지문(/desc) · 메시지 수정/삭제 · 완결/공개 전환 · 로그(txt/html 저장 · RP LOG 올리기)
// ※ 실시간 송수신·입력 중 표시·참여자 전원 동의는 Supabase Realtime 연동 시 활성화 (현재 localStorage)
import React, { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId, LIST_QUIET_ERR_EVT } from '@/lib/postStore';
import {
  RpRoom, RpMessage, RP_SEED, hexRgb, rpLastDate, rpHasNew,
  RpMessageRow, RP_MSG_KEY, RP_MSG_SEED, messagesFor, rpMarkRead, rpMemberIds, RpTyping, RP_TYPING_KEY, RP_TYPING_SEED, TYPING_TTL, typingId } from '@/lib/rpStore';
import { Character, CHAR_SEED, Relation, REL_SEED, charGrant, charWithAu, pairSides , faceCropOf } from '@/lib/charStore';
import { phStyle } from '@/lib/color';
import { Modal, ConfirmModal, useConfirmDelete } from '@/components/ui/Modal';
import { KInput, KTextarea, KSelect, KCheck } from '@/components/ui/Kit';
import { CroppedBlobImg, type CropValue } from '@/components/ui/CropEditor';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { useToast } from '@/components/ui/Toast';
import { RpLogModal } from '@/components/rp/RpLogModal';
import { rpLogHtml, openLogWindow } from '@/lib/rpLog';
import { isMsgSoundOn, setMsgSoundOn, MSG_SOUND_EVT } from '@/lib/msgSound';
import { Lightbox } from '@/components/ui/Lightbox';
import { putBlob, BlobImg } from '@/lib/blobStore';

/** 캐릭터 얼굴 칩 (썸네일 or 데모 플레이스홀더) */
/** 알림음 종 픽토그램 (커플홈 사용자 요청 — 이모지 대신). 선은 currentColor: 켜짐은 테마색, 꺼짐은 회색에 빗금 */
function BellIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2.1H4.4z" />
      <path d="M10 20.2a2 2 0 0 0 4 0" />
      {off && <line x1="4" y1="4" x2="20" y2="20" />}
    </svg>
  );
}

function Face({ ch, className, crop }: { ch?: Character; className: string; crop?: CropValue }) {
  // 사진이 없으면 캐릭터 테마색 자리표시자 (커플홈 사용자 요청)
  return (
    <div className={`${className} ${!ch?.thumbId ? `ph ${ch?.thumbClass ?? ''}` : ''}`} style={!ch?.thumbId ? phStyle([ch?.color]) : undefined}>
      {ch?.thumbId && <CroppedBlobImg fileRef={ch.thumbId} crop={crop ?? ch.thumbCrop} />}
    </div>
  );
}

const fmtHM = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

import { useMembers } from '@/lib/members';
import { pushNotif } from '@/lib/notifStore';

export default function RpPage() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const del = useConfirmDelete();
  const [rooms, setRooms, loaded] = useLocalList<RpRoom>('ohome.rp.v1', RP_SEED);
  // 발화는 방과 따로 저장한다 (v2.0) — 방 안에 두면 말할 때마다 방을 UPDATE 해야 해서
  // 남이 만든 방에서는 참여자가 발화할 수 없었다 (댓글·문답과 같은 뿌리)
  const [msgRows, setMsgRows] = useLocalList<RpMessageRow>(RP_MSG_KEY, RP_MSG_SEED);
  // 방 하나의 발화 — 옛 방 안의 것 + 분리 저장분
  const msgsOf = (r: RpRoom) => messagesFor(msgRows, r.id, r.messages);
  // 참여 회원 — 기반 자관이 있으면 그 자관 캐릭터의 권한자에서 자동으로 (v2.0 사용자 확정).
  // 계산해서 쓰므로 권한이 다른 사람에게 넘어가면 그 자관 기반 역극 전체에 바로 반영된다
  const memberIdsOf = (r: RpRoom) => rpMemberIds(r, rels, chars);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [selId, setSelId] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<'all' | 'ongoing' | 'done'>('ongoing'); // 우측 상태 필터 — 진행중이 기본
  // 모바일 (v1.9 사용자 확정) — 방 목록은 위에 접힌 바로, 입력창 포커스 중엔 역극 영역만 표시
  const [mListOpen, setMListOpen] = useState(false);
  const [mFocus, setMFocus] = useState(false);

  // 참여자에게만 존재 노출 (확정 — 관리자도 비참여 방은 보지 않음)
  const allMine = useMemo(() => (user
    ? rooms.filter(r => memberIdsOf(r).includes(user.id))
      .sort((a, b) => rpLastDate(b, messagesFor(msgRows, b.id, b.messages))
        .localeCompare(rpLastDate(a, messagesFor(msgRows, a.id, a.messages))))
    : []), [rooms, user, msgRows, rels, chars]);
  const myRooms = useMemo(() => allMine.filter(r => fStatus === 'all' || r.status === fStatus), [allMine, fStatus]);
  const sel = myRooms.find(r => r.id === selId) ?? myRooms[0];
  const cntS = (s: 'all' | 'ongoing' | 'done') =>
    allMine.filter(r => s === 'all' || r.status === s).length;

  // 발화자 선택 — 관리자는 기반 자관 멤버 전부(+자유 개설이면 자캐 전부),
  // 회원은 권한(grants — 역극 플레이/편집)이 부여된 캐릭터만 (3차 회원-캐릭터 연결, v1.9)
  const rel = rels.find(r => r.id === sel?.relId);
  /* 이 방이 어느 AU로 노는지 (v2.0 사용자 요청) — 방 안에서 쓰는 캐릭터를 통째로
     그 AU 프로필로 갈아 끼운다. 발화자 선택·말풍선·방 소제목이 모두 이 목록을 보므로
     한 곳만 바꾸면 전부 따라온다. AU가 없으면 원래 목록 그대로다(참조도 같다).

     **키는 `자관id:AU id`다** (v2.0 사용자 발견 — 「AU를 골랐는데 이름·사진이 원본으로 뜬다」).
     캐릭터의 AU 프로필은 자관마다 따로 갖는 값이라 자관 id가 앞에 붙는다. 처음에 AU id만
     넘겨서 프로필을 못 찾고 조용히 원본으로 떨어졌다 — 자관 상세가 쓰는 방식과 맞췄다. */
  const auCharKey = sel?.relId && sel?.auId && sel.auId !== 'base' ? `${sel.relId}:${sel.auId}` : null;
  const rpChars = useMemo(
    () => (auCharKey ? chars.map(c => charWithAu(c, auCharKey)) : chars),
    [chars, auCharKey],
  );
  /* 얼굴칸(1:1) 위치 — 자관에서 「썸네일 위치 조정」한 값을 여기서도 (커플홈 사용자 제보). 방의 AU면 그 AU 값부터 */
  const faceOf = (c?: Character) => faceCropOf(c, rels, { relId: sel?.relId, auKey: auCharKey ?? undefined });
  const speakChars = useMemo(() => {
    if (rel) {
      // 발화자 목록도 자관에 보이는 순서(왼쪽 먼저)로 — 처음 고른 발화자가 왼쪽 캐릭터가 된다
      const ids = pairSides(rel) ?? rel.members.map(m => m.charId);
      const members = ids.map(id => rpChars.find(c => c.id === id)).filter(Boolean) as Character[];
      // 관리자도 자캐만 (사용자 확정 — 상대 캐릭터까지 목록에 뜨는 게 싫다). 상대 오너는 권한 받은 캐릭터만
      return isAdmin ? members.filter(c => c.own) : members.filter(c => !!charGrant(c, user?.id));
    }
    return isAdmin ? rpChars.filter(c => c.own) : rpChars.filter(c => !!charGrant(c, user?.id));
  }, [rel, rpChars, isAdmin, user?.id]);

  const [speaker, setSpeaker] = useState<string>('');   // charId | 'desc' (플레이어 발화는 없앴다, v2.0)
  const [pickOpen, setPickOpen] = useState(false);
  useEffect(() => { setSpeaker(speakChars[0]?.id ?? 'desc'); setPickOpen(false); }, [sel?.id, speakChars]);

  // 입장 시 읽음 처리 (N 뱃지 해제) — 브라우저에만 기록한다 (v2.0).
  // 예전엔 방 문서의 lastRead에 써서, 방을 열어 보기만 해도 남의 방을 UPDATE 하게 되어
  // 참여자에게는 규칙이 막았다(뱃지가 안 없어짐). 읽음 시각은 원래 사람마다 다른 값이다.
  useEffect(() => {
    if (!sel || !user) return;
    rpMarkRead(sel.id, user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, user?.id, msgRows.length]);

  // 새 메시지 → 맨 아래로
  const msgsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sel?.id, msgRows.length]);

  /* 긴 방은 잘라서 보여 준다 (커플홈 사용자 요청 — 한 방이 너무 길어지면 렉). 글자 수 기준으로 최근 것부터
     WINDOW_CHARS만큼(적어도 WINDOW_MIN개), 맨 위로 올리거나 「이전 대화 더보기」를 누르면 그만큼 더 보여 준다.
     전체는 LOG → 전체보기(새 탭) */
  const WINDOW_CHARS = 6000, WINDOW_MIN = 30;
  const [moreChars, setMoreChars] = useState(0);
  useEffect(() => { setMoreChars(0); }, [sel?.id]);
  const allMsgs = sel ? msgsOf(sel) : [];
  let visStart = allMsgs.length;
  {
    const budget = WINDOW_CHARS + moreChars;
    let used = 0;
    while (visStart > 0) {
      used += (allMsgs[visStart - 1].text?.length ?? 0) + 24;
      if (used > budget && allMsgs.length - (visStart - 1) > WINDOW_MIN) break;
      visStart -= 1;
    }
  }
  const visibleMsgs = allMsgs.slice(visStart);
  const hiddenCount = visStart;
  const keepScroll = useRef<number | null>(null);   // 더보기 전 scrollHeight — 끼워 넣은 만큼 내려 읽던 자리를 지킨다
  const loadMore = () => {
    const el = msgsRef.current;
    if (el) keepScroll.current = el.scrollHeight;
    setMoreChars(x => x + WINDOW_CHARS);
  };
  useLayoutEffect(() => {
    const el = msgsRef.current;
    if (el && keepScroll.current != null) { el.scrollTop += el.scrollHeight - keepScroll.current; keepScroll.current = null; }
  }, [visStart]);
  const onMsgsScroll = () => {
    const el = msgsRef.current;
    if (el && hiddenCount > 0 && el.scrollTop < 30 && keepScroll.current == null) loadMore();
  };
  // 메신저 모양에서 오른쪽(파란 말풍선)에 둘 캐릭터 — 보는 사람 기준 (내 권한 캐릭터, 관리자는 자캐)
  const rightIds = user ? rpChars.filter(c => !!charGrant(c, user.id) || (!!c.own && isAdmin)).map(c => c.id) : [];
  /* SHOW ALL (커플홈 사용자 요청) — 참여자 누구나, 관리자가 아니어도·모바일(머리줄 숨김)에서도 대화 전부를 새 탭 한 장으로.
     방의 모양(대본/메신저) 그대로, 사진 없이 */
  const showAll = () => {
    if (!sel) return;
    const style = sel.style === 'imsg' ? 'imsg' : 'script';
    openLogWindow(sel.title, rpLogHtml({ title: sel.title, sub: roomLabel(sel) }, allMsgs, rpChars, { time: false, style, rightIds }));
  };

  const [text, setText] = useState('');
  /* 입력 중 표시 (커플홈 사용자 요청 — 상대가 치고 있으면 「캐릭터 is typing...」) — 사람마다 문서 하나.
     3초에 한 번만 at을 갱신하고(쓰기 절약), 보내거나 비우면 지운다. 저장이 거부되면(규칙 미갱신 등) 조용히 그만둔다 */
  const [typingRows, setTypingRows] = useLocalList<RpTyping>(RP_TYPING_KEY, RP_TYPING_SEED);
  const typingRowsRef = useRef(typingRows);
  typingRowsRef.current = typingRows;
  const lastPing = useRef<{ roomId: string; at: number } | null>(null);
  const typingOff = useRef(false);
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent<{ table: string }>).detail?.table === 'rp_typing') typingOff.current = true; };
    window.addEventListener(LIST_QUIET_ERR_EVT, h);
    return () => window.removeEventListener(LIST_QUIET_ERR_EVT, h);
  }, []);
  const pingTyping = (on: boolean) => {
    if (!sel || !user || typingOff.current) return;
    const id = typingId(sel.id, user.id);
    const rows = typingRowsRef.current;
    if (!on) {
      lastPing.current = null;
      if (rows.some(r => r.id === id)) setTypingRows(rows.filter(r => r.id !== id));
      return;
    }
    const now = Date.now();
    if (lastPing.current && lastPing.current.roomId === sel.id && now - lastPing.current.at < 3000) return;
    lastPing.current = { roomId: sel.id, at: now };
    const row: RpTyping = {
      id, roomId: sel.id, authorId: user.id,
      charId: speaker && speaker !== 'desc' ? speaker : undefined,
      at: new Date(now).toISOString(), visibility: 'member',
    };
    setTypingRows([...rows.filter(r => r.id !== id), row]);
  };
  // 상대의 입력 중 — at이 최근(TYPING_TTL) 안인 것만. 1초마다 다시 봐서 멈추면 저절로 사라진다
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const typersCount = useRef(0);
  useEffect(() => {
    const el = msgsRef.current;
    const n = typersCountNow();
    if (el && n !== typersCount.current) {
      typersCount.current = n;
      // 방금 늘어난 줄 높이(≈30px) + 여유 안이면 「맨 아래를 보고 있던」 것으로
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
    }
  });
  const typers = useMemo(() => {
    void tick;
    if (!sel || !user) return [] as string[];
    const now = Date.now();
    return typingRows
      .filter(r => r.roomId === sel.id && r.authorId !== user.id && now - Date.parse(r.at) < TYPING_TTL)
      .map(r => (r.charId && rpChars.find(c => c.id === r.charId)?.name) || '상대');
  }, [typingRows, sel, user, rpChars, tick]);
  const typersRef = useRef(typers);
  typersRef.current = typers;
  function typersCountNow() { return typersRef.current.length; }
  const [plainRp, setPlainRp] = useState(false);   // 메신저 방에서 「일반 RP」로 보내기 (커플홈 사용자 요청) — 원래 역극 모양
  const [pendingImg, setPendingImg] = useState<{ file: File; url: string } | null>(null);   // 보낼 사진 (메신저 방, 커플홈)
  const [lbImg, setLbImg] = useState<string | null>(null);   // 사진 크게 보기
  const send = async () => {
    if (!sel || !user) return;
    let t = text.trim();
    let kind: RpMessage['kind'] = speaker === 'desc' ? 'desc' : 'char';
    if (t.startsWith('/desc ')) { kind = 'desc'; t = t.slice(6).trim(); } // /desc 명령 (v1.8)
    // 사진만 보내는 문자도 된다 (커플홈 — 메신저 방의 사진 메시지). 지문에는 사진이 안 붙는다
    const img = imsg && kind === 'char' ? pendingImg : null;
    if (!t && !img) return;
    const imgId = img ? await putBlob(img.file) : undefined;
    const base = {
      kind, charId: kind === 'char' ? speaker : undefined,
      // 발화 당시 소유 기록 — 캐릭터가 삭제돼도 재연동 시 어느 리스트에서 고를지 판별 (v1.9)
      charOwn: kind === 'char' ? rpChars.find(c => c.id === speaker)?.own : undefined,
      authorId: user.id,
      ...(imsg && plainRp ? { rp: true } : {}),   // 메신저 방의 「일반 RP」 — 원래 역극 모양으로 (커플홈)
    };
    // 사진과 글을 같이 보내면 **따로 두 개**로 (사용자 확정 — 한 글에 사진+말풍선이 붙는 모양이 별로였다): 사진 먼저, 글 다음
    const now = Date.now();
    const out: RpMessage[] = [];
    if (imgId) out.push({ ...base, id: newId(), text: '', date: new Date(now).toISOString(), imgId });
    if (t) out.push({ ...base, id: newId(), text: t, date: new Date(now + (imgId ? 1 : 0)).toISOString() });
    // 방은 건드리지 않는다 — 발화만 자기 행으로 (v2.0)
    setMsgRows([...msgRows, ...out.map(m => ({ ...m, roomId: sel.id }))]);
    rpMarkRead(sel.id, user.id, out[out.length - 1].date);
    setText('');
    pingTyping(false);   // 보냈으니 입력 중 표시는 지운다
    if (img) { URL.revokeObjectURL(img.url); setPendingImg(null); }
    // 알림 (4.13) — 나를 제외한 참여자에게, 방 단위로 묶어서 (디스코드 DM은 봇 연동 시)
    memberIdsOf(sel).filter(id => id !== user.id).forEach(id =>
      pushNotif({
        type: 'rp', toUserId: id, href: '/rp', dedupeKey: `rp:${sel.id}`,
        title: `역극 「${sel.title}」 새 메시지`,
        body: t.slice(0, 60),
      }));
  };

  // 메시지 수정(본인) — 모달
  const [editMsg, setEditMsg] = useState<RpMessage | null>(null);
  const [editText, setEditText] = useState('');
  const saveMsg = () => {
    if (!sel || !editMsg) return;
    if (!editText.trim()) { toast('내용을 입력해 주세요'); return; }
    const t = editText.trim();
    if (msgRows.some(x => x.id === editMsg.id)) {
      setMsgRows(msgRows.map(x => (x.id === editMsg.id ? { ...x, text: t } : x)));
    } else {
      setRooms(rooms.map(r => r.id === sel.id
        ? { ...r, messages: r.messages.map(m => m.id === editMsg.id ? { ...m, text: t } : m) } : r));
    }
    setEditMsg(null);
  };
  const removeMsg = (m: RpMessage) => {
    if (!sel) return;
    del.ask('이 메시지를 삭제하시겠습니까?', () => {
      if (msgRows.some(x => x.id === m.id)) setMsgRows(msgRows.filter(x => x.id !== m.id));
      else setRooms(rooms.map(r => r.id === sel.id
        ? { ...r, messages: r.messages.filter(x => x.id !== m.id) } : r));
    });
  };

  // 방 개설 모달
  const [newOpen, setNewOpen] = useState(false);
  const [nTitle, setNTitle] = useState('');
  const [nStyle, setNStyle] = useState<'script' | 'imsg'>('script');   // 표시 방식 — 기본 / 메신저(아이폰 문자)
  const [renameText, setRenameText] = useState<string | null>(null);   // 역극명 바꾸기 창 (커플홈 사용자 요청) — null이면 닫힘
  const [nRel, setNRel] = useState('none');
  const [nAu, setNAu] = useState('base');   // 고른 자관의 AU (v2.0 사용자 요청)
  const [nMembers, setNMembers] = useState<string[]>([]);
  const pool = useMembers();
  // 개설 모달에서 보여 줄 자동 참여자 (개설자 제외) — 권한자를 이름으로 (v2.0)
  const newRelGrantNames = (() => {
    if (nRel === 'none') return [] as string[];
    const ids = rpMemberIds(
      { relId: nRel, createdBy: user?.id ?? '', memberIds: [] } as unknown as RpRoom, rels, chars);
    return ids.filter(id => id !== user?.id)
      .map(id => pool.find(pp => pp.id === id)?.nickname ?? id);
  })();
  // 고른 자관의 AU 목록 (기본 설정 줄은 위 셀렉트가 직접 넣는다)
  const newRelAus = (rels.find(r => r.id === nRel)?.aus ?? []).filter(a => a.id !== 'base');
  const createRoom = () => {
    if (!user) return;
    if (!nTitle.trim()) { toast('방 제목을 입력해 주세요'); return; }
    const members = Array.from(new Set([user.id, ...nMembers]));
    const room: RpRoom = {
      id: newId(), title: nTitle.trim(), relId: nRel === 'none' ? undefined : nRel,
      // 원래 설정(base)이면 남기지 않는다 — 예전 방과 같은 모습이라 되돌리기도 쉽다
      auId: nRel !== 'none' && nAu !== 'base' ? nAu : undefined,
      memberIds: members, status: 'ongoing', isPublic: false,
      createdBy: user.id, created: new Date().toISOString(), lastRead: {}, messages: [],
      ...(nStyle === 'imsg' ? { style: 'imsg' as const } : {}),   // 메신저 모양 (커플홈) — 기본이면 남기지 않는다
    };
    setRooms([room, ...rooms]);
    setSelId(room.id);
    setNewOpen(false);
    setNTitle(''); setNRel('none'); setNMembers([]); setNStyle('script');
  };

  const canManage = sel && user && (sel.createdBy === user.id || isAdmin);
  const imsg = sel?.style === 'imsg';   // 메신저(아이폰 문자) 모양 (커플홈 사용자 요청)
  const [endAsk, setEndAsk] = useState(false); // 완결 확인 — 삭제가 아니므로 전용 모달

  // 연결이 해제된(삭제된) 캐릭터 — 발화가 남아 있으면 다른 캐릭터로 재연동 (v1.9)
  // own은 화면 표시 규칙과 동일하게 !!charOwn 정규화 — 기록이 없으면 왼쪽(상대) 취급 (v1.9 버그 수정:
  // 왼쪽에 보이는 삭제 캐릭터의 RELINK 후보로 내 캐릭터 리스트가 뜨던 문제)
  const brokenChars = useMemo(() => {
    if (!sel) return [] as { charId: string; own: boolean }[];
    const map = new Map<string, boolean>();
    for (const m of msgsOf(sel)) {
      if (m.kind === 'char' && m.charId && !chars.some(c => c.id === m.charId) && !map.has(m.charId)) {
        map.set(m.charId, !!m.charOwn);
      }
    }
    return [...map.entries()].map(([charId, own]) => ({ charId, own }));
  }, [sel, chars]);
  const [relinkOpen, setRelinkOpen] = useState(false);
  const [relinkSel, setRelinkSel] = useState<Record<string, string>>({});
  // 대체 후보 — 반드시 같은 영역(own)의 캐릭터만 (v1.9 버그 수정, 사용자 발견)
  // 자관 멤버 목록에는 내 캐릭터도 함께 들어 있어서, 상대 영역 후보에 내 캐릭터가 떴고
  // 그걸 고르면 양쪽 대사가 한 캐릭터로 합쳐지던 문제 → 소유 구분으로 먼저 거른다.
  const relinkCands = (own: boolean): Character[] => {
    const sameSide = (c: Character) => !!c.own === own;
    const relList = rel
      ? (rel.members.map(mm => rpChars.find(c => c.id === mm.charId)).filter(Boolean) as Character[]).filter(sameSide)
      : [];
    return relList.length ? relList : chars.filter(sameSide);
  };
  // 이미 이 방에서 발화 중인 캐릭터 — 고르면 대사가 합쳐지므로 표시해 준다 (v1.9)
  const speakingIds = useMemo(() => new Set(
    (sel ? msgsOf(sel) : []).filter(m => m.kind === 'char' && m.charId).map(m => m.charId as string)), [sel, msgRows]);
  const applyRelink = () => {
    if (!sel) return;
    const picked = Object.entries(relinkSel).filter(([, v]) => v);
    if (picked.length === 0) { setRelinkOpen(false); return; }
    const relink = <M extends RpMessage>(m: M): M => {
      const nid = m.charId ? relinkSel[m.charId] : undefined;
      if (!nid) return m;
      return { ...m, charId: nid, charOwn: rpChars.find(c => c.id === nid)?.own };
    };
    setMsgRows(msgRows.map(x => (x.roomId === sel.id ? relink(x) : x)));
    setRooms(rooms.map(r => (r.id === sel.id ? { ...r, messages: r.messages.map(relink) } : r)));
    setRelinkOpen(false);
    setRelinkSel({});
    toast('캐릭터를 다시 연결했습니다');
  };
  const patchRoom = (p: Partial<RpRoom>) => {
    if (!sel) return;
    setRooms(rooms.map(r => r.id === sel.id ? { ...r, ...p } : r));
  };
  const removeRoom = () => {
    if (!sel) return;
    const count = msgsOf(sel).length;
    del.ask(`「${sel.title}」 방을 삭제하시겠습니까?`, () => {
      setRooms(rooms.filter(r => r.id !== sel.id));
      setMsgRows(msgRows.filter(x => x.roomId !== sel.id));   // 딸린 발화도 함께 (v2.0)
      setSelId(null);
    }, `대화 ${count}개도 함께 삭제됩니다.`);
  };

  // 로그 (커플홈) — txt/html 저장 · RP LOG에 올리기. 예전의 HTML 내보내기(EXPORT)를 대신한다
  const [logOpen, setLogOpen] = useState(false);
  // 알림음 켬/끔 (커플홈) — 브라우저마다. 처음 그릴 때는 서버와 같은 값(켬)으로 두고 마운트 뒤 읽는다
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    const f = () => setSoundOn(isMsgSoundOn());   // 종 메뉴(상단 바)에서 바꿔도 같이 바뀐다
    f();
    window.addEventListener(MSG_SOUND_EVT, f);
    return () => window.removeEventListener(MSG_SOUND_EVT, f);
  }, []);
  useEffect(() => { setLogOpen(false); }, [sel?.id]);

  if (!loaded) return <section className="page" />;

  if (!user) {
    return (
      <section className="page">
        {/* 비로그인 안내 — 관리자가 문구 수정 가능 (v1.9), 헤더 표시 옵션에도 항상 표시 */}
        <div className="page-head"><PageTitle>ROLEPLAY</PageTitle>
          <EditableDesc k="rp-gate-desc" def="역극은 로그인한 참여자에게만 표시됩니다" always /></div>
      </section>
    );
  }

  const relName = (id?: string) => rels.find(r => r.id === id)?.name;
  // 표시는 캐릭터 기준 (프로토타입 — "ALLOW 기반 · ALONE · WOOD") · 회원 계정은 접근 권한용일 뿐 노출 안 함
  const relCharNames = (relId?: string) => {
    const rel = rels.find(r => r.id === relId);
    if (!rel) return [];
    // 자관 페이지에 보이는 순서대로 — 왼쪽 캐릭터 먼저 (사용자 제보: 내 캐릭터가 먼저 떴다). pairSides가 좌우 바꾸기까지 반영한다
    const ids = pairSides(rel) ?? rel.members.map(m => m.charId);
    return ids
      .map(id => rpChars.find(c => c.id === id)?.name)
      .filter(Boolean) as string[];
  };
  /** 방 소제목 (v2.0 사용자 확정) — 페어면 캐릭터 이름 둘만, 다인관이면 자관명만.
   *  「~기반」 같은 군더더기와 회원 계정 표기는 넣지 않는다 */
  const roomLabel = (r: RpRoom) => {
    const rel = rels.find(x => x.id === r.relId);
    if (!rel) return '자유 개설';
    const names = relCharNames(r.relId);
    const isPair = rel.kind === 'pair' || rel.members.length === 2;
    const base = isPair && names.length ? names.join(' · ') : rel.name;
    // AU 방이면 AU 이름까지 (커플홈 사용자 요청 — 원본 방과 구분)
    const au = r.auId && r.auId !== 'base' ? rel.aus.find(a => a.id === r.auId) : undefined;
    return au ? `${base} · ${au.label || 'AU'}` : base;
  };
  const roomSub = (r: RpRoom) => [
    roomLabel(r),
    r.status === 'done' ? (r.isPublic ? '완결 · 공개 전환됨' : '완결') : '진행중',
  ].join(' · ');

  // 회원 계정(오너) 이름은 화면에 내지 않는다 — 계정은 접근 권한용일 뿐 (v2.0 사용자 요청).
  const speakerLabel = speaker === 'desc' ? '지문 (DESC)' : (rpChars.find(c => c.id === speaker)?.name ?? '');
  const speakerChar = rpChars.find(c => c.id === speaker);

  return (
    <section className={`page page-rp ${mFocus ? 'rp-focus' : ''}`}>
      <div className="page-head">
        <PageTitle>ROLEPLAY</PageTitle>
        <EditableDesc k="rp-desc" def="실시간 채팅형 · 참여자에게만 존재 노출 · 캐릭터 선택 발화" />
      </div>

      <div className={`rp-layout ${mListOpen ? 'mopen' : ''}`}>
        {/* 모바일 전용 접힘 바 — 탭하면 방 목록·상태 필터가 펼쳐짐 (v1.9) */}
        <button type="button" className="rp-mfold" onClick={() => setMListOpen(o => !o)}>
          {/* 모바일에선 채팅 머리(제목·캐릭터명·버튼들)를 숨기므로 여기에 캐릭터 이름까지 (사용자 확정) */}
          <b>{sel ? sel.title : '방 목록'}{sel && <span className="rl"> · {roomLabel(sel)}</span>}</b>
          <small>MY ROOMS {myRooms.length} {mListOpen ? '▴' : '▾'}</small>
        </button>
        {/* 방 목록 — 내 참여 방만 · 헤더 고정, 리스트만 내부 스크롤 */}
        <div className="panel rp-rooms">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 12px', flexShrink: 0 }}>
            <b style={{ fontSize: 12, letterSpacing: '.1em', color: 'var(--sub)' }}>MY ROOMS</b>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* 메시지 알림음 (커플홈) — 남의 새 발화가 오면 짧게 울린다. 브라우저마다 켜고 끈다 */}
              <button className={`btn btn-ghost rp-bell${soundOn ? '' : ' off'}`} data-tip={soundOn ? '알림음 끄기' : '알림음 켜기'}
                onClick={() => { setMsgSoundOn(!soundOn); setSoundOn(!soundOn); }}><BellIcon off={!soundOn} /></button>
              <button className="btn btn-dark" style={{ padding: '0 12px', height: 30, fontSize: 11 }}
                onClick={() => {
                  // 커플홈 — 기반 자관은 대표 자관(첫 번째)부터 골라 둔다. 자유 개설은 셀렉트에서
                  setNRel(rels[0]?.id ?? 'none'); setNAu('base');
                  setNewOpen(true);
                }}>＋ NEW ROOM</button>
            </div>
          </div>
          <div className="rp-rooms-list">
            {myRooms.map(r => (
              <div key={r.id} className={`rp-room ${sel?.id === r.id ? 'on' : ''}`}
                onClick={() => { setSelId(r.id); setMListOpen(false); }}>
                <b>{r.title} {rpHasNew(r, user.id, msgsOf(r)) && sel?.id !== r.id && <span className="new">N</span>}</b>
                <small>{roomSub(r)}</small>
              </div>
            ))}
            {myRooms.length === 0 && (
              <p className="hint" style={{ padding: '10px 6px 0' }}>
                {fStatus === 'all' ? '참여 중인 방이 없습니다' : '이 상태의 방이 없습니다'}
              </p>
            )}
          </div>
        </div>

        {/* 채팅 */}
        <div className="panel rp-chat">
          {sel ? (
            <>
              <div className="rp-head">
                <div>
                  <b>{sel.title}</b>
                  <small>{roomLabel(sel)}</small>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="pill">{sel.status === 'done' ? (sel.isPublic ? '완결 · 공개' : '완결') : '진행중'}</span>
                  {/* 표시 방식은 개설할 때 정한 그대로 (사용자 확정 — 되돌리는 버튼은 없다). 글마다 「RP」 토글로 원래 모양을 섞는다 */}
                  {/* 역극명 바꾸기 (커플홈 사용자 요청) */}
                  {canManage && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={() => setRenameText(sel.title)}>RENAME</button>
                  )}
                  {/* 삭제된 캐릭터가 남아 있으면 재연동 (v1.9) */}
                  {canManage && brokenChars.length > 0 && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5, color: 'var(--accent)' }}
                      onClick={() => setRelinkOpen(true)}>RELINK</button>
                  )}
                  {canManage && sel.status === 'ongoing' && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={() => setEndAsk(true)}>END</button>
                  )}
                  {canManage && sel.status === 'done' && (
                    <>
                      {/* 완결 취소 — 다시 진행중으로 (공개 상태였다면 비공개로 복귀) */}
                      <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                        onClick={() => patchRoom({ status: 'ongoing', isPublic: false })}>REOPEN</button>
                      {/* 공개 전환 — 참여자 전원 동의 흐름은 Supabase 연동 시 (현재는 개설자/관리자 전환) */}
                      <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                        onClick={() => patchRoom({ isPublic: !sel.isPublic })}>
                        {sel.isPublic ? 'UNPUBLISH' : 'PUBLISH'}
                      </button>
                    </>
                  )}
                  {/* 로그 — 참여자 누구나, 진행 중에도 (중간 백업용). 게시판 올리기는 모달 안에서 관리자만 */}
                  {msgsOf(sel).length > 0 && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={() => setLogOpen(true)}>LOG</button>
                  )}
                  {/* SHOW ALL — 참여자(관리자 아님)에게만, 관리자 버튼들이 뜨는 이 자리에 (커플홈 사용자 확정).
                      대화 전부를 새 탭 한 장으로. 관리자는 LOG 창의 전체보기로 */}
                  {!isAdmin && msgsOf(sel).length > 0 && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={showAll}>SHOW ALL</button>
                  )}
                  {canManage && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={removeRoom}>DELETE</button>
                  )}
                </div>
              </div>

              <div className={`rp-msgs${imsg ? ' imsg' : ''}`} ref={msgsRef} onScroll={onMsgsScroll}>
                {/* 잘라 둔 이전 대화 더보기 (커플홈) — SHOW ALL은 머리줄의 관리 버튼 자리에 (사용자 확정) */}
                {hiddenCount > 0 && (
                  <div className="rp-topbtns">
                    <button className="btn btn-ghost rp-more" onClick={loadMore}>이전 대화 더보기 ({hiddenCount})</button>
                  </div>
                )}
                {visibleMsgs.map((m, mi, arr) => {
                  const mine = m.authorId === user.id;
                  const acts = mine && (
                    <span className="m-act">
                      <button onClick={() => { setEditMsg(m); setEditText(m.text); }}>EDIT</button>
                      <button onClick={() => removeMsg(m)}>DEL</button>
                    </span>
                  );
                  if (m.kind === 'desc') {
                    // 메신저 모양에서는 지문이 아이폰 문자의 가운데 안내 글씨처럼.
                    // 「2008.07.03」처럼 날짜로 시작하는 지문은 날짜 줄로 (사용자 요청 — 시각은 손으로 적는다)
                    if (imsg && !m.rp) {
                      const dm = m.text.trim().match(/^(\d{4}\s?[.\-/]\s?\d{1,2}\s?[.\-/]\s?\d{1,2}\.?)([\s\S]*)$/);
                      return (
                        <div key={m.id} className={`im-sys${dm ? ' im-date' : ''}`}>
                          {dm ? <><b>{dm[1]}</b>{dm[2]}</> : m.text}{acts}
                        </div>
                      );
                    }
                    return <div key={m.id} className="msg-desc">{m.text}{acts}</div>;
                  }
                  const ch = rpChars.find(c => c.id === m.charId);
                  const name = ch?.name ?? '';
                  // 영역은 「보는 사람」 기준 (v2.0 사용자 확정): 내가 권한을 가진 캐릭터가 오른쪽,
                  // 아닌 캐릭터가 왼쪽. 관리자에게는 자캐(own)가 자기 캐릭터다.
                  // 그래서 같은 방이라도 사람마다 좌우가 반대로 보인다(각자 자기 쪽이 오른쪽).
                  // 삭제된 캐릭터는 발화 당시 기록(charOwn)으로 판단.
                  const rightSide = ch
                    ? (!!charGrant(ch, user.id) || (!!ch.own && isAdmin))
                    : (!!m.charOwn && isAdmin);
                  // 메신저 방의 이름 — 말하는 캐릭터가 바뀔 때만 (사용자 확정): 같은 캐릭터가 이어 말하면 생략,
                  // 상대 글 바로 다음에 내가 일반 RP를 쓰는 식으로 바뀌면 적는다. 기본 방은 늘 적는다
                  const prevMsg = arr[mi - 1];
                  const nameNeeded = !imsg || !prevMsg || prevMsg.kind !== 'char' || prevMsg.charId !== m.charId;
                  // 얼굴은 같은 캐릭터가 이어 말한 묶음의 **맨 끝**에 하나만 (아이폰 문자처럼) — 문자·일반 RP가 섞여도 한 번
                  const nextMsg = arr[mi + 1];
                  const runEnd = !nextMsg || nextMsg.kind !== 'char' || nextMsg.charId !== m.charId;
                  if (imsg && !m.rp) {
                    /* 아이폰 문자(iMessage) 모양 (커플홈 사용자 요청) — 내 쪽은 파란 말풍선, 상대는 회색.
                       같은 캐릭터가 이어 말하면 묶어서 꼬리·얼굴은 묶음의 마지막에만, 30분 넘게 비면 가운데 시각 */
                    const GAP = 30 * 60 * 1000;
                    const prev = arr[mi - 1], next = arr[mi + 1];
                    const gap = !prev || Date.parse(m.date) - Date.parse(prev.date) > GAP;
                    // 「일반 RP」로 보낸 글은 묶음에 끼지 않는다
                    const first = gap || prev.kind !== 'char' || prev.charId !== m.charId || !!prev.rp;
                    const last = !next || next.kind !== 'char' || next.charId !== m.charId || !!next.rp || Date.parse(next.date) - Date.parse(m.date) > GAP;
                    return (
                      <React.Fragment key={m.id}>
                        {/* 시각 줄은 두지 않는다 (사용자 확정 — 만들어진 역극이라 실제 시간은 의미가 없다). 묶음만 가른다 */}
                        <div className={`im-msg ${rightSide ? 'me' : 'them'}${first ? ' first' : ''}${last ? ' last' : ''}`}
                          style={{ ['--cc' as string]: hexRgb(ch?.color) }}>
                          {!rightSide && <span className="im-face">{runEnd && <Face ch={ch} crop={faceOf(ch)} className="f" />}</span>}
                          <div className="im-col">
                            {!rightSide && nameNeeded && <div className="im-who">{name}</div>}
                            {/* 사진은 아이폰 문자처럼 말풍선 없이 둥근 사진만 (사용자 확정) — 글이 같이 있으면 그 아래 글 말풍선 */}
                            {m.imgId && (
                              <div className="im-pic" onClick={() => setLbImg(m.imgId!)}><BlobImg fileRef={m.imgId} ph="" label="" /></div>
                            )}
                            {/* 한두 글자짜리는 말풍선이 찌그러져 보여 최소 폭을 둔다 */}
                            {(m.text || !m.imgId) && (
                              <div className={`im-bub${m.text.trim().length <= 3 ? ' short' : ''}`}>{m.text}</div>
                            )}
                          </div>
                          {acts}
                        </div>
                      </React.Fragment>
                    );
                  }
                  return (
                    <div key={m.id} className={`msg ${rightSide ? 'me' : ''}`} style={{ ['--cc' as string]: hexRgb(ch?.color) }}>
                      {/* 메신저 방의 일반 RP: 내 글은 얼굴 없이(내 말풍선처럼 오른쪽 끝 맞춤), 상대 글은 묶음 끝에만 얼굴 —
                          이어지는 글은 빈자리만 두어 말풍선 출발선이 문자 말풍선과 같게 (사용자 확정) */}
                      {!imsg
                        ? <Face ch={ch} crop={faceOf(ch)} className="face" />
                        : !rightSide && (runEnd ? <Face ch={ch} crop={faceOf(ch)} className="face" /> : <span className="face spacer" />)}
                      <div>
                        {/* 메신저 방의 일반 RP 글은 말하는 캐릭터가 바뀔 때만 이름 (사용자 확정) */}
                        {nameNeeded && <div className="who">{name}</div>}
                        <div className="bub">
                          {m.imgId && <div className="rp-pic" onClick={() => setLbImg(m.imgId!)}><BlobImg fileRef={m.imgId} ph="" label="" /></div>}
                          {m.text}
                        </div>
                        {/* 메신저 방에서는 시각을 안 적는다 (사용자 확정) — 일반 RP 글도 마찬가지 */}
                        {!imsg && <div style={{ fontSize: 9, color: 'var(--faint)', marginTop: 3 }}>{fmtHM(m.date)}</div>}
                      </div>
                      {acts}
                    </div>
                  );
                })}
                {msgsOf(sel).length === 0 && (
                  <p className="hint" style={{ textAlign: 'center', marginTop: 30 }}>첫 메시지를 남겨보세요</p>
                )}
                {/* 상대가 입력 중 — 메시지 영역 **안** 맨 아래 (커플홈 사용자 제보: 입력창 위에 끼우면 메시지 영역
                    높이가 줄어 스크롤이 덜컹거렸다). 스크롤에 포함되므로 영역 높이는 그대로다 */}
                {sel.status === 'ongoing' && typers.length > 0 && (
                  <div className="rp-typing"><b>{typers.join(', ')}</b> is typing<span className="dots"><i>.</i><i>.</i><i>.</i></span></div>
                )}
              </div>

              {sel.status === 'ongoing' && (
                <div className={`rp-input${imsg ? ' imsg' : ''}`}>
                  {/* 발화자 선택 — 캐릭터 / 지문 (v2.0 사용자 확정: 역극에는 이 둘만 있으면 된다) */}
                  <div className="char-pick" onClick={() => setPickOpen(o => !o)}>
                    {speaker === 'desc'
                      ? <div className="f" style={{ display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--sub)' }}>❝</div>
                      : <Face ch={speakerChar} crop={faceOf(speakerChar)} className="f" />}
                    <small>{speakerLabel} ▾</small>
                    {pickOpen && (
                      <div className="rp-pick-pop" onClick={e => e.stopPropagation()}>
                        {speakChars.map(c => (
                          <button key={c.id} onClick={() => { setSpeaker(c.id); setPickOpen(false); }}>
                            <Face ch={c} crop={faceOf(c)} className="f" />{c.name}
                          </button>
                        ))}
                        <button onClick={() => { setSpeaker('desc'); setPickOpen(false); }}>
                          <span className="f" style={{ display: 'grid', placeItems: 'center', color: 'var(--sub)' }}>❝</span>
                          지문 (DESC)
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="im-field">
                    {imsg && pendingImg && (
                      <div className="im-pv">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={pendingImg.url} alt="" />
                        <button type="button" className="x" aria-label="사진 빼기"
                          onClick={() => { URL.revokeObjectURL(pendingImg.url); setPendingImg(null); }}>✕</button>
                      </div>
                    )}
                    <div className="im-line">
                      {/* 사진 보내기 (커플홈 — 메신저 방): 상대에게 사진을 보냈다는 컨셉. 지문에는 안 붙는다.
                          입력칸과 같은 줄에 두어 세로 가운데가 입력칸 가운데와 맞는다 (사용자 요청) */}
                      {imsg && speaker !== 'desc' && (
                        <>
                          <button type="button" className="im-attach" data-tip="사진 보내기" aria-label="사진 보내기"
                            onClick={() => document.getElementById('rpImg')?.click()}>＋</button>
                          <input id="rpImg" type="file" accept="image/*" style={{ display: 'none' }}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (f && f.type.startsWith('image/')) {
                                if (pendingImg) URL.revokeObjectURL(pendingImg.url);
                                setPendingImg({ file: f, url: URL.createObjectURL(f) });
                              }
                              e.target.value = '';
                            }} />
                        </>
                      )}
                      {/* 플레이스홀더 없음 (v1.8) · Enter 전송 / Shift+Enter 줄바꿈 · /desc 명령 지원
                          포커스 중엔 모바일에서 역극 영역만 표시 (v1.9 — blur는 SEND 클릭이 씹히지 않게 지연) */}
                      <KTextarea style={{ minHeight: 44 }} value={text} onChange={e => { setText(e.target.value); pingTyping(e.target.value.trim().length > 0); }}
                        onFocus={() => setMFocus(true)}
                        onBlur={() => setTimeout(() => setMFocus(false), 180)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                        /* Ctrl+V로 붙여 넣은 그림도 사진 메시지로 (사용자 요청) — 메신저 방, 지문이 아닐 때 */
                        onPaste={e => {
                          if (!imsg || speaker === 'desc') return;
                          const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
                          const f = item?.getAsFile();
                          if (!f) return;
                          e.preventDefault();
                          if (pendingImg) URL.revokeObjectURL(pendingImg.url);
                          setPendingImg({ file: f, url: URL.createObjectURL(f) });
                        }} />
                    </div>
                  </div>
                  {/* 메신저 방에서도 원래 역극 모양으로 보내기 (커플홈 사용자 요청) — 문자 말고 서술·대사를 섞을 때 */}
                  {imsg ? (
                    /* ↑ 버튼 위의 빈자리에 「RP」 토글 (사용자 확정) */
                    <div className="im-actions">
                      <button type="button" className={`im-plain${plainRp ? ' on' : ''}`}
                        data-tip={plainRp ? '원래 역극 모양으로 보냅니다 — 누르면 다시 문자 말풍선' : '누르면 말풍선 대신 원래 역극 모양으로 보냅니다'}
                        aria-pressed={plainRp} onClick={() => setPlainRp(v => !v)}
                        style={plainRp ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' } : undefined}>RP</button>
                      <button className="im-send" onClick={send} aria-label="SEND">↑</button>
                    </div>
                  ) : (
                    <button className="btn btn-dark" onClick={send}>SEND</button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
              <p className="hint">방을 개설하면 여기에 채팅이 표시됩니다</p>
            </div>
          )}
        </div>

        {/* 우측 상태 필터 — 진행중/완결 따로 보기 */}
        {/* align-self는 CSS로 — PC 그리드에선 start(위 정렬), 모바일 세로 배치에선 stretch(전폭).
            인라인 start가 남아 있으면 모바일에서 내용 폭만큼 쪼그라든다 (v2.0 사용자 제보) */}
        <div className="panel tagside" style={{ padding: 16 }}>
          <h4>상태</h4>
          {/* 진행중이 기본 — 진행중 / 전체 / 완결 순 (사용자 확정) */}
          <div className={`tag ${fStatus === 'ongoing' ? 'on' : ''}`} onClick={() => setFStatus('ongoing')}>
            진행중 <small>{cntS('ongoing')}</small>
          </div>
          <div className={`tag ${fStatus === 'all' ? 'on' : ''}`} onClick={() => setFStatus('all')}>
            전체 <small>{cntS('all')}</small>
          </div>
          <div className={`tag ${fStatus === 'done' ? 'on' : ''}`} onClick={() => setFStatus('done')}>
            완결 <small>{cntS('done')}</small>
          </div>
        </div>
      </div>

      {/* 방 개설 — 제목 + 기반 자관(선택) + 참여 회원 (4.9) */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} small title="역극 방 개설"
        desc="비참여자에게는 방의 존재가 보이지 않습니다" dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setNewOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={createRoom}>ADD</button>
        </>}>
        <div style={{ display: 'grid', gap: 11 }}>
          <div>
            <label className="k-label" style={{ marginBottom: 5 }}>Title</label>
            <KInput value={nTitle} onChange={e => setNTitle(e.target.value)} />
          </div>
          {/* 기반 자관 + 그 자관의 AU (v2.0 사용자 요청) — AU를 고르면 방 안의 캐릭터가
              그 AU 프로필(이름·색·이미지)로 보인다. AU가 없는 자관에는 옆 칸이 뜨지 않는다 */}
          <div>
            <label className="k-label" style={{ marginBottom: 5 }}>기반 자관 (선택)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <KSelect value={nRel} onChange={v => { setNRel(v); setNAu('base'); }}
                minWidth={160}
                options={[{ value: 'none', label: '자유 개설 (자관 없음)' }, ...rels.map(r => ({ value: r.id, label: r.name }))]} />
              {newRelAus.length > 0 && (
                <KSelect value={nAu} onChange={setNAu} minWidth={140}
                  options={[{ value: 'base', label: '원래 설정' },
                    ...newRelAus.map(a => ({ value: a.id, label: a.label || 'AU' }))]} />
              )}
            </div>
          </div>
          {/* 표시 방식 (커플홈 사용자 요청) — 대본형 / 아이폰 문자(iMessage) 모양. 방 안에서도 바꿀 수 있다 */}
          <div>
            <label className="k-label" style={{ marginBottom: 5 }}>표시 방식</label>
            <div className="mini-seg">
              <button className={nStyle === 'script' ? 'on' : ''} onClick={() => setNStyle('script')}>기본</button>
              <button className={nStyle === 'imsg' ? 'on' : ''} onClick={() => setNStyle('imsg')}>메신저 (아이폰 문자)</button>
            </div>
          </div>
          <div>
            <label className="k-label" style={{ marginBottom: 7 }}>참여 회원</label>
            {nRel === 'none' ? (
              /* 자유 개설일 때만 직접 고른다 */
              <div style={{ display: 'grid', gap: 8 }}>
                {pool.filter(p => p.id !== user.id).map(p => (
                  <KCheck key={p.id} label={p.nickname}
                    checked={nMembers.includes(p.id)}
                    onChange={v => setNMembers(ms => v ? [...ms, p.id] : ms.filter(x => x !== p.id))} />
                ))}
              </div>
            ) : (
              /* 자관 기반이면 그 자관 캐릭터의 권한자가 자동 참여 (v2.0 사용자 확정) —
                 나중에 권한이 다른 사람에게 넘어가도 이 방에 그대로 따라온다 */
              <p className="hint" style={{ margin: 0 }}>
                {newRelGrantNames.length
                  ? `이 자관 캐릭터에 권한이 있는 회원이 자동으로 참여합니다 — ${newRelGrantNames.join(' · ')}`
                  : '아직 이 자관 캐릭터에 권한을 준 회원이 없습니다 — 캐릭터 수정의 「회원 권한」에서 지정하면 이 방에도 자동으로 반영됩니다'}
              </p>
            )}
          </div>
        </div>
      </Modal>

      {/* 메시지 수정 (본인) */}
      {/* 사진 메시지 크게 보기 (커플홈) */}
      {lbImg && <Lightbox srcs={[lbImg]} index={0} onClose={() => setLbImg(null)} />}
      {/* 역극명 바꾸기 (커플홈 사용자 요청) — 개설자·관리자 */}
      <Modal open={renameText !== null} onClose={() => setRenameText(null)} small title="역극명 바꾸기"
        actions={<>
          <button className="btn btn-ghost" onClick={() => setRenameText(null)}>CANCEL</button>
          <button className="btn btn-dark" onClick={() => {
            const t = (renameText ?? '').trim();
            if (!t) { toast('역극명을 입력해 주세요'); return; }
            patchRoom({ title: t }); setRenameText(null); toast('역극명을 바꿨습니다');
          }}>SAVE</button>
        </>}>
        <KInput value={renameText ?? ''} onChange={e => setRenameText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { const t = (renameText ?? '').trim(); if (t) { patchRoom({ title: t }); setRenameText(null); } } }} />
      </Modal>
      <Modal open={editMsg !== null} onClose={() => setEditMsg(null)} small title="메시지 수정" dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setEditMsg(null)}>CANCEL</button>
          <button className="btn btn-dark" onClick={saveMsg}>SAVE</button>
        </>}>
        <KTextarea style={{ minHeight: 100 }} value={editText} onChange={e => setEditText(e.target.value)} />
      </Modal>
      {/* 캐릭터 다시 연결 — 삭제된 캐릭터의 발화를 다른 캐릭터로 (v1.9) */}
      <Modal open={relinkOpen} onClose={() => setRelinkOpen(false)} small title="캐릭터 다시 연결"
        desc="연결이 해제된 캐릭터의 발화를 다른 캐릭터로 옮깁니다 — 같은 영역(왼쪽/오른쪽)의 캐릭터만 선택할 수 있습니다" dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setRelinkOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={applyRelink}>APPLY</button>
        </>}>
        <div style={{ display: 'grid', gap: 12 }}>
          {brokenChars.map(b => (
            <div key={b.charId}>
              <label className="k-label" style={{ marginBottom: 5 }}>
                삭제된 캐릭터 — {b.own ? '내 캐릭터 영역 (내 캐릭터만 선택 가능)' : '상대 영역 (상대 캐릭터만 선택 가능)'}
              </label>
              <KSelect value={relinkSel[b.charId] ?? ''} onChange={v => setRelinkSel(s => ({ ...s, [b.charId]: v }))}
                options={[
                  { value: '', label: '선택 안 함' },
                  // 이미 발화 중인 캐릭터를 고르면 대사가 합쳐지므로 표시 (v1.9 사용자 피드백)
                  ...relinkCands(b.own).map(c => ({
                    value: c.id,
                    label: speakingIds.has(c.id) ? `${c.name} — 이미 발화 중 (대사가 합쳐집니다)` : c.name,
                  })),
                ]} />
            </div>
          ))}
        </div>
      </Modal>

      {/* 역극 로그 — 열 때만 그린다 (게시판 목록도 그때 불러온다) */}
      {logOpen && sel && (
        <RpLogModal room={sel} msgs={msgsOf(sel)} chars={rpChars} sub={roomLabel(sel)}
          isAdmin={isAdmin} onClose={() => setLogOpen(false)}
          rightIds={rightIds}
          faceInfo={Object.fromEntries(rpChars.map(c => [c.id, { ref: c.thumbId, crop: faceOf(c) }]))} />
      )}

      {/* 완결 확인 (삭제 아님 — END/CANCEL) */}
      <ConfirmModal open={endAsk} title="역극을 완결 처리하시겠습니까?"
        body="완결 후에는 공개 전환을 사용할 수 있습니다. 로그 저장은 진행 중에도 LOG에서 할 수 있습니다."
        onClose={() => setEndAsk(false)}
        buttons={[
          { label: 'END', kind: 'dark', onClick: () => { patchRoom({ status: 'done' }); setEndAsk(false); } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setEndAsk(false) },
        ]} />
      {del.element}
    </section>
  );
}
