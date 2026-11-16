// @vitest-environment jsdom
// Oberflächen-Tests: Die App läuft wie im Browser (npm run dev) mit der Browser-Variante der API.
// Sie sollen vor allem beim Umbau von App.tsx melden, wenn Zusammenspiel kaputtgeht.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { DEFAULT_STATIONS } from '../api';
import type { Settings } from '../types';

const audio = () => document.querySelector('audio') as HTMLAudioElement;
const saved = () => JSON.parse(localStorage.getItem('radio-settings') ?? 'null') as Settings | null;
const stationButton = (name: string) => screen.getByText(name).closest('button') as HTMLButtonElement;

async function start() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('SWR3');
  return user;
}

describe('App', () => {
  it('startet mit den Standardsendern und speichert sie', async () => {
    await start();
    for (const s of DEFAULT_STATIONS) expect(screen.getAllByText(s.name).length).toBeGreaterThan(0);
    await waitFor(() => expect(saved()?.stations).toHaveLength(DEFAULT_STATIONS.length), { timeout: 2000 });
  });

  it('spielt einen angeklickten Sender', async () => {
    const user = await start();
    await user.click(stationButton('SWR3'));
    const swr3 = DEFAULT_STATIONS.find((s) => s.id === 'swr3')!;
    await waitFor(() => expect(audio().src).toBe(swr3.url));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    await waitFor(() => expect(saved()?.lastStationId).toBe('swr3'), { timeout: 2000 });
  });

  it('wechselt mit den Pfeiltasten zum nächsten und vorherigen Sender', async () => {
    const user = await start();
    await user.click(stationButton(DEFAULT_STATIONS[1].name));
    await waitFor(() => expect(audio().src).toBe(DEFAULT_STATIONS[1].url));
    act(() => void fireEvent.keyDown(window, { key: 'ArrowRight' }));
    await waitFor(() => expect(audio().src).toBe(DEFAULT_STATIONS[2].url));
    act(() => void fireEvent.keyDown(window, { key: 'ArrowLeft' }));
    act(() => void fireEvent.keyDown(window, { key: 'ArrowLeft' }));
    await waitFor(() => expect(audio().src).toBe(DEFAULT_STATIONS[0].url));
  });

  it('wählt mit Zifferntasten den Sender an dieser Stelle', async () => {
    await start();
    act(() => void fireEvent.keyDown(window, { key: '4' }));
    await waitFor(() => expect(audio().src).toBe(DEFAULT_STATIONS[3].url));
  });

  it('fügt einen eigenen Sender hinzu', async () => {
    const user = await start();
    await user.click(screen.getByTitle('Sender manuell hinzufügen'));
    const dialog = screen.getByRole('heading', { name: 'Sender hinzufügen' }).closest('form') as HTMLElement;
    await user.type(within(dialog).getByPlaceholderText('z. B. WDR 2'), 'Testradio');
    await user.type(within(dialog).getByPlaceholderText('https://…/stream.mp3'), 'https://example.org/test.mp3');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(screen.queryByRole('heading', { name: 'Sender hinzufügen' })).toBeNull();
    expect(screen.getAllByText('Testradio').length).toBeGreaterThan(0);
    await waitFor(() => expect(saved()?.stations.some((s) => s.name === 'Testradio' && s.url === 'https://example.org/test.mp3')).toBe(true), {
      timeout: 2000,
    });
  });

  it('löscht einen Sender erst nach Rückfrage', async () => {
    const user = await start();
    const row = stationButton('JAM FM').parentElement as HTMLElement;
    await user.click(within(row).getByTitle('Löschen'));
    await user.click(within(row).getByRole('button', { name: 'Nein' }));
    expect(screen.getAllByText('JAM FM').length).toBeGreaterThan(0);
    await user.click(within(row).getByTitle('Löschen'));
    await user.click(within(row).getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(saved()?.stations.some((s) => s.name === 'JAM FM')).toBe(false), { timeout: 2000 });
  });

  it('öffnet die Einstellungen per Knopf und per Komma-Taste', async () => {
    const user = await start();
    await user.click(screen.getByTitle('Einstellungen (,)'));
    const heading = screen.getByRole('heading', { name: 'Einstellungen' });
    await user.click(within(heading.parentElement as HTMLElement).getByTitle('Schließen'));
    expect(screen.queryByRole('heading', { name: 'Einstellungen' })).toBeNull();
    act(() => void fireEvent.keyDown(window, { key: ',' }));
    expect(screen.getByRole('heading', { name: 'Einstellungen' })).toBeTruthy();
  });

  it('wechselt die Reiter per Klick und F-Taste', async () => {
    const user = await start();
    await user.click(screen.getByRole('tab', { name: /YouTube/ }));
    expect(screen.getByRole('tab', { name: /YouTube/ }).className).toContain('active');
    act(() => void fireEvent.keyDown(window, { key: 'F1' }));
    expect(screen.getByRole('tab', { name: /Radio/ }).className).toContain('active');
  });

  it('übernimmt gespeicherte Sender und den zuletzt gespielten', async () => {
    const stations = [
      { id: 'a', name: 'Sender A', url: 'https://example.org/a' },
      { id: 'b', name: 'Sender B', url: 'https://example.org/b' },
    ];
    localStorage.setItem('radio-settings', JSON.stringify({ stations, volume: 0.5, lastStationId: 'b' }));
    render(<App />);
    expect(await screen.findAllByText('Sender B')).not.toHaveLength(0);
    expect(screen.queryByText('SWR3')).toBeNull();
    act(() => void fireEvent.keyDown(window, { key: ' ' }));
    await waitFor(() => expect(audio().src).toBe('https://example.org/b'));
  });
});
