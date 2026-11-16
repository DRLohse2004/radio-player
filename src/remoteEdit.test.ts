import { describe, expect, it, vi } from 'vitest';
import { editFromRemote, type RemoteEditActions } from './remoteEdit';

function actions(): RemoteEditActions {
  return {
    stations: [{ id: 's1', name: 'Alt', url: 'https://a', logo: 'data:image/png;base64,xx' }],
    saveStation: vi.fn(),
    deleteStation: vi.fn(),
    moveStation: vi.fn(),
    addYoutube: vi.fn(async () => {}),
    renameYoutube: vi.fn(),
    deleteYoutube: vi.fn(),
    moveYoutube: vi.fn(),
  };
}

describe('Bearbeiten über Room/Fernbedienung', () => {
  it('legt Sender nur mit Name und http(s)-Adresse an', () => {
    const a = actions();
    expect(editFromRemote(a, 'stationSave', { name: ' ', url: 'https://x' })).toMatch(/Name/);
    expect(editFromRemote(a, 'stationSave', { name: 'Neu', url: 'ftp://x' })).toMatch(/Stream-Adresse/);
    expect(editFromRemote(a, 'stationSave', { name: ' Neu ', url: 'https://x' })).toBeNull();
    expect(a.saveStation).toHaveBeenCalledWith({ name: 'Neu', url: 'https://x', logo: undefined }, null);
  });

  it('behält ein hochgeladenes Logo, wenn der Room keins schickt', () => {
    const a = actions();
    editFromRemote(a, 'stationSave', { id: 's1', name: 'Neu', url: 'https://a' });
    expect(a.saveStation).toHaveBeenCalledWith({ name: 'Neu', url: 'https://a', logo: 'data:image/png;base64,xx' }, a.stations[0]);
  });

  it('lehnt Logos ab, die keine Bilder sind', () => {
    expect(editFromRemote(actions(), 'stationSave', { name: 'N', url: 'https://a', logo: 'javascript:alert(1)' })).toBe('Ungültiges Logo.');
  });

  it('leitet Löschen, Verschieben und Umbenennen weiter', () => {
    const a = actions();
    editFromRemote(a, 'stationDelete', 's1');
    editFromRemote(a, 'stationMove', { id: 's1', to: '2' });
    editFromRemote(a, 'youtubeRename', { id: 'y1', title: '  Neuer Name ' });
    expect(a.deleteStation).toHaveBeenCalledWith('s1');
    expect(a.moveStation).toHaveBeenCalledWith('s1', 2);
    expect(a.renameYoutube).toHaveBeenCalledWith('y1', 'Neuer Name');
    expect(editFromRemote(a, 'youtubeRename', { id: 'y1', title: '' })).toBe('Name fehlt.');
  });

  it('meldet Fehler beim Hinzufügen von YouTube-Links als Text', async () => {
    const a = actions();
    a.addYoutube = vi.fn(async () => {
      throw new Error('Dieser Link ist schon gespeichert.');
    });
    await expect(editFromRemote(a, 'youtubeAdd', { url: 'https://youtu.be/x' })).resolves.toBe('Dieser Link ist schon gespeichert.');
  });

  it('kennt unbekannte Befehle nicht', () => {
    expect(editFromRemote(actions(), 'alles-loeschen', null)).toBe('Unbekannter Befehl.');
  });
});
