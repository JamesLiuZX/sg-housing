import type { Session } from './ui/session.svelte';

/**
 * The shortlist: flats a person has saved to come back to and compare. It
 * lives on their device only.
 *
 * This is the contract the interface uses. The top bar's Save button calls
 * toggle and reads has; the shortlist sheet reads list.
 */
export interface Saved {
  /** One flat: postal code, storey, side, flat type and mirroring, as the link would write them. */
  key: string;
  savedAt: number;
}

class Shortlist {
  list = $state<Saved[]>([]);

  /** Whether the flat on screen is saved. */
  has(_session: Session): boolean {
    return false;
  }

  /** Saves the flat on screen, or removes it if it is already saved. */
  toggle(_session: Session): void {}
}

export const shortlist = new Shortlist();
