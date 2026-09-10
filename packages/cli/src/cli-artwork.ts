// ASCII adaptation of https://www.prisma.io/brand-kit.
const symbol = [
  [
    { text: "    ////////", color: "cyan" },
    { text: "  //////", color: "redBright" },
  ],
  [
    { text: "  ////////", color: "cyan" },
    { text: "  ////////", color: "redBright" },
  ],
  [
    { text: "////////", color: "cyan" },
    { text: "  //////////", color: "redBright" },
  ],
  [
    { text: "//////", color: "cyan" },
    { text: "  ////////////", color: "redBright" },
  ],
  [
    { text: "////", color: "cyan" },
    { text: "  ////////////", color: "redBright" },
    { text: "  ", color: "yellow" },
  ],
  [
    { text: "//", color: "cyan" },
    { text: "  ////////////", color: "redBright" },
    { text: "  //", color: "yellow" },
  ],
  [
    { text: "  ////////////", color: "redBright" },
    { text: "  ////", color: "yellow" },
  ],
  [
    { text: "////////////", color: "redBright" },
    { text: "  //////", color: "yellow" },
  ],
  [
    { text: "//////////", color: "redBright" },
    { text: "  ////////", color: "yellow" },
  ],
  [
    { text: "////////", color: "redBright" },
    { text: "  ////////  ", color: "yellow" },
  ],
  [
    { text: "//////", color: "redBright" },
    { text: "  ////////    ", color: "yellow" },
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
