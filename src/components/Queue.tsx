import { useState } from 'react';
import { useDragSort } from '../hooks';
import type { Wish, YouTubeEntry } from '../types';
import { CloseIcon, GripIcon } from './Icons';

interface Props {
  wishes: Wish[];
  /** Sortieren erlaubt (Host immer, sonst nur Admin) */
  canMove: boolean;
  canRemove(wish: Wish): boolean;
  onMove(id: string, toIndex: number): void;
  onRemove(id: string): void;
  /** Songs einer Playlist in der Queue – zum Aufklappen */
  loadEntries(wish: Wish): Promise<{ id: string; title: string; duration: number }[]>;
}

/** Die eine Queue für Wünsche, Suchtreffer und gespeicherte Einträge – am Host und im Room gleich */
export function Queue({ wishes, canMove, canRemove, onMove, onRemove, loadEntries }: Props) {
  const drag = useDragSort(wishes.length, onMove);
  const [open, setOpen] = useState<{ id: string; entries: Pick<YouTubeEntry, 'id' | 'title' | 'duration'>[] | null; error?: string } | null>(null);

  const toggle = (wish: Wish) => {
    if (open?.id === wish.id) return setOpen(null);
    setOpen({ id: wish.id, entries: null });
    loadEntries(wish)
      .then((entries) => setOpen((o) => (o?.id === wish.id ? { id: wish.id, entries } : o)))
      .catch((err: Error) => setOpen((o) => (o?.id === wish.id ? { id: wish.id, entries: [], error: err.message } : o)));
  };

  return (
    <ol className="yt-queue wish-list">
      {wishes.map((wish, i) => {
        const playlist = wish.count !== undefined;
        return (
          <li key={wish.id} {...(canMove ? drag(wish.id, i) : {})}>
            <div className="wish-row">
              {canMove && (
                <span className="drag-handle" title="Ziehen zum Sortieren">
                  <GripIcon size={12} />
                </span>
              )}
              <span className="yt-queue-no">{i + 1}</span>
              <span
                className={`yt-queue-title${playlist ? ' clickable' : ''}`}
                title={playlist ? 'Songs der Playlist zeigen' : wish.title}
                onClick={playlist ? () => toggle(wish) : undefined}
              >
                {wish.title}
                <small>
                  {wish.by}
                  {playlist && ` · ${open?.id === wish.id ? '▾' : '▸'} Playlist${wish.count ? `, ${wish.count} Songs` : ''}`}
                </small>
              </span>
              {canRemove(wish) && (
                <button className="icon-button tiny" onClick={() => onRemove(wish.id)} title="Aus der Queue entfernen">
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
            {open?.id === wish.id && (
              <ol className="queue-songs">
                {!open.entries && <li className="side-note">Lade Songs …</li>}
                {open.error && <li className="side-note error-text">{open.error}</li>}
                {open.entries?.map((e, n) => (
                  <li key={`${e.id}-${n}`}>
                    <span className="yt-queue-no">{n + 1}</span>
                    <span className="yt-queue-title">{e.title}</span>
                  </li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
