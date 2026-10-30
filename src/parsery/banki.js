// Parsery wyciągów — port 1:1 z analiza_wydatkow.py (Millennium, Revolut ×2, Alior).
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

  // --- rozpoznanie banku po treści (nie po folderze) ---------------------------
  // kolejność BANKI = kolejność scalania (jak w Pythonie: Millennium, Velo, Revolut, Alior)
  const BANKI = ["millennium", "velo", "revolut", "alior"];

  function rozpoznaj(tekst) {
    const poczatek = tekst.replace(/^﻿/, "").slice(0, 4000);
    if (poczatek.includes('"Numer rachunku/karty"') || poczatek.startsWith("Numer rachunku/karty,")) return "millennium";
    if (poczatek.startsWith("Type,Product,Started Date")) return "revolut";
    if (/Accounts (Summaries|Transaction Statements)/.test(poczatek)) return "revolut";
    if (/(^|\n)Data transakcji;/.test(poczatek)) return "alior";
    return null;
  }

  function parsuj(bank, tekst) {
    if (bank === "millennium") return millennium(tekst);
    if (bank === "revolut") return tekst.replace(/^﻿/, "").startsWith("Type,Product,Started Date")
      ? revolutApp(tekst) : revolutStatement(tekst);
    if (bank === "alior") return alior(tekst);
    return null;
  }

  W.banki = { BANKI, rozpoznaj, parsuj, millennium, revolutApp, revolutStatement, alior };
})(globalThis.W = globalThis.W || {});
