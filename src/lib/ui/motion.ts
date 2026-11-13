import { prefersReducedMotion } from 'svelte/motion';

/**
 * Svelte runs transitions through the Web Animations API, which the
 * reduced-motion rule in app.css cannot reach. Every transition length goes
 * through here instead, so asking for less motion removes the travel.
 */
export function ms(duration: number): number {
  return prefersReducedMotion.current ? 0 : duration;
}
