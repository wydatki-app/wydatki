// Parser CSV zachowujący się jak csv.reader / csv.DictReader z Pythona
// (cudzysłowy, "" w polu, nowe linie w cudzysłowie, pusta linia = [], BOM zdejmowany).
(function (W) {
  "use strict";

  function wiersze(tekst, sep) {
    sep = sep || ",";
    if (tekst.charCodeAt(0) === 0xfeff) tekst = tekst.slice(1);
    const out = [];
    let row = [], pole = "", wCudz = false, bylo = false, i = 0;
    const n = tekst.length;
    while (i < n) {
      const c = tekst[i];
      if (wCudz) {
        if (c === '"') {
          if (tekst[i + 1] === '"') { pole += '"'; i += 2; continue; }
          wCudz = false; i++; continue;
        }
        pole += c; i++; continue;
      }
      if (c === '"' && pole === "") { wCudz = true; bylo = true; i++; continue; }
      if (c === sep) { row.push(pole); pole = ""; bylo = true; i++; continue; }
      if (c === "\r" || c === "\n") {
        if (bylo || pole !== "" || row.length) row.push(pole);
        out.push(row);
        row = []; pole = ""; bylo = false;
        i += (c === "\r" && tekst[i + 1] === "\n") ? 2 : 1;
        continue;
      }
      pole += c; bylo = true; i++;
    }
    if (bylo || pole !== "" || row.length) { row.push(pole); out.push(row); }
    return out;
  }

  // DictReader: 1. wiersz = nagłówek, puste wiersze pomijane
  function slowniki(tekst, sep) {
    const rows = wiersze(tekst, sep);
    const naglowek = rows.shift() || [];
    return rows.filter(r => r.length).map(r => {
      const o = {};
      naglowek.forEach((k, j) => { o[k] = r[j]; });
      return o;
    });
  }

  W.csv = { wiersze, slowniki };
})(globalThis.W = globalThis.W || {});
