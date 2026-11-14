import type { Plan } from '../types';

/**
 * A typical 5-room flat of the current BTO generation, about 113 m².
 * This is an original drawing of a common arrangement, not a copy of any
 * HDB plan: the master bedroom and bedrooms 2 and 3 along the main facade,
 * a wide living room at the end, and behind it a dining area that takes in
 * the entrance and a study nook with its own window. The master bedroom
 * reaches its bathroom through a dressing passage. A hallway serves the
 * bedrooms, the common bathroom and the household shelter, and the kitchen
 * opens wide onto the dining area, with the service yard behind the shelter.
 *
 * Structural walls are the party walls, the shelter and the two cross walls
 * on the facade: between the master bedroom and bedroom 2, and between
 * bedroom 3 and the living room. Everything else is a partition.
 */
export const bto5room113: Plan = {
  id: 'bto-5room-113',
  title: '5-room',
  subtitle: 'Typical BTO layout',
  areaSqm: 113,
  height: 2600,
  north: 160,
  outline: [
    [0, 0],
    [14000, 0],
    [14000, 8600],
    [3800, 8600],
    [3800, 7000],
    [0, 7000]
  ],
  entry: { x: 10000, y: 7900, face: 'N' },

  walls: [
    // Perimeter, clockwise, so the left normal of each wall points indoors.
    { id: 'facade', a: [0, 0], b: [14000, 0], t: 200, kind: 'external' },
    { id: 'party-e', a: [14000, 0], b: [14000, 8600], t: 200, kind: 'structural' },
    { id: 'study-s', a: [14000, 8600], b: [12200, 8600], t: 200, kind: 'external' },
    { id: 'front', a: [12200, 8600], b: [9200, 8600], t: 200, kind: 'external' },
    { id: 'service', a: [9200, 8600], b: [3800, 8600], t: 200, kind: 'external' },
    { id: 'yard-w', a: [3800, 8600], b: [3800, 7000], t: 200, kind: 'external' },
    { id: 'bath-s', a: [3800, 7000], b: [0, 7000], t: 200, kind: 'external', wet: true },
    { id: 'party-w', a: [0, 7000], b: [0, 0], t: 200, kind: 'structural' },

    // Cross walls that brace the facade.
    { id: 's-mbr', a: [3800, 0], b: [3800, 3600], t: 200, kind: 'structural' },
    { id: 's-living', a: [9800, 0], b: [9800, 3600], t: 200, kind: 'structural' },

    // Household shelter.
    { id: 'hs-n', a: [3800, 4750], b: [5700, 4750], t: 300, kind: 'shelter' },
    { id: 'hs-e', a: [5700, 4750], b: [5700, 7000], t: 300, kind: 'shelter' },
    { id: 'hs-s', a: [5700, 7000], b: [3800, 7000], t: 300, kind: 'shelter' },
    { id: 'hs-w', a: [3800, 4750], b: [3800, 7000], t: 300, kind: 'shelter' },

    // Partitions.
    { id: 'p-beds', a: [6800, 0], b: [6800, 3600], t: 100, kind: 'partition' },
    { id: 'p-mbr-s', a: [2000, 3600], b: [3800, 3600], t: 100, kind: 'partition' },
    { id: 'p-bed2-s', a: [3800, 3600], b: [6800, 3600], t: 100, kind: 'partition' },
    { id: 'p-bed3-s', a: [6800, 3600], b: [9800, 3600], t: 100, kind: 'partition' },
    { id: 'p-dressing', a: [2000, 3600], b: [2000, 4750], t: 100, kind: 'partition' },
    { id: 'p-mbath-n', a: [0, 4750], b: [2000, 4750], t: 100, kind: 'partition', wet: true },
    { id: 'p-bath-n', a: [2000, 4750], b: [3800, 4750], t: 100, kind: 'partition', wet: true },
    { id: 'p-baths', a: [2000, 4750], b: [2000, 7000], t: 100, kind: 'partition', wet: true },
    { id: 'p-kitchen-n', a: [5700, 4750], b: [9200, 4750], t: 100, kind: 'partition' },
    { id: 'p-kitchen-e', a: [9200, 4750], b: [9200, 8600], t: 100, kind: 'partition' },
    { id: 'p-yard-e', a: [5700, 7000], b: [5700, 8600], t: 100, kind: 'partition' },
    { id: 'p-study-w', a: [12200, 6800], b: [12200, 8600], t: 100, kind: 'partition' },

    // Outside the flat.
    { id: 'corridor-parapet', a: [12200, 10200], b: [8400, 10200], t: 120, kind: 'parapet', h: 1050 },
    { id: 'ledge-s', a: [3800, 8200], b: [0, 8200], t: 100, kind: 'parapet', h: 900 },
    { id: 'ledge-w', a: [0, 8200], b: [0, 7000], t: 100, kind: 'parapet', h: 900 }
  ],

  openings: [
    { id: 'win-mbr', wall: 'facade', at: 900, w: 2000, type: 'window', sill: 1000, head: 2400, room: 'mbr' },
    { id: 'win-bed2', wall: 'facade', at: 4400, w: 1800, type: 'window', sill: 1000, head: 2400, room: 'bed2' },
    { id: 'win-bed3', wall: 'facade', at: 7400, w: 1800, type: 'window', sill: 1000, head: 2400, room: 'bed3' },
    { id: 'win-living', wall: 'facade', at: 10400, w: 3000, type: 'window', sill: 550, head: 2400, room: 'living' },

    { id: 'win-study', wall: 'study-s', at: 300, w: 1200, type: 'window', sill: 1000, head: 2400, room: 'study' },
    { id: 'door-main', wall: 'front', at: 1750, w: 1000, type: 'door', head: 2100, leaf: 'timber', hinge: 'end', into: 1, angle: 84, gate: true },
    { id: 'win-kitchen', wall: 'service', at: 800, w: 1400, type: 'window', sill: 1100, head: 2300, room: 'kitchen' },
    { id: 'win-yard', wall: 'service', at: 3800, w: 1300, type: 'window', sill: 1000, head: 2300, room: 'yard' },

    { id: 'win-bath', wall: 'bath-s', at: 400, w: 700, type: 'window', sill: 1500, head: 2200, room: 'bath' },
    { id: 'win-mbath', wall: 'bath-s', at: 2500, w: 700, type: 'window', sill: 1500, head: 2200, room: 'mbath' },

    { id: 'door-mbr', wall: 'p-mbr-s', at: 150, w: 800, type: 'door', head: 2100, leaf: 'room', hinge: 'start', into: -1, angle: 82 },
    { id: 'door-bed2', wall: 'p-bed2-s', at: 150, w: 800, type: 'door', head: 2100, leaf: 'room', hinge: 'start', into: -1, angle: 82 },
    { id: 'door-bed3', wall: 'p-bed3-s', at: 150, w: 800, type: 'door', head: 2100, leaf: 'room', hinge: 'start', into: -1, angle: 82 },
    { id: 'door-mbath', wall: 'p-mbath-n', at: 1100, w: 750, type: 'door', head: 2100, leaf: 'fold', hinge: 'end', into: 1 },
    { id: 'door-bath', wall: 'p-bath-n', at: 150, w: 750, type: 'door', head: 2100, leaf: 'fold', hinge: 'start', into: 1 },
    { id: 'door-hs', wall: 'hs-n', at: 600, w: 700, type: 'door', head: 2000, leaf: 'steel', hinge: 'start', into: -1, angle: 24 },
    { id: 'door-yard', wall: 'p-yard-e', at: 200, w: 750, type: 'door', head: 2100, leaf: 'glass', hinge: 'start', into: 1, angle: 84 },
    { id: 'open-kitchen', wall: 'p-kitchen-e', at: 900, w: 1800, type: 'open' }
  ],

  rooms: [
    { id: 'mbr', name: 'Master bedroom', finish: 'vinyl', label: [1900, 1600], poly: [[0, 0], [3800, 0], [3800, 3600], [2000, 3600], [2000, 4750], [0, 4750]] },
    { id: 'bed2', name: 'Bedroom 2', finish: 'vinyl', poly: [[3800, 0], [6800, 0], [6800, 3600], [3800, 3600]] },
    { id: 'bed3', name: 'Bedroom 3', finish: 'vinyl', poly: [[6800, 0], [9800, 0], [9800, 3600], [6800, 3600]] },
    { id: 'living', name: 'Living', finish: 'porcelain', poly: [[9800, 0], [14000, 0], [14000, 4000], [9800, 4000]] },
    { id: 'hall', name: 'Hallway', finish: 'porcelain', quiet: true, poly: [[2000, 3600], [9800, 3600], [9800, 4750], [2000, 4750]] },
    {
      id: 'dining',
      name: 'Dining',
      finish: 'porcelain',
      label: [11000, 6700],
      poly: [[9800, 4000], [14000, 4000], [14000, 6800], [12200, 6800], [12200, 8600], [9200, 8600], [9200, 4750], [9800, 4750]]
    },
    { id: 'study', name: 'Study nook', finish: 'vinyl', poly: [[12200, 6800], [14000, 6800], [14000, 8600], [12200, 8600]] },
    { id: 'kitchen', name: 'Kitchen', finish: 'tile', label: [7400, 6600], poly: [[5700, 4750], [9200, 4750], [9200, 8600], [5700, 8600]] },
    { id: 'yard', name: 'Service yard', finish: 'tile', poly: [[3800, 7000], [5700, 7000], [5700, 8600], [3800, 8600]] },
    { id: 'mbath', name: 'Master bath', finish: 'tile', poly: [[0, 4750], [2000, 4750], [2000, 7000], [0, 7000]] },
    { id: 'bath', name: 'Bath', finish: 'tile', poly: [[2000, 4750], [3800, 4750], [3800, 7000], [2000, 7000]] },
    { id: 'shelter', name: 'Household shelter', finish: 'cement', poly: [[3800, 4750], [5700, 4750], [5700, 7000], [3800, 7000]] }
  ],

  slabs: [
    { id: 'corridor', rect: [8400, 8600, 12200, 10200], finish: 'cement' },
    { id: 'ledge', rect: [0, 7000, 3800, 8200], finish: 'cement' }
  ],

  lights: [
    [11650, 2000],
    [11600, 5400],
    [13100, 7500],
    [7400, 6600],
    [4750, 7800],
    [2000, 1700],
    [5300, 1800],
    [8300, 1800],
    [5900, 4175],
    [1000, 5875],
    [2900, 5875],
    [4750, 5875]
  ],

  items: [
    // Living
    { kind: 'rug', x: 11650, y: 1900, w: 1700, d: 2200 },
    { kind: 'tvConsole', x: 10125, y: 1900, face: 'E', w: 2000, d: 450, solid: true },
    { kind: 'sofa', x: 13425, y: 1900, face: 'W', w: 2400, d: 950, solid: true },
    { kind: 'coffeeTable', x: 11650, y: 1900, w: 800, d: 800, solid: true },
    { kind: 'sideTable', x: 13690, y: 450, face: 'W', w: 400, d: 420, solid: true },
    { kind: 'plant', x: 10150, y: 420, w: 480, d: 480, solid: true, opts: { tall: true } },
    { kind: 'floorLamp', x: 13650, y: 3400, w: 380, d: 380, solid: true },
    { kind: 'aircon', x: 13900, y: 1900, face: 'W' },

    // Dining, entrance and study nook
    { kind: 'diningSet', x: 11600, y: 5400, face: 'S', w: 1600, d: 900, solid: true },
    { kind: 'pendant', x: 11600, y: 5400 },
    { kind: 'aircon', x: 13900, y: 5400, face: 'W' },
    { kind: 'shoeCabinet', x: 11975, y: 7800, face: 'W', w: 1000, d: 350, solid: true },
    { kind: 'desk', x: 13100, y: 8220, face: 'N', w: 1300, d: 560, solid: true },
    { kind: 'bookshelf', x: 13740, y: 7350, face: 'W', w: 900, d: 320, solid: true },

    // Kitchen and yard
    { kind: 'counter', x: 7150, y: 5100, face: 'S', w: 2600, d: 600, solid: true, opts: { hob: 0.3, upper: true } },
    { kind: 'fridge', x: 8800, y: 5150, face: 'S', w: 700, d: 700, solid: true },
    { kind: 'counter', x: 7700, y: 8200, face: 'N', w: 2100, d: 600, solid: true, opts: { sink: 0 } },
    { kind: 'hsVent', x: 5850, y: 6200, face: 'E' },
    { kind: 'washer', x: 4200, y: 8200, face: 'N', w: 600, d: 600, solid: true },
    { kind: 'dryingRack', x: 4750, y: 8750, face: 'S' },

    // Master bedroom
    { kind: 'bed', x: 2610, y: 1500, face: 'W', w: 1520, d: 2000, solid: true },
    { kind: 'sideTable', x: 3490, y: 450, face: 'W', w: 400, d: 420, solid: true },
    { kind: 'sideTable', x: 3490, y: 2550, face: 'W', w: 400, d: 420, solid: true },
    { kind: 'desk', x: 360, y: 900, face: 'E', w: 1000, d: 520, solid: true, opts: { vanity: true } },
    { kind: 'wardrobe', x: 400, y: 3600, face: 'E', w: 1800, d: 600, solid: true },
    { kind: 'aircon', x: 100, y: 1900, face: 'E' },

    // Bedroom 2
    { kind: 'bed', x: 4490, y: 1165, face: 'S', w: 1070, d: 1950, solid: true, opts: { tone: 1 } },
    { kind: 'desk', x: 6470, y: 1150, face: 'W', w: 1100, d: 560, solid: true },
    { kind: 'wardrobe', x: 5900, y: 3250, face: 'N', w: 1500, d: 600, solid: true },
    { kind: 'aircon', x: 6750, y: 2300, face: 'W' },

    // Bedroom 3
    { kind: 'bed', x: 9110, y: 1165, face: 'S', w: 1070, d: 1950, solid: true },
    { kind: 'desk', x: 7130, y: 1150, face: 'E', w: 1100, d: 560, solid: true },
    { kind: 'wardrobe', x: 8850, y: 3250, face: 'N', w: 1500, d: 600, solid: true },
    { kind: 'aircon', x: 6850, y: 2400, face: 'E' },

    // Bathrooms
    { kind: 'wc', x: 450, y: 5500, face: 'E', w: 400, d: 700, solid: true },
    { kind: 'vanity', x: 1720, y: 5600, face: 'W', w: 700, d: 460, solid: true },
    { kind: 'showerScreen', x: 620, y: 6100, face: 'S', w: 1040, d: 24, solid: true },
    { kind: 'wc', x: 3300, y: 5500, face: 'W', w: 400, d: 700, solid: true },
    { kind: 'vanity', x: 2280, y: 5600, face: 'E', w: 700, d: 460, solid: true },
    { kind: 'showerScreen', x: 3130, y: 6100, face: 'S', w: 1040, d: 24, solid: true },

    // Household shelter
    { kind: 'rack', x: 4175, y: 5900, face: 'E', w: 1600, d: 450, solid: true },

    // Outside
    { kind: 'compressor', x: 800, y: 7650, face: 'S' },
    { kind: 'compressor', x: 2000, y: 7650, face: 'S' },
    { kind: 'compressor', x: 3150, y: 7650, face: 'S' },
    { kind: 'shoeRack', x: 11050, y: 8900, face: 'S', w: 700, d: 300, solid: true }
  ],

  source: 'template'
};
