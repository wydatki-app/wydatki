// Języki interfejsu (PL, EN) i formaty liczb, kwot i dat.
// Zasady bezpieczeństwa:
//  - t() zwraca TEKST (do textContent, alert, confirm). Do HTML tylko przez tH(), które escapuje
//    i szablon, i parametry; jedyne dozwolone znaczniki to stałe tokeny [b] [/b] [code] [/code].
//  - język tylko z allowlisty JEZYKI (wartość z konfiguracja.json / localStorage jest niezaufana).
(function (W) {
  "use strict";

  const JEZYKI = ["pl", "en"];
  const LOCALE = { pl: "pl-PL", en: "en-US" };
  const LS_JEZYK = "wydatki_jezyk";
  const escH = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  // Wartość: tekst z {parametrami} albo obiekt liczby mnogiej {one, few, many, other} wybierany po {n}.
  const SLOWNIK = { pl: {}, en: {} };
  const dodaj = (pl, en) => { Object.assign(SLOWNIK.pl, pl); Object.assign(SLOWNIK.en, en); };

  const MIESIACE = {
    pl: { dl: ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"],
          kr: ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"] },
    en: { dl: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
          kr: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] },
  };

  let biezacy = "pl", waluta = "PLN";
  const formatery = new Map();
  const fmt = (klucz, opcje) => {
    const k = biezacy + "|" + klucz;
    if (!formatery.has(k)) formatery.set(k, new Intl.NumberFormat(LOCALE[biezacy], opcje));
    return formatery.get(k);
  };

  function wartosc(k) {
    const v = SLOWNIK[biezacy][k] !== undefined ? SLOWNIK[biezacy][k] : SLOWNIK.pl[k];
    if (v === undefined) { if (typeof console !== "undefined") console.error("i18n: brak klucza " + k); return k; }
    return v;
  }

  function szablon(k, p) {
    let v = wartosc(k);
    if (v && typeof v === "object") {
      const kat = new Intl.PluralRules(LOCALE[biezacy]).select(Number(p && p.n) || 0);
      v = v[kat] !== undefined ? v[kat] : v.other;
    }
    return String(v);
  }

  const PARAM = /\{(\w+)\}/g;

  // tekst: parametry wstawiane dosłownie, tokeny [b]/[code] usuwane
  const wstaw = (k, p) => szablon(k, p).replace(PARAM, (m, n) => (p && n in p ? String(p[n]) : m));
  function t(k, p) {
    return wstaw(k, p).replace(/\[\/?(b|code)\]/g, "");
  }
  t.surowy = wstaw;                                          // z tokenami — tylko dla wezly() (parametry bez danych z plików)

  // HTML: szablon escapowany, potem tokeny → znaczniki (tylko w szablonie), parametry escapowane osobno
  function tH(k, p) {
    const tpl = szablon(k, p);
    let out = "", i = 0, m;
    const kawalek = s => escH(s).replace(/\[(\/?)(b|code)\]/g, "<$1$2>");
    PARAM.lastIndex = 0;
    while ((m = PARAM.exec(tpl))) {
      out += kawalek(tpl.slice(i, m.index)) + (p && m[1] in p ? escH(p[m[1]]) : escH(m[0]));
      i = m.index + m[0].length;
    }
    return out + kawalek(tpl.slice(i));
  }

  function wykryj() {
    let z = null;
    try { z = localStorage.getItem(LS_JEZYK); } catch (e) { /* brak dostępu */ }
    if (JEZYKI.includes(z)) return z;
    const n = String((typeof navigator !== "undefined" && navigator.language) || "").toLowerCase();
    return n.startsWith("pl") ? "pl" : "en";
  }

  // zwraca true, gdy język się zmienił; zapamietaj = wybór użytkownika na ekranie startowym
  function ustaw(j, zapamietaj) {
    if (!JEZYKI.includes(j)) return false;
    const zmiana = j !== biezacy;
    biezacy = j;
    if (typeof document !== "undefined") document.documentElement.lang = j;
    if (zapamietaj) { try { localStorage.setItem(LS_JEZYK, j); } catch (e) { /* brak dostępu */ } }
    return zmiana;
  }

  // waluta główna: kod ISO 4217 (walidacja w magazynie/imporcie); błędny kod → bez zmiany
  // Intl przyjmuje każdy kod z 3 liter (także nieistniejący) — allowlista znanych walut
  const ZNANE_WALUTY = (() => {
    try { return new Set(Intl.supportedValuesOf("currency")); }
    catch (e) { return new Set(["PLN", "USD", "EUR", "GBP", "CHF", "CZK", "SEK", "NOK", "DKK", "HUF", "CAD", "AUD", "NZD", "JPY"]); }   // starsze przeglądarki
  })();
  function poprawnaWaluta(w) {
    if (typeof w !== "string" || !/^[A-Z]{3}$/.test(w) || w === "XXX" || !ZNANE_WALUTY.has(w)) return false;
    try { new Intl.NumberFormat("en", { style: "currency", currency: w }); return true; } catch (e) { return false; }
  }
  function ustawWalute(w) {
    if (!poprawnaWaluta(w)) return false;
    if (w !== waluta) { waluta = w; formatery.clear(); }
    return true;
  }

  const liczba = (n, d = 0) => fmt("n" + d, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

  function walutowy(d) {
    try { return fmt("c" + waluta + d, { style: "currency", currency: waluta, currencyDisplay: "narrowSymbol", minimumFractionDigits: d, maximumFractionDigits: d }); }
    catch (e) { return fmt("s" + waluta + d, { style: "currency", currency: waluta, minimumFractionDigits: d, maximumFractionDigits: d }); }  // stare Safari
  }
  const kwota = (n, d = 0) => walutowy(d).format(n);
  const symbol = () => (walutowy(0).formatToParts(0).find(x => x.type === "currency") || { value: waluta }).value;
  // kwota w HTML z symbolem waluty w <small> (KPI): "1 234<small>zł</small>" / "<small>$</small>1,234"
  function kwotaH(n, d = 0) {
    const cz = walutowy(d).formatToParts(n);
    const przySymbolu = i => cz[i] && cz[i].type === "literal" && /^\s+$/.test(cz[i].value)
      && ((cz[i - 1] && cz[i - 1].type === "currency") || (cz[i + 1] && cz[i + 1].type === "currency"));
    return cz.map((x, i) => (x.type === "currency" ? `<small>${escH(x.value)}</small>` : przySymbolu(i) ? "" : escH(x.value))).join("");
  }

  // "RRRR-MM" → "listopad 2026" / "lis 26"
  function miesiac(m, dlugi) {
    const [y, mo] = String(m).split("-");
    const M = MIESIACE[biezacy];
    return dlugi ? `${M.dl[+mo - 1]} ${y}` : `${M.kr[+mo - 1]} ${y.slice(2)}`;
  }
  const dataCzas = d => new Date(d).toLocaleString(LOCALE[biezacy]);

  // tekst z tokenami [b]/[code] → węzły DOM (bez innerHTML): tekst jako węzły tekstowe, tokeny jako elementy
  function wezly(k, p) {
    const frag = document.createDocumentFragment();
    let rodzic = frag;
    for (const cz of t.surowy(k, p).split(/(\[\/?(?:b|code)\])/)) {
      const m = /^\[(\/?)(b|code)\]$/.exec(cz);
      if (m && !m[1] && rodzic === frag) rodzic = frag.appendChild(document.createElement(m[2]));
      else if (m && m[1]) rodzic = frag;
      else if (cz) rodzic.appendChild(document.createTextNode(cz));
    }
    return frag;
  }

  // statyczne napisy w DOM: data-i18n (tekst), data-i18n-h (tekst z [b]/[code]), data-i18n-title/-placeholder/-aria-label
  function zastosuj(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-h]").forEach(el => { el.replaceChildren(wezly(el.dataset.i18nH)); });
    for (const a of ["title", "placeholder", "aria-label"]) {
      const d = "i18n" + a.replace(/(^|-)(\w)/g, (x, y, z) => z.toUpperCase());   // data-i18n-aria-label → dataset.i18nAriaLabel
      root.querySelectorAll(`[data-i18n-${a}]`).forEach(el => el.setAttribute(a, t(el.dataset[d])));
    }
  }

  W.i18n = {
    JEZYKI, SLOWNIK, MIESIACE, dodaj, t, tH, wezly, wykryj, ustaw, ustawWalute, poprawnaWaluta, zastosuj,
    liczba, kwota, kwotaH, symbol, miesiac, dataCzas,
    jezyk: () => biezacy, locale: () => LOCALE[biezacy], waluta: () => waluta,
  };
  W.t = t;
  W.tH = tH;
  ustaw(wykryj());
})(globalThis.W = globalThis.W || {});
