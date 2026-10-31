// Parsery wyciągów — port 1:1 z analiza_wydatkow.py (Millennium, VeloBank, Revolut ×2, Alior) + mBank (nowy, bez odpowiednika w Pythonie).
// Wejście: tekst pliku. Wyjście: tablica rekordów W.model.mk (+ opcjonalny klucz dedup "dk").
(function (W) {
  "use strict";
  const { parseAmount, round2, mk } = W.model;
  const { wiersze, slowniki } = W.csv;
  const t = s => (s || "").trim();

  // --- Millennium (CSV) -------------------------------------------------------
  // Karta debetowa do ROR = karta dziecka — rozpoznawana po rodzaju transakcji;
  // karty kredytowe mają pusty "Rodzaj transakcji", więc się nie łapią.
  const MILLENNIUM_DEBET = "ZAKUP - FIZ. UŻYCIE KARTY";

  function millennium(tekst) {
    return slowniki(tekst).map(r => {
      const tx = mk(t(r["Data transakcji"]), t(r["Opis"]), t(r["Odbiorca/Zleceniodawca"]),
                    parseAmount(r["Obciążenia"]), parseAmount(r["Uznania"]));
      if (t(r["Rodzaj transakcji"]) === MILLENNIUM_DEBET) tx.text += " [millennium-debet]";
      return tx;
    });
  }

  // --- Revolut: eksport z aplikacji -------------------------------------------
  // Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
  function revolutDk(data, kwota, saldo) {
    const sal = parseAmount(t((saldo || "").replace(/PLN/g, "")));
    return sal == null ? null : ["REV", data, round2(kwota), round2(sal)];
  }

  function revolutApp(tekst) {
    const out = [];
    for (const r of slowniki(tekst)) {
      if (t(r["State"]).toUpperCase() !== "COMPLETED") continue;
      const typ = t(r["Type"]);
      if (typ === "Topup" || typ === "Transfer") continue;     // przepływ własny
      const cur = t(r["Currency"]);
      if (cur && cur !== "PLN") continue;
      const amount = parseAmount(r["Amount"]);
      const fee = parseAmount(r["Fee"]) || 0;
      if (amount == null) continue;
      // 'Completed Date' — zgodnie z formatem Account Statement (dedup między formatami)
      const data = t((r["Completed Date"] || "").slice(0, 10));
      const opis = t(r["Description"]);
      const tx = amount < 0 ? mk(data, opis, "", Math.abs(amount) + fee, null) : mk(data, opis, "", null, amount);
      tx.dk = revolutDk(data, amount < 0 ? amount - fee : amount, r["Balance"]);
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

  const stmtKwota = s => parseAmount(t((s || "").replace(/PLN/g, "")));

  // konta walutowe: [waluta obca, PLN] — bierzemy kolumnę z "PLN"
  function stmtKwotaPln(row) {
    const k3 = row[3] || "", k4 = row[4] || "";
    if (k3.includes("PLN")) return stmtKwota(k3);
    if (k4.includes("PLN")) return stmtKwota(k4);
    return null;
  }

  function revolutStatement(tekst) {
    const rows = wiersze(tekst), out = [];
    let start = rows.findIndex(r => r.length && t(r[0]) === "Current Accounts Transaction Statements");
    if (start < 0) start = 0;
    let wBloku = false, pomin = false;
    for (const row of rows.slice(start)) {
      const c0 = t(row.length ? row[0] : "");
      const m = NAGLOWEK_KONTA.exec(c0);
      if (m) { pomin = KONTA_POMIN.test(t(m[1])); wBloku = false; continue; }
      if (row[0] === "Date" && row[1] === "Description" && row[2] === "Category") { wBloku = true; continue; }
      if (!wBloku) continue;
      const data = stmtData(c0);
      if (data == null) { wBloku = false; continue; }          // "Total" / pusty = koniec bloku
      if (pomin || row.length < 5) continue;
      const kat = t(row[2]);
      if (kat === "Top up" || kat === "Others") continue;      // zasilenia/przelewy własne
      const amount = stmtKwotaPln(row);
      if (amount == null) continue;
      const opis = t(row[1]);
      const tx = amount < 0 ? mk(data, opis, "", Math.abs(amount), null) : mk(data, opis, "", null, amount);
      if ((row[3] || "").includes("PLN")) tx.dk = revolutDk(data, amount, row.length > 4 ? row[4] : null);
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
      if (kwota < 0) out.push(mk(dataIso, opis, odb, Math.abs(kwota), null));
      else if (!ALIOR_SPLATA.test(opis)) out.push(mk(dataIso, opis, odb, null, kwota));   // spłata karty = przepływ własny
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
      out.push(kwota < 0 ? mk(data, opis, odb, Math.abs(kwota), null) : mk(data, opis, odb, null, kwota));
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
      out.push(tx);
    });
    return out;
  }

  // --- rozpoznanie banku po treści (nie po folderze) ---------------------------
  // kolejność BANKI = kolejność scalania (jak w Pythonie: Millennium, Velo, Revolut, Alior)
  const BANKI = ["millennium", "velo", "revolut", "alior", "mbank"];

  function rozpoznaj(tekst) {
    const poczatek = tekst.replace(/^﻿/, "").slice(0, 4000);
    if (poczatek.includes('"Numer rachunku/karty"') || poczatek.startsWith("Numer rachunku/karty,")) return "millennium";
    if (poczatek.startsWith("Type,Product,Started Date")) return "revolut";
    if (/^Historia (rachunku|karty)/.test(poczatek) && /VeloBank S\.A\./.test(tekst)) return "velo";
    if (/Accounts (Summaries|Transaction Statements)/.test(poczatek)) return "revolut";
    if (/(^|\n)Data transakcji;/.test(poczatek)) return "alior";
    if (/(^|[\r\n])#Data (operacji|ksi.gowania);[^\r\n]*#Kwota;/.test(poczatek)) return "mbank";
    return null;
  }

  function parsuj(bank, tekst) {
    if (bank === "millennium") return millennium(tekst);
    if (bank === "revolut") return tekst.replace(/^﻿/, "").startsWith("Type,Product,Started Date")
      ? revolutApp(tekst) : revolutStatement(tekst);
    if (bank === "alior") return alior(tekst);
    if (bank === "velo") return velo(tekst);
    if (bank === "mbank") return mbank(tekst);
    return null;
  }

  W.banki = { BANKI, rozpoznaj, parsuj, millennium, revolutApp, revolutStatement, alior, mbank, velo };
})(globalThis.W = globalThis.W || {});
