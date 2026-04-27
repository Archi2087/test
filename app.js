let file, app, bar, qcount, nextBtn, timer, chart;

const SESSION_KEY = 'testSession';

window.onload = () => {
    file = document.getElementById("file");
    app = document.getElementById("app");
    bar = document.getElementById("bar");
    qcount = document.getElementById("qcount");
    nextBtn = document.getElementById("nextBtn");
    timer = document.getElementById("timer");
    chart = document.getElementById("chart");

    file.onchange = e => {
        let r = new FileReader();
        r.onload = x => {
            all = parse(x.target.result);
            alert("Загружено вопросов: " + all.length);
            clearSession(); // новый файл – старая сессия не нужна
        };
        r.readAsText(e.target.files[0]);
    };

    // Проверяем, есть ли сохранённая сессия
    const saved = loadSession();
    if (saved) {
        if (confirm('У вас есть незавершённый тест. Продолжить?')) {
            restoreSession(saved);
        } else {
            clearSession();
        }
    }
};

let all = [], list = [], mistakes = [];
let index = 0;
let random = false;
let answered = false;
let exam = false;
let time = 0;
let timerInt = null;

function start() {
    if (!all.length) return alert("Загрузи файл");

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

    mistakes = [];

    if (!list.length) {
        alert("Нет вопросов в выбранном диапазоне");
        return;
    }

    time = list.length * (exam ? 10 : 15);
    clearInterval(timerInt);
    startTimer(); // запускаем таймер с текущим time

    show();
    saveSession(); // сохраняем новую сессию
}

function countInput() {
    return document.getElementById("count").value;
}

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

    app.innerHTML =
        `<div class="card">
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

    if (i !== q.correct) {
        nodes[i].classList.add("wrong");
        mistakes.push(q);
    }

    saveSession(); // сохраняем изменение ошибок и answered (не сохраняем, но всё равно)

    if (!exam) {
        nextBtn.style.display = "block";
    } else {
        setTimeout(() => {
            index++;
            saveSession(); // сохраняем новое положение
            show();
        }, 700);
    }
}

function next() {
    index++;
    saveSession(); // сохраняем переход
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

    clearSession(); // тест завершён, удаляем сессию

    alert(
        `Результат экзамена\nПравильных: ${correct}/${list.length}\nПроцент: ${percent}%`
    );
}

function reviewAll() {
    if (!all.length) return alert("Сначала загрузи файл");

    nextBtn.style.display = "none";

    app.innerHTML = all.map(q => `
        <div class="card">
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

    if (random) {
        btn.style.background = "#22c55e";
        btn.textContent = "Random ON";
    } else {
        btn.style.background = "#3b82f6";
        btn.textContent = "Random";
    }

    saveSession(); // сохраняем флаг random
}

function mistakesMode() {
    if (exam) return alert("В экзамене недоступно");
    if (!mistakes.length) return alert("Ошибок нет");

    list = [...mistakes];
    index = 0;
    saveSession(); // сохраняем новую сессию по ошибкам
    show();
}

function shuffle(a) {
    return a
        .map(x => [Math.random(), x])
        .sort((a, b) => a[0] - b[0])
        .map(x => x[1]);
}

function shuffleAnswers(q) {
    let arr = q.options.map((text, i) => ({
        text,
        correct: i === q.correct
    }));

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

    ctx.fillStyle = "#22c55e";

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

function parse(text) {
    text = text.replace(/\r/g, "").replace(/—|–/g, "-");

    let lines = text.split("\n").map(x => x.trim()).filter(Boolean);

    let qs = [];
    let ans = [];
    let block = false;
    let cur = null;

    for (let l of lines) {
        if (l.includes("===== ОТВЕТЫ =====")) {
            block = true;
            continue;
        }

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

    qs.forEach((q, i) => {
        if (ans[i] !== undefined) q.correct = ans[i];
    });

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

function clearStats() {
    if (!confirm("Удалить историю результатов?")) return;
    localStorage.removeItem("hist");
    drawChart();
}

function esc(s) {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function saveResult(p) {
    let h = JSON.parse(localStorage.getItem("hist") || "[]");
    h.push(p);
    localStorage.setItem("hist", JSON.stringify(h));
}

/* ── Сохранение и восстановление сессии ── */

function saveSession() {
    // Не сохраняем, если нет активного списка или тест завершён
    if (!list.length || index >= list.length) return;

    const session = {
        all: all,               // все вопросы (восстановим, чтобы не требовался файл)
        list: list,
        index: index,
        mistakes: mistakes,
        exam: exam,
        random: random,
        time: time
    };

    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {
        // localStorage переполнен – молча игнорируем
        console.warn('Не удалось сохранить сессию', e);
    }
}

function loadSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    try {
        const data = JSON.parse(raw);
        // Простейшая проверка структуры
        if (data.all && data.list && typeof data.index === 'number') {
            return data;
        }
    } catch (e) {}
    return null;
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

function restoreSession(session) {
    all = session.all;
    list = session.list;
    index = session.index;
    mistakes = session.mistakes || [];
    exam = session.exam;
    random = session.random;
    time = session.time;

    // Обновляем кнопку Random
    let randBtn = document.getElementById("randomBtn");
    if (random) {
        randBtn.style.background = "#22c55e";
        randBtn.textContent = "Random ON";
    } else {
        randBtn.style.background = "#3b82f6";
        randBtn.textContent = "Random";
    }

    // Запускаем таймер с сохранённым временем
    clearInterval(timerInt);
    startTimer();

    // Показываем текущий вопрос
    show();
}

function startTimer() {
    timerInt = setInterval(() => {
        time--;
        if (time < 0) time = 0;
        timer.textContent = "⏱ " + time + "s";
        // если время вышло – не завершаем автоматически, как было в исходнике
    }, 1000);
}
