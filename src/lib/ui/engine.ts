import type { Block, Facade } from '../data';
import type { Viewer } from '../engine/Viewer';
import type { Plan } from '../plan/types';

/**
 * The engine's block stage, as the interface uses it. The engine grows these
 * methods in its own time, so the interface asks for them rather than
 * assuming them: with them, the real block stands in 3D and the camera
 * pushes into the flat; without them, the block stage draws the block's
 * outline and the flat's plan, and the walls rise as they do for the
 * typical flat. Nothing else changes.
 */

export interface UnitPlace {
  storey: number;
  facade: Facade;
  /** 0 to 1 along the facade, from its `a` end. */
  along: number;
}

export interface BlockStage {
  showBlock(site: { block: Block; storeys: number; label: string }): unknown;
  setStorey(n: number): void;
  setUnit(unit: UnitPlace): void;
  enterFlat(): Promise<unknown>;
  exitToBlock(): Promise<unknown>;
}

/** Hooks the block stage calls back on. */
export interface BlockHooks {
  /** The person dragged up or down the block itself. */
  storey?: (n: number) => void;
  /** The person tapped a side of the block, or off it. */
  facade?: (hit: { facade: Facade; along: number } | null) => void;
}

type Methods<T> = { [K in keyof T]?: unknown };

const has = <T>(v: object, names: (keyof T)[]): boolean => names.every((n) => typeof (v as Methods<T>)[n] === 'function');

/** The viewer's block stage, or null while the engine has none. */
export function blockStage(v: Viewer | null): BlockStage | null {
  return v && has<BlockStage>(v, ['showBlock', 'setStorey', 'setUnit', 'enterFlat', 'exitToBlock']) ? (v as unknown as BlockStage) : null;
}

/** The viewer's in-place flat swap, or null when a new plan needs a new viewer. */
export function planSwap(v: Viewer | null): { setPlan(plan: Plan): void } | null {
  return v && has<{ setPlan: unknown }>(v, ['setPlan']) ? (v as unknown as { setPlan(plan: Plan): void }) : null;
}
