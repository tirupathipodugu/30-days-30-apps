// Every fact the study centre shows, in one place so it can be reviewed. Values are typical resting adult values
// from standard textbooks (see the README's Sources). For learning, not medical advice.
//
// Each part: name, kind (artery, vein, muscle, valve, conduction, vessel), what it does, key facts, blood flow,
// one surprising fact, and how the camera frames it: `inside` names the chamber the camera flies into.

export const DISCLAIMER = 'For learning, not medical advice.';

export const HEART = {
  name: 'The human heart',
  does: 'A muscular pump about the size of a fist that drives blood around two circuits at once. The right side sends oxygen-poor blood to the lungs; the left side sends oxygen-rich blood to the rest of the body.',
  facts: [
    ['Weight', 'about 250–350 g in an adult'],
    ['Beats', 'about 100,000 a day at a resting rate of around 70 a minute'],
    ['Output', 'about 5 litres of blood a minute at rest'],
    ['Each beat', 'about 70 mL pushed out by each ventricle'],
  ],
};

export const PARTS = {
  'right-atrium': {
    name: 'Right atrium', kind: 'muscle', inside: 'ra',
    does: 'The receiving chamber for blood returning from the body. It collects oxygen-poor blood between beats, then gives a small squeeze that tops up the right ventricle through the tricuspid valve.',
    facts: [['Pressure', 'about 2–6 mmHg (mean)'], ['Blood oxygen', 'about 70–75% saturated'], ['Wall', 'thin, about 2 mm']],
    from: 'Superior and inferior vena cava, and the coronary sinus (the heart’s own veins)',
    to: 'Right ventricle, through the tricuspid valve',
    surprise: 'The heart’s natural pacemaker, the sinoatrial (SA) node, sits in the wall of this chamber where the superior vena cava joins it. Every normal heartbeat starts here.',
  },
  'left-atrium': {
    name: 'Left atrium', kind: 'muscle', inside: 'la',
    does: 'The receiving chamber for oxygen-rich blood coming back from the lungs. It holds blood while the left ventricle is squeezing, then empties into it through the mitral valve.',
    facts: [['Pressure', 'about 4–12 mmHg (mean)'], ['Blood oxygen', 'about 95–100% saturated'], ['Wall', 'thin, about 2–3 mm']],
    from: 'The four pulmonary veins, from the lungs',
    to: 'Left ventricle, through the mitral valve',
    surprise: 'It is the most posterior chamber, lying just in front of the oesophagus. That is why an ultrasound probe passed down the oesophagus (a transoesophageal echo) gets such a clear view of it.',
  },
  'right-ventricle': {
    name: 'Right ventricle', kind: 'muscle', inside: 'rv',
    does: 'Pumps oxygen-poor blood into the lungs. The lung circuit is short and low-resistance, so this chamber works at a much lower pressure than the left ventricle and has a thinner wall.',
    facts: [['Wall thickness', 'about 3–5 mm'], ['Pressure', 'about 15–30 / 0–8 mmHg'], ['Blood oxygen', 'about 70–75% saturated'], ['Each beat', 'about 70 mL, the same as the left']],
    from: 'Right atrium, through the tricuspid valve',
    to: 'Pulmonary trunk, through the pulmonary valve',
    surprise: 'In cross-section it is crescent-shaped, wrapped around the left ventricle. It moves the same volume of blood as the left side at roughly a fifth of the pressure.',
  },
  'left-ventricle': {
    name: 'Left ventricle', kind: 'muscle', inside: 'lv',
    does: 'The main pumping chamber. It pushes oxygen-rich blood through the aortic valve into the aorta and on to the whole body, so it has the thickest, strongest wall in the heart.',
    facts: [['Wall thickness', 'about 8–12 mm'], ['Pressure', 'about 120 / 0–10 mmHg'], ['Blood oxygen', 'about 95–100% saturated'], ['Ejection fraction', 'about 55–70% of its blood each beat']],
    from: 'Left atrium, through the mitral valve',
    to: 'Aorta, through the aortic valve',
    surprise: 'It twists as it contracts: the base turns one way and the apex the other, wringing the blood out like a towel. It untwists quickly at the end, which helps suck blood back in.',
  },
  septum: {
    name: 'Interventricular septum', kind: 'muscle', inside: 'lv',
    does: 'The wall between the two ventricles. It is mostly thick muscle that squeezes with the left ventricle, with a small thin, fibrous (membranous) part near the aortic valve.',
    facts: [['Thickness', 'about 6–11 mm (muscular part)'], ['Carries', 'the bundle branches of the heart’s wiring']],
    from: 'Not a blood route: it separates the left and right ventricles',
    to: 'Keeps oxygen-rich and oxygen-poor blood apart',
    surprise: 'A hole in this wall, a ventricular septal defect, is one of the most common heart defects present at birth. Many small ones close on their own in childhood.',
  },
  myocardium: {
    name: 'Myocardium (heart muscle)', kind: 'muscle', inside: null,
    does: 'The muscle layer that does the pumping, lined inside by the endocardium and covered outside by the epicardium. Its cells are linked by junctions that let the electrical signal pass straight from cell to cell, so the muscle contracts as one.',
    facts: [['Left ventricular wall', 'about 8–12 mm'], ['Right ventricular wall', 'about 3–5 mm'], ['Mitochondria', 'about a third of each muscle cell’s volume']],
    from: 'Fed by the coronary arteries',
    to: 'Drained by the cardiac veins into the coronary sinus',
    surprise: 'Heart muscle cells renew very slowly: roughly 1% a year in young adults, falling with age. Most of the cells you have now will be with you for life.',
  },
  'tricuspid-valve': {
    name: 'Tricuspid valve', kind: 'valve', inside: 'ra',
    does: 'The one-way door between the right atrium and right ventricle. Its three leaflets open to let blood in, then snap shut when the ventricle squeezes, so blood goes forward into the lungs and not back.',
    facts: [['Leaflets', '3: anterior, posterior and septal'], ['Opening', 'about 7–9 cm², the largest of the four valves'], ['Sound', 'its closing is part of the first heart sound, “lub”']],
    from: 'Right atrium',
    to: 'Right ventricle',
    surprise: 'Valves have no muscle of their own. They open and close purely because of pressure differences; the cords below them only stop them flipping backwards.',
  },
  'pulmonary-valve': {
    name: 'Pulmonary valve', kind: 'valve', inside: 'rv',
    does: 'Guards the exit of the right ventricle. Its three half-moon cusps open as the ventricle pushes blood into the pulmonary trunk, then close to stop it falling back.',
    facts: [['Cusps', '3 (semilunar)'], ['Sound', 'its closing is part of the second heart sound, “dub”']],
    from: 'Right ventricle',
    to: 'Pulmonary trunk, then the lungs',
    surprise: 'When you breathe in, this valve closes a fraction later than the aortic valve, so the second heart sound can split into two. Doctors call this normal splitting.',
  },
  'mitral-valve': {
    name: 'Mitral valve', kind: 'valve', inside: 'la',
    does: 'The one-way door between the left atrium and left ventricle. Its two leaflets, held by tendon-like cords, seal under the full force of the left ventricle.',
    facts: [['Leaflets', '2: anterior and posterior'], ['Opening', 'about 4–6 cm²'], ['Sound', 'its closing is part of the first heart sound, “lub”']],
    from: 'Left atrium',
    to: 'Left ventricle',
    surprise: 'It is named after a bishop’s mitre, the two-pointed hat its two leaflets resemble.',
  },
  'aortic-valve': {
    name: 'Aortic valve', kind: 'valve', inside: 'lv',
    does: 'Guards the exit of the left ventricle. Its three cusps open as blood is driven into the aorta and close when the ventricle relaxes, holding back the pressure in the aorta.',
    facts: [['Cusps', '3: right, left and posterior (non-coronary)'], ['Opening', 'about 3–4 cm²'], ['Sound', 'its closing is part of the second heart sound, “dub”']],
    from: 'Left ventricle',
    to: 'Aorta',
    surprise: 'The two coronary arteries open just above two of its cusps. About 1–2% of people are born with only two cusps, a bicuspid aortic valve.',
  },
  'papillary-muscles': {
    name: 'Papillary muscles and chordae', kind: 'muscle', inside: 'lv',
    does: 'Finger-like muscles in the ventricles, tied to the tricuspid and mitral leaflets by fine cords (chordae tendineae). They tighten as the ventricle squeezes so the leaflets cannot balloon back into the atria.',
    facts: [['Left ventricle', '2 papillary muscles'], ['Right ventricle', 'usually 3']],
    from: 'Part of the ventricular wall',
    to: 'Anchor the tricuspid and mitral valve leaflets',
    surprise: 'The chordae tendineae are nicknamed the “heart strings”.',
  },
  aorta: {
    name: 'Aorta and aortic arch', kind: 'artery', inside: null,
    does: 'The body’s largest artery. It rises from the left ventricle, arches over the heart giving off the arteries to the head and arms, then runs down through the chest and abdomen.',
    facts: [['Diameter', 'about 2.5–3.5 cm near the heart'], ['Pressure', 'about 120/80 mmHg'], ['Blood oxygen', 'about 95–100% saturated'], ['Arch branches', 'brachiocephalic trunk, left common carotid, left subclavian']],
    from: 'Left ventricle, through the aortic valve',
    to: 'Every organ in the body, including the heart itself through the coronary arteries',
    surprise: 'Its elastic wall stretches with every beat and recoils between beats, so blood keeps flowing to the body even while the heart is refilling.',
  },
  'pulmonary-trunk': {
    name: 'Pulmonary trunk and arteries', kind: 'artery', inside: null,
    does: 'Carries oxygen-poor blood from the right ventricle to the lungs. The short trunk splits into the right and left pulmonary arteries, one for each lung.',
    facts: [['Pressure', 'about 15–30 / 4–12 mmHg'], ['Blood oxygen', 'about 70–75% saturated'], ['Trunk', 'about 5 cm long']],
    from: 'Right ventricle, through the pulmonary valve',
    to: 'The lungs, where the blood picks up oxygen',
    surprise: 'These are arteries that carry oxygen-poor blood. An artery is defined by carrying blood away from the heart, not by how much oxygen it holds.',
  },
  'superior-vena-cava': {
    name: 'Superior vena cava', kind: 'vein', inside: null,
    does: 'The large vein that returns oxygen-poor blood from the head, neck, arms and upper chest to the right atrium.',
    facts: [['Diameter', 'about 2 cm'], ['Length', 'about 7 cm'], ['Pressure', 'about 2–6 mmHg']],
    from: 'Head, neck, arms and upper chest',
    to: 'Right atrium',
    surprise: 'It has no valve where it enters the heart. The pressure in it is close to the pressure in the right atrium, which is why doctors can use it to judge how full the circulation is.',
  },
  'inferior-vena-cava': {
    name: 'Inferior vena cava', kind: 'vein', inside: null,
    does: 'The body’s largest vein. It returns oxygen-poor blood from the legs, abdomen and pelvis to the right atrium.',
    facts: [['Diameter', 'about 2 cm'], ['Pressure', 'about 2–6 mmHg']],
    from: 'Legs, abdomen and pelvis',
    to: 'Right atrium',
    surprise: 'Before birth, a flap at its entrance (the Eustachian valve) steers oxygen-rich blood from the placenta across a hole into the left atrium, skipping the lungs that are not yet breathing.',
  },
  'pulmonary-veins': {
    name: 'Pulmonary veins', kind: 'vein', inside: null,
    does: 'Bring oxygen-rich blood back from the lungs to the left atrium. There are usually four, two from each lung.',
    facts: [['Number', 'usually 4'], ['Blood oxygen', 'about 95–100% saturated'], ['Pressure', 'about 4–12 mmHg']],
    from: 'The lungs',
    to: 'Left atrium',
    surprise: 'They are veins that carry oxygen-rich blood. Sleeves of heart muscle extend a short way into them, and these are the commonest trigger site for atrial fibrillation.',
  },
  'right-coronary': {
    name: 'Right coronary artery', kind: 'artery', inside: null,
    does: 'One of the two arteries that feed the heart muscle itself. It runs in the groove between the right atrium and ventricle and supplies the right side of the heart and, in most people, the back of the septum.',
    facts: [['Origin', 'just above the aortic valve'], ['Diameter', 'about 3–4 mm near its start'], ['Supplies', 'the SA node in about 60% of people and the AV node in about 80–90%']],
    from: 'Aorta, just above the aortic valve',
    to: 'Right atrium, right ventricle and the back of the septum',
    surprise: 'Heart muscle gets most of its blood between beats: during each squeeze the muscle presses its own vessels shut.',
  },
  'left-coronary': {
    name: 'Left coronary artery', kind: 'artery', inside: null,
    does: 'The other artery feeding the heart muscle. Its short main stem splits into the anterior descending branch, which runs down the front of the septum, and the circumflex branch, which wraps around the left side.',
    facts: [['Origin', 'just above the aortic valve'], ['Branches', 'left anterior descending and circumflex'], ['Supplies', 'most of the left ventricle and the front of the septum']],
    from: 'Aorta, just above the aortic valve',
    to: 'Left atrium, left ventricle and the front two-thirds of the septum',
    surprise: 'At rest the heart takes about 5% of everything it pumps, roughly 250 mL a minute, just to feed itself.',
  },
  'cardiac-veins': {
    name: 'Cardiac veins and coronary sinus', kind: 'vein', inside: null,
    does: 'Collect the used blood from the heart muscle. Most of them drain into the coronary sinus, a wide vein in the groove at the back of the heart that empties into the right atrium.',
    facts: [['Coronary sinus', 'about 3–5 cm long'], ['Blood oxygen', 'about 30% saturated, the lowest in the body at rest']],
    from: 'The heart muscle',
    to: 'Right atrium, through the coronary sinus',
    surprise: 'Heart muscle pulls about 70–75% of the oxygen out of its blood at rest, more than almost any other organ. To get more, it has to get more blood.',
  },
  'sa-node': {
    name: 'Sinoatrial (SA) node', kind: 'conduction', inside: 'ra',
    does: 'The heart’s natural pacemaker: a small strip of specialised cells that fire on their own, starting each heartbeat. The signal spreads across both atria and makes them contract.',
    facts: [['Rate', 'about 60–100 a minute at rest'], ['Size', 'about 10–20 mm long'], ['Position', 'where the superior vena cava meets the right atrium']],
    from: 'Fires by itself, sped up or slowed by the nervous system and hormones',
    to: 'Its signal spreads across the atria to the AV node',
    surprise: 'If it fails, other tissue takes over at a slower rate: the AV node area at about 40–60 a minute.',
    note: 'The node is not in the source model; its position is marked here.',
  },
  'av-node': {
    name: 'Atrioventricular (AV) node', kind: 'conduction', inside: 'ra',
    does: 'The gate between the atria and the ventricles. It holds the electrical signal back for about a tenth of a second so the atria can finish emptying, then passes it down the septum to the ventricles.',
    facts: [['Delay', 'about 0.1 s'], ['ECG', 'most of the PR interval, normally 0.12–0.20 s'], ['Position', 'in the floor of the right atrium, near the coronary sinus opening']],
    from: 'The SA node’s signal, across the atria',
    to: 'The bundle of His, then the bundle branches in the septum',
    surprise: 'It is normally the only electrical bridge between atria and ventricles; a ring of fibrous tissue insulates everywhere else.',
    note: 'The node is not in the source model; its position is marked here.',
  },
};

// Blood's path, one stop per click. `part` is framed and highlighted; `outside` keeps the camera outside the heart,
// `lungs` pulls back for the trip through the lungs.
export const TOUR = [
  { part: 'superior-vena-cava', outside: true, title: 'Vena cavae', text: 'Oxygen-poor blood from the body returns through the superior and inferior vena cava.' },
  { part: 'right-atrium', title: 'Right atrium', text: 'It collects in the right atrium between beats.' },
  { part: 'tricuspid-valve', title: 'Tricuspid valve', text: 'The tricuspid valve opens and the blood falls into the right ventricle.' },
  { part: 'right-ventricle', title: 'Right ventricle', text: 'The right ventricle squeezes. The tricuspid valve snaps shut behind the blood.' },
  { part: 'pulmonary-valve', title: 'Pulmonary valve', text: 'The pulmonary valve opens to let it out.' },
  { part: 'pulmonary-trunk', outside: true, title: 'Pulmonary arteries', text: 'The pulmonary trunk splits into the arteries to each lung.' },
  { part: 'pulmonary-trunk', title: 'The lungs', text: 'In the lungs, blood drops carbon dioxide and picks up oxygen. It turns bright red.', lungs: true },
  { part: 'pulmonary-veins', outside: true, title: 'Pulmonary veins', text: 'Four pulmonary veins bring the oxygen-rich blood back to the heart.' },
  { part: 'left-atrium', title: 'Left atrium', text: 'It collects in the left atrium.' },
  { part: 'mitral-valve', title: 'Mitral valve', text: 'The mitral valve opens and the blood fills the left ventricle.' },
  { part: 'left-ventricle', title: 'Left ventricle', text: 'The strongest chamber squeezes, at about 120 mmHg.' },
  { part: 'aortic-valve', title: 'Aortic valve', text: 'The aortic valve opens, and the coronary arteries take the first share for the heart itself.' },
  { part: 'aorta', outside: true, title: 'Aorta', text: 'Up the aorta, over the arch and out to the whole body. At rest, a full lap of the body takes about a minute.' },
];

// Shown when a thread is blocked, and when the heart stops.
export const BLOCKED = {
  name: 'A blocked vessel',
  does: 'The glass threads stand in for the arteries that carry blood away from the heart. A blockage stops blood reaching everything past it, so the heart beats faster and harder to keep pressure and flow up, which makes it need more oxygen itself.',
  facts: [['Click a thread', 'to block it at that point'], ['Click the clot', 'to clear it']],
  note: 'This is a simplified picture. In real life, a blocked coronary artery starves part of the heart muscle (a heart attack), and the most common cause of cardiac arrest is a dangerous heart rhythm.',
};
export const ARREST = {
  title: 'The heart has stopped',
  text: 'With every vessel blocked, no blood can leave the heart. When the heart stops pumping effectively, it is called cardiac arrest.',
  // The message to take away: standard heart-health guidance (WHO, American Heart Association "Life's Essential 8").
  careTitle: 'Yours doesn’t come with a restart button. Take care of it.',
  care: [
    'Move for at least 150 minutes a week. A brisk walk counts.',
    'Don’t smoke or vape.',
    'Sleep 7 to 9 hours a night.',
    'Eat more vegetables, fruit and whole grains, and less salt and sugar.',
    'Know your blood pressure, cholesterol and blood sugar numbers.',
    'Learn CPR. If someone collapses, call emergency services and push hard and fast on the centre of the chest.',
  ],
};
