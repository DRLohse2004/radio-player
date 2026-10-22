import { useState } from 'react';
import { isPlaylist } from '../queue';
import type { Wish } from '../types';
import { CloseIcon, GripIcon } from './Icons';

interface Props {
  wishes: Wish[];
  /** Was oben steht, läuft gerade (bzw. ist pausiert) – null: die Queue ruht */
  now: 'playing' | 'paused' | null;
  /** Sortieren erlaubt (Host immer, sonst nur Admin) */
  canMove: boolean;
  canRemove(wish: Wish): boolean;
  onMove(id: string, toIndex: number): void;
  onRemove(id: string): void;
  /** Song in seiner Playlist verschieben oder (out) als eigenen Eintrag an Platz toIndex der Queue */
  onMoveSong(wishId: string, songId: string, toIndex: number, out: boolean): void;
}

type Drag = { wish: string; song?: string };
type Drop = { list: string; index: number };

/** Die eine Queue – oben steht, was läuft. Ziehen sortiert, Songs lassen sich auch aus der Playlist ziehen. */
export function Queue({ wishes, now, canMove, canRemove, onMove, onRemove, onMoveSong }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const toggle = (id: string) =>
    setOpen((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const end = () => {
    setDrag(null);
    setDrop(null);
  };
  const half = (e: React.DragEvent, index: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? index : index + 1;
  };
  const dragProps = (value: Drag) =>
    canMove
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation();
            setDrag(value);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', value.song ?? value.wish);
          },
          onDragEnd: end,
        }
      : {};
  const marker = (list: string, index: number, last: boolean) =>
    drag && drop?.list === list ? (drop.index === index ? ' drop-before' : last && drop.index === index + 1 ? ' drop-after' : '') : '';

  return (
    <ol className="yt-queue wish-list">
      {wishes.map((wish, i) => {
        const playlist = isPlaylist(wish);
        const expanded = open.has(wish.id);
        const current = i === 0 && now;
        const songs = wish.entries ?? [];
        return (
          <li
            key={wish.id}
            className={`${current ? 'queue-current' : ''}${drag?.wish === wish.id && !drag.song ? ' dragging' : ''}${marker('top', i, i === wishes.length - 1)}`}
            {...dragProps({ wish: wish.id })}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              setDrop({ list: 'top', index: half(e, i) });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && drop?.list === 'top') {
                if (drag.song) onMoveSong(drag.wish, drag.song, drop.index, true);
                else onMove(drag.wish, drop.index);
              }
              end();
            }}
          >
            {current && <div className="queue-now-label">{now === 'playing' ? '▶ Läuft gerade' : '❚❚ Pausiert'}</div>}
            <div className="wish-row">
              {canMove && (
                <span className="drag-handle" title="Ziehen zum Sortieren">
                  <GripIcon size={12} />
                </span>
              )}
              <span className="yt-queue-no">{i + 1}</span>
              <span
                className={`yt-queue-title${playlist ? ' clickable' : ''}`}
                title={playlist ? (expanded ? 'Songs einklappen' : 'Songs zeigen') : wish.title}
                onClick={playlist ? () => toggle(wish.id) : undefined}
              >
                {wish.title}
                <small>
                  {wish.by}
                  {playlist && ` · ${expanded ? '▾' : '▸'} Playlist${wish.entries ? `, ${songs.length} Songs` : ' – lädt …'}`}
                  {current && playlist && songs[0] && !expanded && ` · ${songs[0].title}`}
                </small>
              </span>
              {canRemove(wish) && (
                <button className="icon-button tiny" onClick={() => onRemove(wish.id)} title="Aus der Queue entfernen">
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
            {expanded && (
              <ol className="queue-songs">
                {songs.map((song, n) => (
                  <li
                    key={song.id}
                    className={`${current && n === 0 ? 'current' : ''}${drag?.song === song.id ? ' dragging' : ''}${marker(wish.id, n, n === songs.length - 1)}`}
                    {...dragProps({ wish: wish.id, song: song.id })}
                    onDragOver={(e) => {
                      // Songs nur innerhalb ihrer Playlist – nach draußen geht es über die Einträge der Queue
                      if (drag?.song === undefined || drag.wish !== wish.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDrop({ list: wish.id, index: half(e, n) });
                    }}
                    onDrop={(e) => {
                      if (drag?.song === undefined || drag.wish !== wish.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (drop?.list === wish.id) onMoveSong(wish.id, drag.song, drop.index, false);
                      end();
                    }}
                  >
                    <span className="yt-queue-no">{current && n === 0 ? '▶' : n + 1}</span>
                    <span className="yt-queue-title">{song.title}</span>
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
