// Minimalny czytnik tekstu z PDF — bez bibliotek, tylko DecompressionStream przeglądarki.
// Zakres: PDF bez szyfrowania, strumienie FlateDecode, fonty z mapą ToUnicode (np. wyciągi
// VeloBank z wkhtmltopdf/Qt). Wynik: linie tekstu ułożone jak `pdftotext -layout`
// (znaki z tą samą linią bazową → jedna linia; duża przerwa → kilka spacji).
// Nie obsługuje: szyfrowania, strumieni obiektów (ObjStm), fontów bez ToUnicode, skanów.
(function (W) {
  "use strict";

  const latin1 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };

  async function inflate(u8) {
    const ds = new DecompressionStream("deflate");
    const strumien = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(strumien).arrayBuffer());
  }

  // --- obiekty ------------------------------------------------------------------
  function obiekty(u8, s) {
    const obj = new Map(), re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      const start = m.index + m[0].length;
      const koniec = s.indexOf("endobj", start);
      if (koniec < 0) break;
      let cialo = s.slice(start, koniec);
      const st = /\bstream\r?\n/.exec(cialo);
      let dane = null;
      if (st) {
        const slownik = cialo.slice(0, st.index);
        const od = start + st.index + st[0].length;
        let dl = /\/Length\s+(\d+)(?![\d\s]*R)/.exec(slownik);
        dane = { slownik, od, dl: dl ? +dl[1] : null };
        cialo = slownik;
        re.lastIndex = koniec;   // binarne dane strumienia mogą zawierać "N 0 obj"
      }
      obj.set(+m[1], { cialo, dane });
    }
    // długości pośrednie (/Length 18 0 R) i odczyt bajtów strumieni
    for (const o of obj.values()) {
      if (!o.dane) continue;
      let dl = o.dane.dl;
      if (dl == null) {
        const r = /\/Length\s+(\d+)\s+\d+\s+R/.exec(o.dane.slownik);
        const ro = r && obj.get(+r[1]);
        dl = ro ? parseInt(ro.cialo.trim(), 10) : null;
      }
      if (dl == null || !isFinite(dl)) {
        const e = s.indexOf("endstream", o.dane.od);
        dl = Math.max(0, e - o.dane.od);
      }
      o.bajty = u8.subarray(o.dane.od, o.dane.od + dl);
      o.flate = /\/Filter\s*(\[\s*)?\/FlateDecode/.test(o.dane.slownik);
    }
    return obj;
  }

  const ref = (txt, klucz) => { const m = new RegExp("/" + klucz + "\\s+(\\d+)\\s+\\d+\\s+R").exec(txt); return m ? +m[1] : null; };

  async function strumien(obj, nr) {
    const o = obj.get(nr);
    if (!o || !o.bajty) return "";
    return latin1(o.flate ? await inflate(o.bajty) : o.bajty);
  }

  // --- fonty: ToUnicode + szerokości ----------------------------------------------
  function hexNaTekst(h) {
    let t = "";
    for (let i = 0; i + 3 < h.length + 0; i += 4) t += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    if (h.length === 2) t = String.fromCharCode(parseInt(h, 16));
    return t;
  }

  function cmapa(txt) {
    const map = new Map();
    let bajtow = 2;
    const zakres = /<([0-9a-fA-F]+)>\s*<[0-9a-fA-F]+>/.exec((/begincodespacerange([\s\S]*?)endcodespacerange/.exec(txt) || [])[1] || "");
    if (zakres) bajtow = zakres[1].length / 2;
    for (const blok of txt.match(/beginbfchar[\s\S]*?endbfchar/g) || [])
      for (const m of blok.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexNaTekst(m[2]));
    for (const blok of txt.match(/beginbfrange[\s\S]*?endbfrange/g) || []) {
      for (const m of blok.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
        const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
        if (m[3][0] === "[") {
          const lst = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map(x => hexNaTekst(x[1]));
          for (let c = a; c <= b && c - a < lst.length; c++) map.set(c, lst[c - a]);
        } else {
          const baza = hexNaTekst(m[3].slice(1, -1));
          const ost = baza.charCodeAt(baza.length - 1);
          for (let c = a; c <= b; c++) map.set(c, baza.slice(0, -1) + String.fromCharCode(ost + c - a));
        }
      }
    }
    return { map, bajtow };
  }

  function szerokosci(txt) {
    const w = new Map();
    const dw = /\/DW\s+(\d+(?:\.\d+)?)/.exec(txt);
    const m = /\/W\s*\[([\s\S]*)\]/.exec(txt);
    if (m) {
      const tok = m[1].match(/\[|\]|-?\d+(?:\.\d+)?/g) || [];
      let i = 0;
      while (i < tok.length) {
        const c = +tok[i++];
        if (tok[i] === "[") {
          i++; let k = c;
          while (i < tok.length && tok[i] !== "]") w.set(k++, +tok[i++]);
          i++;
        } else { const c2 = +tok[i++], sz = +tok[i++]; for (let k = c; k <= c2; k++) w.set(k, sz); }
      }
    }
    return { w, dw: dw ? +dw[1] : 1000 };
  }

  async function font(obj, nr) {
    const o = obj.get(nr);
    if (!o) return null;
    const tu = ref(o.cialo, "ToUnicode");
    const cm = tu != null ? cmapa(await strumien(obj, tu)) : { map: new Map(), bajtow: 1 };
    let sz = { w: new Map(), dw: 1000 };
    const potomne = /\/DescendantFonts\s*\[\s*(\d+)\s+\d+\s+R/.exec(o.cialo);
    if (potomne && obj.get(+potomne[1])) sz = szerokosci(obj.get(+potomne[1]).cialo);
    else {
      const fc = /\/FirstChar\s+(\d+)/.exec(o.cialo), ws = /\/Widths\s*\[([^\]]*)\]/.exec(o.cialo);
      if (fc && ws) ws[1].trim().split(/\s+/).forEach((v, j) => sz.w.set(+fc[1] + j, +v));
    }
    if (/\/Encoding\s*\/Identity-H/.test(o.cialo)) cm.bajtow = 2;
    return { ...cm, ...sz, brakMapy: tu == null };
  }

  function slownikFontow(obj, zasoby) {
    let txt = zasoby;
    const r = /^\s*(\d+)\s+\d+\s+R\s*$/.exec(txt);
    if (r) txt = (obj.get(+r[1]) || {}).cialo || "";
    let f = /\/Font\s*<<([\s\S]*?)>>/.exec(txt);
    let lista = f ? f[1] : "";
    const fr = /\/Font\s+(\d+)\s+\d+\s+R/.exec(txt);
    if (!f && fr) lista = ((obj.get(+fr[1]) || {}).cialo || "").replace(/^\s*<<|>>\s*$/g, "");
    const out = {};
    for (const m of lista.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) out[m[1]] = +m[2];
    return out;
  }

  // --- strony w kolejności drzewa /Pages ----------------------------------------------
  function strony(obj) {
    const korzen = [...obj.entries()].find(([, o]) => /\/Type\s*\/Pages\b/.test(o.cialo) && !/\/Parent\b/.test(o.cialo));
    const out = [];
    const odwiedz = (nr, zasobyRodzica, gl) => {
      const o = obj.get(nr);
      if (!o || gl > 50) return;
      const zas = /\/Resources\s+(\d+\s+\d+\s+R|<<[\s\S]*>>)/.exec(o.cialo);
      const zasoby = zas ? zas[1] : zasobyRodzica;
      if (/\/Type\s*\/Pages\b/.test(o.cialo)) {
        const k = /\/Kids\s*\[([^\]]*)\]/.exec(o.cialo);
        for (const m of (k ? k[1] : "").matchAll(/(\d+)\s+\d+\s+R/g)) odwiedz(+m[1], zasoby, gl + 1);
      } else if (/\/Type\s*\/Page\b/.test(o.cialo)) {
        const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(o.cialo);
        const tresc = c ? [...c[1].matchAll(/(\d+)\s+\d+\s+R/g)].map(x => +x[1]) : [];
        out.push({ tresc, zasoby: zasoby || "" });
      }
    };
    if (korzen) odwiedz(korzen[0], "", 0);
    return out;
  }

  // --- interpreter strumienia treści (tylko tekst i macierze) -------------------------
  function tokeny(s) {
    const out = [];
    let i = 0;
    const n = s.length;
    const bialy = c => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
    while (i < n) {
      const c = s[i];
      if (bialy(c)) { i++; continue; }
      if (c === "%") { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
      if (c === "(") {                                   // łańcuch dosłowny z ucieczkami
        let gl = 1, t = ""; i++;
        while (i < n && gl) {
          const d = s[i];
          if (d === "\\") {
            const e = s[i + 1];
            const mapa = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
            if (e in mapa) { t += mapa[e]; i += 2; }
            else if (/[0-7]/.test(e)) { const o = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; t += String.fromCharCode(parseInt(o, 8)); i += 1 + o.length; }
            else { i += 2; }
            continue;
          }
          if (d === "(") gl++;
          else if (d === ")") { gl--; if (!gl) { i++; break; } }
          t += d; i++;
        }
        out.push({ s: t }); continue;
      }
      if (c === "<" && s[i + 1] === "<") { out.push({ op: "<<" }); i += 2; continue; }
      if (c === ">" && s[i + 1] === ">") { out.push({ op: ">>" }); i += 2; continue; }
      if (c === "<") {
        const e = s.indexOf(">", i);
        let h = s.slice(i + 1, e).replace(/\s+/g, "");
        if (h.length % 2) h += "0";
        let t = ""; for (let k = 0; k < h.length; k += 2) t += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
        out.push({ s: t }); i = e + 1; continue;
      }
      if (c === "[" || c === "]") { out.push({ op: c }); i++; continue; }
      if (c === "/") {
        let j = i + 1; while (j < n && !bialy(s[j]) && !"/[]()<>{}%".includes(s[j])) j++;
        out.push({ name: s.slice(i + 1, j) }); i = j; continue;
      }
      let j = i; while (j < n && !bialy(s[j]) && !"/[]()<>{}%".includes(s[j])) j++;
      if (j === i) { i++; continue; }
      const w = s.slice(i, j);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) out.push(+w); else out.push({ op: w });
      i = j;
      if (w === "BI") { const e = s.indexOf("EI", i); i = e < 0 ? n : e + 2; }   // obraz osadzony — pomiń
    }
    return out;
  }

  const mnoz = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

  // → [{x, y, w, h, t}] — pozycje glifów w przestrzeni strony
  function glify(tresc, fonty) {
    const out = [], stos = [];
    let ctm = [1, 0, 0, 1, 0, 0], tm = null, tlm = null;
    let f = null, fs = 0, tc = 0, tw = 0, th = 1, tl = 0;
    const args = [];
    let tablica = null;
    const pokaz = s => {
      if (!f || !tm) return;
      const n = f.bajtow;
      for (let i = 0; i + n - 1 < s.length; i += n) {
        const kod = n === 2 ? (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1) : s.charCodeAt(i);
        const szer = (f.w.has(kod) ? f.w.get(kod) : f.dw) / 1000;
        const t = f.map.has(kod) ? f.map.get(kod) : (f.brakMapy ? String.fromCharCode(kod) : "");
        const m = mnoz(tm, ctm);
        const skala = Math.hypot(m[0], m[1]), wys = Math.hypot(m[2], m[3]);
        out.push({ x: m[4], y: m[5], w: szer * fs * th * skala, h: fs * wys, t });
        const dx = (szer * fs + tc + (t === " " && n === 1 ? tw : 0)) * th;
        tm = mnoz([1, 0, 0, 1, dx, 0], tm);
      }
    };
    const nowaLinia = (tx, ty) => { tlm = mnoz([1, 0, 0, 1, tx, ty], tlm || [1, 0, 0, 1, 0, 0]); tm = tlm.slice(); };
    for (const tk of tokeny(tresc)) {
      if (typeof tk === "number" || tk.s != null || tk.name != null) {
        if (tablica) tablica.push(tk); else args.push(tk);
        continue;
      }
      const op = tk.op;
      if (op === "[") { tablica = []; continue; }
      if (op === "]") { args.push(tablica || []); tablica = null; continue; }
      const a = args.splice(0);
      switch (op) {
        case "q": stos.push(ctm.slice()); break;
        case "Q": if (stos.length) ctm = stos.pop(); break;
        case "cm": if (a.length >= 6) ctm = mnoz(a.slice(-6), ctm); break;
        case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case "ET": tm = null; break;
        case "Tf": f = fonty[(a[0] || {}).name] || null; fs = +a[1] || 0; break;
        case "Tc": tc = +a[0] || 0; break;
        case "Tw": tw = +a[0] || 0; break;
        case "Tz": th = (+a[0] || 100) / 100; break;
        case "TL": tl = +a[0] || 0; break;
        case "Tm": if (a.length >= 6) { tlm = a.slice(-6); tm = tlm.slice(); } break;
        case "Td": nowaLinia(+a[0] || 0, +a[1] || 0); break;
        case "TD": tl = -(+a[1] || 0); nowaLinia(+a[0] || 0, +a[1] || 0); break;
        case "T*": nowaLinia(0, -tl); break;
        case "Tj": if (a[0] && a[0].s != null) pokaz(a[0].s); break;
        case "'": nowaLinia(0, -tl); if (a[0] && a[0].s != null) pokaz(a[0].s); break;
        case '"': tw = +a[0] || 0; tc = +a[1] || 0; nowaLinia(0, -tl); if (a[2] && a[2].s != null) pokaz(a[2].s); break;
        case "TJ":
          for (const el of a[0] || []) {
            if (typeof el === "number") tm = mnoz([1, 0, 0, 1, -el / 1000 * fs * th, 0], tm);
            else if (el.s != null) pokaz(el.s);
          }
          break;
        default: break;
      }
    }
    return out;
  }

  // glify → linie jak `pdftotext -layout`: jedna linia bazowa = jedna linia tekstu,
  // przerwa ≥ ~0,15 wys. znaku = spacja, większe przerwy = proporcjonalnie więcej spacji
  function linie(gl) {
    const g = gl.filter(x => x.t && x.t.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
    const wiersze = [];
    for (const x of g) {
      const w = wiersze.length ? wiersze[wiersze.length - 1] : null;
      if (w && Math.abs(w.y - x.y) <= Math.max(1, 0.35 * Math.min(w.h, x.h))) w.g.push(x);
      else wiersze.push({ y: x.y, h: x.h, g: [x] });
    }
    return wiersze.map(w => {
      const z = w.g.sort((a, b) => a.x - b.x);
      let t = "", kon = null;
      for (const x of z) {
        if (kon != null) {
          const przerwa = x.x - kon, jedn = 0.5 * x.h;
          if (przerwa > 0.15 * x.h) t += " ".repeat(Math.max(1, Math.round(przerwa / jedn)));
        }
        t += x.t;
        kon = x.x + x.w;
      }
      return t;
    });
  }

  // bajty PDF → tekst (linie oddzielone \n, strony \f) albo null, gdy to nie jest obsługiwany PDF
  async function tekst(bufor) {
    const u8 = bufor instanceof Uint8Array ? bufor : new Uint8Array(bufor);
    const s = latin1(u8);
    if (!s.startsWith("%PDF-")) return null;
    if (/\/Encrypt\b/.test(s)) throw new Error("PDF zaszyfrowany — nieobsługiwany");
    const obj = obiekty(u8, s);
    const out = [];
    for (const st of strony(obj)) {
      const fonty = {};
      for (const [nazwa, nr] of Object.entries(slownikFontow(obj, st.zasoby))) fonty[nazwa] = await font(obj, nr);
      let tresc = "";
      for (const nr of st.tresc) tresc += (await strumien(obj, nr)) + "\n";
      out.push(linie(glify(tresc, fonty)).join("\n"));
    }
    return out.join("\n\f");
  }

  W.pdf = { tekst };
})(globalThis.W = globalThis.W || {});
