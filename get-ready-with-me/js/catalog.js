// The built-in samples: our own product-style renders (tools/make-catalog.mjs), so the app works with no setup.
// `query` is what "Shop similar on Amazon" searches for in the chosen store.

export const CATALOG = [
  { file: 'aviator-gold.svg', title: 'Gold aviators, green lenses', category: 'sunglasses', query: 'gold aviator sunglasses green lens' },
  { file: 'wayfarer-black.svg', title: 'Classic black square sunglasses', category: 'sunglasses', query: 'black square sunglasses' },
  { file: 'cateye-black.svg', title: 'Black cat-eye sunglasses', category: 'sunglasses', query: 'cat eye sunglasses women black' },
  { file: 'sport-blue.svg', title: 'Blue mirrored sport sunglasses', category: 'sunglasses', query: 'blue mirrored sunglasses' },
  { file: 'round-tortoise.svg', title: 'Round tortoiseshell glasses', category: 'glasses', query: 'round tortoise shell eyeglasses frame' },
  { file: 'crystal-clear.svg', title: 'Clear crystal frame glasses', category: 'glasses', query: 'transparent frame eyeglasses' },
  { file: 'titanium-rect.svg', title: 'Thin titanium glasses', category: 'glasses', query: 'titanium rectangle eyeglasses frame' },
  { file: 'cap-navy.svg', title: 'Navy baseball cap', category: 'cap', query: 'navy blue baseball cap' },
  { file: 'cap-black.svg', title: 'Black baseball cap', category: 'cap', query: 'black baseball cap' },
  { file: 'cap-sand.svg', title: 'Sand cotton cap', category: 'cap', query: 'beige cotton baseball cap' },
  { file: 'fedora-charcoal.svg', title: 'Charcoal felt fedora', category: 'hat', query: 'charcoal fedora hat' },
  { file: 'bucket-olive.svg', title: 'Olive bucket hat', category: 'hat', query: 'olive bucket hat' },
  { file: 'hoops-gold.svg', title: 'Gold hoop earrings', category: 'earrings', query: 'gold hoop earrings' },
  { file: 'pearl-drops.svg', title: 'Pearl drop earrings', category: 'earrings', query: 'pearl drop earrings' },
  { file: 'studs-diamond.svg', title: 'Silver crystal studs', category: 'earrings', query: 'silver stud earrings' },
  { file: 'drops-gold.svg', title: 'Long gold drop earrings', category: 'earrings', query: 'long gold drop earrings' },
  { file: 'watch-steel.svg', title: 'Steel watch, black dial', category: 'watch', query: 'stainless steel analog watch black dial' },
  { file: 'watch-gold-leather.svg', title: 'Gold watch, brown leather', category: 'watch', query: 'gold watch brown leather strap' },
  { file: 'bracelet-chain.svg', title: 'Silver chain bracelet', category: 'bracelet', query: 'silver chain bracelet' },
  { file: 'bracelet-beads.svg', title: 'Stone bead bracelet', category: 'bracelet', query: 'stone bead bracelet' },
];

export const FILTERS = [
  ['all', 'All'],
  ['eyes', 'Glasses', ['glasses', 'sunglasses']],
  ['head', 'Caps & hats', ['cap', 'hat']],
  ['ears', 'Earrings', ['earrings']],
  ['wrist', 'Watches', ['watch', 'bracelet']],
];
