'use client';
// Videos 작성/수정 공용 폼 (커플홈) — 제목 · 영상(파일 하나 또는 링크) · 썸네일(선택) · 설명 · 태그 · 공개범위
// 수정 모드: 저장된 영상·썸네일은 그대로 두고, 새로 고르면 바꿔 끼운다
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId } from '@/lib/postStore';
import { useSectionParam, secStamp, MAIN_SEC, useSectionTitle } from '@/lib/sectionStore';
import { useMenuSettings, canWriteAt, writeKeyOf } from '@/lib/menuStore';
import { useBoardSettings, videoCatsOf } from '@/lib/boardStore';
import { VideoPost, VIDEO_KEY, VIDEO_SEED, videoEmbed, isVideoLink } from '@/lib/videoStore';
import { isFileUrl } from '@/lib/transfer';
import { isServerMode } from '@/lib/backend';
import { Visibility } from '@/lib/charStore';
import { KInput, KSelect, KRadio } from '@/components/ui/Kit';
import { RichEditor } from '@/components/ui/RichEditor';
import { putBlob, useBlobUrl } from '@/lib/blobStore';
import { useToast } from '@/components/ui/Toast';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';

/** 서버(Firebase Storage) 업로드 한도 — firebaseRules의 20MB와 같다. 더 큰 영상은 링크로 */
const UPLOAD_MAX = 20 * 1024 * 1024;
const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.round(b / 1024)}KB`);

/** 영상에서 썸네일 한 장 뽑기 — 1초 지점(짧으면 중간)을 캔버스로. 코덱을 못 읽으면 null */
function captureFrame(file: File): Promise<File | null> {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (f: File | null) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(f); };
    const timer = setTimeout(() => finish(null), 6000);
    v.onerror = () => { clearTimeout(timer); finish(null); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
    v.onseeked = () => {
      clearTimeout(timer);
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      if (!c.width) { finish(null); return; }
      c.getContext('2d')?.drawImage(v, 0, 0);
      c.toBlob(b => finish(b ? new File([b], 'poster.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.86);
    };
    v.src = url;
  });
}

/** 썸네일 — 새 파일이면 objectURL, 저장본·바깥 주소면 그대로 */
interface Poster { file?: File; url?: string; ref?: string; label: string }
function PosterPreview({ p }: { p: Poster }) {
  const loaded = useBlobUrl(p.ref);
  const src = p.url ?? loaded;
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 6, display: 'block' }} /> : null;
}

export function VideoForm({ initial }: { initial: VideoPost | null }) {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [posts, setPosts] = useLocalList<VideoPost>(VIDEO_KEY, VIDEO_SEED);
  const sec = useSectionParam('videos');
  const [menuSet, , menuLoaded] = useMenuSettings();
  const isNew = !initial;
  const tt = useSectionTitle('videos', initial ? (initial.secId ?? MAIN_SEC) : sec.id, isNew ? 'WRITE' : 'EDIT');
  const [title, setTitle] = useState(initial?.title ?? '');
  // 영상 — 저장된 글의 video가 바깥 주소(유튜브·노션 파일 주소 등)면 「링크」, 우리 저장소 주소나 파일 id면 「파일」
  const initLink = isVideoLink(initial?.video, isFileUrl) ? initial!.video : '';
  const [vidMode, setVidMode] = useState<'file' | 'link'>(initLink ? 'link' : 'file');
  const [vidFile, setVidFile] = useState<File | null>(null);            // 새로 고른 영상
  const [vidUrl, setVidUrl] = useState<string | undefined>(undefined);   // 그 미리보기 주소
  const [vidLink, setVidLink] = useState(initLink);
  const vidRef = initLink ? undefined : initial?.video;                 // 저장돼 있던 영상 (수정)
  const savedVidUrl = useBlobUrl(vidRef);
  const [poster, setPoster] = useState<Poster | null>(initial?.poster ? { ref: initial.poster, label: '저장된 썸네일' } : null);
  const [desc, setDesc] = useState(initial?.desc ?? '');
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '));
  const parseTags = (v: string) => [...new Set(v.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean))];
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? 'public');
  // 말머리 (커플홈 사용자 요청 — 갤러리처럼) — 이 비디오 게시판(섹션)의 말머리 중에서, 이름(label)으로 저장
  const { st: boardSet } = useBoardSettings();
  const videoCats = videoCatsOf(boardSet, initial ? (initial.secId ?? MAIN_SEC) : sec.id);
  const [category, setCategory] = useState(initial?.category ?? '');

  if (!user) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle href={tt.href}>{tt.title}</PageTitle><p>글쓰기는 로그인 후 이용할 수 있습니다</p></div>
      </section>
    );
  }
  /* 글쓰기 권한 (커플홈) — WRITE 버튼과 같은 판정으로 주소 직접 진입도 막는다. 새 글만 — 자기 글 수정은 그대로.
     설정을 읽기 전에는 폼을 그리지 않는다 (먼저 그리면 막힐 사람에게 폼이 한 번 비친다) */
  if (isNew && !menuLoaded) return <section className="page" />;
  if (isNew && !canWriteAt(menuSet, writeKeyOf('/videos', sec.id), { loggedIn: true, isAdmin, id: user.id })) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle href={tt.href}>{tt.title}</PageTitle><p>허용된 회원만 글을 쓸 수 있는 게시판입니다</p></div>
      </section>
    );
  }

  /** 영상 파일 고르기 — 종류·크기 확인 후 미리보기. 썸네일이 없으면 영상에서 한 장 뽑아 둔다 */
  const pickVideo = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    if (!f.type.startsWith('video/')) { toast('동영상 파일만 올릴 수 있습니다 (mp4 · webm · mov)'); return; }
    if (isServerMode() && f.size > UPLOAD_MAX) {
      toast(`서버 업로드 한도는 20MB입니다 (${fmtSize(f.size)}) — 더 큰 영상은 링크로 올려 주세요`);
      return;
    }
    if (vidUrl) URL.revokeObjectURL(vidUrl);
    setVidFile(f); setVidUrl(URL.createObjectURL(f));
    if (!poster) {
      const shot = await captureFrame(f);
      if (shot) setPoster(p => p ?? { file: shot, url: URL.createObjectURL(shot), label: '영상에서 뽑은 썸네일' });
    }
  };
  /** 링크 — 유튜브면 썸네일이 비어 있을 때 유튜브 썸네일을 넣어 둔다 */
  const setLink = (v: string) => {
    setVidLink(v);
    const emb = v.trim() ? videoEmbed(v.trim()) : null;
    if (emb?.thumb && !poster) setPoster({ ref: emb.thumb, label: '유튜브 썸네일' });
  };
  const pickPoster = (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('이미지 파일을 골라 주세요'); return; }
    setPoster({ file: f, url: URL.createObjectURL(f), label: f.name });
  };

  const post = async () => {
    if (!title.trim()) { toast('제목을 입력해 주세요'); return; }
    let video: string | undefined;
    if (vidMode === 'link') {
      video = vidLink.trim();
      if (!/^https?:\/\//.test(video)) { toast('영상 링크를 https:// 로 시작하는 주소로 적어 주세요'); return; }
    } else {
      if (!vidFile && !vidRef) { toast('동영상 파일을 골라 주세요'); return; }
      video = vidFile ? await putBlob(vidFile) : vidRef!;
    }
    const posterId = poster ? (poster.file ? await putBlob(poster.file) : poster.ref) : undefined;
    const tags = parseTags(tagsText);
    if (isNew) {
      const p: VideoPost = {
        id: newId(), title: title.trim(), video, poster: posterId, desc, tags, category: category || undefined,
        date: new Date().toISOString(), author: user.nickname, authorId: user.id, visibility,
        ...secStamp(sec.id),
      };
      setPosts([p, ...posts]);
      toast('등록되었습니다');
      router.push(`/videos/${p.id}`);
    } else {
      setPosts(posts.map(x => (x.id === initial.id
        ? { ...x, title: title.trim(), video: video!, poster: posterId, desc, tags, category: category || undefined, visibility }
        : x)));
      toast('저장되었습니다');
      router.push(`/videos/${initial.id}`);
    }
  };

  const linkEmb = /^https?:\/\//.test(vidLink.trim()) ? videoEmbed(vidLink.trim()) : null;

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle href={tt.href}>{tt.title}</PageTitle>
        <EditableDesc k={isNew ? 'videos-write-desc' : 'videos-edit-desc'} def={isNew ? '영상 올리기 — 파일 하나 또는 링크' : '영상 글 수정'} />
      </div>
      <div className="write-grid">
        {/* 좌: 본문 */}
        <div className="panel" style={{ padding: 24 }}>
          <div className="form-row">
            <label className="k-label" style={{ width: 60 }}>제목</label>
            <KInput value={title} onChange={e => setTitle(e.target.value)} style={{ flex: 1 }} />
          </div>
          <label className="k-label">동영상</label>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <KRadio name="vmode" value="file" current={vidMode} onChange={() => setVidMode('file')} label="파일 올리기" />
            <KRadio name="vmode" value="link" current={vidMode} onChange={() => setVidMode('link')} label="링크 (유튜브 · 비메오 · 영상 파일 주소)" />
          </div>
          {vidMode === 'file' ? (
            <>
              <div className="upzone" onClick={() => document.getElementById('vdFile')?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); void pickVideo(e.dataTransfer.files); }}>
                <b style={{ display: 'block', marginBottom: 3 }}>
                  {vidFile ? `${vidFile.name} · ${fmtSize(vidFile.size)}` : vidRef ? '저장된 영상 — 바꾸려면 새 파일 선택' : '영상을 끌어다 놓거나 클릭해서 선택'}
                </b>
                mp4 · webm · mov 한 개{isServerMode() ? ' · 서버 한도 20MB (더 크면 링크로)' : ''}
              </div>
              <input id="vdFile" type="file" accept="video/*" style={{ display: 'none' }}
                onChange={e => { void pickVideo(e.target.files); e.target.value = ''; }} />
              {(vidUrl || savedVidUrl) && (
                <div className="vid-pv">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={vidUrl ?? savedVidUrl} controls playsInline preload="metadata" />
                </div>
              )}
            </>
          ) : (
            <>
              <KInput value={vidLink} onChange={e => setLink(e.target.value)}
                placeholder="https://youtu.be/… 또는 .mp4 / .mov 파일 주소" style={{ marginBottom: 10 }} />
              {linkEmb && (
                <div className="vid-pv">
                  {linkEmb.kind !== 'file'
                    ? <iframe src={linkEmb.url} title="preview" allow="encrypted-media; picture-in-picture" allowFullScreen />
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    : <video src={linkEmb.url} controls playsInline preload="metadata" />}
                </div>
              )}
            </>
          )}

          <label className="k-label">썸네일 (선택)</label>
          <div className="upzone" style={{ padding: '16px 20px' }} onClick={() => document.getElementById('vdPoster')?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); pickPoster(e.dataTransfer.files); }}>
            {poster ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
                <PosterPreview p={poster} />
                <span style={{ textAlign: 'left' }}>
                  <b style={{ display: 'block' }}>{poster.label}</b>
                  클릭해서 바꾸기 · <span className="lnk" style={{ color: 'var(--accent)' }}
                    onClick={e => { e.stopPropagation(); setPoster(null); }}>빼기</span>
                </span>
              </div>
            ) : (
              <>
                <b style={{ display: 'block', marginBottom: 3 }}>썸네일로 쓸 이미지 — 비우면 영상에서 한 장 뽑아 둡니다</b>
                목록과 재생 전 첫 화면에 쓰입니다
              </>
            )}
          </div>
          <input id="vdPoster" type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { pickPoster(e.target.files); e.target.value = ''; }} />

          <div style={{ marginTop: 14 }}>
            <label className="k-label">설명</label>
            <RichEditor value={desc} onChange={setDesc} placeholder="영상 설명을 작성하세요 (선택)" />
          </div>
        </div>

        {/* 우: 설정 */}
        <div>
          <div className="panel widget" style={{ marginBottom: 14 }}>
            <h4>설정</h4>
            <div className="form-row">
              <label className="k-label" style={{ width: 70 }}>태그</label>
              <KInput value={tagsText} onChange={e => setTagsText(e.target.value)} placeholder="쉼표로 구분" style={{ flex: 1 }} />
            </div>
            {/* 말머리 (커플홈) — 환경설정 「게시판」의 비디오 말머리. 하나도 없으면 칸을 두지 않는다 */}
            {(videoCats.length > 0 || category) && (
              <div className="form-row">
                <label className="k-label" style={{ width: 70 }}>말머리</label>
                <KSelect minWidth={120} value={category} onChange={setCategory}
                  options={[
                    { value: '', label: '말머리 없음' },
                    ...videoCats.map(c => ({ value: c.label, label: c.label })),
                    ...(category && !videoCats.some(c => c.label === category) ? [{ value: category, label: `${category} (목록에 없음)` }] : []),
                  ]} />
              </div>
            )}
            <div className="form-row">
              <label className="k-label" style={{ width: 70 }}>공개범위</label>
              <KSelect minWidth={120} value={visibility} onChange={v => setVisibility(v as Visibility)}
                options={[
                  { value: 'public', label: '전체공개' },
                  { value: 'member', label: '멤버공개' },
                  { value: 'private', label: '나만보기' },
                ]} />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-onbk" onClick={() => router.push(isNew ? tt.href : `/videos/${initial.id}`)}>CANCEL</button>
            <button className="btn btn-accent" onClick={post}>{isNew ? 'POST' : 'SAVE'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
