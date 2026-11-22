#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Odtwarzalne obrazy do README: docs/animation.gif (EN) i docs/dashboard.en.png (demo EN).
Opcjonalnie --pl: także docs/animacja.gif i docs/dashboard.png z wersji polskiej.

Uruchomienie (w katalogu repo, po `python3 -I build.py`):
    python3 -I narzedzia/media.py [--pl]

Wymaga: Firefox (headless, przez Marionette z testy/marionette.py) i ffmpeg.
Animacja CSS jest zatrzymywana (Web Animations API) i ustawiana klatka po klatce — wynik nie zależy od
szybkości komputera. 2 kl./s × 25 s, szerokość 640 px, jak dotychczasowy animacja.gif.

Bezpieczeństwo: tylko pliki lokalne z repo (file://), tymczasowy profil Firefoksa, Marionette na 127.0.0.1;
ffmpeg wywoływany listą argumentów, bez powłoki. Dane = fikcyjne demo z dist/.
"""
import base64
import os
import shutil
import subprocess
import sys
import tempfile
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "testy"))
from marionette import Marionette, firefox_bin, wolny_port  # noqa: E402

FPS, DLUGOSC_S, SZEROKOSC = 2, 25, 640
ELEM = "element-6066-11e4-a52e-4f735466cecf"   # klucz referencji elementu w WebDriver

ZATRZYMAJ = """
const t = arguments[0] * 1000;
for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
return document.getAnimations().length;
"""


class Przegladarka:
    def __init__(self, tmp, w, h):
        prof = os.path.join(tmp, "profil")
        os.makedirs(prof, exist_ok=True)
        self.port = wolny_port()
        with open(os.path.join(prof, "user.js"), "w") as f:
            f.write(f'user_pref("marionette.port", {self.port});\n'
                    'user_pref("browser.shell.checkDefaultBrowser", false);\n'
                    'user_pref("datareporting.policy.dataSubmissionEnabled", false);\n'
                    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);\n'
                    'user_pref("layout.css.prefers-color-scheme.content-override", 1);\n'   # jasny motyw
                    'user_pref("ui.prefersReducedMotion", 0);\n')
        self.proc = subprocess.Popen([firefox_bin(), "--headless", "--marionette", "--no-remote", "--profile", prof],  # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.m = Marionette(self.port)
        self.m.wyslij("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"pageLoadStrategy": "normal"}}})
        self.m.wyslij("WebDriver:SetWindowRect", {"width": w, "height": h})

    def otworz(self, sciezka, hash_="", czekaj_s=3):
        self.m.wyslij("WebDriver:Navigate", {"url": "file://" + sciezka + hash_})
        time.sleep(czekaj_s)

    def js(self, skrypt, *args):
        return self.m.wyslij("WebDriver:ExecuteScript", {"script": skrypt, "args": list(args)})["value"]

    def zrzut(self, plik, selektor=None):
        par = {"full": False}
        if selektor:
            el = self.m.wyslij("WebDriver:FindElement", {"using": "css selector", "value": selektor})["value"]
            par = {"id": el[ELEM]}
        with open(plik, "wb") as f:
            f.write(base64.b64decode(self.m.wyslij("WebDriver:TakeScreenshot", par)["value"]))

    def zamknij(self):
        try:
            self.m.wyslij("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def gif(przegl, html, wyjscie, tmp):
    klatki = os.path.join(tmp, "klatki-" + os.path.basename(html))
    os.makedirs(klatki, exist_ok=True)
    przegl.otworz(html)
    for i in range(FPS * DLUGOSC_S):
        n = przegl.js(ZATRZYMAJ, i / FPS)
        if not n:
            raise RuntimeError(f"{html}: brak animacji CSS (reduced motion?)")
        przegl.zrzut(os.path.join(klatki, f"k{i:03d}.png"), ".scena-box")
    filtr = (f"scale={SZEROKOSC}:-2:flags=lanczos,split[a][b];"
             "[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", os.path.join(klatki, "k%03d.png"),
                    "-filter_complex", filtr, "-loop", "0", wyjscie], check=True)
    print("OK", os.path.relpath(wyjscie, REPO), os.path.getsize(wyjscie) // 1024, "KB")


def dashboard(przegl, wyjscie, hash_):
    przegl.otworz(os.path.join(REPO, "dist", "wydatki.html"), hash_, czekaj_s=6)
    przegl.zrzut(wyjscie)
    print("OK", os.path.relpath(wyjscie, REPO), os.path.getsize(wyjscie) // 1024, "KB")


def main():
    if not shutil.which("ffmpeg"):
        sys.exit("Brak ffmpeg (brew install ffmpeg)")
    if not os.path.exists(os.path.join(REPO, "dist", "wydatki.html")):
        sys.exit("Brak dist/wydatki.html — najpierw: python3 -I build.py")
    pl = "--pl" in sys.argv[1:]
    docs = os.path.join(REPO, "docs")
    with tempfile.TemporaryDirectory() as tmp:
        p = Przegladarka(tmp, 860, 900)
        try:
            gif(p, os.path.join(docs, "animation.html"), os.path.join(docs, "animation.gif"), tmp)
            if pl:
                gif(p, os.path.join(docs, "animacja.html"), os.path.join(docs, "animacja.gif"), tmp)
        finally:
            p.zamknij()
        # dashboard: osobna sesja i profil, żeby localStorage z demo PL nie mieszał się z EN
        for nazwa, hash_ in (("dashboard.en.png", "#demo-en"),) + ((("dashboard.png", "#demo"),) if pl else ()):
            with tempfile.TemporaryDirectory() as tmp2:
                p = Przegladarka(tmp2, 1280, 900)
                try:
                    dashboard(p, os.path.join(docs, nazwa), hash_)
                finally:
                    p.zamknij()
    print("Sprawdź obrazy wzrokowo przed commitem (dane fikcyjne, jasny motyw, język).")


if __name__ == "__main__":
    main()
