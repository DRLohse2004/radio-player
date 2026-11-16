// Lädt die jsdom-Vorbereitung nur, wenn ein Test im Browser-Umfeld läuft
if (typeof window !== 'undefined') await import('./setup-dom');

export {};
