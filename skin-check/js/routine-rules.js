// Routine rules: the ingredient table and the engine that turns goals + profile into a morning and
// night routine. Ingredients, never brands. The budget changes the product type and texture, never
// the science. Every exclusion is written as a rule here, with the reason shown to the person.
//
// Sources (full list with links in README.md):
//   [AAD-SPF]    American Academy of Dermatology: How to select a sunscreen (SPF 30+, broad spectrum, every day).
//   [AAD-RET]    AAD: How to use retinoid creams / "start slowly" (2–3 nights a week, pea-sized amount).
//   [AAD-SPOTS]  AAD: Hyperpigmentation / dark spots: sunscreen first; azelaic acid, vitamin C, retinoids, niacinamide.
//   [AAD-SENS]   AAD: Skin care tips for sensitive skin (few products, fragrance-free, patch test, one change at a time).
//   [BAD]        British Association of Dermatologists: skin lightening products warning (mercury, steroids, hydroquinone).
//   [PREG]       Bozzo P, Chua-Gocheco A, Einarson A. Safety of skin care products during pregnancy. Can Fam Physician 2011;57:665–7.
//   [NIA]        Bissett DL et al. Niacinamide: a B vitamin that improves aging facial skin appearance. Dermatol Surg 2005;31:860–5.
//                Hakozaki T et al. The effect of niacinamide on reducing cutaneous pigmentation. Br J Dermatol 2002;147:20–31.
//                Draelos ZD et al. The effect of 2% niacinamide on facial sebum production. J Cosmet Laser Ther 2006;8:96–101.
//   [RETREV]     Mukherjee S et al. Retinoids in the treatment of skin aging: clinical efficacy and safety. Clin Interv Aging 2006;1:327–48.
//                Kong R et al. Retinol and retinoic acid: histological, molecular and clinical properties. J Cosmet Dermatol 2016;15:49–57.
//   [AZA]        Schulte BC et al. Azelaic acid: evidence-based update on mechanism of action and clinical application. J Drugs Dermatol 2015;14:964–8.
//   [VITC]       Telang PS. Vitamin C in dermatology. Indian Dermatol Online J 2013;4:143–6.
//                Pullar JM, Carr AC, Vissers MCM. The roles of vitamin C in skin health. Nutrients 2017;9:866.
//   [HA]         Pavicic T et al. Hyaluronic acid formulations of different molecular weights in anti-wrinkle treatment. J Drugs Dermatol 2011;10:990–1000.
//   [BHA]        Arif T. Salicylic acid as a peeling agent: a comprehensive review. Clin Cosmet Investig Dermatol 2015;8:455–61.
//   [SPF-AGE]    Hughes MCB et al. Sunscreen and prevention of skin aging: a randomized trial. Ann Intern Med 2013;158:781–90.

export const GOALS = [
  { id: 'tone', label: 'Even tone & fade dark spots' },
  { id: 'lines', label: 'Fewer fine lines' },
  { id: 'oil', label: 'Less oil & shine' },
  { id: 'redness', label: 'Calm redness' },
  { id: 'hydration', label: 'Hydration & glow' },
  { id: 'undereye', label: 'Brighter under-eyes' },
  { id: 'pores', label: 'Smaller-looking pores' },
];

export const SKIN_TYPES = [
  { id: 'oily', label: 'Oily' },
  { id: 'dry', label: 'Dry' },
  { id: 'combination', label: 'Combination' },
  { id: 'normal', label: 'Normal' },
  { id: 'sensitive', label: 'Sensitive' },
];

export const AGE_BANDS = [
  { id: 'u18', label: 'Under 18' },
  { id: '18-24', label: '18–24' },
  { id: '25-34', label: '25–34' },
  { id: '35-44', label: '35–44' },
  { id: '45-54', label: '45–54' },
  { id: '55+', label: '55+' },
];

export const BUDGETS = [
  { id: 'basic', label: 'Basic' },
  { id: 'mid', label: 'Mid' },
  { id: 'premium', label: 'Premium' },
];

/**
 * The ingredient table. Each entry:
 *   when      'am' | 'pm' | 'both'
 *   order     position within a routine (cleanse 0 … SPF 9)
 *   always    included for everyone
 *   goals     goals it serves (it's suggested when one of them is picked)
 *   types     skin types it especially suits (adds weight)
 *   active    counts toward the limit on actives, and is introduced one at a time
 *   flags     retinoid, leaveOnBHA, strongAcid — used by the exclusion rules
 *   start     how to start, normal skin / sensitive skin
 *   avoid     what not to mix it with (ids), with the plain reason
 *   product   suggested product type by budget (texture, not brand)
 */
export const INGREDIENTS = {
  cleanser: {
    name: 'Gentle cleanser',
    when: 'both', order: 0, always: true, active: false,
    forText: 'Lifts sunscreen, oil and dirt without stripping your skin.',
    start: { normal: 'Morning and night. Lukewarm water, 30 seconds, pat dry.', sensitive: 'A splash of water is enough in the morning; cleanse properly at night. Fragrance-free.' },
    product: {
      basic: { oily: 'a simple gel cleanser', dry: 'a cream or milky cleanser', default: 'a fragrance-free gentle cleanser' },
      mid: { oily: 'a low-foam gel cleanser', dry: 'a hydrating cream cleanser', default: 'a pH-balanced gentle cleanser' },
      premium: { oily: 'a soft gel-to-foam cleanser', dry: 'a cleansing balm followed by a cream cleanser at night', default: 'a cushiony, fragrance-free cream cleanser' },
    },
    sources: ['AAD-SENS'],
  },
  vitaminC: {
    name: 'Vitamin C',
    when: 'am', order: 3, active: true,
    goals: ['tone', 'hydration', 'lines', 'undereye'],
    forText: 'An antioxidant serum that helps fade dark spots and adds glow. Works alongside your sunscreen.',
    start: { normal: 'Every morning after cleansing. 10–15% L-ascorbic acid, or a gentler derivative.', sensitive: 'Every other morning to start, as a gentle derivative (such as sodium ascorbyl phosphate or ascorbyl glucoside) rather than strong L-ascorbic acid.' },
    avoid: [{ id: 'bha', why: 'so the two low-pH layers don’t stack' }],
    product: {
      basic: { default: 'a simple vitamin C serum in an opaque bottle' },
      mid: { default: 'a stabilised vitamin C serum (with vitamin E and ferulic acid)' },
      premium: { default: 'a stabilised vitamin C + E + ferulic serum, airless pump' },
    },
    sources: ['VITC', 'AAD-SPOTS'],
  },
  niacinamide: {
    name: 'Niacinamide',
    when: 'both', order: 4, active: true,
    goals: ['oil', 'pores', 'redness', 'tone', 'undereye'],
    types: ['oily', 'combination', 'sensitive'],
    forText: 'A calm, well-tolerated vitamin that helps with oil, the look of pores, redness and uneven tone.',
    start: { normal: '4–5% once a day, morning or night. It plays well with almost everything.', sensitive: 'Start at 2–4%, every other day for two weeks, then daily.' },
    product: {
      basic: { default: 'a plain niacinamide serum (4–5%)' },
      mid: { default: 'a niacinamide serum with zinc for oily areas' },
      premium: { default: 'a light niacinamide essence-serum' },
    },
    sources: ['NIA'],
  },
  azelaic: {
    name: 'Azelaic acid',
    when: 'pm', order: 5, active: true,
    goals: ['redness', 'tone', 'pores'],
    types: ['sensitive', 'oily', 'combination'],
    forText: 'Gently evens tone and calms redness, and helps keep pores clear. Considered suitable in pregnancy.',
    start: { normal: '10% (over the counter) every other night for two weeks, then nightly. A mild tingle at first is common.', sensitive: '10% two or three nights a week for the first month, on dry skin, after moisturiser if it stings.' },
    avoid: [{ id: 'bha', why: 'two acids on one night can irritate' }],
    product: {
      basic: { default: 'a 10% azelaic acid cream or suspension' },
      mid: { default: 'a 10% azelaic acid serum-cream' },
      premium: { default: 'an elegant 10% azelaic acid booster' },
    },
    sources: ['AZA', 'AAD-SPOTS', 'PREG'],
  },
  retinoid: {
    name: 'Retinol / retinal',
    when: 'pm', order: 6, active: true, flags: ['retinoid'],
    goals: ['lines', 'tone', 'pores'],
    forText: 'The best-studied ingredient for fine lines and texture. Night only, because light breaks it down.',
    start: { normal: '2–3 nights a week for the first month, a pea-sized amount for the whole face, then build up to nightly if your skin is happy.', sensitive: 'Once a week for the first two weeks, then twice a week. Use it after moisturiser (a “sandwich”) to soften it.' },
    avoid: [
      { id: 'bha', why: 'a retinoid and an acid together can irritate' },
      { id: 'azelaic', why: 'while you’re starting, keep them on separate nights' },
    ],
    product: {
      basic: { default: 'a 0.2–0.3% retinol cream' },
      mid: { default: 'a 0.3–0.5% encapsulated retinol serum' },
      premium: { default: 'a 0.05–0.1% retinal (retinaldehyde) serum' },
    },
    sources: ['RETREV', 'AAD-RET'],
  },
  bha: {
    name: 'Salicylic acid (BHA)',
    when: 'pm', order: 5, active: true, flags: ['leaveOnBHA', 'strongAcid'],
    goals: ['oil', 'pores'],
    types: ['oily', 'combination'],
    forText: 'Oil-soluble, so it gets into pores and helps with shine and the look of pores.',
    start: { normal: '1–2% leave-on, two or three nights a week, on oily areas first.', sensitive: '0.5–1%, once or twice a week, T-zone only.' },
    avoid: [{ id: 'retinoid', why: 'a retinoid and an acid together can irritate' }, { id: 'azelaic', why: 'two acids on one night can irritate' }],
    product: {
      basic: { default: 'a 2% salicylic acid liquid' },
      mid: { default: 'a 1–2% BHA lotion' },
      premium: { default: 'a BHA toner-serum with soothing extras' },
    },
    sources: ['BHA'],
  },
  hyaluronic: {
    name: 'Hyaluronic acid',
    when: 'both', order: 7, active: false,
    goals: ['hydration', 'lines', 'undereye'],
    types: ['dry'],
    forText: 'Draws water into the top layer of skin for a plumper, smoother look.',
    start: { normal: 'On damp skin, then moisturiser on top to seal it in.', sensitive: 'On damp skin, then moisturiser on top to seal it in.' },
    product: {
      basic: { default: 'a plain hyaluronic acid serum' },
      mid: { default: 'a multi-weight hyaluronic acid serum' },
      premium: { default: 'a hyaluronic essence with panthenol' },
    },
    sources: ['HA'],
  },
  moisturiser: {
    name: 'Ceramide moisturiser',
    when: 'both', order: 8, always: true, active: false,
    forText: 'Rebuilds your skin barrier, which makes every other step easier to tolerate.',
    start: { normal: 'Morning and night, after your serums.', sensitive: 'Morning and night. Fragrance-free, and the one constant while you add anything new.' },
    product: {
      basic: { oily: 'a light ceramide gel-cream', dry: 'a rich ceramide cream', default: 'a ceramide lotion' },
      mid: { oily: 'an oil-free ceramide gel-cream', dry: 'a ceramide + cholesterol barrier cream', default: 'a ceramide cream' },
      premium: { oily: 'a weightless ceramide water-cream', dry: 'a rich ceramide barrier balm-cream', default: 'a silky ceramide cream' },
    },
    sources: ['AAD-SENS'],
  },
  spf: {
    name: 'Sunscreen, SPF 30+',
    when: 'am', order: 9, always: true, active: false,
    forText: 'The step that matters most: it protects every result, and without it dark spots and lines come back.',
    start: { normal: 'Every morning, rain or shine, two finger-lengths for face and neck. Reapply when outdoors.', sensitive: 'Every morning. A mineral (zinc oxide) formula is usually gentlest.' },
    product: {
      basic: { default: 'a broad-spectrum SPF 30+ lotion' },
      mid: { default: 'a broad-spectrum SPF 50 fluid with a light finish' },
      premium: { default: 'an elegant broad-spectrum SPF 50 fluid, tinted mineral if you prefer' },
    },
    sources: ['AAD-SPF', 'SPF-AGE'],
  },
};

/** Exclusion rules, checked in order. Each returns a reason string if the ingredient must go. */
const EXCLUSIONS = [
  {
    id: 'pregnancy-retinoid',
    test: (ing, p) => p.pregnant && ing.flags?.includes('retinoid'),
    why: 'Retinoids are not recommended while pregnant or breastfeeding.',
    swap: 'azelaic',
  },
  {
    id: 'pregnancy-bha',
    test: (ing, p) => p.pregnant && ing.flags?.includes('leaveOnBHA'),
    why: 'No leave-on salicylic acid while pregnant or breastfeeding. Azelaic acid is the usual gentle swap; ask your doctor or midwife before any acid.',
    swap: 'azelaic',
  },
  {
    id: 'teen-retinoid',
    test: (ing, p) => p.age === 'u18' && ing.flags?.includes('retinoid'),
    why: 'For skin under 18, keep it simple: retinoids for lines aren’t needed yet.',
  },
];

const MAX_ACTIVES = { normal: 3, sensitive: 2 };

/**
 * Build the routine.
 * @param {{goals:string[], skinType:string, age:string, budget:string, pregnant:boolean}} p
 * @returns {{am:Step[], pm:Step[], excluded:{name:string, why:string}[], notes:string[], intro:string[]}}
 */
export function buildRoutine(p) {
  const sensitive = p.skinType === 'sensitive';
  const goals = p.goals?.length ? p.goals : ['hydration'];
  const excluded = [];
  const isExcluded = (id) => {
    const ing = INGREDIENTS[id];
    for (const rule of EXCLUSIONS) {
      if (rule.test(ing, p)) return rule;
    }
    return null;
  };

  // Score every active by how many chosen goals it serves (+ a little for the skin type).
  const candidates = [];
  for (const [id, ing] of Object.entries(INGREDIENTS)) {
    if (ing.always) continue;
    const served = (ing.goals || []).filter((g) => goals.includes(g));
    if (!served.length) continue;
    let score = served.length * 2 + (ing.types?.includes(p.skinType) ? 1 : 0);
    // Goal-specific favourites: the first-line ingredient for each goal gets a nudge.
    if (goals.includes('lines') && id === 'retinoid') score += 2;
    if (goals.includes('redness') && id === 'azelaic') score += 1;
    if (goals.includes('oil') && (id === 'bha' || id === 'niacinamide')) score += 1;
    if (goals.includes('tone') && id === 'vitaminC') score += 1;
    if (sensitive && id === 'bha') score -= 2;        // gentler options first
    if (sensitive && id === 'retinoid') score -= 1;   // still offered for lines, started slowly
    if (sensitive && id === 'niacinamide') score += 1;
    candidates.push({ id, score, served });
  }
  candidates.sort((a, b) => b.score - a.score);

  const chosen = new Set();
  const swaps = [];
  let actives = 0;
  const limit = sensitive ? MAX_ACTIVES.sensitive : MAX_ACTIVES.normal;
  for (const c of candidates) {
    const ing = INGREDIENTS[c.id];
    const rule = isExcluded(c.id);
    if (rule) {
      excluded.push({ name: ing.name, why: rule.why });
      if (rule.swap) swaps.push(rule.swap);
      continue;
    }
    if (ing.active) {
      if (actives >= limit) continue;
      actives++;
    }
    chosen.add(c.id);
  }
  // Swaps for excluded ingredients (e.g. azelaic acid in place of retinol in pregnancy).
  for (const id of swaps) {
    if (chosen.has(id) || isExcluded(id)) continue;
    if (actives >= limit) break;
    chosen.add(id);
    actives++;
  }
  // Dry skin or a hydration goal always gets hyaluronic acid; it isn't an active.
  if (p.skinType === 'dry' || goals.includes('hydration')) chosen.add('hyaluronic');
  for (const [id, ing] of Object.entries(INGREDIENTS)) if (ing.always) chosen.add(id);

  // Clashes: two clashing PM actives go on alternate nights.
  const pmActives = [...chosen].filter((id) => INGREDIENTS[id].active && INGREDIENTS[id].when === 'pm');
  const nights = {};
  const clashNotes = {};
  for (const id of pmActives) {
    const clashes = (INGREDIENTS[id].avoid || []).filter((a) => chosen.has(a.id));
    clashNotes[id] = clashes.map((a) => `Not on the same night as ${INGREDIENTS[a.id].name}: ${a.why}.`);
  }
  // Night A / Night B: the first PM active takes A; anything that clashes with an A item takes B.
  pmActives.sort((a, b) => INGREDIENTS[a].order - INGREDIENTS[b].order);
  for (const id of pmActives) {
    const clashesA = Object.entries(nights).some(([other, n]) => n === 'A' && clashesWith(id, other));
    nights[id] = clashesA ? 'B' : 'A';
  }
  const alternating = Object.values(nights).includes('B');

  const step = (id, when) => {
    const ing = INGREDIENTS[id];
    const prod = ing.product[p.budget] || ing.product.mid;
    const product = prod[p.skinType] || (p.skinType === 'combination' ? prod.oily : null) || prod.default;
    const notes = [...(when === 'pm' ? clashNotes[id] || [] : [])];
    for (const a of ing.avoid || []) {
      if (when === 'am' && chosen.has(a.id)) notes.push(`Keep ${INGREDIENTS[a.id].name} for the evening, ${a.why}.`);
    }
    let start = sensitive ? ing.start.sensitive : ing.start.normal;
    if (id === 'spf' && p.pregnant) start += ' Mineral (zinc oxide) formulas are a comfortable choice in pregnancy.';
    let night = null;
    if (when === 'pm' && alternating && nights[id]) night = nights[id] === 'A' ? 'Night A' : 'Night B';
    return { id, name: ing.name, forText: ing.forText, start, product, notes, night, sources: ing.sources };
  };
  const am = [...chosen].filter((id) => ['am', 'both'].includes(INGREDIENTS[id].when))
    .sort((a, b) => INGREDIENTS[a].order - INGREDIENTS[b].order).map((id) => step(id, 'am'));
  const pm = [...chosen].filter((id) => ['pm', 'both'].includes(INGREDIENTS[id].when))
    .sort((a, b) => INGREDIENTS[a].order - INGREDIENTS[b].order).map((id) => step(id, 'pm'));

  // Make sure the morning ends with SPF, always.
  if (!am.some((s) => s.id === 'spf')) am.push(step('spf', 'am'));

  // Niacinamide once a day is plenty: keep it in the morning only when there are night actives.
  if (pmActives.length) {
    const i = pm.findIndex((s) => s.id === 'niacinamide');
    if (i >= 0) pm.splice(i, 1);
  }

  const notes = [];
  if (alternating) notes.push('Night A and Night B alternate, so the strong actives never meet on the same night.');
  notes.push('Patch test anything new on a small area for 2–3 days first.');
  if (sensitive) notes.push('Sensitive skin: start slowly. Add one new product at a time, about every four weeks, fragrance-free, and stop anything that burns or stings for more than a few minutes.');
  if (p.pregnant) notes.push('Pregnant or breastfeeding: retinoids and leave-on salicylic acid are left out. Check any new product with your doctor or midwife.');
  if (goals.includes('undereye')) notes.push('Under-eye darkness is often inherited or from the shape of the face; sleep, sunscreen and gentle care help most.');
  notes.push('Give it 8–12 weeks. Skin renews slowly, so judge it by your next scans, not by the mirror day to day.');

  // Introduction order: one active at a time.
  const intro = [];
  const activeSteps = [...chosen].filter((id) => INGREDIENTS[id].active);
  activeSteps.forEach((id, i) => {
    const week = i * (sensitive ? 2 : 1) * 2;
    intro.push(`${week === 0 ? 'Now' : `Week ${week}`}: start ${INGREDIENTS[id].name}`);
  });

  return { am, pm, excluded: dedupe(excluded), notes, intro, nights: alternating };
}

function clashesWith(a, b) {
  return (INGREDIENTS[a].avoid || []).some((x) => x.id === b) || (INGREDIENTS[b].avoid || []).some((x) => x.id === a);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => (seen.has(x.name) ? false : seen.add(x.name)));
}

/** Map measures from a scan to suggested goals (the user can change them). */
export function suggestGoals(results) {
  const map = { redness: 'redness', shine: 'oil', tone: 'tone', darkCircles: 'undereye', lines: 'lines', texture: 'pores' };
  return results.focus.map((k) => map[k]).filter(Boolean).slice(0, 2);
}

/** Suggest a skin type from the scan. The person can change it. */
export function suggestSkinType(m) {
  const shineT = m.shine.detail.tzone;
  const shineC = m.shine.detail.cheeks;
  if (m.redness.score >= 65) return 'sensitive';
  if (shineT >= 55 && shineC >= 35) return 'oily';
  if (shineT >= 35 && shineC < 35) return 'combination';
  if (shineT < 15 && m.texture.score >= 55) return 'dry';
  return 'normal';
}
