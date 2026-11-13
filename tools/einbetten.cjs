#!/usr/bin/env node
// index.html bauen: eigene Quellen aus src/ und wörtliche Kopien einsetzen: node tools/einbetten.cjs [Pfad zur Projektzentrale]
// Eingebettet (byte-gleich, Prüfung A in tests/lektorkit-check.cjs):
//   <script id="spektron-ordner">    ← Projektzentrale/spektron-ordner.js
//   <script id="archiv-auswertung">  ← Projektzentrale/archiv/auswertung.js
//   <script id="word-luecken">       ← Projektzentrale/word-luecken.js
//   /* XMLLESEN-KOPIE */ … /* XMLLESEN-KOPIE-ENDE */  ← Funktion xmlLesen aus Projektzentrale/archiv/lesen.js
const fs = require('node:fs'), path = require('node:path');
function xmlLesenAus(lesen){
  const a = lesen.indexOf('  function xmlLesen(text){'); if (a < 0) throw Error('xmlLesen nicht gefunden');
  const e = lesen.indexOf('\n    return out;\n  }\n', a); if (e < 0) throw Error('Ende von xmlLesen nicht gefunden');
  return lesen.slice(a, e + '\n    return out;\n  }'.length);
}
function bauen(){
const PZ = path.resolve(process.argv[2] || process.env.PROJEKTZENTRALE || path.join(__dirname, '..', '..', 'projektzentrale'));
  const ZIEL = path.join(__dirname, '..', 'index.html');
  const quelle = {
    'spektron-ordner': fs.readFileSync(path.join(PZ, 'spektron-ordner.js'), 'utf8'),
    'archiv-auswertung': fs.readFileSync(path.join(PZ, 'archiv', 'auswertung.js'), 'utf8'),
    'word-luecken': fs.readFileSync(path.join(PZ, 'word-luecken.js'), 'utf8'),
    // eigene Quellen (bearbeitet wird in src/, index.html ist die eine Datei, die ausgeliefert wird)
    'lektor-kern': fs.readFileSync(path.join(__dirname, '..', 'src', 'lektor-kern.js'), 'utf8'),
    'lektor-app': fs.readFileSync(path.join(__dirname, '..', 'src', 'lektor-app.js'), 'utf8'),
  };
  let html = fs.readFileSync(ZIEL, 'utf8');
  for (const [id, text] of Object.entries(quelle)){
    if (text.includes('</script')) throw Error(id + ' enthält </script');
    const re = new RegExp(`(<script id="${id}">\\n)[\\s\\S]*?(</script>)`);
    if (!re.test(html)) throw Error('Block ' + id + ' fehlt in index.html');
    html = html.replace(re, (m, a, b) => a + text + b);
  }
  const xl = xmlLesenAus(fs.readFileSync(path.join(PZ, 'archiv', 'lesen.js'), 'utf8'));
  html = html.replace(/(\/\* XMLLESEN-KOPIE \*\/\n)[\s\S]*?(\/\* XMLLESEN-KOPIE-ENDE \*\/)/, (m, a, b) => a + xl + '\n' + b);
  fs.writeFileSync(ZIEL, html);
  console.log('eingebettet aus', PZ);
}
if (require.main === module) bauen();
module.exports = { xmlLesenAus };
