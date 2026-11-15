// Parsery wyciągów — port 1:1 z analiza_wydatkow.py (Millennium, VeloBank, Revolut ×2, Alior) + mBank, PKO BP (nowe, bez odpowiednika w Pythonie).
// Wejście: tekst pliku. Wyjście: tablica rekordów W.model.mk (+ opcjonalny klucz dedup "dk").
(function (W) {
  "use strict";
  const { parseAmount, round2, mk, konto } = W.model;
  const { wiersze, slowniki } = W.csv;
  const t = s => (s || "").trim();
  // kod waluty z pliku: puste = PLN (jak dotąd), 3 litery = kod, cokolwiek innego = "XXX" (ISO: brak waluty) —
  // fail closed: taki wiersz nie trafia do sum w żadnej walucie głównej, import go zgłasza
  const kodWaluty = s => { const w = t(s).toUpperCase(); return !w ? "PLN" : /^[A-Z]{3}$/.test(w) ? w : "XXX"; };
  const bezKodu = s => (s || "").replace(/\b[A-Z]{3}\b/g, "");
  // numer z pliku → "k1234"/"r1234" (tx.konto); import składa z tego tx.zr = "bank:k1234"
  const KARTA_MASKA = /^\d{4,6}[X*]{4,12}\d{4}$/i;            // "4249 XXXX XXXX 0001", "424912******0001"
  const RACHUNEK_NR = /^(PL)?\d{26}$/i;
  function kontoZNumeru(s) {
    s = t(s).replace(/\s/g, "");
    if (KARTA_MASKA.test(s)) return konto("k", s);
    if (RACHUNEK_NR.test(s)) return konto("r", s);
    return "";
  }

  // --- Millennium (CSV) -------------------------------------------------------
  // Karta debetowa do ROR = karta dziecka — rozpoznawana po rodzaju transakcji;
  // karty kredytowe mają pusty "Rodzaj transakcji", więc się nie łapią.
  const MILLENNIUM_DEBET = "ZAKUP - FIZ. UŻYCIE KARTY";

  function millennium(tekst) {
    return slowniki(tekst).map(r => {
      const tx = mk(t(r["Data transakcji"]), t(r["Opis"]), t(r["Odbiorca/Zleceniodawca"]),
                    parseAmount(r["Obciążenia"]), parseAmount(r["Uznania"]));
      if (t(r["Rodzaj transakcji"]) === MILLENNIUM_DEBET) tx.text += " [millennium-debet]";
      tx.konto = kontoZNumeru(r["Numer rachunku/karty"]);
      return tx;
    });
  }

  // --- Revolut: eksport z aplikacji -------------------------------------------
  // Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
  function revolutDk(data, kwota, saldo) {
    const sal = parseAmount(t(bezKodu(saldo)));
    return sal == null ? null : ["REV", data, round2(kwota), round2(sal)];
  }

  // opłata z pliku: skończona liczba ≥ 0, inaczej 0 (ujemna „opłata” zaniżałaby wydatek)
  function revolutOplata(s) {
    const f = parseAmount(t(bezKodu(s)));
    return f != null && Number.isFinite(f) && f >= 0 ? f : 0;
  }

  function revolutApp(tekst) {
    const out = [];
    for (const r of slowniki(tekst)) {
      if (t(r["State"]).toUpperCase() !== "COMPLETED") continue;
      const typ = t(r["Type"]);
      if (typ === "Topup" || typ === "Transfer") continue;     // przepływ własny
      const amount = parseAmount(r["Amount"]);
      const fee = revolutOplata(r["Fee"]);
      if (amount == null) continue;
      // 'Completed Date' — zgodnie z formatem Account Statement (dedup między formatami)
      const data = t((r["Completed Date"] || "").slice(0, 10));
      const opis = t(r["Description"]);
      const tx = amount < 0 ? mk(data, opis, "", Math.abs(amount) + fee, null) : mk(data, opis, "", null, amount);
      tx.dk = revolutDk(data, amount < 0 ? amount - fee : amount, r["Balance"]);
      tx.wal = kodWaluty(r["Currency"]);
      out.push(tx);
    }
    return out;
  }

  // --- Revolut: Account Statement (panel webowy, wiele bloków kont) -------------
  const MIESIACE = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const KONTA_POMIN = /^(kids\s*&\s*teen|gad[żz]ety|pocket|junior)\b/i;   // konta dzieci/podkonta = nie nasz wydatek
  const NAGLOWEK_KONTA = /^(.+?)\s*\((PLN|USD|EUR|GBP|MAD|CHF|SEK|NOK|CZK)\)$/;
  const pad2 = n => String(n).padStart(2, "0");

  function stmtData(s) {
    const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/.exec(t(s));
    if (!m || !MIESIACE[m[1]]) return null;
    return `${m[3]}-${pad2(MIESIACE[m[1]])}-${pad2(parseInt(m[2], 10))}`;
  }

  const stmtKwota = s => parseAmount(t(bezKodu(s)));
  const maKod = (s, w) => (s || "").split(/[^A-Z]+/).includes(w);   // "-24.35 PLN" zawiera kod PLN

  // konta walutowe: [waluta obca, równowartość w walucie głównej] — bierzemy kolumnę w walucie głównej;
  // bez niej (waluta null albo brak kolumny) — kwota w walucie konta
  function stmtKwotaW(row, waluta, walKonta) {
    const k3 = row[3] || "", k4 = row[4] || "";
    if (waluta && maKod(k3, waluta)) return [stmtKwota(k3), waluta];
    if (waluta && maKod(k4, waluta)) return [stmtKwota(k4), waluta];
    return [stmtKwota(k3), walKonta];
  }

  // waluta: waluta główna (z importu) albo null = każda kwota w walucie swojego konta
  function revolutStatement(tekst, waluta) {
    waluta = /^[A-Z]{3}$/.test(waluta || "") ? waluta : null;
    const rows = wiersze(tekst), out = [];
    let start = rows.findIndex(r => r.length && t(r[0]) === "Current Accounts Transaction Statements");
    if (start < 0) start = 0;
    let wBloku = false, pomin = false, kolFees = [], walKonta = "PLN";
    for (const row of rows.slice(start)) {
      const c0 = t(row.length ? row[0] : "");
      const m = NAGLOWEK_KONTA.exec(c0);
      if (m) { pomin = KONTA_POMIN.test(t(m[1])); walKonta = m[2]; wBloku = false; continue; }
      if (row[0] === "Date" && row[1] === "Description" && row[2] === "Category") {
        // kolumny "Fees" z nagłówka bloku (konta walutowe: [waluta obca, PLN]; układ bywa przesunięty)
        kolFees = row.map((k, j) => t(k) === "Fees" ? j : -1).filter(j => j >= 0);
        wBloku = true; continue;
      }
      if (!wBloku) continue;
      const data = stmtData(c0);
      if (data == null) { wBloku = false; continue; }          // "Total" / pusty = koniec bloku
      if (pomin || row.length < 5) continue;
      const kat = t(row[2]);
      if (kat === "Top up") continue;                          // zasilenie = przepływ własny
      const [amount, wal] = stmtKwotaW(row, waluta, walKonta);
      if (amount == null) continue;
      // "Others" = przelewy do/od osób. Wychodzący to wydatek; przychodzący pomijamy
      // (zasilenie przelewem; druga strona przelewu na konto dziecka jest w pomijanym bloku)
      if (kat === "Others" && amount >= 0) continue;
      const fee = amount < 0 ? revolutOplata(kolFees.map(j => row[j] || "").find(s => maKod(s, wal))) : 0;
      const opis = t(row[1]);
      const tx = amount < 0 ? mk(data, opis, "", round2(Math.abs(amount) + fee), null) : mk(data, opis, "", null, amount);
      if (maKod(row[3], wal)) tx.dk = revolutDk(data, amount - fee, row.length > 4 ? row[4] : null);
      tx.wal = wal;
      out.push(tx);
    }
    return out;
  }

  // --- Alior (CSV karty kredytowej; 1. wiersz = kryteria, separator ';') --------
  const ALIOR_SPLATA = /spłat|splat/i;

  function alior(tekst) {
    const lines = tekst.replace(/^﻿/, "").split(/\r\n|\r|\n/);
    const start = lines.findIndex(l => l.startsWith("Data transakcji;"));
    if (start < 0) return null;                                // nierozpoznany format
    // "Produkty:" w 1. wierszu: jeden produkt = cały plik z tej karty/rachunku; lista = nie da się przypisać
    const pm = /Produkty:\s*([^;]{0,400})/.exec(start > 0 ? lines[0] : "");
    const produkty = pm ? pm[1].split(",").map(t).filter(Boolean) : [];
    const kontoPliku = produkty.length === 1 ? kontoZNumeru(produkty[0]) : "";
    const out = [];
    for (const r of slowniki(lines.slice(start).join("\n"), ";")) {
      const d = t(r["Data transakcji"]);
      if (!/^\d{2}-\d{2}-\d{4}$/.test(d)) continue;
      const dataIso = d.split("-").reverse().join("-");
      const opis = t(r["Szczegóły transakcji"]);
      const kwota = parseAmount(r["Kwota w walucie rachunku"]) || parseAmount(r["Kwota operacji"]);
      if (kwota == null) continue;
      // kontrahent: przy obciążeniu odbiorca, przy uznaniu nadawca (nigdy posiadacz)
      const odb = t(kwota < 0 ? r["Nazwa odbiorcy"] : r["Nazwa nadawcy"]);
      let tx = null;
      if (kwota < 0) tx = mk(dataIso, opis, odb, Math.abs(kwota), null);
      else if (!ALIOR_SPLATA.test(opis)) tx = mk(dataIso, opis, odb, null, kwota);   // spłata karty = przepływ własny
      if (!tx) continue;
      // własny rachunek: przy obciążeniu nadawca, przy uznaniu odbiorca
      tx.konto = kontoPliku || kontoZNumeru(kwota < 0 ? r["Numer rachunku nadawcy"] : r["Numer rachunku odbiorcy"]);
      out.push(tx);
    }
    return out;
  }

  // --- mBank (CSV ';', CP1250; nagłówek klienta, potem tabela od wiersza "#Data …") --------
  // Format "Elektroniczne zestawienie operacji": #Data księgowania;#Data operacji;#Opis operacji;
  //   #Tytuł;#Nadawca/Odbiorca;#Numer konta;#Kwota;#Saldo po operacji
  // Format "Lista operacji" (nowszy): #Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota
  const MBANK_WLASNY = /^PRZELEW W[ŁL]ASNY/i;                  // między własnymi rachunkami
  const MBANK_DATA_TX = /\s*DATA TRANSAKCJI:\s*(\d{4}-\d{2}-\d{2})\s*/i;
  const spacje = s => t(s).replace(/\s+/g, " ");

  function mbankData(s) {
    s = t(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = /^(\d{2})[.-](\d{2})[.-](\d{4})$/.exec(s);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  function mbank(tekst) {
    const rows = wiersze(tekst, ";");
    const start = rows.findIndex(r => /^#Data (operacji|ksi.gowania)$/.test(t(r[0])) && r.some(k => t(k) === "#Kwota"));
    if (start < 0) return null;                                // nierozpoznany format
    const kol = {};
    rows[start].forEach((k, j) => { kol[t(k).replace(/^#/, "")] = j; });
    const pole = (r, nazwa) => kol[nazwa] == null ? "" : (r[kol[nazwa]] || "");
    const out = [];
    for (const r of rows.slice(start + 1)) {
      const dataOp = mbankData(pole(r, "Data operacji")) || mbankData(pole(r, "Data księgowania"));
      if (!dataOp) continue;                                   // puste wiersze, saldo końcowe, stopka
      const kwota = parseAmount(pole(r, "Kwota").replace(/[A-Z]{3}/g, "").replace(/\s/g, ""));
      if (kwota == null) continue;
      const typ = spacje(kol["Tytuł"] == null ? "" : pole(r, "Opis operacji"));
      if (MBANK_WLASNY.test(typ || spacje(pole(r, "Opis operacji")))) continue;   // przepływ własny
      let tytul = kol["Tytuł"] == null ? pole(r, "Opis operacji") : pole(r, "Tytuł");
      // karta: rzeczywista data zakupu jest w tytule ("… DATA TRANSAKCJI: 2026-09-01")
      const m = MBANK_DATA_TX.exec(tytul);
      const data = m ? m[1] : dataOp;
      tytul = spacje(tytul.replace(MBANK_DATA_TX, " "));
      const opis = !typ || /^ZAKUP PRZY U[ŻZ]YCIU KARTY/i.test(typ) ? tytul : spacje(`${typ} ${tytul}`);
      const odb = spacje(pole(r, "Nadawca/Odbiorca"));
      const tx = kwota < 0 ? mk(data, opis, odb, Math.abs(kwota), null) : mk(data, opis, odb, null, kwota);
      tx.konto = kontoZNumeru(pole(r, "Rachunek"));            // tylko format "Lista operacji"
      out.push(tx);
    }
    return out;
  }

  // --- VeloBank (PDF → tekst przez W.pdf, układ jak `pdftotext -layout`) ------------
  // linia: DD.MM.RRRR  DD.MM.RRRR|-  <opis … w MERCHANT>  -X,XX PLN  SALDO [PLN]|-
  const VELO_RE = new RegExp(
    String.raw`^\s*(\d{2}\.\d{2}\.\d{4})\s+(?:\d{2}\.\d{2}\.\d{4}|-)\s+` +   // data transakcji + księgowania ('-' = oczekująca)
    String.raw`(.+?)\s+` +                                                  // opis (leniwie)
    String.raw`(-?[\d\s]*\d,\d{2})\s*PLN\s+` +                              // kwota transakcji
    String.raw`(?:-?[\d\s]*\d,\d{2}(?:\s*PLN)?|-)\s*$`);                    // saldo
  const VELO_W = /(?<![\p{L}\p{N}_])w\s+(.+)$/u;                           // \b jak w Pythonie (Unicode)
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function veloMerchant(opis, posiadacz) {
    const m = VELO_W.exec(opis);
    let merchant = t(m ? m[1] : opis);
    // rachunek: 'IMIĘ NAZWISKO-Miasto-SKLEP-616' → bez prefiksu posiadacza (inaczej reguła
    // wykluczeń po nazwisku wycięłaby realny wydatek); gdy sklep ucięty → miasto
    if (posiadacz) {
      const mm = new RegExp(`^${escRe(posiadacz)}-([^-]*)-(.*)$`, "i").exec(merchant);
      if (mm) { const miasto = t(mm[1]), sklep = t(mm[2]); merchant = sklep || miasto; }
    }
    merchant = t(merchant.replace(/-\d{3}\s*$/, ""));
    return merchant || t(opis);
  }

  function velo(tekst) {
    const lines = tekst.split(/\r\n|\r|\n|\f/);
    // posiadacz z nagłówka wyciągu — nie z konfiguracji ani kodu
    const pm = /RACHUNEK PROWADZONY NA RZECZ:\s*(.+)$/m.exec(tekst);
    const posiadacz = pm ? t(pm[1]).replace(/\s+/g, " ") : "";
    const kontoPliku = /^\s*Historia karty/.test(tekst) ? "k" : "r";   // rodzaj z tytułu wyciągu, bez numeru
    const out = [];
    lines.forEach((line, i) => {
      const m = VELO_RE.exec(line);
      if (!m) return;
      const dataIso = m[1].split(".").reverse().join("-");
      let opis = t(m[2].replace(/\s{2,}/g, " "));
      if (!opis.startsWith("Operacja kartą")) {
        // przelew: nadawca i tytuł w kolejnych liniach (reguły wykluczeń łapią przepływ własny);
        // karty bez tego — ich druga linia to miasto, a zmiana opisu rozjechałaby klucze override.json
        for (const nxt of lines.slice(i + 1, i + 6)) {
          if (!nxt.trim() || VELO_RE.test(nxt) || /^(DATA|Dokument)/.test(nxt.trimStart())) break;
          opis += " " + t(nxt.replace(/\s{2,}/g, " "));
        }
      }
      const kwota = parseAmount(m[3].replace(/[\s ]/g, ""));
      if (kwota == null) return;
      const merchant = veloMerchant(opis, posiadacz);
      const tx = kwota < 0 ? mk(dataIso, merchant, "", Math.abs(kwota), null) : mk(dataIso, merchant, "", null, kwota);
      // ten sam wiersz w różnych PDF bywa różnie obcięty — klucz: data + kwota + 10 znaków merchanta
      tx.dk = ["VELO", dataIso, kwota, merchant.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 10)];
      tx.konto = kontoPliku;
      out.push(tx);
    });
    return out;
  }

  // --- PKO BP (CSV ',', CP1250; "Zestawienie operacji") -------------------------------
  // "Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji","",…
  // Opis rozbity na kolumny bez nazw, każda "Klucz: wartość" (Tytuł, Lokalizacja, Nazwa odbiorcy…).
  const PKO_NAGLOWEK = /^"?Data operacji"?,"?Data waluty"?,"?Typ transakcji"?,"?Kwota"?/;
  const PKO_KARTA = /^(Płatność kartą|Zwrot płatności kartą|Wypłata z bankomatu|Wpłata we wpłatomacie)/i;

  function pkoPola(r) {
    const p = {};
    for (const k of r.slice(6)) {
      const m = /^\s*([^:]{2,40}):\s*(.*)$/.exec(k || "");
      if (m) p[t(m[1])] = spacje(m[2]);
    }
    return p;
  }

  function pkobp(tekst) {
    const rows = wiersze(tekst);
    if (!rows.length || !PKO_NAGLOWEK.test(rows[0].join(",").replace(/^﻿/, ""))) return null;
    const out = [];
    for (const r of rows.slice(1)) {
      if (r.length < 6) continue;
      const typ = spacje(r[2]);
      if (/^Blokada/i.test(typ) || /rozliczeniu/i.test(r[5] || "")) continue;   // autoryzacja — wróci jako operacja
      const kwota = parseAmount(r[3]);
      if (kwota == null || kwota === 0) continue;
      const p = pkoPola(r);
      // karta: rzeczywista data zakupu w "Data wykonania operacji"
      const wyk = /^(\d{4}-\d{2}-\d{2})/.exec(p["Data wykonania operacji"] || "");
      const data = wyk ? wyk[1] : mbankData(r[0]) || mbankData(r[1]);
      if (!data) continue;
      let opis, odb;
      const lok = /Adres:\s*(.*?)\s*(?:Miasto:\s*(.*?))?\s*(?:Kraj:.*)?$/.exec((p["Lokalizacja"] || "").slice(0, 300));   // limit: regex wielomianowy
      if (PKO_KARTA.test(typ) && lok) {
        const miejsce = spacje(`${lok[1] || ""} ${lok[2] || ""}`);
        opis = /^Płatność kartą/i.test(typ) ? miejsce : `${typ} ${miejsce}`;
        odb = "";
      } else {
        // przelewy: tytuł + kontrahent; identyfikatory podatkowe (PESEL/NIP) celowo pomijane
        const szczegoly = [p["Tytuł"], p["Symbol formularza"], p["Okres płatności"]].filter(Boolean).join(" ");
        opis = spacje(`${typ} ${szczegoly}`);
        odb = spacje(kwota < 0 ? p["Nazwa odbiorcy"] || "" : p["Nazwa nadawcy"] || "");
      }
      const tx = kwota < 0 ? mk(data, opis, odb, Math.abs(kwota), null) : mk(data, opis, odb, null, kwota);
      tx.konto = kontoZNumeru(p["Numer karty"]);
      tx.wal = kodWaluty(r[4]);
      out.push(tx);
    }
    return out;
  }

  // --- BNP Paribas („Zestawienie operacji” XLSX → W.xlsx → CSV) ---------------------
  // Data transakcji,Data zaksięgowania,Data odrzucenia,Kwota,Waluta,Nadawca,Odbiorca,Opis,Produkt,
  // Typ transakcji,Kwota zlecenia,Waluta zlecenia,Status,Saldo po transakcji
  const BNP_NAGLOWEK = /^"?Data transakcji"?[,;]"?Data zaksięgowania"?[,;]"?Data odrzucenia"?/;
  const BNP_SPLATA = /spłat|splat/i;
  const BNP_NUMER = /^[\d\sxX*]{10,64}$/;                     // zamaskowany numer rachunku/karty, nie nazwa
  const BNP_KARTA = /karta|kredytow|debetow|mastercard|visa/i;

  // data z arkusza: liczba seryjna Excela (dni od 1899-12-30) albo tekst RRRR-MM-DD / DD.MM.RRRR
  function bnpData(s) {
    s = t(s);
    if (/^\d{5}$|^\d{5}\.\d{1,12}$/.test(s)) {
      const n = Math.floor(Number(s));
      if (n < 30000 || n > 80000) return null;                 // ~1982–2119: poza tym to nie data
      return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  function bnp(tekst) {
    const l0 = tekst.replace(/^﻿/, "").split(/\r?\n/, 1)[0];
    if (!BNP_NAGLOWEK.test(l0)) return null;                   // nierozpoznany format
    const sep = l0.includes(";") && !l0.includes(",") ? ";" : ",";
    const out = [];
    for (const r of slowniki(tekst, sep)) {
      if (t(r["Data odrzucenia"])) continue;                   // odrzucona — nie obciążyła rachunku
      const status = t(r["Status"]);
      if (status && !/^zrealizowan/i.test(status)) continue;   // blokady / w realizacji wrócą jako zrealizowane
      const data = bnpData(r["Data transakcji"]) || bnpData(r["Data zaksięgowania"]);
      if (!data) continue;
      const kwota = parseAmount(r["Kwota"]);
      if (kwota == null || kwota === 0) continue;
      const typ = spacje(r["Typ transakcji"]), opis = spacje(r["Opis"]) || typ;
      if (kwota > 0 && BNP_SPLATA.test(`${typ} ${opis}`)) continue;   // spłata karty = przepływ własny
      const strona = spacje(kwota < 0 ? r["Odbiorca"] : r["Nadawca"]);
      const odb = BNP_NUMER.test(strona) ? "" : strona;
      const tx = kwota < 0 ? mk(data, opis, odb, Math.abs(kwota), null) : mk(data, opis, odb, null, kwota);
      // Produkt: "Mastercard … \n<numer>"; numer bywa zamaskowany bez 4 ostatnich cyfr → sam rodzaj
      const prod = t(r["Produkt"]), nr = (prod.split(/\r?\n/)[1] || "").replace(/\s/g, "");
      tx.konto = KARTA_MASKA.test(nr) ? konto("k", nr) : BNP_KARTA.test(prod) ? "k" : prod ? "r" : "";
      const saldo = parseAmount(r["Saldo po transakcji"]);
      if (saldo != null) tx.dk = ["BNP", data, round2(kwota), round2(saldo)];   // identyczne zakupy różnią się saldem
      tx.wal = kodWaluty(r["Waluta"]);
      out.push(tx);
    }
    return out;
  }

  // --- OFX / QFX (dowolny bank; czytnik W.ofx) ------------------------------------
  // kwota ze znakiem (TRNAMT < 0 = obciążenie), opis = NAME + MEMO, FITID = klucz deduplikacji,
  // waluta: CURRENCY/CURSYM transakcji albo CURDEF wyciągu; rachunek → 4 ostatnie cyfry ACCTID
  function ofx(tekst) {
    const w = W.ofx.czytaj(tekst);
    if (!w) return null;
    const out = [];
    for (const wyc of w.wyciagi) {
      const nr = konto(wyc.karta ? "k" : "r", wyc.konto);
      for (const x of wyc.txs) {
        const data = W.ofx.data(x.dtp) || W.ofx.data(x.dtu);
        const kwota = parseAmount(x.kwota || "");
        if (!data || kwota == null || !Number.isFinite(kwota) || kwota === 0) continue;
        const nazwa = t(x.nazwa), memo = t(x.memo);
        const opis = memo && !nazwa.toLowerCase().includes(memo.toLowerCase()) ? t(`${nazwa} ${memo}`) : nazwa || memo;
        const tx = kwota < 0 ? mk(data, opis, "", Math.abs(kwota), null) : mk(data, opis, "", null, kwota);
        if (W.ofx.FITID_OK.test(x.fitid || "")) tx.dk = ["OFX", nr, x.fitid];      // FITID unikalny w rachunku
        tx.konto = nr;
        tx.wal = kodWaluty(x.walutaTx || wyc.waluta || "");
        out.push(tx);
      }
    }
    return out;
  }

  // --- rozpoznanie banku po treści (nie po folderze) ---------------------------
  // kolejność BANKI = kolejność scalania (jak w Pythonie: Millennium, Velo, Revolut, Alior)
  const BANKI = ["millennium", "velo", "revolut", "alior", "mbank", "pkobp", "bnp", "ofx"];

  function rozpoznaj(tekst) {
    if (W.ofx.jestOfx(tekst)) return "ofx";
    const poczatek = tekst.replace(/^﻿/, "").slice(0, 4000);
    if (poczatek.includes('"Numer rachunku/karty"') || poczatek.startsWith("Numer rachunku/karty,")) return "millennium";
    if (poczatek.startsWith("Type,Product,Started Date")) return "revolut";
    if (/^Historia (rachunku|karty)/.test(poczatek) && /VeloBank S\.A\./.test(tekst)) return "velo";
    if (/Accounts (Summaries|Transaction Statements)/.test(poczatek)) return "revolut";
    if (BNP_NAGLOWEK.test(poczatek)) return "bnp";            // przed Aliorem: oba zaczynają od "Data transakcji"
    if (/(^|\n)Data transakcji;/.test(poczatek)) return "alior";
    if (PKO_NAGLOWEK.test(poczatek)) return "pkobp";
    if (/(^|[\r\n])#Data (operacji|ksi.gowania);[^\r\n]*#Kwota;/.test(poczatek)) return "mbank";
    return null;
  }

  // waluta: waluta główna albo null (pierwsze przejście importu: każda transakcja we własnej walucie).
  // Banki tylko-PLN (Millennium, Velo, Alior, mBank) nie mają kolumny waluty → import uzupełnia tx.wal = "PLN".
  function parsuj(bank, tekst, waluta) {
    if (bank === "millennium") return millennium(tekst);
    if (bank === "revolut") return tekst.replace(/^﻿/, "").startsWith("Type,Product,Started Date")
      ? revolutApp(tekst) : revolutStatement(tekst, waluta);
    if (bank === "alior") return alior(tekst);
    if (bank === "velo") return velo(tekst);
    if (bank === "mbank") return mbank(tekst);
    if (bank === "pkobp") return pkobp(tekst);
    if (bank === "bnp") return bnp(tekst);
    if (bank === "ofx") return ofx(tekst);
    return null;
  }

  W.banki = { BANKI, rozpoznaj, parsuj, millennium, revolutApp, revolutStatement, alior, mbank, velo, pkobp, bnp, ofx };
})(globalThis.W = globalThis.W || {});
