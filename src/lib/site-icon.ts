// The browser icon when the site has no logo (M, 2026-10-08): the site name's initials on the brand colour, an SVG
// written per request in microseconds — no image library, no wasm, no agent turn. Platform-owned; never edit.

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Up to two initials: the first letter or digit of the name's first two words ("Casa Lola" → "CL", "acme" → "A"). */
export function initials(name: string): string {
  const firsts = name.match(/(?<![\p{L}\p{N}'’])[\p{L}\p{N}]/gu) ?? [];
  return firsts.slice(0, 2).join('').toLocaleUpperCase() || '•';
}

/** Light brand colours get dark letters: a `#hex`, `rgb()`, `hsl()` or `oklch()` lightness; anything else is dark. */
function isLight(color: string): boolean {
  const c = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
  }
  const lightness = /^(?:oklch|oklab|lch|lab)\(\s*([\d.]+)(%?)/.exec(c);
  if (lightness) return Number(lightness[1]) / (lightness[2] ? 100 : c.startsWith('l') ? 100 : 1) > 0.75;
  const hsl = /^hsla?\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+([\d.]+)%/.exec(c);
  if (hsl) return Number(hsl[1]) > 70;
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c);
  if (rgb) return (0.2126 * Number(rgb[1]) + 0.7152 * Number(rgb[2]) + 0.0722 * Number(rgb[3])) / 255 > 0.6;
  return false;
}

/** A rounded square in `color` with the name's initials. `color` is any CSS colour (`--color-brand` of globals.css). */
export function siteIconSvg(name: string, color: string): string {
  const letters = initials(name);
  const fill = /^[#\w(),.%\s/-]+$/.test(color) ? color : '#18181b';
  const size = letters.length > 1 ? 30 : 38;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fill}"/><text x="32" y="33" dominant-baseline="central" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="${String(size)}" font-weight="700" fill="${isLight(fill) ? '#18181b' : '#ffffff'}">${escape(letters)}</text></svg>`;
}
