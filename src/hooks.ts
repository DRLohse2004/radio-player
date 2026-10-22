import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Weather } from './types';

/** Aktuelle Zeit, springt pünktlich zur vollen Sekunde um. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = window.setTimeout(function tick() {
      setNow(new Date());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    }, 1000 - (Date.now() % 1000));
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

/** true nach `delay` ms ohne Maus/Tastatur. */
export function useIdle(delay: number) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<number>();
  useEffect(() => {
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setIdle(true), delay);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      window.clearTimeout(timer.current);
    };
  }, [delay]);
  return idle;
}

/** Wetter für einen Ort, alle 15 Minuten aktualisiert. */
export function useWeather(city: string) {
  const [weather, setWeather] = useState<Weather | null>(null);
  useEffect(() => {
    if (!city.trim()) {
      setWeather(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      api.getWeather(city).then((w) => {
        if (!cancelled) setWeather(w);
      });
    load();
    const timer = window.setInterval(load, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [city]);
  return weather;
}

/** Wechselt alle `minutes` Minuten zwischen false/true (0 = nie). */
export function useAlternating(minutes: number) {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!minutes) {
      setValue(false);
      return;
    }
    const timer = window.setInterval(() => setValue((v) => !v), minutes * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [minutes]);
  return value;
}

/** Zufälliger kleiner Versatz (Pixel-Shift gegen Einbrennen), neu jede Minute. */
export function usePixelShift(range: number, intervalMs = 60_000) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const timer = window.setInterval(() => {
      setOffset({
        x: Math.round((Math.random() * 2 - 1) * range),
        y: Math.round((Math.random() * 2 - 1) * range),
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [range, intervalMs]);
  return offset;
}

/** Ziehen zum Sortieren wie in der Senderliste: liefert die Eigenschaften je Listeneintrag.
 *  onMove bekommt den Platz in der alten Liste, vor den der Eintrag kommt. */
export function useDragSort(count: number, onMove: (id: string, toIndex: number) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const end = () => {
    setDragId(null);
    setDropIndex(null);
  };
  return (id: string, index: number) => ({
    draggable: true,
    className: [
      dragId === id && 'dragging',
      dragId && dropIndex === index && 'drop-before',
      dragId && dropIndex === index + 1 && index === count - 1 && 'drop-after',
    ]
      .filter(Boolean)
      .join(' '),
    onDragStart: (e: React.DragEvent) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragId && dropIndex !== null) onMove(dragId, dropIndex);
      end();
    },
    onDragEnd: end,
  });
}
