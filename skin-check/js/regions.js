// Region masks from MediaPipe Face Landmarker landmarks (the 468-point canonical face mesh).
// Each region is a polygon built from landmarks, or from points mixed between landmarks, so it
// follows the face as it turns. Offsets use the face's own axes (eye line and its perpendicular)
// scaled by the distance between the eye centres, so every region is normalised by face size.
//
// "A" is the side on the left of the (unmirrored) camera image, which is the person's right.

// Eye openings (lid contours), used for the sclera exposure reference in the light check.
export const EYE_A = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
export const EYE_B = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const LOWER_LID_A = [163, 144, 145, 153, 154];
const LOWER_LID_B = [390, 373, 374, 380, 381];
const BROW_A = [105, 66, 107];          // mid-brow → inner brow (upper edge)
const BROW_B = [336, 296, 334];         // inner → mid-brow
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

export const REGION_NAMES = ['forehead', 'nose', 'cheekA', 'cheekB', 'underA', 'underB', 'chin', 'crowA', 'crowB', 'nlA', 'nlB'];

export const REGION_LABELS = {
  forehead: 'forehead', nose: 'nose', cheekA: 'cheek', cheekB: 'cheek', underA: 'under-eye', underB: 'under-eye',
  chin: 'chin', crowA: 'eye corner', crowB: 'eye corner', nlA: 'smile line', nlB: 'smile line',
};

/**
 * @param {{x:number,y:number}[]} lm landmarks in pixel coordinates (of whatever image you pass)
 * @returns geometry: polygons per region, face axes, eye distance, expected line directions.
 */
export function buildRegions(lm) {
  const P = (i) => [lm[i].x, lm[i].y];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const add = (a, v, s) => [a[0] + v[0] * s, a[1] + v[1] * s];
  const avg = (ids) => ids.reduce((s, i) => [s[0] + lm[i].x / ids.length, s[1] + lm[i].y / ids.length], [0, 0]);

  const eyeA = avg([33, 133, 159, 145]);
  const eyeB = avg([263, 362, 386, 374]);
  const ed = Math.hypot(eyeB[0] - eyeA[0], eyeB[1] - eyeA[1]);
  const e = [(eyeB[0] - eyeA[0]) / ed, (eyeB[1] - eyeA[1]) / ed];   // A → B along the eye line
  const d = [-e[1], e[0]];                                           // perpendicular, pointing down the face
  // Make sure d points from the eyes toward the mouth.
  const mouth = mix(P(61), P(291), 0.5);
  const mid = mix(eyeA, eyeB, 0.5);
  if ((mouth[0] - mid[0]) * d[0] + (mouth[1] - mid[1]) * d[1] < 0) { d[0] = -d[0]; d[1] = -d[1]; }

  const R = {};

  // Forehead: a central band above the brows, kept clear of the hairline.
  const browPts = [...BROW_A, ...BROW_B].map(P);
  const fhBottom = browPts.map((p) => add(p, d, -0.16 * ed));
  const top = P(10);
  const fhTop = browPts.map((p) => {
    const lifted = add(p, d, -0.62 * ed);
    // never above 80% of the way from brow to the top of the face mesh
    const cap = mix(p, [top[0] + (p[0] - mid[0]) * 0.2, top[1] + (p[1] - mid[1]) * 0.2], 0.8);
    const liftDist = 0.62 * ed;
    const capDist = Math.hypot(cap[0] - p[0], cap[1] - p[1]);
    return capDist < liftDist ? cap : lifted;
  });
  R.forehead = [...fhBottom, ...fhTop.reverse()];

  // Nose: the bridge below the eyes down to the tip.
  R.nose = [
    add(P(6), e, -0.1 * ed), add(P(6), e, 0.1 * ed),
    mix(P(4), P(358), 0.55), mix(P(4), P(2), 0.4), mix(P(4), P(129), 0.55),
  ];

  // Cheeks: the classic cheek patch on the mesh (below the eye, outside the nose, above the jaw).
  const CHEEK_A = [117, 101, 36, 205, 187, 147, 123];
  const CHEEK_B = [346, 330, 266, 425, 411, 376, 352];
  const cheekA = CHEEK_A.map(P), cheekB = CHEEK_B.map(P);

  // Under-eyes: a band just below the lower lid.
  const under = (lid) => {
    const pts = lid.map(P);
    return [...pts.map((p) => add(p, d, 0.1 * ed)), ...pts.reverse().map((p) => add(p, d, 0.36 * ed))];
  };
  R.underA = under(LOWER_LID_A);
  R.underB = under(LOWER_LID_B);

  // Chin: below the lower lip.
  const lip = P(17), chinBottom = P(152);
  const c1 = mix(lip, chinBottom, 0.28), c2 = mix(lip, chinBottom, 0.82);
  R.chin = [add(c1, e, -0.3 * ed), add(c1, e, 0.3 * ed), add(c2, e, 0.22 * ed), add(c2, e, -0.22 * ed)];

  // Crow's feet: beside the outer eye corners (lines run roughly along the eye line).
  const crow = (corner, out) => {
    const c = P(corner);
    const a = add(c, e, out * 0.05 * ed), b = add(c, e, out * 0.27 * ed);
    return [add(a, d, -0.16 * ed), add(b, d, -0.2 * ed), add(b, d, 0.22 * ed), add(a, d, 0.16 * ed)];
  };
  R.crowA = crow(33, -1);
  R.crowB = crow(263, 1);

  // Smile lines (nasolabial): a band along the line from the nose wing to just outside the mouth corner.
  const nl = (ala, corner, out) => {
    const a = add(P(ala), e, out * 0.06 * ed), b = add(P(corner), e, out * 0.1 * ed);
    const v = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(v[0], v[1]) || 1;
    const n = [-v[1] / len, v[0] / len];
    const w = 0.09 * ed;
    return { poly: [add(a, n, -w), add(a, n, w), add(b, n, w), add(b, n, -w)], dir: n };
  };
  const nlA = nl(129, 61, -1), nlB = nl(358, 291, 1);
  R.nlA = nlA.poly;
  R.nlB = nlB.poly;

  // Expected gradient direction across each line region (lines run perpendicular to it).
  const grad = {
    forehead: d, crowA: d, crowB: d, nlA: nlA.dir, nlB: nlB.dir,
  };

  R.cheekA = cheekA;
  R.cheekB = cheekB;
  const ordered = {};
  for (const k of ['forehead', 'nose', 'underA', 'underB', 'crowA', 'crowB', 'nlA', 'nlB', 'cheekA', 'cheekB', 'chin']) ordered[k] = R[k];

  const oval = FACE_OVAL.map(P);
  return { regions: ordered, e, d, ed, grad, eyes: { A: EYE_A.map(P), B: EYE_B.map(P) }, oval, mid };
}

/** Head pose from the facial transformation matrix (column-major 4×4), in degrees. */
export function headPose(matrix) {
  if (!matrix) return null;
  const m = matrix.data || matrix;
  // Rotation part, row r col c = m[c*4 + r]
  const r = (row, col) => m[col * 4 + row];
  const yaw = Math.atan2(-r(2, 0), Math.hypot(r(2, 1), r(2, 2))) * 180 / Math.PI;
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * 180 / Math.PI;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * 180 / Math.PI;
  return { yaw, pitch, roll };
}

/** Yaw sign from the landmarks themselves: where the nose tip sits between the face edges (−1…1). */
export function noseOffset(lm) {
  const a = lm[234].x, b = lm[454].x, n = lm[1].x;
  return ((n - a) / (b - a || 1)) * 2 - 1;
}
