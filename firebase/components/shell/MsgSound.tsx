'use client';
// 알림음 (커플홈 사용자 요청) — 사이트 어느 페이지에 있든 짧게 울린다.
//  · 역극: 내가 참여한 방에 남이 새 발화를 남기면 (발화 행 자체를 보고 — 실시간이라 가장 빠르다)
//  · 그 밖의 알림(댓글·타래·메모·일기…): 내 앞으로 새 안 읽은 알림이 쌓이면 ("다른 페이지에 있을 때 알림이 오는 것도 알림음")
//    역극 알림('rp')은 여기서 **뺀다** — 발화에서 이미 울렸으므로 두 번 울리지 않게 (사용자 주의 사항)
// 레이아웃에 상주한다. 처음 받은 목록은 「이미 있던 것」으로 두고, 그 뒤에 새로 나타난 것에만 울린다
import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useLocalList } from '@/lib/postStore';
import { RpRoom, RP_SEED, RpMessageRow, RP_MSG_KEY, RP_MSG_SEED, rpMemberIds } from '@/lib/rpStore';
import { Character, CHAR_SEED, Relation, REL_SEED } from '@/lib/charStore';
import { armMsgSound, playMsgTone } from '@/lib/msgSound';
import { readNotifs, NOTIF_EVENT } from '@/lib/notifStore';

/** 접속 직후 몇 초는 울리지 않는다 — 서버에 쌓여 있던 알림을 처음 받아 오는 순간(syncNotifs)에 묵은 알림으로 울리지 않게 */
const QUIET_AFTER_MOUNT_MS = 8000;

export function MsgSound() {
  const { user } = useAuth();
  const [rows, , loaded] = useLocalList<RpMessageRow>(RP_MSG_KEY, RP_MSG_SEED);
  const [rooms] = useLocalList<RpRoom>('ohome.rp.v1', RP_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => { armMsgSound(); }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!seen.current) { seen.current = new Set(rows.map(r => r.id)); return; }
    const fresh = rows.filter(r => !seen.current!.has(r.id));
    if (!fresh.length) return;
    fresh.forEach(r => seen.current!.add(r.id));
    if (!user) return;
    // 내 발화는 빼고, 내가 참여한 방의 것만 (참여자 판정은 역극 페이지와 같은 rpMemberIds)
    const ding = fresh.some(r => {
      if (r.authorId === user.id) return false;
      const room = rooms.find(x => x.id === r.roomId);
      return !!room && rpMemberIds(room, rels, chars).includes(user.id);
    });
    if (ding) playMsgTone();
  }, [rows, loaded, user, rooms, rels, chars]);

  // 알림 — 내 앞으로 새로 쌓인 안 읽은 알림 (역극 제외). 발생 지점(같은 탭)·서버 받아 오기(syncNotifs)·다른 탭 모두 NOTIF_EVENT/storage로 온다
  const seenNotif = useRef<Set<string> | null>(null);
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    seenNotif.current = null;   // 사용자가 바뀌면 처음부터
    const check = () => {
      const mine = user ? readNotifs().filter(n => n.toUserId === user.id) : [];
      if (!seenNotif.current) { seenNotif.current = new Set(mine.map(n => n.id)); return; }
      const fresh = mine.filter(n => !seenNotif.current!.has(n.id));
      if (!fresh.length) return;
      fresh.forEach(n => seenNotif.current!.add(n.id));
      if (Date.now() - mountedAt.current < QUIET_AFTER_MOUNT_MS) return;
      if (fresh.some(n => !n.read && n.type !== 'rp')) playMsgTone();
    };
    check();
    window.addEventListener(NOTIF_EVENT, check);
    window.addEventListener('storage', check);
    return () => { window.removeEventListener(NOTIF_EVENT, check); window.removeEventListener('storage', check); };
  }, [user]);

  return null;
}
