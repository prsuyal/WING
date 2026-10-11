import { readFileSync } from "node:fs";
import { z } from "zod";

type Airport = { name: string; city: string; subd: string; country: string; tz: string; lat: string; lon: string };
export const airports = (JSON.parse(readFileSync(new URL("../data/airports.json", import.meta.url), "utf8")) as { airports: Record<string, Airport> }).airports;
export const airportSchema = z.string().regex(/^[A-Z]{3}$/).refine((code) => !!airports[code], "Use a known airport code; look up cities before saving");
export function airportZone(code: string) {
  const zone = airports[airportSchema.parse(code)]!.tz;
  new Intl.DateTimeFormat("en", { timeZone: zone });
  return zone;
}
const cities: Record<string, string[]> = { DFW: ["DFW", "DAL"], NYC: ["JFK", "EWR", "LGA"], LON: ["LHR", "LGW", "LCY", "STN", "LTN"], PAR: ["CDG", "ORY"], TYO: ["HND", "NRT"], CHI: ["ORD", "MDW"], WAS: ["IAD", "DCA", "BWI"], SFO: ["SFO", "OAK", "SJC"], YTO: ["YYZ", "YTZ"], ROM: ["FCO", "CIA"] };
const aliases: Record<string, string> = { dallas: "DFW", "new york": "NYC", nyc: "NYC", london: "LON", paris: "PAR", tokyo: "TYO", chicago: "CHI", washington: "WAS", "san francisco": "SFO", toronto: "YTO", rome: "ROM" };
const normalized = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
export function findAirports(query: string) {
  const text = normalized(z.string().trim().min(2).max(100).parse(query)), code = query.trim().toUpperCase();
  const group = cities[code] ?? cities[aliases[text] ?? ""];
  const codes = airports[code] && !group ? [code] : group ?? Object.keys(airports).filter((id) => [airports[id]!.city, airports[id]!.name].some((name) => normalized(name).includes(text))).slice(0, 8);
  return codes.map((code) => ({ code, ...airports[code] })).filter((airport) => airport.tz);
}
export function nearbyAirports(code: string) {
  // shortcut: nearby alternatives cover these metro groups; add scheduled-service metadata before expanding worldwide.
  return [code, ...(Object.values(cities).find((group) => group.includes(code)) ?? [])].filter((value, i, all) => all.indexOf(value) === i).slice(0, 3);
}
export function requestedNearby(code: string, text: string) {
  return /\b(compare|both|between|vs|versus)\b/i.test(text) && nearbyAirports(code).filter((airport) => new RegExp(`\\b${airport}\\b`, "i").test(text)).length > 1;
}
