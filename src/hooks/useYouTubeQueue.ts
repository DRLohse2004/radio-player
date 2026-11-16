// YouTube-Queue: Was oben steht, spielt. Rückt nach, lädt den nächsten Song vor und holt die Songs von Playlists.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { isPlaylist, nextTrack, topTrack } from '../queue';
import type { Wish, YouTubeEntry } from '../types';
import type { useYouTube } from '../youtube';

type YouTube = ReturnType<typeof useYouTube>;

interface QueueStore {
  wishes: Wish[];
  setEntries: (id: string, songs: YouTubeEntry[]) => void;
  removeWish: (id: string) => void;
}

export function useYouTubeQueue(yt: YouTube, store: QueueStore) {
  const queue = store.wishes;
  const track = topTrack(queue);
  const upcoming = nextTrack(queue);
  const ytNow = yt.state.now;
  const ytPlaying = yt.state.playing;
  const [queueWanted, setQueueWanted] = useState(false);

  /** Spielt der oberste Song gerade ('playing'), pausiert er ('paused') oder läuft etwas anderes (null)? */
  const queueNow = ytNow && track && ytNow.item.id === track.id ? (ytPlaying ? 'playing' : 'paused') : null;

  /** Play: den obersten Song fortsetzen bzw. starten */
  const startQueue = () => {
    if (ytNow && track && ytNow.item.id === track.id && !ytPlaying) yt.resume();
    else setQueueWanted(true);
  };

  // Oben hat sich etwas geändert: das Neue spielen (pausiert erst beim nächsten Play), Queue leer: aufhören
  useEffect(() => {
    if (!queueWanted && !ytNow) return;
    if (!queue.length) {
      if (ytNow) yt.stop();
      setQueueWanted(false);
      return;
    }
    if (!track || ytNow?.item.id === track.id) return;
    if (queueWanted || ytPlaying) {
      yt.play(track);
      setQueueWanted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueWanted, !!ytNow, ytPlaying, track?.id, queue.length]);

  useEffect(() => {
    if (upcoming && (ytNow || queueWanted)) yt.prefetch(upcoming.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming?.url]);

  // Playlists in der Queue: Songs laden (zum Spielen, Aufklappen und Verschieben)
  const missingSongs = queue.find((w) => isPlaylist(w) && !w.entries);
  useEffect(() => {
    if (!missingSongs) return;
    const url = missingSongs.url ?? `https://www.youtube.com/playlist?list=${missingSongs.videoId}`;
    api
      .youtubeInfo(url)
      .then((info) => store.setEntries(missingSongs.id, info.entries))
      .catch(() => store.removeWish(missingSongs.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingSongs?.id]);

  return {
    queue,
    queueNow,
    startQueue,
    /** Gleich spielen, was oben steht (z. B. nach „Jetzt wünschen“) */
    playTop: () => setQueueWanted(true),
  };
}
