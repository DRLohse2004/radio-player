// Tastendrücke im ganzen Fenster. Der Handler darf sich bei jedem Render ändern (sieht so immer den
// aktuellen Zustand), angemeldet wird nur einmal.
import { useEffect, useRef } from 'react';

export function useWindowKeys(handler: (e: KeyboardEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
