"use client";
import { useEffect, useRef } from "react";

const CELL    = 64;   // grid cell size px
const LENS_R  = 180;  // radius of the zoom lens
const ZOOM    = 2.2;  // magnification factor at centre
const SAMPLES = 40;   // polyline segments per grid line (smooths the curve)
const LERP    = 0.09; // cursor follow speed

export function PerspectiveGrid({ color = "0,240,255" }: { color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    let raf: number;
    // Store cursor as absolute px so we can use it in distort()
    const target  = { x: -9999, y: -9999 };
    const current = { x: -9999, y: -9999 };

    const resize = () => {
      el.width  = el.offsetWidth;
      el.height = el.offsetHeight;
    };

    // Lens distortion: world point → screen point
    // Points near cursor are pushed outward → cells look bigger (zoomed-in)
    const distort = (wx: number, wy: number) => {
      const dx = wx - current.x;
      const dy = wy - current.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.01 || d >= LENS_R) return { x: wx, y: wy, t: 0 };
      const t     = 1 - d / LENS_R;              // 1 at centre, 0 at edge
      const scale = 1 + (ZOOM - 1) * t * t;      // quadratic falloff
      return { x: current.x + dx * scale, y: current.y + dy * scale, t };
    };

    const tick = () => {
      current.x += (target.x - current.x) * LERP;
      current.y += (target.y - current.y) * LERP;

      const W = el.width;
      const H = el.height;
      ctx.clearRect(0, 0, W, H);

      // ── Subtle lens glow ──────────────────────────────────────────────────
      if (current.x > 0) {
        const g = ctx.createRadialGradient(current.x, current.y, 0, current.x, current.y, LENS_R);
        g.addColorStop(0,   `rgba(${color},0.04)`);
        g.addColorStop(0.6, `rgba(${color},0.015)`);
        g.addColorStop(1,   `rgba(${color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(current.x, current.y, LENS_R, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.lineWidth = 0.5;

      // ── Vertical lines ────────────────────────────────────────────────────
      for (let gx = 0; gx <= W + CELL; gx += CELL) {
        let first = true;
        ctx.beginPath();
        for (let s = 0; s <= SAMPLES; s++) {
          const gy = (s / SAMPLES) * H;
          const p  = distort(gx, gy);
          const alpha = 0.40 + p.t * 0.18;
          ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else        { ctx.lineTo(p.x, p.y); }
        }
        ctx.stroke();
      }

      // ── Horizontal lines ──────────────────────────────────────────────────
      for (let gy = 0; gy <= H + CELL; gy += CELL) {
        let first = true;
        ctx.beginPath();
        for (let s = 0; s <= SAMPLES; s++) {
          const gx = (s / SAMPLES) * W;
          const p  = distort(gx, gy);
          const alpha = 0.40 + p.t * 0.18;
          ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else        { ctx.lineTo(p.x, p.y); }
        }
        ctx.stroke();
      }

      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      target.x = e.clientX - rect.left;
      target.y = e.clientY - rect.top;
    };
    const onLeave = () => { target.x = -9999; target.y = -9999; };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    tick();

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 0, pointerEvents: "none" }}
    />
  );
}
