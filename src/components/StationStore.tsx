import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import {
  dedupe,
  displayName,
  GENRE_SERVER_TAG,
  genreRank,
  GENRES,
  matchesGenre,
  matchesQuery,
  normalizeUrl,
  OPERATORS,
  operatorLabel,
  operatorOf,
} from '../store';
import type { Station, StoreStation } from '../types';
import { CheckIcon, CloseIcon, PlusIcon, SearchIcon, StopIcon, PlayIcon } from './Icons';
import { StationLogo } from './StationLogo';

type Filter = { type: 'all' } | { type: 'genre'; id: string } | { type: 'operator'; id: string };

interface Props {
  stations: Station[];
  volume: number;
  onAdd(station: StoreStation, name: string): void;
  /** true, solange eine Hörprobe läuft (die App pausiert dann den Hauptplayer) */
  onPreviewChange(active: boolean): void;
  onClose(): void;
}

const PAGE_SIZE = 60;

export function StationStore({ stations, volume, onAdd, onPreviewChange, onClose }: Props) {
  const [scope, setScope] = useState<'de' | 'world'>('de');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<Filter>({ type: 'all' });
  const [results, setResults] = useState<StoreStation[] | null>(null);
  const [error, setError] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Deutschland: einmal laden, dann lokal filtern. Weltweit: Server-Suche je Suchbegriff/Genre.
  const genreTag = filter.type === 'genre' ? GENRE_SERVER_TAG[filter.id] : undefined;
  const serverQuery = scope === 'world' ? debouncedQuery : '';
  const serverTag = scope === 'world' ? genreTag : undefined;
  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setError(false);
    api
      .getStoreStations({ scope, query: serverQuery || undefined, tag: serverTag })
      .then((list) => {
        if (!cancelled) setResults(dedupe(list));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, serverQuery, serverTag]);

  // Hörprobe beim Schließen beenden
  useEffect(() => () => onPreviewChange(false), [onPreviewChange]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(volume, 0.15);
  }, [volume, previewId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => setLimit(PAGE_SIZE), [scope, debouncedQuery, filter]);

  const filtered = useMemo(() => {
    if (!results) return [];
    const list = results.filter((s) => {
      if (scope === 'de' && !matchesQuery(s, debouncedQuery)) return false;
      if (filter.type === 'genre' && !matchesGenre(s, filter.id)) return false;
      if (filter.type === 'operator' && operatorOf(s) !== filter.id) return false;
      return true;
    });
    // innerhalb eines Genres: passende Sender zuerst (stabile Sortierung behält die Beliebtheit bei)
    if (filter.type === 'genre') list.sort((a, b) => genreRank(a, filter.id) - genreRank(b, filter.id));
    return list;
  }, [results, scope, debouncedQuery, filter]);

  // Zähler für die Kategorien (bezogen auf die aktuelle Suche)
  const counts = useMemo(() => {
    const base = (results ?? []).filter((s) => scope === 'world' || matchesQuery(s, debouncedQuery));
    return {
      all: base.length,
      genres: Object.fromEntries(GENRES.map((g) => [g.id, base.filter((s) => matchesGenre(s, g.id)).length])),
      operators: Object.fromEntries(OPERATORS.map((o) => [o.id, base.filter((s) => operatorOf(s) === o.id).length])),
    };
  }, [results, scope, debouncedQuery]);

  const ownUrls = useMemo(() => new Set(stations.map((s) => normalizeUrl(s.url))), [stations]);
  const ownNames = useMemo(() => new Set(stations.map((s) => s.name.toLowerCase())), [stations]);
  const isAdded = (s: StoreStation) =>
    ownUrls.has(normalizeUrl(s.url)) || ownNames.has(displayName(s.name).toLowerCase());

  const togglePreview = (station: StoreStation) => {
    const audio = audioRef.current;
    if (!audio) return;
    setPreviewError(null);
    if (previewId === station.id) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setPreviewId(null);
      onPreviewChange(false);
      return;
    }
    onPreviewChange(true);
    setPreviewId(station.id);
    audio.src = station.url;
    audio.play().catch(() => {
      setPreviewError(station.id);
      setPreviewId(null);
      onPreviewChange(false);
    });
  };

  const filterLabel =
    filter.type === 'genre'
      ? GENRES.find((g) => g.id === filter.id)?.label
      : filter.type === 'operator'
        ? operatorLabel(filter.id)
        : null;

  const navButton = (active: boolean, label: string, count: number | undefined, onClick: () => void, key: string) => (
    <button key={key} className={`store-nav-item${active ? ' active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      {count !== undefined && <span className="store-count">{count}</span>}
    </button>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="store">
        <audio
          ref={audioRef}
          preload="none"
          onError={() => {
            if (previewId) {
              setPreviewError(previewId);
              setPreviewId(null);
              onPreviewChange(false);
            }
          }}
        />

        <header className="store-header">
          <h2>Sender-Store</h2>
          <div className="store-search">
            <SearchIcon size={18} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={scope === 'de' ? 'Sender, Genre oder Betreiber suchen …' : 'Weltweit nach Sendernamen suchen …'}
              spellCheck={false}
            />
          </div>
          <div className="segmented">
            <button className={scope === 'de' ? 'active' : ''} onClick={() => setScope('de')}>
              Deutschland
            </button>
            <button className={scope === 'world' ? 'active' : ''} onClick={() => setScope('world')}>
              Weltweit
            </button>
          </div>
          <button className="icon-button" onClick={onClose} title="Schließen (Esc)">
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="store-body">
          <nav className="store-nav">
            {navButton(filter.type === 'all', 'Alle Sender', counts.all, () => setFilter({ type: 'all' }), 'all')}
            <div className="store-nav-label">Genres</div>
            {GENRES.map((g) =>
              navButton(
                filter.type === 'genre' && filter.id === g.id,
                g.label,
                scope === 'de' ? counts.genres[g.id] : undefined,
                () => setFilter({ type: 'genre', id: g.id }),
                g.id,
              ),
            )}
            <div className="store-nav-label">Betreiber</div>
            {OPERATORS.filter((o) => scope === 'world' || counts.operators[o.id] > 0).map((o) =>
              navButton(
                filter.type === 'operator' && filter.id === o.id,
                o.label,
                counts.operators[o.id],
                () => setFilter({ type: 'operator', id: o.id }),
                o.id,
              ),
            )}
          </nav>

          <section className="store-results">
            {error ? (
              <div className="store-message">
                Die Senderdatenbank ist gerade nicht erreichbar. Bitte später erneut versuchen.
              </div>
            ) : !results ? (
              <div className="store-message">Lade Sender …</div>
            ) : filtered.length === 0 ? (
              <div className="store-message">Keine Sender gefunden.</div>
            ) : (
              <>
                <div className="store-summary">
                  {filtered.length} Sender
                  {filterLabel && ` · ${filterLabel}`}
                  {debouncedQuery && ` · „${debouncedQuery}“`}
                  {scope === 'de' ? ' · Deutschland' : ' · weltweit'}
                </div>
                <div className="store-grid">
                  {filtered.slice(0, limit).map((s) => {
                    const name = displayName(s.name);
                    const added = isAdded(s);
                    const playing = previewId === s.id;
                    const operator = operatorLabel(operatorOf(s));
                    const meta = [
                      operator ?? (scope === 'world' ? s.country : null),
                      s.codec && s.bitrate ? `${s.codec} ${s.bitrate} kbit/s` : s.codec,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <article key={s.id} className={`store-card${playing ? ' playing' : ''}`}>
                        <StationLogo station={{ name, logo: s.favicon ?? undefined }} className="medium" />
                        <div className="store-card-body">
                          <div className="store-card-name" title={s.name}>
                            {name}
                          </div>
                          <div className="store-card-meta">{meta}</div>
                          <div className="store-tags">
                            {s.tags.slice(0, 3).map((t) => (
                              <span key={t}>{t}</span>
                            ))}
                          </div>
                          {previewError === s.id && <div className="store-card-error">Stream nicht erreichbar</div>}
                        </div>
                        <div className="store-card-actions">
                          <button
                            className={`icon-button${playing ? ' active' : ''}`}
                            onClick={() => togglePreview(s)}
                            title={playing ? 'Hörprobe stoppen' : 'Reinhören'}
                          >
                            {playing ? <StopIcon size={16} /> : <PlayIcon size={16} />}
                          </button>
                          <button
                            className={`store-add${added ? ' added' : ''}`}
                            onClick={() => !added && onAdd(s, name)}
                            disabled={added}
                            title={added ? 'Bereits in Ihrer Senderliste' : 'Zur Senderliste hinzufügen'}
                          >
                            {added ? <CheckIcon size={15} /> : <PlusIcon size={15} />}
                            {added ? 'In Liste' : 'Hinzufügen'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {filtered.length > limit && (
                  <div className="store-more">
                    <button className="button" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                      Mehr anzeigen ({filtered.length - limit} weitere)
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="store-footer">
          Senderdaten: radio-browser.info (Community-Datenbank) · Betreiber werden anhand der Stream-Adresse
          zugeordnet
        </footer>
      </div>
    </div>
  );
}
