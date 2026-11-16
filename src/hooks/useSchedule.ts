// Zeitplan: prüft alle 15 Sekunden, ob gerade die Ein- oder Ausschaltminute ist.
import { useEffect, useRef } from 'react';
import { scheduleAction, type Schedule } from '../schedule';

const CHECK_INTERVAL_MS = 15_000;

export function useSchedule(schedule: Schedule, handlers: { onStart: () => void; onStop: () => void }) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const lastKeyRef = useRef('');

  useEffect(() => {
    if (!schedule.enabled) return;
    const check = () => {
      const due = scheduleAction(schedule, new Date());
      if (!due || lastKeyRef.current === due.key) return;
      lastKeyRef.current = due.key;
      if (due.action === 'start') handlersRef.current.onStart();
      else handlersRef.current.onStop();
    };
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [schedule]);
}
