# Research brief: where Singapore home-seekers actually get stuck

_Desk research, 12 Nov 2026. Every figure links to its source in [Sources](#sources). Where the evidence is thin or second-hand, it says so._

## 1. The short version

Six findings shape the product. Each one is a problem that exists today, with evidence, and with someone already trying to solve part of it.

1. **People commit to a flat they cannot picture.** BTO buyers choose a unit from a 2D brochure plan and a scale model. GovTech's own 2025 hackathon team stated the problem in almost these words, and when they tested with recent BTO buyers the most-wanted feature was sunlight direction. Their answer needed a VR headset and manual preparation per project, so it has not scaled.
2. **Sun is a first-order buying criterion, and the tools stop at the window.** Free and paid checkers now tell you which way a block or unit faces. None shows where the light lands inside your layout, and the paid BTO tool says outright that it cannot model how deep the sun reaches.
3. **General AI gets Singapore flats wrong in specific, checkable ways.** In a published test, ChatGPT misjudged which beds fit a bedroom and Claude proposed putting the laundry in the household shelter. The failures are scale and local rules, which are both things a purpose-built tool can encode.
4. **Viewings are expensive for both sides and filter badly.** Sellers report 50 to 60 enquiries a week with about a third serious, repeated no-shows, and buyers who turn out to be ineligible. Buyers report evening viewings in dim light, which is exactly when you cannot judge sun or space.
5. **The regulator is moving toward verified, disclosed, consumer-first listings.** CEA requires agents to disclose AI-enhanced images, is building a listing-verification platform for 2027, and is studying making HDB's own Resale Flat Listing service the default. A tool that is honest by construction fits where policy is going.
6. **The conversation already lives in WhatsApp and Telegram.** WhatsApp reaches about 97% of residents. Telegram hosts resident-run BTO groups of up to 10,000 members per estate. No housing visualisation tool is built to travel through either.

The gap is the intersection: **a true-to-scale model of one specific flat that knows its real sun, knows HDB's rules, and is built to be passed around a family chat.** Each neighbouring product covers one corner of that.

## 2. Method and limits

- About 45 searches and page reads across government sites (HDB, CEA, MND, MTI, GovTech, data.gov.sg), trade press (EdgeProp, Stacked Homes, 99.co, Qanvast), consumer forums, and competitor sites.
- Four government APIs were called live from this environment to confirm they respond and allow browser access (section 7).
- One current HDB sales brochure (Sembawang Deck, Feb 2026) was read page by page to see what a buyer is actually given.
- **Not done:** no interviews, no surveys. Forum posts are anecdotes. Agent pain points are inferred from regulatory statistics and seller accounts, not from agents directly. Section 9 lists what must be validated with real users before it is treated as fact.

## 3. The market in numbers

| Fact | Figure | Source |
|---|---|---|
| BTO flats planned for 2026 | about 19,600, over 4,000 with waits under 3 years | [99.co][bto2026] |
| BTO flats planned 2025 to 2027 | 55,000, with government open to more | [99.co][bto2026] |
| Applicants in one launch (Oct 2024) | about 35,600 for about 8,500 flats | [GovTech][insight] |
| HDB resale transactions, 2025 | about 26,000 (five-year low) | [EdgeProp][resale2025] |
| Million-dollar resale flats, 2025 | about 1,590 | [EdgeProp][million] |
| Registered property agents, 1 Jan 2026 | 36,816 | [CEA][ceastats] |
| Agents completing no transaction in a year | about 40%; median two residential deals a year | CEA figures via [Home & Decor][threedeals] |
| RFL verified listings since May 2024 | over 12,500; over 60% went on to complete | [Home & Decor][ceaverify] |
| Renovation complaints to CASE, 2024 | 962; about 97% against non-CaseTrust firms | [MND][mndreno] |
| Renovation prepayment losses, 2024 | S$1.93 million | [Law Watch][prepay] |
| WhatsApp reach | about 97% of residents | [WARC][warc] |
| Telegram reach | about 49% of internet users | [MarketingAgency.sg][socialstats] |

From the resale dataset itself (244,539 transactions since 2017, pulled live): in the last 24 months, **ten flat type and model combinations account for 85% of resale transactions**, led by 4-room Model A (29%) and 5-room Improved (17%). A quarter of resale flats sold were built in the 1980s and a quarter in the 2010s. HDB layouts are standardised enough that a small template library covers most of the market.

## 4. Journeys and bottlenecks

### 4.1 BTO buyer

| Stage | What happens | Bottleneck | Evidence |
|---|---|---|---|
| Launch to application | Reads brochure: site plan, unit distribution chart, storey plans, coloured layout ideas | Brochure plans carry a scale bar but no room dimensions; layouts are shown once, not per mirrored unit | Brochure read directly ([HDB][brochure]) |
| Unit selection | Shortlists stacks, then picks at an HDB appointment | Must judge sun, facing, noise and layout from 2D; show flats are generic and "may not match your unit" | [GovTech][insight], [HDB 360 tours][hdb360] |
| The wait (2 to 4 years) | Plans renovation with only the plan; joins the estate Telegram group | Cannot test furniture or hacking ideas at scale; designers advise engaging only 6 months before keys | [Qanvast][qanvastbto], [Stomp][stomp] |
| Keys and renovation | Engages a designer; applies for permits | Rules are easy to breach (shelter walls, structural walls, 3-year bathroom rule); quotes are lump sums that cannot be compared | [MyNiceHome][mnh], [Stacked][illegal] |

**Who is working on it:** HDB publishes 360° tours of a show flat per project. GovTech's "Insight" team built a VR prototype with year-round sunlight. BTO Analysis and Compass Overlay sell per-unit sun direction reports. **What is left:** a zero-install model of the buyer's own unit type and orientation, with sun inside the rooms.

### 4.2 Resale buyer

| Stage | Bottleneck | Evidence |
|---|---|---|
| Shortlisting | Fake, duplicate and already-sold listings waste time | [CEA platform][ceaverify]; forum complaints ([PropertyGuru][sold]) |
| Viewing | Slots are evenings and weekends; a 9pm viewing in "yellowish dim light" tells you nothing about sun or true size | [PropertyGuru Q&A][dim] |
| Viewing | The recommended checklist is long: room facings, cross-ventilation, distance to the opposite block, which bedrooms share structural walls, whether the kitchen can be opened | [Stacked][viewing] |
| Deciding | Flats blur together; spouse and parents were not there; the option period is short | Inferred from the process; needs validation |
| After OTP | Agent stops responding when the buyer wants to re-enter to measure for renovation | [PropertyGuru Q&A][stonewall] |

**Who is working on it:** portals (listings), HDB's RFL (verified listings), sunfacing.com (block-level sun, neighbour shadows, schools, WhatsApp sharing, built by an agent as lead generation). **What is left:** a way to pre-screen a specific flat's space and light before spending an evening on it, and to carry the flat home to the people who were not at the viewing.

### 4.3 Seller (especially without an agent)

Stacked Homes' account of selling your own flat lists seven difficulties. Four of them are about unqualified attention: 50 to 60 calls a week on a popular listing with roughly a third serious, questions the listing already answers, buyers who confirm three times and still do not show, and buyers who discover weeks in that they are ineligible ([Stacked][selfsell]). Policy is pushing more owners this way: CEA is studying letting consumers list on portals themselves and making RFL the default for resale flats ([Home & Decor][ceaverify]).

**What is left:** a way for a buyer to answer their own first-round questions (how big, how bright, what could I change) before taking a viewing slot.

### 4.4 Agent

There are more agents than ever and most close very little: about 40% complete no transaction in a year, and from 2027 registration renewal is tied to completing three transactions in three years or passing an exam ([Home & Decor][threedeals]). The large agencies are investing in internal AI: ERA reports over 20 AI functions in its SALES+ app and 534,000 AI queries ([ERA][era]). At the same time CEA has received complaints about AI-altered listing images and now expects disclosure, with further guidance under review ([Law Watch][ceaai], [MTI][mtiai]).

**What is left:** an agent can already generate a pretty picture. What they lack is a listing asset that is cheap, differentiating, and safe to send because the disclosure and their CEA details are built in. _This is the weakest-evidenced segment: no agent was interviewed._

## 5. What already exists

| Product | What it does well | Where it stops |
|---|---|---|
| [HDB 360° show flat tours][hdb360] | Official, free, real finishes | One generic unit with every optional component; not your layout; no sun |
| [GovTech {build} "Insight"][insight] | Life-size BTO units with year-round sunlight; tested with real buyers | Needs a headset; each project prepared by hand; hackathon stage |
| [sunfacing.com][sunfacing] | Address search, sun direction, shadows from neighbouring buildings, schools within 1 km, compare, share to WhatsApp | Models the point outside the window; no interior, no floor plan |
| [BTO Analysis][btoanalysis], Compass Overlay | Per-unit, per-room sun direction for BTO projects | Direction only, not depth; neighbouring blocks not modelled; no 3D; paid |
| [Smart Calculator sun simulator][smartcalc] | Sun patch in a room from typed dimensions | Synthetic rooms, one window, everything entered by hand |
| [StoreySG][storey] | Trace a floor plan to true scale; live 2D and 3D; plain-language edits; CAD export | A design tool that takes effort; no sun, no HDB rules, no sharing flow beyond co-editing |
| Homeez, Homu, RoomGPT, ChatGPT renders | Fast style images; cost estimates; vendor matching | Images do not follow the real plan ([Qanvast][qanvastai]); feasibility is the designers' stated worry ([SCMP][scmp]) |
| Planner 5D, Coohom, Homestyler | Full editors with large catalogues | Hours of work; nothing Singapore-specific |
| Matterport and portal 360° tours | Photographic truth of a finished home | Needs the home to exist and a camera visit; cannot show an unbuilt flat or a hacked wall |
| PropertyGuru, 99.co, HDB RFL | Listings; RFL listings are verified | Not visualisation |

The crowded space is **style** (what could it look like). The open space is **truth** (what is it actually like, and what am I allowed to do).

## 6. Policy and regulatory currents

- **AI disclosure in property ads.** In December 2025 CEA stated that agents who use AI to enhance photographs must tell consumers the images were enhanced or generated by AI, and noted complaints about ads without sufficient disclaimers. In February 2026 MTI confirmed CEA is reviewing its regulations to give further guidance ([Law Watch][ceaai], [MTI][mtiai]).
- **Listing verification.** Announced 28 July 2026: a CEA platform to verify listing authenticity launches in 2027. Also under study: consumer ratings on the public register, mandatory estate agency agreements, RFL as the default for resale flats, and consumer self-listing ([Home & Decor][ceaverify]).
- **Agent advertising basics.** Ads must carry the salesperson's name, registration number and contact number, plus the agency's name and licence number ([CEA guidelines][ceaads]).
- **Renovation rules.** Permits before hacking any wall; shelter walls never hacked or drilled; 3-year hold on removing bathroom finishes in new flats; contractors from HDB's directory; noisy work Monday to Friday, 9am to 5pm ([MyNiceHome][mnh]). Structural walls are the thick black lines on the HDB plan ([Stacked][illegal]). PPVC flats follow the same partition rules ([Qanvast][ppvc]).
- **HDB copyright.** The brochure states HDB owns copyright in all its plans, and that the plans are not representations of fact ([HDB][brochure]). The product must draw its own layouts and never redistribute HDB's drawings.

## 7. Open government data, verified live

All four were called from this environment on 12 Nov 2026. All returned data with `access-control-allow-origin: *`, so a browser can call them directly.

| Source | What it gives | Result of live test |
|---|---|---|
| [OneMap search][onemap] | Address or postal code to coordinates | "440A Clementi Ave 3" resolved to Clementi Cascadia, postal 121440. Works without a token today but returns a notice asking for one; plan for a free token |
| data.gov.sg [HDB Property Information][dsprop] | Per block: storeys, year completed, unit mix by flat type | 13,000+ blocks |
| data.gov.sg [Resale Flat Prices][dsresale] | Every resale since 2017: block, flat type, model, storey range, floor area, lease start, price | Filter by block works; 24 transactions for Blk 440A, latest Sep 2026; data runs to the current month |
| data.gov.sg [HDB Existing Building][dsbldg] | Footprint polygon per block with block number and postal code | 13,509 polygons, about 75 vertices each (detailed enough to show facade steps), updated 8 Nov 2026, 57 MB |
| data.gov.sg [CEA Salesperson Information][dscea] | Name, registration number, validity dates, agency, licence number; updated three times a day | Lookup works |

Notes: data.gov.sg enforces rate limits and offers API keys for higher limits ([guide][dslimits]). NUS Urban Analytics Lab also publishes an open 3D HDB dataset ([hdb3d-data][hdb3d]). Together these make three things possible without any partnership: recognising a flat from its address, orienting it from the block footprint, and casting neighbouring blocks' shadows from footprint plus storey count.

## 8. Channels

- **WhatsApp** is where agents, buyers and families already talk. A link shared there shows a preview card from the page's Open Graph tags, and a phone's share sheet can pass an image and caption straight into a chat. Both work without WhatsApp's business API.
- **Telegram** carries the estate communities. One Tengah group has about 10,000 members and estate groups run topic channels for renovation and group buys ([Stomp][stomp]). Telegram Mini Apps run a web app full-screen inside Telegram, opened from a link, with native share ([Telegram][tgapps]). A flat model can be opened and passed around without leaving the group.
- **Floor plans arrive as images.** BTO buyers download theirs from the HDB portal; resale buyers get one from the agent, the RFL listing, or HDB's purchase service at about S$5 ([Qanvast][floorplan]). In practice that image is forwarded over WhatsApp.

## 9. What is not yet known

These are assumptions the plan depends on. Each needs a handful of real users, not more desk research.

| Assumption | How to test |
|---|---|
| A buyer can correctly mark which side of the block their living room faces | Five people, their own block, compare against a compass |
| A typical-layout template is close enough to be useful for a resale flat | Compare five templates against real purchased plans |
| Agents will send a model link in place of a floor plan image | Ask five agents; offer it for one live listing each |
| Parents engage with a captioned tour in their own language | Watch three families use it |
| BTO Telegram groups will pass a link around unprompted | Seed one group with one project |

## 10. Problems deliberately left alone

- **Affordability, grants and loans.** HDB, CPF and the banks publish calculators. Getting a number wrong here does real harm.
- **Listing search and valuation.** Portals and RFL own this; CEA's 2027 platform addresses authenticity.
- **Photoreal AI styling.** Crowded, and the direction CEA is scrutinising.
- **Contractor matching.** Lead-selling is how the existing platforms make money and where the trust problems are.

## Sources

Retrieved 12 Nov 2026.

- [GovTech {build} 2025: Insight][insight]
- [HDB sales brochure, Sembawang Deck, Feb 2026][brochure]
- [HDB virtual tour example (Dakota One)][hdb360]
- [MyNiceHome: How to renovate your HDB flat][mnh]
- [CEA industry statistics][ceastats]
- [CEA advertising guidelines][ceaads]
- [CEA on responsible AI use, forum reply via Singapore Law Watch][ceaai]
- [MTI written reply on AI-generated images in ads][mtiai]
- [MND written answer on renovation contractor accountability][mndreno]
- [Home & Decor: CEA listing-verification platform from 2027][ceaverify]
- [Home & Decor: three transactions in three years][threedeals]
- [Singapore Law Watch: prepayment losses 2024][prepay]
- [99.co: 19,600 BTO flats in 2026][bto2026]
- [EdgeProp: resale transactions at five-year low][resale2025]
- [EdgeProp: million-dollar flats 2025][million]
- [ERA: AI capabilities in SALES+][era]
- [Stacked Homes: ChatGPT vs Claude on floor plans][aitest]
- [Stacked Homes: selling your own flat][selfsell]
- [Stacked Homes: viewing a resale flat][viewing]
- [Stacked Homes: illegal HDB renovations][illegal]
- [Qanvast: after your BTO queue number][qanvastbto]
- [Qanvast: can AI replace interior designers][qanvastai]
- [Qanvast: PPVC flats][ppvc]
- [Qanvast: downloading your HDB floor plan][floorplan]
- [SCMP: AI and Singapore's renovation landscape][scmp]
- [Stomp: BTO Telegram groups][stomp]
- [WARC: WhatsApp in Singapore][warc]
- [MarketingAgency.sg: social media statistics][socialstats]
- [PropertyGuru Q&A: late viewing in dim light][dim]
- [PropertyGuru Q&A: agent stonewalls after OTP][stonewall]
- [PropertyGuru Q&A: sold listings left up][sold]
- [sunfacing.com][sunfacing], [BTO Analysis][btoanalysis], [Smart Calculator][smartcalc], [StoreySG][storey]
- [OneMap API][onemap], [data.gov.sg rate limits][dslimits], [NUS hdb3d-data][hdb3d], [Telegram Mini Apps][tgapps]
- data.gov.sg datasets: [HDB Property Information][dsprop], [Resale Flat Prices][dsresale], [HDB Existing Building][dsbldg], [CEA Salesperson Information][dscea]

[insight]: https://build.tech.gov.sg/projects/2025/Insight
[brochure]: https://assets.hdb.gov.sg/residential/buying-a-flat/finding-a-flat/sales-brochure/26FEBBTO_pdf_selection/sembawang_deck.pdf
[hdb360]: https://assets.hdb.gov.sg/community/dakota_one/index.html
[mnh]: https://www.mynicehome.gov.sg/hdb-how-to/renovate-your-flat/
[ceastats]: https://www.cea.gov.sg/about-cea/newsroom-publications/industry-statistics/
[ceaads]: https://www.cea.gov.sg/docs/default-source/consumers/advertising-guidelines.pdf
[ceaai]: https://www.singaporelawwatch.sg/Headlines/property-agents-must-use-ai-in-responsible-way-that-does-not-mislead-consumers-forum
[mtiai]: https://www.mti.gov.sg/newsroom/written-reply-to-pqs-on-regulations-for-advertisements-that-make-false-claims-by-using-ai-generated-images
[mndreno]: https://www.mnd.gov.sg/newsroom/speeches/view/written-answer-by-ministry-of-national-development-on-accountability-framework-for-renovation-contractors
[ceaverify]: https://www.homeanddecor.com.sg/property/fake-duplicated-property-listings-ceas-new-online-platform-will-help-consumers-verify-listings-2027
[threedeals]: https://www.homeanddecor.com.sg/property/property-agents-need-close-3-transactions-3-years-or-risk-retaking-exams
[prepay]: https://singaporelawwatch.sg/Headlines/consumers-lost-almost-2m-in-prepayments-in-2024-highest-losses-from-home-renovations-case
[bto2026]: https://www.99.co/singapore/insider/hdb-plans-19600-bto-flats-in-2026-over-4000-with-shorter-waits/
[resale2025]: https://www.edgeprop.sg/property-news/hdb-resale-prices-plateaued-4q2025-transactions-sink-five-year-low
[million]: https://www.edgeprop.sg/property-news/over-1500-million-dollar-hdb-resale-flats-sold-2025
[era]: https://www.era.com.sg/press-release/leading-the-future-of-real-estate-era-singapore-expands-ai-powered-capabilities-in-sales-app-to-further-elevate-agent-experience
[aitest]: https://stackedhomes.com/chatgpt-vs-claude-singapore-condo-floor-plans-review/
[selfsell]: https://stackedhomes.com/why-selling-your-own-hdb-flat-isnt-as-easy-as-you-think-7-hidden-difficulties-to-be-prepared-for/
[viewing]: https://stackedhomes.com/the-ultimate-step-by-step-walkthrough-to-viewing-a-resale-hdb-like-a-pro-with-pictures/
[illegal]: https://stackedhomes.com/interior/10-illegal-hdb-renovations-you-may-not-be-aware-of-beware-a-5000-fine/
[qanvastbto]: https://qanvast.com/sg/articles/whats-next-after-getting-your-bto-queue-number-321
[qanvastai]: https://qanvast.com/sg/articles/can-ai-replace-interior-designers-heres-where-it-wins-and-fails-3576
[ppvc]: https://qanvast.com/sg/articles/what-are-ppvc-flats-plus-answers-from-hdb-to-renovation-questions-2830
[floorplan]: https://qanvast.com/sg/articles/how-do-i-download-my-hdb-floor-plan-for-both-bto-and-resale-flats-3635
[scmp]: https://www.scmp.com/week-asia/lifestyle-culture/article/3327881/how-ai-redefining-singapores-home-renovation-landscape-its-so-easy
[stomp]: https://www.stomp.sg/news/bto-telegram-groups-connect-thousands-new-kampung-spirit
[warc]: https://www.warc.com/newsandopinion/news/whatsapp-facebook-lead-singapore/en-gb/37425
[socialstats]: https://marketingagency.sg/social-media-statistics-singapore/
[dim]: https://www.propertyguru.com.sg/property-investment-questions/i-am-a-couple-buyer-pr-was-looking-for-resale-we-search-flat-via-this-platform-and-contact-seller-agent-at-first-viewing-on-monday-night-is-about-9pm-ok-view-delay-until-945pm-then-we-view-walk-aro-484883
[stonewall]: https://www.propertyguru.com.sg/property-investment-questions/what-do-you-do-when-the-agent-stonewalls-you-after-otp-is-done-and-you-rsquo-re-trying-to-get-an-appt-to-view-the-unit-to-assess-reno-needs-unable-to-contact-seller-directly-agent-is-most-uncooperativ-516289
[sold]: https://www.propertyguru.com.sg/property-investment-questions/why-are-some-agents-not-removing-property-listings-that-are-sold-so-irritating-to-enquire-and-told-me-they-are-sold-some-even-keep-on-advertising-the-flat-despite-being-sold-why-341559
[sunfacing]: https://sunfacing.com/
[btoanalysis]: https://btoanalysis.com/why-avoid-afternoon-sun-in-singapore-hdb-units
[smartcalc]: https://www.smartcalculator.sg/housing/flat-sun-shade-simulator
[storey]: https://storeysg.pages.dev/guides/why-storeysg-different/
[onemap]: https://www.onemap.gov.sg/apidocs/
[dslimits]: https://guide.data.gov.sg/developer-guide/api-overview/api-rate-limits
[hdb3d]: https://github.com/ualsg/hdb3d-data
[tgapps]: https://core.telegram.org/bots/webapps
[dsprop]: https://data.gov.sg/datasets/d_17f5382f26140b1fdae0ba2ef6239d2f/view
[dsresale]: https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view
[dsbldg]: https://data.gov.sg/datasets/d_16b157c52ed637edd6ba1232e026258d/view
[dscea]: https://data.gov.sg/datasets/d_07c63be0f37e6e59c07a4ddc2fd87fcb/view
