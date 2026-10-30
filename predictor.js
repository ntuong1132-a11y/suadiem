// predictor.js - Markov bậc 3 + NN 7→16→16→2 + Ensemble trọng số động
const TAI = 0, XIU = 1; // 0 = Tài, 1 = Xỉu

// PRNG có seed + Box-Muller để khởi tạo trọng số lặp lại được
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randn = (rnd, std) =>
  std * Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const argmax = (a) => (a[0] >= a[1] ? 0 : 1);

// ---------- Thuật toán 1: Markov ----------
class Markov {
  constructor(order = 3, alpha = 0.1) {
    this.order = order;
    this.alpha = alpha;
    this.m = new Map();
  }

  fit(h) {
    this.m.clear();
    for (let i = 0; i < h.length - this.order; i++) {
      const key = h.slice(i, i + this.order).join(",");
      if (!this.m.has(key)) this.m.set(key, [0, 0]);
      this.m.get(key)[h[i + this.order]]++;
    }
  }

  static hamming(a, b) {
    const x = a.split(","), y = b.split(",");
    let d = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
    return d;
  }

  predict(h) {
    let key = h.slice(-this.order).join(",");
    if (!this.m.has(key) && this.m.size) {
      let best = null, bd = Infinity;
      for (const k of this.m.keys()) {
        const d = Markov.hamming(k, key);
        if (d < bd) { bd = d; best = k; }
      }
      key = best;
    }
    const c = this.m.get(key) || [0, 0];
    const tot = c[0] + c[1], a = this.alpha;
    return [(c[0] + a) / (tot + 2 * a), (c[1] + a) / (tot + 2 * a)];
  }
}

// ---------- Thuật toán 2: Neural Network ----------
function features(h) {
  const n = h.length;
  const ft = h.filter((v) => v === TAI).length / n;
  const fx = h.filter((v) => v === XIU).length / n;
  const mx = [0, 0];
  let run = 0;
  for (let i = 0; i < n; i++) {
    run = i > 0 && h[i - 1] === h[i] ? run + 1 : 1;
    mx[h[i]] = Math.max(mx[h[i]], run);
  }
  let flips = 0;
  for (let i = 1; i < n; i++) if (h[i] !== h[i - 1]) flips++;
  flips /= Math.max(n - 1, 1);
  return [ft, fx, mx[TAI] / n, mx[XIU] / n, flips, h[n - 1], h[n - 2]];
}

const softmax = (z) => {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
};

function dense(x, W, b, relu) {
  const out = b.slice();
  for (let j = 0; j < b.length; j++) {
    for (let i = 0; i < x.length; i++) out[j] += x[i] * W[i][j];
    if (relu && out[j] < 0) out[j] = 0;
  }
  return out;
}

class NN {
  constructor(seed = 0) {
    const rnd = mulberry32(seed);
    const mat = (r, c) =>
      Array.from({ length: r }, () => Array.from({ length: c }, () => randn(rnd, 0.5)));
    this.W1 = mat(7, 16); this.b1 = new Array(16).fill(0);
    this.W2 = mat(16, 16); this.b2 = new Array(16).fill(0);
    this.W3 = mat(16, 2);  this.b3 = new Array(2).fill(0);
  }

  load(w) { Object.assign(this, w); }

  predict(h) {
    const X = features(h);
    const A1 = dense(X, this.W1, this.b1, true);
    const A2 = dense(A1, this.W2, this.b2, true);
    return softmax(dense(A2, this.W3, this.b3, false));
  }
}

// ---------- Thuật toán 3: Ensemble ----------
class Ensemble {
  constructor(window = 20) {
    this.mk = new Markov();
    this.nn = new NN();
    this.w = [0.5, 0.5];
    this.window = window;
    this.hist = [[], []];
    this.pm = null;
    this.pn = null;
  }

  predict(h) {
    if (h.length < 4) throw new Error("Cần ít nhất 4 phiên lịch sử");
    this.mk.fit(h);
    this.pm = this.mk.predict(h);
    this.pn = this.nn.predict(h);
    const p = [
      this.w[0] * this.pm[0] + this.w[1] * this.pn[0],
      this.w[0] * this.pm[1] + this.w[1] * this.pn[1],
    ];
    return { pred: argmax(p), p };
  }

  update(actual) {
    const preds = [this.pm, this.pn].map(argmax);
    preds.forEach((pd, i) => {
      this.hist[i].push(pd === actual ? 1 : 0);
      if (this.hist[i].length > this.window) this.hist[i].shift();
    });
    const acc = this.hist.map(mean);
    const s = acc[0] + acc[1];
    const target = s ? [acc[0] / s, acc[1] / s] : [0.5, 0.5];
    let w = [0.8 * this.w[0] + 0.2 * target[0], 0.8 * this.w[1] + 0.2 * target[1]];
    const t = w[0] + w[1];
    this.w = [w[0] / t, w[1] / t];
  }
}

module.exports = { Markov, NN, Ensemble, TAI, XIU };
