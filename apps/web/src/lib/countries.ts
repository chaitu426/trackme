const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "Unknown location";
  return displayNames.of(code) ?? code;
}

export function countryFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "◌";
  return String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0)));
}
