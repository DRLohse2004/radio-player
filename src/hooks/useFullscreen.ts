// Vollbild: Fenster umschalten; im Browser kann man es auch selbst verlassen.
import { useEffect, useState } from 'react';
import { api, isDesktop } from '../api';

export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    api.setFullScreen(fullscreen).catch(() => {});
  }, [fullscreen]);

  useEffect(() => {
    const onChange = () => !document.fullscreenElement && !isDesktop && setFullscreen(false);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return [fullscreen, setFullscreen] as const;
}
