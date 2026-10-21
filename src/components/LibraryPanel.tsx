import { useState } from 'react';
import { api } from '../api';
import type { Track } from '../types';
import { CloseIcon, HeartIcon, MusicIcon, SearchIcon, TrashIcon } from './Icons';

interface Props {
  history: Track[];
  favorites: Track[];
  isFavorite(track: Pick<Track, 'artist' | 'title'>): boolean;
  onToggleFavorite(track: Track): void;
  onClearHistory(): void;
  onClose(): void;
}

const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });

function formatTime(iso: string) {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today ? timeFormat.format(date) : `${dayFormat.format(date)} ${timeFormat.format(date)}`;
}

function searchLinks(track: Track) {
  const query = encodeURIComponent(`${track.artist} ${track.title}`);
  return [
    { label: 'Spotify', url: `https://open.spotify.com/search/${query}` },
    { label: 'YouTube', url: `https://www.youtube.com/results?search_query=${query}` },
  ];
}

export function LibraryPanel({ history, favorites, isFavorite, onToggleFavorite, onClearHistory, onClose }: Props) {
  const [tab, setTab] = useState<'history' | 'favorites'>('history');
  const [openSearch, setOpenSearch] = useState<string | null>(null);
  const list = tab === 'history' ? history : favorites;

  return (
    <aside className="library">
      <header className="library-header">
        <div className="tabs">
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            Verlauf
          </button>
          <button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}>
            Gemerkt {favorites.length > 0 && <span className="count">{favorites.length}</span>}
          </button>
        </div>
        <button className="icon-button" onClick={onClose} title="Schließen">
          <CloseIcon size={18} />
        </button>
      </header>

      {list.length === 0 ? (
        <div className="library-empty">
          {tab === 'history'
            ? 'Hier erscheinen die zuletzt gespielten Songs.'
            : 'Merken Sie sich Songs mit dem Herz-Symbol – hier finden Sie sie wieder.'}
        </div>
      ) : (
        <ul className="track-list">
          {list.map((track) => {
            const favorite = isFavorite(track);
            return (
              <li key={track.id} className="track-row">
                <div className="track-thumb">
                  {track.cover ? <img src={track.cover} alt="" /> : <MusicIcon size={18} />}
                </div>
                <div className="track-meta">
                  <div className="track-row-title" title={track.title}>
                    {track.title}
                  </div>
                  <div className="track-row-artist" title={track.artist}>
                    {track.artist}
                  </div>
                  <div className="track-row-info">
                    {formatTime(track.time)} · {track.station}
                  </div>
                  {openSearch === track.id && (
                    <div className="track-links">
                      {searchLinks(track).map((link) => (
                        <button key={link.label} className="mini" onClick={() => api.openExternal(link.url)}>
                          {link.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="track-actions">
                  <button
                    className="icon-button"
                    title="Song suchen (Spotify / YouTube)"
                    onClick={() => setOpenSearch(openSearch === track.id ? null : track.id)}
                  >
                    <SearchIcon size={16} />
                  </button>
                  <button
                    className={`icon-button${favorite ? ' favorite' : ''}`}
                    title={favorite ? 'Nicht mehr merken' : 'Merken'}
                    onClick={() => onToggleFavorite(track)}
                  >
                    <HeartIcon size={16} filled={favorite} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'history' && history.length > 0 && (
        <footer className="library-footer">
          <button className="button" onClick={onClearHistory}>
            <TrashIcon size={15} /> Verlauf leeren
          </button>
        </footer>
      )}
    </aside>
  );
}
