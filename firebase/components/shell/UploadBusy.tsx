'use client';
// 이미지 올리는 중 표시 (v2.0 사용자 발견) — 파이어베이스 업로드가 느릴 때 화면에 아무 반응이 없어
// 사용자가 업로드를 다시 누르게 되고, 같은 이미지가 여러 장 올라가던 문제.
// 중복 자체는 blobStore가 내용 해시로 막고, 여기서는 「지금 올라가는 중」임을 보여 준다.
import React from 'react';
import { useUploading } from '@/lib/blobStore';

export function UploadBusy() {
  const n = useUploading();
  if (n <= 0) return null;
  return (
    <div className="up-busy" role="status" aria-live="polite">
      <span className="up-spin" />
      이미지 올리는 중{n > 1 ? ` (${n}장)` : ''} — 잠시만 기다려 주세요
    </div>
  );
}
