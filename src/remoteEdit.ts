// Admin im Room bzw. an der Fernbedienung: Sender und gespeicherte YouTube-Einträge des Hosts bearbeiten.
// Prüft die Eingaben (sie kommen übers Netz) und ruft dann dieselben Aktionen wie die Oberfläche auf.
import type { Station } from './types';

export interface RemoteEditActions {
  stations: Station[];
  saveStation: (values: Omit<Station, 'id'>, target: Station | null) => void;
  deleteStation: (id: string) => void;
  moveStation: (id: string, toIndex: number) => void;
  addYoutube: (url: string) => Promise<void>;
  renameYoutube: (id: string, title: string) => void;
  deleteYoutube: (id: string) => void;
  moveYoutube: (id: string, toIndex: number) => void;
}

/** Ergebnis: null = erledigt, sonst eine Fehlermeldung für den Admin */
export function editFromRemote(actions: RemoteEditActions, action: string, value: unknown): string | null | Promise<string | null> {
  const v = (value ?? {}) as Record<string, unknown>;
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  switch (action) {
    case 'stationSave': {
      const name = text(v.name, 80);
      const url = text(v.url, 2000);
      if (!name || !/^https?:\/\//i.test(url)) return 'Name und Stream-Adresse (http/https) angeben.';
      const target = actions.stations.find((st) => st.id === v.id) ?? null;
      // Hochgeladene Logos (data:) bekommt der Room nicht zu sehen – leer heißt dann „behalten“
      const logo = text(v.logo, 2000) || (target?.logo?.startsWith('data:') ? target.logo : '');
      if (logo && !/^(https?:|data:image\/)/.test(logo)) return 'Ungültiges Logo.';
      actions.saveStation({ name, url, logo: logo || undefined }, target);
      return null;
    }
    case 'stationDelete':
      actions.deleteStation(String(value));
      return null;
    case 'stationMove':
      actions.moveStation(String(v.id), Number(v.to));
      return null;
    case 'youtubeAdd':
      return actions.addYoutube(text(v.url, 500)).then(
        () => null,
        (err: Error) => err.message,
      );
    case 'youtubeRename': {
      const title = text(v.title, 200);
      if (!title) return 'Name fehlt.';
      actions.renameYoutube(String(v.id), title);
      return null;
    }
    case 'youtubeDelete':
      actions.deleteYoutube(String(value));
      return null;
    case 'youtubeMove':
      actions.moveYoutube(String(v.id), Number(v.to));
      return null;
    default:
      return 'Unbekannter Befehl.';
  }
}
