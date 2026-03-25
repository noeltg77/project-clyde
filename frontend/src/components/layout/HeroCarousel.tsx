"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";

const slides = [
  { src: "/home/home1.png", label: "AI-Powered Orchestration" },
  { src: "/home/home2.png", label: "Autonomous Agent Workflows" },
  { src: "/home/home3.png", label: "Real-Time Analytics" },
  { src: "/home/home4.png", label: "Intelligent Scheduling" },
  { src: "/home/home5.png", label: "Team Coordination" },
  { src: "/home/home6.png", label: "Cost Optimization" },
  { src: "/home/home7.png", label: "Performance Insights" },
];

const INTERVAL = 5000;

// Custom cubic-bezier for buttery smooth motion
const ease = [0.22, 1, 0.36, 1] as const;

// Direction-aware slide variants for a cinematic parallax feel
const variants = {
  enter: (dir: number) => ({
    opacity: 0,
    scale: 1.08,
    x: dir > 0 ? 60 : -60,
    filter: "blur(8px) brightness(0.6)",
  }),
  center: {
    opacity: 1,
    scale: 1,
    x: 0,
    filter: "blur(0px) brightness(1)",
    transition: { duration: 0.8, ease },
  },
  exit: (dir: number) => ({
    opacity: 0,
    scale: 0.95,
    x: dir > 0 ? -40 : 40,
    filter: "blur(6px) brightness(0.6)",
    transition: { duration: 0.5, ease },
  }),
};

const labelVariants = {
  enter: {
    opacity: 0,
    y: 12,
    x: -8,
  },
  center: {
    opacity: 1,
    y: 0,
    x: 0,
    transition: { delay: 0.35, duration: 0.5, ease },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.25 },
  },
};

export function HeroCarousel() {
  const [[current, direction], setCurrent] = useState([0, 1]);
  const [paused, setPaused] = useState(false);

  const advance = useCallback(() => {
    setCurrent(([prev]) => [(prev + 1) % slides.length, 1]);
  }, []);

  // Auto-advance
  useEffect(() => {
    if (paused) return;
    const id = setInterval(advance, INTERVAL);
    return () => clearInterval(id);
  }, [paused, advance]);

  return (
    <div
      className="relative w-full h-full overflow-hidden rounded-[3px] border-2 border-border bg-bg-primary"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Image slides */}
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div
          key={current}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          className="absolute inset-0"
        >
          <Image
            src={slides[current].src}
            alt={slides[current].label}
            fill
            className="object-cover"
            priority={current === 0}
          />

          {/* Subtle vignette overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />
        </motion.div>
      </AnimatePresence>

      {/* Label card — top-left, square, lime green text */}
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={`label-${current}`}
          variants={labelVariants}
          initial="enter"
          animate="center"
          exit="exit"
          className="absolute top-3 left-3 z-10 w-28 h-28 flex items-center justify-center p-2.5 bg-bg-primary/85 backdrop-blur-md border-2 border-accent-primary/40 rounded-[3px]"
        >
          <span className="text-[11px] font-bold uppercase leading-tight tracking-wider text-accent-primary text-center">
            {slides[current].label}
          </span>
        </motion.div>
      </AnimatePresence>

      {/* Progress dots */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-1.5">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent([i, i > current ? 1 : -1])}
            className="group p-0.5"
            aria-label={`Slide ${i + 1}`}
          >
            <div
              className={`h-1 rounded-full transition-all duration-500 ${
                i === current
                  ? "w-6 bg-accent-primary"
                  : "w-1.5 bg-text-secondary/40 group-hover:bg-text-secondary/70"
              }`}
            />
          </button>
        ))}
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-3 right-3 z-10">
        <span className="text-[10px] font-mono text-text-secondary/60">
          {String(current + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
