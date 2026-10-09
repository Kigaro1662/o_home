'use client';
// 자체 모달/확인창 (7장 — alert/confirm 대체)
// - 다른 창을 보다가 이 창을 클릭해 포커스가 돌아온 직후의 클릭으로는 닫히지 않음
// - dirty(수정사항 있음)일 때 바깥 클릭 시 경고 확인을 거쳐야 닫힘
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ open, title, desc, onClose, children, small, actions, dirty }: {
  open: boolean; title?: string; desc?: string; onClose: () => void;
  children?: React.ReactNode; small?: boolean; actions?: React.ReactNode;
  dirty?: boolean;    // true면 바깥 클릭으로 닫기 전에 경고 확인
}) {
  const [askClose, setAskClose] = useState(false);
  const lastFocus = useRef(0);

  useEffect(() => {
    const onFocus = () => { lastFocus.current = Date.now(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => { if (!open) setAskClose(false); }, [open]);

  if (!open) return null;

  const tryClose = () => {
    // 창 포커스 복귀 직후의 클릭(다른 창 → 이 창 이동)은 닫기로 취급하지 않음
    if (Date.now() - lastFocus.current < 350) return;
    if (dirty) setAskClose(true);
    else onClose();
  };

  // body 포털 — 조상의 transform/animation이 fixed 기준을 바꿔 모달이 밀리는 문제 방지
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-ov" onMouseDown={e => { if (e.target === e.currentTarget) tryClose(); }}>
      <div className={`mng-box ${small ? 'sm' : ''}`}>
        {title && <h3>{title}</h3>}
        {desc && <p className="d">{desc}</p>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>

      {/* 수정사항 경고 (중첩 확인) */}
      {askClose && (
        <div className="modal-ov" style={{ zIndex: 96 }}
          onMouseDown={e => { if (e.target === e.currentTarget) setAskClose(false); }}>
          <div className="mng-box sm">
            <h3>변경사항이 저장되지 않았습니다</h3>
            <p className="d">이대로 닫으면 입력한 내용이 사라집니다.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setAskClose(false); onClose(); }}>저장하지 않고 닫기</button>
              <button className="btn btn-dark" onClick={() => setAskClose(false)}>계속 편집</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** 확인 모달 — [확인/취소] 또는 커스텀 버튼 구성. wide: 버튼이 많을 때 넓은 창(600px) */
export function ConfirmModal({ open, title, body, buttons, onClose, wide }: {
  open: boolean; title: string; body?: React.ReactNode;
  buttons: { label: string; kind?: 'dark' | 'ghost' | 'accent'; onClick: () => void }[];
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose} small={!wide}
      actions={buttons.map(b => (
        <button key={b.label} className={`btn btn-${b.kind ?? 'ghost'}`} onClick={b.onClick}>{b.label}</button>
      ))}>
      {body && <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--sub)' }}>{body}</div>}
    </Modal>
  );
}

/** 삭제 확인 훅 — 즉시 삭제되는 버튼에 경고 모달을 간단히 붙임.
 *  const del = useConfirmDelete();  → 버튼에서 del.ask('제목', () => 실제 삭제, '본문?');  렌더에 {del.element} */
export function useConfirmDelete() {
  const [req, setReq] = useState<{ title: string; body?: React.ReactNode; onYes: () => void; label?: string } | null>(null);
  // label — 삭제가 아닌 동작(건너뛰기 등)에서 확인 버튼 문구를 바꾸고 싶을 때
  const ask = (title: string, onYes: () => void, body?: React.ReactNode, label?: string) =>
    setReq({ title, onYes, body, label });
  const element = (
    <ConfirmModal open={req !== null} title={req?.title ?? ''}
      body={req?.body ?? '삭제하면 복구할 수 없습니다.'}
      onClose={() => setReq(null)}
      buttons={[
        { label: req?.label ?? 'DELETE', kind: 'accent', onClick: () => { req?.onYes(); setReq(null); } },
        { label: 'CANCEL', kind: 'ghost', onClick: () => setReq(null) },
      ]} />
  );
  return { ask, element };
}
