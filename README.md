# Blk

**A showflat for every flat.** Type a Singapore block address or drop in a floor plan, and walk through a true-to-scale model of that HDB flat: where the real sun falls, which walls HDB would let you remove, and a link you can send to the family chat.

Status: milestone 1 in progress (one hero flat, walls that rise from the plan, walk mode, real sun).

- [Research brief](docs/01-research.md): where buyers, sellers and agents get stuck, what already exists, and which government data is usable today.
- [Product plan](docs/02-product-plan.md): what gets built, what does not, design direction, architecture and roadmap.

## Run it

```
npm install
npm run dev          # app at http://localhost:5173, engine harness at /dev.html
npm run build        # static site in dist/
npm run build:single # one self-contained HTML file in dist-single/
```

Built on open data from data.gov.sg and OneMap. Not affiliated with HDB, CEA or any government agency.
