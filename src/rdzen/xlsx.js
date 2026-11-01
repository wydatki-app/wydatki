// Minimalny czytnik pierwszego arkusza XLSX — bez bibliotek: ZIP (central directory) + DecompressionStream
// ("deflate-raw") + prosty skaner XML na indexOf (bez DOMParser i bez regexów z wycofywaniem).
// Zakres: zestawienia z bankowości (BNP Paribas): sharedStrings + jeden arkusz, wartości tekstowe i liczbowe.
// Nie obsługuje: szyfrowania, ZIP64, formuł (bierze zapisany wynik), wielu arkuszy.
// Wynik: tablica wierszy (tablice stringów) albo null, gdy to nie jest XLSX; błąd/limit = wyjątek.
(function (W) {
  "use strict";

  // Limity przeciw złośliwym plikom (bomba deflate, bomba encji, miliony komórek).
  // Prawdziwe zestawienie BNP: kilkanaście KB po rozpakowaniu.
  const MAX_ROZPAK = 50 * 1024 * 1024;     // bajty po dekompresji — łącznie na plik
  const MAX_WPISOW = 2000;                 // wpisy w katalogu ZIP
  const MAX_WIERSZY = 100000, MAX_KOLUMN = 200, MAX_ELEM = 2000000;

  const u16 = (dv, o) => dv.getUint16(o, true), u32 = (dv, o) => dv.getUint32(o, true);

  async function inflateRaw(u8, budzet) {
    const czytnik = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const kawalki = [];
    let n = 0;
    for (;;) {
      const { done, value } = await czytnik.read();
      if (done) break;
      n += value.length;
      budzet.zostalo -= value.length;
      if (budzet.zostalo < 0) {
        await czytnik.cancel().catch(() => {});
        throw new Error(`XLSX: dane po dekompresji przekraczają limit ${budzet.mb} MB`);
      }
      kawalki.push(value);
    }
    const out = new Uint8Array(n);
    let p = 0;
    for (const k of kawalki) { out.set(k, p); p += k.length; }
    return out;
  }

  // katalog ZIP: {nazwa: {metoda, spak, rozpak, lokalny}}
  function katalog(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("XLSX: uszkodzony ZIP (brak katalogu)");
    const ile = u16(dv, eocd + 10), cdOff = u32(dv, eocd + 16);
    if (ile > MAX_WPISOW) throw new Error("XLSX: za dużo plików w archiwum");
    const wpisy = new Map();
    let p = cdOff;
    for (let k = 0; k < ile; k++) {
      if (p + 46 > u8.length || u32(dv, p) !== 0x02014b50) throw new Error("XLSX: uszkodzony katalog ZIP");
      const flagi = u16(dv, p + 8), metoda = u16(dv, p + 10), spak = u32(dv, p + 20), rozpak = u32(dv, p + 24);
      const nN = u16(dv, p + 28), nE = u16(dv, p + 30), nK = u16(dv, p + 32), lokalny = u32(dv, p + 42);
      if (flagi & 1) throw new Error("XLSX: plik zaszyfrowany");
      if (spak === 0xffffffff || rozpak === 0xffffffff || lokalny === 0xffffffff) throw new Error("XLSX: ZIP64 nieobsługiwany");
      const nazwa = new TextDecoder("utf-8").decode(u8.subarray(p + 46, p + 46 + nN));
      wpisy.set(nazwa, { metoda, spak, rozpak, lokalny });
      p += 46 + nN + nE + nK;
    }
    return { dv, wpisy };
  }

  async function wpis(u8, kat, nazwa, budzet) {
    const w = kat.wpisy.get(nazwa);
    if (!w) return null;
    const dv = kat.dv, p = w.lokalny;
    if (p + 30 > u8.length || u32(dv, p) !== 0x04034b50) throw new Error("XLSX: uszkodzony nagłówek pliku w ZIP");
    const start = p + 30 + u16(dv, p + 26) + u16(dv, p + 28);
    if (start + w.spak > u8.length) throw new Error("XLSX: ucięte archiwum");
    if (w.rozpak > budzet.zostalo) throw new Error(`XLSX: dane po dekompresji przekraczają limit ${budzet.mb} MB`);
    const dane = u8.subarray(start, start + w.spak);
    let bajty;
    if (w.metoda === 0) { budzet.zostalo -= dane.length; bajty = dane; }
    else if (w.metoda === 8) bajty = await inflateRaw(dane, budzet);
    else throw new Error("XLSX: nieobsługiwana kompresja");
    const xml = new TextDecoder("utf-8").decode(bajty);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XLSX: niedozwolona deklaracja DOCTYPE/ENTITY");
    return xml;
  }

  // --- skaner XML (wystarczający dla SpreadsheetML; atrybuty bez ">" w wartościach) ---
  function elementy(xml, tag, licznik) {
    const out = [], otw = "<" + tag, zam = "</" + tag + ">";
    let i = 0;
    for (;;) {
      i = xml.indexOf(otw, i);
      if (i < 0) break;
      const nx = xml.charCodeAt(i + otw.length);           // "<t" nie może złapać "<tc", "<c" — "<cols"
      if (!(nx === 32 || nx === 62 || nx === 47 || nx === 9 || nx === 10 || nx === 13)) { i += otw.length; continue; }
      const gt = xml.indexOf(">", i);
      if (gt < 0) break;
      if (xml.charCodeAt(gt - 1) === 47) { out.push({ attrs: xml.slice(i + otw.length, gt - 1), tresc: "" }); i = gt + 1; }
      else {
        const e = xml.indexOf(zam, gt + 1);
        if (e < 0) break;
        out.push({ attrs: xml.slice(i + otw.length, gt), tresc: xml.slice(gt + 1, e) });
        i = e + zam.length;
      }
      if (++licznik.n > MAX_ELEM) throw new Error("XLSX: za dużo elementów");
    }
    return out;
  }

  const ENC = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function odXml(s) {
    return s
      .replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|lt|gt|amp|quot|apos);/g, (m, e) => {
        if (e[0] !== "#") return ENC[e];
        const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
      })
      .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));   // escape Excela, np. _x000D_
  }

  // tekst z <si>/<is>: wszystkie <t>, bez wymowy fonetycznej <rPh>
  function tekstRich(xml, licznik) {
    let s = xml, i;
    while ((i = s.indexOf("<rPh")) >= 0) {
      const e = s.indexOf("</rPh>", i);
      s = s.slice(0, i) + (e < 0 ? "" : s.slice(e + 6));
    }
    return elementy(s, "t", licznik).map(x => odXml(x.tresc)).join("");
  }

  const AT_R = /(?:^|\s)r="([A-Z]{1,3})\d{1,7}"/, AT_T = /(?:^|\s)t="([a-zA-Z]{1,9})"/;
  function kolumna(litery) {
    let n = 0;
    for (const ch of litery) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // limit: bajty po dekompresji (domyślnie 50 MB; mniejszy tylko w testach — szybka bomba)
  async function wiersze(bufor, limit = MAX_ROZPAK) {
    const u8 = bufor instanceof Uint8Array ? bufor : new Uint8Array(bufor);
    if (u8.length < 4 || u8[0] !== 0x50 || u8[1] !== 0x4b || u8[2] !== 3 || u8[3] !== 4) return null;   // nie ZIP
    const kat = katalog(u8);
    const arkusz = kat.wpisy.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml"
      : [...kat.wpisy.keys()].filter(n => /^xl\/worksheets\/[^/]{1,64}\.xml$/.test(n)).sort()[0];
    if (!arkusz) return null;                                // ZIP, ale nie arkusz Excela
    const budzet = { zostalo: Math.min(limit, MAX_ROZPAK), mb: Math.round(Math.min(limit, MAX_ROZPAK) / 1048576) }, licznik = { n: 0 };
    const ssXml = await wpis(u8, kat, "xl/sharedStrings.xml", budzet);
    const ss = ssXml ? elementy(ssXml, "si", licznik).map(x => tekstRich(x.tresc, licznik)) : [];
    const xml = await wpis(u8, kat, arkusz, budzet);
    const out = [];
    for (const row of elementy(xml, "row", licznik)) {
      if (out.length >= MAX_WIERSZY) throw new Error("XLSX: za dużo wierszy");
      const r = [];
      for (const c of elementy(row.tresc, "c", licznik)) {
        const mr = AT_R.exec(c.attrs);
        const k = mr ? kolumna(mr[1]) : r.length;
        if (k >= MAX_KOLUMN) continue;
        const typ = (AT_T.exec(c.attrs) || [])[1] || "n";
        let v;
        if (typ === "inlineStr") v = tekstRich(c.tresc, licznik);
        else {
          const ev = elementy(c.tresc, "v", licznik)[0];
          v = ev ? odXml(ev.tresc) : "";
          if (typ === "s") { const ix = Number(v); v = Number.isInteger(ix) && ix >= 0 && ix < ss.length ? ss[ix] : ""; }
        }
        while (r.length < k) r.push("");
        r[k] = v;
      }
      out.push(r);
    }
    return out;
  }

  // wiersze → CSV (wszystkie pola w cudzysłowie) — dalej zwykła ścieżka parserów CSV
  const doCsv = rows => rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n") + "\n";

  W.xlsx = { wiersze, doCsv };
})(globalThis.W = globalThis.W || {});
