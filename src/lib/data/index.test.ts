import { describe, expect, it } from 'vitest';
import * as data from './index';

describe('the public surface', () => {
  it('exports what the interface builds on', () => {
    for (const name of [
      'searchAddress',
      'lookupBlock',
      'loadBlock',
      'loadBlockIndexInfo',
      'facades',
      'facadeFacing',
      'bearingOf',
      'blockFacts',
      'blockResales',
      'hdbStreet',
      'lookupDemo',
      'configureOneMap',
      'configureDataGov',
      'configureBlocks',
      'clearDataCache'
    ] as const) {
      expect(typeof data[name], name).toBe('function');
    }
    expect(data.DEMO_POSTAL).toBe('121440');
  });
});
