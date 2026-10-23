// Products without real variants carry an empty or "Default" variant label:
// those are hidden instead of showing a blank field or the word "Default".
export function isMeaningfulVariantLabel(label: string | null | undefined): boolean {
  const text = String(label ?? '').trim();
  return text.length > 0 && !/^default( variant)?$/i.test(text);
}
