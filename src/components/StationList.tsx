import { useState, type ReactNode } from 'react';
import type { PlayerStatus, Station } from '../types';
import { CloseIcon, EditIcon, GripIcon, PlusIcon, RadioIcon, StoreIcon, TrashIcon } from './Icons';
import { StationLogo } from './StationLogo';

interface Props {
  stations: Station[];
  currentId: string | null;
  status: PlayerStatus;
  onSelect(id: string): void;
  onAdd(): void;
  onEdit(station: Station): void;
  onDelete(id: string): void;
  /** Sender an Position toIndex verschieben (Index in der Liste vor dem Verschieben) */
  onMove(id: string, toIndex: number): void;
  onOpenStore(): void;
  onClose(): void;
  /** Room ohne Admin: Sender nur ansehen bzw. (canPlay) wählen */
  canEdit?: boolean;
  canPlay?: boolean;
  /** z. B. die Reiter des Rooms unter der Kopfzeile */
  children?: ReactNode;
}

export function StationList({ stations, currentId, status, onSelect, onAdd, onEdit, onDelete, onMove, onOpenStore, onClose, canEdit = true, canPlay = true, children }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const endDrag = () => {
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand">
          <RadioIcon size={22} />
          <span>Radio</span>
        </div>
        <div className="sidebar-header-actions">
          {canEdit && (
            <>
              <button className="icon-button" onClick={onOpenStore} title="Sender-Store: Sender entdecken">
                <StoreIcon size={18} />
              </button>
              <button className="icon-button accent" onClick={onAdd} title="Sender manuell hinzufügen">
                <PlusIcon size={18} />
              </button>
            </>
          )}
          <button className="icon-button" onClick={onClose} title="Seitenleiste ausblenden">
            <CloseIcon size={18} />
          </button>
        </div>
      </header>
      {children}

      <div className="sidebar-label">Sender</div>

      {stations.length === 0 ? (
        <div className="empty-list">
          <p>Noch keine Sender vorhanden.</p>
          {canEdit && (
            <button className="button primary" onClick={onAdd}>
              <PlusIcon size={16} /> Sender hinzufügen
            </button>
          )}
        </div>
      ) : (
        <ul className="station-list">
          {stations.map((station, index) => {
            const active = station.id === currentId;
            const confirming = confirmId === station.id;
            const classes = ['station-item'];
            if (active) classes.push('active');
            if (dragId === station.id) classes.push('dragging');
            if (dragId && dropIndex === index) classes.push('drop-before');
            if (dragId && dropIndex === index + 1 && index === stations.length - 1) classes.push('drop-after');
            return (
              <li
                key={station.id}
                className={classes.join(' ')}
                draggable={canEdit && !confirming}
                onDragStart={(e) => {
                  setDragId(station.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', station.id);
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
                {canEdit && (
                  <span className="drag-handle" title="Ziehen zum Sortieren">
                    <GripIcon size={14} />
                  </span>
                )}
                <button className="station-select" disabled={!canPlay} onClick={() => onSelect(station.id)} title={station.url}>
                  <StationLogo station={station} className="small" />
                  <span className="station-name">{station.name}</span>
                  {active && status === 'playing' && (
                    <span className="eq" aria-label="Läuft">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </button>

                {confirming ? (
                  <div className="confirm">
                    <span>Löschen?</span>
                    <button
                      className="mini danger"
                      onClick={() => {
                        onDelete(station.id);
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
                  canEdit && (
                  <div className="station-actions">
                    <button className="icon-button" onClick={() => onEdit(station)} title="Bearbeiten">
                      <EditIcon size={16} />
                    </button>
                    <button className="icon-button" onClick={() => setConfirmId(station.id)} title="Löschen">
                      <TrashIcon size={16} />
                    </button>
                  </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <div className="sidebar-footer">
          <button className="button store-open" onClick={onOpenStore}>
            <StoreIcon size={17} /> Sender entdecken
          </button>
        </div>
      )}
    </aside>
  );
}
