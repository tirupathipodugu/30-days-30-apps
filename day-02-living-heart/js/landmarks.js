// Heart landmarks (apex, AV plane, vessel cuts): rescaling them with the mesh, and turning them into thread roots.

/** Map every point in a landmark set through p → (p − centre) · s; radii scale by s, directions stay. */
export function normalizeLandmarks(L, centre, s) {
  const P = (p) => [(p[0] - centre[0]) * s, (p[1] - centre[1]) * s, (p[2] - centre[2]) * s];
  const V = (v) => v && ({ ...v, point: P(v.point), ...(v.root ? { root: P(v.root) } : {}), ...(v.path ? { path: v.path.map(P) } : {}), radius: v.radius * s });
  return {
    ...L,
    apex: P(L.apex),
    avPlane: { point: P(L.avPlane.point), normal: L.avPlane.normal },
    aorta: V(L.aorta), pulmonaryTrunk: V(L.pulmonaryTrunk), svc: V(L.svc), ivc: V(L.ivc),
    pulmonaryVeins: L.pulmonaryVeins.map(V),
    ...(L.arch ? { arch: L.arch.map(V) } : {}),
    ...(L.atria ? { atria: L.atria.map(P) } : {}),
  };
}

/** Six thread roots: aorta, pulmonary trunk, both venae cavae and one pulmonary vein on each side. */
export function threadRoots(L) {
  const pv = L.pulmonaryVeins;
  const right = pv.reduce((a, b) => (b.point[0] < a.point[0] ? b : a));
  const left = pv.reduce((a, b) => (b.point[0] > a.point[0] ? b : a));
  return [L.aorta, L.pulmonaryTrunk, L.svc, L.ivc, right, left].map((v) => {
    const l = Math.hypot(...v.dir) || 1;
    const dir = v.dir.map((c) => c / l);
    return { pos: v.point.map((c, k) => c + dir[k] * 0.004), dir };
  });
}
