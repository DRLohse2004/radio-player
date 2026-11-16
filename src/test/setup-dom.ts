// Gemeinsame Vorbereitung für Oberflächen-Tests (jsdom): Was der Browser hat, jsdom aber nicht.
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Audio: play/pause gibt es in jsdom nicht
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(() => Promise.resolve()) });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() });

// Kein Web Audio: Visualizer & Co. laufen dann ohne Analyse
// @ts-expect-error absichtlich entfernt
delete window.AudioContext;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

// Kein Netz in Tests: Logo-Suche, Wetter, Sender-Store bekommen leere Antworten
globalThis.fetch = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
Element.prototype.scrollIntoView ??= () => {};
