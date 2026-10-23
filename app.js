(() => {
  "use strict";

  const STORAGE_KEY = "yiling-classroom-assistant-v1";
  const COLORS = ["#ff8faf", "#8ce6d0", "#ffd166", "#b9a8ff", "#9dd9f5", "#ffb58f", "#c8e98c", "#f3a6d2"];
  const DEFAULT_TEAMS = ["第一組", "第二組", "第三組", "第四組"].map(name => ({ name, score: 0 }));
  const data = {
    roster: [],
    scores: DEFAULT_TEAMS.map(team => ({ ...team })),
    noise: { targetIndex: 0, threshold: 35, quietSeconds: 10 },
    schedule: [],
    exam: { subject: "", start: "", end: "", teacher: "", expected: 0, present: 0, notes: "" },
    focusMinutes: 25,
    breakMinutes: 5,
    focusCount: 0
  };
  let noticeTimer;

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  function notify(message, isError = false) {
    const notice = byId("app-notice");
    notice.textContent = message;
    notice.classList.toggle("visible", Boolean(message));
    notice.style.background = isError ? "#a9274e" : "";
    window.clearTimeout(noticeTimer);
    if (message) noticeTimer = window.setTimeout(() => notice.classList.remove("visible"), 3500);
  }

  function setStatus(element, text, kind = "") {
    element.textContent = text;
    element.classList.toggle("error", kind === "error");
    element.classList.toggle("success", kind === "success");
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        roster: data.roster,
        scores: data.scores,
        noise: data.noise,
        schedule: data.schedule,
        exam: data.exam,
        focusMinutes: data.focusMinutes,
        breakMinutes: data.breakMinutes,
        focusCount: data.focusCount
      }));
      return true;
    } catch (error) {
      console.error("無法儲存課堂資料。", error);
      notify("無法儲存資料，請確認瀏覽器儲存空間設定。", true);
      return false;
    }
  }

  function restoreLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const validated = validateData(saved);
      Object.assign(data, validated);
    } catch (error) {
      console.error("讀取課堂資料失敗。", error);
      notify("讀取既有資料失敗；目前先使用空白資料。", true);
    }
  }

  function isValidTime(value) {
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
    const [hours, minutes] = value.split(":").map(Number);
    return hours <= 23 && minutes <= 59;
  }

  function validateData(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) {
      throw new Error("檔案格式或版本不正確。");
    }
    if (!Array.isArray(value.roster) || !value.roster.every(name => typeof name === "string" && name.trim().length <= 80)) {
      throw new Error("學生名單格式不正確。");
    }
    if (!Array.isArray(value.scores) || value.scores.length < 1 || value.scores.length > 30 ||
        !value.scores.every(team => team && typeof team.name === "string" && team.name.trim().length > 0 &&
          team.name.length <= 80 && Number.isSafeInteger(team.score) && Math.abs(team.score) <= 1000000)) {
      throw new Error("小組分數格式不正確。");
    }
    if (!Array.isArray(value.schedule) || value.schedule.length > 500 || !value.schedule.every(item => item &&
        typeof item.id === "string" && typeof item.subject === "string" && item.subject.trim() &&
        item.subject.length <= 80 && isValidTime(item.start) && isValidTime(item.end) &&
        typeof item.teacher === "string" && item.teacher.length <= 60 &&
        Number.isSafeInteger(item.expected) && item.expected >= 0)) {
      throw new Error("課表格式不正確。");
    }
    const exam = value.exam === undefined
      ? { subject: "", start: "", end: "", teacher: "", expected: 0, present: 0, notes: "" }
      : value.exam;
    if (!exam || typeof exam !== "object" || Array.isArray(exam) ||
        !["subject", "teacher", "notes"].every(key => typeof exam[key] === "string") ||
        exam.subject.length > 80 || exam.teacher.length > 60 || exam.notes.length > 200 ||
        !["start", "end"].every(key => exam[key] === "" || isValidTime(exam[key])) ||
        !Number.isSafeInteger(exam.expected) || exam.expected < 0 ||
        !Number.isSafeInteger(exam.present) || exam.present < 0) {
      throw new Error("考試資訊格式不正確。");
    }
    const noise = value.noise === undefined
      ? { targetIndex: 0, threshold: 35, quietSeconds: 10 }
      : value.noise;
    if (!noise || typeof noise !== "object" || Array.isArray(noise) ||
        !Number.isInteger(noise.targetIndex) || noise.targetIndex < 0 || noise.targetIndex >= value.scores.length ||
        !Number.isInteger(noise.threshold) || noise.threshold < 5 || noise.threshold > 90 ||
        !Number.isInteger(noise.quietSeconds) || noise.quietSeconds < 1 || noise.quietSeconds > 60) {
      throw new Error("噪音偵測設定格式不正確。");
    }
    const focusMinutes = Number.isInteger(value.focusMinutes) && value.focusMinutes >= 1 && value.focusMinutes <= 180 ? value.focusMinutes : 25;
    const breakMinutes = Number.isInteger(value.breakMinutes) && value.breakMinutes >= 1 && value.breakMinutes <= 60 ? value.breakMinutes : 5;
    const focusCount = Number.isInteger(value.focusCount) && value.focusCount >= 0 ? value.focusCount : 0;
    return {
      roster: value.roster.map(name => name.trim()).filter(Boolean),
      scores: value.scores.map(team => ({ name: team.name.trim(), score: team.score })),
      noise: { ...noise },
      schedule: value.schedule.map(item => ({ ...item, subject: item.subject.trim(), teacher: item.teacher.trim() })),
      exam: {
        subject: exam.subject.trim(), start: exam.start, end: exam.end,
        teacher: exam.teacher.trim(), expected: exam.expected,
        present: exam.present, notes: exam.notes.trim()
      },
      focusMinutes,
      breakMinutes,
      focusCount
    };
  }

  function downloadFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function initDataManager() {
    const dialog = byId("data-manager");
    byId("data-manager-open").addEventListener("click", () => dialog.showModal());
    byId("export-data").addEventListener("click", () => {
      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        roster: data.roster,
        scores: data.scores,
        noise: data.noise,
        schedule: data.schedule,
        exam: data.exam,
        focusMinutes: data.focusMinutes,
        breakMinutes: data.breakMinutes,
        focusCount: data.focusCount
      };
      downloadFile(`奕伶老師課堂資料-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
      setStatus(byId("data-manager-status"), "JSON 備份已下載。", "success");
    });
    byId("import-data-trigger").addEventListener("click", () => byId("import-data-file").click());
    byId("import-data-file").addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = validateData(JSON.parse(text));
        Object.assign(data, imported);
        if (!persist()) throw new Error("資料匯入後無法保存到瀏覽器。");
        refreshSharedData();
        setStatus(byId("data-manager-status"), "資料已匯入並還原。", "success");
        notify("名單、分數與課表已還原。");
      } catch (error) {
        console.error("匯入課堂資料失敗。", error);
        setStatus(byId("data-manager-status"), `匯入失敗：${error.message}`, "error");
      } finally {
        event.target.value = "";
      }
    });
  }

  function initNavigation() {
    const buttons = [...document.querySelectorAll(".nav-button")];
    buttons.forEach(button => button.addEventListener("click", () => {
      const selected = button.dataset.tool;
      buttons.forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-current", active ? "page" : "false");
      });
      document.querySelectorAll(".tool-panel").forEach(panel => {
        const active = panel.dataset.panel === selected;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
      if (selected === "board") window.requestAnimationFrame(() => whiteboard.resize());
      if (selected === "groups" && groupTimers) groupTimers.render();
    }));
  }

  function initRaffleTool() {
    const nameArea = byId("roster-input");
    const history = [];
    const used = new Set();
    let mode = "names";
    let busy = false;
    let wheelRotation = 0;
    const wheelColors = ["#ff8faf", "#ffe18b", "#8ce6d0", "#c7b9ff", "#ffb68b", "#a7defb", "#f5a9d0", "#c8e98c"];
    const svgNamespace = "http://www.w3.org/2000/svg";
    nameArea.value = data.roster.join("\n");

    function readNames() {
      return [...new Set(nameArea.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean))];
    }
    function syncRoster() {
      data.roster = [...new Set(readNames())];
      nameArea.value = data.roster.join("\n");
      byId("roster-count").textContent = `目前 ${data.roster.length} 位`;
      persist();
    }
    function parseNumberPool() {
      const start = Number(byId("number-start").value);
      const end = Number(byId("number-end").value);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        throw new Error("請輸入有效的整數起訖號碼。");
      }
      if (end - start > 999) throw new Error("號碼範圍最多可設定 1,000 個號碼。");
      const excluded = new Set();
      const tokens = byId("number-exclusions").value.split(/[，,\s]+/).filter(Boolean);
      tokens.forEach(token => {
        const range = token.match(/^(\d+)-(\d+)$/);
        if (range) {
          const low = Number(range[1]);
          const high = Number(range[2]);
          if (high < low || high - low > 999) throw new Error(`排除範圍「${token}」無效。`);
          for (let number = low; number <= high; number += 1) excluded.add(String(number));
        } else if (/^\d+$/.test(token)) excluded.add(token);
        else throw new Error(`排除號碼「${token}」格式不正確。`);
      });
      return Array.from({ length: end - start + 1 }, (_, index) => String(start + index))
        .filter(number => !excluded.has(number));
    }
    function pool() {
      return mode === "names" ? readNames() : parseNumberPool();
    }
    function availablePool() {
      const candidates = pool();
      return byId("raffle-no-repeat").checked ? candidates.filter(item => !used.has(item)) : candidates;
    }
    function renderWheel(items) {
      const wheel = byId("raffle-wheel");
      const svg = wheel.querySelector(".wheel-svg");
      const center = 250;
      const radius = 242;
      const labelRadius = 158;
      svg.replaceChildren();
      svg.style.transform = `rotate(${wheelRotation}deg)`;
      if (!items.length) {
        const circle = document.createElementNS(svgNamespace, "circle");
        circle.setAttribute("cx", String(center));
        circle.setAttribute("cy", String(center));
        circle.setAttribute("r", String(radius));
        circle.setAttribute("fill", "#fff3f7");
        circle.setAttribute("stroke", "#3b333c");
        circle.setAttribute("stroke-width", "3");
        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", String(center));
        text.setAttribute("y", String(center));
        text.setAttribute("class", "wheel-label");
        text.setAttribute("font-size", "22");
        text.textContent = "請先輸入名單";
        svg.append(circle, text);
        wheel.setAttribute("aria-label", "抽籤轉盤目前沒有可抽對象");
        return;
      }
      const angle = 360 / items.length;
      const fontSize = items.length <= 12 ? 17 : items.length <= 24 ? 13 : items.length <= 40 ? 10 : items.length <= 80 ? 7 : 5;
      const maxCharacters = items.length <= 12 ? 16 : items.length <= 24 ? 12 : items.length <= 40 ? 9 : items.length <= 80 ? 6 : 4;
      const group = document.createElementNS(svgNamespace, "g");
      group.classList.add("wheel-sectors");
      items.forEach((item, index) => {
        const startAngle = -90 + index * angle;
        const endAngle = startAngle + angle;
        const startRadians = startAngle * Math.PI / 180;
        const endRadians = endAngle * Math.PI / 180;
        const startX = center + radius * Math.cos(startRadians);
        const startY = center + radius * Math.sin(startRadians);
        const endX = center + radius * Math.cos(endRadians);
        const endY = center + radius * Math.sin(endRadians);
        const sector = document.createElementNS(svgNamespace, items.length === 1 ? "circle" : "path");
        if (items.length === 1) {
          sector.setAttribute("cx", String(center));
          sector.setAttribute("cy", String(center));
          sector.setAttribute("r", String(radius));
        } else {
          sector.setAttribute("d", `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${angle > 180 ? 1 : 0} 1 ${endX} ${endY} Z`);
        }
        sector.setAttribute("fill", wheelColors[index % wheelColors.length]);
        sector.setAttribute("class", "wheel-sector");
        const title = document.createElementNS(svgNamespace, "title");
        title.textContent = String(item);
        sector.append(title);
        group.append(sector);

        const middleAngle = startAngle + angle / 2;
        let textAngle = middleAngle;
        if (textAngle > 90 && textAngle < 270) textAngle += 180;
        const label = document.createElementNS(svgNamespace, "text");
        label.setAttribute("x", String(center + labelRadius * Math.cos(middleAngle * Math.PI / 180)));
        label.setAttribute("y", String(center + labelRadius * Math.sin(middleAngle * Math.PI / 180)));
        label.setAttribute("class", "wheel-label");
        label.setAttribute("font-size", String(fontSize));
        label.setAttribute("transform", `rotate(${textAngle} ${label.getAttribute("x")} ${label.getAttribute("y")})`);
        const value = Array.from(String(item));
        label.textContent = value.length > maxCharacters ? `${value.slice(0, maxCharacters - 1).join("")}…` : String(item);
        label.setAttribute("aria-label", String(item));
        group.append(label);
      });
      svg.append(group);
      wheel.setAttribute("aria-label", `抽籤轉盤，共有 ${items.length} 個扇形；固定指針指向抽中對象`);
    }
    function renderAvailableWheel() {
      if (busy) return;
      try {
        renderWheel(availablePool());
      } catch (error) {
        setStatus(byId("raffle-status"), error.message, "error");
      }
    }
    function renderHistory() {
      const list = byId("raffle-history");
      list.replaceChildren();
      if (!history.length) {
        const empty = document.createElement("li");
        empty.className = "muted";
        empty.textContent = "還沒有抽籤紀錄";
        list.append(empty);
        return;
      }
      history.forEach((item, index) => {
        const entry = document.createElement("li");
        entry.textContent = `${index + 1}. ${item}`;
        list.append(entry);
      });
    }
    function drawOne() {
      if (busy) return;
      try {
        const choices = availablePool();
        if (!choices.length) throw new Error(mode === "names" ? "請輸入名單，或已經全部抽完。" : "沒有可抽的號碼。");
        busy = true;
        const selectedIndex = Math.floor(Math.random() * choices.length);
        const result = choices[selectedIndex];
        const wheel = byId("raffle-wheel");
        const winner = byId("wheel-winner");
        winner.hidden = true;
        winner.classList.remove("pop");
        renderWheel(choices);
        const sectorAngle = 360 / choices.length;
        const desiredAngle = ((360 - (selectedIndex + 0.5) * sectorAngle) % 360 + 360) % 360;
        const currentAngle = ((wheelRotation % 360) + 360) % 360;
        const alignment = (desiredAngle - currentAngle + 360) % 360;
        wheelRotation += 360 * 5 + alignment;
        const svg = wheel.querySelector(".wheel-svg");
        window.requestAnimationFrame(() => {
          svg.style.transform = `rotate(${wheelRotation}deg)`;
        });
        byId("draw-one").disabled = true;
        window.setTimeout(() => {
          byId("draw-result").textContent = result;
          winner.textContent = result;
          winner.hidden = false;
          void winner.offsetWidth;
          winner.classList.add("pop");
          history.unshift(result);
          if (byId("raffle-no-repeat").checked) used.add(result);
          renderHistory();
          busy = false;
          byId("draw-one").disabled = false;
          setStatus(byId("raffle-status"), `抽中了：${result}`, "success");
        }, 3900);
      } catch (error) {
        setStatus(byId("raffle-status"), error.message, "error");
      }
    }
    function renderGroups(groups) {
      const container = byId("group-results");
      container.replaceChildren();
      groups.forEach((members, index) => {
        const card = document.createElement("section");
        card.className = "group-card";
        const heading = document.createElement("h3");
        heading.textContent = `第 ${index + 1} 組`;
        const list = document.createElement("p");
        list.textContent = members.length ? members.join("、") : "—";
        card.append(heading, list);
        container.append(card);
      });
      container.hidden = false;
    }
    function drawGroups() {
      try {
        if (mode !== "names") throw new Error("請切換到「抽同學」模式，再進行隨機分組。");
        const names = readNames();
        if (names.length < 2) throw new Error("至少需要兩位同學才能分組。");
        const count = Number(byId("group-count").value);
        if (!Number.isInteger(count) || count < 2 || count > 12) throw new Error("分組數量請設定為 2 到 12 組。");
        const shuffled = [...names];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
          const swap = Math.floor(Math.random() * (index + 1));
          [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
        }
        const groups = Array.from({ length: Math.min(count, names.length) }, () => []);
        shuffled.forEach((name, index) => groups[index % groups.length].push(name));
        renderGroups(groups);
        window.lastRaffleGroups = groups.map((members, index) => ({ name: `第 ${index + 1} 組`, members }));
        byId("draw-result").textContent = "分組完成！";
        byId("wheel-winner").hidden = true;
        byId("wheel-winner").classList.remove("pop");
        notify(`已將 ${names.length} 位同學隨機分成 ${groups.length} 組。`);
      } catch (error) {
        setStatus(byId("raffle-status"), error.message, "error");
      }
    }

    document.querySelectorAll("[data-raffle-mode]").forEach(button => button.addEventListener("click", () => {
      mode = button.dataset.raffleMode;
      document.querySelectorAll("[data-raffle-mode]").forEach(item => item.classList.toggle("active", item === button));
      byId("raffle-name-settings").hidden = mode !== "names";
      byId("raffle-number-settings").hidden = mode !== "numbers";
      setStatus(byId("raffle-status"), "");
      renderAvailableWheel();
    }));
    byId("save-roster").addEventListener("click", () => {
      syncRoster();
      setStatus(byId("raffle-status"), `已儲存 ${data.roster.length} 位同學。`, "success");
    });
    nameArea.addEventListener("input", () => {
      data.roster = readNames();
      byId("roster-count").textContent = `目前 ${data.roster.length} 位`;
      persist();
      renderAvailableWheel();
    });
    nameArea.addEventListener("blur", syncRoster);
    ["number-start", "number-end", "number-exclusions"].forEach(id => {
      byId(id).addEventListener("input", renderAvailableWheel);
    });
    byId("raffle-no-repeat").addEventListener("change", renderAvailableWheel);
    byId("draw-one").addEventListener("click", drawOne);
    byId("draw-groups").addEventListener("click", drawGroups);
    byId("reset-raffle").addEventListener("click", () => {
      used.clear();
      history.length = 0;
      renderHistory();
      byId("draw-result").textContent = "準備好了嗎？";
      byId("wheel-winner").hidden = true;
      byId("wheel-winner").classList.remove("pop");
      byId("group-results").hidden = true;
      window.lastRaffleGroups = [];
      setStatus(byId("raffle-status"), "抽籤紀錄已清除，可以重新開始。", "success");
      renderAvailableWheel();
    });
    byId("roster-count").textContent = `目前 ${data.roster.length} 位`;
    renderAvailableWheel();
  }

  function initTimeTool() {
    let mode = "focus";
    let remainingMs = data.focusMinutes * 60000;
    let running = false;
    let lastTick = Date.now();
    let autoBellEnabled = false;
    const announced = new Set();
    const storageStatus = byId("bell-status");
    let lastClockSecond = -1;
    byId("focus-minutes").value = data.focusMinutes;
    byId("break-minutes").value = data.breakMinutes;
    byId("focus-count").textContent = `完成專注 ${data.focusCount} 次`;

    function renderExamInfo() {
      byId("exam-subject").value = data.exam.subject;
      byId("exam-start").value = data.exam.start;
      byId("exam-end").value = data.exam.end;
      byId("exam-teacher").value = data.exam.teacher;
      byId("exam-expected").value = String(data.exam.expected);
      byId("exam-present").value = String(data.exam.present);
      byId("exam-notes").value = data.exam.notes;
      byId("exam-subject-display").textContent = data.exam.subject || "考試大鐘";
      byId("exam-time-display").textContent = data.exam.start && data.exam.end ? `${data.exam.start} ～ ${data.exam.end}` : "--:-- ～ --:--";
      byId("exam-teacher-display").textContent = data.exam.teacher || "尚未設定";
      byId("exam-attendance-display").textContent = `應到 ${data.exam.expected} ／實到 ${data.exam.present}`;
      const marquee = byId("exam-marquee");
      marquee.textContent = data.exam.notes;
      marquee.hidden = !data.exam.notes;
      lastClockSecond = -1;
    }

    function renderExamClock(now) {
      const date = new Date(now);
      const seconds = date.getSeconds();
      if (seconds !== lastClockSecond) {
        lastClockSecond = seconds;
        byId("exam-current-time").textContent =
          `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        byId("exam-date-display").textContent = date.toLocaleDateString("zh-TW", {
          year: "numeric", month: "long", day: "numeric", weekday: "long"
        });
      }
      const label = byId("exam-remaining-label");
      const output = byId("exam-remaining");
      if (!data.exam.start || !data.exam.end) {
        label.textContent = "距離結束";
        output.textContent = "尚未設定";
        return;
      }
      const [startHour, startMinute] = data.exam.start.split(":").map(Number);
      const [endHour, endMinute] = data.exam.end.split(":").map(Number);
      const nowMinute = date.getHours() * 60 + date.getMinutes();
      const startMinuteOfDay = startHour * 60 + startMinute;
      const endMinuteOfDay = endHour * 60 + endMinute;
      const endDate = new Date(date);
      endDate.setHours(endHour, endMinute, 0, 0);
      if (endMinuteOfDay < startMinuteOfDay && nowMinute >= endMinuteOfDay) endDate.setDate(endDate.getDate() + 1);
      if (endDate.getTime() <= now) {
        label.textContent = "考試狀態";
        output.textContent = "已結束";
        return;
      }
      const beforeStart = endMinuteOfDay >= startMinuteOfDay
        ? nowMinute < startMinuteOfDay
        : nowMinute < startMinuteOfDay && nowMinute >= endMinuteOfDay;
      if (beforeStart) {
        const startDate = new Date(date);
        startDate.setHours(startHour, startMinute, 0, 0);
        label.textContent = "距離開始";
        output.textContent = formatCountdown(startDate.getTime() - now);
        return;
      }
      label.textContent = "距離結束";
      output.textContent = formatCountdown(endDate.getTime() - now);
    }

    function formatCountdown(milliseconds) {
      const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    byId("exam-form").addEventListener("submit", event => {
      event.preventDefault();
      const subject = byId("exam-subject").value.trim();
      const start = byId("exam-start").value;
      const end = byId("exam-end").value;
      const expected = Number(byId("exam-expected").value);
      const present = Number(byId("exam-present").value);
      if ((start && !end) || (!start && end) || (start && end && start === end) ||
          !Number.isSafeInteger(expected) || expected < 0 || !Number.isSafeInteger(present) || present < 0) {
        setStatus(byId("exam-status"), "請檢查考試時間；開始與結束時間需同時填寫且不可相同，人數需為 0 以上整數。", "error");
        return;
      }
      data.exam = {
        subject, start, end,
        teacher: byId("exam-teacher").value.trim(),
        expected, present,
        notes: byId("exam-notes").value.trim()
      };
      if (persist()) setStatus(byId("exam-status"), "考試資訊已儲存。", "success");
      renderExamInfo();
    });
    byId("exam-fullscreen").addEventListener("click", async event => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await byId("tool-time").requestFullscreen();
      } catch (error) {
        console.error("切換考試大鐘全螢幕失敗。", error);
        setStatus(byId("exam-status"), `無法切換全螢幕：${error.message}`, "error");
      }
    });
    document.addEventListener("fullscreenchange", () => {
      byId("exam-fullscreen").textContent = document.fullscreenElement ? "⛶ 離開全螢幕" : "⛶ 全螢幕";
    });

    function displayTime() {
      const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
      byId("focus-clock").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      byId("focus-mode-label").textContent = mode === "focus" ? "專注倒數" : "休息倒數";
      byId("focus-start").textContent = running ? "暫停" : "開始";
      updateRunningIndicators();
    }
    function setDurationFromInputs() {
      const minutes = Number(mode === "focus" ? byId("focus-minutes").value : byId("break-minutes").value);
      const max = mode === "focus" ? 180 : 60;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > max) {
        notify(`時間請設定為 1 到 ${max} 分鐘。`, true);
        return false;
      }
      if (mode === "focus") data.focusMinutes = minutes;
      else data.breakMinutes = minutes;
      remainingMs = minutes * 60000;
      persist();
      return true;
    }
    function finish() {
      running = false;
      if (mode === "focus") {
        data.focusCount += 1;
        byId("focus-count").textContent = `完成專注 ${data.focusCount} 次`;
        mode = "break";
        remainingMs = data.breakMinutes * 60000;
        notify("專注完成！休息一下吧 🍵");
      } else {
        mode = "focus";
        remainingMs = data.focusMinutes * 60000;
        notify("休息結束，準備好繼續專注了嗎？");
      }
      persist();
      displayTime();
      playTone();
    }
    byId("focus-start").addEventListener("click", () => {
      if (!running && remainingMs <= 0 && !setDurationFromInputs()) return;
      running = !running;
      lastTick = Date.now();
      displayTime();
    });
    byId("focus-reset").addEventListener("click", () => {
      running = false;
      mode = "focus";
      setDurationFromInputs();
      displayTime();
    });
    ["focus-minutes", "break-minutes"].forEach(id => byId(id).addEventListener("change", () => {
      if (id === "focus-minutes") data.focusMinutes = Number(byId(id).value) || 25;
      if (id === "break-minutes") data.breakMinutes = Number(byId(id).value) || 5;
      if (!running && mode === (id === "focus-minutes" ? "focus" : "break")) setDurationFromInputs();
      persist();
      displayTime();
    }));

    function renderSchedule() {
      const list = byId("schedule-list");
      list.replaceChildren();
      if (!data.schedule.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "目前沒有課表項目。";
        list.append(empty);
        return;
      }
      [...data.schedule].sort((a, b) => a.start.localeCompare(b.start)).forEach(item => {
        const row = document.createElement("div");
        row.className = "schedule-item";
        const details = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${item.start}–${item.end}　${item.subject}`;
        const sub = document.createElement("p");
        sub.textContent = `${item.teacher || "未填老師"} · 應到 ${item.expected} 人`;
        details.append(title, sub);
        const remove = document.createElement("button");
        remove.className = "button button-soft";
        remove.type = "button";
        remove.textContent = "刪除";
        remove.setAttribute("aria-label", `刪除課表 ${item.subject}`);
        remove.addEventListener("click", () => {
          data.schedule = data.schedule.filter(entry => entry.id !== item.id);
          persist();
          renderSchedule();
        });
        row.append(details, remove);
        list.append(row);
      });
    }
    byId("schedule-form").addEventListener("submit", event => {
      event.preventDefault();
      const subject = byId("schedule-subject").value.trim();
      const start = byId("schedule-start").value;
      const end = byId("schedule-end").value;
      const expected = Number(byId("schedule-expected").value);
      if (!subject || !start || !end || start === end || !Number.isSafeInteger(expected) || expected < 0) {
        setStatus(storageStatus, "請輸入有效課程名稱、時間與人數。", "error");
        return;
      }
      data.schedule.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subject, start, end, teacher: byId("schedule-teacher").value.trim(), expected
      });
      persist();
      renderSchedule();
      event.currentTarget.reset();
      byId("schedule-expected").value = "0";
      setStatus(storageStatus, "已新增課表。", "success");
    });
    byId("auto-bell").addEventListener("change", event => {
      autoBellEnabled = event.target.checked;
      setStatus(storageStatus, autoBellEnabled ? "課表自動提醒已啟用（此頁需保持開啟）。" : "課表自動提醒已停用。", "success");
      if (autoBellEnabled) playTone();
    });
    byId("bell-ring").addEventListener("click", () => {
      playTone();
      setStatus(storageStatus, "已播放上課鐘。", "success");
    });
    renderSchedule();
    renderExamInfo();
    displayTime();

    return {
      tick(now) {
        renderExamClock(now);
        if (running) {
          remainingMs -= Math.max(0, now - lastTick);
          lastTick = now;
          if (remainingMs <= 0) finish();
          else displayTime();
        }
        if (autoBellEnabled) {
          const current = new Date(now);
          const minute = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}-${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`;
          const time = `${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`;
          if (!announced.has(minute)) {
            const matching = data.schedule.find(item => item.start === time || item.end === time);
            if (matching) {
              announced.add(minute);
              playTone();
              setStatus(storageStatus, `${matching.subject} ${itemTimeLabel(matching, time)}，課表提醒。`, "success");
            }
          }
        }
      },
      isRunning: () => running,
      refreshSchedule: renderSchedule,
      refreshSettings() {
        running = false;
        mode = "focus";
        remainingMs = data.focusMinutes * 60000;
        lastTick = Date.now();
        byId("focus-minutes").value = data.focusMinutes;
        byId("break-minutes").value = data.breakMinutes;
        byId("focus-count").textContent = `完成專注 ${data.focusCount} 次`;
        renderExamInfo();
        displayTime();
      }
    };
  }

  function itemTimeLabel(item, time) {
    return item.start === time ? "開始" : "結束";
  }

  function playTone() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("此瀏覽器不支援播放提示音。");
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.56);
      oscillator.onended = () => context.close();
    } catch (error) {
      console.error("播放提示音失敗。", error);
      notify(error.message || "播放提示音失敗。", true);
    }
  }

  function initGroupTimers() {
    const timers = [];
    function timerNames() {
      return data.scores.length ? data.scores.map(team => team.name) : ["第一組", "第二組", "第三組", "第四組"];
    }
    function resetTimer(timer) {
      timer.running = false;
      timer.remaining = timer.minutes * 60 + timer.seconds;
      timer.endAt = null;
    }
    function timeText(seconds) {
      const safe = Math.max(0, Math.ceil(seconds));
      return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
    }
    function renderGroupTimers() {
      const grid = byId("group-timer-grid");
      grid.replaceChildren();
      const names = timerNames();
      while (timers.length < names.length) timers.push({ minutes: 3, seconds: 0, remaining: 180, running: false, mode: "down", elapsed: 0, lastAt: 0 });
      timers.length = names.length;
      timers.forEach((timer, index) => {
        const card = document.createElement("article");
        card.className = "timer-card";
        card.style.setProperty("--team-color", COLORS[index % COLORS.length]);
        card.innerHTML = `
          <div class="team-heading"><span class="team-dot" aria-hidden="true"></span><h2>${escapeHtml(names[index])}</h2></div>
          <label>計時模式<select class="mode-select"><option value="down">倒數計時</option><option value="up">正數計時（碼錶）</option></select></label>
          <div class="field-grid"><label>分鐘<input class="minutes-input" type="number" min="0" max="999" value="${timer.minutes}"></label><label>秒數<input class="seconds-input" type="number" min="0" max="59" value="${timer.seconds}"></label></div>
          <div class="quick-times">${[1, 3, 5, 10, 15, 20].map(minutes => `<button type="button" data-minutes="${minutes}">${minutes}分</button>`).join("")}</div>
          <div class="timer-display" role="timer">${timeText(timer.mode === "up" ? timer.elapsed : timer.remaining)}</div>
          <div class="timer-controls"><button class="button button-primary start-button" type="button">${timer.running ? "暫停" : "開始"}</button><button class="button button-soft reset-button" type="button">重設</button></div>`;
        const mode = card.querySelector(".mode-select");
        const minInput = card.querySelector(".minutes-input");
        const secInput = card.querySelector(".seconds-input");
        mode.value = timer.mode;
        mode.addEventListener("change", () => {
          timer.mode = mode.value;
          resetTimer(timer);
          timer.elapsed = 0;
          if (groupTimers) groupTimers.render();
        });
        const updateConfigured = () => {
          const minutes = Number(minInput.value);
          const seconds = Number(secInput.value);
          if (!Number.isInteger(minutes) || minutes < 0 || minutes > 999 || !Number.isInteger(seconds) || seconds < 0 || seconds > 59) {
            notify("計時分鐘請介於 0–999，秒數請介於 0–59。", true);
            return false;
          }
          timer.minutes = minutes;
          timer.seconds = seconds;
          resetTimer(timer);
          updateTimerCard(card, timer);
          updateRunningIndicators();
          return true;
        };
        minInput.addEventListener("change", updateConfigured);
        secInput.addEventListener("change", updateConfigured);
        card.querySelectorAll("[data-minutes]").forEach(button => button.addEventListener("click", () => {
          timer.minutes = Number(button.dataset.minutes);
          timer.seconds = 0;
          minInput.value = String(timer.minutes);
          secInput.value = "0";
          resetTimer(timer);
          updateTimerCard(card, timer);
          updateRunningIndicators();
        }));
        card.querySelector(".start-button").addEventListener("click", () => {
          if (timer.running) {
            timer.running = false;
            if (timer.mode === "down") timer.remaining = Math.max(0, timer.endAt - Date.now()) / 1000;
            else timer.elapsed = (timer.elapsed * 1000 + Date.now() - timer.lastAt) / 1000;
          } else {
            if (timer.mode === "down" && timer.remaining <= 0) resetTimer(timer);
            timer.running = true;
            timer.lastAt = Date.now();
            timer.endAt = timer.lastAt + timer.remaining * 1000;
          }
          updateTimerCard(card, timer);
          updateRunningIndicators();
        });
        card.querySelector(".reset-button").addEventListener("click", () => {
          resetTimer(timer);
          timer.elapsed = 0;
          updateTimerCard(card, timer);
          updateRunningIndicators();
        });
        grid.append(card);
      });
      updateRunningIndicators();
    }
    function updateTimerCard(card, timer) {
      const display = card.querySelector(".timer-display");
      if (display) display.textContent = timeText(timer.mode === "up" ? timer.elapsed : timer.remaining);
      const start = card.querySelector(".start-button");
      if (start) start.textContent = timer.running ? "暫停" : "開始";
    }
    byId("group-start-all").addEventListener("click", () => {
      const now = Date.now();
      timers.forEach(timer => {
        if (!timer.running) {
          if (timer.mode === "down" && timer.remaining <= 0) resetTimer(timer);
          timer.running = true;
          timer.lastAt = now;
          timer.endAt = now + timer.remaining * 1000;
        }
      });
      if (groupTimers) groupTimers.render();
    });
    byId("group-reset-all").addEventListener("click", () => {
      timers.forEach(timer => { resetTimer(timer); timer.elapsed = 0; });
      if (groupTimers) groupTimers.render();
    });
    byId("group-use-score-teams").addEventListener("click", () => {
      timers.forEach(timer => { timer.running = false; });
      timers.length = 0;
      renderGroupTimers();
      notify("小組計時器已同步計分板組別。");
    });
    renderGroupTimers();
    return {
      render: renderGroupTimers,
      tick(now) {
        timers.forEach((timer, index) => {
          if (!timer.running) return;
          if (timer.mode === "down") {
            timer.remaining = Math.max(0, (timer.endAt - now) / 1000);
            if (timer.remaining <= 0) {
              timer.running = false;
              playTone();
            }
          } else {
            timer.elapsed += Math.max(0, now - timer.lastAt) / 1000;
            timer.lastAt = now;
          }
          const card = byId("group-timer-grid").children[index];
          if (card) updateTimerCard(card, timer);
        });
        updateRunningIndicators();
      },
      isRunning: () => timers.some(timer => timer.running)
    };
  }

  function refreshNoiseTeamOptions() {
    const select = byId("noise-team");
    if (!select) return;
    select.replaceChildren();
    if (!data.scores.length) return;
    if (data.noise.targetIndex >= data.scores.length) data.noise.targetIndex = 0;
    data.scores.forEach((team, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = team.name;
      option.selected = index === data.noise.targetIndex;
      select.append(option);
    });
  }

  function initScoreboard() {
    const grid = byId("score-team-grid");
    function render() {
      refreshNoiseTeamOptions();
      grid.replaceChildren();
      data.scores.forEach((team, index) => {
        const card = document.createElement("article");
        card.className = "score-card";
        card.style.setProperty("--team-color", COLORS[index % COLORS.length]);
        const input = document.createElement("input");
        input.className = "score-team-name";
        input.value = team.name;
        input.maxLength = 80;
        input.setAttribute("aria-label", `第 ${index + 1} 組名稱`);
        input.addEventListener("change", () => {
          const name = input.value.trim();
          if (!name) {
            input.value = team.name;
            notify("小組名稱不可空白。", true);
            return;
          }
          team.name = name;
          persist();
          if (groupTimers) groupTimers.render();
          refreshNoiseTeamOptions();
        });
        const total = document.createElement("output");
        total.className = "score-total";
        total.textContent = String(team.score);
        const actions = document.createElement("div");
        actions.className = "score-actions";
        const subtract = document.createElement("button");
        subtract.type = "button";
        subtract.textContent = "−";
        subtract.setAttribute("aria-label", `扣除${team.name}分數`);
        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "+";
        add.setAttribute("aria-label", `增加${team.name}分數`);
        const changeScore = direction => {
          const step = Number(byId("score-step").value);
          if (!Number.isInteger(step) || step < 1 || step > 100) {
            notify("加減分請設定為 1 到 100 的整數。", true);
            return;
          }
          team.score += direction * step;
          total.textContent = String(team.score);
          persist();
        };
        subtract.addEventListener("click", () => changeScore(-1));
        add.addEventListener("click", () => changeScore(1));
        actions.append(subtract, add);
        card.append(input, total, actions);
        grid.append(card);
      });
    }
    byId("score-add-team").addEventListener("click", () => {
      if (data.scores.length >= 30) {
        notify("小組數量已達 30 組上限。", true);
        return;
      }
      data.scores.push({ name: `第 ${data.scores.length + 1} 組`, score: 0 });
      persist();
      render();
      if (groupTimers) groupTimers.render();
    });
    byId("score-reset").addEventListener("click", () => {
      data.scores.forEach(team => { team.score = 0; });
      persist();
      render();
      notify("所有小組分數已歸零。");
    });
    byId("score-import-groups").addEventListener("click", () => {
      const groups = window.lastRaffleGroups || [];
      if (!groups.length) {
        notify("請先到抽籤機進行隨機分組。", true);
        return;
      }
      data.scores = groups.map(group => ({ name: group.name, score: 0 }));
      data.noise.targetIndex = 0;
      persist();
      render();
      if (groupTimers) groupTimers.render();
      notify("隨機分組結果已帶入計分板。");
    });
    render();
    return { render };
  }

  function initNoiseDetector() {
    const micButton = byId("toggle-mic");
    const micState = byId("mic-state");
    const meter = byId("volume-meter");
    const meterFill = byId("volume-fill");
    const volumeValue = byId("volume-value");
    const noiseStatus = byId("noise-status");
    const quietFill = byId("quiet-fill");
    const quietProgress = document.querySelector(".quiet-progress");
    const thresholdInput = byId("threshold");
    const quietInput = byId("quiet-seconds");
    let audioContext = null;
    let analyser = null;
    let microphoneStream = null;
    let animationFrame = null;
    let samples = null;
    let quietStartedAt = null;
    let lastNoisePenaltyAt = -Infinity;
    let previousLoud = false;

    function setNoiseStatus(message, live = false) {
      noiseStatus.textContent = message;
      noiseStatus.classList.toggle("live", live);
    }
    function setVolume(percent) {
      meterFill.style.width = `${percent}%`;
      volumeValue.textContent = `${percent}%`;
      meter.setAttribute("aria-valuenow", String(percent));
    }
    function setQuietProgress(percent) {
      quietFill.style.width = `${percent}%`;
      quietProgress.setAttribute("aria-valuenow", String(percent));
    }
    function getQuietSeconds() {
      const value = Number(quietInput.value);
      return Number.isFinite(value) ? Math.min(60, Math.max(1, Math.trunc(value))) : 10;
    }
    function updateScore(delta) {
      const team = data.scores[data.noise.targetIndex];
      if (!team) {
        setNoiseStatus("找不到自動計分小組，請重新選擇。");
        return null;
      }
      team.score += delta;
      persist();
      if (scoreboardTool) scoreboardTool.render();
      playTone();
      return team.name;
    }
    function analyzeAudio() {
      if (!analyser || !samples) return;
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const percent = Math.min(100, Math.round(Math.max(0, (rms - 0.008) / 0.32) * 100));
      const now = performance.now();
      const loud = percent >= data.noise.threshold;
      setVolume(percent);
      if (loud) {
        quietStartedAt = null;
        setQuietProgress(0);
        if (!previousLoud && now - lastNoisePenaltyAt >= 5000) {
          const teamName = updateScore(-1);
          lastNoisePenaltyAt = now;
          setNoiseStatus(`音量超過門檻！${teamName || "指定小組"}扣 1 分，5 秒內不會再次扣分。`);
        } else if (now - lastNoisePenaltyAt < 5000) {
          setNoiseStatus("音量超過門檻，正在冷卻中（5 秒內不重複扣分）。");
        } else {
          setNoiseStatus("音量超過門檻。");
        }
      } else {
        if (previousLoud) quietStartedAt = now;
        if (quietStartedAt === null) quietStartedAt = now;
        const quietMs = now - quietStartedAt;
        const requiredMs = getQuietSeconds() * 1000;
        const progress = Math.min(100, Math.floor(quietMs / requiredMs * 100));
        setQuietProgress(progress);
        if (quietMs >= requiredMs) {
          const teamName = updateScore(1);
          quietStartedAt = now;
          setQuietProgress(0);
          setNoiseStatus(`連續安靜達 ${getQuietSeconds()} 秒！${teamName || "指定小組"}加 1 分。`, true);
        } else {
          const remaining = Math.max(1, Math.ceil((requiredMs - quietMs) / 1000));
          setNoiseStatus(`音量正常，持續安靜 ${remaining} 秒即可加 1 分。`, true);
        }
      }
      previousLoud = loud;
      animationFrame = window.requestAnimationFrame(analyzeAudio);
    }
    function stopMicrophone() {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      if (microphoneStream) microphoneStream.getTracks().forEach(track => track.stop());
      microphoneStream = null;
      analyser = null;
      samples = null;
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(error => console.error("關閉噪音偵測音訊時發生錯誤。", error));
      }
      audioContext = null;
      quietStartedAt = null;
      previousLoud = false;
      micState.textContent = "已停止";
      micButton.textContent = "啟動麥克風";
      setVolume(0);
      setQuietProgress(0);
      setNoiseStatus("麥克風已停止。");
    }
    async function startMicrophone() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        micState.textContent = "無法使用";
        setNoiseStatus("此瀏覽器或連線環境不支援麥克風。請使用最新版瀏覽器，並透過 HTTPS 或 localhost 開啟。");
        return;
      }
      micButton.disabled = true;
      micState.textContent = "等待權限…";
      setNoiseStatus("請在瀏覽器彈出視窗中允許使用麥克風。");
      try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false }
        });
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("此瀏覽器不支援 Web Audio API。");
        audioContext = new AudioContextClass();
        if (audioContext.state === "suspended") await audioContext.resume();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        samples = new Uint8Array(analyser.fftSize);
        audioContext.createMediaStreamSource(microphoneStream).connect(analyser);
        quietStartedAt = performance.now();
        lastNoisePenaltyAt = -Infinity;
        previousLoud = false;
        micState.textContent = "正在聆聽";
        micButton.textContent = "停止麥克風";
        setNoiseStatus("麥克風已啟動。說話或拍手測試音量條。", true);
        animationFrame = window.requestAnimationFrame(analyzeAudio);
      } catch (error) {
        if (microphoneStream) microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
        if (audioContext && audioContext.state !== "closed") {
          await audioContext.close().catch(closeError => console.error("關閉噪音偵測音訊時發生錯誤。", closeError));
        }
        audioContext = null;
        analyser = null;
        samples = null;
        micState.textContent = "需要權限";
        if (error.name === "NotAllowedError" || error.name === "SecurityError") {
          setNoiseStatus("沒有麥克風權限。請允許此網站使用麥克風；此頁需在 HTTPS 或 localhost 環境使用。");
        } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
          setNoiseStatus("找不到麥克風裝置。請連接或啟用麥克風後再試一次。");
        } else {
          console.error("無法啟動噪音偵測。", error);
          setNoiseStatus(`無法啟動麥克風：${error.message || "發生未知錯誤"}。請檢查瀏覽器權限與裝置設定。`);
        }
      } finally {
        micButton.disabled = false;
      }
    }

    micButton.addEventListener("click", () => {
      if (microphoneStream) stopMicrophone();
      else startMicrophone();
    });
    thresholdInput.addEventListener("input", () => {
      data.noise.threshold = Number(thresholdInput.value);
      byId("threshold-value").textContent = `${data.noise.threshold}%`;
      persist();
    });
    quietInput.addEventListener("change", () => {
      data.noise.quietSeconds = getQuietSeconds();
      quietInput.value = String(data.noise.quietSeconds);
      quietStartedAt = microphoneStream ? performance.now() : null;
      persist();
    });
    byId("noise-team").addEventListener("change", event => {
      data.noise.targetIndex = Number(event.target.value);
      persist();
    });
    window.addEventListener("pagehide", stopMicrophone);
    function refreshSettings() {
      thresholdInput.value = String(data.noise.threshold);
      byId("threshold-value").textContent = `${data.noise.threshold}%`;
      quietInput.value = String(data.noise.quietSeconds);
      refreshNoiseTeamOptions();
    }
    refreshSettings();

    return { refreshSettings };
  }

  function initWhiteboard() {
    const canvas = byId("whiteboard");
    const context = canvas.getContext("2d");
    if (!context) {
      notify("此瀏覽器無法建立畫布。", true);
      return { resize() {} };
    }
    const strokes = [];
    let currentStroke = null;
    let erasing = false;
    let width = 0;
    let height = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width;
      height = rect.height;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      redraw();
    }
    function redraw() {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      strokes.forEach(stroke => {
        if (!stroke.points.length) return;
        context.beginPath();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = stroke.size;
        context.strokeStyle = stroke.erase ? "#fff" : stroke.color;
        context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
        stroke.points.slice(1).forEach(point => context.lineTo(point.x * width, point.y * height));
        if (stroke.points.length === 1) {
          context.lineTo(stroke.points[0].x * width + 0.1, stroke.points[0].y * height + 0.1);
        }
        context.stroke();
      });
    }
    function pointFromEvent(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
    }
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      currentStroke = {
        color: byId("board-color").value,
        size: Number(byId("board-size").value),
        erase: erasing,
        points: [pointFromEvent(event)]
      };
      strokes.push(currentStroke);
      redraw();
    });
    canvas.addEventListener("pointermove", event => {
      if (!currentStroke) return;
      currentStroke.points.push(pointFromEvent(event));
      redraw();
    });
    const finishStroke = () => { currentStroke = null; };
    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);
    byId("board-eraser").addEventListener("click", event => {
      erasing = !erasing;
      event.currentTarget.setAttribute("aria-pressed", String(erasing));
      event.currentTarget.textContent = erasing ? "使用畫筆" : "橡皮擦";
    });
    byId("board-undo").addEventListener("click", () => { strokes.pop(); redraw(); });
    byId("board-clear").addEventListener("click", () => {
      strokes.length = 0;
      redraw();
    });
    byId("board-download").addEventListener("click", () => {
      const link = document.createElement("a");
      link.download = "課堂白板.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
    window.addEventListener("resize", resize);
    resize();
    return { resize };
  }

  function initIrsTool() {
    const queryRoom = new URLSearchParams(window.location.search).get("room");
    const teacherView = byId("irs-teacher-view");
    const studentView = byId("irs-student-view");
    const students = new Map();
    const options = ["A", "B", "C", "D"];
    let teacherPeer = null;
    let studentPeer = null;
    let roomCode = "";
    let activeQuestion = null;
    let studentConnection = null;
    let selectedChoice = "";
    window.addEventListener("pagehide", () => {
      if (teacherPeer) teacherPeer.destroy();
      if (studentPeer) studentPeer.destroy();
    });

    function status(id, text, kind) { setStatus(byId(id), text, kind); }
    function parseMessage(raw) {
      if (!raw || typeof raw !== "object" || typeof raw.type !== "string") return null;
      return raw;
    }
    function send(connection, message) {
      if (connection && connection.open) connection.send(message);
    }
    function renderStudents() {
      const list = byId("irs-student-list");
      list.replaceChildren();
      byId("irs-student-count").textContent = String(students.size);
      [...students.values()].forEach(student => {
        const item = document.createElement("li");
        item.textContent = `${student.name} — ${student.answer ? `已答 ${student.answer}` : "尚未作答"}${student.connected ? "" : "（已離線）"}`;
        list.append(item);
      });
      renderChart();
    }
    function renderChart() {
      const chart = byId("irs-answer-chart");
      chart.replaceChildren();
      if (!activeQuestion) return;
      const answered = [...students.values()].filter(student => student.answer).length;
      options.forEach(letter => {
        const count = [...students.values()].filter(student => student.answer === letter).length;
        const row = document.createElement("div");
        row.className = "answer-row";
        const label = document.createElement("strong");
        label.textContent = letter;
        const track = document.createElement("div");
        track.className = "bar-track";
        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.width = `${answered ? count / answered * 100 : 0}%`;
        track.append(bar);
        const number = document.createElement("span");
        number.textContent = `${count} 人`;
        row.append(label, track, number);
        chart.append(row);
      });
    }
    function handleTeacherConnection(connection) {
      connection.on("data", raw => {
        const message = parseMessage(raw);
        if (!message) return;
        if (message.type === "join" && typeof message.name === "string") {
          const name = message.name.trim().slice(0, 40);
          if (!name) return;
          const current = students.get(connection.peer);
          students.set(connection.peer, { name, connection, connected: true, answer: current ? current.answer : "" });
          send(connection, { type: "joined", room: roomCode });
          if (activeQuestion) send(connection, { type: "question", question: activeQuestion });
          renderStudents();
        } else if (message.type === "answer" && activeQuestion &&
          options.includes(message.choice) && message.questionId === activeQuestion.id) {
          const student = students.get(connection.peer);
          if (!student) return;
          student.answer = message.choice;
          renderStudents();
        }
      });
      connection.on("close", () => {
        const student = students.get(connection.peer);
        if (student && student.connection === connection) {
          student.connected = false;
          renderStudents();
        }
      });
      connection.on("error", error => console.error("學生連線錯誤。", error));
    }
    function createRoom() {
      if (typeof window.Peer !== "function") {
        status("irs-teacher-status", "PeerJS 載入失敗，請確認網路連線後重新整理。", "error");
        return;
      }
      byId("irs-create-room").disabled = true;
      status("irs-teacher-status", "正在建立教室，請稍候…");
      let attempts = 0;
      function tryRoom() {
        attempts += 1;
        if (attempts > 5) {
          byId("irs-create-room").disabled = false;
          status("irs-teacher-status", "無法取得教室代碼，請稍後再試。", "error");
          return;
        }
        const candidate = String(Math.floor(1000 + Math.random() * 9000));
        const peer = new window.Peer(`irsroom${candidate}`);
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          peer.destroy();
          byId("irs-create-room").disabled = false;
          status("irs-teacher-status", "連線逾時，請檢查網路後再試。", "error");
        }, 12000);
        peer.on("open", id => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          teacherPeer = peer;
          roomCode = candidate;
          peer.on("connection", handleTeacherConnection);
          byId("irs-room-code").textContent = roomCode;
          const joinUrl = new URL(window.location.href);
          joinUrl.searchParams.set("room", roomCode);
          byId("irs-join-link").href = joinUrl.href;
          byId("irs-join-link").textContent = joinUrl.href;
          byId("irs-create-card").hidden = true;
          byId("irs-teacher-dashboard").hidden = false;
          status("irs-teacher-status", `教室 ${roomCode} 已建立，等待學生加入。`, "success");
          byId("irs-qrcode").replaceChildren();
          if (typeof window.QRCode === "function") {
            new window.QRCode(byId("irs-qrcode"), { text: joinUrl.href, width: 150, height: 150 });
          } else {
            byId("irs-qrcode").textContent = "QR Code 載入失敗，請分享上方連結。";
          }
        });
        peer.on("error", error => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          peer.destroy();
          if (error.type === "unavailable-id") tryRoom();
          else {
            console.error("建立教室失敗。", error);
            byId("irs-create-room").disabled = false;
            status("irs-teacher-status", `建立教室失敗：${error.message || error.type}`, "error");
          }
        });
      }
      tryRoom();
    }
    byId("irs-create-room").addEventListener("click", createRoom);
    byId("irs-question-form").addEventListener("submit", event => {
      event.preventDefault();
      if (!teacherPeer) {
        status("irs-teacher-status", "教室尚未連線，請先重新建立教室。", "error");
        return;
      }
      activeQuestion = {
        id: `${Date.now()}`,
        text: byId("irs-question").value.trim(),
        options: Object.fromEntries(options.map(letter => [letter, byId(`irs-option-${letter}`).value.trim()]))
      };
      if (!activeQuestion.text || options.some(letter => !activeQuestion.options[letter])) {
        status("irs-teacher-status", "請完整填寫題目與四個選項。", "error");
        return;
      }
      students.forEach(student => {
        student.answer = "";
        send(student.connection, { type: "question", question: activeQuestion });
      });
      byId("irs-active-question").textContent = activeQuestion.text;
      renderChart();
      status("irs-teacher-status", "題目已發布。", "success");
    });
    byId("irs-export-csv").addEventListener("click", () => {
      const rows = [["姓名", "教室代碼", "題目", "選項", "選項內容", "回答時間"]];
      students.forEach(student => rows.push([
        student.name, roomCode, activeQuestion ? activeQuestion.text : "",
        student.answer, activeQuestion ? activeQuestion.options[student.answer] || "" : ""
      ]));
      const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      downloadFile(`IRS-${roomCode || "課堂"}-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
    });

    if (queryRoom && /^\d{4}$/.test(queryRoom)) {
      roomCode = queryRoom;
      teacherView.hidden = true;
      studentView.hidden = false;
      byId("irs-student-room-code").textContent = roomCode;
      byId("irs-join-form").addEventListener("submit", event => {
        event.preventDefault();
        if (typeof window.Peer !== "function") {
          status("irs-student-status", "PeerJS 載入失敗，請確認網路連線後重新整理。", "error");
          return;
        }
        const name = byId("irs-student-name").value.trim().slice(0, 40);
        if (!name) return;
        if (studentPeer) studentPeer.destroy();
        studentPeer = new window.Peer();
        status("irs-student-status", "正在連線教室…");
        studentPeer.on("open", () => {
          studentConnection = studentPeer.connect(`irsroom${roomCode}`, { reliable: true });
          studentConnection.on("open", () => {
            send(studentConnection, { type: "join", name });
            status("irs-student-status", "已連線，等待老師發布題目。", "success");
          });
          studentConnection.on("data", raw => {
            const message = parseMessage(raw);
            if (message && message.type === "question" && message.question &&
                typeof message.question.text === "string" && message.question.options) {
              renderStudentQuestion(message.question);
            } else if (message && message.type === "joined") {
              status("irs-student-status", `已加入教室 ${roomCode}。`, "success");
            }
          });
          studentConnection.on("error", error => status("irs-student-status", `連線錯誤：${error.message}`, "error"));
          studentConnection.on("close", () => status("irs-student-status", "與教室的連線已中斷。", "error"));
        });
        studentPeer.on("error", error => {
          console.error("學生加入教室失敗。", error);
          status("irs-student-status", `加入教室失敗：${error.message || error.type}`, "error");
        });
      });
    } else {
      studentView.hidden = true;
      teacherView.hidden = false;
    }

    function renderStudentQuestion(question) {
      selectedChoice = "";
      byId("irs-student-question-card").hidden = false;
      byId("irs-student-question").textContent = question.text;
      byId("irs-student-answer-status").textContent = "請選擇一個答案。";
      const buttons = byId("irs-student-options");
      buttons.replaceChildren();
      options.forEach(letter => {
        const button = document.createElement("button");
        button.className = "student-choice";
        button.type = "button";
        button.textContent = `${letter}. ${question.options[letter] || ""}`;
        button.addEventListener("click", () => {
          selectedChoice = letter;
          buttons.querySelectorAll("button").forEach(item => item.classList.toggle("selected", item === button));
          send(studentConnection, { type: "answer", choice: letter, questionId: question.id });
          byId("irs-student-answer-status").textContent = `已送出答案 ${letter}，可以修改答案。`;
        });
        buttons.append(button);
      });
    }
  }

  function refreshSharedData() {
    byId("roster-input").value = data.roster.join("\n");
    byId("roster-input").dispatchEvent(new Event("input", { bubbles: true }));
    byId("roster-count").textContent = `目前 ${data.roster.length} 位`;
    byId("focus-minutes").value = data.focusMinutes;
    byId("break-minutes").value = data.breakMinutes;
    byId("focus-count").textContent = `完成專注 ${data.focusCount} 次`;
    if (timeTool) timeTool.refreshSettings();
    initScoreboardRenderer();
    if (groupTimers) groupTimers.render();
    if (timeTool) timeTool.refreshSchedule();
    if (noiseDetector) noiseDetector.refreshSettings();
  }

  let timeTool = null;
  let groupTimers = null;
  let scoreboardTool = null;
  let noiseDetector = null;
  function initScoreboardRenderer() {
    if (scoreboardTool) scoreboardTool.render();
  }
  function updateRunningIndicators() {
    const states = {
      time: Boolean(timeTool && timeTool.isRunning()),
      groups: Boolean(groupTimers && groupTimers.isRunning())
    };
    document.querySelectorAll(".nav-button").forEach(button => {
      const dot = button.querySelector(".running-dot");
      if (dot) dot.hidden = !states[button.dataset.tool];
    });
  }

  restoreLocal();
  initNavigation();
  initDataManager();
  initRaffleTool();
  timeTool = initTimeTool();
  groupTimers = initGroupTimers();
  scoreboardTool = initScoreboard();
  noiseDetector = initNoiseDetector();
  const whiteboard = initWhiteboard();
  initIrsTool();

  window.setInterval(() => {
    const now = Date.now();
    timeTool.tick(now);
    groupTimers.tick(now);
  }, 250);
})();
