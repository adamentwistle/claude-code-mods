// Office pictures: the characters drawn for this mod, in the flat, outline-free style
// of Kenney's Roguelike packs (16 x 16, a darker shade for edges, no black).
// Each map is one string per row, one key per pixel, `.` clear; a palette
// names the colours, and a look (fur, metal) fills the rest in.

// ---- characters, front view, 16 x 16 like Kenney's people ---------------------

export const ROBOT = [
  ".......a........",
  ".......m........",
  ".....MMMMMM.....",
  "....MmmmmmmM....",
  "....MvvvvvvM....",
  "....MvVvvVvM....",
  ".MMMMmmmmmmMMMM.",
  "MmmmMmmmmmmMmmmM",
  "MmmmmccccccmmmmM",
  "MmmmmcLccLcmmmmM",
  "MmmmccccccccmmmM",
  "MmmMMMMMMMMMMmmM",
  "MmmMmmmmmmmmMmmM",
  "MmmMmmmmmmmmMmmM",
  ".MMMmmMMMMmmMMM.",
  "...MmmM..MmmM...",
];

export const CRITTER = [
  "................",
  "................",
  "..QQQQQQQQQQQQ..",
  ".QqqqqqqqqqqqqQ.",
  ".QqqeeqqqqeeqqQ.",
  ".QqqeeqqqqeeqqQ.",
  ".QqqqqqqqqqqqqQ.",
  "QqqqqqqqqqqqqqqQ",
  "QqhqqqqqqqqqqhqQ",
  ".QqqqqqqqqqqqqQ.",
  ".QqqqqqqqqqqqqQ.",
  "..QQQQQQQQQQQQ..",
  "..Q.Q.Q..Q.Q.Q..",
  "..Q.Q.Q..Q.Q.Q..",
  "................",
  "................",
];

export const CAT = [
  "....D......D....",
  "...DpD....DpD...",
  "...DFFDDDDFFD...",
  "..DFFFFFFFFFFD..",
  "..DFeFFFFFFeFD..",
  "..DFFFFnnFFFFD..",
  "...DFFFmmFFFD...",
  "..DFFFFFFFFFFD..",
  ".DFFFwwwwwwFFFD.",
  ".DFFwwwwwwwwFFD.",
  ".DFFwwwwwwwwFFD.",
  ".DFFFwwwwwwFFFD.",
  ".DDFFFFFFFFFFDD.",
  "..DDFFDDDDFFDD..",
  "...wwF....Fww...",
  "................",
];

export const DOG = [
  "................",
  "....DFFFFFFD....",
  "...DFFFFFFFFD...",
  "..EEFFFFFFFFEE..",
  "..EEFeFFFFeFEE..",
  "..EEFFFwwFFFEE..",
  "...EFFwnnwFFE...",
  "....FFwmmwFF....",
  "..DFFFFFFFFFFD..",
  ".DFFFwwwwwwFFFD.",
  ".DFFwwwwwwwwFFD.",
  ".DFFwwwwwwwwFFD.",
  ".DFFFwwwwwwFFFD.",
  "..DDFFFFFFFFDD..",
  "...FFF....FFF...",
  "................",
];

export const OWL = [
  "...D........D...",
  "...DD......DD...",
  "...DFFFFFFFFD...",
  "..DFyyyFFyyyFD..",
  "..DyyeyFFyeyyD..",
  "..DFyyyFFyyyFD..",
  "..DFFFFbbFFFFD..",
  ".DFFFFFFbFFFFFD.",
  ".DDFFwwwwwwFFDD.",
  ".DDFwwDwwDwwFDD.",
  ".DDFwwwwwwwwFDD.",
  ".DDFwwDwwDwwFDD.",
  "..DDFwwwwwwFDD..",
  "...DDDDDDDDDD...",
  "....b......b....",
  "................",
];

// ---- details -----------------------------------------------------------

export const CROWN = ["y.y.y", "yyyyy", "YYYYY"];

// Fur and feather colours, the pairs a look picks from.
export const HD_FURS = {
  cat: [
    [0xe8a35a, 0xb8763a],
    [0x9a9fa8, 0x6e737c],
    [0x4a454f, 0x2e2b33],
    [0xf2ebe0, 0xc9bfb0],
  ],
  dog: [
    [0xd2a676, 0x8a5c38],
    [0xf2e8d8, 0x9a7a58],
    [0x7a5438, 0x4a3222],
    [0xe0bb80, 0xa07c48],
  ],
  owl: [
    [0xa88660, 0x6e5438],
    [0xd8d2c4, 0x9a9384],
    [0x7a6a58, 0x4e4236],
  ],
};

export const CONFETTI_HD = [0xff5c8a, 0xffd23f, 0x5fcf55, 0x6fa8f5, 0xc084fc, 0xff8c42];
