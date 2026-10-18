import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { execSync } from 'child_process';

/**
 * Generates a complete, standalone offline HTML bundle for assets/index.html inside the APK
 */
function buildStandaloneReaderHtml() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<title>Интерактивная Читалка</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #F8F6F1; color: #1C1B1F;
    user-select: none; -webkit-user-select: none;
    overflow-x: hidden;
  }
  .app-shell { display: flex; flex-direction: column; min-height: 100vh; }
  .top-bar {
    position: sticky; top: 0; z-index: 30;
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; background: #1E293B; color: #FFFFFF;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .top-bar h1 { margin: 0; font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .btn {
    border: none; border-radius: 12px; padding: 12px 16px;
    font-size: 14px; font-weight: 600; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    transition: opacity 0.15s, transform 0.1s;
  }
  .btn:active { transform: scale(0.98); }
  .btn-primary { background: #1E293B; color: #FFFFFF; }
  .btn-emerald { background: #15803D; color: #FFFFFF; }
  .btn-amber { background: #B45309; color: #FFFFFF; }
  .btn-outline { background: transparent; border: 1.5px solid #CBD5E1; color: #1E293B; }
  .btn:disabled { opacity: 0.4; pointer-events: none; }
  .container { padding: 16px; flex: 1; max-width: 720px; margin: 0 auto; width: 100%; }
  .card {
    background: #FFFFFF; border-radius: 16px; padding: 18px;
    border: 1px solid #E5E0D5; margin-bottom: 14px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .book-header { background: #162032; color: #FEF3C7; border-radius: 16px; padding: 20px; margin-bottom: 18px; }
  .book-header h2 { margin: 0 0 6px 0; font-size: 22px; font-family: Georgia, serif; }
  .book-header p { margin: 0; font-size: 13px; color: #FDE68A; opacity: 0.9; line-height: 1.45; }
  .progress-track { width: 100%; height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; overflow: hidden; margin-top: 10px; }
  .progress-fill { height: 100%; background: #F59E0B; transition: width 0.3s; }
  .chapter-card { display: flex; flex-direction: column; gap: 10px; }
  .chapter-locked { opacity: 0.6; background: #F1EFEA; }
  .meta-line { font-size: 12px; color: #64748B; font-family: monospace; }
  .reader-screen {
    position: fixed; inset: 0; z-index: 40;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .reader-hud-top {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid rgba(128,128,128,0.2);
  }
  .reader-page-area {
    flex: 1; padding: 20px 22px; display: flex; flex-direction: column; justify-content: space-between;
    overflow: hidden;
  }
  .reader-text {
    font-family: Georgia, "Times New Roman", serif;
    white-space: pre-line; line-height: 1.55;
    flex: 1; overflow: hidden;
  }
  .reader-footer {
    padding-top: 12px; border-top: 1px solid rgba(128,128,128,0.2);
    display: flex; align-items: center; justify-content: space-between; min-height: 52px;
  }
  .settings-sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
    border-radius: 20px 20px 0 0; padding: 20px;
    box-shadow: 0 -8px 24px rgba(0,0,0,0.25);
    border-top: 1px solid rgba(128,128,128,0.25);
  }
  .option-btn {
    width: 100%; text-align: left; padding: 14px 16px; border-radius: 12px;
    border: 2px solid #E2E8F0; background: #F8FAFC; color: #0F172A;
    font-size: 15px; margin-bottom: 10px; display: flex; align-items: center; gap: 12px;
  }
  .option-selected { border-color: #1E293B; background: #EFF6FF; font-weight: 600; }
  .option-correct { border-color: #15803D; background: #DCFCE7; color: #14532D; font-weight: 600; }
  .option-wrong { border-color: #B91C1C; background: #FEE2E2; color: #7F1D1D; }
  .explanation-box {
    background: #FFFBEB; border: 1px solid #FDE68A; color: #78350F;
    padding: 14px; border-radius: 12px; font-size: 14px; line-height: 1.45; margin-top: 12px;
  }
</style>
</head>
<body>
<div id="app" class="app-shell"></div>
<script>
const CHAPTERS = [
  {
    id: 1, index: 0,
    title: "Глава 1. Скандал в Богемии",
    subtitle: "История Ирен Адлер и короля Богемии",
    content: \`Для Шерлока Холмса она всегда оставалась «Той самой женщиной». Я редко слышал, чтобы он называл её каким-либо другим именем. В его глазах она затмевала всех представительниц своего пола. Не то чтобы он испытывал к Ирен Адлер какое-то чувство, близкое к любви. Все эмоции, и особенно эта, были чужды его холодному, точному, но удивительно уравновешенному уму. Он был, на мой взгляд, совершеннейшей мыслящей и наблюдающей машиной, какую когда-либо видел мир, но в роли влюбленного он оказался бы не на своем месте. И тем не менее для него существовала только одна женщина, и этой женщиной была покойная Ирен Адлер, особа весьма сомнительной и двусмысленной репутации.

Однажды вечером двадцать первого марта тысяча восемьсот восемьдесят восьмого года я возвращался от пациента (к тому времени я снова занялся врачебной практикой), и мой путь пролегал через Бейкер-стрит. Проходя мимо знакомой двери, которая навсегда останется связанной в моей памяти с временем моего сватовства и с мрачными событиями «Этюда в багровых тонах», я почувствовал острое желание повидать Холмса и узнать, как он применяет свои необыкновенные способности. В его комнатах горел яркий свет, и, подняв глаза, я увидел его высокую, худощавую фигуру, дважды мелькнувшую темным силуэтом на фоне спущенной шторы.

В тот же вечер к нам явился таинственный посетитель в маске, назвавшийся графом фон Краммом, но Холмс в первые же минуты разоблачил в нем Вильгельма Готтсрейха Сигизмунда фон Ормштейна, наследного короля Богемии. Король собирался вступить в брак со скандинавской принцессой Клотильдой, однако пять лет назад в Варшаве он был близко знаком с американской оперной певицей Ирен Адлер. У Ирен осталась их совместная фотография кабинетного формата. Она пригрозила отправить этот снимок семье невесты в день официального объявления о помолвке.

На следующее утро Шерлок Холмс отправился к дому Ирен Адлер в Брайриони-Лодж в облике безработного конюха. Завязав разговор со слугами у конюшни, он выяснил, что к мисс Адлер ежедневно наведывается адвокат Годфри Нортон. Вскоре Нортон и Ирен стремительно уехали в кэбе к церкви Святой Моники. Поспешив за ними, Холмс оказался в храме в тот самый момент, когда священнику не хватало одного свидетеля для законного оформления брака. Так переодетый сыщик стал шафером на тайном венчании Ирен Адлер и Годфри Нортона.

Вечером того же дня при помощи доктора Ватсона Холмс разыграл блестящий спектакль. Переодевшись добродушным пожилым священником, он спровоцировал у порога дома Ирен Адлер потасовку. Добросердечная хозяйка велела внести «раненого пастора» в гостиную. По условному сигналу Холмса Ватсон бросил в открытое окно специальную дымовую ракету и закричал: «Пожар!». Ворвавшиеся в комнату клубы дыма заставили Ирен инстинктивно броситься к потайному стенному шкафчику, где она хранила самую ценную вещь — ту самую фотографию.

Однако, когда Холмс, Ватсон и король Богемии прибыли в Брайриони-Лодж на следующее утро, дом оказался пуст. Ирен Адлер и её муж покинули Англию. В тайнике вместо компрометирующего двойного снимка лежала фотография самой Ирен в вечернем платье и письмо Шерлоку Холмсу. Она пообещала королю никогда не использовать старую фотографию против него. В знак глубочайшего восхищения умом этой женщины Холмс попросил у короля лишь один подарок — оставленный портрет Ирен Адлер.\`,
    questions: [
      {
        q: "Как Шерлок Холмс называл Ирен Адлер в разговорах с доктором Ватсоном?",
        opts: ["Королева Богемии", "Та самая женщина (Эта женщина)", "Леди из Нью-Джерси", "Тайная графиня"],
        correct: 1,
        exp: "Для Шерлока Холмса Ирен Адлер навсегда осталась «Той самой женщиной» («The Woman»), сумевшей перехитрить его."
      },
      {
        q: "Какую хитрость использовал Холмс, чтобы узнать, где Ирен Адлер прячет фотографию?",
        opts: ["Подкупил горничную", "Взломал сейф ночью", "Инсценировал драку и пожар с дымовой ракетой", "Прислал письмо от короля"],
        correct: 2,
        exp: "При крике «Пожар!» и появлении дыма Ирен инстинктивно бросилась спасать тайник с фотографией."
      },
      {
        q: "Что Холмс попросил у короля Богемии в качестве награды?",
        opts: ["Изумрудный перстень", "Тысячу фунтов золотом", "Фотографию Ирен Адлер в вечернем платье", "Золотую табакерку"],
        correct: 2,
        exp: "Отказавшись от изумрудного перстня, Холмс попросил лишь портрет Ирен Адлер."
      }
    ]
  },
  {
    id: 2, index: 1,
    title: "Глава 2. Союз рыжих",
    subtitle: "Тайна переписывания «Британской энциклопедии»",
    content: \`В погожий осенний день прошлого года я зашел навестить моего друга мистера Шерлока Холмса и застал его в глубокой беседе с весьма полным пожилым джентльменом с огненно-рыжими волосами — мистером Джабезом Уилсоном.

Джабез Уилсон содержал небольшую ссудную кассу на Сакс-Кобург-сквер. Несколько месяцев назад он нанял молодого помощника Винсента Сполдинга, который согласился работать за половину жалованья и постоянно спускался в подвал проявлять фотографии. Именно Сполдинг показал хозяину объявление об открытии вакансии в «Союзе рыжих» с окладом четыре фунта стерлингов в неделю.

Условия были удивительными: Уилсон должен был ежедневно находиться в конторе с десяти утра до двух часов дня, не покидая помещения, и переписывать от руки статьи из «Британской энциклопедии», начиная с буквы «А». На протяжении восьми недель ростовщик исправно переписывал статьи, пока однажды не обнаружил на двери табличку: «Союз рыжих распущен».

Отправившись на Сакс-Кобург-сквер, Холмс постучал тростью по мостовой перед лавкой, затем позвонил в дверь ссудной кассы, чтобы взглянуть на колени брюк помощника Сполдинга — они были вытянутыми и испачканными землей. Прямо за домом Уилсона располагалось хранилище Городского и Пригородного банка.

«Союз рыжих» оказался выдумкой преступника Джона Клея (Сполдинга), созданной с единственной целью — на четыре часа каждый день удалять хозяина из ссудной кассы, пока из подвала прорывался подземный ход к тридцати тысячам золотых наполеондоров в хранилище банка. Ночью Холмс, Ватсон и полиция устроили засаду в подземелье банка и схватили Джона Клея с поличным.\`,
    questions: [
      {
        q: "Какую работу выполнял Джабез Уилсон в конторе «Союза рыжих»?",
        opts: ["Сортировал векселя", "Переписывал от руки «Британскую энциклопедию»", "Составлял каталог рыжеволосых", "Переводил газеты"],
        correct: 1,
        exp: "Уилсону поручили переписывать «Британскую энциклопедию», чтобы удерживать его вне ссудной кассы по 4 часа в день."
      },
      {
        q: "Какая деталь во внешности помощника убедила Холмса в том, что роется подкоп?",
        opts: ["Глина на манжетах", "Мозоли на ладонях", "Вытянутые и испачканные на коленях брюки", "Угольная пыль"],
        correct: 2,
        exp: "Холмс специально посмотрел на колени брюк Сполдинга — они были измяты и испачканы землей."
      },
      {
        q: "Что было главной целью преступника Джона Клея?",
        opts: ["Ограбление хранилища банка с французским золотом", "Похищение бриллиантов Уилсона", "Побег из тюрьмы", "Печать банкнот"],
        correct: 0,
        exp: "Подвал лавки граничил с хранилищем банка, где хранились 30 000 золотых наполеондоров."
      }
    ]
  }
];

const THEMES = {
  LIGHT: { name: "Светлая", bg: "#FAF9F6", fg: "#1C1B1F", surface: "#EFECE6" },
  SEPIA: { name: "Сепия", bg: "#F4ECD8", fg: "#3E3023", surface: "#E6DBC2" },
  NIGHT: { name: "Ночная", bg: "#141518", fg: "#D8DAE0", surface: "#202227" }
};

let state = {
  screen: "library",
  chapterId: 1,
  pageIndex: 0,
  charOffset: 0,
  controlsVisible: true,
  settingsOpen: false,
  fontSize: 18,
  theme: "LIGHT",
  qIndex: 0,
  selectedOpt: null,
  submitted: false,
  correctCount: 0,
  quizDone: false,
  progress: {
    1: { status: "AVAILABLE", offset: 0, bestScore: 0 },
    2: { status: "LOCKED", offset: 0, bestScore: 0 }
  }
};

try {
  const saved = localStorage.getItem("ir_apk_state_v1");
  if (saved) state = Object.assign(state, JSON.parse(saved));
} catch (e) {}

function saveState() {
  try { localStorage.setItem("ir_apk_state_v1", JSON.stringify(state)); } catch (e) {}
}

function paginate(text, fontSize) {
  const w = Math.max(280, window.innerWidth - 44);
  const h = Math.max(260, window.innerHeight - 190);
  const charsPerLine = Math.max(22, Math.floor(w / (fontSize * 0.55)));
  const maxLines = Math.max(5, Math.floor(h / (fontSize * 1.55)));
  const pages = [];
  let pos = 0;
  while (pos < text.length) {
    while (pos < text.length && (text[pos] === ' ' || text[pos] === '\\n')) pos++;
    if (pos >= text.length) break;
    let cur = pos, lines = 0;
    while (cur < text.length && lines < maxLines) {
      const nl = text.indexOf('\\n', cur);
      const maxEnd = Math.min(cur + charsPerLine, text.length);
      if (nl !== -1 && nl <= maxEnd) {
        cur = nl + 1; lines += 1.3;
      } else {
        let cut = maxEnd;
        if (cut < text.length && !/\\s/.test(text[cut - 1]) && !/\\s/.test(text[cut])) {
          let b = cut - 1;
          while (b > cur && !/\\s/.test(text[b])) b--;
          if (b > cur) cut = b + 1;
        }
        cur = cut; lines += 1;
      }
    }
    const end = Math.max(pos + 1, Math.min(cur, text.length));
    pages.push({ start: pos, end: end, text: text.slice(pos, end).trimEnd() });
    pos = end;
  }
  return pages.length ? pages : [{ start: 0, end: text.length, text }];
}

function render() {
  saveState();
  const root = document.getElementById("app");
  const ch = CHAPTERS.find(c => c.id === state.chapterId) || CHAPTERS[0];

  if (state.screen === "library") {
    const passedCount = Object.values(state.progress).filter(p => p.status === "PASSED").length;
    const ratio = Math.round((passedCount / CHAPTERS.length) * 100);
    root.innerHTML = \`
      <div class="top-bar"><h1>Интерактивная Читалка</h1></div>
      <div class="container">
        <div class="book-header">
          <div style="font-size:11px;letter-spacing:1px;margin-bottom:6px;opacity:0.8">АРТУР КОНАН ДОЙЛ</div>
          <h2>Приключения Шерлока Холмса</h2>
          <p>Офлайн-издание с проверочными тестами. Для открытия следующей главы наберите не менее 75% в тесте.</p>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:14px;font-weight:600">
            <span>Прогресс книги</span><span>\${passedCount} / \${CHAPTERS.length} глав (\${ratio}%)</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:\${ratio}%"></div></div>
        </div>
        \${CHAPTERS.map(c => {
          const p = state.progress[c.id];
          const locked = p.status === "LOCKED";
          const passed = p.status === "PASSED";
          return \`
            <div class="card chapter-card \${locked ? 'chapter-locked' : ''}">
              <div class="meta-line">
                \${passed ? 'Пройдено · Лучший тест: ' + p.bestScore + '%' : locked ? 'Заблокировано (нужно ≥ 75% в Главе 1)' : 'Доступно для чтения'}
              </div>
              <div style="font-size:18px;font-weight:700;font-family:Georgia,serif">\${c.title}</div>
              <div style="font-size:13px;color:#475569">\${c.subtitle}</div>
              <div style="display:flex;gap:8px;margin-top:6px">
                <button class="btn btn-primary" style="flex:1" \${locked ? 'disabled' : ''} onclick="openChapter(\${c.id})">
                  \${locked ? 'Заблокировано' : p.offset > 0 ? 'Продолжить чтение' : 'Читать главу'}
                </button>
                \${!locked ? \`<button class="btn btn-outline" onclick="startQuiz(\${c.id})">Тест</button>\` : ''}
              </div>
            </div>
          \`;
        }).join('')}
      </div>
    \`;
  } else if (state.screen === "reader") {
    const pages = paginate(ch.content, state.fontSize);
    let idx = pages.findIndex(p => state.charOffset >= p.start && state.charOffset < p.end);
    if (idx === -1) idx = Math.min(state.pageIndex, pages.length - 1);
    state.pageIndex = Math.max(0, idx);
    const page = pages[state.pageIndex];
    const t = THEMES[state.theme];
    const isLast = state.pageIndex === pages.length - 1;

    root.innerHTML = \`
      <div class="reader-screen" style="background:\${t.bg};color:\${t.fg}">
        \${state.controlsVisible ? \`
          <div class="reader-hud-top" style="background:\${t.surface}">
            <button class="btn btn-outline" style="padding:8px 12px;color:\${t.fg}" onclick="goLibrary()">← Книга</button>
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%">\${ch.title}</div>
            <button class="btn btn-outline" style="padding:8px 12px;color:\${t.fg}" onclick="toggleSettings()">Аа</button>
          </div>
        \` : '<div style="height:12px"></div>'}
        <div class="reader-page-area" onclick="handleReaderTap(event, \${pages.length})">
          <div class="reader-text" style="font-size:\${state.fontSize}px">\${page.text}</div>
          <div class="reader-footer" onclick="event.stopPropagation()">
            <span style="font-size:12px;opacity:0.75;font-family:monospace">Стр. \${state.pageIndex + 1} из \${pages.length}</span>
            \${isLast ? \`<button class="btn btn-amber" onclick="startQuiz(\${ch.id})">Пройти тест →</button>\` : ''}
          </div>
        </div>
        \${state.settingsOpen ? \`
          <div class="settings-sheet" style="background:\${t.surface};color:\${t.fg}" onclick="event.stopPropagation()">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
              <strong>Настройки чтения</strong>
              <button class="btn btn-outline" style="padding:6px 12px;color:\${t.fg}" onclick="toggleSettings()">Готово</button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
              <span>Размер шрифта: <b>\${state.fontSize} sp</b></span>
              <div style="display:flex;gap:8px">
                <button class="btn btn-outline" style="color:\${t.fg}" onclick="changeFont(-2)">А-</button>
                <button class="btn btn-outline" style="color:\${t.fg}" onclick="changeFont(2)">А+</button>
              </div>
            </div>
            <div style="display:flex;gap:8px">
              \${Object.keys(THEMES).map(k => \`
                <button class="btn" style="flex:1;background:\${THEMES[k].bg};color:\${THEMES[k].fg};border:2px solid \${state.theme === k ? '#B45309' : '#94A3B8'}" onclick="setTheme('\${k}')">\${THEMES[k].name}</button>
              \`).join('')}
            </div>
          </div>
        \` : ''}
      </div>
    \`;
  } else if (state.screen === "quiz") {
    if (!state.quizDone) {
      const q = ch.questions[state.qIndex];
      root.innerHTML = \`
        <div class="top-bar">
          <button class="btn" style="background:transparent;color:#FFF;padding:4px 8px" onclick="openChapter(\${ch.id})">← К главе</button>
          <h1>Вопрос \${state.qIndex + 1} из \${ch.questions.length}</h1>
          <span style="font-size:12px">Верно: \${state.correctCount}</span>
        </div>
        <div class="container">
          <div class="card">
            <div style="font-size:18px;font-weight:700;margin-bottom:16px;line-height:1.35">\${q.q}</div>
            \${q.opts.map((opt, i) => {
              let cls = "option-btn";
              if (state.submitted) {
                if (i === q.correct) cls += " option-correct";
                else if (i === state.selectedOpt) cls += " option-wrong";
              } else if (i === state.selectedOpt) {
                cls += " option-selected";
              }
              return \`<button class="\${cls}" onclick="selectOpt(\${i})"><span><b>\${String.fromCharCode(65+i)}.</b> \${opt}</span></button>\`;
            }).join('')}
            \${state.submitted ? \`<div class="explanation-box"><b>Пояснение:</b> \${q.exp}</div>\` : ''}
            <div style="margin-top:16px">
              \${!state.submitted
                ? \`<button class="btn btn-primary" style="width:100%" \${state.selectedOpt === null ? 'disabled' : ''} onclick="submitAns()">Проверить ответ</button>\`
                : \`<button class="btn btn-primary" style="width:100%" onclick="nextQ()">\${state.qIndex + 1 < ch.questions.length ? 'Следующий вопрос →' : 'Завершить тест'}</button>\`
              }
            </div>
          </div>
        </div>
      \`;
    } else {
      const score = Math.round((state.correctCount / ch.questions.length) * 100);
      const passed = score >= 75;
      const nextCh = CHAPTERS.find(c => c.index === ch.index + 1);
      root.innerHTML = \`
        <div class="top-bar"><h1>Результат теста</h1></div>
        <div class="container">
          <div class="card" style="text-align:center;padding:28px 18px">
            <div style="font-size:48px;font-weight:800;color:\${passed ? '#15803D' : '#B91C1C'}">\${score}%</div>
            <h2 style="margin:8px 0">\${passed ? 'Глава успешно пройдена!' : 'Тест не пройден'}</h2>
            <p style="color:#475569;font-size:14px;line-height:1.5">
              Правильных ответов: \${state.correctCount} из \${ch.questions.length}.
              \${passed ? (nextCh ? 'Следующая глава разблокирована!' : 'Все главы книги пройдены!') : 'Для открытия следующей главы нужно набрать минимум 75%.'}
            </p>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:20px">
              \${passed && nextCh ? \`<button class="btn btn-emerald" onclick="openChapter(\${nextCh.id})">Следующая глава →</button>\` : ''}
              <button class="btn btn-primary" onclick="openChapter(\${ch.id})">\${passed ? 'Вернуться к главе' : 'Перечитать главу'}</button>
              <button class="btn btn-outline" onclick="startQuiz(\${ch.id})">Повторить тест</button>
              <button class="btn btn-outline" onclick="goLibrary()">В оглавление книги</button>
            </div>
          </div>
        </div>
      \`;
    }
  }
}

window.goLibrary = () => { state.screen = "library"; render(); };
window.openChapter = (id) => {
  state.chapterId = id;
  state.charOffset = state.progress[id].offset || 0;
  state.settingsOpen = false;
  state.screen = "reader";
  render();
};
window.handleReaderTap = (e, totalPages) => {
  if (state.settingsOpen) { state.settingsOpen = false; render(); return; }
  const x = e.clientX;
  const w = window.innerWidth;
  const ch = CHAPTERS.find(c => c.id === state.chapterId);
  const pages = paginate(ch.content, state.fontSize);
  if (x < w * 0.25) {
    if (state.pageIndex > 0) {
      state.pageIndex--;
      state.charOffset = pages[state.pageIndex].start;
      state.progress[state.chapterId].offset = state.charOffset;
      render();
    }
  } else if (x > w * 0.75) {
    if (state.pageIndex < totalPages - 1) {
      state.pageIndex++;
      state.charOffset = pages[state.pageIndex].start;
      state.progress[state.chapterId].offset = state.charOffset;
      render();
    }
  } else {
    state.controlsVisible = !state.controlsVisible;
    render();
  }
};
window.toggleSettings = () => { state.settingsOpen = !state.settingsOpen; render(); };
window.changeFont = (d) => { state.fontSize = Math.min(28, Math.max(14, state.fontSize + d)); render(); };
window.setTheme = (t) => { state.theme = t; render(); };
window.startQuiz = (id) => {
  state.chapterId = id; state.qIndex = 0; state.selectedOpt = null;
  state.submitted = false; state.correctCount = 0; state.quizDone = false;
  state.screen = "quiz"; render();
};
window.selectOpt = (i) => { if (!state.submitted) { state.selectedOpt = i; render(); } };
window.submitAns = () => {
  if (state.selectedOpt === null || state.submitted) return;
  const ch = CHAPTERS.find(c => c.id === state.chapterId);
  if (state.selectedOpt === ch.questions[state.qIndex].correct) state.correctCount++;
  state.submitted = true; render();
};
window.nextQ = () => {
  const ch = CHAPTERS.find(c => c.id === state.chapterId);
  if (state.qIndex + 1 < ch.questions.length) {
    state.qIndex++; state.selectedOpt = null; state.submitted = false;
  } else {
    const score = Math.round((state.correctCount / ch.questions.length) * 100);
    if (score >= 75) {
      state.progress[ch.id].status = "PASSED";
      state.progress[ch.id].bestScore = Math.max(state.progress[ch.id].bestScore, score);
      const nextCh = CHAPTERS.find(c => c.index === ch.index + 1);
      if (nextCh && state.progress[nextCh.id].status === "LOCKED") {
        state.progress[nextCh.id].status = "AVAILABLE";
      }
    }
    state.quizDone = true;
  }
  render();
};
window.addEventListener("resize", () => { if (state.screen === "reader") render(); });
render();
</script>
</body>
</html>`;
}

/**
 * Builds a valid Android Binary XML (AXML) for AndroidManifest.xml
 */
function buildBinaryAndroidManifest() {
  // Attribute resource IDs in Android framework (must be sorted ascending per element)
  const ATTR_THEME = 0x01010000;
  const ATTR_LABEL = 0x01010001;
  const ATTR_NAME = 0x01010003;
  const ATTR_VERSION_CODE = 0x0101021b;
  const ATTR_VERSION_NAME = 0x0101021c;
  const ATTR_MIN_SDK = 0x0101020c;
  const ATTR_TARGET_SDK = 0x01010270;
  const ATTR_HARDWARE_ACCEL = 0x010102d3;
  const ATTR_EXPORTED = 0x01010010;

  // First 9 strings correspond to the resource IDs in the exact order below:
  const resIds = [
    ATTR_THEME,
    ATTR_LABEL,
    ATTR_NAME,
    ATTR_EXPORTED,
    ATTR_MIN_SDK,
    ATTR_VERSION_CODE,
    ATTR_VERSION_NAME,
    ATTR_TARGET_SDK,
    ATTR_HARDWARE_ACCEL,
  ];

  const strings = [
    'theme',                                      // 0 -> 0x01010000
    'label',                                      // 1 -> 0x01010001
    'name',                                       // 2 -> 0x01010003
    'exported',                                   // 3 -> 0x01010010
    'minSdkVersion',                              // 4 -> 0x0101020c
    'versionCode',                                // 5 -> 0x0101021b
    'versionName',                                // 6 -> 0x0101021c
    'targetSdkVersion',                           // 7 -> 0x01010270
    'hardwareAccelerated',                        // 8 -> 0x010102d3
    'android',                                    // 9
    'http://schemas.android.com/apk/res/android', // 10
    'manifest',                                   // 11
    'package',                                    // 12
    'com.example.interactivereader',              // 13
    '1.0.0',                                      // 14
    'uses-sdk',                                   // 15
    'application',                                // 16
    'Интерактивная Читалка',                      // 17
    'activity',                                   // 18
    'com.example.interactivereader.MainActivity', // 19
    'intent-filter',                              // 20
    'action',                                     // 21
    'android.intent.action.MAIN',                 // 22
    'category',                                   // 23
    'android.intent.category.LAUNCHER',           // 24
  ];

  // Encode UTF-16LE string pool
  const encodedStrings = strings.map((str) => {
    const strBuf = Buffer.from(str, 'utf16le');
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(str.length, 0);
    const nullBuf = Buffer.alloc(2, 0);
    return Buffer.concat([lenBuf, strBuf, nullBuf]);
  });

  const offsets = [];
  let curOffset = 0;
  for (const b of encodedStrings) {
    offsets.push(curOffset);
    curOffset += b.length;
  }
  while (curOffset % 4 !== 0) {
    encodedStrings.push(Buffer.alloc(1, 0));
    curOffset += 1;
  }

  const stringPoolHeaderSize = 28;
  const offsetsSize = strings.length * 4;
  const stringsStart = stringPoolHeaderSize + offsetsSize;
  const stringPoolChunkSize = stringsStart + curOffset;

  const stringPoolBuf = Buffer.alloc(stringPoolChunkSize);
  stringPoolBuf.writeUInt16LE(0x0001, 0); // RES_STRING_POOL_TYPE
  stringPoolBuf.writeUInt16LE(stringPoolHeaderSize, 2);
  stringPoolBuf.writeUInt32LE(stringPoolChunkSize, 4);
  stringPoolBuf.writeUInt32LE(strings.length, 8);
  stringPoolBuf.writeUInt32LE(0, 12); // styleCount
  stringPoolBuf.writeUInt32LE(0, 16); // flags (UTF-16)
  stringPoolBuf.writeUInt32LE(stringsStart, 20);
  stringPoolBuf.writeUInt32LE(0, 24); // stylesStart

  for (let i = 0; i < offsets.length; i++) {
    stringPoolBuf.writeUInt32LE(offsets[i], stringPoolHeaderSize + i * 4);
  }
  Buffer.concat(encodedStrings).copy(stringPoolBuf, stringsStart);

  // Resource Map Chunk
  const resMapChunkSize = 8 + resIds.length * 4;
  const resMapBuf = Buffer.alloc(resMapChunkSize);
  resMapBuf.writeUInt16LE(0x0180, 0); // RES_XML_RESOURCE_MAP_TYPE
  resMapBuf.writeUInt16LE(8, 2);
  resMapBuf.writeUInt32LE(resMapChunkSize, 4);
  for (let i = 0; i < resIds.length; i++) {
    resMapBuf.writeUInt32LE(resIds[i], 8 + i * 4);
  }

  function makeNamespaceChunk(isStart, prefixIdx, uriIdx, line) {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(isStart ? 0x0100 : 0x0101, 0);
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(24, 4);
    buf.writeUInt32LE(line, 8);
    buf.writeInt32LE(-1, 12);
    buf.writeInt32LE(prefixIdx, 16);
    buf.writeInt32LE(uriIdx, 20);
    return buf;
  }

  function makeStartElement(nameIdx, line, attrs) {
    const chunkSize = 36 + attrs.length * 20;
    const buf = Buffer.alloc(chunkSize);
    buf.writeUInt16LE(0x0102, 0); // RES_XML_START_ELEMENT_TYPE
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(chunkSize, 4);
    buf.writeUInt32LE(line, 8);
    buf.writeInt32LE(-1, 12);
    buf.writeInt32LE(-1, 16); // ns
    buf.writeInt32LE(nameIdx, 20);
    buf.writeUInt16LE(20, 24); // attributeStart
    buf.writeUInt16LE(20, 26); // attributeSize
    buf.writeUInt16LE(attrs.length, 28);
    buf.writeUInt16LE(0, 30);
    buf.writeUInt16LE(0, 32);
    buf.writeUInt16LE(0, 34);

    attrs.forEach((a, idx) => {
      const base = 36 + idx * 20;
      buf.writeInt32LE(a.ns, base);
      buf.writeInt32LE(a.nameIdx, base + 4);
      buf.writeInt32LE(a.rawValIdx, base + 8);
      buf.writeUInt16LE(8, base + 12);
      buf.writeUInt8(0, base + 14);
      buf.writeUInt8(a.type, base + 16);
      buf.writeUInt32LE(a.data >>> 0, base + 16); // wait: offset 15 is type!
    });
    return buf;
  }

  // Fix attribute layout:
  // +0: ns (int32)
  // +4: name (int32)
  // +8: rawValue (int32)
  // +12: size (uint16 = 8)
  // +14: res0 (uint8 = 0)
  // +15: dataType (uint8: 0x03=string, 0x10=int, 0x12=bool, 0x01=reference)
  // +16: data (uint32)
  function makeStartElementCorrect(nameIdx, line, attrs) {
    const chunkSize = 36 + attrs.length * 20;
    const buf = Buffer.alloc(chunkSize);
    buf.writeUInt16LE(0x0102, 0);
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(chunkSize, 4);
    buf.writeUInt32LE(line, 8);
    buf.writeInt32LE(-1, 12);
    buf.writeInt32LE(-1, 16);
    buf.writeInt32LE(nameIdx, 20);
    buf.writeUInt16LE(20, 24);
    buf.writeUInt16LE(20, 26);
    buf.writeUInt16LE(attrs.length, 28);
    buf.writeUInt16LE(0, 30);
    buf.writeUInt16LE(0, 32);
    buf.writeUInt16LE(0, 34);

    attrs.forEach((a, idx) => {
      const base = 36 + idx * 20;
      buf.writeInt32LE(a.ns, base);
      buf.writeInt32LE(a.nameIdx, base + 4);
      buf.writeInt32LE(a.rawValIdx, base + 8);
      buf.writeUInt16LE(8, base + 12);
      buf.writeUInt8(0, base + 14);
      buf.writeUInt8(a.type, base + 15);
      buf.writeUInt32LE(a.data >>> 0, base + 16);
    });
    return buf;
  }

  function makeEndElement(nameIdx, line) {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(0x0103, 0);
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(24, 4);
    buf.writeUInt32LE(line, 8);
    buf.writeInt32LE(-1, 12);
    buf.writeInt32LE(-1, 16);
    buf.writeInt32LE(nameIdx, 20);
    return buf;
  }

  const TYPE_REFERENCE = 0x01;
  const TYPE_STRING = 0x03;
  const TYPE_INT_DEC = 0x10;
  const TYPE_INT_BOOLEAN = 0x12;

  const xmlChunks = [
    makeNamespaceChunk(true, 9, 10, 2),
    // <manifest android:versionCode="1" android:versionName="1.0.0" package="com.example.interactivereader">
    makeStartElementCorrect(11, 2, [
      { ns: 10, nameIdx: 5, rawValIdx: -1, type: TYPE_INT_DEC, data: 1 },
      { ns: 10, nameIdx: 6, rawValIdx: 14, type: TYPE_STRING, data: 14 },
      { ns: -1, nameIdx: 12, rawValIdx: 13, type: TYPE_STRING, data: 13 },
    ]),
    // <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="28" />
    makeStartElementCorrect(15, 6, [
      { ns: 10, nameIdx: 4, rawValIdx: -1, type: TYPE_INT_DEC, data: 21 },
      { ns: 10, nameIdx: 7, rawValIdx: -1, type: TYPE_INT_DEC, data: 28 },
    ]),
    makeEndElement(15, 6),
    // <application android:theme="@android:style/Theme.Material.Light.NoActionBar" (0x01030224) android:label="Интерактивная Читалка" android:hardwareAccelerated="true">
    makeStartElementCorrect(16, 8, [
      { ns: 10, nameIdx: 0, rawValIdx: -1, type: TYPE_REFERENCE, data: 0x01030224 },
      { ns: 10, nameIdx: 1, rawValIdx: 17, type: TYPE_STRING, data: 17 },
      { ns: 10, nameIdx: 8, rawValIdx: -1, type: TYPE_INT_BOOLEAN, data: 0xffffffff },
    ]),
    // <activity android:name="com.example.interactivereader.MainActivity" android:exported="true">
    makeStartElementCorrect(18, 12, [
      { ns: 10, nameIdx: 2, rawValIdx: 19, type: TYPE_STRING, data: 19 },
      { ns: 10, nameIdx: 3, rawValIdx: -1, type: TYPE_INT_BOOLEAN, data: 0xffffffff },
    ]),
    // <intent-filter>
    makeStartElementCorrect(20, 15, []),
    // <action android:name="android.intent.action.MAIN" />
    makeStartElementCorrect(21, 16, [
      { ns: 10, nameIdx: 2, rawValIdx: 22, type: TYPE_STRING, data: 22 },
    ]),
    makeEndElement(21, 16),
    // <category android:name="android.intent.category.LAUNCHER" />
    makeStartElementCorrect(23, 17, [
      { ns: 10, nameIdx: 2, rawValIdx: 24, type: TYPE_STRING, data: 24 },
    ]),
    makeEndElement(23, 17),
    makeEndElement(20, 18),
    makeEndElement(18, 19),
    makeEndElement(16, 20),
    makeEndElement(11, 21),
    makeNamespaceChunk(false, 9, 10, 21),
  ];

  const bodyBuf = Buffer.concat([stringPoolBuf, resMapBuf, ...xmlChunks]);
  const headerBuf = Buffer.alloc(8);
  headerBuf.writeUInt16LE(0x0003, 0); // RES_XML_TYPE
  headerBuf.writeUInt16LE(8, 2);
  headerBuf.writeUInt32LE(8 + bodyBuf.length, 4);

  return Buffer.concat([headerBuf, bodyBuf]);
}

/**
 * Builds a valid Dalvik Executable (classes.dex) for com.example.interactivereader.MainActivity
 * that opens an Android WebView and loads file:///android_asset/index.html
 */
function buildClassesDex() {
  // Strings in strict lexicographical order!
  const strings = [
    '<init>',                                           // 0
    'Landroid/app/Activity;',                           // 1
    'Landroid/content/Context;',                        // 2
    'Landroid/os/Bundle;',                              // 3
    'Landroid/view/View;',                              // 4
    'Landroid/webkit/WebSettings;',                     // 5
    'Landroid/webkit/WebView;',                         // 6
    'Lcom/example/interactivereader/MainActivity;',     // 7
    'Ljava/lang/Object;',                               // 8
    'Ljava/lang/String;',                               // 9
    'V',                                                // 10
    'VL',                                               // 11
    'VZ',                                               // 12
    'Z',                                                // 13
    'file:///android_asset/index.html',                 // 14
    'getSettings',                                      // 15
    'loadUrl',                                          // 16
    'onCreate',                                         // 17
    'setContentView',                                   // 18
    'setDomStorageEnabled',                             // 19
    'setJavaScriptEnabled',                             // 20
  ];

  // Type IDs (indices into strings, sorted)
  // 0: Landroid/app/Activity; (1)
  // 1: Landroid/content/Context; (2)
  // 2: Landroid/os/Bundle; (3)
  // 3: Landroid/view/View; (4)
  // 4: Landroid/webkit/WebSettings; (5)
  // 5: Landroid/webkit/WebView; (6)
  // 6: Lcom/example/interactivereader/MainActivity; (7)
  // 7: Ljava/lang/String; (9)
  // 8: V (10)
  // 9: Z (13)
  const typeIds = [1, 2, 3, 4, 5, 6, 7, 9, 10, 13];

  // Type Lists for Proto parameters:
  // List A: (Landroid/content/Context;) -> [1]
  // List B: (Landroid/os/Bundle;) -> [2]
  // List C: (Landroid/view/View;) -> [3]
  // List D: (Ljava/lang/String;) -> [7]
  // List E: (Z) -> [9]

  // Proto IDs (sorted by return_type_idx, then parameters_list):
  // 0: ()Landroid/webkit/WebSettings; -> shorty=8('L'? Wait: let's add 'L' to strings!)
  return buildClassesDexWithShorties();
}

function buildClassesDexWithShorties() {
  // Strictly sorted UTF-8 strings:
  const strings = [
    '<init>',                                           // 0
    'L',                                                // 1
    'Landroid/app/Activity;',                           // 2
    'Landroid/content/Context;',                        // 3
    'Landroid/os/Bundle;',                              // 4
    'Landroid/view/View;',                              // 5
    'Landroid/webkit/WebSettings;',                     // 6
    'Landroid/webkit/WebView;',                         // 7
    'Lcom/example/interactivereader/MainActivity;',     // 8
    'Ljava/lang/String;',                               // 9
    'V',                                                // 10
    'VL',                                               // 11
    'VZ',                                               // 12
    'Z',                                                // 13
    'file:///android_asset/index.html',                 // 14
    'getSettings',                                      // 15
    'loadUrl',                                          // 16
    'onCreate',                                         // 17
    'setContentView',                                   // 18
    'setDomStorageEnabled',                             // 19
    'setJavaScriptEnabled',                             // 20
  ];

  // Verify strict lexicographical sort
  for (let i = 1; i < strings.length; i++) {
    if (strings[i - 1] >= strings[i]) {
      throw new Error(`Strings not sorted: ${strings[i - 1]} vs ${strings[i]}`);
    }
  }

  // Type IDs (index into strings):
  // 0: Landroid/app/Activity; (2)
  // 1: Landroid/content/Context; (3)
  // 2: Landroid/os/Bundle; (4)
  // 3: Landroid/view/View; (5)
  // 4: Landroid/webkit/WebSettings; (6)
  // 5: Landroid/webkit/WebView; (7)
  // 6: Lcom/example/interactivereader/MainActivity; (8)
  // 7: Ljava/lang/String; (9)
  // 8: V (10)
  // 9: Z (13)
  const typeIds = [2, 3, 4, 5, 6, 7, 8, 9, 10, 13];

  // Protos (sorted by return_type_idx, then parameter type_idx):
  // 0: ()Landroid/webkit/WebSettings;  | shorty=1 ('L'), return=4, params=0
  // 1: ()V                             | shorty=10 ('V'), return=8, params=0
  // 2: (Landroid/content/Context;)V    | shorty=11 ('VL'), return=8, params=[1]
  // 3: (Landroid/os/Bundle;)V          | shorty=11 ('VL'), return=8, params=[2]
  // 4: (Landroid/view/View;)V          | shorty=11 ('VL'), return=8, params=[3]
  // 5: (Ljava/lang/String;)V           | shorty=11 ('VL'), return=8, params=[7]
  // 6: (Z)V                            | shorty=12 ('VZ'), return=8, params=[9]
  const protos = [
    { shortyIdx: 1, returnTypeIdx: 4, paramTypeIdx: null },
    { shortyIdx: 10, returnTypeIdx: 8, paramTypeIdx: null },
    { shortyIdx: 11, returnTypeIdx: 8, paramTypeIdx: 1 },
    { shortyIdx: 11, returnTypeIdx: 8, paramTypeIdx: 2 },
    { shortyIdx: 11, returnTypeIdx: 8, paramTypeIdx: 3 },
    { shortyIdx: 11, returnTypeIdx: 8, paramTypeIdx: 7 },
    { shortyIdx: 12, returnTypeIdx: 8, paramTypeIdx: 9 },
  ];

  // Method IDs (sorted by class_idx, then name_idx, then proto_idx):
  // 0: Landroid/app/Activity;.<init>:()V                              (class=0, name=0, proto=1)
  // 1: Landroid/app/Activity;.onCreate:(Landroid/os/Bundle;)V         (class=0, name=17, proto=3)
  // 2: Landroid/app/Activity;.setContentView:(Landroid/view/View;)V   (class=0, name=18, proto=4)
  // 3: Landroid/webkit/WebSettings;.setDomStorageEnabled:(Z)V         (class=4, name=19, proto=6)
  // 4: Landroid/webkit/WebSettings;.setJavaScriptEnabled:(Z)V         (class=4, name=20, proto=6)
  // 5: Landroid/webkit/WebView;.<init>:(Landroid/content/Context;)V   (class=5, name=0, proto=2)
  // 6: Landroid/webkit/WebView;.getSettings:()Landroid/webkit/WebSettings; (class=5, name=15, proto=0)
  // 7: Landroid/webkit/WebView;.loadUrl:(Ljava/lang/String;)V         (class=5, name=16, proto=5)
  // 8: Lcom/example/interactivereader/MainActivity;.<init>:()V        (class=6, name=0, proto=1)
  // 9: Lcom/example/interactivereader/MainActivity;.onCreate:(Landroid/os/Bundle;)V (class=6, name=17, proto=3)
  const methods = [
    { classIdx: 0, protoIdx: 1, nameIdx: 0 },
    { classIdx: 0, protoIdx: 3, nameIdx: 17 },
    { classIdx: 0, protoIdx: 4, nameIdx: 18 },
    { classIdx: 4, protoIdx: 6, nameIdx: 19 },
    { classIdx: 4, protoIdx: 6, nameIdx: 20 },
    { classIdx: 5, protoIdx: 2, nameIdx: 0 },
    { classIdx: 5, protoIdx: 0, nameIdx: 15 },
    { classIdx: 5, protoIdx: 5, nameIdx: 16 },
    { classIdx: 6, protoIdx: 1, nameIdx: 0 },
    { classIdx: 6, protoIdx: 3, nameIdx: 17 },
  ];

  // ULEB128 helper
  function uleb128(val) {
    const bytes = [];
    do {
      let b = val & 0x7f;
      val >>>= 7;
      if (val !== 0) b |= 0x80;
      bytes.push(b);
    } while (val !== 0);
    return Buffer.from(bytes);
  }

  // Code item 1: MainActivity.<init>()V
  // registers_size = 1 (v0 = this), ins_size = 1, outs_size = 1, tries_size = 0
  // instructions:
  //   invoke-direct {v0}, Landroid/app/Activity;.<init>:()V (method 0) -> 70 10 00 00 00 00
  //   return-void -> 0e 00
  const initCodeItem = Buffer.alloc(16 + 8);
  initCodeItem.writeUInt16LE(1, 0); // registers_size
  initCodeItem.writeUInt16LE(1, 2); // ins_size
  initCodeItem.writeUInt16LE(1, 4); // outs_size
  initCodeItem.writeUInt16LE(0, 6); // tries_size
  initCodeItem.writeUInt32LE(0, 8); // debug_info_off
  initCodeItem.writeUInt32LE(4, 12); // insns_size (in 16-bit code units = 4)
  Buffer.from([0x70, 0x10, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00]).copy(initCodeItem, 16);

  // Code item 2: MainActivity.onCreate(Landroid/os/Bundle;)V
  // registers_size = 5 (v0=webView, v1=settings, v2=const1/url, v3=this, v4=bundle)
  // ins_size = 2 (v3, v4), outs_size = 2
  // instructions:
  // 1) invoke-super {v3, v4}, Activity.onCreate (method 1)          -> 6f 20 01 00 43 00
  // 2) new-instance v0, Landroid/webkit/WebView; (type 5)           -> 22 00 05 00
  // 3) invoke-direct {v0, v3}, WebView.<init>(Context) (method 5)   -> 70 20 05 00 30 00
  // 4) invoke-virtual {v0}, WebView.getSettings() (method 6)        -> 6e 10 06 00 00 00
  // 5) move-result-object v1                                        -> 0c 01
  // 6) const/4 v2, #1                                               -> 12 12
  // 7) invoke-virtual {v1, v2}, WebSettings.setJavaScriptEnabled(Z) (method 4) -> 6e 20 04 00 21 00
  // 8) invoke-virtual {v1, v2}, WebSettings.setDomStorageEnabled(Z) (method 3) -> 6e 20 03 00 21 00
  // 9) const-string v2, "file:///android_asset/index.html" (str 14) -> 1a 02 0e 00
  // 10) invoke-virtual {v0, v2}, WebView.loadUrl(String) (method 7) -> 6e 20 07 00 20 00
  // 11) invoke-virtual {v3, v0}, Activity.setContentView(View) (method 2) -> 6e 20 02 00 03 00
  // 12) return-void                                                 -> 0e 00
  const onCreateInsns = Buffer.from([
    0x6f, 0x20, 0x01, 0x00, 0x43, 0x00,
    0x22, 0x00, 0x05, 0x00,
    0x70, 0x20, 0x05, 0x00, 0x30, 0x00,
    0x6e, 0x10, 0x06, 0x00, 0x00, 0x00,
    0x0c, 0x01,
    0x12, 0x12,
    0x6e, 0x20, 0x04, 0x00, 0x21, 0x00,
    0x6e, 0x20, 0x03, 0x00, 0x21, 0x00,
    0x1a, 0x02, 0x0e, 0x00,
    0x6e, 0x20, 0x07, 0x00, 0x20, 0x00,
    0x6e, 0x20, 0x02, 0x00, 0x03, 0x00,
    0x0e, 0x00,
  ]);
  const onCreateCodeItem = Buffer.alloc(16 + onCreateInsns.length + 2); // +2 for 4-byte alignment
  onCreateCodeItem.writeUInt16LE(5, 0); // registers_size
  onCreateCodeItem.writeUInt16LE(2, 2); // ins_size
  onCreateCodeItem.writeUInt16LE(2, 4); // outs_size
  onCreateCodeItem.writeUInt16LE(0, 6); // tries_size
  onCreateCodeItem.writeUInt32LE(0, 8); // debug_info_off
  onCreateCodeItem.writeUInt32LE(onCreateInsns.length / 2, 12); // insns_size (25 units)
  onCreateInsns.copy(onCreateCodeItem, 16);

  // Layout offsets:
  // Header: 0x00 .. 0x70 (112 bytes)
  // String IDs: 21 * 4 = 84 bytes (0x70 .. 0xC4)
  // Type IDs: 10 * 4 = 40 bytes (0xC4 .. 0xEC)
  // Proto IDs: 7 * 12 = 84 bytes (0xEC .. 0x140)
  // Method IDs: 10 * 8 = 80 bytes (0x140 .. 0x190)
  // Class Defs: 1 * 32 = 32 bytes (0x190 .. 0x1B0)
  // Data section starts at 0x1B0 (432)
  const headerSize = 0x70;
  const stringIdsOff = headerSize;
  const typeIdsOff = stringIdsOff + strings.length * 4;
  const protoIdsOff = typeIdsOff + typeIds.length * 4;
  const methodIdsOff = protoIdsOff + protos.length * 12;
  const classDefsOff = methodIdsOff + methods.length * 8;
  const dataOff = classDefsOff + 32;

  // Data Section items:
  // 1) Type Lists (5 lists of 1 item each, 4-byte aligned -> 8 bytes each = 40 bytes)
  const typeListsOff = dataOff;
  const paramTypes = [1, 2, 3, 7, 9];
  const typeListsBuf = Buffer.alloc(paramTypes.length * 8);
  paramTypes.forEach((tIdx, i) => {
    typeListsBuf.writeUInt32LE(1, i * 8);
    typeListsBuf.writeUInt16LE(tIdx, i * 8 + 4);
    typeListsBuf.writeUInt16LE(0, i * 8 + 6); // padding
  });

  // 2) Code items (4-byte aligned)
  const initCodeOff = typeListsOff + typeListsBuf.length;
  const onCreateCodeOff = initCodeOff + initCodeItem.length;

  // 3) String Data items
  const stringDataStartOff = onCreateCodeOff + onCreateCodeItem.length;
  const stringDataOffsets = [];
  const stringDataChunks = [];
  let curStrOff = stringDataStartOff;
  for (const s of strings) {
    stringDataOffsets.push(curStrOff);
    const utf8Buf = Buffer.from(s, 'utf8');
    const lenPrefix = uleb128(s.length);
    const chunk = Buffer.concat([lenPrefix, utf8Buf, Buffer.from([0])]);
    stringDataChunks.push(chunk);
    curStrOff += chunk.length;
  }

  // 4) Class Data item for MainActivity
  const classDataOff = curStrOff;
  // static_fields=0, instance_fields=0, direct_methods=1, virtual_methods=1
  // direct_method[0]: method_idx_diff=8, access_flags=0x10001 (PUBLIC | CONSTRUCTOR), code_off=initCodeOff
  // virtual_method[0]: method_idx_diff=9, access_flags=0x0004 (PROTECTED), code_off=onCreateCodeOff
  const classDataBuf = Buffer.concat([
    uleb128(0),
    uleb128(0),
    uleb128(1),
    uleb128(1),
    uleb128(8),
    uleb128(0x10001),
    uleb128(initCodeOff),
    uleb128(9),
    uleb128(0x0004),
    uleb128(onCreateCodeOff),
  ]);

  let afterClassDataOff = classDataOff + classDataBuf.length;
  const alignPadLen = (4 - (afterClassDataOff % 4)) % 4;
  const alignPadBuf = Buffer.alloc(alignPadLen, 0);
  const mapListOff = afterClassDataOff + alignPadLen;

  // 5) Map List (11 items)
  // Header (0x0000), StringId (0x0001), TypeId (0x0002), ProtoId (0x0003), MethodId (0x0005), ClassDef (0x0006),
  // TypeList (0x1001), CodeItem (0x2001), StringData (0x2002), ClassData (0x2000), MapList (0x1000)
  const mapItems = [
    { type: 0x0000, size: 1, offset: 0 },
    { type: 0x0001, size: strings.length, offset: stringIdsOff },
    { type: 0x0002, size: typeIds.length, offset: typeIdsOff },
    { type: 0x0003, size: protos.length, offset: protoIdsOff },
    { type: 0x0005, size: methods.length, offset: methodIdsOff },
    { type: 0x0006, size: 1, offset: classDefsOff },
    { type: 0x1001, size: paramTypes.length, offset: typeListsOff },
    { type: 0x2001, size: 2, offset: initCodeOff },
    { type: 0x2002, size: strings.length, offset: stringDataStartOff },
    { type: 0x2000, size: 1, offset: classDataOff },
    { type: 0x1000, size: 1, offset: mapListOff },
  ];

  const mapListBuf = Buffer.alloc(4 + mapItems.length * 12);
  mapListBuf.writeUInt32LE(mapItems.length, 0);
  mapItems.forEach((m, i) => {
    const base = 4 + i * 12;
    mapListBuf.writeUInt16LE(m.type, base);
    mapListBuf.writeUInt16LE(0, base + 2);
    mapListBuf.writeUInt32LE(m.size, base + 4);
    mapListBuf.writeUInt32LE(m.offset, base + 8);
  });

  const fileSize = mapListOff + mapListBuf.length;
  const dataSize = fileSize - dataOff;

  const dex = Buffer.alloc(fileSize, 0);

  // Write magic "dex\n035\0"
  Buffer.from('dex\n035\0', 'ascii').copy(dex, 0);
  dex.writeUInt32LE(fileSize, 32);
  dex.writeUInt32LE(0x70, 36);
  dex.writeUInt32LE(0x12345678, 40); // ENDIAN_CONSTANT
  dex.writeUInt32LE(0, 44); // link_size
  dex.writeUInt32LE(0, 48); // link_off
  dex.writeUInt32LE(mapListOff, 52);
  dex.writeUInt32LE(strings.length, 56);
  dex.writeUInt32LE(stringIdsOff, 60);
  dex.writeUInt32LE(typeIds.length, 64);
  dex.writeUInt32LE(typeIdsOff, 68);
  dex.writeUInt32LE(protos.length, 72);
  dex.writeUInt32LE(protoIdsOff, 76);
  dex.writeUInt32LE(0, 80); // field_ids_size
  dex.writeUInt32LE(0, 84); // field_ids_off
  dex.writeUInt32LE(methods.length, 88);
  dex.writeUInt32LE(methodIdsOff, 92);
  dex.writeUInt32LE(1, 96); // class_defs_size
  dex.writeUInt32LE(classDefsOff, 100);
  dex.writeUInt32LE(dataSize, 104);
  dex.writeUInt32LE(dataOff, 108);

  // String IDs
  stringDataOffsets.forEach((off, i) => {
    dex.writeUInt32LE(off, stringIdsOff + i * 4);
  });

  // Type IDs
  typeIds.forEach((sIdx, i) => {
    dex.writeUInt32LE(sIdx, typeIdsOff + i * 4);
  });

  // Proto IDs
  let paramListIdx = 0;
  protos.forEach((p, i) => {
    const base = protoIdsOff + i * 12;
    dex.writeUInt32LE(p.shortyIdx, base);
    dex.writeUInt32LE(p.returnTypeIdx, base + 4);
    if (p.paramTypeIdx !== null) {
      dex.writeUInt32LE(typeListsOff + paramListIdx * 8, base + 8);
      paramListIdx++;
    } else {
      dex.writeUInt32LE(0, base + 8);
    }
  });

  // Method IDs
  methods.forEach((m, i) => {
    const base = methodIdsOff + i * 8;
    dex.writeUInt16LE(m.classIdx, base);
    dex.writeUInt16LE(m.protoIdx, base + 2);
    dex.writeUInt32LE(m.nameIdx, base + 4);
  });

  // Class Def (MainActivity = type 6, PUBLIC=0x0001, superclass=Activity=type 0)
  dex.writeUInt32LE(6, classDefsOff); // class_idx
  dex.writeUInt32LE(0x0001, classDefsOff + 4); // access_flags
  dex.writeUInt32LE(0, classDefsOff + 8); // superclass_idx
  dex.writeUInt32LE(0, classDefsOff + 12); // interfaces_off
  dex.writeUInt32LE(0xffffffff, classDefsOff + 16); // source_file_idx (NO_INDEX)
  dex.writeUInt32LE(0, classDefsOff + 20); // annotations_off
  dex.writeUInt32LE(classDataOff, classDefsOff + 24); // class_data_off
  dex.writeUInt32LE(0, classDefsOff + 28); // static_values_off

  // Copy Data Section
  typeListsBuf.copy(dex, typeListsOff);
  initCodeItem.copy(dex, initCodeOff);
  onCreateCodeItem.copy(dex, onCreateCodeOff);
  Buffer.concat(stringDataChunks).copy(dex, stringDataStartOff);
  classDataBuf.copy(dex, classDataOff);
  alignPadBuf.copy(dex, afterClassDataOff);
  mapListBuf.copy(dex, mapListOff);

  // Compute SHA-1 signature (bytes 32..end) and store at offset 12..31
  const sha1 = crypto.createHash('sha1').update(dex.subarray(32)).digest();
  sha1.copy(dex, 12);

  // Compute Adler32 checksum (bytes 12..end) and store at offset 8..11
  let a = 1;
  let b = 0;
  for (let i = 12; i < dex.length; i++) {
    a = (a + dex[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  dex.writeUInt32LE(adler, 8);

  return dex;
}

/**
 * Creates a signed APK (JAR Signature v1 + 4-byte aligned ZIP entries)
 */
function buildSignedApk(outputPath) {
  const tmpDir = '/tmp/apk_build_' + Date.now();
  fs.mkdirSync(tmpDir, { recursive: true });

  const manifestBin = buildBinaryAndroidManifest();
  const classesDex = buildClassesDex();
  const indexHtml = Buffer.from(buildStandaloneReaderHtml(), 'utf8');

  // Generate v1 JAR signing files (META-INF/MANIFEST.MF, CERT.SF, CERT.RSA)
  const sha256B64 = (buf) => crypto.createHash('sha256').update(buf).digest('base64');

  const manifestMf = [
    'Manifest-Version: 1.0',
    'Created-By: 1.0 (Android)',
    '',
    'Name: AndroidManifest.xml',
    `SHA-256-Digest: ${sha256B64(manifestBin)}`,
    '',
    'Name: classes.dex',
    `SHA-256-Digest: ${sha256B64(classesDex)}`,
    '',
    'Name: assets/index.html',
    `SHA-256-Digest: ${sha256B64(indexHtml)}`,
    '',
  ].join('\r\n');

  const mfBuf = Buffer.from(manifestMf, 'utf8');

  const sectionHash = (name, digest) => {
    const chunk = `Name: ${name}\r\nSHA-256-Digest: ${digest}\r\n\r\n`;
    return sha256B64(Buffer.from(chunk, 'utf8'));
  };

  const certSf = [
    'Signature-Version: 1.0',
    'Created-By: 1.0 (Android)',
    `SHA-256-Digest-Manifest: ${sha256B64(mfBuf)}`,
    '',
    'Name: AndroidManifest.xml',
    `SHA-256-Digest: ${sectionHash('AndroidManifest.xml', sha256B64(manifestBin))}`,
    '',
    'Name: classes.dex',
    `SHA-256-Digest: ${sectionHash('classes.dex', sha256B64(classesDex))}`,
    '',
    'Name: assets/index.html',
    `SHA-256-Digest: ${sectionHash('assets/index.html', sha256B64(indexHtml))}`,
    '',
  ].join('\r\n');

  const sfPath = path.join(tmpDir, 'CERT.SF');
  const keyPath = path.join(tmpDir, 'key.pem');
  const certPath = path.join(tmpDir, 'cert.pem');
  const rsaPath = path.join(tmpDir, 'CERT.RSA');

  fs.writeFileSync(sfPath, certSf);

  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 10000 -nodes -subj "/CN=InteractiveReader/O=Android/C=US"`,
    { stdio: 'ignore' }
  );
  execSync(
    `openssl cms -sign -binary -in "${sfPath}" -signer "${certPath}" -inkey "${keyPath}" -outform DER -out "${rsaPath}" -nodetach -md sha256`,
    { stdio: 'ignore' }
  );

  const certRsaBuf = fs.readFileSync(rsaPath);
  const certDerBuf = execSync(`openssl x509 -in "${certPath}" -outform DER`);

  // Assemble uncompressed, 4-byte aligned ZIP archive with APK Signature Scheme v2 block!
  const entries = [
    { name: 'AndroidManifest.xml', data: manifestBin },
    { name: 'classes.dex', data: classesDex },
    { name: 'assets/index.html', data: indexHtml },
    { name: 'META-INF/MANIFEST.MF', data: mfBuf },
    { name: 'META-INF/CERT.SF', data: Buffer.from(certSf, 'utf8') },
    { name: 'META-INF/CERT.RSA', data: certRsaBuf },
  ];

  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = zlib.crc32(entry.data) >>> 0;
    const dataOffsetUnaligned = offset + 30 + nameBuf.length;
    const padLen = (4 - (dataOffsetUnaligned % 4)) % 4;
    const extraBuf = Buffer.alloc(padLen, 0);

    const localHeader = Buffer.alloc(30 + nameBuf.length + extraBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression = STORED
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(extraBuf.length, 28);
    nameBuf.copy(localHeader, 30);
    extraBuf.copy(localHeader, 30 + nameBuf.length);

    localHeaders.push(localHeader, entry.data);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }

  const contentsSection = Buffer.concat(localHeaders);
  const centralDirSection = Buffer.concat(centralHeaders);

  const eocdForV2 = Buffer.alloc(22);
  eocdForV2.writeUInt32LE(0x06054b50, 0);
  eocdForV2.writeUInt16LE(0, 4);
  eocdForV2.writeUInt16LE(0, 6);
  eocdForV2.writeUInt16LE(entries.length, 8);
  eocdForV2.writeUInt16LE(entries.length, 10);
  eocdForV2.writeUInt32LE(centralDirSection.length, 12);
  eocdForV2.writeUInt32LE(contentsSection.length, 16);
  eocdForV2.writeUInt16LE(0, 20);

  // Build APK Signature Scheme v2 Block (ID 0x7109871a)
  const apkV2Block = buildApkSigBlockV2(
    contentsSection,
    centralDirSection,
    eocdForV2,
    fs.readFileSync(keyPath, 'utf8'),
    certDerBuf
  );

  // Update EOCD with the new Central Directory offset (after APK Sig Block)
  const finalEocd = Buffer.from(eocdForV2);
  finalEocd.writeUInt32LE(contentsSection.length + apkV2Block.length, 16);

  const finalApk = Buffer.concat([contentsSection, apkV2Block, centralDirSection, finalEocd]);
  fs.writeFileSync(outputPath, finalApk);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return finalApk.length;
}

/**
 * Builds APK Signature Scheme v2 ("APK Sig Block 42") for Android 7.0 – Android 15 compatibility
 */
function buildApkSigBlockV2(contentsBuf, cdBuf, eocdBuf, privateKeyPem, certDerBuf) {
  const CHUNK_SIZE = 1024 * 1024;

  function digestChunks(buffers) {
    const chunkDigests = [];
    for (const buf of buffers) {
      let pos = 0;
      while (pos < buf.length) {
        const slice = buf.subarray(pos, Math.min(pos + CHUNK_SIZE, buf.length));
        const header = Buffer.alloc(5);
        header.writeUInt8(0xa5, 0);
        header.writeUInt32LE(slice.length, 1);
        const d = crypto.createHash('sha256').update(header).update(slice).digest();
        chunkDigests.push(d);
        pos += slice.length;
      }
    }
    const topHeader = Buffer.alloc(5);
    topHeader.writeUInt8(0x5a, 0);
    topHeader.writeUInt32LE(chunkDigests.length, 1);
    return crypto
      .createHash('sha256')
      .update(topHeader)
      .update(Buffer.concat(chunkDigests))
      .digest();
  }

  const topDigest = digestChunks([contentsBuf, cdBuf, eocdBuf]);

  const lenPrefixed = (buf) => {
    const l = Buffer.alloc(4);
    l.writeUInt32LE(buf.length, 0);
    return Buffer.concat([l, buf]);
  };

  // Signature algorithm 0x0103 = RSASSA-PKCS1-v1_5 with SHA2-256
  const SIG_ALGO_RSA_PKCS1_SHA256 = 0x0103;

  // digest entry: uint32 algoId + lenPrefixed(digest)
  const algoBuf = Buffer.alloc(4);
  algoBuf.writeUInt32LE(SIG_ALGO_RSA_PKCS1_SHA256, 0);
  const digestEntry = lenPrefixed(Buffer.concat([algoBuf, lenPrefixed(topDigest)]));
  const digestsSeq = lenPrefixed(digestEntry);

  const certsSeq = lenPrefixed(lenPrefixed(certDerBuf));
  const additionalAttrsSeq = lenPrefixed(Buffer.alloc(0));

  const signedData = Buffer.concat([
    digestsSeq,
    certsSeq,
    additionalAttrsSeq,
    Buffer.alloc(4, 0), // v2 padding
  ]);
  // Note: v2 signed data format is: digests (len-prefixed), certificates (len-prefixed), additional_attributes (len-prefixed)
  const signedDataPure = Buffer.concat([digestsSeq, certsSeq, additionalAttrsSeq]);

  const signatureBytes = crypto.sign('sha256', signedDataPure, privateKeyPem);
  const signatureEntry = lenPrefixed(Buffer.concat([algoBuf, lenPrefixed(signatureBytes)]));
  const signaturesSeq = lenPrefixed(signatureEntry);

  const pubKeySpki = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });

  const signerBlock = lenPrefixed(
    Buffer.concat([
      lenPrefixed(signedDataPure),
      signaturesSeq,
      lenPrefixed(pubKeySpki),
    ])
  );
  const signersSeq = lenPrefixed(signerBlock);

  // Pair: uint64 length, uint32 ID (0x7109871a), value (signersSeq)
  const pairBody = Buffer.alloc(4 + signersSeq.length);
  pairBody.writeUInt32LE(0x7109871a, 0);
  signersSeq.copy(pairBody, 4);

  const pairLenBuf = Buffer.alloc(8);
  pairLenBuf.writeBigUInt64LE(BigInt(pairBody.length), 0);
  const pairsBuf = Buffer.concat([pairLenBuf, pairBody]);

  // Block size excluding first 8 bytes = pairsBuf.length + 8 (second size) + 16 (magic)
  const blockSizeField = BigInt(pairsBuf.length + 24);
  const sizeBuf1 = Buffer.alloc(8);
  sizeBuf1.writeBigUInt64LE(blockSizeField, 0);
  const sizeBuf2 = Buffer.from(sizeBuf1);
  const magicBuf = Buffer.from('APK Sig Block 42', 'ascii');

  return Buffer.concat([sizeBuf1, pairsBuf, sizeBuf2, magicBuf]);
}

const outPath = path.resolve('/app/applet/public/InteractiveReader.apk');
const sizeBytes = buildSignedApk(outPath);
console.log(`Successfully built signed APK at ${outPath} (${sizeBytes} bytes)`);
