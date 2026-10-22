import { useState, type ReactNode } from 'react';
import { isPlaylist } from '../queue';
import type { Wish } from '../types';
import { CloseIcon, GripIcon, YouTubeIcon } from './Icons';

interface Props {
  wishes: Wish[];
  /** Karte für den laufenden obersten Eintrag – ohne sie ruht die Queue und Eintrag 1 ist eine normale Zeile */
  hero?: ReactNode;
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

export function formatDuration(seconds: number) {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** Die eine Queue: oben (als Karte) was läuft, darunter „Als Nächstes“. Ziehen sortiert – auch Songs aus Playlists heraus. */
export function Queue({ wishes, hero, canMove, canRemove, onMove, onRemove, onMoveSong }: Props) {
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
  const dropTarget = (i: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag) return;
      e.preventDefault();
      setDrop({ list: 'top', index: half(e, i) });
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (drag && drop?.list === 'top') {
        if (drag.song) onMoveSong(drag.wish, drag.song, drop.index, true);
        else onMove(drag.wish, drop.index);
      }
      end();
    },
  });

  const songList = (wish: Wish, playing: boolean) => {
    const songs = wish.entries ?? [];
    return (
      <ol className="q-songs">
        {songs.map((song, n) => (
          <li
            key={song.id}
            className={`q-song${playing && n === 0 ? ' current' : ''}${drag?.song === song.id ? ' dragging' : ''}${marker(wish.id, n, n === songs.length - 1)}`}
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
            <span className="q-song-no">{playing && n === 0 ? '▶' : n + 1}</span>
            <span className="q-song-title">{song.title}</span>
            <span className="q-time">{formatDuration(song.duration)}</span>
          </li>
        ))}
      </ol>
    );
  };

  const playlistToggle = (wish: Wish) => (
    <button className="q-badge" onClick={() => toggle(wish.id)} title={open.has(wish.id) ? 'Songs einklappen' : 'Songs zeigen'}>
      {open.has(wish.id) ? '▾' : '▸'} Playlist · {wish.entries ? `${wish.entries.length} Songs` : 'lädt …'}
    </button>
  );

  const rows = hero ? wishes.slice(1) : wishes;
  const offset = hero ? 1 : 0;

  return (
    <ol className="q-list">
      {hero && wishes[0] && (
        <li
          className={`q-now${drag?.wish === wishes[0].id && !drag.song ? ' dragging' : ''}${marker('top', 0, wishes.length === 1)}`}
          {...dragProps({ wish: wishes[0].id })}
          {...dropTarget(0)}
        >
          {hero}
          <div className="q-now-foot">
            {isPlaylist(wishes[0]) && playlistToggle(wishes[0])}
            <span className="q-by">{wishes[0].by}</span>
            {canRemove(wishes[0]) && (
              <button className="icon-button tiny" onClick={() => onRemove(wishes[0].id)} title="Aus der Queue entfernen – der nächste spielt">
                <CloseIcon size={12} />
              </button>
            )}
          </div>
          {open.has(wishes[0].id) && songList(wishes[0], true)}
        </li>
      )}
      {rows.length > 0 && <li className="q-heading">{hero ? 'Als Nächstes' : 'In der Queue'}</li>}
      {rows.map((wish, n) => {
        const i = n + offset;
        const playlist = isPlaylist(wish);
        const thumb = wish.thumbnail ?? wish.entries?.[0]?.thumbnail ?? null;
        return (
          <li
            key={wish.id}
            className={`q-item${drag?.wish === wish.id && !drag.song ? ' dragging' : ''}${marker('top', i, i === wishes.length - 1)}`}
            {...dragProps({ wish: wish.id })}
            {...dropTarget(i)}
          >
            <div className="q-row">
              {canMove && (
                <span className="q-grip" title="Ziehen zum Sortieren">
                  <GripIcon size={14} />
                </span>
              )}
              <span className="q-thumb">{thumb ? <img src={thumb} alt="" loading="lazy" /> : <YouTubeIcon size={18} />}</span>
              <span className="q-text">
                <span className="q-title" title={wish.title}>
                  {wish.title}
                </span>
                <span className="q-sub">
                  {playlist ? playlistToggle(wish) : wish.channel && <span>{wish.channel}</span>}
                  <span className="q-by">{wish.by}</span>
                </span>
              </span>
              <span className="q-time">{playlist ? '' : formatDuration(wish.duration)}</span>
              {canRemove(wish) && (
                <button className="icon-button tiny" onClick={() => onRemove(wish.id)} title="Aus der Queue entfernen">
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
            {open.has(wish.id) && songList(wish, false)}
          </li>
        );
      })}
    </ol>
  );
}
