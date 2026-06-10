// ═══════════════════════════════════════════════════════════════════════════
//  MakerX 3D Viewer 2.0 — AUTO SORT
//  Offline, rule-based classifier. Reads the (current-directory-only) file list
//  that app.js already loaded into `allFiles`, groups each file into one of the
//  category folders below, and renders a grouped sidebar where each group has a
//  "MOVE ALL INTO <group>" footer. No network, no API key — classification is
//  pure local keyword matching on the file name, so it ships free to everyone.
//
//  This file is loaded AFTER app.js, so it reuses app.js globals directly:
//    allFiles, knownSubfolders, rootDirPath, rootDirHandle,
//    buildFileRow(), execMoveFile(), escapeHtml(), updateStats(), clearSelection()
// ═══════════════════════════════════════════════════════════════════════════

/* ── Category list. There is no _REVIEW catch-all folder — files that don't
   match any group just stay at the end of the AUTO list with no move action. ── */
const AUTO_DEFAULT_CATEGORIES = [
  '3DPRINTERS', 'ARTICULATED', 'AUTOMOTIVE', 'BATHROOM', 'BIRDHOUSE',
  'BOOKENDS', 'BOOKMARKS', 'CFS ITEMS', 'CLICKERS', 'DOOR CORNERS', 'DRAGONS',
  'FIDGET', 'FIGURINES', 'GAG GIFTS', 'GAMES', 'GEOCACHING', 'GRIDFINITY',
  'HALLOWEEN', 'KEYCHAINS', 'KIDS', 'KITCHEN', 'EASTER', 'LAMPS', 'MAGNETS',
  'PETS', 'PLANTERS', 'POKEMON', 'SIGNS', 'STAR WARS – STAR TREK', 'STORAGE',
  'TOOLS', 'WALL ART', 'YARD', 'ZODIAC', 'CHRISTMAS',
];

/* ── Keyword rules: category → match phrases (lowercase). ────────────────────
   Longer / more-specific phrases score higher, so "baby yoda" beats a generic
   token. Tune these freely — adding words here makes AUTO smarter over time. */
const AUTO_KEYWORD_RULES = {
  // NOTE: deliberately NO brand names (creality/prusa/bambu/ender). They show up
  // in lots of download filenames (e.g. "[Creality Cloud]_...") that aren't printer
  // parts, so matching them mis-files models. Match real printer-PART words only.
  '3DPRINTERS':  ['3d printer','printer mount','nozzle','hotend','hot end','spool holder','spool','filament guide','print bed','build plate','bed level','calibration cube','cali cube','benchy','toolhead','tool head','extruder','bowden','ptfe','heat break','part cooling'],
  'ARTICULATED': ['articulated','artic','flexi','flexible','print in place','print-in-place','pip'],
  'AUTOMOTIVE':  ['automotive','car','truck','vehicle','wheel','tire','engine','piston','dashboard','jeep'],
  'BATHROOM':    ['bathroom','toothbrush','toothpaste','soap','razor','towel','shower','toilet','sink','vanity'],
  'BIRDHOUSE':   ['birdhouse','bird house','bird feeder','birdfeeder','feeder','nest box','nestbox'],
  'BOOKENDS':    ['bookend','book end'],
  'BOOKMARKS':   ['bookmark','book mark'],
  'CFS ITEMS':   ['cfs'],
  'CLICKERS':    ['clicker','click toy','worry clicker'],
  'DOOR CORNERS':['door corner','doorcorner','corner guard','door guard'],
  'DRAGONS':     ['dragon','wyvern','wyrm','drake'],
  'FIDGET':      ['fidget','spinner','fidget toy','infinity cube','fidget cube'],
  'FIGURINES':   ['figurine','figure','statue','bust','miniature','mini','sculpture'],
  'GAG GIFTS':   ['gag','prank','funny','joke','novelty','white elephant'],
  'GAMES':       ['game','dice','chess','checkers','puzzle','board game','token','meeple','d20','tabletop','playing card'],
  'GEOCACHING':  ['geocache','geocaching','cache container','bison tube','ammo can'],
  'GRIDFINITY':  ['gridfinity','grid bin','gridbin','grid box','baseplate','base plate'],
  'HALLOWEEN':   ['halloween','pumpkin','jack o lantern','jackolantern','skull','skeleton','ghost','spooky','spider','bat','witch','grim reaper'],
  'KEYCHAINS':   ['keychain','key chain','keyring','key ring','key fob','keyfob','key tag'],
  'KIDS':        ['kids','kid','toy','child','children','baby','nursery','rattle','stacking'],
  'KITCHEN':     ['kitchen','cup','mug','coaster','utensil','fork','spoon','knife','bottle opener','measuring','funnel','egg cup','napkin'],
  'EASTER':      ['easter','easter egg','bunny','rabbit','chick','easter basket'],
  'LAMPS':       ['lamp','lampshade','lamp shade','light','litho','lithophane','nightlight','night light','led','sconce','candle'],
  'MAGNETS':     ['magnet','fridge magnet','magnetic'],
  'PETS':        ['pet','dog','cat','paw','puppy','kitten','aquarium','fish tank','pet tag','dog tag','cat toy'],
  'PLANTERS':    ['planter','plant pot','flower pot','flowerpot','vase','succulent','plant','garden pot','self watering'],
  'POKEMON':     ['pokemon','pikachu','pokeball','poke ball','charizard','bulbasaur','squirtle','eevee'],
  'SIGNS':       ['sign','plaque','nameplate','name plate','door sign','wall sign','street sign'],
  'STAR WARS – STAR TREK': ['star wars','starwars','mandalorian','baby yoda','grogu','yoda','darth','vader','stormtrooper','lightsaber','death star','millennium falcon','star trek','startrek','enterprise','spock','klingon'],
  'STORAGE':     ['storage','organizer','organiser','box','bin','holder','tray','drawer','container','caddy','rack','stand','dock','desk organizer','cable holder'],
  'TOOLS':       ['tool','wrench','jig','gauge','clamp','hook','screwdriver','hex key','allen','vise','sanding','deburr','workshop'],
  'WALL ART':    ['wall art','wallart','wall mount','wall hook','wall hanging','wall panel','frame','picture frame','relief'],
  'YARD':        ['yard','garden','outdoor','hose','sprinkler','stake','fence','patio','lawn','planter stake'],
  'ZODIAC':      ['zodiac','horoscope','star sign','aries','taurus','gemini','cancer sign','leo','virgo','libra','scorpio','scorpion','sagittarius','capricorn','aquarius','pisces'],
};

/* ── Multilingual keywords ───────────────────────────────────────────────────
   Lots of models (esp. Creality Cloud / MakerWorld) have Spanish, Portuguese,
   French, German, Italian, or Chinese names. These are MERGED into the rules
   below. All terms are lowercase + accent-folded (e.g. "dragón" is written
   "dragon", "küche" → "kuche") because autoNormalize folds accents off the file
   name before matching. Add your own translations here as you hit them. */
const AUTO_KEYWORD_RULES_I18N = {
  // es=Spanish, pt=Portuguese, fr=French, de=German, it=Italian, zh=Chinese
  'PETS':        ['gato','gatito','minino','chat','katze','gatto','kat','poes',  // cat (+nl)
                  'perro','perrito','cachorro','chien','hund','hond','hondje','mascota', // dog/pet (+nl)
                  '猫','狗'],
  'DRAGONS':     ['dragon','dragones','drache','drachen','dragao','dragone','龙','龍'],
  'EASTER':      ['pascua','paques','ostern','pasqua',                      // easter
                  'conejo','conejito','lapin','hase','coniglio','兔',       // bunny/rabbit
                  'huevo','oeuf','uovo'],                                   // egg
  'HALLOWEEN':   ['calabaza','citrouille','kuerbis','zucca',                // pumpkin
                  'calavera','craneo','totenkopf','esqueleto',             // skull/skeleton
                  'fantasma','bruja','arana','murcielago'],                 // ghost/witch/spider/bat
  'KITCHEN':     ['cocina','cuisine','kuche','cucina','taza','tasse','vaso','cuchara','tenedor','cuchillo','posavasos'],
  'PLANTERS':    ['maceta','macetero','jardiniere','blumentopf','florero','suculenta','planta','plante','pflanze','topf','jarron'],
  'KEYCHAINS':   ['llavero','porte cle','schlusselanhanger','portachiavi','chaveiro'],
  'BOOKMARKS':   ['marcapaginas','marque page','lesezeichen','segnalibro'],
  'TOOLS':       ['herramienta','outil','werkzeug','attrezzo','destornillador',
                  'goniometro','calibro','utensile','morsetto','инструмент'],   // +it +ru
  'STORAGE':     ['caja','boite','schachtel','scatola','organizador','rangement','almacenamiento','soporte','cajon','bandeja',
                  'подставка','органайзер','коробка','ящик','держатель','лоток'],   // +ru

  'LAMPS':       ['lampara','lampe','lampada','litofania','veilleuse','candil'],
  'MAGNETS':     ['iman','aimant','magnete'],
  'SIGNS':       ['cartel','letrero','panneau','schild','cartello','placa'],
  'WALL ART':    ['cuadro','wandkunst','cadre'],
  'KIDS':        ['nino','jouet','juguete','spielzeug','giocattolo','bambino','brinquedo','kinder'],
  'FIGURINES':   ['figura','estatua','busto','estatuilla','statuetta'],
  'AUTOMOTIVE':  ['coche','carro','voiture','rueda','wagen'],
  'GAMES':       ['juego','spiel','gioco','ajedrez','dado'],
  'BIRDHOUSE':   ['pajarera','nichoir','vogelhaus','mangeoire','comedero'],
  'BATHROOM':    ['bano','salle de bain','badezimmer','bagno','jabon'],
  'ARTICULATED': ['articulado','articule','gelenkig','articolato'],
  'GAG GIFTS':   ['broma','blague','scherz'],
  // Ukrainian + Russian zodiac signs (the file names in this set are Cyrillic).
  'ZODIAC':      ['зодіак','зодиак','гороскоп',
                  'овен',                       // aries
                  'телець','телец',             // taurus
                  'блезнюки','близнюки','близнецы', // gemini (incl. a common misspelling)
                  'рак',                        // cancer
                  'лев',                        // leo
                  'діва','дева',                // virgo
                  'терези','весы',              // libra
                  'скорпіон','скорпион',        // scorpio
                  'стрілець','стрелец',         // sagittarius
                  'козерог','козеріг',          // capricorn
                  'водолій','водолей',          // aquarius
                  'риби','рыбы'],               // pisces
};

/* ── Supplemental keywords mined from already-sorted folders ──────────────────
   English + foreign object words found by comparing the classifier against the
   user's hand-sorted folders. Includes the new CHRISTMAS category's terms. */
const AUTO_KEYWORD_RULES_EXTRA = {
  'CHRISTMAS':   ['christmas','xmas','santa','santa claus','santaclaus','reindeer','snowman',
                  'snowflake','ornament','grinch','gingerbread','nativity','sleigh',
                  'mistletoe','wreath','noel','navidad','weihnachten','natale'],   // +es/de/it
  'PLANTERS':    ['doniczka','vaso','germinador'],            // +pl planter, it/es vase, es germinator
  'STORAGE':     ['lochwandhaken','lochwand','krabicka','skadis','pegboard',
                  'broom mount','broom holder','toolbox','tool box'],              // +de pegboard hook, +cz box
  'GAMES':       ['scacchi','scacchiera'],                     // +it chess / chessboard
  'BATHROOM':    ['dentifricio','dentifrice','dentifrisse','papel higienico',
                  'higienico','papier toilette','toilet paper'],                   // +fr/pt/es
  'KITCHEN':     ['bowl','lata','latas','cuenco','soda can','can holder'],         // +es cans/bowl
  'HALLOWEEN':   ['czarownica','spook'],                       // +pl witch, +nl ghost
  'TOOLS':       ['bracket','corner bracket','carabiner','stamp'],
  'GAG GIFTS':   ['middle finger'],
  // Your YARD folder holds garden produce, so map vegetables/fruit there
  // (you opted not to have a separate FOOD category).
  'YARD':        ['windmill','vegetable','vegetables','tomato','potato','onion','carrot',
                  'cucumber','lettuce','cabbage','spinach','radish','beetroot','broccoli',
                  'beans','green beans','courgette','zucchini','scallion','scallions',
                  'garlic','corn','eggplant','aubergine','avocado','peas','peapod',
                  'asparagus','cauliflower','celery','leek','turnip','strawberry','lemon',
                  'melon','watermelon','pineapple'],
  '3DPRINTERS':  ['filament','scraper','purge bucket'],
  'PETS':        ['kralik'],                                   // +cz rabbit
};

// Merge translations + supplements into the main rule set once at load.
for (const src of [AUTO_KEYWORD_RULES_I18N, AUTO_KEYWORD_RULES_EXTRA]) {
  for (const [cat, words] of Object.entries(src)) {
    AUTO_KEYWORD_RULES[cat] = (AUTO_KEYWORD_RULES[cat] || []).concat(words);
  }
}

const AUTO_LS_KEY = 'mx_auto_custom_categories';   // persisted user-added groups
const AUTO_SUPPRESS_KEY = 'mx_auto_suppressed';    // tokens the user muted ("don't suggest again")
const AUTO_REVIEW = ' UNSORTED';   // internal sentinel for "matched no group" — NOT a folder/destination
const AUTO_UNSORTED_LABEL = 'UNSORTED'; // header shown above the leftover files (no move action offered)
const AUTO_PROPOSE_MIN = 5;   // a word must recur in this many unsorted files before we suggest a new group

/* Decorative-THEME categories describe what a model LOOKS like. They lose to any
   FORM-FACTOR category (what the object IS / is for) whenever both appear in a
   name — a form-factor match always wins, themes are only the fallback. So
   "Easter Bunny Bookmark" → BOOKMARKS, "Halloween Skull Keychain" → KEYCHAINS,
   "Star Wars Yoda Lamp" → LAMPS; but a pure "Easter Egg" still lands in EASTER
   because nothing functional competes. To retune, just move a category in or out
   of this set. */
const AUTO_THEME_CATEGORIES = new Set([
  'EASTER', 'HALLOWEEN', 'DRAGONS', 'POKEMON', 'STAR WARS – STAR TREK',
  'KIDS', 'GAG GIFTS', 'PETS', 'AUTOMOTIVE', 'ZODIAC', 'CHRISTMAS',
]);

/* Tokens that never make a good auto-detected group name — generic filler plus
   file-format words and their plurals (a pack named "Dragon STLs" must NOT
   suggest a group called "STLS"). */
const AUTO_STOPWORDS = new Set([
  // generic English / naming filler
  'the','and','for','with','from','this','that','your','final','fixed','repaired',
  'model','models','print','prints','printable','printables','file','files',
  'version','versions','copy','new','old','test','remix','remixed','sliced',
  'part','parts','piece','pieces','left','right','top','bottom','front','back',
  'center','centre','middle','side','upper','lower','inner','outer','half',
  'small','large','medium','mini','big','set','sets','pack','packs','bundle','kit',
  'kits','collection','assembly','assembled','multipart','multi','combined',
  // size / format / slicer noise
  'stl','stls','obj','objs','3mf','3mfs','gcode','gcodes','zip','zips','step',
  'steps','stp','stps','lys','chitubox','lychee','cure','presupported','presupport',
  'supported','support','supports','unsupported','solid','hollow','scaled',
  'lowpoly','highpoly','color','colour','colored','coloured','multicolor',
  'multicolour','mm','cm','inch','scale',
  // download-source / marketplace noise (Creality Cloud, MakerWorld, etc.)
  'creality','cloud','bambu','prusa','ender','makerworld','thingiverse',
  'printables','cults','thangs','download','downloaded','export','untitled','project',
]);

let autoCategories = [];        // working list (defaults + custom); unmatched files use the AUTO_REVIEW sentinel
let autoGroups = new Map();     // category -> [items]  (current sort result)
let autoSuppressed = new Set(); // lowercase tokens the user asked us never to suggest

/* ── Persistence ───────────────────────────────────────────────────────────── */
function autoLoadCategories() {
  let custom = [];
  try { custom = JSON.parse(localStorage.getItem(AUTO_LS_KEY) || '[]'); } catch (_) {}
  // Defaults first (keep their order), then any custom additions not already present.
  autoCategories = AUTO_DEFAULT_CATEGORIES.slice();
  for (const c of custom) {
    const name = (c.name || '').trim();
    if (name && !autoCategories.includes(name)) {
      autoCategories.push(name);
      AUTO_KEYWORD_RULES[name] = (c.keywords && c.keywords.length) ? c.keywords : [name.toLowerCase()];
    }
  }
}

function autoSaveCustomCategory(name, keywords) {
  let custom = [];
  try { custom = JSON.parse(localStorage.getItem(AUTO_LS_KEY) || '[]'); } catch (_) {}
  if (!custom.find(c => c.name === name)) {
    custom.push({ name, keywords });
    localStorage.setItem(AUTO_LS_KEY, JSON.stringify(custom));
  }
}

function autoLoadSuppressed() {
  try { autoSuppressed = new Set(JSON.parse(localStorage.getItem(AUTO_SUPPRESS_KEY) || '[]')); }
  catch (_) { autoSuppressed = new Set(); }
}

function autoAddSuppressed(token) {
  autoSuppressed.add(token);
  localStorage.setItem(AUTO_SUPPRESS_KEY, JSON.stringify([...autoSuppressed]));
}

/* ── Classification ────────────────────────────────────────────────────────── */
// Strip combining marks (accents). Note this also folds Cyrillic й→и and ї→і,
// so KEYWORDS must be folded the same way before matching (see autoClassify).
function autoFold(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// Strip extension + separators so "Dragon_Box_v2.stl" → "dragon box v2".
function autoNormalize(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // fold accents: dragón→dragon
    .replace(/[_\-.+()[\]{}]/g, ' ')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

const _autoReCache = new Map();
function autoWordRe(kw) {
  let re = _autoReCache.get(kw);
  if (!re) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Allow a trailing plural "s" so "bookmark" matches "bookmarks", etc.
    re = new RegExp('(^|[^a-z])' + esc + 's?($|[^a-z])', 'i');
    _autoReCache.set(kw, re);
  }
  return re;
}

// Best category for a file name. Returns _REVIEW when nothing scores.
function autoClassify(name) {
  const norm = autoNormalize(name);
  let formBest = AUTO_REVIEW, formScore = 0;   // form-factor / purpose categories
  let themeBest = null,       themeScore = 0;  // decorative-theme categories
  for (const cat of autoCategories) {
    if (cat === AUTO_REVIEW) continue;
    const kws = AUTO_KEYWORD_RULES[cat] || [];
    let score = 0;
    for (const kw of kws) {
      const fkw = autoFold(kw);   // fold so Cyrillic/accented keywords match the folded name
      if (autoWordRe(fkw).test(norm)) score += kw.length * 2;            // whole-word hit
      // Concatenated hit needs >=6 chars to avoid false positives like
      // "carro" (car) matching "CARROt" or "lampe" matching odd words.
      else if (fkw.length >= 6 && norm.includes(fkw)) score += kw.length;
    }
    if (score <= 0) continue;
    if (AUTO_THEME_CATEGORIES.has(cat)) {
      if (score > themeScore) { themeScore = score; themeBest = cat; }
    } else {
      if (score > formScore) { formScore = score; formBest = cat; }
    }
  }
  // Form-factor wins whenever it matched at all; theme is the fallback so a
  // purely decorative model still gets grouped instead of going to _REVIEW.
  if (formScore > 0) return formBest;
  if (themeBest) return themeBest;
  return AUTO_REVIEW;
}

/* ── New-group proposals (offline heuristic) ────────────────────────────────── */
// Look at the names that fell into _REVIEW; if a meaningful word recurs across
// several of them and isn't already a category keyword, suggest it as a group.
function autoProposeGroups(reviewItems) {
  const known = new Set();
  for (const cat of autoCategories) {
    for (const kw of (AUTO_KEYWORD_RULES[cat] || [])) {
      kw.split(' ').forEach(w => known.add(w));
    }
  }
  const freq = new Map();   // token -> Set(file names)
  for (const it of reviewItems) {
    const seen = new Set();
    for (const tok of autoNormalize(it.name).split(' ')) {
      // Words only: skip short tokens and anything with a digit (numbers, hashes,
      // dimension fragments like "10by", part suffixes like "01d") — a category
      // name is a real word, so these never make a sensible group suggestion.
      if (tok.length < 4 || /\d/.test(tok)) continue;
      if (AUTO_STOPWORDS.has(tok) || known.has(tok) || seen.has(tok)) continue;
      if (autoSuppressed.has(tok)) continue;   // user muted this suggestion
      seen.add(tok);
      if (!freq.has(tok)) freq.set(tok, new Set());
      freq.get(tok).add(it.name);
    }
  }
  return [...freq.entries()]
    .filter(([, names]) => names.size >= AUTO_PROPOSE_MIN)   // recurs in enough files
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3)                                    // at most 3 prompts per run
    .map(([tok, names]) => ({ token: tok, count: names.size }));
}

/* ── Themed "new group?" modal ─────────────────────────────────────────────── */
let _autoModalKey = null;
function autoCloseProposalModal() {
  if (_autoModalKey) { document.removeEventListener('keydown', _autoModalKey); _autoModalKey = null; }
  const o = document.getElementById('autoModalOverlay');
  if (o) o.remove();
}

// Resolves { add:bool, suppress:bool }. Replaces the native confirm() so we can
// theme it, say Yes/No, and offer a persistent "don't suggest again" checkbox.
function autoProposalModal(title, count) {
  return new Promise(resolve => {
    autoCloseProposalModal();
    const t = escapeHtml(title);
    const overlay = document.createElement('div');
    overlay.className = 'auto-modal-overlay';
    overlay.id = 'autoModalOverlay';
    overlay.innerHTML =
      `<div class="auto-modal" role="dialog" aria-modal="true">
         <div class="auto-modal-icon">+</div>
         <p class="auto-modal-text">AUTO found <b>${count} file${count !== 1 ? 's' : ''}</b> that look like &ldquo;<b>${t}</b>&rdquo;.</p>
         <p class="auto-modal-sub">Add &ldquo;<b>${t}</b>&rdquo; as a new group? It'll be remembered for next time.</p>
         <label class="auto-modal-check">
           <input type="checkbox" id="autoModalSuppress">
           <span>Don't suggest &ldquo;${t}&rdquo; again</span>
         </label>
         <div class="auto-modal-btns">
           <button class="auto-modal-btn auto-modal-no"  id="autoModalNo">No</button>
           <button class="auto-modal-btn auto-modal-yes" id="autoModalYes">Yes</button>
         </div>
       </div>`;
    document.body.appendChild(overlay);

    const cb = overlay.querySelector('#autoModalSuppress');
    const finish = (add) => { const suppress = cb.checked; autoCloseProposalModal(); resolve({ add, suppress }); };
    overlay.querySelector('#autoModalYes').addEventListener('click', () => finish(true));
    overlay.querySelector('#autoModalNo').addEventListener('click', () => finish(false));

    _autoModalKey = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    document.addEventListener('keydown', _autoModalKey);
    overlay.querySelector('#autoModalYes').focus();
  });
}

/* ── Move-collision resolver ────────────────────────────────────────────────
   Called by app.js execMoveFile when a destination file with the same name
   already exists. Returns { strategy: 'skip' | 'rename' | 'overwrite' }. A
   "Do this for all remaining" checkbox caches the choice for the rest of the
   batch (reset at the start of each group move). */
let _movePolicy = null;
let _autoConflictKey = null;
function autoResetMovePolicy() { _movePolicy = null; }
function autoCloseConflictModal() {
  if (_autoConflictKey) { document.removeEventListener('keydown', _autoConflictKey); _autoConflictKey = null; }
  const o = document.getElementById('autoConflictOverlay');
  if (o) o.remove();
}
function autoResolveMoveConflict(name) {
  if (_movePolicy) return Promise.resolve({ strategy: _movePolicy });
  return new Promise(resolve => {
    autoCloseConflictModal();
    const t = escapeHtml(name);
    const overlay = document.createElement('div');
    overlay.className = 'auto-modal-overlay';
    overlay.id = 'autoConflictOverlay';
    overlay.innerHTML =
      `<div class="auto-modal" role="dialog" aria-modal="true">
         <div class="auto-modal-icon auto-modal-icon-warn">!</div>
         <p class="auto-modal-text">&ldquo;<b>${t}</b>&rdquo; already exists in the destination folder.</p>
         <p class="auto-modal-sub">How should it be handled?</p>
         <label class="auto-modal-check">
           <input type="checkbox" id="autoConflictAll"><span>Do this for all remaining</span>
         </label>
         <div class="auto-modal-btns auto-modal-btns-3">
           <button class="auto-modal-btn auto-modal-no"   id="acfSkip">Skip</button>
           <button class="auto-modal-btn auto-modal-yes"  id="acfKeep">Keep both</button>
           <button class="auto-modal-btn auto-modal-over" id="acfOver">Overwrite</button>
         </div>
       </div>`;
    document.body.appendChild(overlay);

    const all = overlay.querySelector('#autoConflictAll');
    const finish = (strategy) => {
      if (all.checked) _movePolicy = strategy;
      autoCloseConflictModal();
      resolve({ strategy });
    };
    overlay.querySelector('#acfSkip').addEventListener('click', () => finish('skip'));
    overlay.querySelector('#acfKeep').addEventListener('click', () => finish('rename'));
    overlay.querySelector('#acfOver').addEventListener('click', () => finish('overwrite'));
    _autoConflictKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish('skip'); } };
    document.addEventListener('keydown', _autoConflictKey);
    overlay.querySelector('#acfKeep').focus();
  });
}

/* ── Run AUTO ──────────────────────────────────────────────────────────────── */
async function runAutoSort() {
  if (!rootDirPath && !rootDirHandle) {
    autoSetChecked(false);
    alert('Open a folder first, then turn on AUTO sort.');
    return;
  }
  if (!allFiles.length) {
    autoSetChecked(false);
    alert('No supported files in this folder to sort.');
    return;
  }

  autoLoadCategories();
  autoLoadSuppressed();

  // 1) First pass — classify everything.
  let groups = autoBuildGroups();

  // 2) Offer new groups for anything that landed in _REVIEW.
  const proposals = autoProposeGroups(groups.get(AUTO_REVIEW) || []);
  let added = false;
  for (const p of proposals) {
    const title = p.token.toUpperCase();
    if (autoCategories.includes(title)) continue;
    const { add, suppress } = await autoProposalModal(title, p.count);
    if (suppress) autoAddSuppressed(p.token);   // never suggest this token again
    if (add) {
      autoCategories.push(title);
      AUTO_KEYWORD_RULES[title] = [p.token];
      autoSaveCustomCategory(title, [p.token]);
      added = true;
    }
  }
  if (added) groups = autoBuildGroups();   // reclassify so new groups pick up files

  autoGroups = groups;
  autoRenderGroups();

  // 3) Sort is complete — deselect AUTO (per spec). Grouped view stays so the
  //    user can hit "MOVE ALL" on each group.
  autoSetChecked(false);
}

// Classify allFiles into an ordered Map (only non-empty groups; _REVIEW last).
function autoBuildGroups() {
  const map = new Map();
  for (const item of allFiles) {
    const cat = autoClassify(item.name);
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(item);
  }
  // Order: categories in list order first, then _REVIEW at the very end.
  const ordered = new Map();
  for (const cat of autoCategories) {
    if (cat !== AUTO_REVIEW && map.has(cat)) ordered.set(cat, map.get(cat));
  }
  if (map.has(AUTO_REVIEW)) ordered.set(AUTO_REVIEW, map.get(AUTO_REVIEW));
  return ordered;
}

/* ── Grouped render ────────────────────────────────────────────────────────── */
function autoRenderGroups() {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  list.dataset.rendered = '0';

  const fileTotal = [...autoGroups.values()].reduce((n, a) => n + a.length, 0);
  const groupTotal = autoGroups.size;

  const wrap = document.createElement('div');
  wrap.className = 'auto-groups';

  const bar = document.createElement('div');
  bar.className = 'auto-toolbar';
  bar.innerHTML = `<span>AUTO · ${fileTotal} file${fileTotal !== 1 ? 's' : ''} in ${groupTotal} group${groupTotal !== 1 ? 's' : ''}</span>`;
  const flatBtn = document.createElement('button');
  flatBtn.className = 'auto-flat-btn';
  flatBtn.textContent = '↩ Flat list';
  flatBtn.title = 'Exit AUTO view and show the plain file list';
  flatBtn.addEventListener('click', autoExitView);
  bar.appendChild(flatBtn);
  wrap.appendChild(bar);

  for (const [cat, items] of autoGroups) {
    const isUnsorted = (cat === AUTO_REVIEW);
    const sec = document.createElement('div');
    sec.className = 'auto-group' + (isUnsorted ? ' auto-group-unsorted' : '');
    sec.dataset.cat = cat;

    const head = document.createElement('div');
    head.className = 'auto-group-head';
    head.innerHTML =
      `<span class="auto-group-name">${escapeHtml(isUnsorted ? AUTO_UNSORTED_LABEL : cat)}</span>` +
      `<span class="auto-group-count">${items.length}</span>`;
    sec.appendChild(head);

    const filesWrap = document.createElement('div');
    filesWrap.className = 'auto-group-files';
    for (const item of items) filesWrap.appendChild(buildFileRow(item));
    sec.appendChild(filesWrap);

    // Files that matched no group just sit here at the end of the list — no
    // "move all" / "move to other folder" is offered for them (they aren't a
    // real category). Only real groups get a move footer.
    if (!isUnsorted) {
      const foot = document.createElement('div');
      foot.className = 'auto-group-foot';
      const moveBtn = document.createElement('button');
      moveBtn.className = 'auto-move-all';
      moveBtn.innerHTML = `📁 MOVE ALL INTO ${escapeHtml(cat)}`;
      moveBtn.addEventListener('click', () => autoMoveGroup(cat, cat, moveBtn));
      foot.appendChild(moveBtn);

      // Secondary: redirect this whole group to a different (or brand-new) folder.
      const otherBtn = document.createElement('button');
      otherBtn.className = 'auto-move-other';
      otherBtn.innerHTML = '↪ Move all to other folder…';
      otherBtn.title = 'Move this group into a different category, or add a new one (saved for next time)';
      otherBtn.addEventListener('click', e => { e.stopPropagation(); autoOpenMovePicker(cat, otherBtn); });
      foot.appendChild(otherBtn);

      sec.appendChild(foot);
    }

    wrap.appendChild(sec);
  }

  list.appendChild(wrap);
}

/* ── Move-all for one group ────────────────────────────────────────────────── */
async function autoEnsureFolder(name) {
  let f = knownSubfolders.find(s => s.name === name);
  if (f) return f;
  let handle = null;
  if (rootDirPath && window.electronAPI?.createDir) {
    await window.electronAPI.createDir(rootDirPath + '\\' + name);
    handle = { name };                                  // Electron uses paths
  } else if (rootDirHandle) {
    handle = await rootDirHandle.getDirectoryHandle(name, { create: true });
  }
  f = { name, handle };
  knownSubfolders.push(f);
  knownSubfolders.sort((a, b) => a.name.localeCompare(b.name));
  return f;
}

// Move every file in `sourceCat` into the folder `targetCat` (same name = the
// group's own folder; different = a redirect chosen from the picker).
async function autoMoveGroup(sourceCat, targetCat, btn) {
  const items = (autoGroups.get(sourceCat) || []).slice();
  if (!items.length) return;
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Moving…';
  autoResetMovePolicy();                 // fresh "apply to all" choice for this batch
  try {
    const folder = await autoEnsureFolder(targetCat);
    for (const item of items) {
      // execMoveFile (app.js) moves the file; the wrapped refreshFileRow →
      // autoOnItemRemoved updates this group's count and removes the section when
      // it empties. A skipped collision leaves the file (and its row) in place.
      await execMoveFile(item, folder.handle, folder.name);
    }
  } catch (err) {
    alert('Move failed: ' + (err && err.message || err));
  }
  autoResetMovePolicy();
  // If everything moved the group is already gone; if some were skipped it
  // remains, so restore the button so the user can act again.
  if (autoGroups.has(sourceCat)) {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
  autoUpdateToolbar();
}

/* ── "Move to other folder…" picker (per group) ────────────────────────────── */
function autoMovePickerOutside(e) {
  const m = document.getElementById('autoMovePicker');
  if (m && !m.contains(e.target)) autoCloseMovePicker();
}
function autoCloseMovePicker() {
  document.removeEventListener('mousedown', autoMovePickerOutside, true);
  const m = document.getElementById('autoMovePicker');
  if (m) m.remove();
}

function autoOpenMovePicker(sourceCat, anchorBtn) {
  autoCloseMovePicker();
  const count = (autoGroups.get(sourceCat) || []).length;

  const menu = document.createElement('div');
  menu.id = 'autoMovePicker';
  menu.className = 'auto-move-picker';
  menu.innerHTML =
    `<div class="amp-head">Move ${count} file${count !== 1 ? 's' : ''} to…</div>` +
    `<div class="amp-list"></div>` +
    `<div class="amp-add">` +
      `<input class="amp-input" id="ampInput" placeholder="+ New category" spellcheck="false" maxlength="40">` +
      `<button class="amp-add-btn" id="ampAddBtn" title="Add category & move">✓</button>` +
    `</div>`;

  // Category list: every real category except the group's own folder.
  // (The unsorted sentinel is never a destination, so it's excluded.)
  const listEl = menu.querySelector('.amp-list');
  const sorted = autoCategories
    .filter(c => c !== sourceCat && c !== AUTO_REVIEW)
    .sort((a, b) => a.localeCompare(b));
  for (const c of sorted) {
    const row = document.createElement('button');
    row.className = 'amp-item';
    row.textContent = c;
    row.addEventListener('click', () => { autoCloseMovePicker(); autoMoveGroup(sourceCat, c, anchorBtn); });
    listEl.appendChild(row);
  }

  document.body.appendChild(menu);

  // Position the popover near the button, flipping above/below to stay onscreen.
  const r = anchorBtn.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let top  = r.top - mh - 6;
  if (top < 6) top = Math.min(r.bottom + 6, window.innerHeight - mh - 6);
  let left = Math.min(r.left, window.innerWidth - mw - 6);
  if (left < 6) left = 6;
  menu.style.left = left + 'px';
  menu.style.top  = top + 'px';

  // Add-new-category → persist, then move the group there.
  const inp = menu.querySelector('#ampInput');
  const addNew = () => {
    let name = inp.value.trim().toUpperCase();   // match the all-caps list style
    if (!name) return;
    if (!autoCategories.includes(name)) {
      autoCategories.push(name);
      AUTO_KEYWORD_RULES[name] = [name.toLowerCase()];
      autoSaveCustomCategory(name, [name.toLowerCase()]);
    }
    autoCloseMovePicker();
    autoMoveGroup(sourceCat, name, anchorBtn);
  };
  menu.querySelector('#ampAddBtn').addEventListener('click', addNew);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); addNew(); }
    else if (e.key === 'Escape') { autoCloseMovePicker(); }
  });
  // Close only on a real outside click (mousedown + contains check) so typing
  // and clicks inside the popover never dismiss it or steal focus.
  setTimeout(() => document.addEventListener('mousedown', autoMovePickerOutside, true), 0);
  inp.focus();
}

function autoUpdateToolbar() {
  const span = document.querySelector('.auto-toolbar span');
  if (!span) return;
  const fileTotal = [...autoGroups.values()].reduce((n, a) => n + a.length, 0);
  const groupTotal = autoGroups.size;
  if (!groupTotal) {
    autoExitView();
    return;
  }
  span.textContent = `AUTO · ${fileTotal} file${fileTotal !== 1 ? 's' : ''} in ${groupTotal} group${groupTotal !== 1 ? 's' : ''}`;
}

/* ── Re-sort within groups when the Sort-by control changes ───────────────────
   Called by app.js applySort(). Returns true if the AUTO grouped view was showing
   (so app.js skips its flat re-render), false otherwise. */
function autoApplySort(cmp) {
  if (!autoGroups.size) return false;
  for (const items of autoGroups.values()) items.sort(cmp);
  autoRenderGroups();
  return true;
}

/* ── Keep the grouped view in sync when a single file leaves a group ──────────
   Drag-to-folder, drag-to-trash, the right-click menu, and bulk move/delete all
   funnel through app.js's refreshFileRow(item) to drop a row. We wrap it so that
   in AUTO view the file's group updates its count, and removes itself when empty. */
function autoOnItemRemoved(item) {
  if (!autoGroups.size) return;
  for (const [cat, items] of autoGroups) {
    const idx = items.indexOf(item);
    if (idx === -1) continue;
    items.splice(idx, 1);
    const sec = document.querySelector(`.auto-group[data-cat="${CSS.escape(cat)}"]`);
    if (!items.length) {
      autoGroups.delete(cat);
      if (sec) sec.remove();
    } else if (sec) {
      const countEl = sec.querySelector('.auto-group-count');
      if (countEl) countEl.textContent = items.length;
    }
    break;
  }
  autoUpdateToolbar();
}

if (typeof refreshFileRow === 'function' && !refreshFileRow._autoWrapped) {
  const _origRefreshFileRow = refreshFileRow;
  refreshFileRow = function (item, oldPath) {
    _origRefreshFileRow(item, oldPath);
    try { autoOnItemRemoved(item); } catch (_) { /* never block a move/delete */ }
  };
  refreshFileRow._autoWrapped = true;
}

/* ── Exit AUTO view → restore the plain flat list ──────────────────────────── */
function autoExitView() {
  autoGroups = new Map();
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  if (!allFiles.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><p>No files left in this folder.</p></div>';
  } else {
    for (const item of allFiles) {
      list.appendChild(buildFileRow(item));
      if (item.ext === 'zip' && item.zipContents?.length && typeof injectZipChildren === 'function') {
        injectZipChildren(item);
      }
    }
  }
  document.getElementById('fileCount').textContent = allFiles.length + ' files';
}

/* ── Checkbox wiring ───────────────────────────────────────────────────────── */
function autoSetChecked(v) {
  const cb = document.getElementById('autoSortToggle');
  if (cb) cb.checked = v;
}

document.addEventListener('DOMContentLoaded', () => {
  const cb = document.getElementById('autoSortToggle');
  if (!cb) return;
  cb.addEventListener('change', () => {
    if (cb.checked) runAutoSort();
    else autoExitView();
  });
});
