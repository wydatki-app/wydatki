// Import plików: rozpoznanie banku po treści → parsowanie → scalenie z deduplikacją.
// Kolejność scalania jak w Pythonie: bank (Millennium, Velo, Revolut, Alior), w banku po ścieżce.
(function (W) {
  "use strict";

  // pliki: [{sciezka, tekst}] → {txs, raport: [{sciezka, bank, n}], nierozpoznane: [sciezka]}
  function importuj(pliki) {
    const rozp = [], nierozpoznane = [];
    for (const p of pliki) {
      const bank = W.banki.rozpoznaj(p.tekst);
      if (bank) rozp.push({ ...p, bank });
      else nierozpoznane.push(p.sciezka);
    }
    const kol = b => W.banki.BANKI.indexOf(b);
    rozp.sort((a, b) => kol(a.bank) - kol(b.bank) || (a.sciezka < b.sciezka ? -1 : a.sciezka > b.sciezka ? 1 : 0));
    const raport = [], zrodla = [], odrzucone = [];
    for (const p of rozp) {
      const wszystkie = W.banki.parsuj(p.bank, p.tekst);
      if (wszystkie == null) { nierozpoznane.push(p.sciezka); continue; }
      const txs = wszystkie.filter(tx => W.model.poprawnaData(tx.data));   // walidacja na granicy
      if (txs.length < wszystkie.length) odrzucone.push({ sciezka: p.sciezka, n: wszystkie.length - txs.length });
      // źródło: bank z rozpoznania + karta/rachunek z parsera (allowlista formatu, inaczej sam bank)
      for (const tx of txs) {
        tx.zr = typeof tx.konto === "string" && W.model.KONTO_RE.test(tx.konto) ? `${p.bank}:${tx.konto}` : p.bank;
        delete tx.konto;
      }
      raport.push({ sciezka: p.sciezka, bank: p.bank, n: txs.length });
      zrodla.push(txs);
    }
    return { txs: W.model.scal(zrodla), raport, nierozpoznane, odrzucone };
  }

  W.importuj = importuj;
})(globalThis.W = globalThis.W || {});
