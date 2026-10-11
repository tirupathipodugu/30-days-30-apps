// Category rules: keywords in the search text, product title, link slug or file name.
// Returns one of: sunglasses, glasses, cap, hat, earrings, watch, bracelet, clothing, or null (unknown).

const RULES = [
  ['sunglasses', /\b(sun ?glass(es)?|shades|polari[sz]ed|uv ?400|aviators?|wayfarers?)\b/],
  ['glasses', /\b(eye ?glass(es)?|spectacles?|specs|optical frames?|blue ?(light|cut)|computer glasses|reading glasses|glasses|eyewear|frames? for (men|women))\b/],
  ['earrings', /\b(ear ?rings?|studs?|hoops?|jhumk(a|i|as|is)|danglers?|ear ?cuffs?|drops? earrings?)\b/],
  ['watch', /\b(watch(es)?|chronograph|timepiece|smart ?watch)\b/],
  ['bracelet', /\b(bracelets?|bangles?|kadas?|wrist ?bands?|cuff bracelets?|charm bracelet)\b/],
  ['cap', /\b(caps?|baseball|snapback|trucker|visor)\b/],
  ['hat', /\b(hats?|fedora|bucket|beanie|panama|beret|trilby|sun ?hat)\b/],
];

const CLOTHING = /\b(t ?-?shirts?|tees?|shirts?|tops?|polos? shirt|blouses?|kurt(a|i|as|is)|tunics?|pants|trousers?|jeans|denims?|chinos?|joggers?|track ?pants|leggings|shorts|skirts?|dress(es)?|gowns?|jumpsuits?|sarees?|saris?|lehengas?|salwar|dupattas?|jackets?|blazers?|coats?|hoodies?|sweat ?shirts?|sweaters?|cardigans?|suits?|innerwear|night ?wear|pyjamas?|kurta sets?|ethnic wear|co-?ords?)\b/;

export function classify(...texts) {
  const text = texts.filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9 -]+/g, ' ');
  if (!text.trim()) return null;
  for (const [category, re] of RULES) if (re.test(text)) return category;
  if (CLOTHING.test(text)) return 'clothing';
  return null;
}

/** Clothing words alone (used on search text, where an accessory word may not be present yet). */
export const isClothing = (text) => classify(text) === 'clothing';

/** How each category is worn: which tracker and which anchoring it uses. */
export const KIND = {
  sunglasses: 'glasses', glasses: 'glasses', cap: 'headwear', hat: 'headwear',
  earrings: 'earrings', watch: 'wrist', bracelet: 'wrist',
};

export const LABEL = {
  sunglasses: 'Sunglasses', glasses: 'Glasses', cap: 'Cap', hat: 'Hat',
  earrings: 'Earrings', watch: 'Watch', bracelet: 'Bracelet',
};
