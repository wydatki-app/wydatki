// Wspólny model transakcji + narzędzia zgodne z wersją Python (analiza_wydatkow.py).
// Zgodność jest ważna: ID transakcji (data|opis|kwota) są kluczami w override.json, tagi.json
// i zwroty.json — inny zapis liczby albo inne obcięcie opisu = utrata ręcznych korekt.
(function (W) {
  "use strict";

  // float(x) z Pythona: tylko poprawna liczba, inaczej null (parseFloat przepuściłby śmieci)
  const LICZBA = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

  function parseAmount(s) {
    s = (s || "").trim().replace(/ /g, "").replace(/,/g, ".");
    if (!s || !LICZBA.test(s)) return null;
    return Number(s);
  }

  // round(x, 2) — toFixed liczy z dokładnej wartości binarnej, jak Python
  function round2(x) {
    return Number(x.toFixed(2));
  }

  // str(float) z Pythona: 40.0 → "40.0", 39.16 → "39.16"
  function pyFloat(x) {
    return Number.isInteger(x) ? x.toFixed(1) : String(x);
  }

  // s[:n] z Pythona — po znakach (code points), nie po jednostkach UTF-16
  function obetnij(s, n) {
    const a = Array.from(s);
    return a.length > n ? a.slice(0, n).join("") : s;
  }

  function mk(data, opis, odb, obc, uzn) {
    return {
      data, opis, odb,
      obc: obc == null ? null : round2(obc),
      uzn: uzn == null ? null : round2(uzn),
      text: (opis + " " + odb).toLowerCase(),
    };
  }

  // Scalanie źródeł z deduplikacją: pierwsze wystąpienie wygrywa (kolejność plików ma znaczenie).
  function scal(zrodla) {
    const seen = new Set(), txs = [];
    for (const src of zrodla) {
      for (const tx of src) {
        const dk = tx.dk;
        delete tx.dk;
        const key = JSON.stringify(dk || [tx.data, tx.opis, tx.odb, tx.obc, tx.uzn]);
        if (seen.has(key)) continue;
        seen.add(key);
        txs.push(tx);
      }
    }
    return txs;
  }

  W.model = { parseAmount, round2, pyFloat, obetnij, mk, scal };
})(globalThis.W = globalThis.W || {});
