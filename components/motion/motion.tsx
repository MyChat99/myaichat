'use client';

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

/** Message entrance: fade plus a small rise. */
export function MessageEntrance({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const animate = useMotionSafe();

  return (
    <motion.div
      className={className}
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={animate ? { duration: 0.22, ease: EASE } : { duration: 0 }}
    >
      {children}
    </motion.div>
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

/** Button press feedback. Subtle enough to feel like the surface responding. */
export function Pressable({
  children,
  className,
  onClick,
  ...rest
}: React.ComponentProps<typeof motion.button>) {
  const animate = useMotionSafe();

  return (
    <motion.button
      className={className}
      onClick={onClick}
      whileTap={animate ? { scale: 0.97 } : undefined}
      transition={{ duration: 0.1 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
