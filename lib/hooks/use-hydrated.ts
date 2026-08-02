'use client';

import { useSyncExternalStore } from 'react';

/**
 * False during SSR and the first client render, true afterwards.
 *
 * The point is that the first client render MATCHES the server, so hydration
 * agrees; anything that should differ between the two happens on the commit
 * after. `useSyncExternalStore` exists for exactly this — it takes a separate
 * server snapshot — where a state + effect pair does the same thing less
 * directly and trips react-hooks/set-state-in-effect.
 *
 * This is how anything the server cannot know is rendered: the reader's time
 * zone, their OS motion preference, their colour scheme.
 */
const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
