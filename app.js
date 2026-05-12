let file, app, bar, qcount, nextBtn, timer, chart;

const SESSION_KEY = 'testSession';
const LIB_KEY = 'testLibrary';
const CURRENT_TEST_KEY = 'currentTest';
const MISTAKE_STATS_KEY = 'mistakeStats';
const FAVORITES_KEY = 'favorites';
const MISTAKES_LIST_KEY = 'mistakesList';

window.onload = () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js');
    }
    file = document.getElementById("file");
    app = document.getElementById("app");
    bar = document.getElementById("bar");
    qcount = document.getElementById("qcount");
    nextBtn = document.getElementById("nextBtn");
    timer = document.getElementById("timer");
    chart = document.getElementById("chart");

    file.onchange = e => {
        if (!e.target.files.length) return;
        for (let i = 0; i < e.target.files.length; i++) {
            const f = e.target.files[i];
            const reader = new FileReader();
            reader.onload = x => {
                const questions = parse(x.target.result);
                if (!questions.length) {
                    alert("Файл «" + f.name + "» не содержит вопросов");
                    return;
                }
                const testName = f.name.replace(/\.txt$/i, '');
                addTestToLibrary(testName, questions);
                renderTestList();
            };
            reader.readAsText(f);
        }
        file.value = '';
        file.style.display = 'none';
    };

    renderTestList();

    const saved = loadSession();
    if (saved) {
        if (confirm('У вас есть незавершённый тест. Продолжить?')) {
            restoreSession(saved);
        } else {
            clearSession();
        }
    } else {
        const currentName = localStorage.getItem(CURRENT_TEST_KEY);
        if (currentName && getLibrary()[currentName]) {
            selectTest(currentName, false);
            loadMistakesFromStorage();
        }
    }

    updateFavoritesButton();
    playerLevel = Math.floor(totalScore / 200) + 1;
    renderProfile();
    loadTheme();
};

let all = [], list = [], mistakes = [];
let index = 0;
let random = false;
let answered = false;
let exam = false;
let time = 0;
let timerInt = null;
let mistakesReviewMode = false;
let totalScore = parseInt(localStorage.getItem('totalScore') || '0');
let playerLevel = 1;
let achievements = JSON.parse(localStorage.getItem('achievements') || '[]');

// ─── Библиотека тестов ──────
function getLibrary() {
    try { return JSON.parse(localStorage.getItem(LIB_KEY)) || {}; }
    catch (e) { return {}; }
}
function saveLibrary(lib) { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); }
function addTestToLibrary(name, questions) {
    const lib = getLibrary();
    lib[name] = { name, questions };
    saveLibrary(lib);
}

function deleteTestFromLibrary(name) {
    const lib = getLibrary();
    delete lib[name];
    saveLibrary(lib);
    clearMistakeStatsForTest(name);
    clearMistakesListForTest(name);
    clearFavoritesForTest(name);
    if (localStorage.getItem(CURRENT_TEST_KEY) === name) {
        localStorage.removeItem(CURRENT_TEST_KEY);
        all = [];
        document.getElementById("settingsPanel").style.display = "none";
        document.getElementById("currentTestLabel").textContent = '';
        document.getElementById("currentTestLabel").style.display = 'none';
    }
    renderTestList();
    updateFavoritesButton();
}

function renderTestList() {
    const lib = getLibrary();
    const container = document.getElementById("testList");
    const names = Object.keys(lib);
    const currentName = localStorage.getItem(CURRENT_TEST_KEY);
    if (names.length === 0) {
        container.innerHTML = '<p style="color: rgba(255,255,255,0.5);">У вас пока нет тестов. Загрузите хотя бы один.</p>';
    } else {
        container.innerHTML = names.map(name => {
            const activeClass = (name === currentName) ? ' active' : '';
            return `<div class="testItem${activeClass}">
                <span>${escHtml(name)} (${lib[name].questions.length} вопр.)</span>
                <div class="testItemButtons">
                    <button class="selectTest" data-name="${escHtml(name)}">▶</button>
                    <button class="deleteTest" data-name="${escHtml(name)}">🗑</button>
                </div>
            </div>`;
        }).join('');
    }

    document.querySelectorAll('.selectTest').forEach(btn => {
        btn.onclick = () => selectTest(btn.dataset.name, true);
    });
    document.querySelectorAll('.deleteTest').forEach(btn => {
        btn.onclick = () => {
            if (confirm('Удалить тест «' + btn.dataset.name + '»?')) {
                deleteTestFromLibrary(btn.dataset.name);
            }
        };
    });
}

function selectTest(name, showAlert = true) {
    const lib = getLibrary();
    const test = lib[name];
    if (!test) return;
    all = test.questions;
    clearSession();
    localStorage.setItem(CURRENT_TEST_KEY, name);
    const label = document.getElementById("currentTestLabel");
    label.textContent = '📖 ' + name;
    label.style.display = 'block';
    document.getElementById("settingsPanel").style.display = "block";
    if (showAlert) {
        alert('Выбран тест: ' + name + ' (' + all.length + ' вопросов)');
        document.getElementById("settingsPanel").scrollIntoView({ behavior: 'smooth' });
    }
    loadMistakesFromStorage();
    renderTestList();
    updateFavoritesButton();
}

function showFileInput() {
    file.style.display = 'block';
    file.click();
}

// ─── Логика теста ──────
function start() {
    if (!all.length) return alert("Сначала выберите тест");
    exam = confirm("Включить режим экзамена?");
    let count = parseInt(countInput());
    let range = parseRange();
    let pool = [...all];
    if (range)
        pool = pool.filter(q => q.number >= range.min && q.number <= range.max);
    if (random) {
        pool = shuffle(pool);
        pool.forEach(q => shuffleAnswers(q));
    }
    if (count && count < pool.length)
        pool = pool.slice(0, count);
    list = pool;
    index = 0;
    drawChart();
    mistakesReviewMode = false;
    if (!list.length) {
        alert("Нет вопросов в выбранном диапазоне");
        return;
    }
    time = list.length * (exam ? 10 : 15);
    clearInterval(timerInt);
    startTimer();
    show();
    saveSession();
}

function countInput() { return document.getElementById("count").value; }

function parseRange() {
    let val = document.getElementById("range").value;
    if (!val.includes("-")) return null;
    let [a, b] = val.split("-").map(Number);
    if (isNaN(a) || isNaN(b)) return null;
    if (a > b) [a, b] = [b, a];
    return { min: a, max: b };
}

function show() {
    if (index >= list.length) return finish();
    answered = false;
    nextBtn.style.display = "none";
    let q = list[index];
    qcount.textContent = `${index + 1} / ${list.length}`;
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    app.innerHTML =
        `<div class="card" style="position: relative;">
            <span class="fav-star"
                  data-test="${escHtml(currentTestName)}"
                  data-qnumber="${q.number}"
                  onclick="toggleFavorite(event)">${isFavorite(currentTestName, q.number) ? '★' : '☆'}</span>
            <h3>${q.number}. ${esc(q.text)}</h3>
            ${q.options.map((o, i) =>
                `<div class="option" onclick="ans(${i})">${o}</div>`
            ).join("")}
        </div>`;
    bar.style.width = (index / list.length * 100) + "%";
}

function ans(i) {
    if (answered) return;
    answered = true;
    let q = list[index];
    let nodes = document.querySelectorAll(".option");
    nodes[q.correct].classList.add("correct");

    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);

    if (i !== q.correct) {
        nodes[i].classList.add("wrong");
        if (currentTestName) {
            addMistake(currentTestName, q.number);
            addMistakeToList(currentTestName, q.number);
        }
        if (!mistakes.some(m => m.number === q.number)) {
            mistakes.push(q);
        }
    } else {
        if (mistakesReviewMode && currentTestName) {
            removeMistakeFromList(currentTestName, q.number);
            mistakes = mistakes.filter(m => m.number !== q.number);
        }
    }

    saveSession();
    if (!exam) {
        nextBtn.style.display = "block";
    } else {
        setTimeout(() => {
            index++;
            saveSession();
            show();
        }, 700);
    }
}

function next() {
    index++;
    saveSession();
    show();
}

function finish() {
    if (!list.length) return;
    nextBtn.style.display = "none";
    clearInterval(timerInt);
    timerInt = null;
    let correct = list.length - mistakes.length;
    let percent = Math.round(correct / list.length * 100);
    saveResult(percent);
    drawChart();
    updateScoreAndAchievements(correct, list.length, percent);
    mistakesReviewMode = false;
    clearSession();
    alert(`Результат экзамена\nПравильных: ${correct}/${list.length}\nПроцент: ${percent}%`);
}

function reviewAll() {
    if (!all.length) return alert("Сначала выберите тест");
    mistakesReviewMode = false;
    nextBtn.style.display = "none";
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    app.innerHTML = all.map(q => `
        <div class="card" style="position: relative;">
            <span class="fav-star"
                  data-test="${escHtml(currentTestName)}"
                  data-qnumber="${q.number}"
                  onclick="toggleFavorite(event)">${isFavorite(currentTestName, q.number) ? '★' : '☆'}</span>
            <h3>${q.number}. ${q.text}</h3>
            ${q.options.map((o, i) =>
                `<div class="option ${i === q.correct ? "correct" : ""}">${esc(o)}</div>`
            ).join("")}
        </div>
    `).join("");
    bar.style.width = "100%";
    qcount.textContent = "Режим просмотра";
}

function toggleRandom() {
    if (exam) return alert("В экзамене нельзя менять режим");
    random = !random;
    let btn = document.getElementById("randomBtn");
    btn.style.background = random ? "#22c55e" : "#3b82f6";
    btn.textContent = random ? "Random ON" : "Random";
    saveSession();
}

// ══════ Режим «Ошибки» ══════
function mistakesMode() {
    if (exam) return alert("В экзамене недоступно");
    if (!mistakes.length) return alert("Ошибок нет");
    mistakesReviewMode = true;
    list = [...mistakes];
    index = 0;
    clearInterval(timerInt);
    timerInt = null;
    time = 0;
    timer.textContent = '';
    saveSession();
    show();
}

// ══════ Избранное ══════
function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || {}; }
    catch (e) { return {}; }
}
function saveFavorites(favs) { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs)); }
function addFavorite(testName, qNumber) {
    const favs = getFavorites();
    if (!favs[testName]) favs[testName] = [];
    if (!favs[testName].includes(qNumber)) {
        favs[testName].push(qNumber);
        saveFavorites(favs);
    }
}
function removeFavorite(testName, qNumber) {
    const favs = getFavorites();
    if (favs[testName]) {
        favs[testName] = favs[testName].filter(n => n !== qNumber);
        if (favs[testName].length === 0) delete favs[testName];
        saveFavorites(favs);
    }
}
function isFavorite(testName, qNumber) {
    const favs = getFavorites();
    return favs[testName] && favs[testName].includes(qNumber);
}
function clearFavoritesForTest(testName) {
    const favs = getFavorites();
    delete favs[testName];
    saveFavorites(favs);
}
function favoritesMode() {
    if (exam) return alert("В экзамене недоступно");
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentTestName) return alert("Сначала выберите тест");
    const lib = getLibrary();
    const test = lib[currentTestName];
    if (!test) return alert("Тест не найден");
    const favNums = getFavorites()[currentTestName] || [];
    if (!favNums.length) return alert("Нет избранных вопросов");
    const favQuestions = test.questions
        .filter(q => favNums.includes(q.number))
        .sort((a, b) => a.number - b.number);
    if (!favQuestions.length) return alert("Нет избранных вопросов (вопросы не найдены)");
    list = favQuestions;
    index = 0;
    mistakes = [];
    mistakesReviewMode = false;
    clearInterval(timerInt);
    timerInt = null;
    time = 0;
    timer.textContent = '';
    saveSession();
    show();
    updateFavoritesButton();
}
function toggleFavorite(event) {
    event.stopPropagation();
    const star = event.currentTarget;
    const testName = star.dataset.test;
    const qNumber = parseInt(star.dataset.qnumber);
    if (!testName || isNaN(qNumber)) return;
    if (isFavorite(testName, qNumber)) {
        removeFavorite(testName, qNumber);
        star.textContent = '☆';
    } else {
        addFavorite(testName, qNumber);
        star.textContent = '★';
    }
    updateFavoritesButton();
}
function updateFavoritesButton() {
    const btn = document.getElementById('favoritesBtn');
    if (!btn) return;
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentTestName) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.textContent = '⭐ Избранное';
        return;
    }
    const favs = getFavorites();
    const favCount = favs[currentTestName] ? favs[currentTestName].length : 0;
    btn.textContent = `⭐ Избранное (${favCount})`;
    btn.disabled = favCount === 0;
    btn.style.opacity = favCount === 0 ? '0.5' : '1';
}

// ══════ Список ошибок (persistent) ══════
function getMistakesList() {
    try { return JSON.parse(localStorage.getItem(MISTAKES_LIST_KEY)) || {}; }
    catch (e) { return {}; }
}
function saveMistakesList(data) { localStorage.setItem(MISTAKES_LIST_KEY, JSON.stringify(data)); }
function addMistakeToList(testName, qNumber) {
    const list = getMistakesList();
    if (!list[testName]) list[testName] = [];
    if (!list[testName].includes(qNumber)) {
        list[testName].push(qNumber);
        saveMistakesList(list);
    }
}
function removeMistakeFromList(testName, qNumber) {
    const list = getMistakesList();
    if (list[testName]) {
        list[testName] = list[testName].filter(n => n !== qNumber);
        if (list[testName].length === 0) delete list[testName];
        saveMistakesList(list);
    }
}
function clearMistakesListForTest(testName) {
    const list = getMistakesList();
    delete list[testName];
    saveMistakesList(list);
}
function loadMistakesFromStorage() {
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentTestName) {
        mistakes = [];
        return;
    }
    const lib = getLibrary();
    const test = lib[currentTestName];
    if (!test) {
        mistakes = [];
        return;
    }
    const list = getMistakesList();
    const nums = list[currentTestName] || [];
    mistakes = test.questions.filter(q => nums.includes(q.number));
}

// ══════ Накопительная статистика ошибок ══════
function getMistakeStats() {
    try { return JSON.parse(localStorage.getItem(MISTAKE_STATS_KEY)) || {}; }
    catch (e) { return {}; }
}
function saveMistakeStats(stats) { localStorage.setItem(MISTAKE_STATS_KEY, JSON.stringify(stats)); }
function addMistake(testName, questionNumber) {
    const stats = getMistakeStats();
    if (!stats[testName]) stats[testName] = {};
    stats[testName][questionNumber] = (stats[testName][questionNumber] || 0) + 1;
    saveMistakeStats(stats);
}
function removeMistakeStat(testName, questionNumber) {
    const stats = getMistakeStats();
    if (stats[testName]) {
        delete stats[testName][questionNumber];
        if (Object.keys(stats[testName]).length === 0) {
            delete stats[testName];
        }
        saveMistakeStats(stats);
    }
}
function clearMistakeStatsForTest(testName) {
    const stats = getMistakeStats();
    delete stats[testName];
    saveMistakeStats(stats);
}
function reviewMistakeStats() {
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentTestName) return alert("Сначала выберите тест");
    const lib = getLibrary();
    const test = lib[currentTestName];
    if (!test) return alert("Тест не найден");
    const stats = getMistakeStats();
    const testStats = stats[currentTestName] || {};
    const mistakeQuestions = test.questions.filter(q => testStats[q.number] > 0);
    if (!mistakeQuestions.length) {
        return alert("У вас нет сохранённых ошибок по этому тесту");
    }
    nextBtn.style.display = "none";
    bar.style.width = "0%";
    qcount.textContent = "📊 Статистика ошибок";
    app.innerHTML = mistakeQuestions.map(q => {
        const errCount = testStats[q.number];
        return `
            <div class="card" style="position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3>${q.number}. ${esc(q.text)}</h3>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="cursor:pointer; font-size:24px; color:#ffd700; text-shadow:0 0 10px rgba(255,215,0,0.6);"
                              data-test="${escHtml(currentTestName)}"
                              data-qnumber="${q.number}"
                              onclick="toggleFavorite(event)">${isFavorite(currentTestName, q.number) ? '★' : '☆'}</span>
                        <span style="font-size: 14px; color: #ff8a80; margin-left: 10px;">Ошибок: ${errCount}</span>
                    </div>
                </div>
                ${q.options.map((o, i) => {
                    const cls = i === q.correct ? "correct" : "";
                    return `<div class="option ${cls}">${esc(o)}</div>`;
                }).join("")}
                <button
                    class="deleteMistakeBtn"
                    data-test="${escHtml(currentTestName)}"
                    data-qnumber="${q.number}"
                    style="position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; padding: 0; border-radius: 50%; background: rgba(255,82,82,0.8); font-size: 16px; line-height: 30px;"
                >🗑</button>
            </div>
        `;
    }).join("");
    document.querySelectorAll('.deleteMistakeBtn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const testName = btn.dataset.test;
            const qNumber = parseInt(btn.dataset.qnumber);
            removeMistakeStat(testName, qNumber);
            reviewMistakeStats();
        };
    });
}

// ─── Вспомогательные функции ──────
function shuffle(a) {
    return a.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
}
function shuffleAnswers(q) {
    let arr = q.options.map((text, i) => ({ text, correct: i === q.correct }));
    for (let i = arr.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    q.options = arr.map(x => x.text);
    q.correct = arr.findIndex(x => x.correct);
}
function drawChart() {
    let ctx = chart.getContext("2d");
    ctx.clearRect(0, 0, chart.width, chart.height);
    let h = JSON.parse(localStorage.getItem("hist") || "[]");
    if (!h.length) return;
    let w = chart.width / h.length;
    h.forEach((p, i) => {
        if (p < 50) ctx.fillStyle = "#ef4444";
        else if (p < 75) ctx.fillStyle = "#f59e0b";
        else ctx.fillStyle = "#22c55e";
        ctx.fillRect(i * w, chart.height, w - 4, -p);
    });
}
function clearStats() {
    if (!confirm("Удалить историю результатов?")) return;
    localStorage.removeItem("hist");
    drawChart();
}
function esc(s) { return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function escHtml(s) { return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#039;"); }
function saveResult(p) {
    let h = JSON.parse(localStorage.getItem("hist") || "[]");
    h.push(p);
    localStorage.setItem("hist", JSON.stringify(h));
}

// ─── Сессия ──────
function saveSession() {
    if (!list.length || index >= list.length) return;
    const session = { all, list, index, mistakes, exam, random, time };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
}
function loadSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (data.all && data.list && typeof data.index === 'number') return data;
    } catch (e) {}
    return null;
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function restoreSession(session) {
    all = session.all;
    list = session.list;
    index = session.index;
    mistakes = session.mistakes || [];
    exam = session.exam;
    random = session.random;
    time = session.time;
    mistakesReviewMode = false;
    let randBtn = document.getElementById("randomBtn");
    if (random) {
        randBtn.style.background = "#22c55e";
        randBtn.textContent = "Random ON";
    } else {
        randBtn.style.background = "#3b82f6";
        randBtn.textContent = "Random";
    }
    clearInterval(timerInt);
    startTimer();
    show();
    document.getElementById("settingsPanel").style.display = "block";
}

function startTimer() {
    timerInt = setInterval(() => {
        time--;
        if (time < 0) time = 0;
        timer.textContent = "⏱ " + time + "s";
    }, 1000);
}

// ─── Парсинг ──────
function parse(text) {
    text = text.replace(/\r/g, "").replace(/—|–/g, "-");
    let lines = text.split("\n").map(x => x.trim()).filter(Boolean);
    let qs = [];
    let ans = [];
    let block = false;
    let cur = null;
    for (let l of lines) {
        if (l.includes("===== ОТВЕТЫ =====")) { block = true; continue; }
        if (block) {
            let a = parseAns(l);
            if (a != null) ans.push(a);
            continue;
        }
        let q = l.match(/^(\d+)[\.\)]\s*(.+)/);
        if (q) {
            cur = { number: +q[1], text: q[2], options: [], correct: 0 };
            qs.push(cur);
            continue;
        }
        let o = l.match(/^[A-DА-Г1-4][\)\.\:]?\s*(.+)/);
        if (o && cur) {
            cur.options.push(o[1]);
            continue;
        }
        if (cur) cur.text += " " + l;
    }
    qs.forEach((q, i) => { if (ans[i] !== undefined) q.correct = ans[i]; });
    return qs;
}
function parseAns(l) {
    let m = l.match(/[:\-]\s*([A-DА-Г1-4])/);
    if (m) return conv(m[1]);
    m = l.match(/^[A-DА-Г1-4]$/);
    if (m) return conv(m[0]);
    m = l.match(/([A-DА-Г])/);
    if (m) return conv(m[1]);
    return null;
}
function conv(s) {
    s = s.toUpperCase();
    if ("AА1".includes(s)) return 0;
    if ("BБ2".includes(s)) return 1;
    if ("CВ3".includes(s)) return 2;
    if ("DГ4".includes(s)) return 3;
    return 0;
}

// ══════ Прогресс и геймификация ══════
function updateScoreAndAchievements(correct, total, percent) {
    let points = correct * 10;
    if (percent === 100) points += 50;
    points += 10;
    totalScore += points;
    localStorage.setItem('totalScore', totalScore);
    playerLevel = Math.floor(totalScore / 200) + 1;

    const newAchievements = [];
    if (percent === 100 && !achievements.includes('perfect_test')) {
        achievements.push('perfect_test');
        newAchievements.push('Идеальный тест (100%)');
    }
    if (correct === total && !achievements.includes('all_correct')) {
        achievements.push('all_correct');
        newAchievements.push('Все ответы верны');
    }
    if (totalScore >= 100 && !achievements.includes('score_100')) {
        achievements.push('score_100');
        newAchievements.push('Набрано 100 очков');
    }
    if (totalScore >= 500 && !achievements.includes('score_500')) {
        achievements.push('score_500');
        newAchievements.push('Набрано 500 очков');
    }

    if (newAchievements.length) {
        alert('🏆 Новые достижения:\n' + newAchievements.join('\n'));
    }
    localStorage.setItem('achievements', JSON.stringify(achievements));
    renderProfile();
}

function renderProfile() {
    const info = document.getElementById('profileInfo');
    const listEl = document.getElementById('achievementsList');
    if (!info || !listEl) return;

    info.innerHTML = `⭐ Очки: ${totalScore} | Уровень: ${playerLevel}`;
    const achievementNames = {
        perfect_test: 'Идеальный тест',
        all_correct: 'Все ответы верны',
        score_100: '100 очков',
        score_500: '500 очков'
    };
    listEl.innerHTML = achievements.length
        ? achievements.map(a => `<span class="achievement">${achievementNames[a] || a}</span>`).join('')
        : 'Пока нет достижений';
}

// ══════ Редактор теста ══════
let allQuestionsForEdit = [];

function editTest() {
    const currentName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentName) return alert('Сначала выберите тест');
    const lib = getLibrary();
    const test = lib[currentName];
    if (!test) return alert('Тест не найден');

    allQuestionsForEdit = JSON.parse(JSON.stringify(test.questions));

    nextBtn.style.display = 'none';
    clearInterval(timerInt);
    timerInt = null;
    qcount.textContent = '✏️ Редактирование: ' + currentName;
    bar.style.width = '0%';

    let html = '<div style="max-height:70vh; overflow-y:auto;">';
    allQuestionsForEdit.forEach((q, idx) => {
        html += `
        <div class="editQuestionBlock" data-qindex="${idx}">
            <label>Вопрос №${q.number}</label>
            <textarea id="eq_text_${idx}" rows="2">${escHtml(q.text)}</textarea>
            <label>Варианты ответов:</label>
            <div id="eq_options_${idx}">
                ${q.options.map((opt, oi) => `
                    <div class="optionRow">
                        <input type="text" value="${escHtml(opt)}" data-oidx="${oi}">
                        <button onclick="removeOption(${idx}, ${oi})">✕</button>
                    </div>
                `).join('')}
            </div>
            <button onclick="addOption(${idx})" style="width:auto; margin-top:8px;">+ Добавить вариант</button>
            <label class="correctSelect">Правильный ответ:</label>
            <select id="eq_correct_${idx}">
                ${q.options.map((_, oi) => `<option value="${oi}" ${oi === q.correct ? 'selected' : ''}>${oi+1}</option>`).join('')}
            </select>
            <button onclick="deleteQuestion(${idx})" style="background: #ff4757; margin-top:12px;">🗑 Удалить вопрос</button>
        </div>
        `;
    });
    html += '</div>';
    html += '<button onclick="addNewQuestion()" style="margin-bottom:8px;">➕ Добавить вопрос</button>';
    html += '<button onclick="saveEditedTest()" style="background: #22c55e;">💾 Сохранить тест</button>';
    html += '<button onclick="reviewAll()" style="background: #666;">Отмена</button>';

    app.innerHTML = html;
}

function removeOption(qIdx, oIdx) {
    const container = document.getElementById(`eq_options_${qIdx}`);
    if (!container) return;
    const rows = container.querySelectorAll('.optionRow');
    if (rows.length <= 2) return alert('Должно быть минимум два варианта');
    rows[oIdx].remove();
    updateCorrectSelect(qIdx);
}

function addOption(qIdx) {
    const container = document.getElementById(`eq_options_${qIdx}`);
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'optionRow';
    div.innerHTML = `<input type="text" value="" placeholder="Новый вариант">
                     <button onclick="removeOption(${qIdx}, this.parentElement.rowIndex)">✕</button>`;
    container.appendChild(div);
    updateCorrectSelect(qIdx);
}

function updateCorrectSelect(qIdx) {
    const container = document.getElementById(`eq_options_${qIdx}`);
    const select = document.getElementById(`eq_correct_${qIdx}`);
    if (!container || !select) return;
    const count = container.querySelectorAll('.optionRow').length;
    select.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i+1;
        select.appendChild(option);
    }
}

function deleteQuestion(qIdx) {
    if (!confirm('Удалить этот вопрос?')) return;
    document.querySelector(`.editQuestionBlock[data-qindex="${qIdx}"]`).remove();
}

function addNewQuestion() {
    const maxNumber = allQuestionsForEdit.length > 0 
        ? Math.max(...allQuestionsForEdit.map(q => q.number)) 
        : 0;
    const newNumber = maxNumber + 1;
    allQuestionsForEdit.push({ number: newNumber, text: '', options: ['', ''], correct: 0 });
    const idx = allQuestionsForEdit.length - 1;

    const editArea = document.querySelector('#app > div:first-child');
    if (!editArea) return;

    const block = document.createElement('div');
    block.className = 'editQuestionBlock';
    block.dataset.qindex = idx;
    block.innerHTML = `
        <label>Вопрос №${newNumber}</label>
        <textarea id="eq_text_${idx}" rows="2"></textarea>
        <label>Варианты ответов:</label>
        <div id="eq_options_${idx}">
            <div class="optionRow"><input type="text" value="" data-oidx="0"><button onclick="removeOption(${idx}, 0)">✕</button></div>
            <div class="optionRow"><input type="text" value="" data-oidx="1"><button onclick="removeOption(${idx}, 1)">✕</button></div>
        </div>
        <button onclick="addOption(${idx})" style="width:auto; margin-top:8px;">+ Добавить вариант</button>
        <label class="correctSelect">Правильный ответ:</label>
        <select id="eq_correct_${idx}">
            <option value="0">1</option>
            <option value="1">2</option>
        </select>
        <button onclick="deleteQuestion(${idx})" style="background: #ff4757; margin-top:12px;">🗑 Удалить вопрос</button>
    `;
    editArea.appendChild(block);
}

function saveEditedTest() {
    const currentName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentName) return;

    const questionBlocks = document.querySelectorAll('.editQuestionBlock');
    const newQuestions = [];

    for (let block of questionBlocks) {
        const idx = block.dataset.qindex;
        const number = parseInt(block.querySelector('label').textContent.match(/\d+/)[0]);
        const text = document.getElementById(`eq_text_${idx}`)?.value.trim();
        if (!text) continue;

        const optionInputs = block.querySelectorAll('.optionRow input');
        const options = Array.from(optionInputs).map(inp => inp.value.trim()).filter(Boolean);
        if (options.length < 2) {
            alert(`Вопрос №${number} должен иметь минимум два варианта`);
            return;
        }
        const correctSelect = document.getElementById(`eq_correct_${idx}`);
        const correct = correctSelect ? parseInt(correctSelect.value) : 0;

        newQuestions.push({ number, text, options, correct });
    }

    const lib = getLibrary();
    lib[currentName].questions = newQuestions;
    saveLibrary(lib);

    if (localStorage.getItem(CURRENT_TEST_KEY) === currentName) {
        all = newQuestions;
    }

    alert('Тест сохранён!');
    reviewAll();
}

// ══════ Темы оформления ══════
function setTheme(theme) {
    document.body.className = 'theme-' + theme;
    localStorage.setItem('appTheme', theme);
    document.getElementById('themeSelector').style.display = 'none';
    updateThemeButton();
}

function toggleThemeMenu() {
    const sel = document.getElementById('themeSelector');
    sel.style.display = sel.style.display === 'none' ? 'block' : 'none';
}

function updateThemeButton() {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    const current = localStorage.getItem('appTheme') || 'purple';
    const emojis = { purple: '💜', dachshund: '🌭', forest: '🌲', space: '🚀', retro: '📟' };
    btn.textContent = `${emojis[current] || '🎨'} Тема`;
}

function loadTheme() {
    const saved = localStorage.getItem('appTheme') || 'purple';
    document.body.className = 'theme-' + saved;
    updateThemeButton();
}