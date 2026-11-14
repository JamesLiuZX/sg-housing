import type { Plan } from '../types';

/**
 * A typical 3-room flat of the current BTO generation, about 68 m².
 * This is an original drawing of a common arrangement, not a copy of any
 * HDB plan: the master bedroom and bedroom 2 side by side on the main
 * facade, with the living room beside them and the dining area behind it;
 * a short hallway to both bathrooms, which back onto the air-con ledge; an
 * open kitchen joined to the dining area, with the service yard in its far
 * corner; and the household shelter between the kitchen and the front door.
 *
 * Structural walls are the party walls, the shelter and the cross wall
 * between bedroom 2 and the living room, which braces the facade. The
 * bedroom, bathroom and kitchen walls are partitions.
 */
export const bto3room68: Plan = {
  id: 'bto-3room-68',
  title: '3-room',
  subtitle: 'Typical BTO layout',
  areaSqm: 68,
  height: 2600,
  north: 340,
  outline: [
    [0, 0],
    [9400, 0],
    [9400, 7700],
    [3400, 7700],
    [3400, 6600],
    [0, 6600]
  ],
  entry: { x: 8800, y: 7100, face: 'N' },

  walls: [
    // Perimeter, clockwise, so the left normal of each wall points indoors.
    { id: 'facade', a: [0, 0], b: [9400, 0], t: 200, kind: 'external' },
    { id: 'party-e', a: [9400, 0], b: [9400, 7700], t: 200, kind: 'structural' },
    { id: 'front', a: [9400, 7700], b: [8100, 7700], t: 200, kind: 'external' },
    { id: 'hs-s', a: [8100, 7700], b: [6400, 7700], t: 300, kind: 'shelter' },
    { id: 'service', a: [6400, 7700], b: [3400, 7700], t: 200, kind: 'external' },
    { id: 'yard-w', a: [3400, 7700], b: [3400, 6600], t: 200, kind: 'external' },
    { id: 'bath-s', a: [3400, 6600], b: [0, 6600], t: 200, kind: 'external', wet: true },
    { id: 'party-w', a: [0, 6600], b: [0, 0], t: 200, kind: 'structural' },

    // The cross wall that braces the facade between the bedrooms and the living room.
    { id: 's-living', a: [6400, 0], b: [6400, 3400], t: 200, kind: 'structural' },

    // Household shelter.
    { id: 'hs-n', a: [6400, 5800], b: [8100, 5800], t: 300, kind: 'shelter' },
    { id: 'hs-e', a: [8100, 5800], b: [8100, 7700], t: 300, kind: 'shelter' },
    { id: 'hs-w', a: [6400, 5800], b: [6400, 7700], t: 300, kind: 'shelter' },

    // Partitions.
    { id: 'p-beds', a: [3400, 0], b: [3400, 3400], t: 100, kind: 'partition' },
    { id: 'p-mbr-s', a: [1700, 3400], b: [3400, 3400], t: 100, kind: 'partition' },
    { id: 'p-bed2-s', a: [3400, 3400], b: [6400, 3400], t: 100, kind: 'partition' },
    { id: 'p-vestibule', a: [1700, 3400], b: [1700, 4550], t: 100, kind: 'partition' },
    { id: 'p-mbath-n', a: [0, 4550], b: [1700, 4550], t: 100, kind: 'partition', wet: true },
    { id: 'p-bath-n', a: [1700, 4550], b: [3400, 4550], t: 100, kind: 'partition', wet: true },
    { id: 'p-baths', a: [1700, 4550], b: [1700, 6600], t: 100, kind: 'partition', wet: true },
    { id: 'p-bath-e', a: [3400, 4550], b: [3400, 6600], t: 100, kind: 'partition', wet: true },
    { id: 'p-kitchen-n', a: [3400, 4550], b: [6400, 4550], t: 100, kind: 'partition' },
    { id: 'p-yard-n', a: [3400, 6100], b: [5000, 6100], t: 100, kind: 'partition' },
    { id: 'p-yard-e', a: [5000, 6100], b: [5000, 7700], t: 100, kind: 'partition' },

    // Outside the flat.
    { id: 'corridor-parapet', a: [10400, 9300], b: [7000, 9300], t: 120, kind: 'parapet', h: 1050 },
    { id: 'ledge-s', a: [3400, 7700], b: [0, 7700], t: 100, kind: 'parapet', h: 900 },
    { id: 'ledge-w', a: [0, 7700], b: [0, 6600], t: 100, kind: 'parapet', h: 900 }
  ],

  openings: [
    { id: 'win-mbr', wall: 'facade', at: 850, w: 1800, type: 'window', sill: 1000, head: 2400, room: 'mbr' },
    { id: 'win-bed2', wall: 'facade', at: 4000, w: 1800, type: 'window', sill: 1000, head: 2400, room: 'bed2' },
    { id: 'win-living', wall: 'facade', at: 6900, w: 2100, type: 'window', sill: 550, head: 2400, room: 'living' },

    { id: 'door-main', wall: 'front', at: 150, w: 900, type: 'door', head: 2100, leaf: 'timber', hinge: 'end', into: 1, angle: 84, gate: true },
    { id: 'win-kitchen', wall: 'service', at: 200, w: 1000, type: 'window', sill: 1100, head: 2300, room: 'kitchen' },
    { id: 'win-yard', wall: 'service', at: 1600, w: 1200, type: 'window', sill: 1000, head: 2300, room: 'yard' },

    { id: 'win-bath', wall: 'bath-s', at: 200, w: 700, type: 'window', sill: 1500, head: 2200, room: 'bath' },
    { id: 'win-mbath', wall: 'bath-s', at: 2200, w: 700, type: 'window', sill: 1500, head: 2200, room: 'mbath' },

    { id: 'door-mbr', wall: 'p-mbr-s', at: 150, w: 800, type: 'door', head: 2100, leaf: 'room', hinge: 'start', into: -1, angle: 82 },
    { id: 'door-bed2', wall: 'p-bed2-s', at: 150, w: 800, type: 'door', head: 2100, leaf: 'room', hinge: 'start', into: -1, angle: 82 },
    { id: 'door-mbath', wall: 'p-mbath-n', at: 850, w: 700, type: 'door', head: 2100, leaf: 'fold', hinge: 'end', into: 1 },
    { id: 'door-bath', wall: 'p-bath-n', at: 150, w: 700, type: 'door', head: 2100, leaf: 'fold', hinge: 'start', into: 1 },
    { id: 'door-yard', wall: 'p-yard-e', at: 150, w: 750, type: 'door', head: 2100, leaf: 'glass', hinge: 'start', into: 1, angle: 84 },
    { id: 'door-hs', wall: 'hs-e', at: 200, w: 700, type: 'door', head: 2000, leaf: 'steel', hinge: 'start', into: -1, angle: 24 }
  ],

  rooms: [
    { id: 'mbr', name: 'Master bedroom', finish: 'vinyl', label: [1800, 1500], poly: [[0, 0], [3400, 0], [3400, 3400], [1700, 3400], [1700, 4550], [0, 4550]] },
    { id: 'bed2', name: 'Bedroom 2', finish: 'vinyl', poly: [[3400, 0], [6400, 0], [6400, 3400], [3400, 3400]] },
    { id: 'living', name: 'Living', finish: 'porcelain', poly: [[6400, 0], [9400, 0], [9400, 3800], [6400, 3800]] },
    { id: 'hall', name: 'Hallway', finish: 'porcelain', quiet: true, poly: [[1700, 3400], [6400, 3400], [6400, 4550], [1700, 4550]] },
    { id: 'dining', name: 'Dining', finish: 'porcelain', label: [8000, 5480], poly: [[6400, 3800], [9400, 3800], [9400, 7700], [8100, 7700], [8100, 5800], [6400, 5800]] },
    { id: 'kitchen', name: 'Kitchen', finish: 'tile', label: [4700, 5650], poly: [[3400, 4550], [6400, 4550], [6400, 7700], [5000, 7700], [5000, 6100], [3400, 6100]] },
    { id: 'yard', name: 'Service yard', finish: 'tile', poly: [[3400, 6100], [5000, 6100], [5000, 7700], [3400, 7700]] },
    { id: 'mbath', name: 'Master bath', finish: 'tile', poly: [[0, 4550], [1700, 4550], [1700, 6600], [0, 6600]] },
    { id: 'bath', name: 'Bath', finish: 'tile', poly: [[1700, 4550], [3400, 4550], [3400, 6600], [1700, 6600]] },
    { id: 'shelter', name: 'Household shelter', finish: 'cement', poly: [[6400, 5800], [8100, 5800], [8100, 7700], [6400, 7700]] }
  ],

  slabs: [
    { id: 'corridor', rect: [7000, 7700, 10400, 9300], finish: 'cement' },
    { id: 'ledge', rect: [0, 6600, 3400, 7700], finish: 'cement' }
  ],

  lights: [
    [7700, 1800],
    [7900, 4620],
    [4700, 5650],
    [4200, 6850],
    [1800, 1600],
    [4900, 1700],
    [4050, 3975],
    [850, 5550],
    [2550, 5550],
    [7250, 6750]
  ],

  items: [
    // Living
    { kind: 'rug', x: 7675, y: 1800, w: 1300, d: 1800 },
    { kind: 'tvConsole', x: 6700, y: 1800, face: 'E', w: 1800, d: 400, solid: true },
    { kind: 'sofa', x: 8875, y: 1800, face: 'W', w: 2000, d: 850, solid: true },
    { kind: 'coffeeTable', x: 7675, y: 1800, w: 800, d: 800, solid: true },
    { kind: 'plant', x: 6800, y: 450, w: 480, d: 480, solid: true, opts: { tall: true } },
    { kind: 'floorLamp', x: 9060, y: 3150, w: 380, d: 380, solid: true },
    { kind: 'aircon', x: 9300, y: 1800, face: 'W' },

    // Dining and entrance
    { kind: 'diningSet', x: 7900, y: 4620, face: 'S', w: 1400, d: 800, solid: true },
    { kind: 'pendant', x: 7900, y: 4620 },
    { kind: 'shoeCabinet', x: 9125, y: 5300, face: 'W', w: 1000, d: 350, solid: true },

    // Kitchen and yard
    { kind: 'fridge', x: 3800, y: 4950, face: 'S', w: 700, d: 700, solid: true },
    { kind: 'counter', x: 5200, y: 4900, face: 'S', w: 2100, d: 600, solid: true, opts: { hob: 0.55, upper: true } },
    { kind: 'counter', x: 5650, y: 7300, face: 'N', w: 1200, d: 600, solid: true, opts: { sink: 0 } },
    { kind: 'washer', x: 3800, y: 7300, face: 'N', w: 600, d: 600, solid: true },
    { kind: 'dryingRack', x: 4200, y: 7850, face: 'S' },

    // Master bedroom
    { kind: 'bed', x: 2260, y: 1500, face: 'W', w: 1520, d: 2000, solid: true },
    { kind: 'sideTable', x: 3140, y: 450, face: 'W', w: 400, d: 420, solid: true },
    { kind: 'sideTable', x: 3140, y: 2550, face: 'W', w: 400, d: 420, solid: true },
    { kind: 'desk', x: 360, y: 800, face: 'E', w: 1000, d: 520, solid: true, opts: { vanity: true } },
    { kind: 'wardrobe', x: 400, y: 2750, face: 'E', w: 2100, d: 600, solid: true },
    { kind: 'aircon', x: 100, y: 900, face: 'E' },

    // Bedroom 2
    { kind: 'bed', x: 4005, y: 1165, face: 'S', w: 1000, d: 1950, solid: true, opts: { tone: 1 } },
    { kind: 'desk', x: 5250, y: 380, face: 'S', w: 1100, d: 560, solid: true },
    { kind: 'wardrobe', x: 6000, y: 1900, face: 'W', w: 1400, d: 600, solid: true },
    { kind: 'aircon', x: 5100, y: 3350, face: 'N' },

    // Bathrooms
    { kind: 'wc', x: 450, y: 5300, face: 'E', w: 400, d: 700, solid: true },
    { kind: 'vanity', x: 1420, y: 5310, face: 'W', w: 700, d: 460, solid: true },
    { kind: 'showerScreen', x: 620, y: 5800, face: 'S', w: 1040, d: 24, solid: true },
    { kind: 'wc', x: 3000, y: 5300, face: 'W', w: 400, d: 700, solid: true },
    { kind: 'vanity', x: 1980, y: 5310, face: 'E', w: 700, d: 460, solid: true },
    { kind: 'showerScreen', x: 2830, y: 5800, face: 'S', w: 1040, d: 24, solid: true },

    // Household shelter
    { kind: 'rack', x: 6775, y: 6750, face: 'E', w: 1300, d: 450, solid: true },
    { kind: 'hsVent', x: 7250, y: 5650, face: 'N' },

    // Outside
    { kind: 'compressor', x: 900, y: 7150, face: 'S' },
    { kind: 'compressor', x: 2300, y: 7150, face: 'S' },
    { kind: 'shoeRack', x: 7600, y: 8000, face: 'S', w: 700, d: 300, solid: true }
  ],

  source: 'template'
};
