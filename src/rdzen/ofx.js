// Czytnik OFX/QFX (Open Financial Exchange): 1.x (SGML, wartości bez znaczników zamykających)
// i 2.x (XML) jedną ścieżką — skaner znaczników liniowy, bez DOMParser i bez regexów z wycofywaniem.
// Bezpieczeństwo: <!DOCTYPE>/<!ENTITY> odrzucane (brak encji z DTD), encje tylko podstawowe i numeryczne,
// limity liczby transakcji i długości pól, nazwy znaczników z allowlisty (nie są kluczami obiektów).
(function (W) {
  "use strict";

  const MAX_TX = 100000, MAX_POLE = 1000, MAX_ZNACZNIKOW = 5000000;
  const NAZWA = /^\/?[A-Z0-9.]{1,40}$/;
  const POLA_TX = new Set(["DTPOSTED", "DTUSER", "TRNAMT", "FITID", "NAME", "MEMO", "CURSYM"]);
  const FITID_OK = /^[\x21-\x7e]{1,255}$/;                    // drukowalne ASCII, bez spacji
  const ENCJE = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

  function encje(s) {
    return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,5});/gi, (m, e) => {
      if (e[0] !== "#") return ENCJE[e.toLowerCase()] !== undefined ? ENCJE[e.toLowerCase()] : m;
      const kod = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return kod > 31 && kod < 0x110000 && !(kod >= 0xd800 && kod <= 0xdfff) ? String.fromCodePoint(kod) : " ";
    });
  }
  const czysc = s => encje(s.slice(0, MAX_POLE)).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

  function jestOfx(tekst) {
    const p = tekst.replace(/^﻿/, "").slice(0, 4000);
    return /^\s*OFXHEADER\s*:/.test(p) || /<\?OFX\s/i.test(p) || /<OFX>/i.test(p);
  }

  // "20261001120000.000[-5:EST]" → "2026-10-01" (dalsza walidacja: W.model.poprawnaData)
  function data(s) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(s || "");
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  // tekst → {wyciagi: [{waluta, konto, karta, txs: [{data, kwota, nazwa, memo, fitid, waluta}]}]} albo null (nie OFX)
  // wyjątek = plik OFX odrzucony (komunikat dla użytkownika, bez treści pliku)
  function czytaj(tekst) {
    if (!jestOfx(tekst)) return null;
    if (/<!\s*(DOCTYPE|ENTITY)/i.test(tekst)) throw new Error(W.t("err.ofx1"));
    const wyciagi = [];
    let wyc = null, tx = null, pole = null, wCurrency = null, n = 0, znaczniki = 0;
    const koniecTx = () => { if (tx && wyc) wyc.txs.push(tx); tx = null; };
    const koniecWyc = () => { koniecTx(); if (wyc) wyciagi.push(wyc); wyc = null; };
    let i = 0;
    const L = tekst.length;
    while (i < L) {
      const lt = tekst.indexOf("<", i);
      const wartosc = (lt < 0 ? tekst.slice(i) : tekst.slice(i, lt));
      if (pole && wartosc.trim()) {                          // wartość elementu (SGML: do następnego znacznika)
        const v = czysc(wartosc);
        if (tx && POLA_TX.has(pole)) {
          if (pole === "CURSYM") { if (wCurrency === "CURRENCY") tx.walutaTx = v; }
          else if (pole === "NAME" || pole === "MEMO") tx[pole === "NAME" ? "nazwa" : "memo"] = tx[pole === "NAME" ? "nazwa" : "memo"] || v;
          else tx[{ DTPOSTED: "dtp", DTUSER: "dtu", TRNAMT: "kwota", FITID: "fitid" }[pole]] = v;
        } else if (wyc && pole === "CURDEF") wyc.waluta = v;
        else if (wyc && pole === "ACCTID") wyc.konto = v;
      }
      if (lt < 0) break;
      const gt = tekst.indexOf(">", lt + 1);
      if (gt < 0) break;
      if (++znaczniki > MAX_ZNACZNIKOW) throw new Error(W.t("err.ofx2"));
      i = gt + 1;
      const raw = tekst.slice(lt + 1, Math.min(gt, lt + 64)).trim().toUpperCase();
      if (raw[0] === "?" || raw[0] === "!") { pole = null; continue; }   // <?xml …?>, <?OFX …?>, komentarze
      if (!NAZWA.test(raw)) { pole = null; continue; }
      const zamyka = raw[0] === "/", nazwa = zamyka ? raw.slice(1) : raw;
      pole = zamyka ? null : nazwa;
      if (nazwa === "STMTRS" || nazwa === "CCSTMTRS") {
        if (zamyka) koniecWyc();
        else { koniecWyc(); wyc = { waluta: null, konto: "", karta: nazwa === "CCSTMTRS", txs: [] }; }
      } else if (nazwa === "STMTTRN") {
        koniecTx();
        if (!zamyka) {
          if (++n > MAX_TX) throw new Error(W.t("err.ofx3", { p1: MAX_TX }));
          tx = {};
        }
      } else if (nazwa === "CURRENCY" || nazwa === "ORIGCURRENCY") wCurrency = zamyka ? null : nazwa;
      else if (nazwa === "BANKTRANLIST" && zamyka) koniecTx();
    }
    koniecWyc();
    return { wyciagi };
  }

  W.ofx = { jestOfx, czytaj, data, FITID_OK };
})(globalThis.W = globalThis.W || {});
