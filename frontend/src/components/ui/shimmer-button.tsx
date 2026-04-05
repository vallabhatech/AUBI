import React, { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
  className?: string;
  children?: React.ReactNode;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = "#39ff14",
      shimmerSize = "0.05em",
      shimmerDuration = "3s",
      borderRadius = "0px",
      background = "rgba(8,8,8,1)",
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        style={{
          "--spread":       "90deg",
          "--shimmer-color": shimmerColor,
          "--radius":       borderRadius,
          "--speed":        shimmerDuration,
          "--cut":          shimmerSize,
          "--bg":           background,
        } as CSSProperties}
        className={cn(
          "group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap",
          "border border-white/10 px-6 py-3 font-mono text-[11px] uppercase tracking-[3px] text-[#e8e4dc]",
          "[background:var(--bg)] [border-radius:var(--radius)]",
          "transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px",
          className,
        )}
        ref={ref}
        {...props}
      >
        {/* Shimmer sweep */}
        <div className="-z-30 blur-[2px] absolute inset-0 overflow-visible [container-type:size]">
          <div className="absolute inset-0 h-[100cqh] animate-shimmer-slide [aspect-ratio:1] [border-radius:0] [mask:none]">
            <div className="animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))] [translate:0_0]" />
          </div>
        </div>
        {children}
        {/* Inner highlight */}
        <div className="insert-0 absolute size-full px-4 py-1.5 shadow-[inset_0_-8px_10px_#39ff141a] transform-gpu transition-all duration-300 ease-in-out group-hover:shadow-[inset_0_-6px_10px_#39ff1430] group-active:shadow-[inset_0_-10px_10px_#39ff1440]" />
        {/* Background cutout */}
        <div className="absolute -z-20 [background:var(--bg)] [border-radius:var(--radius)] [inset:var(--cut)]" />
      </button>
    );
  },
);
ShimmerButton.displayName = "ShimmerButton";
