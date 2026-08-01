'use client';

import { useSyncExternalStore } from 'react';

import { motion, useReducedMotion, type Variants } from 'framer-motion';

/**
 * Motion primitives.
 *
 * Everything here consults `useReducedMotion()`, which reads the OS setting.
 * When it is on, animations collapse to zero duration rather than being merely
 * shortened — a "fast" animation is still animation, and the setting exists for
 * people for whom that is the problem.
 *
 * The CSS in globals.css already neutralises transitions under
 * prefers-reduced-motion; this covers the JS-driven case, which that cannot
 * reach.
 */

const EASE = [0.16, 1, 0.3, 1] as const; // easeOutExpo — settles rather than bounces

export function useMotionSafe() {
  return !useReducedMotion();
}

/**
 * Message entrance: fade plus a small rise.
 *
 * `entering` must be FALSE for anything present in the server-rendered HTML,
 * and true only for messages mounted after hydration. Two things go wrong
 * otherwise, and both did:
 *
 *  1. `useReducedMotion()` cannot know the user's preference on the server, so
 *     it returns false there and true in a browser that asks for reduced
 *     motion. The server then renders `opacity: 0` while the client renders
 *     `opacity: 1` — a hydration mismatch, reported in the console on every
 *     conversation page.
 *  2. More seriously, the server rendered EVERY message at `opacity: 0`
 *     regardless of preference, so the entire conversation was invisible until
 *     JavaScript arrived to fade it in — and stayed invisible if it never did.
 *
 * The caller owns the flag because only the list knows which messages it was
 * rendered with and which arrived later; a `mounted` flag inside this component
 * would be false on its own first render and so would never animate anything.
 */
export function MessageEntrance({
  children,
  className,
  style,
  entering = false,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** True only for messages mounted after hydration. */
  entering?: boolean;
}) {
  const motionSafe = useMotionSafe();
  const animate = entering && motionSafe;

  return (
    <motion.div
      className={className}
      style={style}
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={animate ? { duration: 0.22, ease: EASE } : { duration: 0 }}
    >
      {children}
    </motion.div>
  );
}

/**
 * False during SSR and the first client render, true afterwards.
 *
 * The point is that the first client render MATCHES the server, so hydration
 * agrees; anything that should differ between the two happens on the commit
 * after.
 */
export function useHydrated(): boolean {
  // `useSyncExternalStore` exists for exactly this: it takes a separate server
  // snapshot, so React uses `false` while rendering on the server and during
  // hydration, then `true` once the store is read in the browser. A state +
  // effect pair does the same thing less directly, and trips
  // react-hooks/set-state-in-effect.
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Fade + scale, for popovers and the command palette. */
export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export const panelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: -8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: EASE } },
  exit: { opacity: 0, scale: 0.98, y: -4, transition: { duration: 0.12 } },
};
