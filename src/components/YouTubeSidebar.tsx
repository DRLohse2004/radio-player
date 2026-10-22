import { useEffect, useState, type ReactNode } from 'react';
import { api, isDesktop } from '../api';
import { watchUrl } from '../queue';
import type { YouTubeItem, YouTubeResult } from '../types';
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, SearchIcon, TrashIcon, YouTubeIcon } from './Icons';

/** Was der Betrachter darf – am Host alles, im Room je nach Admin-Anmeldung und Regeln des Hosts */
export interface YouTubeRights {
  /** gespeicherte Einträge hinzufügen, umbenennen, löschen, sortieren */
  edit: boolean;
  /** gespeicherten Eintrag sofort spielen (ganz oben in die Queue) */
  play: boolean;
}

interface Props {
  items: YouTubeItem[];
  rights: YouTubeRights;
  search(query: string): Promise<YouTubeResult[]>;
  loadPlaylist(id: string): Promise<YouTubeResult[]>;
  /** Suchtreffer hinten an die Queue (whole = ganze Playlist) */
  onWish(result: YouTubeResult, whole: boolean): Promise<void>;
  /** Link unter „Gespeichert“ ablegen */
  onSave(url: string): Promise<void>;
  onPlay(item: YouTubeItem): void;
  onQueue(item: YouTubeItem): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  onMove(id: string, toIndex: number): void;
  onClose(): void;
  /** z. B. die Reiter des Rooms unter der Kopfzeile */
  children?: ReactNode;
  footer?: ReactNode;
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

const resultUrl = (r: YouTubeResult) => (r.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${r.id}` : watchUrl(r.id));

export function YouTubeSidebar(props: Props) {
  const { items, rights } = props;
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 5000);
    return () => window.clearTimeout(timer);
  }, [note]);
  const onMessage = (text: string, error = false) => setNote({ text, error });
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<YouTubeResult[] | null>(null);
  const [open, setOpen] = useState<{ id: string; songs: YouTubeResult[] | null } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const fail = (err: unknown) => onMessage(String((err as Error).message || err), true);
  const submit = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setOpen(null);
    try {
      setResults(await props.search(q));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const wish = (r: YouTubeResult, whole = false) =>
    props.onWish(r, whole).then(() => onMessage(`„${r.title}“ ist in der Queue.`), fail);
  const save = (r: YouTubeResult) => props.onSave(resultUrl(r)).then(() => onMessage(`„${r.title}“ ist gespeichert.`), fail);
  const toggleOpen = (id: string) => {
    if (open?.id === id) return setOpen(null);
    setOpen({ id, songs: null });
    props
      .loadPlaylist(id)
      .then((songs) => setOpen((o) => (o?.id === id ? { id, songs } : o)))
      .catch((err) => {
        setOpen(null);
        fail(err);
      });
  };
  const endDrag = () => {
    setDragId(null);
    setDropIndex(null);
  };

  const resultRow = (r: YouTubeResult, small = false) => (
    <li key={r.id} className="station-item yt-result">
      <button
        className="station-select"
        disabled={r.live}
        onClick={() => (r.kind === 'playlist' ? toggleOpen(r.id) : wish(r))}
        title={r.kind === 'playlist' ? 'Songs zeigen' : 'Hinten an die Queue'}
      >
        {!small && <span className="room-thumb">{r.thumbnail && <img src={r.thumbnail} alt="" />}</span>}
        <span className="station-name">
          {r.title}
          <small>
            {r.kind === 'playlist'
              ? `${open?.id === r.id ? '▾' : '▸'} Playlist${r.channel ? ` · ${r.channel}` : ''}`
              : r.live
                ? 'Livestream'
                : formatDuration(r.duration)}
          </small>
        </span>
      </button>
      {r.kind === 'playlist' ? (
        <button className="mini" onClick={() => wish(r, true)} title="Ganze Playlist hinten an die Queue">
          Alle
        </button>
      ) : (
        !r.live && (
          <button className="icon-button" onClick={() => wish(r)} title="Hinten an die Queue">
            <PlusIcon size={16} />
          </button>
        )
      )}
      {rights.edit && !small && (
        <button className="icon-button" onClick={() => save(r)} title="Unter „Gespeichert“ ablegen">
          <CheckIcon size={16} />
        </button>
      )}
    </li>
  );

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand youtube">
          <YouTubeIcon size={22} />
          <span>YouTube</span>
        </div>
        <button className="icon-button" onClick={props.onClose} title="Seitenleiste ausblenden">
          <CloseIcon size={18} />
        </button>
      </header>
      {props.children}

      <form
        className="yt-add"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen oder YouTube-Link …" spellCheck={false} />
        <button className="icon-button accent" type="submit" disabled={!query.trim() || busy} title="Suchen">
          {busy ? <span className="spinner" /> : <SearchIcon size={16} />}
        </button>
      </form>

      {note && <p className={`yt-add-hint${note.error ? ' error-text' : ''}`}>{note.text}</p>}

      <div className="sidebar-scroll">
        {results && (
          <div className="yt-results">
            <div className="sidebar-label flush yt-wishes-head">
              <span>Suchergebnisse</span>
              <button className="mini" onClick={() => setResults(null)}>
                Schließen
              </button>
            </div>
            {results.length === 0 && <p className="side-note">Nichts gefunden.</p>}
            <ul className="station-list flush">
              {results.map((r) => (
                <div key={r.id}>
                  {resultRow(r)}
                  {open?.id === r.id && (
                    <ul className="station-list flush yt-result-songs">
                      {!open.songs && <p className="side-note">Lade Songs …</p>}
                      {open.songs?.map((song) => resultRow(song, true))}
                    </ul>
                  )}
                </div>
              ))}
            </ul>
          </div>
        )}

        <div className="sidebar-label">Gespeichert</div>
        {items.length === 0 ? (
          <div className="empty-list">
            <p>Noch nichts gespeichert.</p>
            {rights.edit && <p className="muted small">Oben suchen oder einen Link einfügen und beim Treffer auf ✓ klicken.</p>}
          </div>
        ) : (
          <ul className="station-list yt-list">
            {items.map((item, index) => {
              const confirming = confirmId === item.id;
              const classes = ['station-item', 'yt-item'];
              if (dragId === item.id) classes.push('dragging');
              if (dragId && dropIndex === index) classes.push('drop-before');
              if (dragId && dropIndex === index + 1 && index === items.length - 1) classes.push('drop-after');
              return (
                <li
                  key={item.id}
                  className={classes.join(' ')}
                  draggable={rights.edit && !confirming && renaming?.id !== item.id}
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
                    if (dragId && dropIndex !== null) props.onMove(dragId, dropIndex);
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
                          if (renaming.title.trim()) props.onRename(item.id, renaming.title.trim());
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
                      <button
                        className="station-select"
                        disabled={!rights.play}
                        onClick={() => props.onPlay(item)}
                        title="Jetzt spielen (ganz oben in die Queue)"
                      >
                        <span className="yt-thumb">
                          {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <YouTubeIcon size={20} />}
                          {item.kind === 'live' && <span className="yt-live">LIVE</span>}
                        </span>
                        <span className="yt-text">
                          <span className="station-name">{item.title}</span>
                          <span className="yt-sub">{subtitle(item)}</span>
                        </span>
                      </button>
                    )}

                    {confirming ? (
                      <div className="confirm">
                        <span>Löschen?</span>
                        <button
                          className="mini danger"
                          onClick={() => {
                            props.onDelete(item.id);
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
                          {item.kind !== 'live' && (
                            <button className="icon-button" onClick={() => props.onQueue(item)} title="Hinten an die Queue">
                              <PlusIcon size={16} />
                            </button>
                          )}
                          {rights.edit && (
                            <>
                              <button className="icon-button" onClick={() => setRenaming({ id: item.id, title: item.title })} title="Umbenennen">
                                <EditIcon size={16} />
                              </button>
                              <button className="icon-button" onClick={() => setConfirmId(item.id)} title="Löschen">
                                <TrashIcon size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {props.footer}
    </aside>
  );
}

/** Unten in der YouTube-Leiste am Host: yt-dlp aktualisieren */
export function YtDlpFooter() {
  const [version, setVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  useEffect(() => {
    if (isDesktop) api.youtubeVersion().then(setVersion).catch(() => {});
  }, []);
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
  return (
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
  );
}
