import type { Appearance } from '../../shared/types';

const skinColors = ['#f1c9a5', '#dfac86', '#c58c62', '#a9714b', '#815638', '#54392e'];
const hairColors = ['#251f1b', '#53382c', '#8b6041', '#ccaa68', '#aa6449', '#b7b2a9'];
const clothingColors = [
  '#345f68',
  '#65845d',
  '#be7960',
  '#c4a24b',
  '#8071a1',
  '#596c95',
  '#b7677e',
  '#e1d2b4',
];
const avatarColors = ['#d9e4d1', '#d5e0e7', '#ead7c7', '#e5dfbd', '#e1d7e8', '#dbdfcf'];

/** Generate once at creation and persist the result with the employee. */
export function randomEmployeeAppearance(random: () => number = Math.random): {
  appearance: Appearance;
  color: string;
  avatar: number;
} {
  const pick = <T>(choices: readonly T[]): T => choices[Math.floor(random() * choices.length)];
  return {
    appearance: {
      gender: pick(['neutral', 'feminine', 'masculine'] as const),
      skin: pick(skinColors),
      hair: pick(hairColors),
      hairstyle: pick(['short', 'long', 'bald'] as const),
      hat: pick(['none', 'cap', 'beanie'] as const),
      glasses: random() < 0.35,
      clothing: pick(clothingColors),
    },
    color: pick(avatarColors),
    avatar: Math.floor(random() * 7),
  };
}
