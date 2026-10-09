'use client';
// 자관 등록 페이지 (4.5) — 상대 캐릭터는 등록 후 상세에서 추가
import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId } from '@/lib/postStore';
import { Character, CHAR_SEED, Relation, REL_SEED, RelMember, relMenuHref, isRelMenuHref } from '@/lib/charStore';
import { useMenuSettings, insertAfterInTree, defaultTree } from '@/lib/menuStore';
import { RelForm } from '@/components/rels/RelForm';
import { useToast } from '@/components/ui/Toast';
import { PageTitle, EditableDesc } from '@/components/ui/PageText';

export default function RelNewPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rels, setRels, loaded] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [ms, patchMenu] = useMenuSettings();   // 새 자관을 메뉴에 넣기 위해
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);

  if (!loaded) return <section className="page" />;
  if (!isAdmin) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle>ADD RELATION</PageTitle><p>관리자 전용</p></div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle>ADD RELATION</PageTitle>
        <EditableDesc k="rels-new-desc" def="자관 등록 — 상대 캐릭터는 페이지를 만든 뒤 상세에서 추가할 수 있습니다" />
      </div>
      <RelForm
        initial={null}
        myChars={chars.filter(c => c.own)}
        existingIds={rels.flatMap(r => [r.id, ...(r.slug ? [r.slug] : [])])}
        onCancel={() => router.push('/rels')}
        onNewChar={() => router.push('/chars/new?next=/rels/new')}
        onSave={v => {
          // 팔레트는 캐릭터 쪽을 상세에서 그대로 읽는다 — 여기서 복사해 두면 나중에 캐릭터 색을
          // 바꿔도 자관이 따라오지 않는다 (v2.0 — 상세 페이지와 같은 규칙으로 통일)
          const members: RelMember[] = v.pickedCharIds.map(cid =>
            ({ charId: cid, quote: '', keywords: [], desc: '', palette: [] }));
          const rel: Relation = {
            id: v.slug ?? newId(),   // 지정한 페이지 주소 (v1.9) — 비우면 자동
            name: v.name, catchphrase: v.catchphrase, kind: v.kind,
            fontId: v.fontId, bodyFontId: v.bodyFontId, visibility: v.visibility,
            titleSize: v.titleSize, titleBold: v.titleBold, cpText: v.cpText,
            arts: v.arts, thumbId: v.arts[0], thumbCrop: v.thumbCrop,
            headerImgId: v.headerImgId, headerCrop: v.headerCrop, headerBlur: v.headerBlur,
            themeMode: v.themeMode, themeColor: v.themeColor, themeTone: v.themeTone,
            illuBg: v.illuBg, illuOn: v.illuOn,
            nameColor: v.nameColor, cpColor: v.cpColor, cpTagBg: v.cpTagBg, cpTagFg: v.cpTagFg,
            nameShadowColor: v.nameShadowColor, nameShadow: v.nameShadow,
            headerBgG1: v.headerBgG1, headerBgG2: v.headerBgG2, headerBgAngle: v.headerBgAngle,
            pageBgG1: v.pageBgG1, pageBgG2: v.pageBgG2, pageBgAngle: v.pageBgAngle,
            members, thumbClass: '',
            illustMode: v.kind === 'pair' ? 'duo' : 'one',
            aus: [{ id: 'base', label: '원본', catchphrase: v.catchphrase }],
            timeline: [], questions: [],
          };
          setRels([...rels, rel]);
          // 자관 페이지가 하나 더 생긴다 (커플홈 사용자 요청) — 메뉴의 자관 항목 뒤에 바로 넣는다.
          // 자관을 메뉴에서 빼 뒀으면 미배치에 머문다 (메뉴 관리에서 넣는다)
          const tree = insertAfterInTree(ms.tree ?? defaultTree(), isRelMenuHref, relMenuHref(rel.id), rel.name);
          if (tree) patchMenu({ tree });
          toast(tree ? '자관이 등록되고 메뉴에도 들어갔습니다 — 상대 캐릭터·한마디 등은 상세에서 이어서'
            : '자관이 등록되었습니다 — 메뉴에 넣으려면 환경설정 > 메뉴 관리의 미배치에서');
          router.push(`/rels/${rel.id}`);
        }}
      />
    </section>
  );
}
