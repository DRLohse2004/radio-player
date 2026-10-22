import { useEffect, useRef, useState } from 'react';
import { api, isDesktop } from '../api';
import { useDragSort } from '../hooks';
import type { YouTubeState } from '../youtube';
import type { Wish, YouTubeEntry, YouTubeItem } from '../types';
import { CheckIcon, CloseIcon, EditIcon, GripIcon, PlusIcon, TrashIcon, YouTubeIcon } from './Icons';

interface Props {
  items: YouTubeItem[];
  state: YouTubeState;
  entriesFor(itemId: string): YouTubeEntry[] | null;
  wishes: Wish[];
  onRemoveWish(id: string): void;
  onMoveWish(id: string, toIndex: number): void;
  onStartWishes(): void;
  onPlay(item: YouTubeItem, index?: number): void;
  onAdd(url: string): Promise<void>;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  onMove(id: string, toIndex: number): void;
  onClose(): void;
}

function formatDuration(seconds: number) {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

function subtitle(item: YouTubeItem) {
  const parts = [
    item.kind === 'playlist' ? `Playlist${item.count ? ` · ${item.count} Titel` : ''}` : item.kind === 'live' ? 'Livestream' : 'Video',
  ];
  if (item.channel) parts.push(item.channel);
  return parts.join(' · ');
}

export function YouTubeSidebar({ items, state, entriesFor, wishes, onRemoveWish, onMoveWish, onStartWishes, onPlay, onAdd, onRename, onDelete, onMove, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const wishDrag = useDragSort(wishes.length, onMoveWish);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const currentRef = useRef<HTMLLIElement>(null);

  const now = state.now;
  const currentEntryId = now?.entries[now.index]?.id;

  useEffect(() => {
    if (isDesktop) api.youtubeVersion().then(setVersion).catch(() => {});
  }, []);

  // laufenden Playlist-Titel sichtbar halten
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentEntryId]);

  const submit = async () => {
    const value = url.trim();
    if (!value || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAdd(value);
      setUrl('');
    } catch (err) {
      setAddError(String((err as Error).message || err));
    } finally {
      setAdding(false);
    }
  };

  const update = async () => {
    setUpdating('Aktualisiere …');
    try {
      const result = await api.youtubeUpdate();
      setVersion(result.version);
      setUpdating(result.output);
    } catch (err) {
      setUpdating(`Fehlgeschlagen: ${String((err as Error).message || err)}`);
    }
  };

  const endDrag = () => {
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand youtube">
          <YouTubeIcon size={22} />
          <span>YouTube</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Seitenleiste ausblenden">
          <CloseIcon size={18} />
        </button>
      </header>

      <form
        className="yt-add"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="YouTube-Link einfügen …"
          disabled={!isDesktop || adding}
          spellCheck={false}
        />
        <button className="icon-button accent" type="submit" disabled={!url.trim() || adding} title="Hinzufügen">
          {adding ? <span className="spinner" /> : <PlusIcon size={18} />}
        </button>
      </form>
      {adding && <p className="yt-add-hint">Lade Infos von YouTube …</p>}
      {addError && <p className="yt-add-hint error-text">{addError}</p>}

      {wishes.length > 0 && (
        <div className="yt-wishes">
          <div className="sidebar-label flush yt-wishes-head">
            <span>Wünsche ({wishes.length})</span>
            {!state.now?.item.wishedBy && (
              <button className="mini" onClick={onStartWishes} title="Wunschliste jetzt abspielen">
                Jetzt spielen
              </button>
            )}
          </div>
          <ol className="yt-queue wish-list">
            {wishes.map((wish, i) => (
              <li key={wish.id} {...wishDrag(wish.id, i)}>
                <div className="wish-row">
                  <span className="drag-handle" title="Ziehen zum Sortieren">
                    <GripIcon size={12} />
                  </span>
                  <span className="yt-queue-no">{i + 1}</span>
                  <span className="yt-queue-title" title={wish.title}>
                    {wish.title}
                    <small>
                      {wish.by}
                      {wish.count !== undefined && ` · Playlist, ${wish.count} Songs`}
                    </small>
                  </span>
                  <button className="icon-button tiny" onClick={() => onRemoveWish(wish.id)} title="Wunsch entfernen">
                    <CloseIcon size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="sidebar-label">Gespeichert</div>

      {items.length === 0 ? (
        <div className="empty-list">
          <p>Noch nichts gespeichert.</p>
          <p className="muted small">
            Link zu einem Video, einer Playlist oder einem Livestream oben einfügen – z. B. aus der Adresszeile des
            Browsers oder über „Teilen → Link kopieren“.
          </p>
        </div>
      ) : (
        <ul className="station-list yt-list">
          {items.map((item, index) => {
            const active = now?.item.id === item.id;
            const confirming = confirmId === item.id;
            const entries = active && item.kind === 'playlist' ? now?.entries ?? entriesFor(item.id) : null;
            const classes = ['station-item', 'yt-item'];
            if (active) classes.push('active');
            if (dragId === item.id) classes.push('dragging');
            if (dragId && dropIndex === index) classes.push('drop-before');
            if (dragId && dropIndex === index + 1 && index === items.length - 1) classes.push('drop-after');
            return (
              <li
                key={item.id}
                className={classes.join(' ')}
                draggable={!confirming && renaming?.id !== item.id}
                onDragStart={(e) => {
                  setDragId(item.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', item.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dropIndex !== null) onMove(dragId, dropIndex);
                  endDrag();
                }}
                onDragEnd={endDrag}
              >
                <div className="yt-row">
                  {renaming?.id === item.id ? (
                    <form
                      className="yt-rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (renaming.title.trim()) onRename(item.id, renaming.title.trim());
                        setRenaming(null);
                      }}
                    >
                      <input
                        autoFocus
                        value={renaming.title}
                        onChange={(e) => setRenaming({ id: item.id, title: e.target.value })}
                        onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                      />
                      <button className="icon-button" type="submit" title="Übernehmen">
                        <CheckIcon size={16} />
                      </button>
                    </form>
                  ) : (
                    <button className="station-select" onClick={() => onPlay(item)} title={item.url}>
                      <span className="yt-thumb">
                        {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <YouTubeIcon size={20} />}
                        {item.kind === 'live' && <span className="yt-live">LIVE</span>}
                      </span>
                      <span className="yt-text">
                        <span className="station-name">{item.title}</span>
                        <span className="yt-sub">{subtitle(item)}</span>
                      </span>
                      {active && state.status === 'playing' && (
                        <span className="eq" aria-label="Läuft">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                      {state.loadingList === item.id && <span className="spinner" />}
                    </button>
                  )}

                  {confirming ? (
                    <div className="confirm">
                      <span>Löschen?</span>
                      <button
                        className="mini danger"
                        onClick={() => {
                          onDelete(item.id);
                          setConfirmId(null);
                        }}
                      >
                        Ja
                      </button>
                      <button className="mini" onClick={() => setConfirmId(null)}>
                        Nein
                      </button>
                    </div>
                  ) : (
                    renaming?.id !== item.id && (
                      <div className="station-actions">
                        <button
                          className="icon-button"
                          onClick={() => setRenaming({ id: item.id, title: item.title })}
                          title="Umbenennen"
                        >
                          <EditIcon size={16} />
                        </button>
                        <button className="icon-button" onClick={() => setConfirmId(item.id)} title="Löschen">
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    )
                  )}
                </div>

                {entries && entries.length > 0 && (
                  <ol className="yt-queue">
                    {entries.map((entry, i) => {
                      const current = entry.id === currentEntryId && i === now?.index;
                      return (
                        <li key={`${entry.id}-${i}`} ref={current ? currentRef : undefined} className={current ? 'current' : ''}>
                          <button onClick={() => onPlay(item, i)} title={entry.title}>
                            <span className="yt-queue-no">{current && state.status === 'playing' ? '▶' : i + 1}</span>
                            <span className="yt-queue-title">{entry.title}</span>
                            <span className="yt-queue-time">{formatDuration(entry.duration)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="sidebar-footer yt-footer">
        <button className="link-button" onClick={update} disabled={!isDesktop || updating === 'Aktualisiere …'}>
          YouTube-Modul aktualisieren
        </button>
        <span className="muted small">
          {updating ?? (version ? `yt-dlp ${version}` : '')}
          {updating && updating !== 'Aktualisiere …' && (
            <button className="icon-button tiny" onClick={() => setUpdating(null)} title="Ausblenden">
              <CloseIcon size={12} />
            </button>
          )}
        </span>
      </div>
    </aside>
  );
}
