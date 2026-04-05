"use client";
import { useEffect, useRef } from "react";

function smoothstep(t: number) { return t * t * (3 - 2 * t); }
function hash(n: number) {
  return Math.abs((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1);
}
function noise1d(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  return hash(i) * (1 - smoothstep(f)) + hash(i + 1) * smoothstep(f);
}
function fbm(x: number, octaves = 5) {
  let v = 0, amp = 0.5, freq = 1, max = 0;
  for (let o = 0; o < octaves; o++) {
    v += noise1d(x * freq) * amp;
    max += amp;
    amp *= 0.55;
    freq *= 2.13;
  }
  return v / max;
}

interface WaveDef {
  yBase: number;
  rgb: string;
  strokeOpacity: number;
  fillOpacity: number;
  speed: number;
  amplitude: number;
  noiseScale: number;
  seed: number;
  lineWidth: number;
}

const WAVES: WaveDef[] = [
  { yBase: 0.22, rgb: "57,255,20",  strokeOpacity: 0.75, fillOpacity: 0.10, speed: 0.00014, amplitude: 0.17, noiseScale: 1.6, seed: 0,   lineWidth: 2.0 },
  { yBase: 0.34, rgb: "57,255,20",  strokeOpacity: 0.48, fillOpacity: 0.07, speed: 0.00010, amplitude: 0.19, noiseScale: 2.0, seed: 50,  lineWidth: 1.5 },
  { yBase: 0.16, rgb: "0,240,255",  strokeOpacity: 0.30, fillOpacity: 0.05, speed: 0.00017, amplitude: 0.15, noiseScale: 2.4, seed: 120, lineWidth: 1.2 },
  { yBase: 0.46, rgb: "57,255,20",  strokeOpacity: 0.24, fillOpacity: 0.04, speed: 0.00008, amplitude: 0.23, noiseScale: 1.3, seed: 200, lineWidth: 1.2 },
  { yBase: 0.62, rgb: "57,255,20",  strokeOpacity: 0.18, fillOpacity: 0.03, speed: 0.00012, amplitude: 0.18, noiseScale: 1.8, seed: 280, lineWidth: 1.0 },
  { yBase: 0.54, rgb: "0,240,255",  strokeOpacity: 0.16, fillOpacity: 0.03, speed: 0.00009, amplitude: 0.21, noiseScale: 2.2, seed: 360, lineWidth: 1.0 },
  { yBase: 0.74, rgb: "57,255,20",  strokeOpacity: 0.13, fillOpacity: 0.02, speed: 0.00016, amplitude: 0.16, noiseScale: 2.6, seed: 440, lineWidth: 0.8 },
  { yBase: 0.40, rgb: "57,255,20",  strokeOpacity: 0.10, fillOpacity: 0.02, speed: 0.00011, amplitude: 0.25, noiseScale: 1.0, seed: 520, lineWidth: 0.8 },
  { yBase: 0.85, rgb: "0,240,255",  strokeOpacity: 0.10, fillOpacity: 0.02, speed: 0.00013, amplitude: 0.14, noiseScale: 2.8, seed: 600, lineWidth: 0.7 },
];

const POINTS = 160;

export function StockWaveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let t = 0;

    const resize = () => {
      el.width  = el.offsetWidth;
      el.height = el.offsetHeight;
    };

    const tick = () => {
      t++;
      const W = el.width;
      const H = el.height;
      ctx.clearRect(0, 0, W, H);

      for (const wave of WAVES) {
        const pts: [number, number][] = [];
        for (let i = 0; i <= POINTS; i++) {
          const xNorm = i / POINTS;
          const n = fbm(xNorm * wave.noiseScale + t * wave.speed + wave.seed);
          const y = (wave.yBase + (n - 0.5) * 2 * wave.amplitude) * H;
          pts.push([xNorm * W, y]);
        }

        const buildPath = () => {
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
            const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
            ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
          }
          ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        };

        // Gradient fill below line
        ctx.beginPath();
        buildPath();
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0,   `rgba(${wave.rgb},${wave.fillOpacity})`);
        grad.addColorStop(0.5, `rgba(${wave.rgb},${(wave.fillOpacity * 0.3).toFixed(3)})`);
        grad.addColorStop(1,   `rgba(${wave.rgb},0)`);
        ctx.fillStyle = grad;
        ctx.fill();

        // Stroke line
        ctx.beginPath();
        buildPath();
        ctx.strokeStyle = `rgba(${wave.rgb},${wave.strokeOpacity})`;
        ctx.lineWidth = wave.lineWidth;
        ctx.lineJoin  = "round";
        ctx.stroke();
      }

      raf = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: "none" }}
    />
  );
}
