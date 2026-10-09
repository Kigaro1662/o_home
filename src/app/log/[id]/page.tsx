'use client';
// RP LOG 상세 (옛 TRPG 로그, 4.3) — HTML이면 원본 스타일 그대로 격리 렌더(iframe 샌드박스, 스크립트 실행 안 됨),
// 일반 텍스트면 로그용 기본 서식으로 표시
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useHrefBlock } from '@/components/shell/MenuGuard';
import { sectionHref, MAIN_SEC, secStamp, useSectionTitle } from '@/lib/sectionStore';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId, useOneDoc } from '@/lib/postStore';
import { TrpgLog, TRPG_SEED, TrpgLogBody, bodyVisibility, showAsHtml, decodeLogText, logNo, saveLogBody, logPath } from '@/lib/galleryStore';
import { isValidSlug, slugify } from '@/lib/link';
import { Relation, REL_SEED, Character, CHAR_SEED, charGrant } from '@/lib/charStore';
import { applyLogSides, rpSpeakers, rpLogHtml, type RpLogSrc } from '@/lib/rpLog';
import type { RpMessage } from '@/lib/rpStore';
import { useMenuSettings } from '@/lib/menuStore';
import { useMembers } from '@/lib/members';
import { canEditTrpg, trpgEditorIds } from '@/lib/trpgPerm';
import { logViewChars, renderLogSrc } from '@/lib/rpLogSrc';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { TagInput } from '@/components/ui/TagInput';
import { getBlob, putBlob, useBlobUrl } from '@/lib/blobStore';
import { PageTitle, EditableDesc } from '@/components/ui/PageText';
import { KInput, KSelect, KDate, KTextarea, KCheck } from '@/components/ui/Kit';
import { ColorField } from '@/components/ui/ColorField';
import { CropEditor, CropImg, CropValue } from '@/components/ui/CropEditor';
import { useToast } from '@/components/ui/Toast';

/** 발화 수정 창에서 「지문(서술)」을 고르는 값 */
const DESC_KEY = '__desc';

/** 로그 렌더 프레임 — 대형 문서도 안정적으로 로드되도록 srcdoc 대신 Blob URL 사용 */
function LogFrame({ frameRef, html, title, onFrameLoad }: {
  frameRef: React.RefObject<HTMLIFrameElement | null>; html: string; title: string;
  onFrameLoad: () => void;
}) {
  // charset을 MIME에 명시 (v2.0) — 로그 파일의 <meta charset>은 주입 스크립트에 밀려 브라우저가
  // 인코딩을 찾아보는 앞부분 1024바이트 밖으로 나갈 수 있다. 그러면 브라우저에 따라 본문이 깨진다
  const url = useMemo(() => URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), [html]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <iframe
      ref={frameRef}
      className="log-frame"
      sandbox="allow-scripts"
      src={url}
      title={title}
      onLoad={onFrameLoad}
    />
  );
}

export default function TrpgDetailPage() {
  const { id: key } = useParams<{ id: string }>();   // id 또는 페이지 주소 별명 (커플홈 — 캐릭터·자관과 같게)
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [logs, setLogs, loaded] = useLocalList<TrpgLog>('ohome.trpg.v1', TRPG_SEED);
  // 본문은 목록과 분리 저장 (v2.0 — 나만보기 로그도 목록엔 뜨게 하려고 목록 문서의 질의 조건이
  // listHidden으로 느슨해졌는데, 본문까지 같이 있으면 그 질의로 본문도 함께 새어 나간다).
  // 이 목록에 없는 id는 "권한이 없어 애초에 안 받아졌다"는 뜻 — 서버가 알아서 걸러 준다
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [allChars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  // 수정 권한 (커플홈 사용자 요청 — "수정 권한은 멤버에게도"): 관리자 · 등록한 본인 · 등록 권한이 있는 회원(editorIds, trpgPerm.ts)
  const [menuSet] = useMenuSettings();
  const members = useMembers();
  // 태그 자동완성 후보 — 모든 로그의 태그, 많이 쓰인 순 (커플홈)
  const allTags = useMemo(() => {
    const m: Record<string, number> = {};
    logs.forEach(x => (x.tags ?? []).forEach(t => { m[t] = (m[t] ?? 0) + 1; }));
    return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [logs]);
  const [delAsk, setDelAsk] = useState(false);
  const [bodyText, setBodyText] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const gotHeightRef = useRef(false);   // 안쪽에서 높이 보고가 왔는지 (안 오면 기본 높이로 되돌린다)

  // 별명을 방금 바꾸면 주소(옛 별명)로는 잠깐 못 찾는다 — 직전에 찾았던 id를 기억해 두고 그걸로 이어 받는다
  // (안 그러면 아래 「없음 → 홈」 효과가 새 주소로 옮기기 전에 먼저 튕겨 낸다)
  const lastIdRef = useRef<string | null>(null);
  const found = logs.find(x => x.id === key || (x.slug ?? '') === key);
  const l = found ?? (lastIdRef.current ? logs.find(x => x.id === lastIdRef.current) : undefined);
  useEffect(() => { if (found) lastIdRef.current = found.id; }, [found]);
  const id = l?.id ?? key;   // 아래는 전부 진짜 id로 (본문 문서·저장·비밀번호 열람 기억)
  // 본문은 **이 로그 한 건만** 읽고 쓴다 (커플홈 사용자 제보 — 전체 본문을 받느라 느렸다). 권한이 없으면 애초에 안 온다 (undefined)
  const [bd, saveBody, removeBody] = useOneDoc<TrpgLogBody>('ohome.trpgbody.v1', l ? l.id : undefined);
  /* 이 글이 속한 곳이 비공개면 주소로 들어와도 열리지 않게 (v2.0 사용자 요청).
     글 주소에는 섹션이 없어 MenuGuard가 못 막는다 — 글을 읽어 소속을 알아낸 여기서 판정한다.
     **다른 early return보다 먼저 불러야 한다**(훅이므로 렌더마다 개수가 같아야 한다) */
  const blocked = useHrefBlock(l && sectionHref('trpg', l.secId ?? MAIN_SEC));
  // 큰 글씨 — 추가 섹션이면 그 이름, 눌렀을 때도 그 목록으로 (v2.0 사용자 제보)
  const tt = useSectionTitle('trpg', l?.secId, 'RP LOG');

  // 접근권한 (4.3) — 관리자 / 공개범위 충족 / 비밀번호 입력자 /
  // 연동 자관의 상대방(멤버 캐릭터에 권한이 부여된 회원)은 무조건 열람 (3차 회원-캐릭터 연결, v1.9)
  const logRel = rels.find(r => r.id === l?.relId);
  const isRelPartner = !!user && !!logRel && logRel.members.some(m => {
    const ch = allChars.find(c => c.id === m.charId);
    return ch ? !!charGrant(ch, user.id) : false;
  });
  const baseAllowed = !!l && (isAdmin || isRelPartner
    || l.visibility === 'public' || (l.visibility === 'member' && !!user)
    || (!!user && l.authorId === user.id));   // 내가 등록한 로그 (커플홈 — 회원도 등록한다)

  // 비밀번호 열람 (4.3) — 세션 동안 유지
  const [unlocked, setUnlocked] = useState(false);
  const [pwTry, setPwTry] = useState('');
  useEffect(() => {
    try { if (sessionStorage.getItem(`trpg-unlock:${id}`) === '1') setUnlocked(true); } catch { /* 무시 */ }
  }, [id]);

  // 이 로그를 볼 수 없으면(없거나, 권한도 비밀번호도 없으면) 홈으로 — 예전엔 이 자리에 "열람 권한이
  // 없습니다" 문구만 남아 있었는데, 로그아웃 등으로 권한을 잃은 직후엔 계속 그 화면에 머무를 이유가
  // 없다는 사용자 요청으로 홈으로 보낸다 (v2.0)
  const leavingRef = useRef(false);   // 삭제해서 떠나는 중 — 「없는 로그 → 홈」으로 튕기지 않고 목록으로 가게 (커플홈)
  useEffect(() => {
    if (!loaded) return;
    if (!l) { if (!leavingRef.current) router.replace('/'); return; }
    if (!baseAllowed && !unlocked && !l.password) router.replace('/');
  }, [loaded, l, baseAllowed, unlocked, router]);
  const tryUnlock = () => {
    if (l?.password && pwTry === l.password) {
      setUnlocked(true);
      try { sessionStorage.setItem(`trpg-unlock:${id}`, '1'); } catch { /* 무시 */ }
    } else {
      toast('비밀번호가 올바르지 않습니다');
    }
  };

  // 로그 정보 수정 — 메타 + 본문 교체(파일/직접 입력) + 썸네일 교체(이미지 크롭/단색·그라데이션)
  const [eOpen, setEOpen] = useState(false);
  const [e, setE] = useState({
    noText: '', slug: '', tags: [] as string[], title: '', catchphrase: '', writer: '', withText: '',
    relId: 'none', auId: 'base', date: '', visibility: 'public' as TrpgLog['visibility'], password: '',
    listHidden: false,   // 목록 표시 여부 (v2.0 — 접근권한과 별개)
  });
  // 본문 교체
  const [bodyMode, setBodyMode] = useState<'keep' | 'file' | 'text'>('keep');
  // 본문 표시 방식 (v2.0) — 자동 판별이 직접 쓴 글을 HTML로 오판하는 경우가 있어 직접 고를 수 있게
  const [bodyDisp, setBodyDisp] = useState<'auto' | 'text' | 'html'>('auto');
  const [eFile, setEFile] = useState<File | null>(null);
  const [eText, setEText] = useState('');
  const eFileRef = useRef<HTMLInputElement>(null);
  const eThumbRef = useRef<HTMLInputElement>(null);
  // 썸네일 교체
  const [thumbMode, setThumbMode] = useState<'keep' | 'image' | 'color'>('keep');
  const [eThumb, setEThumb] = useState<File | null>(null);
  const [eThumbUrl, setEThumbUrl] = useState('');
  const [eThumbCrop, setEThumbCrop] = useState<CropValue | undefined>(undefined);
  const curThumbUrl = useBlobUrl(l?.thumbId);   // 「현재 유지」로 위치만 조정할 때의 원본
  const [eCropOpen, setECropOpen] = useState(false);
  const [eColorMode, setEColorMode] = useState<'grad' | 'solid'>('grad');
  const [eC1, setEC1] = useState('#4c5a6e');
  const [eC2, setEC2] = useState('#242b36');
  // 모양 (원본 발화가 있는 역극 로그만) — EDIT에서 메신저/대본·HTML/텍스트·프로필 사진을 바꾸면 저장할 때 다시 그린다 (사용자 요청)
  const [eStyle, setEStyle] = useState<'script' | 'imsg'>('imsg');
  const [eFmt, setEFmt] = useState<'html' | 'text'>('html');
  const [eFaces, setEFaces] = useState(true);

  // 편집모드 (커플홈 사용자 요청 — "본문 편집을 따로 두지 말고 편집모드 버튼 … 개별 롤플을 편집 … 우클릭이나 호버로").
  // 원본 발화(src)가 있는 로그: 프레임 안에 심은 스크립트(아래 inject)가 발화 위 호버 도구(✎ ＋ ✕)와 우클릭 메뉴를 띄우고,
  // 고른 동작을 postMessage로 알려 오면 여기서 작은 수정 창을 열어 그 발화만 고친 뒤 같은 모양으로 다시 그린다
  // (널 오리진 샌드박스라 바깥은 프레임 문서를 직접 못 만진다). 원본이 없는 로그(파일·직접 작성)는 발화 단위가 없어 본문 글을 그대로 고치는 칸
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false); editingRef.current = editing;
  const [eBody, setEBody] = useState('');
  const [saving, setSaving] = useState(false);
  /** 발화 하나 수정·추가 창 — i는 원본 발화 번호(data-i), insert면 그 아래에 */
  const [msgEdit, setMsgEdit] = useState<{ mode: 'edit' | 'insert'; i: number; charId: string; text: string } | null>(null);
  const [msgDel, setMsgDel] = useState<number | null>(null);
  const toggleEdit = () => {
    if (editing) { setEditing(false); return; }
    if (!bd?.src) setEBody(bodyText ?? '');
    // 이 기능 전에 그린 본문에는 발화 번호(data-i)가 없다 — 켜는 김에 원본 발화로 한 번 다시 그려 저장 (같은 내용, 번호만 붙는다)
    else if (bd.src.fmt === 'html' && bodyText && !/ data-i="/.test(bodyText)) void commitSrc(bd.src);
    setEditing(true);
  };
  /** 프레임에 편집모드 켜짐/꺼짐 알리기 — 토글할 때와 문서가 새로 뜰 때(onFrameLoad) */
  const sendEditMode = () => {
    try { frameRef.current?.contentWindow?.postMessage({ __logEditMode: editingRef.current && !!bd?.src }, '*'); } catch { /* 무시 */ }
  };
  useEffect(() => { sendEditMode(); }, [editing, bd?.src]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** 본문 문서 갈아 끼우기 (+ 목록 문서 일부) — 편집모드는 그대로 두고 본문만 다시 로드한다 */
  const saveBodyPatch = (patch: Partial<TrpgLogBody>, logPatch: Partial<TrpgLog>) => {
    if (!l) return;
    const editorIds = trpgEditorIds(menuSet, l.secId ?? MAIN_SEC, members, l.editorIds);
    const nextBody: TrpgLogBody = {
      id, ...bd, body: '', bodyId: undefined, ...patch,
      authorId: bd?.authorId ?? l.authorId, editorIds,
      visibility: bodyVisibility(l), ...secStamp(l.secId ?? MAIN_SEC),
    };
    // 본문 문서는 뒤에 붙인다 (기존 본문들의 자리가 밀려 재저장되지 않게 — saveEdit와 같은 이유)
    saveBody(nextBody);
    setLogs(logs.map(x => x.id === id ? { ...x, ...logPatch, editorIds } : x));
    setBodyText(null);   // 본문 다시 로드 — 프레임이 다시 뜨면 onFrameLoad가 편집모드를 다시 켠다
  };
  /** 원본 발화를 바꾼 뒤 저장 — 같은 모양으로 다시 그린다 */
  const commitSrc = async (nextSrc: RpLogSrc) => {
    if (!l || saving) return;
    if (!nextSrc.msgs.length) { toast('발화가 하나도 없습니다 — 한 줄은 남겨 주세요'); return; }
    setSaving(true);
    try {
      const r = await renderLogSrc(nextSrc, l.title, allChars, rels, l.relId, l.auId);
      const logPatch: Partial<TrpgLog> = {};
      // 「동행」 칸이 자동값(말한 캐릭터 이름)이었으면 바뀐 발화자에 맞춘다 — 직접 고쳐 둔 것은 그대로
      const prevAuto = bd?.src
        ? rpSpeakers(bd.src.msgs, logViewChars(allChars, rels, l.relId, l.auId).viewChars).map(c => c.name).join(' · ')
        : undefined;
      if (!l.withText || l.withText === prevAuto) logPatch.withText = r.withText;
      saveBodyPatch({ ...(await saveLogBody(r.bodyText)), bodyHtml: nextSrc.fmt === 'html', src: nextSrc }, logPatch);
      toast('저장했습니다');
    } finally {
      setSaving(false);
    }
  };
  /** 원본이 없는 로그 — 본문 글을 그대로 고친 것 저장 */
  const saveRawBody = async () => {
    if (!l || saving) return;
    setSaving(true);
    try {
      saveBodyPatch({ ...(await saveLogBody(eBody)) }, {});
      setEditing(false);
      toast('본문을 저장했습니다');
    } finally {
      setSaving(false);
    }
  };
  const blankMsg = (prev?: RpMessage): RpMessage =>
    ({ id: newId(), kind: 'desc', authorId: '', text: '', date: prev?.date ?? new Date().toISOString() });
  /** 수정·추가 창 SAVE */
  const saveMsgEdit = () => {
    const s = bd?.src, me = msgEdit;
    if (!s || !me) return;
    if (!me.text.trim()) { toast('내용을 입력해 주세요'); return; }
    const base = me.mode === 'edit' ? s.msgs[me.i] : blankMsg(s.msgs[me.i]);
    const next: RpMessage = me.charId === DESC_KEY
      ? { ...base, kind: 'desc', charId: undefined, text: me.text }
      : { ...base, kind: 'char', charId: me.charId, text: me.text };
    const msgs = [...s.msgs];
    if (me.mode === 'edit') msgs[me.i] = next; else msgs.splice(me.i + 1, 0, next);
    setMsgEdit(null);
    void commitSrc({ ...s, msgs });
  };
  /** 프레임 안에서 고른 동작(수정·아래에 추가·삭제) — onMsg는 한 번만 등록되므로 ref로 최신 함수를 본다 */
  const editActRef = useRef<(action: string, i: number) => void>(() => {});
  editActRef.current = (action, i) => {
    const s = bd?.src;
    if (!s || !editingRef.current) return;
    const m = s.msgs[i];
    if (!m) return;
    const charId = m.kind === 'char' ? (m.charId ?? '') : DESC_KEY;
    if (action === 'delete') setMsgDel(i);
    else if (action === 'insert') setMsgEdit({ mode: 'insert', i, charId, text: '' });
    else setMsgEdit({ mode: 'edit', i, charId, text: m.text });
  };

  const saveEdit = async () => {
    if (!e.title.trim()) { toast('시나리오 타이틀을 입력해 주세요'); return; }
    // 페이지 주소 별명 (커플홈) — 캐릭터와 같은 규칙, 다른 로그의 id·별명과 겹치면 안 된다
    const slug = e.slug.trim();
    if (slug && slug !== (l?.slug ?? '')) {
      if (!isValidSlug(slug)) { toast('주소는 영문 소문자·숫자·하이픈만 쓸 수 있습니다'); return; }
      if (logs.some(x => x.id !== id && (x.id === slug || x.slug === slug))) { toast('이미 사용 중인 주소입니다 — 다른 주소를 입력해 주세요'); return; }
    }
    // 본문 교체 준비 — 본문은 목록과 분리 저장이라(v2.0) 이제 TrpgLogBody 조각으로 만든다
    let bodyPatch: Partial<TrpgLogBody> = {};
    const nextRelId = e.relId === 'none' ? undefined : e.relId;
    const nextAuId = e.relId !== 'none' && e.auId !== 'base' ? e.auId : undefined;
    if (bodyMode === 'keep' && bd?.src) {
      // 원본 발화가 있는 로그 — 모양이나 자관·AU가 바뀌었으면 그 설정으로 다시 그린다 (AU가 바뀌면 이름·사진도 그 AU 것)
      const s = bd.src;
      const changed = s.style !== eStyle || s.fmt !== eFmt || s.faces !== eFaces
        || (l?.relId ?? undefined) !== nextRelId || (l?.auId ?? undefined) !== nextAuId;
      if (changed) {
        const nextSrc = { ...s, style: eStyle, fmt: eFmt, faces: eFaces };
        const r = await renderLogSrc(nextSrc, e.title.trim(), allChars, rels, nextRelId, nextAuId);
        bodyPatch = { ...(await saveLogBody(r.bodyText)), bodyHtml: eFmt === 'html', src: nextSrc };
      }
    }
    if (bodyMode === 'file' && eFile) {
      const text = await decodeLogText(eFile);
      bodyPatch = {
        ...(await saveLogBody(text)),
        originalFileId: await putBlob(eFile), originalName: eFile.name,
      };
    } else if (bodyMode === 'text' && eText.trim()) {
      bodyPatch = await saveLogBody(eText);
    }
    // 썸네일 교체 준비
    let thumbPatch: Partial<TrpgLog> = {};
    if (thumbMode === 'image' && eThumb) {
      thumbPatch = { thumbId: await putBlob(eThumb), thumbCrop: eThumbCrop, thumbColor: undefined };
    } else if (thumbMode === 'keep' && l?.thumbId) {
      // 이미지는 그대로 두고 위치·확대만 바꾼 경우 (사용자 요청)
      thumbPatch = { thumbCrop: eThumbCrop };
    } else if (thumbMode === 'color') {
      thumbPatch = { thumbId: undefined, thumbCrop: undefined, thumbColor: { c1: eC1, c2: eColorMode === 'grad' ? eC2 : undefined } };
    }
    const nextLog: TrpgLog = {
      ...(l as TrpgLog),
      noText: e.noText.trim() || undefined,
      slug: slug || undefined,
      tags: e.tags.length ? e.tags : undefined,   // 태그 (커플홈)
      title: e.title.trim(), catchphrase: e.catchphrase.trim() || undefined,
      writer: e.writer.trim(), withText: e.withText.trim(),
      relId: e.relId === 'none' ? undefined : e.relId,
      auId: e.relId !== 'none' && e.auId !== 'base' ? e.auId : undefined,   // 그 자관의 AU (커플홈)
      date: e.date || undefined,
      visibility: e.visibility, password: e.password.trim() || undefined,
      listHidden: e.listHidden,
      editorIds: trpgEditorIds(menuSet, l?.secId ?? MAIN_SEC, members, l?.editorIds),   // 등록 권한이 있는 회원 = 수정 가능 (저장할 때마다 최신으로)
      ...thumbPatch,
      // 예전엔 본문이 이 문서에 있었다 — 저장할 때마다 확실히 비워서(구버전 잔재 정리),
      // 나만보기 로그가 목록엔 뜨면서 본문까지 같이 새어 나가는 일이 없게 한다 (v2.0)
      body: undefined, bodyId: undefined, bodyHtml: undefined,
      originalFileId: undefined, originalName: undefined,
    };
    setLogs(logs.map(x => x.id === id ? nextLog : x));
    // 본문은 별도 문서에 upsert — 「현재 유지」면 기존 값(분리된 게 있으면 그것, 없으면 구버전 로그의
    // 내장 값)을 그대로 옮겨 담아, 한 번이라도 수정하면 자동으로 분리 저장 쪽으로 옮겨지게 한다
    const nextBody: TrpgLogBody = {
      id,
      body: bd?.body ?? l?.body ?? '',
      bodyId: bd?.bodyId ?? l?.bodyId,
      originalFileId: bd?.originalFileId ?? l?.originalFileId,
      originalName: bd?.originalName ?? l?.originalName,
      bodyHtml: bodyDisp === 'auto' ? undefined : bodyDisp === 'html',
      // 원본 발화는 본문을 그대로 둘 때만 유지 — 파일·직접 입력으로 갈아 끼우면 더는 맞지 않는다
      src: bodyMode === 'keep' ? bd?.src : undefined,
      authorId: bd?.authorId ?? l?.authorId,
      editorIds: nextLog.editorIds,
      ...bodyPatch,
      visibility: bodyVisibility(nextLog),
      ...secStamp(nextLog.secId ?? MAIN_SEC),   // 소속 (v2.0) — 본문 문서도 비공개 판정을 받게
    };
    // 새 본문 문서는 뒤에 붙인다 (v2.0 포크 제보) — 앞에 끼우면 기존 본문 전체의 자리가 밀려
    // 재저장 대상이 되고, 큰 본문이 쌓인 홈에서는 그 합이 쓰기 한도를 넘어 저장이 실패했다
    saveBody(nextBody);
    if (bodyMode !== 'keep') setBodyText(null); // 본문 다시 로드
    // 별명을 바꿨으면 지금 주소(옛 별명)로는 더 못 찾으니 새 주소로 — id 주소에서 바꾼 경우에도 별명 주소를 보여 준다
    if ((nextLog.slug ?? '') !== (l?.slug ?? '')) router.replace(logPath(nextLog));
    setEOpen(false);
    setBodyMode('keep'); setEFile(null); setEText('');
    setThumbMode('keep'); setEThumb(null); setEThumbUrl(''); setEThumbCrop(undefined);
    toast('저장되었습니다');
  };

  // 본문 로드 — 분리 저장된 본문(bd) 우선, 없으면 구버전 로그의 내장 본문(l.body/bodyId)로 fallback (v2.0)
  const [bodyFailed, setBodyFailed] = useState(false);   // 본문 파일을 읽지 못함 (아래 원본 파일 fallback)
  useEffect(() => {
    if (!l) return;
    const src = bd ?? l;   // bd가 없으면(아직 분리 전인 구버전 로그) l 자신에서 읽는다
    setBodyFailed(false);
    if (src.body) { setBodyText(src.body); return; }
    if (src.bodyId) {
      getBlob(src.bodyId)
        .then(async b => { if (b) setBodyText(await b.text()); else { setBodyText(''); setBodyFailed(true); } })
        .catch(() => { setBodyText(''); setBodyFailed(true); });
    } else setBodyText('');
  }, [l, bd]);

  // 샌드박스 안 높이 리포터 수신 → iframe 높이 자동 맞춤 (널 오리진이라 직접 측정 불가)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      // 편집모드 — 프레임 안에서 고른 발화 동작 (커플홈)
      const ed = (e.data as { __logEdit?: { action?: unknown; i?: unknown } })?.__logEdit;
      if (ed && typeof ed.action === 'string' && typeof ed.i === 'number') { editActRef.current(ed.action, ed.i); return; }
      const h = (e.data as { __logH?: unknown })?.__logH;
      if (typeof h === 'number' && isFinite(h) && frameRef.current) {
        // scrollHeight는 최소한 뷰포트(=현재 iframe 높이)만큼 보고되므로 여기에 여백을
        // 더하면 "설정 → 커진 값 보고 → 재설정" 무한 성장 루프가 됨 — 보고값 그대로,
        // 그리고 현재 높이와 사실상 같으면(±2px) 재설정하지 않음
        const next = Math.min(200000, Math.max(200, Math.round(h)));
        gotHeightRef.current = true;
        const cur = frameRef.current.getBoundingClientRect().height;
        if (Math.abs(next - cur) > 2) frameRef.current.style.height = `${next}px`;
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  /** 문서가 뜨는 순간 일단 낮게 줄인다 — 안쪽 높이 계산이 뷰포트(현재 iframe 높이)에 끌려
   *  커지는 것을 막기 위해서다. 곧 오는 보고값으로 내용 높이에 맞춘다.
   *  보고가 오지 않는 문서(스크립트가 없거나 막힌 경우)는 기본 높이로 되돌려 내부 스크롤로 읽게 한다. */
  const onFrameLoad = () => {
    if (!frameRef.current) return;
    gotHeightRef.current = false;
    frameRef.current.style.height = '240px';
    sendEditMode();   // 새로 뜬 문서에 편집모드 상태 알리기 (저장 뒤 다시 그려져도 편집모드가 이어진다)
    // 보고가 하나도 안 오는 문서(스크립트가 막힌 경우)만 기본 높이로 되돌린다.
    // 3초로 늘렸다 — 리포터가 2초마다 같은 값이라도 다시 알려 오므로, 그 사이에 제자리를 찾는다
    setTimeout(() => {
      if (!gotHeightRef.current && frameRef.current) frameRef.current.style.height = '';
    }, 3000);
  };

  // 없거나 볼 수 없으면 위 useEffect가 홈으로 보낸다 — 그 사이엔 빈 화면만 (v2.0)
  // 막힌 곳이면 여기서 되돌아간다 — 훅을 모두 부른 뒤여야 렌더마다 개수가 같다
  if (blocked) return blocked;
  if (!loaded || !l) return <section className="page" />;
  if (!baseAllowed && !unlocked) {
    if (!l.password) return <section className="page" />;
    // 비밀번호 게이트 — 맞으면 이 세션 동안 열람 유지
    return (
      <section className="page">
        {/* 안내 문구는 환경설정 > TRPG에서 수정 — 관리자는 이 화면을 볼 수 없다 */}
        <div className="page-head"><PageTitle href={tt.href}>{tt.title}</PageTitle>
          <EditableDesc k="trpg-lock-desc" def="비밀번호를 입력하면 열람할 수 있습니다" always /></div>
        <div className="panel" style={{ maxWidth: 420, margin: '0 auto', padding: 26, display: 'grid', gap: 10 }}>
          <KInput type="password" placeholder="비밀번호" value={pwTry} onChange={e => setPwTry(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') tryUnlock(); }} />
          <button className="btn btn-dark" style={{ justifyContent: 'center', padding: 9 }} onClick={tryUnlock}>확인</button>
        </div>
      </section>
    );
  }

  const rel = rels.find(r => r.id === l.relId);
  const canEdit = canEditTrpg(l, { loggedIn: !!user, isAdmin, id: user?.id });
  const canDelete = isAdmin || (!!user && l.authorId === user.id);   // 삭제는 본인과 관리자만
  const srcChars = logViewChars(allChars, rels, l.relId, l.auId);   // 편집모드 수정 창의 발화자 목록 (자관 멤버 먼저)
  const msgCharOptions = (() => {
    const base = [
      ...srcChars.members.map(c => ({ value: c.id, label: c.name })),
      ...srcChars.others.map(c => ({ value: c.id, label: `그 밖 · ${c.name}` })),
      { value: DESC_KEY, label: '지문(서술)' },
    ];
    // 지워진 캐릭터의 발화 — 고르는 목록엔 없지만 지금 값은 보여 준다
    return msgEdit && !base.some(o => o.value === msgEdit.charId) ? [{ value: msgEdit.charId, label: '(삭제된 캐릭터)' }, ...base] : base;
  })();
  // 프레임 안 편집 도구의 색 — 홈의 포인트색을 따른다 (프레임 문서에는 CSS 변수가 없어 값으로 넣는다)
  const accent = (typeof window !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) || '#5d636d';
  const body = bodyText ?? '';
  // 지정값이 있으면 그대로 — 직접 쓴 글이 태그처럼 보이는 문자 때문에 HTML로 오판되던 것 방지
  /* 메신저 모양 역극 로그의 좌우는 보는 사람 기준 (커플홈 사용자 요청) — 관리자는 자캐가 오른쪽, 역극 참여 회원은
     자기 캐릭터가 오른쪽, 그 밖(방문자·참여 안 한 회원)은 관리자의 캐릭터가 오른쪽. 좌우가 이미 박힌 옛 본문은 그대로 */
  const ownIds = allChars.filter(c => c.own).map(c => c.id);
  const grantedIds = user && !isAdmin ? allChars.filter(c => !!charGrant(c, user.id)).map(c => c.id) : [];
  const html = showAsHtml({ bodyHtml: bd?.bodyHtml ?? l.bodyHtml }, body);
  const sidedBody = html ? applyLogSides(body, grantedIds.length ? grantedIds : ownIds) : body;
  // 원본 파일도 분리 저장된 쪽 우선, 없으면 구버전 로그의 내장 값 (v2.0)
  const origFileId = bd?.originalFileId ?? l.originalFileId;
  const origName = bd?.originalName ?? l.originalName;
  // 본문이 없을 때 대신 띄울 수 있는 서버 파일 주소 (v2.0 포크 제보 — 본문 저장 실패 대비)
  const fallbackUrl = [bd?.bodyId, l.bodyId, origFileId]
    .find(x => typeof x === 'string' && /^https?:/.test(x));
  // iframe 기본 body 마진 제거(흰 테두리 방지) + 높이 리포터 주입
  // 크리스탈리아/크릿 계열 로그는 본문을 JS로 그리므로 스크립트 실행이 필요 —
  // 널 오리진 샌드박스(allow-scripts만)라 사이트 쿠키·DOM 접근은 불가 (6.3의 격리 목적 유지)
  // 심(shim)+높이 리포터는 문서 앞쪽에 둔다 — 로그 문서가 파싱 도중 어떤 상태가 되어도
  // 인터벌 리포터는 계속 동작 (뒤에 붙이면 일부 대형 로그에서 실행되지 않는 사례 있음).
  // **다만 <!DOCTYPE>보다 앞에 두면 안 된다** (v2.0 사용자 발견 — 긴 로그 아래 빈 공간):
  // doctype 앞에 무엇이든 있으면 문서가 **쿼크 모드**로 파싱되고, 쿼크 모드에서는 body가
  // 스크롤 요소라 `body.scrollHeight`가 **최소한 뷰포트(=지금 iframe 높이)**를 돌려준다.
  // 그러면 리포터가 자기 프레임 높이를 그대로 되읽어 「어긋난 높이가 스스로를 정당화」한다 —
  // 한 번 크게 잡히면 영영 줄지 않는다. 아래 injectAfterDoctype가 doctype 바로 뒤에 끼워 넣는다.
  // <meta charset>도 함께 주입 — decodeLogText가 이미 문자열로 만들었으므로 Blob은 언제나 UTF-8이다.
  // 원본 문서의 charset 선언(euc-kr 등)이 뒤에 남아 있어도 먼저 온 선언이 이긴다
  const inject = `<meta charset="utf-8"><script>
// 널 오리진에서 localStorage 접근이 예외를 던져 로그 스크립트가 죽는 것 방지 (무동작 심)
try{void window.localStorage}catch(e){var __m={getItem:function(){return null},setItem:function(){},removeItem:function(){},clear:function(){},key:function(){return null},length:0};
try{Object.defineProperty(window,'localStorage',{value:__m});Object.defineProperty(window,'sessionStorage',{value:__m});}catch(e2){}}
// 높이 리포터 — 타이머 대신 MutationObserver+load 이벤트 (백그라운드 탭 스로틀링 회피).
// documentElement.scrollHeight는 뷰포트(=iframe 현재 높이)보다 작아지지 않아, 한 번 커지면
// 내용이 짧아도 줄어들지 못한다(짧은 로그 아래에 빈 공간이 남던 원인) → body 기준으로 잰다.
(function(){var p=0,n=0;function r(force){try{
var b=document.body;if(!b)return;
// html(documentElement)은 내용이 짧아도 뷰포트(=iframe 현재 높이)만큼 늘어나므로 기준으로 쓰지 않는다.
// scrollHeight든 offsetHeight든 마찬가지라, 늘어나지 않는 body만 본다.
var h=Math.max(b.scrollHeight||0,b.offsetHeight||0,Math.ceil(b.getBoundingClientRect().height)||0);
// **0이면 아무것도 알리지 않는다** (v2.0 사용자 발견 — 긴 로그 아래 빈 공간).
// 예전에는 여기서 documentElement.scrollHeight로 넘어갔는데, 그 값은 최소한 뷰포트(=지금 iframe
// 높이)만큼이라 **자기 높이를 그대로 되읽는다.** 아직 레이아웃이 안 된 순간(탭이 뒤에 있거나
// 첫 그림 전)에 그 값이 나가면 바깥은 그것을 「내용 높이」로 믿고 그대로 고정해 버리고,
// 그 뒤로는 같은 값이 계속 보고되어 **어긋난 높이가 스스로를 정당화한다** — 되돌릴 방법이 없었다
if(!h)return;
// 값이 그대로여도 가끔은 다시 알린다 (v2.0) — 바깥이 다른 이유로 높이를 되돌려 놓았을 수 있다.
// 예전에는 「같으면 안 보냄」이라, 한 번 어긋나면 되돌릴 방법이 아예 없었다
if(h!==p||force){p=h;parent.postMessage({__logH:h},'*');}}catch(e3){}}
document.addEventListener('DOMContentLoaded',function(){r(1)});addEventListener('resize',function(){r(1)});
// **이미지·폰트는 첫 그림 뒤에 붙으면서 높이를 바꾼다** (v2.0 사용자 발견 — 긴 로그 아래 빈 공간).
// 개별 이미지의 load/error까지 잡으려면 캡처 단계로 들어야 한다(이 이벤트들은 위로 올라오지 않는다).
addEventListener('load',function(){r(1)},true);
addEventListener('error',function(){r(1)},true);
try{if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){r(1)});}catch(e5){}
try{new MutationObserver(function(){r(0)}).observe(document.documentElement,{childList:true,subtree:true,attributes:true});}catch(e4){}
// 0.4초마다 확인하고, 2초마다는 값이 같아도 다시 알린다 (숨김 상태에선 레이아웃이 0이라 스킵됨)
setInterval(function(){n++;r(n%5===0);},400);
r(1);})();
</scr${''}ipt><style>
/* height:auto — 로그 문서가 html/body에 100%를 걸어 두면 내용과 무관하게 뷰포트만큼 커진다 */
html,body{margin:0!important;padding:0!important;height:auto!important;min-height:0!important}
</style><scr${''}ipt>
// 편집모드 (커플홈) — 바깥(상세 페이지)이 {__logEditMode:true}를 보내면 발화([data-i]) 위 호버 도구(✎ ＋ ✕)와 우클릭 메뉴를 켠다.
// 고른 동작은 {__logEdit:{action,i}}로 바깥에 알리고, 바깥이 그 발화만 고쳐 문서를 다시 그린다 (널 오리진이라 바깥은 이 문서를 못 만진다)
(function(){var on=false,tools=null,menu=null;
function send(a,i){parent.postMessage({__logEdit:{action:a,i:i}},'*')}
function tgt(e){var t=e.target;while(t&&t.nodeType===1&&!t.hasAttribute('data-i'))t=t.parentNode;return t&&t.nodeType===1?t:null}
function hide(){if(menu){if(menu.parentNode)menu.parentNode.removeChild(menu);menu=null}}
function mk(label,act,i,cls){var b=document.createElement('button');b.type='button';b.textContent=label;b.className=cls||'';
b.onmousedown=function(ev){ev.preventDefault();ev.stopPropagation()};b.onclick=function(ev){ev.stopPropagation();ev.preventDefault();hide();send(act,i)};return b}
document.addEventListener('contextmenu',function(e){if(!on)return;var t=tgt(e);if(!t)return;e.preventDefault();hide();var i=+t.getAttribute('data-i');
menu=document.createElement('div');menu.className='lg-menu';menu.appendChild(mk('✎ 수정하기','edit',i));menu.appendChild(mk('＋ 아래에 추가','insert',i));menu.appendChild(mk('✕ 삭제하기','delete',i,'danger'));
document.body.appendChild(menu);var w=menu.offsetWidth,maxX=document.documentElement.scrollWidth-w-6;menu.style.left=Math.max(4,Math.min(e.pageX,maxX))+'px';menu.style.top=e.pageY+'px'});
document.addEventListener('mousedown',function(e){if(menu&&!menu.contains(e.target))hide()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')hide()});
document.addEventListener('mouseover',function(e){if(!on)return;var t=tgt(e);if(!t)return;if(tools&&tools.parentNode===t)return;
if(!tools){tools=document.createElement('div');tools.className='lg-tools'}tools.innerHTML='';var i=+t.getAttribute('data-i');
tools.appendChild(mk('✎','edit',i));tools.appendChild(mk('＋','insert',i));tools.appendChild(mk('✕','delete',i,'danger'));t.appendChild(tools)});
window.addEventListener('message',function(e){var d=e.data||{};if(typeof d.__logEditMode==='boolean'){on=d.__logEditMode;document.documentElement.classList.toggle('lg-edit',on);
if(!on){hide();if(tools&&tools.parentNode)tools.parentNode.removeChild(tools)}}});
})();
</scr${''}ipt><style>
/* 편집모드 도구 (커플홈) — 바깥이 켤 때만 (html.lg-edit) */
.lg-edit [data-i]{position:relative;cursor:pointer}
.lg-edit [data-i]:hover{outline:1.5px dashed color-mix(in srgb,${accent} 55%,transparent);outline-offset:4px;border-radius:10px}
.lg-tools{position:absolute;top:-14px;right:0;display:none;gap:2px;z-index:9;background:#fff;border:1px solid #d9dbe0;border-radius:8px;padding:2px;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.lg-edit [data-i]:hover>.lg-tools{display:flex}
.lg-tools button,.lg-menu button{border:0;background:transparent;cursor:pointer;font:inherit;font-size:11px;line-height:1;padding:5px 7px;border-radius:6px;color:#3c434d;white-space:nowrap}
.lg-tools button:hover,.lg-menu button:hover{background:color-mix(in srgb,${accent} 10%,#fff);color:${accent}}
.lg-tools button.danger:hover,.lg-menu button.danger:hover{background:rgba(200,60,60,.1);color:#b23a3a}
.lg-menu{position:absolute;z-index:99;display:flex;flex-direction:column;background:#fff;border:1px solid #d9dbe0;border-radius:9px;padding:4px;box-shadow:0 6px 18px rgba(0,0,0,.15);min-width:132px}
.lg-menu button{text-align:left;padding:7px 10px;font-size:12px}
</style>`;
  /** 주입 위치 — <!DOCTYPE ...> 가 있으면 그 **바로 뒤**에, 없으면 doctype을 만들어 앞에.
   *  표준 모드를 지켜야 body 높이가 진짜 내용 높이가 된다 (위 주석 참조) */
  const buildDoc = (doc: string) => {
    const dt = /^\s*<!doctype[^>]*>/i.exec(doc);
    return dt ? doc.slice(0, dt[0].length) + inject + doc.slice(dt[0].length) : `<!DOCTYPE html>${inject}${doc}`;
  };
  const srcDoc = buildDoc(sidedBody);
  // 텍스트 모양으로 저장된 역극 로그도 편집모드에서는 임시로 대본 모양 HTML로 그려 발화 단위로 고칠 수 있게 (저장은 텍스트 그대로)
  const editDoc = editing && bd?.src && !html
    ? buildDoc(rpLogHtml({ title: l.title, sub: l.withText }, bd.src.msgs, srcChars.viewChars,
        { time: bd.src.time, forBoard: true, style: 'script', rightIds: [], neutralSides: true, noMeta: bd.src.noMeta }))
    : null;

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle href={tt.href}>{tt.title}</PageTitle>
        <p>{logNo(l)}{[l.writer, l.withText].filter(Boolean).map(x => ` · ${x}`).join('')}{l.date ? ` · ${l.date.replace(/-/g, '.')}` : ''}{l.tags?.length ? ` · ${l.tags.map(t => '#' + t).join(' ')}` : ''}</p>
        <div className="head-actions">
          {/* AU 로그면 AU 이름까지, 누르면 그 AU 페이지로 (커플홈) */}
          {rel && (() => {
            const au = l.auId ? rel.aus.find(a => a.id === l.auId && a.id !== 'base') : undefined;
            const href = au ? `/rels/${rel.id}?au=${encodeURIComponent(au.slug?.trim() || au.id)}` : `/rels/${rel.id}`;
            return <button className="btn btn-dark" onClick={() => router.push(href)}>{au ? `${rel.name} · ${au.label || 'AU'}` : rel.name} ›</button>;
          })()}
          {/* 편집모드 — 발화 위 호버 도구·우클릭 메뉴로 하나씩 고친다 (원본이 없는 로그는 본문 글 그대로) */}
          {canEdit && <button className={`btn ${editing ? 'btn-dark' : 'btn-ghost'}`} onClick={toggleEdit}>{editing ? '편집 끝' : '편집모드'}</button>}
          {canEdit && <button className="btn btn-dark" onClick={() => {
            setE({
              noText: l.noText ?? '', slug: l.slug ?? '', tags: l.tags ?? [], title: l.title, catchphrase: l.catchphrase ?? '', writer: l.writer,
              withText: l.withText, relId: l.relId ?? 'none', auId: l.auId ?? 'base', date: l.date ?? '',
              visibility: l.visibility, password: l.password ?? '', listHidden: !!l.listHidden,
            });
            // 본문·썸네일 교체 상태 초기화 (기본: 현재 것 유지)
            setBodyMode('keep'); setEFile(null); setEText(bodyText ?? '');
            if (bd?.src) { setEStyle(bd.src.style); setEFmt(bd.src.fmt); setEFaces(bd.src.faces); }
            const bh = bd?.bodyHtml ?? l.bodyHtml;
            setBodyDisp(bh === undefined ? 'auto' : bh ? 'html' : 'text');
            // 「현재 유지」에서도 위치·확대를 조정할 수 있게 지금 크롭값에서 시작한다
            setThumbMode('keep'); setEThumb(null); setEThumbUrl(''); setEThumbCrop(l.thumbCrop);
            setEColorMode(l.thumbColor ? (l.thumbColor.c2 ? 'grad' : 'solid') : 'grad');
            if (l.thumbColor) { setEC1(l.thumbColor.c1); if (l.thumbColor.c2) setEC2(l.thumbColor.c2); }
            setEOpen(true);
          }}>EDIT</button>}
          {canDelete && <button className="btn btn-dark" onClick={() => setDelAsk(true)}>DELETE</button>}
        </div>
      </div>

      {/* 본문만 폭 제한 — 헤더는 풀폭 위치 유지 */}
      <div className="panel" style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: l.serifTitle ? 'var(--serif)' : "'Noto Serif KR',serif",
          fontSize: 24, fontWeight: 700,
          marginBottom: l.catchphrase ? 2 : 18, // 캐치프레이즈가 없으면 본문과 붙지 않게 여백
          letterSpacing: l.serifTitle ? '.12em' : '.04em',
        }}>{l.title}</h2>
        {l.catchphrase && (
          <p style={{ fontSize: 11.5, color: 'var(--faint)', letterSpacing: '.14em', marginBottom: 16 }}>{l.catchphrase}</p>
        )}
        {editing && !bd?.src ? (
          /* 원본 발화가 없는 로그(파일·직접 작성) — 본문 글을 그대로 고친다 */
          <div className="lsrc-wrap">
            <div className="lsrc-bar">
              <button className="btn btn-dark" disabled={saving} onClick={saveRawBody}>{saving ? '저장 중…' : 'SAVE'}</button>
              <button className="btn btn-ghost" disabled={saving} onClick={() => setEditing(false)}>CANCEL</button>
              <small className="hint" style={{ margin: 0 }}>
                {html ? 'HTML 원문을 그대로 고칩니다 — 이 로그는 원본 발화가 없어 발화 단위로는 고칠 수 없습니다' : '본문을 그대로 고칩니다'}
              </small>
            </div>
            <KTextarea maxRows={40} value={eBody} onChange={ev => setEBody(ev.target.value)}
              style={{ minHeight: 320, ...(html ? { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 } : {}) }} />
          </div>
        ) : html || editDoc ? (
          <>
            {editing && (
              <p className="hint" style={{ margin: '0 0 10px' }}>
                편집모드 — 발화 위에 마우스를 올리면 ✎(수정) ＋(아래에 추가) ✕(삭제)가 뜨고, 우클릭 메뉴로도 됩니다. 다 고쳤으면 「편집 끝」
              </p>
            )}
            {/* 원본 스타일·스크립트 유지 — 널 오리진 샌드박스라 사이트 데이터에는 접근 불가 (6.3 격리) */}
            <LogFrame frameRef={frameRef} html={editDoc ?? srcDoc} title={l.title} onFrameLoad={onFrameLoad} />
          </>
        ) : (
          body
            ? <div className="log-plain">{body}</div>
            : fallbackUrl
              /* 본문 문서가 없거나 못 읽어도, 보관된 원본 파일이 서버에 있으면 그걸 그대로 보여 준다
                 (v2.0 포크 제보 — 본문 저장이 실패한 로그도 원본만 있으면 읽을 수 있게).
                 주입이 없어 높이 자동 맞춤은 안 되지만 기본 높이(65vh) 안에서 스크롤로 읽힌다 */
              ? (
                <>
                  <iframe className="log-frame" sandbox="allow-scripts" src={fallbackUrl} title={l.title} />
                  <p className="hint" style={{ marginTop: 6 }}>본문 문서를 불러오지 못해 보관된 원본 파일로 표시하고 있습니다 — 수정 화면에서 본문을 다시 저장하면 원래대로 돌아갑니다</p>
                </>
              )
              : (
                <p className="hint">
                  {bodyFailed
                    ? '본문 파일을 불러오지 못했습니다 — 새로고침해도 계속되면 수정 화면에서 본문을 다시 등록해 주세요'
                    : '본문이 비어 있습니다 — 이전 버전에서 등록된 항목이면 삭제 후 다시 등록해 주세요'}
                </p>
              )
        )}
        {/* 설명문 없이 원본 파일 다운로드 링크만 (4.3 백업) */}
        <p className="hint" style={{ marginTop: 10 }}>
          {origFileId && (
            /^https?:/.test(origFileId)
              // 서버에 올라간 파일은 링크로 연다 — fetch로 받으면 버킷 CORS 설정이 필요해진다
              ? (
                <a href={origFileId} target="_blank" rel="noreferrer" download={origName}
                  style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                  ⤓ 원본 파일 ({origName})
                </a>
              ) : (
                <span style={{ color: 'var(--accent)', cursor: 'var(--cur-pointer,pointer)', fontWeight: 600 }}
                  onClick={async () => {
                    // 이 브라우저에 보관된 원본 파일 (4.3 — 백업 목적)
                    const b = await getBlob(origFileId);
                    if (!b) return;
                    const u = URL.createObjectURL(b);
                    const a = document.createElement('a');
                    a.href = u; a.download = origName ?? 'log.txt';
                    a.click();
                    URL.revokeObjectURL(u);
                  }}>
                  ⤓ 원본 파일 ({origName})
                </span>
              )
          )}
        </p>
      </div>

      {/* 로그 정보 수정 모달 — 메타 + 본문 교체(파일/직접 수정) + 썸네일 교체(이미지/색) */}
      <Modal open={eOpen} onClose={() => setEOpen(false)} title="로그 정보 수정"
        dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setEOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={saveEdit}>SAVE</button>
        </>}>
        <div style={{ display: 'grid', gap: 9 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <KInput placeholder="시나리오 타이틀 (필수)" value={e.title} onChange={ev => setE(s => ({ ...s, title: ev.target.value }))} />
            {/* № 자리 표시 텍스트 전체를 직접 입력 — 비우면 자동 № 0XX */}
            <KInput placeholder="№ 표기 (선택 — 비우면 자동)" value={e.noText} onChange={ev => setE(s => ({ ...s, noText: ev.target.value }))}
              style={{ maxWidth: 200 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <KInput placeholder="캐치프레이즈 (선택)" value={e.catchphrase} onChange={ev => setE(s => ({ ...s, catchphrase: ev.target.value }))} />
            {/* 페이지 주소 별명 (커플홈 사용자 요청 — 무작위 id 대신 /trpg/별명) — id 주소는 계속 열린다 */}
            <KInput placeholder={`페이지 주소 (비우면 ${l.id})`} value={e.slug} onChange={ev => setE(s => ({ ...s, slug: slugify(ev.target.value) }))}
              style={{ maxWidth: 220 }} />
          </div>
          {/* 태그 (커플홈) — 다른 로그의 태그가 입력 중 아래에 자동완성 */}
          <TagInput value={e.tags} onChange={v => setE(s => ({ ...s, tags: v }))} suggestions={allTags} placeholder="태그 (Enter로 추가 · 기존 태그는 아래에 자동완성)" />
          <div style={{ display: 'flex', gap: 8 }}>
            <KInput placeholder="라이터 (선택)" value={e.writer} onChange={ev => setE(s => ({ ...s, writer: ev.target.value }))} />
            <KInput placeholder="같이 간 사람 (선택)" value={e.withText} onChange={ev => setE(s => ({ ...s, withText: ev.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <KSelect minWidth={140} value={e.relId} onChange={v => setE(s => ({ ...s, relId: v, auId: 'base' }))}
              options={[{ value: 'none', label: '자관 연동 없음' }, ...rels.map(r => ({ value: r.id, label: r.name }))]} />
            {/* 그 자관의 AU (커플홈) — AU가 있는 자관에서만 */}
            {(() => {
              const aus = rels.find(r => r.id === e.relId)?.aus.filter(a => a.id !== 'base') ?? [];
              return aus.length ? (
                <KSelect minWidth={120} value={e.auId} onChange={v => setE(s => ({ ...s, auId: v }))}
                  options={[{ value: 'base', label: '원본 설정' }, ...aus.map(a => ({ value: a.id, label: a.label || 'AU' }))]} />
              ) : null;
            })()}
            <KDate value={e.date} onChange={v => setE(s => ({ ...s, date: v }))} style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <KSelect minWidth={140} value={e.visibility} onChange={v => setE(s => ({ ...s, visibility: v as TrpgLog['visibility'] }))}
              options={[
                { value: 'public', label: '전체공개' },
                { value: 'member', label: '멤버공개' },
                { value: 'private', label: '나만보기' },
              ]} />
            <KInput placeholder="열람 비밀번호 (선택)" value={e.password} onChange={ev => setE(s => ({ ...s, password: ev.target.value }))} style={{ flex: 1 }} />
          </div>
          {/* 목록 표시 — 접근권한과 별개 (v2.0 사용자 요청) */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
            <span className="cp-lb">목록</span>
            <KSelect minWidth={140} value={e.listHidden ? 'hidden' : 'show'}
              onChange={v => setE(s => ({ ...s, listHidden: v === 'hidden' }))}
              options={[
                { value: 'show', label: '목록에 표시' },
                { value: 'hidden', label: '목록에서 숨기기' },
              ]} />
          </div>

          {/* 썸네일 교체 — 기본은 현재 썸네일 유지 */}
          <label className="k-label" style={{ margin: '4px 0 0' }}>썸네일</label>
          <div className="mini-seg" style={{ justifySelf: 'start' }}>
            <button className={thumbMode === 'keep' ? 'on' : ''} onClick={() => setThumbMode('keep')}>현재 유지</button>
            <button className={thumbMode === 'image' ? 'on' : ''} onClick={() => { setThumbMode('image'); if (!eThumb) eThumbRef.current?.click(); }}>이미지 교체</button>
            <button className={thumbMode === 'color' ? 'on' : ''} onClick={() => setThumbMode('color')}>색으로 교체</button>
          </div>
          <input ref={eThumbRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={ev => {
              const f = ev.target.files?.[0];
              if (f) { setEThumb(f); setEThumbUrl(URL.createObjectURL(f)); setEThumbCrop(undefined); setECropOpen(true); }
              ev.target.value = '';
            }} />
          {thumbMode === 'image' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 128, aspectRatio: '16/9', borderRadius: 8, overflow: 'hidden', cursor: 'var(--cur-pointer,pointer)',
                  border: '1.5px dashed var(--line)', flexShrink: 0, position: 'relative',
                }}
                onClick={() => eThumbRef.current?.click()}>
                {eThumbUrl && <CropImg src={eThumbUrl} crop={eThumbCrop} />}
              </div>
              {eThumb && (
                <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }}
                  onClick={() => setECropOpen(true)}>✂ 위치·확대 조정</button>
              )}
            </div>
          )}
          {/* 현재 유지 — 이미지는 그대로 두고 위치·확대만 조정 (사용자 요청) */}
          {thumbMode === 'keep' && l.thumbId && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{
                width: 128, aspectRatio: '16/9', borderRadius: 8, overflow: 'hidden',
                border: '1.5px solid var(--line)', flexShrink: 0, position: 'relative',
              }}>
                {curThumbUrl && <CropImg src={curThumbUrl} crop={eThumbCrop} />}
              </div>
              <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }}
                disabled={!curThumbUrl} onClick={() => setECropOpen(true)}>✂ 위치·확대 조정</button>
            </div>
          )}
          {thumbMode === 'color' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{
                width: 128, aspectRatio: '16/9', borderRadius: 8, flexShrink: 0,
                border: '1.5px solid var(--line)',
                background: eColorMode === 'grad' ? `linear-gradient(135deg, ${eC1} 0%, ${eC2} 100%)` : eC1,
              }} />
              <div className="mini-seg">
                <button className={eColorMode === 'grad' ? 'on' : ''} onClick={() => setEColorMode('grad')}>그라데이션</button>
                <button className={eColorMode === 'solid' ? 'on' : ''} onClick={() => setEColorMode('solid')}>단색</button>
              </div>
              <ColorField value={eC1} onChange={setEC1} />
              {eColorMode === 'grad' && (
                <>
                  <span style={{ color: 'var(--faint)', fontSize: 11 }}>→</span>
                  <ColorField value={eC2} onChange={setEC2} />
                </>
              )}
            </div>
          )}

          {/* 모양 (원본 발화가 있는 역극 로그) — 저장하면 원본 발화로 다시 그린다 (사용자 요청: "대본/메신저도 에딧에서 수정") */}
          {bd?.src && bodyMode === 'keep' && (
            <>
              <label className="k-label" style={{ margin: '4px 0 0' }}>모양 (역극 로그)</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="mini-seg">
                  <button className={eStyle === 'imsg' ? 'on' : ''} onClick={() => setEStyle('imsg')}>메신저</button>
                  <button className={eStyle === 'script' ? 'on' : ''} onClick={() => setEStyle('script')}>대본</button>
                </div>
                <div className="mini-seg">
                  <button className={eFmt === 'html' ? 'on' : ''} onClick={() => setEFmt('html')}>HTML</button>
                  <button className={eFmt === 'text' ? 'on' : ''} onClick={() => setEFmt('text')}>텍스트</button>
                </div>
                {eFmt === 'html' && <KCheck label="프로필 사진" checked={eFaces} onChange={setEFaces} />}
                <small className="hint" style={{ margin: 0 }}>바꾸고 저장하면 원본 발화로 다시 그려집니다</small>
              </div>
            </>
          )}
          {/* 본문 교체 — 기본은 현재 본문 유지 */}
          <label className="k-label" style={{ margin: '4px 0 0' }}>본문</label>
          <div className="mini-seg" style={{ justifySelf: 'start' }}>
            <button className={bodyMode === 'keep' ? 'on' : ''} onClick={() => setBodyMode('keep')}>현재 유지</button>
            {/* 아래 표시 방식 세그는 본문 교체와 별개 — 저장하면 항상 반영된다 */}
            <button className={bodyMode === 'text' ? 'on' : ''} onClick={() => { setBodyMode('text'); if (!eText) setEText(bodyText ?? ''); }}>직접 수정</button>
            <button className={bodyMode === 'file' ? 'on' : ''} onClick={() => setBodyMode('file')}>파일 업로드</button>
          </div>
          {bodyMode === 'file' && (
            <>
              <input ref={eFileRef} type="file" accept=".txt,.html,.htm,text/*" style={{ display: 'none' }}
                onChange={ev => { const f = ev.target.files?.[0]; if (f) setEFile(f); ev.target.value = ''; }} />
              <div className="upzone" style={{ marginBottom: 0 }} onClick={() => eFileRef.current?.click()}
                onDragOver={ev => ev.preventDefault()}
                onDrop={ev => { ev.preventDefault(); const f = ev.dataTransfer.files?.[0]; if (f) setEFile(f); }}>
                {eFile
                  ? <b>{eFile.name} — 저장 시 이 파일로 본문이 교체됩니다</b>
                  : <b>.txt / .html 파일을 끌어다 놓거나 클릭</b>}
              </div>
            </>
          )}
          {bodyMode === 'text' && (
            <KTextarea maxRows={36} style={{ minHeight: 160, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
              placeholder="HTML 코드 통째 붙여넣기 또는 텍스트 직접 작성" value={eText} onChange={ev => setEText(ev.target.value)} />
          )}

          {/* 본문 표시 방식 (v2.0) — 자동 판별이 직접 쓴 글을 HTML로 오판하는 경우가 있어 직접 고를 수 있게 */}
          <label className="k-label" style={{ margin: '4px 0 0' }}>본문 표시</label>
          <div className="mini-seg" style={{ justifySelf: 'start' }}>
            <button className={bodyDisp === 'auto' ? 'on' : ''} onClick={() => setBodyDisp('auto')}>자동</button>
            <button className={bodyDisp === 'text' ? 'on' : ''} onClick={() => setBodyDisp('text')}>글자 그대로</button>
            <button className={bodyDisp === 'html' ? 'on' : ''} onClick={() => setBodyDisp('html')}>HTML로</button>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            자동은 내용을 보고 판단합니다 — 직접 쓴 글에 &lt;태그&gt;처럼 보이는 문자가 있으면 HTML로 잘못 볼 수 있으니, 그럴 때 「글자 그대로」를 고르세요.
          </p>
        </div>
      </Modal>

      {/* 썸네일 크롭 편집기 (6.1 — 16:9 티켓 규격) */}
      {/* 새로 고른 이미지가 있으면 그것을, 「현재 유지」면 지금 썸네일을 대상으로 */}
      {(eThumbUrl || (thumbMode === 'keep' && curThumbUrl)) && (
        <CropEditor open={eCropOpen} src={eThumbUrl || curThumbUrl!} aspect="16:9" initial={eThumbCrop}
          onClose={() => setECropOpen(false)}
          onApply={c => { setEThumbCrop(c); setECropOpen(false); }} />
      )}

      {/* 편집모드 — 발화 하나 수정·추가 창 */}
      <Modal open={!!msgEdit} onClose={() => setMsgEdit(null)} title={msgEdit?.mode === 'insert' ? '발화 추가 (아래에)' : '발화 수정'} small
        actions={<>
          <button className="btn btn-ghost" onClick={() => setMsgEdit(null)}>CANCEL</button>
          <button className="btn btn-dark" disabled={saving} onClick={saveMsgEdit}>{saving ? '저장 중…' : 'SAVE'}</button>
        </>}>
        {msgEdit && (
          <div style={{ display: 'grid', gap: 9 }}>
            <KSelect minWidth={170} value={msgEdit.charId} onChange={v => setMsgEdit(s => (s ? { ...s, charId: v } : s))} options={msgCharOptions} />
            <KTextarea maxRows={18} value={msgEdit.text} onChange={ev => setMsgEdit(s => (s ? { ...s, text: ev.target.value } : s))}
              placeholder={msgEdit.charId === DESC_KEY ? '지문(서술)' : '대사'} style={{ minHeight: 120 }} />
          </div>
        )}
      </Modal>
      <ConfirmModal open={msgDel !== null} title="이 발화를 삭제할까요?" body="삭제한 발화는 되돌릴 수 없습니다."
        onClose={() => setMsgDel(null)}
        buttons={[
          { label: 'DELETE', kind: 'accent', onClick: () => {
            const s = bd?.src, i = msgDel;
            setMsgDel(null);
            if (s && i !== null) void commitSrc({ ...s, msgs: s.msgs.filter((_, j) => j !== i) });
          } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setMsgDel(null) },
        ]} />

      <ConfirmModal open={delAsk} title="로그를 삭제하시겠습니까?" body="삭제한 로그는 복구할 수 없습니다."
        onClose={() => setDelAsk(false)}
        buttons={[
          { label: 'DELETE', kind: 'accent', onClick: () => {
            leavingRef.current = true;
            setLogs(logs.filter(x => x.id !== l.id));
            removeBody();   // 분리 저장된 본문도 함께 삭제 (v2.0)
            router.push(tt.href);
          } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setDelAsk(false) },
        ]} />
    </section>
  );
}
