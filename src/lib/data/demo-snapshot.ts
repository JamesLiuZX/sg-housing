/**
 * Snapshot of Blk 440A CLEMENTI AVE 3 (postal 121440), taken 2026-11-14.
 * Written by scripts/build-demo.mjs from OneMap, data.gov.sg and the block
 * index; do not edit by hand, run `npm run demo`. src/lib/data/demo.ts turns
 * it into the same typed results the live lookups return.
 *
 * Contains information from HDB Property Information, Resale flat prices based on
 * registration date from Jan-2017 onwards and HDB Existing Building accessed on 14 November 2026
 * from data.gov.sg which is made available under the terms of the Singapore Open
 * Data Licence version 1.0 https://data.gov.sg/open-data-licence. Address from OneMap.
 */

import type { Shard } from './shard';

export const SNAPSHOT_TAKEN = "2026-11-14T04:02:38.544Z";

/** The OneMap result for the address, as OneMap returned it. */
export const SNAPSHOT_HIT: Record<string, string> = {"BLK_NO":"440A","ROAD_NAME":"CLEMENTI AVENUE 3","BUILDING":"ANANIAS CENTRE (CLEMENTI)","ADDRESS":"440A CLEMENTI AVENUE 3 ANANIAS CENTRE (CLEMENTI) SINGAPORE 121440","POSTAL":"121440","LATITUDE":"1.315998673983866","LONGITUDE":"103.7641976249758"};

/** The block's row in HDB Property Information, as data.gov.sg returned it. */
export const SNAPSHOT_FACTS: Record<string, string> = {"blk_no":"440A","street":"CLEMENTI AVE 3","max_floor_lvl":"30","year_completed":"2017","residential":"Y","commercial":"N","market_hawker":"N","miscellaneous":"Y","multistorey_carpark":"N","precinct_pavilion":"N","bldg_contract_town":"CL","total_dwelling_units":"208","1room_sold":"0","2room_sold":"54","3room_sold":"102","4room_sold":"52","5room_sold":"0","exec_sold":"0","multigen_sold":"0","studio_apartment_sold":"0","1room_rental":"0","2room_rental":"0","3room_rental":"0","other_room_rental":"0"};

/** The block's resale records, newest first, as data.gov.sg returned them: one row per sale in `columns` order. */
export const SNAPSHOT_RESALES = {
  block: "440A",
  street: "CLEMENTI AVE 3",
  town: "CLEMENTI",
  total: 24,
  columns: ["month","flat_type","storey_range","floor_area_sqm","flat_model","lease_commence_date","remaining_lease","resale_price"],
  rows: [
    ["2026-09","3 ROOM","25 TO 27","69.00","Model A","2018","90 years 11 months","890000"],
    ["2025-10","4 ROOM","28 TO 30","87.00","Model A","2018","91 years 10 months","1100000"],
    ["2025-08","4 ROOM","07 TO 09","87.00","Model A","2018","92 years 01 month","1000000"],
    ["2025-07","4 ROOM","25 TO 27","87.00","Model A","2018","92 years 02 months","1000000"],
    ["2025-07","4 ROOM","07 TO 09","87.00","Model A","2018","92 years 02 months","1050000"],
    ["2024-10","3 ROOM","22 TO 24","69.00","Model A","2018","92 years 11 months","840000"],
    ["2024-08","3 ROOM","10 TO 12","69.00","Model A","2018","93 years 02 months","780188"],
    ["2024-02","3 ROOM","16 TO 18","69.00","Model A","2018","93 years 07 months","738000"],
    ["2024-02","3 ROOM","28 TO 30","69.00","Model A","2018","93 years 07 months","820000"],
    ["2024-01","4 ROOM","04 TO 06","87.00","Model A","2018","93 years 08 months","933000"],
    ["2023-08","4 ROOM","16 TO 18","87.00","Model A","2018","94 years 01 month","980000"],
    ["2023-06","3 ROOM","13 TO 15","69.00","Model A","2018","94 years 03 months","700000"],
    ["2023-05","2 ROOM","07 TO 09","47.00","Model A","2018","94 years 03 months","492000"],
    ["2023-05","3 ROOM","22 TO 24","69.00","Model A","2018","94 years 04 months","690000"],
    ["2023-03","3 ROOM","28 TO 30","69.00","Model A","2018","94 years 05 months","720000"],
    ["2023-02","3 ROOM","04 TO 06","69.00","Model A","2018","94 years 07 months","645000"],
    ["2023-02","3 ROOM","19 TO 21","69.00","Model A","2018","94 years 07 months","700000"],
    ["2023-01","3 ROOM","16 TO 18","69.00","Model A","2018","94 years 08 months","670000"],
    ["2023-01","4 ROOM","04 TO 06","87.00","Model A","2018","94 years 09 months","790000"],
    ["2023-01","4 ROOM","25 TO 27","87.00","Model A","2018","94 years 07 months","940000"],
    ["2022-01","3 ROOM","04 TO 06","69.00","Model A","2018","95 years 08 months","618888"],
    ["2021-05","3 ROOM","04 TO 06","69","Model A","2018","96 years 04 months","588000"],
    ["2021-04","4 ROOM","10 TO 12","87","Model A","2018","96 years 04 months","800000"],
    ["2020-12","3 ROOM","10 TO 12","69","Model A","2018","96 years 09 months","598000"]
  ]
};

/** The block and every block within 150 m of it, cut from public/blocks/12.json without re-encoding. */
export const SNAPSHOT_SHARD: Shard = {
  v: 1,
  sector: "12",
  origin: [1.312272,103.765345],
  unit: 0.1,
  blocks: [
    ["120319","319","xh1gYC0ZTj13j1NTd17x1Uh2k1Vs191fAx1X1uApIi6q386DOk1Q_2a5p1TNi1q1Uz2a5t1VJw10Sy102y5z100u1y102y5x101m3y102y5z100q1-100y5z102m3y100y5z100q1-100y5r110W190"],
    ["120320","320","tOsj9WUeHg7sCSDy15u1Mc1i1Gs1Bw1X1i1NGg7sC1qHx101o2b310j2d20710Rp101x5-100p1x101v5-107z1DPp1U_2X5s1TPj1p1W1_2Z5s1Tt1X3p1W1z2X5q1VPj1p1W1_2Z5s1TDPp1b1Ts1_4z2Up1l1RVq1X5z2Up1z2t1Ts1b5_2Up1h1PVq1X5z2Sh1PD27"],
    ["120439","439","nj4aq8R9n5d79d1Sp1k7r5O3ME8Sd2cEDI"],
    ["120440","440","zw2oZAn5z2Ql10_4U00Z2U04Rm30480T-108F5h2Z200V500x84PC5o210v4hS10t2J01b6W100H-100t2P00TX201nEhF00d4-200OU00Nu102OY100Ns400OW401z5s600EkB30MY800e1c2e10C49u2q1Rm1cAs5m3_5ICW1r1q4s2e2w4_CWP0gAhAYK"],
    ["120441","441","xp1Wf7h2Ef29Z2X1pExAqAZIbQlFrFvMpBy7v1jBY5j3p2Rb1NVVj1h2Hr22h1Ur2u1Z2a1Pq2Ti13u2Gk2i1UW1i1k2Ai1g9h6W6u8g3d2iF-Lt1a1w5w25Cu6c369Y3m1a2h4qBm5KFg1EQUGo1Dc1P48Ca3r1e4W2fFuY1i1g2Gk23W2Na2f1a2h1e1"],
    ["120442","442","jp2Yy2k1KKf1qJe9eEWe1h1Gg1u3h8uHp9q6X2Bj3x4-1p1X1n1y4h3W1o1i1RTb1i2X5u1Ok1Z3p1PW2f4a17UCHr1t1K_1n5u1Jd1h3r1I_1n5u1HHl1t1I_1l5w1JHl1v1Kz1n5s1JHl1r1In1l4ITUFl2Z1Ns1bFb7"],
    ["120443","443","rs3im3m700Y2e200u7z101k2_300UWD61w1u12i3k1Op1i5i218m1K45i5k2Nw1-6g3W2-2f1SSg1q1X1g3w4l1a1Qe1o1X1i3y4l1Y1GOf6i4XBtF_1x1rDj6xHB"],
    ["121318","318A","lGwdAs3Gq5e3-5gAk1Po2i4j1Qq5u90qP9Cp405p1j72LSz1g1X1AX22FF3Z2D09d2b1z1x1f1d2Bb2Iv1i1X1W25Y2v100c1x401h88Z1EZ1k1v1W1LO00lBt100X5s100rDo4t7u2Z2"],
    ["121440","440A","xc2qX8h1c2D7Ja1p1b1j1o2c1K47GAJa1IAX1k17Ot1V5CD0b1L59AJh4t27St1d156Qj1t2p176q1t2RFJY1Z4h2Sj10Vd3v10Db100k1y170e1E06q2_100EB6h10B50LX30360Bj300Qt300Jb208_1738FE00b1G00Ag2506K009g100X1w210b1v200Z1d4506F00b1F05F6f1500Pc200Ju300W1k300R4Ik104D0KY300RY200EY215q2D00e1z170k1B0KC69o3Y21n3C00Ea200DE00Y5n100OCL-1a1i1h2M9OE3a1u2o1Od118-1SHMo4i2CHC0e1M6A7C"],
    ["121441","441A","bW1sk5t6b3a1x1X1F_1g484He1p5p2s3v7n2b1Or1w3w1IZ1F7GVp1HALj4Z2k2X5s6a3X1y1W1GY2f493Kd1o5q2r3w7k1MNq1X2TR-1W3k19Ou2g1"],
    ["122440","440B","dn3mw8Z203Ip300Tb707Sl300Hb200t2W150d168q14k292X10RJ00t3Z300x2c210f1x160b1D05p2W200DA5k10A60MY306506Y320NA5k10A60EW205o2D00g1x190k1z26A62s4B07m1KC0Ic300a1w1805y230c1A04A"],
    ["122441","441B","j_2wx4WA_6iF-LZ1O9DHACGHCH67BLGOa1k1Tm3o138c2e18Hw7u33C-1U47A6MNS2W2W1AK3Me1Im1v3Y2UEVW3e1b5mBdOlBKd1G88HH7AJCDC6CPd1H5GRDVMh2n3B8f1p2FCz4b7A5d1v15459TANFd1x12PEDPZ1d4W3"],
    ["123440","440C","hi3ms9GZ4g2Ao270Z1-200FKB7l1B00Z2t300x2a206X1Z1009f340Fb100FT05X3c200Nu300Oa510Go300Ru300Ia20Fc4J009_210Af100Y1p100g1K00w4J00e1C6B00Uq440W1a206G7i2z100U37l30380NZ520Ln300Y1t300H"]
  ]
};
