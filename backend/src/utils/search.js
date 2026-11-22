// Admin and people search: an unaccented letter also finds its accented forms ("nguyen" finds "Nguyễn"),
// while a letter typed with an accent only matches that accent.
const accentedForms = new Map();
for (let code = 0xc0; code <= 0x1ef9; code += 1) {
  const char = String.fromCharCode(code);
  const base = char.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
  if (/^[a-z]$/.test(base)) accentedForms.set(base, (accentedForms.get(base) || '') + char);
}

function searchPattern(text) {
  const source = String(text).normalize('NFC').trim().replace(/[.*+?^${}()|[\]\\]|\s+|\p{L}/gu, (part) => {
    if (/^\s+$/.test(part)) return '\\s+';
    if (!/^\p{L}$/u.test(part)) return `\\${part}`;
    const lower = part.toLowerCase();
    const upper = part.toUpperCase();
    // Both cases are spelled out: not every MongoDB version case-folds accented letters.
    if (accentedForms.has(lower)) return `[${lower}${upper}${accentedForms.get(lower)}]`;
    return lower === upper ? part : `[${lower}${upper}]`;
  });
  return new RegExp(source, 'i');
}

module.exports = { searchPattern };
