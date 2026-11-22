const withoutAccent = (char: string): string => char.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

const letters = (text: string): string[] => [...text.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ')];

/** Same rule as backend utils/search.js: "nguyen" finds "Nguyễn", "nguyễn" only finds that spelling. */
export function matchesSearch(value: string | null | undefined, query: string): boolean {
  const text = letters(value || '');
  const wanted = letters(query);
  if (!wanted.length) return true;
  return text.some((_, start) => wanted.every((char, i) => {
    const actual = text[start + i];
    return actual !== undefined && (actual === char || withoutAccent(actual) === char);
  }));
}
