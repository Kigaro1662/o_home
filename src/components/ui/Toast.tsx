'use client';
// 자체 토스트 (7장)
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

interface ToastItem { id: number; text: string }
const Ctx = createContext<(text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string) => {
    const id = ++seq.current;
    setItems(list => [...list, { id, text }]);
    setTimeout(() => setItems(list => list.filter(t => t.id !== id)), 2600);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toast-box">
        {items.map(t => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
