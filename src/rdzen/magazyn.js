// Magazyn ustawień + lokalna atrapa API serwera (te same endpointy co serwer.py).
// Dashboard woła wApi('/api/...') jak w trybie serwera — tu odpowiada pamięć przeglądarki, bez sieci.
// Źródła: pliki z folderu (override.json, tagi.json, … albo pakiet wydatki-ustawienia.json)
// i kopia robocza w localStorage — wygrywa nowsza. Zapis do folderu robi app.js (hook poZapisie).
(function (W) {
  "use strict";

  const MAX_WLASNE = 100, MAX_TAGI_TX = 20, MAX_REGULY = 500;
  const NAZWA_RE = /^[\p{L}\p{N}_ ()+&.\/-]{1,40}$/u;      // jak NAZWA_RE w serwer.py (\w = Unicode)
  const TXT_RE = /^[^<>"`]{1,60}$/;                          // nazwy w budżetach: bez znaków HTML
  const PUSTY = () => ({ zwroty: [], override: {}, wlasne: [], tagi: {}, budzety: [], konfiguracja: {}, reguly: [] });

  // nazwy plików jak w wersji Python — migracja = skopiowanie plików do ustawienia/
  const PLIKI = { zwroty: "zwroty.json", override: "override.json", wlasne: "kategorie_wlasne.json",
                  tagi: "tagi.json", budzety: "budzety.json", konfiguracja: "konfiguracja.json",
                  reguly: "reguly_wlasne.json" };

  const PAKIET = "wydatki-ustawienia.json";               // jeden plik z wszystkimi ustawieniami (eksport)

  const M = { stan: PUSTY(), zFolderu: PUSTY(), klucz: null, zrodlo: "folder", zmieniono: null, kategorieRegul: [],
              poZapisie: null };

  const jestObiekt = v => v && typeof v === "object" && !Array.isArray(v);
  const listaStr = v => Array.isArray(v) && v.every(x => typeof x === "string");

  // --- walidacja: port save_* z serwer.py --------------------------------------
  const WALIDUJ = {
    zwroty(ids) {
      if (!listaStr(ids)) throw new Error("Oczekiwano listy stringów (ID transakcji).");
      return [...new Set(ids)].sort();
    },
    override(m) {
      if (!jestObiekt(m) || !Object.entries(m).every(([, v]) => typeof v === "string"))
        throw new Error("Oczekiwano mapy {ID: kategoria}.");
      return Object.fromEntries(Object.entries(m).filter(([, v]) => v));
    },
    wlasne(names) {
      if (!listaStr(names)) throw new Error("Oczekiwano listy nazw kategorii.");
      const zRegul = new Set(M.kategorieRegul.map(k => k.toLowerCase())), seen = new Set(), clean = [];
      for (const raw of names) {
        const n = raw.trim().replace(/ /g, "_");
        if (!n) continue;
        if (!NAZWA_RE.test(n)) throw new Error(`Niedozwolona nazwa kategorii: ${raw}`);
        const cf = n.toLowerCase();
        if (zRegul.has(cf) || seen.has(cf)) continue;
        seen.add(cf); clean.push(n);
      }
      if (clean.length > MAX_WLASNE) throw new Error(`Za dużo kategorii (max ${MAX_WLASNE}).`);
      return clean;
    },
    tagi(m) {
      if (!jestObiekt(m) || !Object.values(m).every(listaStr)) throw new Error("Oczekiwano mapy {ID: [tag, ...]}.");
      const clean = {};
      for (const [k, v] of Object.entries(m)) {
        const tags = [];
        for (const raw of v) {
          const n = raw.trim().replace(/ /g, "_");
          if (!NAZWA_RE.test(n.replace(/^-+/, ""))) throw new Error(`Niedozwolona nazwa tagu: ${raw}`);
          if (!tags.includes(n)) tags.push(n);
        }
        if (tags.length > MAX_TAGI_TX) throw new Error(`Za dużo tagów na transakcji (max ${MAX_TAGI_TX}).`);
        if (tags.length) clean[k] = tags;
      }
      return clean;
    },
    budzety(lst) {
      if (!Array.isArray(lst) || lst.length > 50) throw new Error("Oczekiwano listy budżetów (max 50).");
      return lst.map(b => {
        if (!jestObiekt(b)) throw new Error("Budżet musi być obiektem.");
        const nazwa = String(b.nazwa || "").trim();
        if (!TXT_RE.test(nazwa)) throw new Error(`Niedozwolona nazwa budżetu: ${nazwa}`);
        if (b.okres !== "miesiac" && b.okres !== "rok") throw new Error("Okres budżetu: 'miesiac' albo 'rok'.");
        if (typeof b.limit !== "number" || !(b.limit >= 0 && b.limit < 1e7)) throw new Error("Limit budżetu: liczba 0–10 mln.");
        const out = { nazwa, okres: b.okres, limit: b.limit };
        for (const k of ["kategorie", "tagi", "bez_tagow"]) {
          const v = b[k] || [];
          if (!Array.isArray(v) || !v.every(x => typeof x === "string" && TXT_RE.test(x))) throw new Error(`Pole ${k}: lista nazw.`);
          if (v.length) out[k] = v;
        }
        if (!out.kategorie && !out.tagi) throw new Error(`Budżet ${nazwa}: podaj kategorię lub tag.`);
        const w = b.wyjatki || {};
        if (!jestObiekt(w) || !Object.entries(w).every(([k, v]) => /^\d{4}(-\d{2})?$/.test(k) && typeof v === "number" && v >= 0 && v < 1e7))
          throw new Error("Wyjątki: {'RRRR-MM' lub 'RRRR': limit}.");
        if (Object.keys(w).length) out.wyjatki = w;
        return out;
      });
    },
    // ustawienia FIRE; scisle=false (plik z folderu): błędne pole pominięte, reszta zostaje
    konfiguracja(k, scisle = true) {
      if (!jestObiekt(k)) throw new Error("Oczekiwano obiektu ustawień.");
      const out = {};
      const LICZBY = { fire_cel_mc: [0, 1e7], fire_swr: [0.005, 0.2], prog_jednorazowych: [0, 1e7], miesiecy_podsumowania: [1, 36] };
      for (const [n, [min, max]] of Object.entries(LICZBY)) {
        if (k[n] === undefined) continue;
        const v = k[n];
        const ok = typeof v === "number" && isFinite(v) && v >= min && v <= max && (n !== "miesiecy_podsumowania" || Number.isInteger(v));
        if (ok) out[n] = v;
        else if (scisle) throw new Error(`${n}: liczba ${min}–${max}.`);
      }
      for (const n of ["tagi_dzieci", "tagi_wydarzen"]) {
        if (k[n] === undefined) continue;
        if (!listaStr(k[n]) || k[n].length > 20) { if (scisle) throw new Error(`${n}: lista nazw (max 20).`); continue; }
        const lst = [...new Set(k[n].map(x => x.trim().replace(/ /g, "_")).filter(Boolean))];
        const zla = lst.find(x => !NAZWA_RE.test(x));
        if (zla) { if (scisle) throw new Error(`Niedozwolona nazwa tagu: ${zla}`); continue; }
        out[n] = lst;
      }
      return out;
    },
    // reguły dodane w aplikacji: [{wzorzec, kategoria}] — wzorzec jak w kategorie.yaml (regex, bez ReDoS)
    reguly(lst) {
      if (!Array.isArray(lst) || lst.length > MAX_REGULY) throw new Error(`Oczekiwano listy reguł (max ${MAX_REGULY}).`);
      return lst.map(r => {
        if (!jestObiekt(r)) throw new Error("Reguła musi być obiektem {wzorzec, kategoria}.");
        const wz = String(r.wzorzec == null ? "" : r.wzorzec).trim();
        const kat = String(r.kategoria == null ? "" : r.kategoria).trim().replace(/ /g, "_");
        if (!wz) throw new Error("Pusty wzorzec reguły.");
        const ryz = W.reguly && W.reguly.ryzykowny(wz);
        if (ryz) throw new Error(`Wzorzec „${wz.slice(0, 40)}”: ${ryz}`);
        try { new RegExp(wz.replace(/\(\?P</g, "(?<"), "i"); }
        catch (e) { throw new Error(`Błędny wzorzec „${wz.slice(0, 40)}”: ${e.message}`); }
        if (!NAZWA_RE.test(kat)) throw new Error(`Niedozwolona nazwa kategorii: ${kat}`);
        return { wzorzec: wz, kategoria: kat };
      });
    },
  };

  // wczytanie pliku z folderu: błędny/obcy JSON = pusta wartość (jak load_* w serwer.py)
  function zPliku(nazwa, tekst) {
    try { return WALIDUJ[nazwa](JSON.parse(tekst), false); }
    catch (e) { return PUSTY()[nazwa]; }
  }

  // --- kopia robocza w przeglądarce (per profil: demo / nazwa folderu) ----------
  // bezKopii / pierwszaBezKopii: ile zmian (i od kiedy) nie trafiło jeszcze do pliku kopii —
  // podstawa ostrzeżenia w pasku (Firefox/Safari nie zapiszą same do folderu)
  function zapiszKopie() {
    M.zmieniono = new Date().toISOString();
    M.zrodlo = "przegladarka";
    M.bezKopii = (M.bezKopii || 0) + 1;
    if (!M.pierwszaBezKopii) M.pierwszaBezKopii = M.zmieniono;
    utrwal();
  }

  function utrwal() {
    try {
      localStorage.setItem(M.klucz, JSON.stringify({ stan: M.stan, zmieniono: M.zmieniono, bezKopii: M.bezKopii,
        pierwszaBezKopii: M.pierwszaBezKopii, ostatniaKopia: M.ostatniaKopia }));
    } catch (e) { /* tryb prywatny */ }
  }

  // pakiet pobrany → zmiany zabezpieczone (o ile użytkownik przeniesie plik do folderu)
  function oznaczKopie() {
    M.bezKopii = 0; M.pierwszaBezKopii = null; M.ostatniaKopia = new Date().toISOString();
    if (M.zrodlo === "przegladarka") utrwal();
  }

  // pakiet z eksportu: {format, wersja, zapisano, zwroty, override, wlasne, tagi, budzety}
  function czytajPakiet(tekst) {
    try {
      const p = JSON.parse(tekst);
      return p && p.format === "wydatki-ustawienia" && typeof p.zapisano === "string" ? p : null;
    } catch (e) { return null; }
  }

  // ustawienia: {nazwa_pliku: tekst} z folderu (+ PAKIET), czasFolderu: ms ostatniej zmiany plików ustawień.
  // Zwraca źródło: "folder" | "przegladarka" (kopia robocza nowsza niż folder).
  function wczytaj(profil, ustawienia, kategorieRegul, czasFolderu) {
    M.klucz = "wydatki_web_ustawienia_v1:" + profil;
    M.kategorieRegul = kategorieRegul;
    M.zFolderu = PUSTY();
    for (const [k, plik] of Object.entries(PLIKI)) if (ustawienia[plik] != null) M.zFolderu[k] = zPliku(k, ustawienia[plik]);
    let czas = czasFolderu || 0;
    const pakiet = ustawienia[PAKIET] != null ? czytajPakiet(ustawienia[PAKIET]) : null;
    if (pakiet) {                                           // pakiet z eksportu nadpisuje pojedyncze pliki
      for (const k of Object.keys(PLIKI)) if (pakiet[k] !== undefined) M.zFolderu[k] = zPliku(k, JSON.stringify(pakiet[k]));
      czas = Math.max(czas, Date.parse(pakiet.zapisano) || 0);
    }
    let kopia = null;
    try { kopia = JSON.parse(localStorage.getItem(M.klucz) || "null"); } catch (e) { kopia = null; }
    if (kopia && kopia.stan && (Date.parse(kopia.zmieniono) || 0) > czas) {
      M.stan = PUSTY();
      for (const k of Object.keys(PLIKI))
        M.stan[k] = k in kopia.stan ? zPliku(k, JSON.stringify(kopia.stan[k])) : JSON.parse(JSON.stringify(M.zFolderu[k]));   // kopia sprzed nowego pliku
      M.zrodlo = "przegladarka"; M.zmieniono = kopia.zmieniono;
      // kopie sprzed licznika: nowsze niż folder = co najmniej 1 zmiana bez kopii
      M.bezKopii = typeof kopia.bezKopii === "number" ? kopia.bezKopii : 1;
      M.pierwszaBezKopii = kopia.pierwszaBezKopii || (M.bezKopii ? kopia.zmieniono : null);
      M.ostatniaKopia = kopia.ostatniaKopia || null;
    } else {
      M.stan = JSON.parse(JSON.stringify(M.zFolderu));
      M.zrodlo = "folder"; M.zmieniono = null;
      M.bezKopii = 0; M.pierwszaBezKopii = null; M.ostatniaKopia = null;
    }
    return M.zrodlo;
  }

  function odrzucKopie() {
    try { localStorage.removeItem(M.klucz); } catch (e) { /* brak dostępu */ }
  }

  // zapis udany w folderze → kopia robocza zbędna
  function zapisanoWFolderze() {
    odrzucKopie();
    M.zrodlo = "folder";
  }

  // JSON jak json.dump(indent=0) w serwer.py — pliki zgodne z wersją Python (czytelny diff)
  function jsonPython(obj) {
    return JSON.stringify(obj, null, 1).split("\n").map(l => l.replace(/^ +/, "")).join("\n");
  }

  function eksport() {
    return JSON.stringify({ format: "wydatki-ustawienia", wersja: 1, zapisano: new Date().toISOString(), ...M.stan }, null, 1);
  }

  // --- atrapa API: odpowiedź w kształcie Response (ok, status, json(), text()) ---
  const ENDPOINT = { "/api/zwroty": "zwroty", "/api/kategorie": "override", "/api/kategorie-wlasne": "wlasne",
                     "/api/tagi": "tagi", "/api/budzety": "budzety", "/api/konfiguracja": "konfiguracja",
                     "/api/reguly-wlasne": "reguly" };

  function odp(status, obj) {
    const body = JSON.stringify(obj);
    return Promise.resolve({ ok: status < 400, status, json: async () => JSON.parse(body), text: async () => body });
  }

  // async: zapis do folderu (Chrome) kończy się przed odpowiedzią — przeładowanie po zmianie czyta już nowy plik
  async function api(url, opts) {
    const metoda = (opts && opts.method) || "GET";
    if (url === "/api/przelicz") return odp(200, { ok: true });
    const nazwa = ENDPOINT[url];
    if (!nazwa) return odp(404, { ok: false, error: "Nie znaleziono." });
    if (metoda === "GET") return odp(200, M.stan[nazwa]);
    try {
      const clean = WALIDUJ[nazwa](JSON.parse((opts && opts.body) || "null"));
      M.stan[nazwa] = clean;
      zapiszKopie();
      if (M.poZapisie) await M.poZapisie(nazwa);                  // app.js: zapis do folderu (Chrome), jeśli jest dostęp
      return odp(200, nazwa === "wlasne" ? { ok: true, kategorie: clean } : { ok: true, n: Object.keys(clean).length });
    } catch (e) {
      return odp(400, { ok: false, error: e.message });
    }
  }

  M.PLIKI = PLIKI;
  M.PAKIET = PAKIET;
  M.wczytaj = wczytaj;
  M.odrzucKopie = odrzucKopie;
  M.zapisanoWFolderze = zapisanoWFolderze;
  M.jsonPython = jsonPython;
  M.eksport = eksport;
  M.oznaczKopie = oznaczKopie;
  W.magazyn = M;
  W.api = api;
})(globalThis.W = globalThis.W || {});
