// A small Mapbox Vector Tile reader: just enough protobuf to get layers, features, tags and
// line/polygon geometry out of an OpenFreeMap .pbf tile. Spec: github.com/mapbox/vector-tile-spec (v2).

class Pbf {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  varint() {
    let val = 0, shift = 0, b;
    do { b = this.buf[this.pos++]; val += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return val;
  }
  svarint() { const n = this.varint(); return n % 2 ? -(n + 1) / 2 : n / 2; }
  bytes() { const len = this.varint(); const out = this.buf.subarray(this.pos, this.pos + len); this.pos += len; return out; }
  string() { return new TextDecoder().decode(this.bytes()); }
  skip(type) {
    if (type === 0) this.varint();
    else if (type === 2) this.pos += this.varint();
    else if (type === 1) this.pos += 8;
    else if (type === 5) this.pos += 4;
  }
  // Calls fn(field, type, end) for each field until `end`.
  read(end, fn) {
    while (this.pos < end) {
      const key = this.varint();
      fn(key >> 3, key & 7);
    }
  }
}

function readValue(p) {
  const end = p.varint() + p.pos;
  let v = null;
  p.read(end, (f, t) => {
    if (f === 1) v = p.string();
    else if (f === 2) { v = new DataView(p.buf.buffer, p.buf.byteOffset + p.pos, 4).getFloat32(0, true); p.pos += 4; }
    else if (f === 3) { v = new DataView(p.buf.buffer, p.buf.byteOffset + p.pos, 8).getFloat64(0, true); p.pos += 8; }
    else if (f === 4 || f === 5) v = p.varint();
    else if (f === 6) v = p.svarint();
    else if (f === 7) v = !!p.varint();
    else p.skip(t);
  });
  return v;
}

function decodeGeometry(cmds) {
  // Returns an array of rings/lines, each an array of [x, y] in tile units (0..extent).
  const lines = [];
  let x = 0, y = 0, line = null, i = 0;
  while (i < cmds.length) {
    const ci = cmds[i++], id = ci & 7, count = ci >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < count; k++) {
        const dx = cmds[i++], dy = cmds[i++];
        x += (dx >> 1) ^ -(dx & 1);
        y += (dy >> 1) ^ -(dy & 1);
        if (id === 1) { line = [[x, y]]; lines.push(line); } else line.push([x, y]);
      }
    } else if (id === 7 && line) line.push(line[0].slice());
  }
  return lines;
}

/** Decode a tile. Returns { layerName: { extent, features: [{ type, tags, geometry }] } } for wanted layers. */
export function decodeTile(arrayBuffer, wanted) {
  const p = new Pbf(new Uint8Array(arrayBuffer));
  const layers = {};
  p.read(p.buf.length, (field, type) => {
    if (field !== 3) return p.skip(type);
    const end = p.varint() + p.pos;
    const layer = { name: '', extent: 4096, keys: [], values: [], raw: [] };
    p.read(end, (f, t) => {
      if (f === 1) layer.name = p.string();
      else if (f === 5) layer.extent = p.varint();
      else if (f === 3) layer.keys.push(p.string());
      else if (f === 4) layer.values.push(readValue(p));
      else if (f === 2) {
        const fend = p.varint() + p.pos;
        const feat = { type: 0, tags: [], geom: [] };
        p.read(fend, (ff, tt) => {
          if (ff === 3) feat.type = p.varint();
          else if (ff === 2 || ff === 4) {
            const e = p.varint() + p.pos;
            const arr = [];
            while (p.pos < e) arr.push(p.varint());
            if (ff === 2) feat.tags = arr; else feat.geom = arr;
          } else p.skip(tt);
        });
        layer.raw.push(feat);
      } else p.skip(t);
    });
    if (wanted && !wanted.includes(layer.name)) return;
    layers[layer.name] = {
      extent: layer.extent,
      features: layer.raw.map((r) => {
        const tags = {};
        for (let i = 0; i < r.tags.length; i += 2) tags[layer.keys[r.tags[i]]] = layer.values[r.tags[i + 1]];
        return { type: r.type, tags, geometry: decodeGeometry(r.geom) };
      }),
    };
  });
  return layers;
}
