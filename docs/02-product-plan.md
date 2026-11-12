# Product plan

_Name: **Blk**, the way every HDB address begins. Tagline: **A showflat for every flat.**_
_Read [01-research.md](01-research.md) first; every feature below traces back to a finding there._

## 1. What it is

Condo buyers get a showflat. BTO buyers get one generic show unit at HDB Hub. Resale buyers get a 15-minute viewing at 9pm. Blk gives any HDB flat its own showflat: type a block address or drop in a floor plan, and within seconds you are standing inside a true-to-scale model of that flat, watching where the real sun falls at 5pm in June, tapping walls to see which ones HDB would let you remove, and sending the whole thing to your family chat.

It is a web app. Nothing to install, no login, and it opens from a WhatsApp link or inside Telegram.

**Positioning.** Everyone else in this space sells style: what your flat could look like. Blk sells truth: what the flat is actually like, and what you are allowed to do with it. That is the part general AI tools get wrong, the part buyers cannot see at a viewing, and the part the regulator cares about.

## 2. Guardrails

These are the rules that keep the product from sliding into the crowd.

1. **A problem first.** Every feature names the finding it answers. No feature because it demos well.
2. **A model, shown as a model.** The look is an architect's maquette, never a fake photograph. It is faster on phones, it is distinctive, and it cannot be mistaken for a picture of the real unit.
3. **Facts carry sources.** Anything about rules, lease, prices or agents links to the official page or dataset it came from. Where the app is estimating, it says "typical" and says how to confirm.
4. **AI stays backstage.** AI reads floor plans. It does not chat, does not give advice, and does not state rules. Rules are written by hand from HDB's guidelines.
5. **The chat app is the platform.** Sharing, replying and following up happen in WhatsApp and Telegram, where people already are. Blk does not build its own inbox or accounts.
6. **Phone first.** Most opens will come from a chat link on a mid-range phone on mobile data.

## 3. Who it is for

| Person | The job | Finding it answers |
|---|---|---|
| **BTO buyer** before unit selection and during the wait | "Let me see this unit type at real size and real sun before I pick a stack, then plan around it for three years" | Research 1, 2 |
| **Resale buyer** before and after a viewing | "Is this flat worth my evening? What did I miss in the dark? Can I knock that wall down? Show my parents" | Research 2, 3, 4 |
| **Seller or agent** | "Let buyers answer their own first questions, and send me the serious ones, with my details and disclosures already correct" | Research 4, 5 |

The buyer experience is the product. The seller and agent experience is the same model with a contact card attached, so it is built once.

## 4. The first minute

1. You open a link or type `440A Clementi Ave 3`. The block number appears large, the way it is painted on the block.
2. The app recognises the block from open data: completed 2017, 30 storeys, 208 flats, 3-room and 4-room Model A. You pick 4-room.
3. A floor plan draws itself in graphite lines. Then the walls rise out of the lines, room by room, the floor finishes wash in, and daylight sweeps across. This is the signature moment.
4. A small outline of your block appears. You tap the side your living room looks out of. The model turns to match.
5. You drag the sun along its arc. A patch of light crawls across the master bedroom floor from 3:40pm. A line reads: _Master bedroom gets direct west sun 3:40 to 6:50pm, April to August._
6. You tap the wall between kitchen and living room. A tag reads: _Partition wall. Can be removed with an HDB permit._ You tap it away and the space opens.
7. You tap Share. WhatsApp opens with a picture of the flat and a link. Your mother opens it and gets a slow guided tour captioned in Chinese.

## 5. Features

Priority: **P0** ships in the first public version, **P1** follows, **P2** later.

### Getting a flat in

| Feature | Detail | P |
|---|---|---|
| By address | OneMap lookup, then HDB Property Information and resale records to identify the block's flat types, models and floor areas, then a matching template | P0 |
| Template library | Original layouts drawn for this project, one per common flat type, model and era. Twelve templates cover about 85% of recent resale transactions. Mirror toggle, since half of all units are mirrored | P0 (4 templates), P1 (12) |
| Orientation by tap | The block's real footprint from HDB open data; tap the facade your living room faces | P0 |
| By floor plan | Photo, PDF or screenshot. HDB plans follow fixed drawing conventions (thick line for structural, thin for partition, dimensions in mm), so a parser can combine line detection with a vision model for labels. The user then confirms against the original, shown underneath | P1 |
| Share into the app | On Android, forward a floor plan image from WhatsApp straight into Blk | P2 |

### Space

| Feature | Detail | P |
|---|---|---|
| Dollhouse and walk | Roof-off overview and eye-level walk. Tap the floor to glide there on phones; keys and mouse on desktop | P0 |
| Dimensions | Tap a room for m² and sq ft; tap a wall for its length | P0 |
| Bare or furnished | "As HDB hands it over" against a sensibly furnished version | P0 |
| Will it fit | Furniture at Singapore sizes (queen 152×190 cm, king 182×190 cm), or type any width, depth and height from an IKEA or Taobao listing. Flags blocked doors and walkways narrower than 75 cm | P1 |

### Sun

| Feature | Detail | P |
|---|---|---|
| Real sun | Solar position for Singapore's latitude on any date and time, in Singapore time. Solar noon here falls at about 1pm, not 12, so the afternoon sun runs late; the model reflects that | P0 |
| Sun arc | Drag the sun along the day's path drawn over the model. Sky and interface tint follow the hour | P0 |
| Light on the floor | Sun patches through the actual windows, moving as you drag | P0 |
| Plain-language summary | One sentence per room, across the year | P0 |
| Sun-hours map | Floor shaded by hours of direct sun for a day or the year. Answers "where does the bed go" and "will laundry dry in the service yard" | P1 |
| Best time to view | Tells a resale buyer when to visit to see the worst case, with an add-to-calendar button | P1 |
| Neighbouring blocks | Shadows cast by surrounding HDB blocks from their footprints and storey counts | P2 |

### Rules

| Feature | Detail | P |
|---|---|---|
| Wall verdicts | Every wall is one of: structural, household shelter, external, partition. Tap for the verdict, the reason, and the HDB page | P0 |
| Try it | Remove a partition in the model and walk the result. Shelter and structural walls refuse, and say why | P1 |
| Rule cards | The 3-year bathroom rule for new flats, permit list, contractor directory, working hours. Short, sourced, no advice | P1 |

Verdicts on a template are labelled _typical for this flat type_. The floor plan from HDB and the permit decision remain the authority, and the app says so each time.

### Block facts

| Feature | Detail | P |
|---|---|---|
| Fact strip | Lease start and years remaining, storeys, unit mix, recent resale transactions in the block, all from data.gov.sg with the dataset linked | P1 |
| Official shortcuts | Links to HDB's ethnic quota check, resale price search and floor plan purchase | P1 |

No valuation, no price prediction, no opinion.

### Share

| Feature | Detail | P |
|---|---|---|
| The link is the flat | The whole flat is encoded in the link. Whoever opens it sees the same flat. No account, nothing stored on a server | P0 |
| WhatsApp share | Phone share sheet with a snapshot image and caption; link preview card | P0 |
| Reply in WhatsApp | Tap any room, choose "Ask about this", and WhatsApp opens to the sharer with the room named and a link back to that exact view. The chat is the comment thread | P1 |
| Telegram Mini App | Opens full-screen inside Telegram from a link; share to any group | P1 |
| Family tour | Guided walk with captions in English, Chinese, Malay and Tamil, and a large-text mode | P1 |
| Contact card | For sellers and agents: name, contact, and for agents a CEA registration number checked live against the public register, with agency and licence number filled in from the register. The enquiry button opens WhatsApp with a message that states the buyer's HFE status and preferred viewing times | P1 |
| Always-on label | "Computer-generated model, not a photograph of the unit" on every shared view | P0 |
| Compare | Up to four flats side by side: area, sun, lease | P2 |
| Renovation brief | One page with the scaled plan and a scope checklist, to send to several firms so their quotes can be compared line by line | P2 |

### Not building

Listing search. Valuation. Loan and grant calculators. Photoreal AI restyling. Contractor matching. A chatbot. User accounts.

## 6. Singapore knowledge the app carries

Written by hand, reviewed against the official source, and stored as data so it can be corrected without touching code.

- **Flat anatomy:** household shelter (blocks from 1996), service yard, air-con ledge, common corridor, the two window heights in current brochures (standard, and three-quarter height over a 550 mm parapet), unit numbering by floor and stack.
- **Flat types and eras:** which models exist, typical floor areas from the resale dataset, what changed by decade.
- **Sun:** the sun passes north of Singapore from late March to about 19 September and south for the rest of the year, so north-west windows take the afternoon sun mid-year and south-west windows at year end. Sunset swings from about 247° in December to about 293° in June.
- **Renovation rules:** from HDB and MyNiceHome, each with its link.
- **Advertising rules:** the five items CEA requires in an agent's ad, and the AI disclosure expectation.
- **Vocabulary:** MBR, HS, stack, MOP, OTP, HFE, sqft alongside sqm. Copy is plain Singapore English; four interface languages for the tour.

## 7. Integrations

| Integration | What it does | Needs |
|---|---|---|
| WhatsApp share sheet and `wa.me` links | Send a flat; reply about a room; enquire with a seller | Nothing |
| WhatsApp link preview | Card with image and title | Static image at first; a small server function for per-flat images |
| Telegram Mini App | Run inside Telegram; share to groups | A bot created in BotFather (two minutes, done by you) |
| Calendar | Viewing slot and sun-check reminder as an `.ics` file or Google Calendar link | Nothing |
| OneMap | Address lookup | Free token |
| data.gov.sg | Block facts, resale history, building footprints, CEA register | Free API key for higher limits |
| HDB e-services | Deep links to quota check, floor plan purchase, permit application | Nothing |
| Floor plan reading | Vision model behind a server function | Hosting with functions, and an API key |

Everything in the first public version works on plain static hosting. The server pieces are small, stateless, and added only when a feature needs them.

## 8. Design direction

**Idea: blueprint to life.** The plan is the starting state. Walls rise from it. Going back folds them down. Every other change is either the camera moving or the light changing, never a page loading.

- **The model is the page.** No dashboard. Information appears in the scene: dimensions written on the floor, the sun's path drawn in the sky, verdict tags pinned to walls.
- **One control: a lens dial.** Space, Sun, Rules, Share, switched like camera modes at the bottom of the screen. Each lens changes what the model shows.
- **The sun is an object you hold.** You drag it. The room responds.
- **Maquette look.** Warm paper white, graphite line, soft shadow. One orange for sun, one green for "allowed", one red for "not allowed". Block numbers set large, the way they are painted on the blocks. Dimensions and unit numbers in a monospaced face.
- **Local detail, no clichés.** The shelter's steel door, the laundry rack outside the service yard, the shoe rack by the gate, the unit plate reading `#08-123`. No Merlion.
- **Motion with restraint.** Springs of 200 to 600 ms; reduced-motion setting respected.
- **Budget.** Interactive within three seconds on mobile data; smooth on a four-year-old Android phone.

## 9. Architecture

- **Front end:** Vite, Svelte 5 and TypeScript, built as a static site that can also be packed into one self-contained HTML file for previews. Three.js for the scene, written directly for control over performance. Svelte's built-in springs and transitions handle interface motion.
- **Flat format:** one JSON document in millimetres: walls (endpoints, thickness, kind), openings (wall, offset, width, sill and head heights, door swing), rooms (type, outline, finish), fixtures, and metadata (flat type, model, area, north bearing, source, confidence). Compressed into the link.
- **Scene builder:** turns that document into geometry. Templates, uploaded plans and shared links all pass through the same path.
- **Sun:** standard solar position maths, unit-tested against known values (noon altitude of 67.9° to the north on 21 June and 65.2° to the south on 21 December).
- **Block index:** a build script downloads HDB's footprints and property information, simplifies them, and writes small files keyed by postal sector, so a lookup costs a few kilobytes. Refreshed monthly by a scheduled workflow.
- **Live lookups:** OneMap and data.gov.sg from the browser, cached on the device.
- **Server functions, later:** per-flat preview images, short links, floor plan reading, Telegram bot replies. No user database.
- **Privacy:** a flat stays on the device until its owner shares the link. A link carries geometry, not identity. Uploaded plans are not kept.

```
src/lib/plan      format, validation, geometry, link codec
src/lib/engine    scene builder, materials, cameras, controls, sun, heat map
src/lib/sg        solar maths, HDB rules, flat types, furniture sizes, translations
src/lib/data      OneMap and data.gov.sg clients, block index
src/lib/share     WhatsApp, Telegram, calendar, snapshot
src/lib/ui        lens dial, sun arc, tags
scripts/          block index builder
```

## 10. Roadmap

Each milestone ends with something you can open on your phone.

| # | Milestone | Contents | Done when |
|---|---|---|---|
| 1 | **Walls rise** | Project scaffold, flat format, scene builder, one hero flat (4-room, 93 sqm), plan-to-model animation, dollhouse and walk, real sun with the arc control, maquette look | The hero flat loads on a phone, the sun is correct for the date, and it feels good to use |
| 2 | **Know the sun** | Address lookup, block index, orientation by tap, per-room sun sentences, three more templates | Typing a real block gives a correctly oriented flat and a sun summary |
| 3 | **Know the rules** | Wall verdicts with sources, dimensions lens, bare and furnished states, block fact strip | Every wall answers "can I remove this" with a reason and a link |
| 4 | **Pass it on** | Flat-in-a-link, WhatsApp share with snapshot, reply-in-WhatsApp, always-on label, family tour in four languages, contact card with live CEA check, Telegram Mini App | A flat sent to a family chat opens as the same flat, and the agent card verifies a real registration number |
| 5 | **Any flat** | Template library to twelve, floor plan upload with verification, will-it-fit, try-it wall removal, sun-hours map, best time to view | A real HDB floor plan becomes a walkable model in under a minute |
| 6 | **Launch** | Neighbouring-block shadows, compare, renovation brief, one BTO project end to end, method and data page, accessibility pass, launch material | Ready to post publicly and to send to HDB, CEA and GovTech contacts |

Milestone 1 is the next session's work. Milestones 2 to 4 are roughly a session each. Milestone 5 depends on hosting and an API key.

## 11. Trust and compliance

- **Not a government product.** No agency logos or colours. A clear line: built on open data from data.gov.sg and OneMap under the Singapore Open Data Licence; not affiliated with HDB or CEA.
- **HDB plans are HDB's.** Templates are original drawings of typical layouts. Uploaded plans stay with the user.
- **Not advice.** The app describes rules and points to the authority. It does not approve renovations or value flats.
- **CEA alignment.** The disclosure label cannot be switched off. The agent card carries the five required ad details and pulls agency data from the register so it cannot be mistyped.
- **Method page.** How the sun is calculated, where each dataset comes from, what is not modelled (trees, unbuilt neighbours, reflected heat). This is the page a civil servant will read first.

## 12. Risks

| Risk | Response |
|---|---|
| A template differs from the real unit | "Typical layout" label, mirror toggle, adjustable dimensions, link to buy the real plan, upload path in milestone 5 |
| Orientation set wrongly | Footprint tap with compass confirmation; summary states the bearing it used |
| Low-end phones struggle | Quality tiers; one shadow-casting light; no post-processing on mobile |
| Data APIs change or throttle | Static block index, device cache, keyed proxy when a server exists |
| Floor plan reading is unreliable | Never shown unverified; user confirms over the original image |
| Scope creep | The "not building" list in section 5 |

## 13. How we will know it works

- **Speed:** address to walking inside in under 30 seconds.
- **Spread:** share of sessions that send a link, and share of sent links that get opened.
- **Usefulness:** in user sessions, does anyone change a shortlist, a stack choice, or a furniture plan because of what they saw?
- **Seller side:** do enquiries arrive with HFE status filled in?

The assumptions in research section 9 get tested with five users each as soon as milestone 2 exists.

## 14. Decisions and inputs needed from you

| # | Item | Recommendation | When needed |
|---|---|---|---|
| 1 | Name | Decided: Blk | Done |
| 2 | Lead audience for launch | Decided: buyers first; contact card for sellers and agents as a secondary feature | Done |
| 3 | Hosting | Decided: GitHub Pages to start (enable Pages with source "GitHub Actions" in the repository settings); Cloudflare when server functions are needed | Setting needed now |
| 4 | Telegram bot | Create one in BotFather and share the username | Milestone 4 |
| 5 | API key for floor plan reading | An Anthropic API key held as a server secret | Milestone 5 |
| 6 | Five real users | A BTO Telegram group you are in, or friends house-hunting, and one or two agents | After milestone 2 |
