import type { Plan } from './types';

/**
 * A typical 4-room flat of the current BTO generation, about 93 m².
 * This is an original drawing of a common arrangement, not a copy of any
 * HDB plan: three bedrooms along the main facade, living and dining down
 * one side, kitchen and service yard on the service facade, household
 * shelter beside the entrance.
 */
export const hero4room: Plan = {
  id: 'bto-4room-93',
  title: '4-room',
  subtitle: 'Typical BTO layout',
  areaSqm: 93,
  height: 2600,
  north: 295,
  outline: [
    [0, 0],
    [12500, 0],
    [12500, 7900],
    [3400, 7900],
    [3400, 6500],
    [0, 6500]
  ],
  entry: { x: 9950, y: 7250, face: 'N' },

  walls: [
    // Perimeter, clockwise, so the left normal of each wall points indoors.
    { id: 'facade', a: [0, 0], b: [12500, 0], t: 200, kind: 'external' },
    { id: 'party-e', a: [12500, 0], b: [12500, 5900], t: 200, kind: 'structural' },
    { id: 'hs-e', a: [12500, 5900], b: [12500, 7900], t: 300, kind: 'shelter' },
    { id: 'hs-s', a: [12500, 7900], b: [10700, 7900], t: 300, kind: 'shelter' },
    { id: 'service', a: [10700, 7900], b: [3400, 7900], t: 200, kind: 'external' },
    { id: 'yard-w', a: [3400, 7900], b: [3400, 6500], t: 200, kind: 'external' },
    { id: 'bath-s', a: [3400, 6500], b: [0, 6500], t: 200, kind: 'external', wet: true },
    { id: 'party-w', a: [0, 6500], b: [0, 0], t: 200, kind: 'structural' },

    // Structural walls indoors.
    { id: 's-mbr', a: [3400, 0], b: [3400, 3200], t: 200, kind: 'structural' },
    { id: 's-living', a: [9200, 0], b: [9200, 3200], t: 200, kind: 'structural' },
    { id: 's-bath', a: [3400, 4300], b: [3400, 6500], t: 200, kind: 'structural', wet: true },

    // Household shelter.
    { id: 'hs-w', a: [10700, 5900], b: [10700, 7900], t: 300, kind: 'shelter' },
    { id: 'hs-n', a: [10700, 5900], b: [12500, 5900], t: 300, kind: 'shelter' },

    // Partitions.
    { id: 'p-beds', a: [6300, 0], b: [6300, 3200], t: 100, kind: 'partition' },
    { id: 'p-mbr-s', a: [1700, 3200], b: [3400, 3200], t: 100, kind: 'partition' },
    { id: 'p-bed2-s', a: [3400, 3200], b: [6300, 3200], t: 100, kind: 'partition' },
    { id: 'p-bed3-s', a: [6300, 3200], b: [9200, 3200], t: 100, kind: 'partition' },
    { id: 'p-mbr-door', a: [1700, 3200], b: [1700, 4300], t: 100, kind: 'partition' },
    { id: 'p-mbath-n', a: [0, 4300], b: [1700, 4300], t: 100, kind: 'partition', wet: true },
    { id: 'p-bath-n', a: [1700, 4300], b: [3400, 4300], t: 100, kind: 'partition', wet: true },
    { id: 'p-baths', a: [1700, 4300], b: [1700, 6500], t: 100, kind: 'partition', wet: true },
    { id: 'p-kitchen-n', a: [3400, 4300], b: [7000, 4300], t: 100, kind: 'partition' },
    { id: 'p-kitchen-e', a: [7000, 4300], b: [7000, 7900], t: 100, kind: 'partition' },
    { id: 'p-yard-n', a: [3400, 6300], b: [5000, 6300], t: 100, kind: 'partition' },
    { id: 'p-yard-e', a: [5000, 6300], b: [5000, 7900], t: 100, kind: 'partition' },

    // Outside the flat.
    { id: 'corridor-parapet', a: [13100, 9500], b: [8600, 9500], t: 120, kind: 'parapet', h: 1050 },
    { id: 'ledge-s', a: [3400, 7700], b: [0, 7700], t: 100, kind: 'parapet', h: 900 },
    { id: 'ledge-w', a: [0, 7700], b: [0, 6500], t: 100, kind: 'parapet', h: 900 }
  ],

  openings: [
    { id: 'win-mbr', wall: 'facade', at: 800, w: 1800, type: 'window', sill: 1000, head: 2400, room: 'mbr' },
    { id: 'win-bed2', wall: 'facade', at: 3950, w: 1800, type: 'window', sill: 1000, head: 2400, room: 'bed2' },
    { id: 'win-bed3', wall: 'facade', at: 6850, w: 1800, type: 'window', sill: 1000, head: 2400, room: 'bed3' },
    { id: 'win-living', wall: 'facade', at: 9700, w: 2400, type: 'window', sill: 550, head: 2400, room: 'living' },

    { id: 'door-main', wall: 'service', at: 250, w: 1000, type: 'door', head: 2100, leaf: 'timber', hinge: 'start', into: 1, angle: 84, gate: true },
    { id: 'win-kitchen', wall: 'service', at: 4000, w: 1400, type: 'window', sill: 1100, head: 2300, room: 'kitchen' },
    { id: 'win-yard', wall: 'service', at: 5900, w: 1200, type: 'window', sill: 1000, head: 2300, room: 'yard' },

    { id: 'win-bath', wall: 'bath-s', at: 500, w: 700, type: 'window', sill: 1500, head: 2200, room: 'bath' },
    { id: 'win-mbath', wall: 'bath-s', at: 2200, w: 700, type: 'window', sill: 1500, head: 2200, room: 'mbath' },

    { id: 'door-mbr', wall: 'p-mbr-door', at: 150, w: 800, type: 'door', head: 2100, leaf: 'room', hinge: 'end', into: 1, angle: 82 },
    { id: 'door-mbath', wall: 'p-mbath-n', at: 150, w: 750, type: 'door', head: 2100, leaf: 'fold', hinge: 'start', into: 1 },
    { id: 'door-bath', wall: 'p-bath-n', at: 450, w: 750, type: 'door', head: 2100, leaf: 'fold', hinge: 'end', into: 1 },
    { id: 'door-bed2', wall: 'p-bed2-s', at: 1950, w: 850, type: 'door', head: 2100, leaf: 'room', hinge: 'end', into: -1, angle: 82 },
    { id: 'door-bed3', wall: 'p-bed3-s', at: 100, w: 850, type: 'door', head: 2100, leaf: 'room', hinge: 'start', into: -1, angle: 82 },
    { id: 'open-kitchen', wall: 'p-kitchen-e', at: 700, w: 1800, type: 'open' },
    { id: 'door-yard', wall: 'p-yard-e', at: 300, w: 800, type: 'door', head: 2100, leaf: 'glass', hinge: 'start', into: 1, angle: 84 },
    { id: 'door-hs', wall: 'hs-w', at: 200, w: 700, type: 'door', head: 2000, leaf: 'steel', hinge: 'start', into: 1, angle: 24 }
  ],

  rooms: [
    { id: 'mbr', name: 'Master bedroom', finish: 'vinyl', label: [1500, 1600], poly: [[0, 0], [3400, 0], [3400, 3200], [1700, 3200], [1700, 4300], [0, 4300]] },
    { id: 'bed2', name: 'Bedroom 2', finish: 'vinyl', poly: [[3400, 0], [6300, 0], [6300, 3200], [3400, 3200]] },
    { id: 'bed3', name: 'Bedroom 3', finish: 'vinyl', poly: [[6300, 0], [9200, 0], [9200, 3200], [6300, 3200]] },
    { id: 'living', name: 'Living', finish: 'porcelain', poly: [[9200, 0], [12500, 0], [12500, 4300], [9200, 4300]] },
    { id: 'hall', name: 'Hallway', finish: 'porcelain', quiet: true, poly: [[1700, 3200], [9200, 3200], [9200, 4300], [1700, 4300]] },
    { id: 'dining', name: 'Dining', finish: 'porcelain', label: [8600, 5500], poly: [[7000, 4300], [12500, 4300], [12500, 5900], [10700, 5900], [10700, 7900], [7000, 7900]] },
    { id: 'kitchen', name: 'Kitchen', finish: 'tile', label: [5300, 5500], poly: [[3400, 4300], [7000, 4300], [7000, 7900], [5000, 7900], [5000, 6300], [3400, 6300]] },
    { id: 'yard', name: 'Service yard', finish: 'tile', poly: [[3400, 6300], [5000, 6300], [5000, 7900], [3400, 7900]] },
    { id: 'mbath', name: 'Master bath', finish: 'tile', poly: [[0, 4300], [1700, 4300], [1700, 6500], [0, 6500]] },
    { id: 'bath', name: 'Bath', finish: 'tile', poly: [[1700, 4300], [3400, 4300], [3400, 6500], [1700, 6500]] },
    { id: 'shelter', name: 'Household shelter', finish: 'cement', poly: [[10700, 5900], [12500, 5900], [12500, 7900], [10700, 7900]] }
  ],

  slabs: [
    { id: 'corridor', rect: [8600, 7900, 13100, 9500], finish: 'cement' },
    { id: 'ledge', rect: [0, 6500, 3400, 7700], finish: 'cement' }
  ],

  lights: [
    [10850, 2100],
    [8450, 5950],
    [5300, 5600],
    [1700, 1600],
    [4850, 1600],
    [7750, 1600],
    [5400, 3750],
    [850, 5300],
    [2550, 5300],
    [4200, 7050],
    [11600, 6750]
  ],

  items: [
    // Living
    { kind: 'rug', x: 10750, y: 1900, w: 1700, d: 2300 },
    { kind: 'tvConsole', x: 9530, y: 1900, face: 'E', w: 1800, d: 450, solid: true },
    { kind: 'sofa', x: 11930, y: 1900, face: 'W', w: 2200, d: 920, solid: true },
    { kind: 'coffeeTable', x: 10750, y: 1900, w: 800, d: 800, solid: true },
    { kind: 'plant', x: 9620, y: 430, w: 500, d: 500, solid: true, opts: { tall: true } },
    { kind: 'floorLamp', x: 12130, y: 3320, w: 380, d: 380, solid: true },
    { kind: 'aircon', x: 12400, y: 1900, face: 'W' },

    // Dining and entrance
    { kind: 'diningSet', x: 8450, y: 5950, face: 'E', w: 1600, d: 850, solid: true },
    { kind: 'pendant', x: 8450, y: 5950 },
    { kind: 'shoeCabinet', x: 8800, y: 7620, face: 'N', w: 1000, d: 350, solid: true },

    // Kitchen and yard
    { kind: 'counter', x: 4850, y: 4650, face: 'S', w: 2700, d: 600, solid: true, opts: { hob: 0.25, upper: true } },
    { kind: 'fridge', x: 6580, y: 4700, face: 'S', w: 700, d: 700, solid: true },
    { kind: 'counter', x: 3800, y: 5600, face: 'E', w: 1300, d: 600, solid: true },
    { kind: 'counter', x: 6320, y: 7500, face: 'N', w: 1260, d: 600, solid: true, opts: { sink: 0 } },
    { kind: 'washer', x: 3850, y: 7470, face: 'N', w: 600, d: 600, solid: true },
    { kind: 'dryingRack', x: 4200, y: 8050, face: 'S' },

    // Master bedroom
    { kind: 'bed', x: 2200, y: 1350, face: 'W', w: 1520, d: 2000, solid: true },
    { kind: 'sideTable', x: 3060, y: 318, face: 'W', w: 400, d: 420, solid: true },
    { kind: 'wardrobe', x: 2525, y: 2850, face: 'N', w: 1550, d: 600, solid: true },
    { kind: 'desk', x: 380, y: 1500, face: 'E', w: 1000, d: 520, solid: true, opts: { vanity: true } },
    { kind: 'aircon', x: 100, y: 2620, face: 'E' },

    // Bedroom 2
    { kind: 'bed', x: 4055, y: 1180, face: 'S', w: 1000, d: 1950, solid: true, opts: { tone: 1 } },
    { kind: 'desk', x: 5190, y: 390, face: 'S', w: 1150, d: 560, solid: true },
    { kind: 'wardrobe', x: 5950, y: 1500, face: 'W', w: 1400, d: 600, solid: true },
    { kind: 'aircon', x: 4850, y: 3150, face: 'N' },

    // Bedroom 3, set up as a study
    { kind: 'desk', x: 7860, y: 430, face: 'S', w: 1200, d: 650, solid: true },
    { kind: 'sofa', x: 6790, y: 1330, face: 'E', w: 1850, d: 850, solid: true, opts: { daybed: true } },
    { kind: 'bookshelf', x: 8940, y: 1500, face: 'W', w: 1600, d: 320, solid: true },
    { kind: 'rug', x: 7800, y: 1900, w: 1300, d: 1500, opts: { tone: 1 } },
    { kind: 'aircon', x: 7750, y: 3150, face: 'N' },

    // Bathrooms
    { kind: 'wc', x: 470, y: 5050, face: 'E', w: 400, d: 700, solid: true },
    { kind: 'vanity', x: 1420, y: 4930, face: 'W', w: 700, d: 460, solid: true },
    { kind: 'showerScreen', x: 620, y: 5560, face: 'S', w: 1040, d: 24, solid: true },
    { kind: 'wc', x: 2930, y: 5050, face: 'W', w: 400, d: 700, solid: true },
    { kind: 'vanity', x: 1980, y: 4930, face: 'E', w: 700, d: 460, solid: true },
    { kind: 'showerScreen', x: 2780, y: 5560, face: 'S', w: 1040, d: 24, solid: true },

    // Household shelter
    { kind: 'rack', x: 12120, y: 6900, face: 'W', w: 1500, d: 450, solid: true },
    { kind: 'hsVent', x: 11450, y: 5748, face: 'N' },

    // Outside
    { kind: 'compressor', x: 900, y: 7150, face: 'S' },
    { kind: 'compressor', x: 2300, y: 7150, face: 'S' },
    { kind: 'plant', x: 10900, y: 8320, w: 420, d: 420, solid: true },
    { kind: 'shoeRack', x: 9100, y: 8170, face: 'S', w: 700, d: 300, solid: true }
  ],

  source: 'template'
};
