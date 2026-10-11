'use client';
import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
export function useControlUpdates(callback: () => void) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel('bughunt-control')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bh_control_signal' },
        () => {
          // Jitter avoids 500 refresh requests hitting the API in the same millisecond.
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => latest.current(), 200 + Math.random() * 800);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase!.removeChannel(channel);
    };
  }, []);
}
