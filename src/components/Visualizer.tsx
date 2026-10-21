import { useEffect, useRef } from 'react';

interface Props {
  analyser: AnalyserNode | null;
  active: boolean;
}

const BARS = 72;
const FRAME_MS = 1000 / 30; // 30 fps reichen und schonen den Büro-PC

/** Dezente, gespiegelte Frequenzbalken am unteren Bildrand. */
export function Visualizer({ analyser, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const levels = new Float32Array(BARS);
    let frame = 0;
    let last = 0;

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - last < FRAME_MS) return;
      last = time;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth * dpr;
      const height = canvas.clientHeight * dpr;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, width, height);

      // nur der musikalisch interessante Bereich (bis ca. 11 kHz), leicht logarithmisch verteilt
      const usable = Math.floor(data.length * 0.5);
      const half = BARS / 2;
      const gap = 3 * dpr;
      const barWidth = (width - gap * (BARS - 1)) / BARS;

      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(255, 90, 95, 0.55)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0.08)');
      ctx.fillStyle = gradient;

      for (let i = 0; i < half; i++) {
        const start = Math.floor(Math.pow(i / half, 1.6) * usable);
        const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / half, 1.6) * usable));
        let sum = 0;
        for (let j = start; j < end; j++) sum += data[j];
        const target = active ? (sum / (end - start) / 255) * 0.8 : 0;
        // weich nachziehen statt zu zappeln
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.35 : 0.12);

        const barHeight = Math.max(2 * dpr, levels[i] * height);
        const radius = Math.min(barWidth / 2, 4 * dpr);
        for (const index of [half - 1 - i, half + i]) {
          const x = index * (barWidth + gap);
          ctx.beginPath();
          ctx.roundRect(x, height - barHeight, barWidth, barHeight, [radius, radius, 0, 0]);
          ctx.fill();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser, active]);

  return <canvas ref={canvasRef} className="visualizer" aria-hidden="true" />;
}
