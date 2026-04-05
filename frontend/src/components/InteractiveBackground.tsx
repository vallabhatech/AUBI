"use client";

import { useEffect, useRef } from "react";

interface Dot {
  x: number; y: number;
  ox: number; oy: number;
  vx: number; vy: number;
}

const SPACING = 36;
const REPEL_R = 110;
const REPEL_F = 1.1;
const SPRING  = 0.07;
const DAMPING = 0.72;
const BASE_R  = 1.0;

export function InteractiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    // Arrow functions so TypeScript narrows el/ctx correctly in closures
    let raf: number;
    const mouse = { x: -9999, y: -9999 };
    let dots: Dot[] = [];

    const buildDots = () => {
      dots = [];
      const cols = Math.ceil(el.width  / SPACING) + 2;
      const rows = Math.ceil(el.height / SPACING) + 2;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          dots.push({ x: c * SPACING, y: r * SPACING, ox: 0, oy: 0, vx: 0, vy: 0 });
    };

    const resize = () => {
      el.width  = el.offsetWidth;
      el.height = el.offsetHeight;
      buildDots();
    };

    const tick = () => {
      ctx.clearRect(0, 0, el.width, el.height);
      const hw   = el.width  / 2;
      const hh   = el.height / 2;
      const maxR = Math.sqrt(hw * hw + hh * hh);

      for (const d of dots) {
        const cx = d.x + d.ox;
        const cy = d.y + d.oy;

        const mdx = cx - mouse.x;
        const mdy = cy - mouse.y;
        const md  = Math.sqrt(mdx * mdx + mdy * mdy);

        if (md < REPEL_R && md > 0) {
          const f = ((REPEL_R - md) / REPEL_R) * REPEL_F;
          d.vx += (mdx / md) * f;
          d.vy += (mdy / md) * f;
        }

        d.vx += -d.ox * SPRING;
        d.vy += -d.oy * SPRING;
        d.vx *= DAMPING;
        d.vy *= DAMPING;
        d.ox += d.vx;
        d.oy += d.vy;

        const fdx   = cx - hw;
        const fdy   = cy - hh;
        const fade  = Math.max(0, 1 - Math.sqrt(fdx * fdx + fdy * fdy) / maxR);
        const glow  = md < 90 ? (1 - md / 90) * 0.55 : 0;
        const r     = BASE_R + glow * 2.2;
        const alpha = Math.min(1, fade * 0.55 + glow * 0.75);

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(74,96,128,${alpha.toFixed(3)})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    tick();

    const parent = el.parentElement;
    parent?.addEventListener("mousemove", onMove);
    parent?.addEventListener("mouseleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      parent?.removeEventListener("mousemove", onMove);
      parent?.removeEventListener("mouseleave", onLeave);
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
