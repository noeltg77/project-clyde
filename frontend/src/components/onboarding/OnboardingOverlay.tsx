"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

const ONBOARDED_KEY = "clyde-onboarded";

const steps = [
  {
    title: "Welcome to Clyde",
    description:
      "Your AI agent team, managed by a single orchestrator. Clyde delegates tasks to specialist subagents — each with their own memory, skills, and personality.",
    icon: (
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent-primary"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    title: "Your AI Team",
    description:
      "Clyde is the CEO. He creates specialist agents as needed — writers, analysts, coders — and delegates work to them. You can see the whole team in the Org Chart.",
    icon: (
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent-primary"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: "Key Features",
    description:
      "Memory that persists between sessions. Skills that agents learn and reuse. Scheduled tasks and file triggers. Cost tracking in USD. And a self-improvement loop that makes the team better over time.",
    icon: (
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent-primary"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    title: "Get Started",
    description:
      "Just type a message to Clyde. He'll figure out the best way to help — whether that's handling it himself or spinning up a specialist. Welcome aboard.",
    icon: (
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent-primary"
      >
        <path d="M5 12h14" />
        <path d="M12 5l7 7-7 7" />
      </svg>
    ),
  },
];

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const done = localStorage.getItem(ONBOARDED_KEY);
      if (!done) {
        setVisible(true);
      }
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(ONBOARDED_KEY, "true");
    setVisible(false);
  };

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrev = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  if (!visible) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-primary/90 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="w-full max-w-md bg-bg-secondary border-2 border-border rounded-[2px] shadow-[8px_8px_0_0_rgba(200,255,0,0.1)] overflow-hidden"
      >
        {/* Progress bar */}
        <div className="h-1 bg-bg-tertiary">
          <motion.div
            className="h-full bg-accent-primary"
            initial={false}
            animate={{
              width: `${((step + 1) / steps.length) * 100}%`,
            }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
          />
        </div>

        {/* Content */}
        <div className="p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="flex justify-center">{current.icon}</div>
              <h2 className="text-xl font-bold text-text-primary text-center font-display">
                {current.title}
              </h2>
              <p className="text-sm text-text-secondary text-center leading-relaxed">
                {current.description}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Step indicators */}
        <div className="flex justify-center gap-1.5 pb-4">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === step
                  ? "bg-accent-primary w-6"
                  : i < step
                  ? "bg-accent-primary/40"
                  : "bg-text-secondary/20"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-8 pb-6">
          <button
            onClick={handlePrev}
            disabled={step === 0}
            className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Back
          </button>

          <div className="flex items-center gap-3">
            {!isLast && (
              <button
                onClick={handleDismiss}
                className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary/50 hover:text-text-secondary transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-6 py-2 text-[11px] font-semibold uppercase tracking-wider bg-accent-primary text-bg-primary rounded-[2px] hover:brightness-110 transition-all"
            >
              {isLast ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
