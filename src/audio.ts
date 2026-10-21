// WebAudio-Kette: <audio> -> Analyser (für den Visualizer) -> Gain (Lautstärke) -> Ausgabe.
// Die Lautstärke wird erst nach dem Analyser angewandt, damit der Visualizer auch bei
// leiser Einstellung gleich lebendig aussieht.

export interface AudioGraph {
  context: AudioContext;
  analyser: AnalyserNode;
  gain: GainNode;
}

const extraSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/** Weiteres Element (z. B. den YouTube-Player) in dieselbe Kette hängen – gleiche Lautstärke, gleicher Visualizer */
export function attachToGraph(graph: AudioGraph, element: HTMLMediaElement) {
  if (extraSources.has(element)) return;
  try {
    const source = graph.context.createMediaElementSource(element);
    source.connect(graph.analyser);
    extraSources.set(element, source);
  } catch {
    // bereits verbunden
  }
}

const graphs = new WeakMap<HTMLAudioElement, AudioGraph>();

export function connectAudio(audio: HTMLAudioElement): AudioGraph | null {
  const existing = graphs.get(audio);
  if (existing) return existing;
  try {
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;
    const gain = context.createGain();
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(context.destination);
    const graph = { context, analyser, gain };
    graphs.set(audio, graph);
    return graph;
  } catch {
    return null;
  }
}
