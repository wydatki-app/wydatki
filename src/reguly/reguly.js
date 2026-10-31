// Reguły kategoryzacji: mini-parser YAML (format kategorie.yaml) + kategoryzacja.
// Port 1:1 z analiza_wydatkow.py — te same reguły muszą dać te same kategorie co wersja Python.
(function (W) {
  "use strict";
  const { obetnij, round2 } = W.model;

  // wartość elementu listy: zdejmij cudzysłowy albo inline-komentarz `# ...`
  function czystaWartosc(raw) {
    let v = raw.trim();
    if (v[0] === '"' || v[0] === "'") {
      const end = v.indexOf(v[0], 1);
      return end > 0 ? v.slice(1, end) : v.slice(1);
    }
    const h = v.indexOf("#");
    if (h >= 0) v = v.slice(0, h);
    return v.trim();
  }

  const SEKCJE = ["_wyklucz", "kategorie", "_tagi", "_wplywy"];
  const rstripDwukropek = s => s.replace(/:+$/, "");

  // Kategorie = lista BLOKÓW [nazwa, wzorce] w kolejności z pliku (ta sama nazwa może wystąpić
  // kilka razy — niższy priorytet części wzorców). Tagi i wpływy: scalane po nazwie.
  function wczytajYaml(tekst) {
    const wyklucz = [], bloki = [], tagi = new Map(), wplywy = new Map();
    let sekcja = null, biezaca = null;
    for (const line of tekst.replace(/^﻿/, "").split("\n")) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const wciecie = line.length - line.trimStart().length;
      let s = line.trim();
      if (wciecie === 0 && SEKCJE.includes(rstripDwukropek(s))) {
        sekcja = rstripDwukropek(s); biezaca = null; continue;
      }
      if (s.startsWith("- ")) {
        const val = czystaWartosc(s.slice(2));
        if (sekcja === "_wyklucz") wyklucz.push(val);
        else if (biezaca !== null && val) biezaca.push(val);
        continue;
      }
      s = s.replace(/\s+#.*$/, "");
      if (["kategorie", "_tagi", "_wplywy"].includes(sekcja) && (s.endsWith(":") || s.includes(": []"))) {
        const nazwa = s.split(":")[0].trim();
        biezaca = [];
        if (sekcja === "kategorie") bloki.push([nazwa, biezaca]);
        else {
          const mapa = sekcja === "_tagi" ? tagi : wplywy;
          if (!mapa.has(nazwa)) mapa.set(nazwa, biezaca);
          biezaca = mapa.get(nazwa);
        }
      }
    }
    return { wyklucz, bloki, tagi, wplywy };
  }

  // ReDoS: wzorce z kategorie.yaml to dane z pliku. Odrzucamy za długie i takie, w których grupa
  // z kwantyfikatorem sama jest powtarzana — (a+)+, (\w*)*, ((x+)y){2,}: wykładniczy backtracking.
  // Skaner nie łapie wszystkiego (np. (a|a)*), dlatego dopasowanie idzie tylko po MAX_TEKST znakach.
  const MAX_WZORZEC = 300, MAX_TEKST = 1000;
  function zagniezdzony(p) {
    const stos = [{ q: false }];
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === "\\") { i++; continue; }
      if (c === "[") {                                        // klasa znaków: kwantyfikatory w środku to literały
        for (i++; i < p.length && p[i] !== "]"; i++) if (p[i] === "\\") i++;
        continue;
      }
      if (c === "(") { stos.push({ q: false }); if (p[i + 1] === "?") i++; continue; }   // (?: (?= (?< — „?” to nie kwantyfikator
      if (c === ")") {
        const g = stos.length > 1 ? stos.pop() : { q: false };
        const n = p[i + 1], kwant = n === "*" || n === "+" || (n === "{" && /^\{\d*,\d*\}/.test(p.slice(i + 1)));
        if (kwant && g.q) return true;
        stos[stos.length - 1].q = stos[stos.length - 1].q || g.q || kwant;
        continue;
      }
      if (c === "*" || c === "+" || c === "?" || c === "{") stos[stos.length - 1].q = true;
    }
    return false;
  }
  function ryzykowny(p) {
    if (p.length > MAX_WZORZEC) return `wzorzec za długi (> ${MAX_WZORZEC} znaków)`;
    if (zagniezdzony(p)) return "powtarzana grupa z kwantyfikatorem, np. (a+)+ — może zawiesić aplikację";
    return null;
  }

  // Regex Pythona → JS. Różnice składni: (?P<n>…) → (?<n>…). Błędny lub ryzykowny wzorzec nie
  // wywraca całości — trafia na listę błędów (pokazywaną użytkownikowi).
  function kompiluj(wzorce, bledy) {
    const out = [];
    for (const p of wzorce) {
      const r = ryzykowny(p);
      if (r) { bledy.push(`${p.slice(0, 80)}: ${r}`); continue; }
      try { out.push(new RegExp(p.replace(/\(\?P</g, "(?<"), "i")); }
      catch (e) { bledy.push(`${p}: ${e.message}`); }
    }
    return out;
  }

  function zbuduj(tekstYaml) {
    const y = wczytajYaml(tekstYaml), bledy = [];
    const kat = y.bloki.map(([n, p]) => [n, kompiluj(p, bledy)]);
    return {
      kategorie: [...new Set(y.bloki.map(([n]) => n))],
      wplywyGrupy: [...y.wplywy.keys()],
      wykluczRe: kompiluj(y.wyklucz, bledy),
      katRe: kat,
      tagRe: [...y.tagi].map(([n, p]) => [n, kompiluj(p, bledy)]),
      wplywyRe: [...y.wplywy].map(([n, p]) => [n, kompiluj(p, bledy)]),
      bledy,
    };
  }

  const pasuje = (rxs, text) => {
    const t = text.length > MAX_TEKST ? text.slice(0, MAX_TEKST) : text;   // prawdziwe opisy: < 200 znaków
    return rxs.some(rx => rx.test(t));
  };

  function wykluczona(R, tx) {
    if (!tx.opis && !tx.odb) return true;          // bez opisu i odbiorcy = techniczny przepływ
    return pasuje(R.wykluczRe, tx.text);
  }

  function kategoria(R, tx) {
    for (const [k, rxs] of R.katRe) if (pasuje(rxs, tx.text)) return k;
    return "Inne_nieskategoryzowane";
  }

  function grupaWplywu(R, tx) {
    for (const [g, rxs] of R.wplywyRe) if (pasuje(rxs, tx.text)) return g;
    return "Inne_wpływy";
  }

  const autoTagi = (R, tx) => R.tagRe.filter(([, rxs]) => pasuje(rxs, tx.text)).map(([n]) => n);

  // Odpowiednik extract_for_json: wydatki (z kategorią, ID, tagami) + wpływy (z grupą)
  function doDashboardu(R, txs) {
    const out = [], wpl = [];
    for (const tx of txs) {
      if (tx.uzn) {
        if (!wykluczona(R, tx)) wpl.push({ d: tx.data, o: obetnij(tx.opis || tx.odb, 70), k: tx.uzn, g: grupaWplywu(R, tx) });
        continue;
      }
      if (tx.obc == null || wykluczona(R, tx)) continue;
      const opis = obetnij(tx.opis || tx.odb || "—", 70);
      const kwota = round2(Math.abs(tx.obc));
      // stabilny ID (data|opis|kwota) — klucz ręcznych korekt; zapis liczby jak str(float) w Pythonie
      const rec = { id: `${tx.data}|${opis}|${W.model.pyFloat(kwota)}`, d: tx.data, o: opis, k: kwota, c: kategoria(R, tx) };
      const at = autoTagi(R, tx);
      if (at.length) rec.at = at;
      out.push(rec);
    }
    out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return { out, in: wpl };
  }

  W.reguly = { wczytajYaml, zbuduj, ryzykowny, wykluczona, kategoria, grupaWplywu, autoTagi, doDashboardu };
})(globalThis.W = globalThis.W || {});
