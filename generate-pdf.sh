#!/bin/bash

# Speleo Studio kézikönyv PDF generálása
# Ez a script automatikusan létrehozza a teljes kézikönyvet egy PDF fájlban

echo "🚀 Speleo Studio kézikönyv PDF generálása..."
echo "=========================================="

# Ellenőrizze, hogy a wkhtmltopdf telepítve van-e
if ! command -v wkhtmltopdf &> /dev/null; then
    echo "❌ Hiba: wkhtmltopdf nincs telepítve!"
    echo ""
    echo "📥 Töltse le innen: https://wkhtmltopdf.org/downloads.html"
    echo ""
    echo "Telepítés után futtassa újra ezt a scriptet."
    exit 1
fi

echo "✅ wkhtmltopdf telepítve van"

# Ellenőrizze, hogy a manual mappa létezik-e
if [ ! -d "hu" ]; then
    echo "❌ Hiba: A 'hu' mappa nem található!"
    echo "Győződjön meg róla, hogy ezt a scriptet a projekt gyökérkönyvtárában futtatja."
    exit 1
fi

echo "✅ Manual mappa megtalálható"


echo "📁 Navigálás a manual mappába..."
echo "🔄 PDF generálása folyamatban..."
echo "${PWD}/manual/hu/index.html"
# Generálja a PDF-et
wkhtmltopdf \
  --enable-local-file-access \
  --page-size A4 \
  --margin-top 20mm \
  --margin-bottom 20mm \
  --margin-left 15mm \
  --margin-right 15mm \
  --print-media-type \
  --no-stop-slow-scripts \
  --javascript-delay 1000 \
  ${PWD}/hu/index.html \
   ../speleo-studio-teljes-kezikonyv.pdf

# Ellenőrizze, hogy a PDF sikeresen létrejött-e
if [ -f "../speleo-studio-teljes-kezikonyv.pdf" ]; then
    echo ""
    echo "✅ Sikeres! PDF fájl létrehozva:"
    echo "📄 speleo-studio-teljes-kezikonyv.pdf"
    echo ""
    echo "📊 Fájlméret: $(du -h ../speleo-studio-teljes-kezikonyv.pdf | cut -f1)"
    echo ""
    echo "🎉 A teljes Speleo Studio felhasználói kézikönyv most elérhető PDF formátumban!"
else
    echo ""
    echo "❌ Hiba történt a PDF generálása során."
    echo "Próbálja meg újra, vagy használja a böngésző alapú megoldást."
    echo ""
    echo "💡 Alternatív megoldás:"
    echo "1. Nyissa meg a Firefox böngészőt"
    echo "2. Nyissa meg: manual/index.html"
    echo "3. Nyomja meg: Ctrl+P (Cmd+P Mac-en)"
    echo "4. Válassza: 'PDF mentése' és 'Minden oldal'"
fi

# Vissza a gyökérkönyvtárba
cd ..

echo ""
echo "📚 További információ: manual/single-pdf-guide.html"
