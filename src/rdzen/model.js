// Wspólny model transakcji + narzędzia zgodne z wersją Python (analiza_wydatkow.py).
// Zgodność jest ważna: ID transakcji (data|opis|kwota) są kluczami w override.json, tagi.json
// i zwroty.json — inny zapis liczby albo inne obcięcie opisu = utrata ręcznych korekt.
(function (W) {
  "use strict";

  // float(x) z Pythona: tylko poprawna liczba, inaczej null (parseFloat przepuściłby śmieci)
  const LICZBA = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

  function parseAmount(s) {
    s = (s || "").trim().replace(/ /g, "").replace(/,/g, ".");
    if (!s || s.length > 32 || !LICZBA.test(s)) return null;   // limit: regex ma czas kwadratowy na długich ciągach cyfr
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
  // Powtórzenia w JEDNYM pliku to osobne transakcje (np. 2 bilety po 62 zł tego samego dnia);
  // między plikami bierzemy max liczby wystąpień klucza, nie sumę — nakładające się wyciągi się nie dublują.
  function scal(zrodla) {
    const ile = new Map(), txs = [];
    for (const src of zrodla) {
      const wPliku = new Map();
      for (const tx of src) {
        const dk = tx.dk;
        delete tx.dk;
        const key = JSON.stringify(dk || [tx.data, tx.opis, tx.odb, tx.obc, tx.uzn]);
        const n = (wPliku.get(key) || 0) + 1;
        wPliku.set(key, n);
        if (n <= (ile.get(key) || 0)) continue;              // to wystąpienie już jest z innego pliku
        ile.set(key, n);
        txs.push(tx);
      }
    }
    return txs;
  }

  // Data transakcji z pliku = dane niezaufane (plik mógł przygotować ktoś inny): tylko RRRR-MM-DD
  // z poprawnym miesiącem i dniem. Reszta aplikacji (miesiące, tygodnie, HTML) zakłada ten format.
  const DATA_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  function poprawnaData(s) {
    const m = typeof s === "string" && DATA_RE.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1;                 // odrzuca np. 2026-02-31
  }

  // Źródło transakcji: "bank" albo "bank:k1234" / "bank:r1234" (k = karta, r = rachunek, 4 ostatnie cyfry;
  // bez cyfr, gdy wyciąg ich nie podaje). Pełny numer nigdy nie wychodzi z parsera.
  const ZRODLO_RE = /^(millennium|velo|revolut|alior|mbank|pkobp|bnp)(|:[kr]|:[kr]\d{4})$/;   // bez zagnieżdżonych kwantyfikatorów
  const KONTO_RE = /^([kr]|[kr]\d{4})$/;
  function konto(rodzaj, numer) {
    const cyfry = String(numer || "").replace(/\D/g, "");
    return rodzaj + (cyfry.length >= 4 ? cyfry.slice(-4) : "");
  }

  W.model = { parseAmount, round2, pyFloat, obetnij, mk, scal, poprawnaData, ZRODLO_RE, KONTO_RE, konto };
})(globalThis.W = globalThis.W || {});
