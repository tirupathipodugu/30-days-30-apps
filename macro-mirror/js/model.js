// The numbers: foods, maintenance calories, the better-plate swaps and a simplified Hall model.
// Nothing here is stored or sent anywhere; it only lives in memory for this visit.

/** Food cards, in display order. kcal is per portion. `better` is the lighter swap, `priority` how
 *  readily the better plate swaps it (treats and drinks first, staples last). */
export const FOODS = [
  { id: 'soda', name: 'Sugary drink', portion: '1 can', kcal: 140, sugar: 1, better: { name: 'Water', kcal: 0 }, priority: 1.5 },
  { id: 'coffee', name: 'Coffee with sugar and cream', portion: '1 mug', kcal: 120, sugar: 0.5, better: { name: 'Black coffee', kcal: 5 }, priority: 1.0 },
  { id: 'fries', name: 'Fries', portion: 'medium', kcal: 340, better: { name: 'Side salad', kcal: 150 }, priority: 1.4 },
  { id: 'pizza', name: 'Pizza slice', portion: '1 slice', kcal: 285, better: { name: 'Thin-crust veg slice', kcal: 200 }, priority: 1.1 },
  { id: 'burger', name: 'Burger', portion: '1', kcal: 500, better: { name: 'Grilled chicken wrap', kcal: 350 }, priority: 1.2 },
  { id: 'choc', name: 'Chocolate bar', portion: '50 g', kcal: 250, sugar: 1, better: { name: 'Fruit', kcal: 80 }, priority: 1.35 },
  { id: 'biscuits', name: 'Biscuits', portion: '4', kcal: 200, sugar: 0.7, better: { name: 'Fruit', kcal: 80 }, priority: 1.3 },
  { id: 'rice', name: 'Rice plate', portion: 'rice and curry', kcal: 600, better: { name: 'Smaller rice, more veg', kcal: 420 }, priority: 0.6 },
  { id: 'roti', name: 'Roti or bread', portion: '1 piece', kcal: 120, better: null, priority: 0 },
  { id: 'fruit', name: 'Fruit', portion: '1 piece', kcal: 80, better: null, priority: 0 },
  { id: 'salad', name: 'Salad', portion: 'with dressing', kcal: 150, better: null, priority: 0 },
  { id: 'shake', name: 'Protein shake', portion: '1 glass', kcal: 160, better: null, priority: 0 },
  { id: 'nuts', name: 'Nuts', portion: 'a handful', kcal: 180, better: null, priority: 0 },
  { id: 'drink', name: 'Beer or wine', portion: '1 glass', kcal: 150, alcohol: 1, better: { name: 'Sparkling water', kcal: 0 }, priority: 1.25 },
  { id: 'late', name: 'Late-night snack', portion: '1', kcal: 300, sugar: 0.5, better: { name: 'Herbal tea', kcal: 0 }, priority: 1.45 },
];

/** A typical day to start from, so the mirror does something straight away. */
export const DEFAULT_PLATE = { coffee: 2, rice: 2, roti: 2, soda: 1, biscuits: 1, fries: 1 };

export const ACTIVITY = [
  { id: 'desk', label: 'Desk all day', factor: 1.2 },
  { id: 'walk', label: 'Some walking', factor: 1.375 },
  { id: 'active', label: 'Active', factor: 1.55 },
  { id: 'very', label: 'Very active', factor: 1.725 },
];

export const AGE_BANDS = [
  { id: '18', label: '18–29', years: 24, ageing: 0.8 },
  { id: '30', label: '30–44', years: 37, ageing: 1 },
  { id: '45', label: '45–59', years: 52, ageing: 1.15 },
  { id: '60', label: '60+', years: 66, ageing: 1.25 },
];

export const SEXES = [
  { id: 'f', label: 'Female', offset: -161 },
  { id: 'm', label: 'Male', offset: 5 },
  { id: 'x', label: 'Rather not say', offset: -78 },
];

/** Timeline stops: slider position i sits on STOPS[i]. */
export const STOPS = [
  { label: 'Today', short: 'Today', days: 0 },
  { label: '1 month', short: '1 mo', days: 30 },
  { label: '6 months', short: '6 mo', days: 182 },
  { label: '1 year', short: '1 yr', days: 365 },
  { label: '3 years', short: '3 yr', days: 1095 },
  { label: '5 years', short: '5 yr', days: 1826 },
  { label: '10 years', short: '10 yr', days: 3652 },
];

export const KCAL_PER_KG_DAY = 24;     // long-run: 1 kg per 24 kcal/day of surplus (Hall et al. 2011)
export const HALF_LIFE_DAYS = 365;     // about half the change shows within the first year
export const GAIN_CAP_KG = 15;         // the face stops changing beyond this
export const LEAN_CAP_KG = 8;          // and never goes leaner than this

/** Days for a slider position 0..6 (fractional between stops). */
export function daysAt(pos) {
  const i = Math.max(0, Math.min(STOPS.length - 1, Math.floor(pos)));
  const j = Math.min(STOPS.length - 1, i + 1);
  const f = pos - i;
  return STOPS[i].days + (STOPS[j].days - STOPS[i].days) * f;
}

/** Weight change in kg after `days` at a constant daily surplus (negative for a deficit). */
export function kgAfter(surplus, days) {
  return (surplus / KCAL_PER_KG_DAY) * (1 - Math.pow(0.5, days / HALF_LIFE_DAYS));
}

/** Mifflin–St Jeor resting energy times an activity factor. */
export function maintenance(profile) {
  const age = AGE_BANDS.find((a) => a.id === profile.age) || AGE_BANDS[1];
  const sex = SEXES.find((s) => s.id === profile.sex) || SEXES[2];
  const act = ACTIVITY.find((a) => a.id === profile.activity) || ACTIVITY[1];
  const bmr = 10 * profile.weight + 6.25 * profile.height - 5 * age.years + sex.offset;
  return bmr * act.factor;
}

export function intake(plate) {
  return FOODS.reduce((sum, f) => sum + (plate[f.id] || 0) * f.kcal, 0);
}

/** Better plate: swap the 2–3 worst items for lighter ones, stopping once the day is in balance
 *  (it's a better plate, not a crash diet). Returns { kcal, swaps: [{ from, to, count, saved }] }. */
export function betterPlate(plate, burn) {
  const options = FOODS
    .filter((f) => f.better && (plate[f.id] || 0) > 0)
    .map((f) => ({ food: f, saved: (f.kcal - f.better.kcal) * plate[f.id], count: plate[f.id] }))
    .sort((a, b) => b.saved * b.food.priority - a.saved * a.food.priority);
  let kcal = intake(plate);
  const swaps = [];
  for (const o of options) {
    if (swaps.length >= 3) break;
    if (swaps.length >= 2 && kcal <= burn) break;
    if (swaps.length >= 1 && kcal <= burn - 150) break;
    kcal -= o.saved;
    swaps.push({ from: o.food.name, to: o.food.better.name, count: o.count, saved: o.saved });
  }
  return { kcal, swaps };
}

/** Things that age skin a little faster: alcohol, sugar and smoking (0..1 each). */
export function lifestyle(plate, profile) {
  const alcohol = Math.min(1, (plate.drink || 0) / 3);
  const sugar = Math.min(1, FOODS.reduce((s, f) => s + (f.sugar || 0) * (plate[f.id] || 0), 0) / 4);
  return { alcohol, sugar, smoking: profile.smoking ? 1 : 0 };
}

/** Everything the face needs for one future: weight effect and ageing, all 0..1. */
export function faceParams(kg, years, plate, profile) {
  const style = lifestyle(plate, profile);
  const ageBand = AGE_BANDS.find((a) => a.id === profile.age) || AGE_BANDS[1];
  const gain = Math.max(0, Math.min(1, kg / GAIN_CAP_KG));
  const lean = Math.max(0, Math.min(1, -kg / LEAN_CAP_KG));
  // Time: nothing in the first year or two, faint by 5 years, clear (still subtle) by 10.
  const t = Math.max(0, Math.min(1, (years - 1.5) / 8.5));
  const pace = 1 + 0.35 * style.alcohol + 0.25 * style.sugar + 0.45 * style.smoking + 0.25 * gain;
  const age = Math.min(1.25, Math.pow(t, 1.15) * pace * ageBand.ageing);
  const grey = Math.max(0, Math.min(1, (years - 7) / 3)) * Math.min(1.2, ageBand.ageing);
  const flush = Math.min(1, (0.7 * style.alcohol + 0.3 * style.sugar) * Math.min(1, years / 3));
  return { gain, lean, age, grey, flush };
}

/** Light-toned caption for a stop. Never mocking; "fuller" and "leaner", never worse words. */
export function captionFor(stopIndex, kg, which) {
  const steady = Math.abs(kg) < 1;
  if (stopIndex === 0) return 'Today. This is you, right now.';
  if (which === 'better') {
    const b = ['', '1 month: small swaps, quietly adding up.', '6 months: same you, a little lighter on your feet.',
      '1 year: same you, more energy.', '3 years: the swaps are just how you eat now.', '5 years: steady, and it suits you.',
      '10 years: older, and still looking after yourself.'];
    return b[stopIndex];
  }
  if (steady) return `${STOPS[stopIndex].label}: your weight holds steady. Only time shows.`;
  if (kg > 0) {
    const c = ['', '1 month: hardly anything shows yet.', '6 months: your face is starting to soften.',
      '1 year: your jeans have noticed.', '3 years: fuller cheeks, a softer jawline.', '5 years: friends would notice now.',
      '10 years: this is where this plate leads.'];
    return c[stopIndex];
  }
  const l = ['', '1 month: a touch lighter.', '6 months: a little more definition.', '1 year: a leaner jawline.',
    '3 years: leaner, and holding there.', '5 years: lighter, and it shows.', '10 years: older, and leaner.'];
  return l[stopIndex];
}

export function formatKg(kg) {
  const r = Math.round(kg * 10) / 10;
  const v = Math.abs(r) < 10 ? r.toFixed(1).replace(/\.0$/, '') : Math.round(r).toString();
  return (r > 0 ? '+' : r < 0 ? '−' : '±') + v.replace('-', '') + ' kg';
}
