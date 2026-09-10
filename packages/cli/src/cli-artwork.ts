// ASCII adaptations of https://www.prisma.io/brand-kit, with the SVG fill colors.
const symbol = [
  [
    { text: "    ////////", rgb: [4, 213, 231] },
    { text: "  //////", rgb: [254, 67, 82] },
  ],
  [
    { text: "  ////////", rgb: [4, 213, 231] },
    { text: "  ////////", rgb: [254, 67, 82] },
  ],
  [
    { text: "////////", rgb: [4, 213, 231] },
    { text: "  //////////", rgb: [254, 67, 82] },
  ],
  [
    { text: "//////", rgb: [4, 213, 231] },
    { text: "  ////////////", rgb: [254, 67, 82] },
  ],
  [
    { text: "////", rgb: [4, 213, 231] },
    { text: "  ////////////", rgb: [254, 67, 82] },
    { text: "  ", rgb: [254, 190, 41] },
  ],
  [
    { text: "//", rgb: [4, 213, 231] },
    { text: "  ////////////", rgb: [254, 67, 82] },
    { text: "  //", rgb: [254, 190, 41] },
  ],
  [
    { text: "  ////////////", rgb: [254, 67, 82] },
    { text: "  ////", rgb: [254, 190, 41] },
  ],
  [
    { text: "////////////", rgb: [254, 67, 82] },
    { text: "  //////", rgb: [254, 190, 41] },
  ],
  [
    { text: "//////////", rgb: [254, 67, 82] },
    { text: "  ////////", rgb: [254, 190, 41] },
  ],
  [
    { text: "////////", rgb: [254, 67, 82] },
    { text: "  ////////  ", rgb: [254, 190, 41] },
  ],
  [
    { text: "//////", rgb: [254, 67, 82] },
    { text: "  ////////    ", rgb: [254, 190, 41] },
  ],
] as const;

const wordmark = [
  " ____       _",
  "|  _ \\ _ __(_)___ _ __ ___   __ _",
  "| |_) | '__| / __| '_ ` _ \\ / _` |",
  "|  __/| |  | \\__ \\ | | | | | (_| |",
  "|_|   |_|  |_|___/_| |_| |_|\\__,_|",
] as const;

export const horizontalArtwork = symbol.map((row, index) => {
  const word = wordmark[index - 3];
  return word === undefined ? row : [...row, { text: `    ${word}` }];
});
