// Import plików: rozpoznanie banku po treści → parsowanie → wybór waluty głównej → scalenie z deduplikacją.
// Kolejność scalania jak w Pythonie: bank (Millennium, Velo, Revolut, Alior), w banku po ścieżce.
(function (W) {
  "use strict";

  const KOD = /^[A-Z]{3}$/;
  const znana = w => (W.i18n ? W.i18n.poprawnaWaluta(w) : KOD.test(w || "") && w !== "XXX");

  // waluta główna bez ustawienia: najczęstsza w transakcjach; remis → PLN, potem alfabetycznie
  function najczestsza(licznik) {
    const lst = [...licznik.entries()].filter(([w]) => znana(w)).sort((a, b) => b[1] - a[1] || (a[0] === "PLN" ? -1 : b[0] === "PLN" ? 1 : a[0] < b[0] ? -1 : 1));
    return lst.length ? lst[0][0] : "PLN";
  }

  // wyjątek parsera (np. OFX z DOCTYPE, limit transakcji) = plik odrzucony, reszta importu działa dalej
  function parsujWszystkie(rozp, waluta) {
    return rozp.map(p => {
      let txs;
      try { txs = W.banki.parsuj(p.bank, p.tekst, waluta); }
      catch (e) { return { blad: String((e && e.message) || e).slice(0, 200) }; }
      if (txs) for (const tx of txs) if (!KOD.test(tx.wal || "")) tx.wal = "PLN";   // banki tylko-PLN
      return txs;
    });
  }

  // pliki: [{sciezka, tekst}], opcje: {waluta} (z konfiguracja.json, zwalidowana) →
  // {txs, waluta, raport: [{sciezka, bank, n}], nierozpoznane: [sciezka], odrzucone, inneWaluty: [{sciezka, n, waluty}]}
  function importuj(pliki, opcje) {
    const rozp = [], nierozpoznane = [];
    for (const p of pliki) {
      const bank = W.banki.rozpoznaj(p.tekst);
      if (bank) rozp.push({ ...p, bank });
      else nierozpoznane.push(p.sciezka);
    }
    const kol = b => W.banki.BANKI.indexOf(b);
    rozp.sort((a, b) => kol(a.bank) - kol(b.bank) || (a.sciezka < b.sciezka ? -1 : a.sciezka > b.sciezka ? 1 : 0));

    // waluta: ustawiona albo najczęstsza po pierwszym przejściu (każda transakcja we własnej walucie);
    // drugie przejście z walutą główną — Revolut bierze wtedy równowartość z kont walutowych
    let waluta = opcje && znana(opcje.waluta) ? opcje.waluta : null;
    if (!waluta) {
      const licznik = new Map();
      for (const txs of parsujWszystkie(rozp, null)) for (const tx of Array.isArray(txs) ? txs : []) licznik.set(tx.wal, (licznik.get(tx.wal) || 0) + 1);
      waluta = najczestsza(licznik);
    }
    const sparsowane = parsujWszystkie(rozp, waluta);

    const raport = [], zrodla = [], odrzucone = [], inneWaluty = [], bledne = [];
    rozp.forEach((p, i) => {
      const wszystkie = sparsowane[i];
      if (wszystkie == null) { nierozpoznane.push(p.sciezka); return; }
      if (!Array.isArray(wszystkie)) { bledne.push({ sciezka: p.sciezka, blad: wszystkie.blad }); return; }
      const poprawne = wszystkie.filter(tx => W.model.poprawnaData(tx.data));   // walidacja na granicy
      if (poprawne.length < wszystkie.length) odrzucone.push({ sciezka: p.sciezka, n: wszystkie.length - poprawne.length });
      // bez przeliczania kursów: transakcje w innej walucie pomijane i zgłaszane, nie mieszane w sumach
      const txs = poprawne.filter(tx => tx.wal === waluta);
      if (txs.length < poprawne.length) {
        const inne = [...new Set(poprawne.filter(tx => tx.wal !== waluta).map(tx => tx.wal))].sort();
        inneWaluty.push({ sciezka: p.sciezka, n: poprawne.length - txs.length, waluty: inne });
      }
      // źródło: bank z rozpoznania + karta/rachunek z parsera (allowlista formatu, inaczej sam bank)
      for (const tx of txs) {
        tx.zr = typeof tx.konto === "string" && W.model.KONTO_RE.test(tx.konto) ? `${p.bank}:${tx.konto}` : p.bank;
        delete tx.konto;
        delete tx.wal;
      }
      raport.push({ sciezka: p.sciezka, bank: p.bank, n: txs.length });
      zrodla.push(txs);
    });
    return { txs: W.model.scal(zrodla), waluta, raport, nierozpoznane, odrzucone, inneWaluty, bledne };
  }

  W.importuj = importuj;
})(globalThis.W = globalThis.W || {});
