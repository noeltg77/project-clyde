"use client";

import { motion } from "motion/react";

export function StreamingIndicator() {
  return (
    <motion.span
      className="inline-block w-[2px] h-[1em] bg-accent-primary ml-0.5 align-middle"
      animate={{ opacity: [1, 0] }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
    />
  );
}
