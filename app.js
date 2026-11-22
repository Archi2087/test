let file, app, bar, qcount, nextBtn, timer, chart;

const SESSION_KEY = 'testSession';
const LIB_KEY = 'testLibrary';
const CURRENT_TEST_KEY = 'currentTest';
const MISTAKE_STATS_KEY = 'mistakeStats';
const FAVORITES_KEY = 'favorites';
const MISTAKES_LIST_KEY = 'mistakesList';
const DAILY_GOALS_KEY = 'dailyGoals';

// Ежедневные задания (шаблон)
const DAILY_GOALS_TEMPLATE = [
    { id: 'complete_test', description: 'Пройти тест', target: 1, reward: 20 },
    { id: 'correct_answers', description: 'Правильных ответов', target: 20, reward: 30 },
    { id: 'review_mistakes', description: 'Просмотреть статистику ошибок', target: 1, reward: 10 },
    { id: 'perfect_test', description: 'Идеальный тест (100%)', target: 1, reward: 50 }
];

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

    file.onchange = async e => {
        const files = Array.from(e.target.files || []);
        file.value = '';
        file.style.display = 'none';
        for (const f of files) {
            try {
                const text = await extractTextFromFile(f);
                const questions = parse(text);
                if (!questions.length) {
                    showAlertModal(`Файл «${f.name}» не содержит распознанных вопросов. Проверь формат и наличие текстового слоя.`);
                    continue;
                }
                const testName = f.name.replace(/\.(txt|docx|pdf)$/i, '');
                await new Promise(resolve => showCategoryModal('', category => {
                    addTestToLibrary(testName, questions, category);
                    renderTestList();
                    resolve();
                }));
            } catch (error) {
                console.error('Ошибка импорта', f.name, error);
                showAlertModal(`Не удалось импортировать «${f.name}»: ${error.message || 'неизвестная ошибка'}`);
            }
        }
    };

    // Поле поиска вопроса
    const searchInput = document.getElementById('questionSearch');
    searchInput.addEventListener('input', function(e) {
        searchQuery = e.target.value.trim().toLowerCase();
        if (currentViewMode) {
            switch (currentViewMode) {
                case 'review': reviewAll(); break;
                case 'mistakeStats': reviewMistakeStats(); break;
                case 'heatmap': showHeatmap(); break;
            }
        }
    });

    renderTestList();
    checkSessionAndContinue();
    updateFavoritesButton();
    playerLevel = Math.floor(totalScore / 200) + 1;
    renderProfile();
    loadTheme();
    migrateLibrary();      // гарантируем наличие категории у старых тестов
    initDailyGoals();
    updateConnectionStatus();
    renderDueReminder();
};

let all = [], list = [], mistakes = [];
let index = 0;
let random = false;
let answered = false;
let exam = false;
let time = 0;
let timerInt = null;
let mistakesReviewMode = false;
let selectedAnswers = new Set();
let totalScore = parseInt(localStorage.getItem('totalScore') || '0');
let playerLevel = 1;
let achievements = JSON.parse(localStorage.getItem('achievements') || '[]');

// Поиск и режим просмотра
let searchQuery = '';
let currentViewMode = null;   // 'review', 'mistakeStats', 'heatmap'

// ─── Библиотека тестов ──────
function getLibrary() {
    try { return JSON.parse(localStorage.getItem(LIB_KEY)) || {}; }
    catch (e) { return {}; }
}
function saveLibrary(lib) { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); }

function addTestToLibrary(name, questions, category = 'Без категории') {
    const lib = getLibrary();
    lib[name] = { name, questions, category };
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
        resetViewMode();
    }
    renderTestList();
    updateFavoritesButton();
}

function getCategories() {
    const lib = getLibrary();
    const cats = new Set();
    for (let name in lib) {
        cats.add(lib[name].category || 'Без категории');
    }
    return Array.from(cats).sort();
}

function changeTestCategory(testName, newCategory) {
    const lib = getLibrary();
    if (lib[testName]) {
        lib[testName].category = newCategory;
        saveLibrary(lib);
        renderTestList();
    }
}

function renderTestList() {
    const lib = getLibrary();
    const container = document.getElementById("testList");
    const names = Object.keys(lib);
    const currentName = localStorage.getItem(CURRENT_TEST_KEY);

    if (names.length === 0) {
        container.innerHTML = '<p style="color: rgba(255,255,255,0.5);">У вас пока нет тестов. Загрузите хотя бы один.</p>';
        return;
    }

    // Группировка по категориям
    const grouped = {};
    names.forEach(name => {
        const cat = lib[name].category || 'Без категории';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(name);
    });

    // Сортировка категорий, внутри — по имени теста
    const sortedCategories = Object.keys(grouped).sort((a,b) => a.localeCompare(b, 'ru'));
    let html = '';
    sortedCategories.forEach(cat => {
        html += `<div class="category-header">📁 ${escHtml(cat)}</div>`;
        const sortedNames = grouped[cat].sort((a,b) => a.localeCompare(b, 'ru'));
        sortedNames.forEach(name => {
            const activeClass = (name === currentName) ? ' active' : '';
            html += `<div class="testItem${activeClass}">
                <span>${escHtml(name)} (${lib[name].questions.length} вопр.)</span>
                <div class="testItemButtons">
                    <button class="editCategoryBtn" data-name="${escHtml(name)}" title="Сменить категорию">✏️</button>
                    <button class="selectTest" data-name="${escHtml(name)}">▶</button>
                    <button class="deleteTest" data-name="${escHtml(name)}">🗑</button>
                </div>
            </div>`;
        });
    });

    container.innerHTML = html;

    // Обработчики
    document.querySelectorAll('.editCategoryBtn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const testName = btn.dataset.name;
            const currentCat = getLibrary()[testName]?.category || 'Без категории';
            showCategoryModal(currentCat, (newCat) => {
                changeTestCategory(testName, newCat);
            });
        };
    });
    document.querySelectorAll('.selectTest').forEach(btn => {
        btn.onclick = () => selectTest(btn.dataset.name, true);
    });
    document.querySelectorAll('.deleteTest').forEach(btn => {
        btn.onclick = () => {
            showConfirmModal('Удалить тест «' + btn.dataset.name + '»?', () => {
                deleteTestFromLibrary(btn.dataset.name);
            });
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
    resetViewMode();
    if (showAlert) {
        showAlertModal('Выбран тест: ' + name + ' (' + all.length + ' вопросов)');
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

// ─── Сброс режима просмотра и поиска ──────
function resetViewMode() {
    currentViewMode = null;
    document.getElementById('questionSearch').style.display = 'none';
    searchQuery = '';
}

function setViewMode(mode) {
    currentViewMode = mode;
    if (mode === 'heatmap') {
        document.getElementById('questionSearch').style.display = 'none';
    } else {
        document.getElementById('questionSearch').style.display = 'block';
    }
}

// ─── Логика теста ──────
function start() {
    if (!all.length) return showAlertModal("Сначала выберите тест");
    resetViewMode();
    showConfirmModal("Включить режим экзамена?", () => {
        exam = true;
        continueStart();
    }, () => {
        exam = false;
        continueStart();
    });
}

function continueStart() {
    let count = parseInt(countInput());
    let range = parseRange();
    let pool = [...all].filter(q => q.options && q.options.length > 0);
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
    mistakes = [];
    drawChart();
    mistakesReviewMode = false;
    if (!list.length) {
        showAlertModal("Нет вопросов в выбранном диапазоне");
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

function getCorrectIndices(q) {
    if (!q || q.correct === null || q.correct === undefined || q.correct === '') return null;
    const raw = Array.isArray(q.correct) ? q.correct : [q.correct];
    const values = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < (q.options || []).length))];
    return values.length ? values.sort((a, b) => a - b) : null;
}

function optionLabel(index) {
    const labels = ['а','б','в','г','д','е','ж','з','и','й','к','л','м','н','о','п','р','с','т','у','ф','х','ц','ч','ш','щ','э','ю','я'];
    return labels[index] || String(index + 1);
}

function renderOptions(q, mode = 'review') {
    const correct = getCorrectIndices(q);
    return (q.options || []).map((option, i) => {
        const cls = correct && correct.includes(i) && mode === 'review' ? 'correct' : '';
        return `<div class="option ${cls}" ${mode === 'review' ? 'style="cursor:default;"' : ''}><span class="option-label">${optionLabel(i)})</span> ${esc(option)}</div>`;
    }).join('');
}

function finishAnswer(isCorrect, selected = []) {
    const q = list[index];
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    const nodes = document.querySelectorAll('#app .option');
    const correctIndices = getCorrectIndices(q) || [];
    correctIndices.forEach(i => nodes[i]?.classList.add('correct'));
    selected.forEach(i => { if (!correctIndices.includes(i)) nodes[i]?.classList.add('wrong'); });

    if (!isCorrect) {
        if (currentTestName) {
            addMistake(currentTestName, q.number);
            addMistakeToList(currentTestName, q.number);
        }
        if (!mistakes.some(m => m.number === q.number)) mistakes.push(q);
    } else {
        if (mistakesReviewMode && currentTestName) {
            removeMistakeFromList(currentTestName, q.number);
            mistakes = mistakes.filter(m => m.number !== q.number);
        }
        updateGoalProgress('correct_answers', 1);
    }
    recordSpacedReview(currentTestName, q.number, isCorrect);
    saveSession();
    if (!exam) nextBtn.style.display = 'block';
    else setTimeout(() => { index++; saveSession(); show(); }, 700);
}

function toggleMultiAnswer(i) {
    if (answered) return;
    if (selectedAnswers.has(i)) selectedAnswers.delete(i); else selectedAnswers.add(i);
    document.querySelectorAll('#app .option').forEach((el, idx) => el.classList.toggle('selected', selectedAnswers.has(idx)));
    const check = document.getElementById('checkMultiBtn');
    if (check) check.disabled = selectedAnswers.size === 0;
}

function checkMultiAnswer() {
    if (answered || selectedAnswers.size === 0) return;
    const q = list[index];
    const correct = getCorrectIndices(q) || [];
    const selected = [...selectedAnswers].sort((a,b) => a-b);
    const isCorrect = correct.length === selected.length && correct.every((v, i) => v === selected[i]);
    answered = true;
    const check = document.getElementById('checkMultiBtn');
    if (check) check.disabled = true;
    finishAnswer(isCorrect, selected);
    selectedAnswers.clear();
}

function show() {
    if (index >= list.length) return finish();
    answered = false;
    selectedAnswers.clear();
    nextBtn.style.display = "none";
    let q = list[index];
    qcount.textContent = `${index + 1} / ${list.length}`;
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    const favHtml = `<span class="fav-star" data-test="${escHtml(currentTestName)}" data-qnumber="${q.number}" onclick="toggleFavorite(event)">${isFavorite(currentTestName, q.number) ? '★' : '☆'}</span>`;
    const correct = getCorrectIndices(q);
    if (q.options && q.options.length > 0) {
        if (!correct) {
            app.innerHTML = `<div class="card question-card" style="position:relative;">${favHtml}<h3>${q.number}. ${esc(q.text)}</h3>${q.options.map((o,i)=>`<div class="option" style="cursor:default;"><span class="option-label">${optionLabel(i)})</span> ${esc(o)}</div>`).join('')}<p class="answer-missing">ℹ️ Правильный ответ не указан в исходном файле. Вопрос будет пропущен при оценке.</p></div>`;
            answered = true;
            nextBtn.style.display = 'block';
        } else if (correct.length > 1) {
            app.innerHTML = `<div class="card question-card" style="position:relative;">${favHtml}<h3>${q.number}. ${esc(q.text)}</h3><p class="multi-hint">Выберите все правильные варианты</p>${q.options.map((o,i)=>`<div class="option multi-option" onclick="toggleMultiAnswer(${i})"><span class="option-label">${optionLabel(i)})</span> ${esc(o)}</div>`).join('')}<button id="checkMultiBtn" onclick="checkMultiAnswer()" disabled>Проверить ответ</button></div>`;
        } else {
            app.innerHTML = `<div class="card question-card" style="position:relative;">${favHtml}<h3>${q.number}. ${esc(q.text)}</h3>${q.options.map((o,i)=>`<div class="option" onclick="ans(${i})"><span class="option-label">${optionLabel(i)})</span> ${esc(o)}</div>`).join('')}</div>`;
        }
    } else {
        app.innerHTML = `<div class="card" style="position:relative;">${favHtml}<h3>${q.number}. ${esc(q.text)}</h3><p class="answer-missing">Вопрос без вариантов ответа</p></div>`;
        answered = true;
        nextBtn.style.display = 'block';
    }
    bar.style.width = (index / list.length * 100) + '%';
}

function ans(i) {
    if (answered) return;
    const q = list[index];
    const correct = getCorrectIndices(q);
    if (!correct) { answered = true; nextBtn.style.display = 'block'; return; }
    answered = true;
    finishAnswer(correct.length === 1 && correct[0] === i, [i]);
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
    const gradedQuestions = list.filter(q => getCorrectIndices(q) !== null);
    const gradedTotal = gradedQuestions.length;
    const wrongNumbers = new Set(mistakes.map(q => q.number));
    const correct = Math.max(0, gradedTotal - gradedQuestions.filter(q => wrongNumbers.has(q.number)).length);
    const percent = gradedTotal ? Math.round(correct / gradedTotal * 100) : 0;
    const skipped = list.length - gradedTotal;
    saveResult(percent, { testName: localStorage.getItem(CURRENT_TEST_KEY) || "Тест", correct, total: gradedTotal, skipped, mistakes: mistakes.map(q => q.number) });
    drawChart();
    updateScoreAndAchievements(correct, gradedTotal, percent);
    mistakesReviewMode = false;
    clearSession();

    updateGoalProgress('complete_test', 1);
    if (percent === 100) {
        updateGoalProgress('perfect_test', 1);
    }

    resetViewMode();
    if (mistakes.length > 0) {
        showConfirmModal(
            `Результат экзамена\nПравильных: ${correct}/${gradedTotal}\nПроцент: ${percent}%${skipped ? `\nБез ключа ответа: ${skipped}` : ''}\n\nХотите решить ошибки?`,
            () => {
                mistakesMode();   // запустить режим ошибок по текущей сессии
            },
            () => {}   // просто закрыть
        );
    } else {
        showAlertModal(`Результат экзамена\nПравильных: ${correct}/${gradedTotal}\nПроцент: ${percent}%${skipped ? `\nБез ключа ответа: ${skipped}` : ''}`);
    }
}

function reviewAll() {
    if (!all.length) return showAlertModal("Сначала выберите тест");
    setViewMode('review');
    nextBtn.style.display = "none";
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    let filtered = all;
    if (searchQuery) filtered = all.filter(q => q.text.toLowerCase().includes(searchQuery));
    app.innerHTML = filtered.map(q => {
        const favStar = `<span class="fav-star" data-test="${escHtml(currentTestName)}" data-qnumber="${q.number}" onclick="toggleFavorite(event)">${isFavorite(currentTestName, q.number) ? '★' : '☆'}</span>`;
        const correct = getCorrectIndices(q) || [];
        const optionsHtml = (q.options || []).map((o, i) => `<div class="option ${correct.includes(i) ? 'correct' : ''}"><span class="option-label">${optionLabel(i)})</span> ${esc(o)}</div>`).join('');
        const note = correct.length ? '' : '<p class="answer-missing">Правильный ответ не указан в исходном файле</p>';
        return `<div class="card" style="position:relative;">${favStar}<h3>${q.number}. ${esc(q.text)}</h3>${optionsHtml}${note}</div>`;
    }).join("");
    bar.style.width = "100%";
    qcount.textContent = "Режим просмотра";
}

function toggleRandom() {
    if (exam) return showAlertModal("В экзамене нельзя менять режим");
    random = !random;
    let btn = document.getElementById("randomBtn");
    btn.style.background = random ? "#22c55e" : "#3b82f6";
    btn.textContent = random ? "Random ON" : "Random";
    saveSession();
}

// ══════ Режим «Ошибки» ══════
function mistakesMode() {
    if (exam) return showAlertModal("В экзамене недоступно");
    resetViewMode();
    if (!mistakes.length) return showAlertModal("Ошибок нет");
    mistakesReviewMode = true;
    list = [...mistakes].filter(q => q.options && q.options.length > 0);
    if (!list.length) return showAlertModal("Нет вопросов с вариантами в ошибках");
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
    if (exam) return showAlertModal("В экзамене недоступно");
    resetViewMode();
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentTestName) return showAlertModal("Сначала выберите тест");
    const lib = getLibrary();
    const test = lib[currentTestName];
    if (!test) return showAlertModal("Тест не найден");
    const favNums = getFavorites()[currentTestName] || [];
    if (!favNums.length) return showAlertModal("Нет избранных вопросов");
    const favQuestions = test.questions
        .filter(q => favNums.includes(q.number) && q.options && q.options.length > 0)
        .sort((a, b) => a.number - b.number);
    if (!favQuestions.length) return showAlertModal("Нет избранных вопросов (вопросы не найдены)");
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
    mistakes = test.questions.filter(q => nums.includes(q.number) && q.options && q.options.length > 0);
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
    if (!currentTestName) return showAlertModal("Сначала выберите тест");
    const lib = getLibrary();
    const test = lib[currentTestName];
    if (!test) return showAlertModal("Тест не найден");
    const stats = getMistakeStats();
    const testStats = stats[currentTestName] || {};

    let mistakeQuestions = test.questions.filter(q => testStats[q.number] > 0);
    if (!mistakeQuestions.length) {
        return showAlertModal("У вас нет сохранённых ошибок по этому тесту");
    }

    // сортировка по убыванию ошибок
    mistakeQuestions.sort((a, b) => {
        const errA = testStats[a.number] || 0;
        const errB = testStats[b.number] || 0;
        if (errB !== errA) return errB - errA;
        return a.number - b.number;
    });

    // учёт поиска
    if (searchQuery) {
        mistakeQuestions = mistakeQuestions.filter(q => q.text.toLowerCase().includes(searchQuery));
    }

    setViewMode('mistakeStats');
    updateGoalProgress('review_mistakes', 1);

    nextBtn.style.display = "none";
    bar.style.width = "0%";
    qcount.textContent = "📊 Статистика ошибок";

    app.innerHTML = mistakeQuestions.map(q => {
        const errCount = testStats[q.number];
        const favStar = `<span style="cursor:pointer; font-size:24px; color:#ffd700; text-shadow:0 0 10px rgba(255,215,0,0.6);"
              data-test="${escHtml(currentTestName)}"
              data-qnumber="${q.number}"
              onclick="toggleFavorite(event)">${isFavorite(currentTestName, q.number) ? '★' : '☆'}</span>`;
        if (q.options && q.options.length > 0) {
            return `<div class="card" style="position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3>${q.number}. ${esc(q.text)}</h3>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${favStar}
                        <span style="font-size: 14px; color: #ff8a80; margin-left: 10px;">Ошибок: ${errCount}</span>
                    </div>
                </div>
                ${(q.options || []).map((o, i) => {
                    const cls = (getCorrectIndices(q) || []).includes(i) ? "correct" : "";
                    return `<div class="option ${cls}"><span class="option-label">${optionLabel(i)})</span> ${esc(o)}</div>`;
                }).join("")}
                ${getCorrectIndices(q) ? '' : '<p class="answer-missing">Правильный ответ не указан</p>'}
                <button class="deleteMistakeBtn"
                    data-test="${escHtml(currentTestName)}"
                    data-qnumber="${q.number}"
                    style="position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; padding: 0; border-radius: 50%; background: rgba(255,82,82,0.8); font-size: 16px; line-height: 30px;"
                >🗑</button>
            </div>`;
        } else {
            return `<div class="card" style="position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3>${q.number}. ${esc(q.text)}</h3>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${favStar}
                        <span style="font-size: 14px; color: #ff8a80; margin-left: 10px;">Ошибок: ${errCount}</span>
                    </div>
                </div>
                <p style="color: #aaa; font-style: italic;">Вопрос без вариантов ответа</p>
            </div>`;
        }
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

// ══════ Тепловая карта ══════
function showHeatmap() {
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentTestName) return showAlertModal("Сначала выберите тест");
    const lib = getLibrary();
    const test = lib[currentTestName];
    if (!test) return showAlertModal("Тест не найден");

    const stats = getMistakeStats();
    const testStats = stats[currentTestName] || {};
    const questions = test.questions;

    // Вычисляем максимальное число ошибок для масштаба цвета
    let maxErrors = 0;
    questions.forEach(q => {
        const cnt = testStats[q.number] || 0;
        if (cnt > maxErrors) maxErrors = cnt;
    });

    setViewMode('heatmap');
    nextBtn.style.display = "none";
    qcount.textContent = "🌡 Тепловая карта ошибок";
    bar.style.width = "0%";

    let html = '<div class="heatmap-container">';
    questions.forEach(q => {
        const cnt = testStats[q.number] || 0;
        let color;
        if (maxErrors === 0) {
            color = '#4caf50'; // зелёный, если ошибок нет
        } else {
            const ratio = cnt / maxErrors;
            const hue = 120 - 120 * ratio; // от 120 (зелёный) до 0 (красный)
            color = `hsl(${hue}, 100%, 45%)`;
        }
        html += `<div class="heatmap-item" 
                      style="background-color: ${color};" 
                      title="Вопрос ${q.number}: ${cnt} ошиб." 
                      onclick="viewQuestionFromHeatmap(${q.number})">${q.number}</div>`;
    });
    html += '</div>';
    html += '<button id="resetHeatmapBtn" style="background:#ff4757; margin-top:12px;">🗑 Сбросить тепловую карту</button>';
    app.innerHTML = html;
    document.getElementById('resetHeatmapBtn').onclick = () => {
        showConfirmModal('Сбросить всю статистику ошибок для этого теста?', () => {
            clearMistakeStatsForTest(currentTestName);
            showHeatmap(); // перерисовать
        });
    };
}

function viewQuestionFromHeatmap(number) {
    const currentTestName = localStorage.getItem(CURRENT_TEST_KEY);
    const lib = getLibrary();
    const test = lib[currentTestName];
    if (!test) return;

    const question = test.questions.find(q => q.number === number);
    if (question) {
        showQuestionModal(question, currentTestName);
    }
}

function showQuestionModal(question, testName) {
    const overlay = document.getElementById('modal-overlay');
    const messageEl = document.getElementById('modal-message');
    const extraEl = document.getElementById('modal-extra');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');

    // Очищаем заголовок и кнопки
    messageEl.textContent = '';
    okBtn.style.display = 'block';
    cancelBtn.style.display = 'none';

    // Формируем содержимое вопроса
    const favStar = isFavorite(testName, question.number) ? '★' : '☆';
    let html = `<div style="text-align: left;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin:0;">${question.number}. ${esc(question.text)}</h3>
            <span style="cursor:pointer; font-size:24px; color:#ffd700;"
                  onclick="toggleFavoriteFromModal('${escHtml(testName)}', ${question.number}, this)">${favStar}</span>
        </div>`;

    if (question.options && question.options.length > 0) {
        html += question.options.map((opt, i) => {
            const cls = (getCorrectIndices(question) || []).includes(i) ? 'correct' : '';
            return `<div class="option ${cls}" style="pointer-events: none;"><span class="option-label">${optionLabel(i)})</span> ${esc(opt)}</div>`;
        }).join('');
        if (!getCorrectIndices(question)) html += '<p class="answer-missing">Правильный ответ не указан в исходном файле</p>';
    } else {
        html += `<p class="answer-missing">Вопрос без вариантов ответа</p>`;
    }
    html += '</div>';

    extraEl.innerHTML = html;
    overlay.style.display = 'flex';

    okBtn.onclick = () => {
        overlay.style.display = 'none';
    };
}

function toggleFavoriteFromModal(testName, qNumber, starElement) {
    if (isFavorite(testName, qNumber)) {
        removeFavorite(testName, qNumber);
        starElement.textContent = '☆';
    } else {
        addFavorite(testName, qNumber);
        starElement.textContent = '★';
    }
    updateFavoritesButton();
}
// ─── Вспомогательные функции ──────
function shuffle(a) {
    return a.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
}
function shuffleAnswers(q) {
    if (!q.options || q.options.length === 0) return;
    const correct = getCorrectIndices(q) || [];
    let arr = q.options.map((text, i) => ({ text, correct: correct.includes(i) }));
    for (let i = arr.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    q.options = arr.map(x => x.text);
    const newCorrect = arr.map((x, i) => x.correct ? i : -1).filter(i => i >= 0);
    q.correct = newCorrect.length > 1 ? newCorrect : (newCorrect.length === 1 ? newCorrect[0] : null);
}
function drawChart() {
    if (!chart) return;
    chart.width = chart.clientWidth || 300;
    chart.height = 120;
    let ctx = chart.getContext("2d");
    ctx.clearRect(0, 0, chart.width, chart.height);
    let h = JSON.parse(localStorage.getItem("hist") || "[]");
    if (!h.length) return;
    let w = chart.width / h.length;
    h.forEach((entry, i) => {
        const p = typeof entry === 'number' ? entry : Number(entry.percent || 0);
        if (p < 50) ctx.fillStyle = "#ef4444";
        else if (p < 75) ctx.fillStyle = "#f59e0b";
        else ctx.fillStyle = "#22c55e";
        ctx.fillRect(i * w, chart.height, Math.max(1, w - 4), -(p / 100) * chart.height);
    });
}
function clearStats() {
    showConfirmModal("Удалить историю результатов?", () => {
        localStorage.removeItem("hist");
        drawChart();
    });
}
function clearAllData() {
    showConfirmModal("Вы уверены? Это удалит ВСЕ тесты, прогресс, настройки без возможности восстановления.", () => {
        localStorage.clear();
        location.reload();
    });
}
function esc(s) { return (s||'').replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function escHtml(s) { return (s||'').replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#039;"); }
function saveResult(p, details = {}) {
    let h = JSON.parse(localStorage.getItem("hist") || "[]");
    h.push({ percent: p, date: new Date().toISOString(), ...details });
    if (h.length > 200) h.shift();
    localStorage.setItem("hist", JSON.stringify(h));
}

// ══════ Расширенный импорт TXT / DOCX / PDF ══════
async function extractTextFromFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const buffer = await file.arrayBuffer();
    if (ext === 'txt') return decodeTextFile(buffer);
    if (ext === 'docx') return await extractDocxText(buffer);
    if (ext === 'pdf') return await extractPdfText(buffer);
    throw new Error('Поддерживаются TXT, DOCX и PDF');
}

// DOCX — ZIP-контейнер; извлекаем word/document.xml без сторонних библиотек.
async function extractDocxText(buffer) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Браузер не поддерживает распаковку DOCX. Обнови браузер.');
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Файл DOCX повреждён или имеет неверный формат');
    const entries = view.getUint16(eocd + 10, true);
    let cursor = view.getUint32(eocd + 16, true);
    for (let n = 0; n < entries; n++) {
        if (view.getUint32(cursor, true) !== 0x02014b50) break;
        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const nameLen = view.getUint16(cursor + 28, true);
        const extraLen = view.getUint16(cursor + 30, true);
        const commentLen = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLen));
        if (name === 'word/document.xml') {
            const localNameLen = view.getUint16(localOffset + 26, true);
            const localExtraLen = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + localNameLen + localExtraLen;
            const compressed = bytes.slice(dataStart, dataStart + compressedSize);
            let xmlBytes;
            if (method === 0) xmlBytes = compressed;
            else if (method === 8) {
                const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
            } else throw new Error('Неизвестный алгоритм сжатия DOCX');
            const xml = new TextDecoder('utf-8').decode(xmlBytes);
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            if (doc.querySelector('parsererror')) throw new Error('Не удалось прочитать текст DOCX');
            return Array.from(doc.getElementsByTagName('w:p')).map(paragraph =>
                Array.from(paragraph.getElementsByTagName('w:t')).map(t => t.textContent || '').join('')
            ).join('\n');
        }
        cursor += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('В DOCX не найден основной текст документа');
}

// PDF.js загружается по требованию. После первой загрузки библиотека сохраняется в Cache Storage.
async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    const version = '3.11.174';
    const src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.min.js`;
    const cacheName = 'testpro-pdfjs-v3';
    let scriptText = '';
    try {
        const cache = await caches.open(cacheName);
        let response = await cache.match(src);
        if (!response) {
            response = await fetch(src);
            if (!response.ok) throw new Error('Не удалось загрузить модуль чтения PDF');
            await cache.put(src, response.clone());
        }
        scriptText = await response.text();
    } catch (e) {
        throw new Error('Для первого импорта PDF требуется интернет. После первой загрузки модуль будет доступен офлайн.');
    }
    const blobUrl = URL.createObjectURL(new Blob([scriptText], { type: 'text/javascript' }));
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = blobUrl;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Ошибка запуска PDF-модуля'));
        document.head.appendChild(script);
    });
    URL.revokeObjectURL(blobUrl);
    if (!window.pdfjsLib) throw new Error('Модуль PDF не инициализировался');
    const workerUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.js`;
    try {
        const cache = await caches.open(cacheName);
        let workerResponse = await cache.match(workerUrl);
        if (!workerResponse) {
            workerResponse = await fetch(workerUrl);
            if (!workerResponse.ok) throw new Error('Не удалось загрузить PDF worker');
            await cache.put(workerUrl, workerResponse.clone());
        }
        const workerBlob = await workerResponse.blob();
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
    } catch (e) {
        throw new Error('Не удалось подготовить модуль PDF. Проверь подключение и попробуй снова.');
    }
    return window.pdfjsLib;
}

async function extractPdfText(buffer) {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        let line = '', previousY = null;
        const pageLines = [];
        for (const item of content.items) {
            if (!item.str) continue;
            const y = item.transform ? item.transform[5] : null;
            if (previousY !== null && y !== null && Math.abs(y - previousY) > 3) {
                if (line.trim()) pageLines.push(line.trim());
                line = '';
            }
            line += item.str + (item.hasEOL ? '\n' : ' ');
            previousY = y;
        }
        if (line.trim()) pageLines.push(line.trim());
        pages.push(pageLines.join('\n'));
    }
    const text = pages.join('\n');
    if (!text.trim()) throw new Error('В PDF нет текстового слоя. Сканированные PDF пока не распознаются (нужен OCR).');
    return text;
}

// ══════ Интервальное повторение ══════
const REVIEW_KEY = 'spacedReview';
function getReviewSchedule() {
    try { return JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}'); } catch (_) { return {}; }
}
function recordSpacedReview(testName, questionNumber, correct) {
    if (!testName) return;
    const data = getReviewSchedule();
    const key = `${testName}::${questionNumber}`;
    const item = data[key] || { interval: 0, repetitions: 0, ease: 2.5 };
    if (correct) {
        item.repetitions++;
        item.interval = item.repetitions === 1 ? 1 : item.repetitions === 2 ? 3 : Math.max(4, Math.round(item.interval * item.ease));
        item.ease = Math.min(2.8, item.ease + 0.05);
    } else {
        item.repetitions = 0;
        item.interval = 1;
        item.ease = Math.max(1.3, item.ease - 0.2);
    }
    item.lastReviewed = new Date().toISOString();
    item.due = new Date(Date.now() + item.interval * 86400000).toISOString();
    item.testName = testName;
    item.questionNumber = questionNumber;
    data[key] = item;
    localStorage.setItem(REVIEW_KEY, JSON.stringify(data));
    renderDueReminder();
}
function getDueQuestions(testName = localStorage.getItem(CURRENT_TEST_KEY)) {
    const lib = getLibrary(), schedule = getReviewSchedule(), now = Date.now();
    return Object.values(schedule).filter(item => (!testName || item.testName === testName) && Date.parse(item.due) <= now)
        .map(item => ({ item, question: lib[item.testName]?.questions?.find(q => q.number === item.questionNumber) }))
        .filter(x => x.question && x.question.options?.length);
}
function renderDueReminder() {
    const status = document.getElementById('connectionStatus');
    if (!status) return;
    const due = getDueQuestions(null).length;
    const reminder = document.getElementById('dueReminder');
    if (reminder) reminder.textContent = due ? ` · ${due} вопросов пора повторить` : ' · Повторений на сегодня нет';
}
function reviewDueQuestions() {
    if (exam) return showAlertModal('Сначала завершите экзамен');
    const due = getDueQuestions();
    if (!due.length) return showAlertModal('Для выбранного теста пока нет вопросов к повторению. Ответь на вопросы — приложение составит расписание.');
    list = due.map(x => x.question);
    index = 0; mistakes = []; mistakesReviewMode = false;
    clearInterval(timerInt); timerInt = null; time = 0; timer.textContent = '';
    saveSession(); show();
    qcount.textContent = `Повторение · ${list.length} вопросов`;
}

// ══════ Аналитика ══════
function showAnalytics() {
    const card = document.getElementById('analyticsCard');
    const content = document.getElementById('analyticsContent');
    const history = JSON.parse(localStorage.getItem('hist') || '[]');
    const attempts = history.filter(x => typeof x === 'object');
    const avg = attempts.length ? Math.round(attempts.reduce((s, x) => s + Number(x.percent || 0), 0) / attempts.length) : 0;
    const best = attempts.length ? Math.max(...attempts.map(x => Number(x.percent || 0))) : 0;
    const totalAnswered = attempts.reduce((s, x) => s + Number(x.total || 0), 0);
    const due = getDueQuestions(null).length;
    const mistakesByTest = getMistakeStats();
    const weak = Object.entries(mistakesByTest).flatMap(([test, questions]) => Object.entries(questions).map(([number, count]) => ({ test, number, count })))
        .sort((a, b) => b.count - a.count).slice(0, 5);
    const recent = attempts.slice(-7).reverse();
    content.innerHTML = `
      <div class="analytics-grid">
        <div class="metric"><strong>${attempts.length}</strong><span>Попыток</span></div>
        <div class="metric"><strong>${avg}%</strong><span>Средний результат</span></div>
        <div class="metric"><strong>${best}%</strong><span>Лучший результат</span></div>
        <div class="metric"><strong>${totalAnswered}</strong><span>Вопросов в попытках</span></div>
        <div class="metric"><strong>${due}</strong><span>К повторению сегодня</span></div>
      </div>
      <h4>Последние попытки</h4>
      ${recent.length ? recent.map(x => `<div class="analytics-row"><span>${escHtml(x.testName || 'Тест')} · ${x.date ? new Date(x.date).toLocaleDateString('ru-RU') : 'дата не сохранена'}</span><b>${Number(x.percent || 0)}%</b></div>`).join('') : '<p class="muted">Пока нет завершённых попыток с подробной статистикой.</p>'}
      <h4>Вопросы, в которых чаще ошибаешься</h4>
      ${weak.length ? weak.map(x => `<div class="analytics-row"><span>${escHtml(x.test)} · вопрос ${x.number}</span><b>${x.count} ошибок</b></div>`).join('') : '<p class="muted">Ошибок пока нет — продолжай тренироваться.</p>'}
      <p class="muted">Подробные данные новых попыток сохраняются с этого обновления. Старые результаты сохранены и учитываются в графике.</p>`;
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hideAnalytics() { document.getElementById('analyticsCard').style.display = 'none'; }
function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    const update = () => {
        el.textContent = navigator.onLine ? '● Онлайн — приложение готово к работе' : '● Офлайн — сохранённые тесты доступны';
        el.classList.toggle('offline', !navigator.onLine);
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
}
function exportBackup() {
    const keys = [LIB_KEY, CURRENT_TEST_KEY, FAVORITES_KEY, MISTAKES_LIST_KEY, MISTAKE_STATS_KEY, 'hist', REVIEW_KEY, 'totalScore', 'achievements', DAILY_GOALS_KEY];
    const backup = { app: 'Test Pro', version: 3, exportedAt: new Date().toISOString(), data: {} };
    keys.forEach(key => { const value = localStorage.getItem(key); if (value !== null) backup.data[key] = value; });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `testpro-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
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
    resetViewMode();
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
        if (time <= 0) {
            time = 0;
            timer.textContent = "⏱ 0s";
            clearInterval(timerInt);
            timerInt = null;
            if (exam) {
                finish();
            } else {
                if (!answered) {
                    nextBtn.style.display = "block";
                }
            }
        } else {
            timer.textContent = "⏱ " + time + "s";
        }
    }, 1000);
}

// Декодирование TXT: UTF-8 (с BOM и без), UTF-16 и Windows-1251.
function decodeTextFile(buffer) {
    const bytes = new Uint8Array(buffer);

    // BOM UTF-16 Little Endian / Big Endian.
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }

    // Сначала пробуем строгий UTF-8, чтобы не принимать повреждённый текст за корректный.
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        // Если файл сохранён в ANSI/Windows-1251, декодируем кириллицу правильно.
        try {
            return new TextDecoder('windows-1251').decode(bytes);
        } catch (decodeError) {
            return new TextDecoder('utf-8').decode(bytes);
        }
    }
}

// ─── Парсинг ──────
function parse(text) {
    text = String(text || '').replace(/\r/g, '').replace(/[—–]/g, '-');
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const questions = [];
    const legacyAnswers = [];
    let inAnswerBlock = false;
    let current = null;
    const optionRegex = /^([A-HА-ЯЁ])\s*([)\.:])\s*(.+)$/i;
    // Принимает как "1. Вопрос", так и встречающийся в материалах вариант "19 Вопрос".
    const questionRegex = /^(\d+)[.)]?\s+(.+)$/;

    for (const line of lines) {
        if (/^=+\s*ОТВЕТЫ\s*=+$/i.test(line)) { inAnswerBlock = true; current = null; continue; }
        if (inAnswerBlock) { const parsed = parseAns(line); if (parsed !== null) legacyAnswers.push(parsed); continue; }

        const answerMatch = line.match(/^Правильный\s+ответ\s*[:\-]\s*(.*)$/i);
        if (answerMatch) {
            if (current) {
                current.correct = parseAnswerLetters(answerMatch[1]);
                current._hasExplicitAnswer = true;
            }
            continue;
        }

        const questionMatch = line.match(questionRegex);
        if (questionMatch) {
            const qNumber = Number(questionMatch[1]);
            const qText = questionMatch[2].trim().replace(new RegExp('^' + qNumber + '[.)]\\s*'), '');
            current = { number: qNumber, text: qText, options: [], correct: null };
            questions.push(current);
            continue;
        }

        const optionMatch = line.match(optionRegex);
        if (optionMatch && current) {
            current.options.push(optionMatch[3].trim());
            continue;
        }
        const legacyOptionMatch = line.match(/^([A-HА-ЯЁ])\s+(.+)$/);
        if (legacyOptionMatch && current && legacyOptionMatch[1] === legacyOptionMatch[1].toUpperCase()) {
            current.options.push(legacyOptionMatch[2].trim());
            continue;
        }
        if (current) current.text += ' ' + line;
    }

    questions.forEach((question, index) => {
        if (legacyAnswers[index] !== undefined && !question._hasExplicitAnswer) question.correct = legacyAnswers[index];
        delete question._hasExplicitAnswer;
        if (Array.isArray(question.correct) && question.correct.length === 1) question.correct = question.correct[0];
    });
    return questions;
}

function parseAnswerLetters(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const tokens = raw.match(/[A-HА-ЯЁ1-9]/gi) || [];
    const indices = [...new Set(tokens.map(conv).filter(n => n >= 0))];
    return indices.length > 1 ? indices : (indices.length === 1 ? indices[0] : null);
}

function parseAns(line) {
    const source = String(line || '').trim();
    // Старый блок ответов может выглядеть как "1 - в", "1. в" или содержать только "в".
    const numbered = source.match(/^\d+\s*[.):\-]\s*(.*)$/);
    if (numbered) return parseAnswerLetters(numbered[1]);
    const separated = source.match(/[:\-]\s*(.*)$/);
    if (separated) return parseAnswerLetters(separated[1]);
    return parseAnswerLetters(source);
}

function conv(value) {
    const upper = String(value || '').toUpperCase();
    const map = { 'A':0,'А':0,'1':0, 'B':1,'Б':1,'2':1, 'C':2,'В':2,'3':2, 'D':3,'Г':3,'4':3, 'E':4,'Д':4,'5':4, 'F':5,'Е':5,'6':5, 'G':6,'Ж':6,'7':6, 'H':7,'З':7,'8':7 };
    if (map[upper] !== undefined) return map[upper];
    const alphabet = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ';
    const index = alphabet.indexOf(upper);
    return index >= 0 ? index : -1;
}

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
        showAlertModal('🏆 Новые достижения:\n' + newAchievements.join('\n'));
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
    if (!currentName) return showAlertModal('Сначала выберите тест');
    const lib = getLibrary();
    const test = lib[currentName];
    if (!test) return showAlertModal('Тест не найден');

    allQuestionsForEdit = JSON.parse(JSON.stringify(test.questions));
    resetViewMode();
    nextBtn.style.display = 'none';
    clearInterval(timerInt);
    timerInt = null;
    qcount.textContent = '✏️ Редактирование: ' + currentName;
    bar.style.width = '0%';
    renderEditForm();
}

function renderEditForm() {
    let html = '<div style="max-height:70vh; overflow-y:auto;">';
    allQuestionsForEdit.forEach((q, idx) => {
        html += `
        <div class="editQuestionBlock" data-qindex="${idx}">
            <label>Вопрос №${q.number}</label>
            <textarea id="eq_text_${idx}" rows="2">${escHtml(q.text)}</textarea>
            <label>Варианты ответов:</label>
            <div id="eq_options_${idx}" class="options-container">
                ${q.options.map((opt, oi) => `
                    <div class="optionRow" data-oidx="${oi}">
                        <input type="text" value="${escHtml(opt)}" data-oidx="${oi}">
                        <button class="remove-option-btn" data-qidx="${idx}" data-oidx="${oi}">✕</button>
                    </div>
                `).join('')}
            </div>
            <button class="add-option-btn" data-qidx="${idx}" style="width:auto; margin-top:8px;">+ Добавить вариант</button>
            <label class="correctSelect">Правильный ответ:</label>
            <select id="eq_correct_${idx}" multiple size="${Math.min(Math.max(q.options.length, 2), 8)}" title="Можно выбрать несколько правильных вариантов">
                ${q.options.map((_, oi) => `<option value="${oi}" ${(getCorrectIndices(q) || []).includes(oi) ? 'selected' : ''}>${optionLabel(oi)}) ${oi+1}</option>`).join('')}
            </select>
            <small>Для нескольких правильных ответов удерживайте Ctrl (Windows) или Command (Mac). Если ключ неизвестен — оставьте всё невыбранным.</small>
            <button class="delete-question-btn" data-qidx="${idx}" style="background: #ff4757; margin-top:12px;">🗑 Удалить вопрос</button>
        </div>
        `;
    });
    html += '</div>';
    html += '<button id="addNewQuestionBtn" onclick="addNewQuestion()" style="margin-bottom:8px;">➕ Добавить вопрос</button>';
    html += '<button id="saveEditBtn" onclick="saveEditedTest()" style="background: #22c55e;">💾 Сохранить тест</button>';
    html += '<button id="cancelEditBtn" onclick="reviewAll()" style="background: #666;">Отмена</button>';

    app.innerHTML = html;

    document.getElementById('app').addEventListener('click', function(e) {
        const target = e.target;
        if (target.classList.contains('remove-option-btn')) {
            const qIdx = parseInt(target.dataset.qidx);
            const oIdx = parseInt(target.dataset.oidx);
            removeOptionInEditor(qIdx, oIdx);
            return;
        }
        if (target.classList.contains('add-option-btn')) {
            const qIdx = parseInt(target.dataset.qidx);
            addOptionInEditor(qIdx);
            return;
        }
        if (target.classList.contains('delete-question-btn')) {
            const qIdx = parseInt(target.dataset.qidx);
            showConfirmModal('Удалить этот вопрос?', () => {
                allQuestionsForEdit.splice(qIdx, 1);
                renderEditForm();
            });
            return;
        }
    });

    app.querySelectorAll('textarea, input[type="text"], select').forEach(el => {
        el.addEventListener('input', syncEditData);
        el.addEventListener('change', syncEditData);
    });
}

function syncEditData() {
    const blocks = document.querySelectorAll('.editQuestionBlock');
    blocks.forEach(block => {
        const idx = parseInt(block.dataset.qindex);
        const textEl = document.getElementById(`eq_text_${idx}`);
        if (textEl) allQuestionsForEdit[idx].text = textEl.value;
        const optionRows = block.querySelectorAll('.optionRow');
        const options = [];
        optionRows.forEach(row => {
            const input = row.querySelector('input');
            if (input) options.push(input.value);
        });
        allQuestionsForEdit[idx].options = options.filter(opt => opt.trim() !== '');
        const selectEl = document.getElementById(`eq_correct_${idx}`);
        if (selectEl) {
            const selected = [...selectEl.selectedOptions].map(option => Number(option.value));
            allQuestionsForEdit[idx].correct = selected.length > 1 ? selected : (selected.length === 1 ? selected[0] : null);
        }
    });
}

function removeOptionInEditor(qIdx, oIdx) {
    const q = allQuestionsForEdit[qIdx];
    if (!q || q.options.length <= 2) {
        showAlertModal('Должно быть минимум два варианта');
        return;
    }
    q.options.splice(oIdx, 1);
    const oldCorrect = getCorrectIndices({ ...q, options: [...q.options, '__removed__'] }) || [];
    const shifted = oldCorrect.filter(i => i !== oIdx).map(i => i > oIdx ? i - 1 : i);
    q.correct = shifted.length > 1 ? shifted : (shifted.length === 1 ? shifted[0] : null);
    updateQuestionBlock(qIdx);
}

function addOptionInEditor(qIdx) {
    const q = allQuestionsForEdit[qIdx];
    if (!q) return;
    q.options.push('');
    updateQuestionBlock(qIdx);
}

function updateQuestionBlock(qIdx) {
    const q = allQuestionsForEdit[qIdx];
    const block = document.querySelector(`.editQuestionBlock[data-qindex="${qIdx}"]`);
    if (!block) return;
    block.querySelector('label').textContent = `Вопрос №${q.number}`;
    const textarea = document.getElementById(`eq_text_${qIdx}`);
    if (textarea) textarea.value = q.text;
    const optionsContainer = document.getElementById(`eq_options_${qIdx}`);
    if (optionsContainer) {
        optionsContainer.innerHTML = q.options.map((opt, oi) => `
            <div class="optionRow" data-oidx="${oi}">
                <input type="text" value="${escHtml(opt)}" data-oidx="${oi}">
                <button class="remove-option-btn" data-qidx="${qIdx}" data-oidx="${oi}">✕</button>
            </div>
        `).join('');
    }
    const selectEl = document.getElementById(`eq_correct_${qIdx}`);
    if (selectEl) {
        selectEl.multiple = true;
        selectEl.size = Math.min(Math.max(q.options.length, 2), 8);
        selectEl.innerHTML = q.options.map((_, oi) => `<option value="${oi}" ${(getCorrectIndices(q) || []).includes(oi) ? 'selected' : ''}>${optionLabel(oi)}) ${oi+1}</option>`).join('');
    }
    app.querySelectorAll('textarea, input[type="text"], select').forEach(el => {
        el.removeEventListener('input', syncEditData);
        el.addEventListener('input', syncEditData);
        el.removeEventListener('change', syncEditData);
        el.addEventListener('change', syncEditData);
    });
}

function addNewQuestion() {
    const maxNumber = allQuestionsForEdit.length > 0 
        ? Math.max(...allQuestionsForEdit.map(q => q.number)) 
        : 0;
    const newNumber = maxNumber + 1;
    allQuestionsForEdit.push({ number: newNumber, text: '', options: ['', ''], correct: 0 });
    renderEditForm();
}

function saveEditedTest() {
    syncEditData();
    const currentName = localStorage.getItem(CURRENT_TEST_KEY);
    if (!currentName) return;

    for (let q of allQuestionsForEdit) {
        if (q.options.length > 0 && q.options.length < 2) {
            showAlertModal(`Вопрос №${q.number} должен иметь минимум два варианта`);
            return;
        }
    }

    const lib = getLibrary();
    lib[currentName].questions = allQuestionsForEdit;
    saveLibrary(lib);

    if (localStorage.getItem(CURRENT_TEST_KEY) === currentName) {
        all = allQuestionsForEdit;
    }

    showAlertModal('Тест сохранён!');
    reviewAll();
}

// ══════ Темы оформления ══════
function setTheme(theme) {
    localStorage.setItem('appTheme', theme);
    if (theme === 'adaptive') applyAdaptiveTheme();
    else document.body.className = theme === 'purple' ? '' : 'theme-' + theme;
    document.getElementById('themeSelector').style.display = 'none';
    updateThemeButton();
}

function toggleThemeMenu() {
    const sel = document.getElementById('themeSelector');
    sel.style.display = sel.style.display === 'none' ? 'block' : 'none';
}

let adaptiveThemeListenerAdded = false;
function applyAdaptiveTheme() {
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    const light = media && media.matches;
    document.body.classList.toggle('theme-light', !!light);
    if (media && !adaptiveThemeListenerAdded) {
        media.addEventListener?.('change', applyAdaptiveTheme);
        adaptiveThemeListenerAdded = true;
    }
}
function updateThemeButton() {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    const current = localStorage.getItem('appTheme') || 'adaptive';
    const emojis = { purple: '🌙', light: '☀️', adaptive: '🌓', dachshund: '🌭', forest: '🌲', space: '🚀', retro: '📟' };
    btn.textContent = `${emojis[current] || '🎨'} Тема`;
}
function loadTheme() {
    const saved = localStorage.getItem('appTheme') || 'adaptive';
    if (saved === 'adaptive') {
        applyAdaptiveTheme();
    } else document.body.className = saved === 'purple' ? '' : 'theme-' + saved;
    updateThemeButton();
}

// ─── Модальные окна ───
function showAlertModal(message) {
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-extra').innerHTML = '';
    document.getElementById('modal-ok').style.display = 'block';
    document.getElementById('modal-cancel').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-ok').onclick = () => {
        document.getElementById('modal-overlay').style.display = 'none';
    };
}

function showConfirmModal(message, onConfirm, onCancel) {
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-extra').innerHTML = '';
    document.getElementById('modal-ok').style.display = 'block';
    document.getElementById('modal-cancel').style.display = 'block';
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-ok').onclick = () => {
        document.getElementById('modal-overlay').style.display = 'none';
        if (onConfirm) onConfirm();
    };
    document.getElementById('modal-cancel').onclick = () => {
        document.getElementById('modal-overlay').style.display = 'none';
        if (onCancel) onCancel();
    };
}

function showCategoryModal(currentCategory, callback) {
    const existingCategories = getCategories();
    const overlay = document.getElementById('modal-overlay');
    const messageEl = document.getElementById('modal-message');
    const extraEl = document.getElementById('modal-extra');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');

    messageEl.textContent = 'Введите или выберите категорию:';
    extraEl.innerHTML = `
        <input type="text" id="categoryInput" value="${escHtml(currentCategory)}" list="categoryList" placeholder="Название категории">
        <datalist id="categoryList">
            ${existingCategories.map(c => `<option value="${escHtml(c)}">`).join('')}
        </datalist>
    `;
    okBtn.style.display = 'block';
    cancelBtn.style.display = 'block';
    overlay.style.display = 'flex';

    okBtn.onclick = () => {
        const newCategory = document.getElementById('categoryInput').value.trim() || 'Без категории';
        overlay.style.display = 'none';
        callback(newCategory);
    };
    cancelBtn.onclick = () => {
        overlay.style.display = 'none';
    };
}

// ─── Проверка сессии при загрузке ───
function checkSessionAndContinue() {
    const saved = loadSession();
    if (saved) {
        showConfirmModal('У вас есть незавершённый тест. Продолжить?', () => {
            restoreSession(saved);
        }, () => {
            clearSession();
            loadCurrentTestIfAny();
        });
    } else {
        loadCurrentTestIfAny();
    }
}

function loadCurrentTestIfAny() {
    const currentName = localStorage.getItem(CURRENT_TEST_KEY);
    if (currentName && getLibrary()[currentName]) {
        selectTest(currentName, false);
        loadMistakesFromStorage();
    }
}

// ══════ Ежедневные задания ══════
function initDailyGoals() {
    const today = new Date().toISOString().slice(0,10);
    let goalsData = JSON.parse(localStorage.getItem(DAILY_GOALS_KEY) || '{}');
    if (goalsData.date !== today) {
        goalsData = {
            date: today,
            goals: DAILY_GOALS_TEMPLATE.map(g => ({ ...g, progress: 0, completed: false }))
        };
        localStorage.setItem(DAILY_GOALS_KEY, JSON.stringify(goalsData));
    }
    renderDailyGoals(goalsData);
}

function updateGoalProgress(goalId, increment = 1) {
    let goalsData = JSON.parse(localStorage.getItem(DAILY_GOALS_KEY) || '{}');
    if (!goalsData.goals || goalsData.date !== new Date().toISOString().slice(0,10)) {
        initDailyGoals();
        goalsData = JSON.parse(localStorage.getItem(DAILY_GOALS_KEY) || '{}');
    }
    const goal = goalsData.goals.find(g => g.id === goalId);
    if (goal && !goal.completed) {
        goal.progress = Math.min(goal.progress + increment, goal.target);
        if (goal.progress >= goal.target) {
            goal.completed = true;
            totalScore += goal.reward;
            localStorage.setItem('totalScore', totalScore);
            playerLevel = Math.floor(totalScore / 200) + 1;
            renderProfile();
            showAlertModal(`🎯 Задание выполнено: ${goal.description}\n+${goal.reward} очков`);
        }
        localStorage.setItem(DAILY_GOALS_KEY, JSON.stringify(goalsData));
        renderDailyGoals(goalsData);
    }
}

function renderDailyGoals(goalsData) {
    const container = document.getElementById('dailyGoalsList');
    const card = document.getElementById('dailyGoalsCard');
    if (!container || !card) return;
    if (!goalsData.goals || goalsData.date !== new Date().toISOString().slice(0,10)) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    container.innerHTML = goalsData.goals.map(goal => {
        const progressPercent = Math.min(100, (goal.progress / goal.target) * 100);
        const completedClass = goal.completed ? 'completed' : '';
        return `<div class="daily-goal ${completedClass}">
            <div class="goal-info">
                <div class="goal-title">${goal.description} (${goal.progress}/${goal.target})</div>
                <div class="goal-progress-bar">
                    <div class="goal-progress-fill" style="width:${progressPercent}%"></div>
                </div>
            </div>
            <div class="goal-reward">+${goal.reward}</div>
        </div>`;
    }).join('');
}

// ─── Миграция старых тестов без категории ───
function migrateLibrary() {
    const lib = getLibrary();
    let changed = false;
    for (let name in lib) {
        if (!lib[name].category) {
            lib[name].category = 'Без категории';
            changed = true;
        }
    }
    if (changed) saveLibrary(lib);
}