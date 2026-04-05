"use client";

import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";

interface Step {
  number: string;
  title: string;
  description: string;
  tag: string;
  hot?: boolean;
}

const PALETTE = [
  { accent: "#ff6b6b", glow: "rgba(255,107,107,0.12)", border: "rgba(255,107,107,0.22)", dim: "rgba(255,107,107,0.06)" },
  { accent: "#4ecdc4", glow: "rgba(78,205,196,0.12)",  border: "rgba(78,205,196,0.22)",  dim: "rgba(78,205,196,0.06)"  },
  { accent: "#39ff14", glow: "rgba(57,255,20,0.18)",   border: "rgba(57,255,20,0.35)",   dim: "rgba(57,255,20,0.09)"   },
  { accent: "#a78bfa", glow: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.22)", dim: "rgba(167,139,250,0.06)" },
  { accent: "#00f0ff", glow: "rgba(0,240,255,0.12)",   border: "rgba(0,240,255,0.22)",   dim: "rgba(0,240,255,0.06)"   },
];

function Card({
  step, index, featured = false,
}: {
  step: Step; index: number; featured?: boolean;
}) {
  const ref    = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [mouse, setMouse] = useState({ x: 50, y: 50, over: false });
  const pal    = PALETTE[index] ?? PALETTE[0];

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    setMouse({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100, over: true });
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setMouse(m => ({ ...m, over: false }))}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.25 } }}
      className={`group relative overflow-hidden ${featured ? "md:col-span-2" : ""}`}
      style={{
        background: `linear-gradient(135deg, ${pal.dim} 0%, rgba(8,8,8,0.9) 60%)`,
        border: `1px solid ${pal.border}`,
        boxShadow: `0 0 32px ${pal.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      {/* Mouse glow */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{
          background: `radial-gradient(circle at ${mouse.x}% ${mouse.y}%, ${pal.glow} 0%, transparent 60%)`,
          opacity: mouse.over ? 1 : 0,
        }}
      />

      {/* Scanline texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,#fff 2px,#fff 3px)",
          backgroundSize: "100% 3px",
        }}
      />

      {/* Giant background number */}
      <div
        className="absolute -right-4 -bottom-6 font-syne font-bold leading-none select-none pointer-events-none"
        style={{
          fontSize: featured ? "clamp(140px,18vw,200px)" : "clamp(100px,12vw,150px)",
          color: pal.accent,
          opacity: 0.045,
          letterSpacing: "-0.05em",
        }}
      >
        {step.number}
      </div>

      {/* Top edge accent */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(to right, transparent, ${pal.accent}99, transparent)` }}
      />

      {/* Content */}
      <div className={`relative z-10 flex flex-col ${featured ? "p-8 md:p-10" : "p-7"}`}>

        {/* Tag + number row */}
        <div className="flex items-center justify-between mb-6">
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[2px]"
            style={{
              background: `${pal.glow}`,
              border: `1px solid ${pal.border}`,
              color: pal.accent,
            }}
          >
            {step.hot && (
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: pal.accent }}
              />
            )}
            {step.tag}
          </div>
          <span
            className="font-syne font-bold text-[12px] tracking-[3px]"
            style={{ color: pal.accent, opacity: 0.9 }}
          >
            {step.number}
          </span>
        </div>

        {/* Title */}
        <h3
          className={`font-syne font-normal leading-tight text-[#e8e4dc] mb-4 ${featured ? "text-[28px] md:text-[36px]" : "text-[20px] md:text-[24px]"}`}
        >
          {step.title}
        </h3>

        {/* Description */}
        <p
          className={`leading-relaxed text-[#e8e4dcc7] ${featured ? "text-[15px] max-w-2xl" : "text-[14px]"}`}
        >
          {step.description}
        </p>

        {/* Bottom row */}
        <div className="mt-6 flex items-center gap-3">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-px flex-1 transition-all duration-500"
              style={{
                background: i <= index
                  ? pal.accent
                  : "rgba(255,255,255,0.08)",
                opacity: i <= index ? (i === index ? 0.9 : 0.35) : 1,
              }}
            />
          ))}
          <span
            className="font-mono text-[10px] tracking-widest ml-1 transition-colors duration-300 group-hover:opacity-100 opacity-70"
            style={{ color: pal.accent }}
          >
            ◉
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function StepCards({ steps }: { steps: Step[] }) {
  return (
    <div className="mt-12 grid gap-3 md:grid-cols-2">
      {steps.slice(0, 2).map((step, i) => (
        <Card key={step.number} step={step} index={i} />
      ))}
      {steps[2] && <Card step={steps[2]} index={2} featured />}
      {steps.slice(3).map((step, i) => (
        <Card key={step.number} step={step} index={i + 3} />
      ))}
    </div>
  );
}

/* Keep old export name for backwards compat */
export function StepCard({ step, index }: { step: Step; index: number }) {
  return <Card step={step} index={index} />;
}
