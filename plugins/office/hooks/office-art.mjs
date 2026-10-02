// Office: the artwork. Every sprite is a palette-indexed pixel map: one string
// per row, one character per pixel, `.` transparent. The key letters name a
// colour role, which a look (skin, hair, clothes) or a theme fills in, so a
// map is edited here without touching the painter.
//
// Roles used across the maps:
//   o outline      s skin/limb    S limb shade   h limb highlight
//   e eye          m mouth        c clothes      C clothes shade   k clothes light
//   r hair         R hair shade   q critter      Q critter shade
//   m metal (robots use M for shade), v visor, a antenna
//   F fur          D fur dark     p pink         n nose            W feather
//   y owl eye ring b beak

// ---- heads, front view, 10 x 10 (the face sits in rows 2-9) -------------------

export const HEADS = {
  human: [
    "..........",
    "..........",
    "..oooooo..",
    ".osssssso.",
    ".osshssso.",
    ".osesseso.",
    ".osssssso.",
    ".oSssmsSo.",
    "..oSSSSo..",
    "...oooo...",
  ],
  robot: [
    "....a.....",
    "....o.....",
    "..oooooo..",
    ".ohmmmmmo.",
    ".omvvvvMo.",
    ".omvvvvMo.",
    ".ommmmmMo.",
    ".oMmMMmMo.",
    "..oMMMMo..",
    "...oooo...",
  ],
  critter: [
    "..........",
    "..........",
    ".oooooooo.",
    "oqqqqqqqqo",
    "oqeqqqqeqo",
    "oqeqqqqeqo",
    "oqqqqqqqqo",
    "oqqqqqqqQo",
    "oQQQQQQQQo",
    ".oooooooo.",
  ],
  cat: [
    ".o......o.",
    "oFo....oFo",
    "oFpoooopFo",
    "oFFFFFFFFo",
    "oFeFFFFeFo",
    "oFFFFFFFFo",
    "oFFFnnFFFo",
    ".oFFFFFFo.",
    "..oDDDDo..",
    "...oooo...",
  ],
  dog: [
    "..........",
    "..........",
    "..oooooo..",
    ".DFFFFFFD.",
    "DDFFFFFFDD",
    "DDFeFFeFDD",
    "DDFFFFFFDD",
    ".DFFnnFFD.",
    "..FFmmFF..",
    "...oooo...",
  ],
  owl: [
    ".W......W.",
    ".WW....WW.",
    ".WWWWWWWW.",
    "WWyyWWyyWW",
    "WyeyWWyeyW",
    "WWyyWWyyWW",
    "WWWWbbWWWW",
    ".WWWWbWWW.",
    "..WWWWWW..",
    "...oooo...",
  ],
};

// The back of each head (war-room seats facing the table, and a head laid
// down on the desk).
export const HEAD_BACKS = {
  human: [
    "..........",
    "..........",
    "..oooooo..",
    ".orrrrrro.",
    ".orRrrrro.",
    ".orrrrRro.",
    ".orrrrrro.",
    ".oRrrrrRo.",
    "..oSSSSo..",
    "...oooo...",
  ],
  robot: [
    "....a.....",
    "....o.....",
    "..oooooo..",
    ".ohmmmmmo.",
    ".ommmmmMo.",
    ".omMvMmMo.",
    ".ommmmmMo.",
    ".oMmmmmMo.",
    "..oMMMMo..",
    "...oooo...",
  ],
  critter: [
    "..........",
    "..........",
    ".oooooooo.",
    "oqqqqqqqqo",
    "oqqqqqqqqo",
    "oqqqqqqqQo",
    "oqqqqqqqQo",
    "oqqqqqqqQo",
    "oQQQQQQQQo",
    ".oooooooo.",
  ],
  cat: [
    ".o......o.",
    "oFo....oFo",
    "oFFooooFFo",
    "oFFFFFFFFo",
    "oFDFFFFDFo",
    "oFFFFFFFFo",
    "oFFDFFDFFo",
    ".oFFFFFFo.",
    "..oDDDDo..",
    "...oooo...",
  ],
  dog: [
    "..........",
    "..........",
    "..oooooo..",
    ".DFFFFFFD.",
    "DDFFFFFFDD",
    "DDFFFFFFDD",
    "DDFFFFFFDD",
    ".DFFFFFFD.",
    "..FFFFFF..",
    "...oooo...",
  ],
  owl: [
    ".W......W.",
    ".WW....WW.",
    ".WWWWWWWW.",
    "WWWWWWWWWW",
    "WWDWWWWDWW",
    "WWWWWWWWWW",
    "WWDWWWWDWW",
    ".WWWWWWWW.",
    "..WWWWWW..",
    "...oooo...",
  ],
};

// Hair styles drawn over the human front head, same 10 x 10 frame.
export const HAIRS = {
  short: [
    "..........",
    "..........",
    "..RRRRRR..",
    ".RrrrrrrR.",
    ".Rr....rR.",
    ".R......R.",
  ],
  long: [
    "..........",
    "..........",
    "..RRRRRR..",
    ".RrrrrrrR.",
    ".Rrr..rrR.",
    ".Rr....rR.",
    "Rr......rR",
    "Rr......rR",
    "Rr......rR",
    ".R......R.",
  ],
  bun: [
    "....RR....",
    "...RrrR...",
    "..RRRRRR..",
    ".RrrrrrrR.",
    ".R......R.",
  ],
  curly: [
    "..RrRrRr..",
    ".RrRrRrRr.",
    "RrRrRrRrRr",
    "Rr......rR",
    "R........R",
    "R........R",
  ],
  ponytail: [
    "..........",
    "..........",
    "..RRRRRR..",
    ".RrrrrrrRR",
    ".Rr....rRr",
    ".R......Rr",
    ".........r",
    ".........R",
  ],
  bald: [
    "..........",
    "..........",
    "..........",
    "....hh....",
  ],
};

// ---- small heads for crowded rooms, 6 x 6 ---------------------------------

export const SMALL_HEADS = {
  human: [".oooo.", "osssso", "oesseo", "osssso", ".oSSo.", "..oo.."],
  robot: ["..a...", ".oooo.", "omvvMo", "ommmMo", ".oMMo.", "..oo.."],
  critter: ["oooooo", "oqqqqo", "oeqqeo", "oqqqqo", "oQQQQo", ".oooo."],
  cat: ["o....o", "oFooFo", "oeFFeo", "oFnnFo", ".oDDo.", "..oo.."],
  dog: [".oooo.", "DFFFFD", "DeFFeD", "DFnnFD", ".FmmF.", "..oo.."],
  owl: ["W....W", "WWWWWW", "yeWWey", "WWbbWW", ".WWWW.", "..oo.."],
};
export const SMALL_HAIRS = {
  short: ["RRRRRR", "R....R"],
  long: ["RRRRRR", "R....R", "R....R", "R....R"],
  bun: [".RRRR.", "R....R"],
  curly: ["RrRrRr", "R....R", "R....R"],
  ponytail: ["RRRRRR", "R....RR", ".....R"],
  bald: ["......"],
};

// ---- torsos, front view: 12 wide; arms are drawn by the painter -------------

export const TORSO = [
  "..oooooooo..",
  ".okkcccccCo.",
  "okccccccccCo",
  "okccccccccCo",
  "occcccccccCo",
  "occcccccccCo",
  "occcccccccCo",
  "oCCCCCCCCCCo",
];
export const SMALL_TORSO = [".oooooo.", "okcccCCo", "occccCCo", "oCCCCCCo"];

// ---- props ----------------------------------------------------------------

export const PLANT = [
  "....g.G.....",
  "..gGg.gGg...",
  ".gGLgGgLGg..",
  "gGLggGLggGg.",
  ".gGgLgGgLGg.",
  "..gGgGLgGg..",
  "...gGgGgg...",
  "....oPPo....",
  "...oPpPPo...",
  "...oPPPPo...",
  "....oooo....",
];

export const COOLER = [
  "..owwwwo..",
  ".owWwwwWo.",
  ".owwwwwwo.",
  ".owWwwwWo.",
  "..owwwwo..",
  "..oxxxxo..",
  ".oxXxxxxo.",
  ".oxxbxrxo.",
  ".oxxxxxxo.",
  ".oxXxxxxo.",
  ".oxxxxxxo.",
  ".oXXXXXXo.",
];

export const RACK_W = 9;

export const MUG = ["occo.", "owwoo", "owwoo", ".oo.."];
export const MINION = [".yyy.", "yGgGy", ".yyy.", ".uuu.", "o...o"];
export const SMALL_MINION = ["yy", "uu"];

// Confetti and sparks colours, cycled.
export const CONFETTI = [0xff5c8a, 0xffd23f, 0x4ade80, 0x60a5fa, 0xc084fc, 0xff8c42];

// ---- character looks ------------------------------------------------------

export const SKIN_TONES = [
  [0xf6d3b3, 0xd9ab88, 0xffe6d0],
  [0xeec39a, 0xcc9a6e, 0xfbd9b8],
  [0xd6a175, 0xb07c52, 0xe8bb93],
  [0xb57d55, 0x8d5a37, 0xc99670],
  [0x8d5a3b, 0x6b3f26, 0xa36e4c],
  [0x5e3a26, 0x452818, 0x734a33],
];
export const HAIR_COLOURS = [
  [0x2b1d16, 0x1a110c],
  [0x4a2f1d, 0x2f1d12],
  [0x8c5a2b, 0x6b4220],
  [0xd9b25e, 0xb08a3f],
  [0xb5442b, 0x8a321f],
  [0x9aa0a8, 0x737880],
  [0x5c3d8c, 0x432c66],
  [0x2f8a7a, 0x226657],
];
export const CLOTHES = [
  [0x4f7cac, 0x3b5f85, 0x6d97c4],
  [0xa05a7c, 0x7d4561, 0xbd7898],
  [0x5f9e6e, 0x497a55, 0x7fbb8d],
  [0xc07a3e, 0x9a6030, 0xd99a62],
  [0x7a6fc0, 0x5d5499, 0x968cd8],
  [0x3fa0a0, 0x2f7d7d, 0x62bcbc],
  [0xb0524f, 0x8a3d3b, 0xc9716e],
  [0x8a8f3c, 0x6b6f2c, 0xa6ab58],
  [0x4b4f5c, 0x363944, 0x666b7a],
];
export const FURS = {
  cat: [
    [0xe39a4f, 0xb87635],
    [0x8a8f98, 0x60656d],
    [0x2e2b30, 0x1c1a1e],
    [0xf0e6da, 0xc9bcae],
  ],
  dog: [
    [0xc89b6d, 0x7a5233],
    [0xf2e8d8, 0x8a6a48],
    [0x6b4a32, 0x3d2a1c],
    [0xd9b47a, 0x9c7a46],
  ],
  owl: [
    [0x9a7b5a, 0x6b5238],
    [0xd8d2c4, 0xa69f8f],
    [0x6b5a4a, 0x483b2f],
  ],
};

// ---- room palettes --------------------------------------------------------

// `nightshade` follows the Nightshade Ghostty theme (violet charcoal, moss
// green and lilac); the others are presets.
export const PALETTES = {
  nightshade: {
    wall: 0x3a3546, wallShade: 0x2b2833, trim: 0x524a63, baseboard: 0x211f28,
    floorA: 0x5a4a5e, floorB: 0x50425a, floorSeam: 0x3a3043,
    rugs: [0x4a3a6b, 0x2f5246, 0x5e3a4a, 0x2f4466, 0x5a4a2a],
    wood: 0x8a6548, woodTop: 0xa77c58, woodLight: 0xc49670, woodDark: 0x5e4231,
    metal: 0x6b6577, dark: 0x1d1b23,
    accent: { blocked: 0xf0655f, working: 0x76ea6a, running: 0xf5a524, idle: 0x8bbcff, unknown: 0xa8a2b8, done: 0x8c8699 },
  },
  warm: {
    wall: 0x6b5444, wallShade: 0x55412f, trim: 0x8a6a4a, baseboard: 0x3a2a1e,
    floorA: 0x9a6c45, floorB: 0x8c613e, floorSeam: 0x6b4a2c,
    rugs: [0x8a3a2e, 0x2e5a4a, 0x7a5a2a, 0x3a4a7a, 0x6a3a5a],
    wood: 0x7a5232, woodTop: 0x96683f, woodLight: 0xb8865a, woodDark: 0x4e331f,
    metal: 0x6e6a66, dark: 0x241a14,
    accent: { blocked: 0xff4d4d, working: 0x4ade80, running: 0xf59e0b, idle: 0x60a5fa, unknown: 0x94a3b8, done: 0x8b8fa8 },
  },
  cool: {
    wall: 0x3d4c5e, wallShade: 0x2e3a49, trim: 0x55677d, baseboard: 0x1f2832,
    floorA: 0x5b6878, floorB: 0x52606f, floorSeam: 0x3c4756,
    rugs: [0x2f4f6f, 0x3f6a5a, 0x5a4a7a, 0x6a4a4a, 0x4a5a3a],
    wood: 0x7c6a5a, woodTop: 0x96826f, woodLight: 0xb3a08c, woodDark: 0x4f4337,
    metal: 0x6f7c8a, dark: 0x161c24,
    accent: { blocked: 0xff4d4d, working: 0x4ade80, running: 0xf59e0b, idle: 0x60a5fa, unknown: 0x94a3b8, done: 0x8b8fa8 },
  },
  mono: {
    wall: 0x4a4a4a, wallShade: 0x383838, trim: 0x5e5e5e, baseboard: 0x222222,
    floorA: 0x5a5a5a, floorB: 0x525252, floorSeam: 0x3c3c3c,
    rugs: [0x444444, 0x4c4c4c, 0x3e3e3e, 0x484848, 0x404040],
    wood: 0x707070, woodTop: 0x888888, woodLight: 0xa0a0a0, woodDark: 0x4a4a4a,
    metal: 0x6a6a6a, dark: 0x1a1a1a,
    accent: { blocked: 0xff4d4d, working: 0x4ade80, running: 0xf59e0b, idle: 0x60a5fa, unknown: 0x94a3b8, done: 0x9a9a9a },
  },
};

// ---- skies by time of day --------------------------------------------------

/** Sky colours for an hour (0-24, fractional): top, bottom, and whether it is night. */
export function skyAt(hour) {
  const stops = [
    [0, 0x0b1026, 0x1a2147, true],
    [5, 0x1a2147, 0x3b3366, true],
    [6, 0x5b5a9a, 0xf2a07a, false],
    [7.5, 0x6fa8e8, 0xf6d6a8, false],
    [10, 0x4f94e0, 0xa8d4f5, false],
    [16, 0x5a9be0, 0xb8dcf5, false],
    [18, 0x4a5aa0, 0xf09a6a, false],
    [19.5, 0x2a2a66, 0xc0607a, false],
    [21, 0x101536, 0x2a2a5a, true],
    [24, 0x0b1026, 0x1a2147, true],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [h0, t0, b0, n0] = stops[i];
    const [h1, t1, b1] = stops[i + 1];
    if (hour >= h0 && hour <= h1) {
      const k = (hour - h0) / (h1 - h0 || 1);
      return { top: mix(t0, t1, k), bottom: mix(b0, b1, k), isNight: n0 && k < 0.5 ? true : hour >= 20.5 || hour < 5.5 };
    }
  }
  return { top: stops[0][1], bottom: stops[0][2], isNight: true };
}

export function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const ch = (s) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * k) << s;
  };
  return ch(16) | ch(8) | ch(0);
}

// ---- bold: chunky, high-contrast characters made for cells ---------------------
// Every kind drawn as the critter is: one block with a thick outline, eyes
// two pixels tall, a feature or two (hair, ears, visor, beak) and nothing finer.

export const BOLD_HEADS = {
  critter: HEADS.critter,
  human: [
    "..........",
    ".oooooooo.",
    "orrrrrrrro",
    "orrsssssro",
    "osesssseso",
    "osesssseso",
    "osssssssso",
    "osssmmsSso",
    "oSSSSSSSSo",
    ".oooooooo.",
  ],
  robot: [
    "....a.....",
    ".oooooooo.",
    "ommmmmmmmo",
    "omvvvvvvmo",
    "omvVvvVvmo",
    "omvvvvvvmo",
    "ommmmmmmmo",
    "omMmMMmMmo",
    "oMMMMMMMMo",
    ".oooooooo.",
  ],
  cat: [
    ".oo....oo.",
    "oFFo..oFFo",
    "oFFFooFFFo",
    "oFFFFFFFFo",
    "oFeFFFFeFo",
    "oFeFFFFeFo",
    "oFFFnnFFFo",
    "oFFFFFFFFo",
    "oDDDDDDDDo",
    ".oooooooo.",
  ],
  dog: [
    "..........",
    ".oooooooo.",
    "oDFFFFFFDo",
    "oDFFFFFFDo",
    "oDeFFFFeDo",
    "oDeFFFFeDo",
    "oDFFnnFFDo",
    "oDFFmmFFDo",
    "oDDDDDDDDo",
    ".oooooooo.",
  ],
  owl: [
    "oo......oo",
    "oWo....oWo",
    "oWWooooWWo",
    "oyyyWWyyyo",
    "oyeyWWyeyo",
    "oyyyWWyyyo",
    "oWWWbbWWWo",
    "oWWWWbWWWo",
    "oDDDDDDDDo",
    ".oooooooo.",
  ],
};

export const BOLD_SMALL_HEADS = {
  critter: SMALL_HEADS.critter,
  human: ["oooooo", "orrrro", "oesseo", "oesseo", "oSmmSo", ".oooo."],
  robot: ["..a...", "oooooo", "ovVVvo", "ommmmo", "oMMMMo", ".oooo."],
  cat: ["o....o", "oFooFo", "oeFFeo", "oeFFeo", "oDnnDo", ".oooo."],
  dog: ["oooooo", "DFFFFD", "DeFFeD", "DeFFeD", "DFnnFD", ".oooo."],
  owl: ["W....W", "oWWWWo", "yeyyey", "yyWWyy", "oWbbWo", ".oooo."],
};
