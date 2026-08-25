const state = {
  members: [],
  tasks: [],
  v3ExecutionTaskIndex: new Map(),
  v3ExecutionContextEnabled: false,
  assignments: [],
  logs: [],
  templates: [],
  archiveTasks: [],
  trash: { tasks: [], members: [] },
  maintenancePreview: { archived_tasks: 0, deleted_tasks: 0, deleted_members: 0, logs: 0 },
  stats: null,
  today: "",
  activeView: "gantt",
  search: "",
  taskSort: "time_asc",
  taskViewMode: "cards",
  scale: "day",
  zoom: 60,
  rangeMode: "smart",
  sidebarCollapsed: false,
  onlyBusyMembers: false,
  stackTasks: true,
  stackMemberList: true,
  loadPeriod: "current",
  loadMemberId: "",
  logSearch: "",
  logType: "",
  logDate: "",
  memberSearch: "",
  filters: {
    member_id: "",
    status: "",
    start_date: "",
    end_date: "",
    overdue: false,
    overlap: false
  },
  filteredTaskIds: null,
  selectedTaskIds: new Set(),
  activeAssignmentId: null,
  activeTaskId: null,
  drag: null,
  busyActions: new Set()
};

const DESKTOP_PREFS_KEY = "teamTaskGantt.desktopPrefs.v1";
const desktopPreferenceDefaults = {
  activeView: "gantt",
  scale: "day",
  zoom: 60,
  rangeMode: "smart",
  taskViewMode: "cards",
  taskSort: "time_asc",
  sidebarCollapsed: false
};

function readDesktopPreferences() {
  try {
    const value = JSON.parse(window.localStorage.getItem(DESKTOP_PREFS_KEY) || "null");
    if (!value || typeof value !== "object") return { ...desktopPreferenceDefaults };
    const result = { ...desktopPreferenceDefaults };
    if (["gantt", "tasks", "load", "logs", "maintenance"].includes(value.activeView)) result.activeView = value.activeView;
    if (["day", "week", "month"].includes(value.scale)) result.scale = value.scale;
    if (Number.isFinite(Number(value.zoom)) && Number(value.zoom) >= 8 && Number(value.zoom) <= 60) result.zoom = Number(value.zoom);
    if (["smart", "all", "week", "month", "30", "90"].includes(value.rangeMode)) result.rangeMode = value.rangeMode;
    if (["cards", "list"].includes(value.taskViewMode)) result.taskViewMode = value.taskViewMode;
    if (["time_asc", "time_desc", "name_asc", "name_desc"].includes(value.taskSort)) result.taskSort = value.taskSort;
    if (typeof value.sidebarCollapsed === "boolean") result.sidebarCollapsed = value.sidebarCollapsed;
    return result;
  } catch {
    return { ...desktopPreferenceDefaults };
  }
}

Object.assign(state, readDesktopPreferences());

const statusLabels = {
  planned: "未开始",
  active: "进行中",
  paused: "暂停",
  completed: "已完成",
  cancelled: "取消",
  archived: "归档"
};

const manualStatusLabels = {
  paused: "暂停",
  completed: "已完成",
  cancelled: "取消"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function addDays(date, amount) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + amount);
  return formatLocalDate(next);
}

function daysBetween(start, end) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay);
  const endUtc = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.round((endUtc - startUtc) / 86400000);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayLocalDate() {
  return formatLocalDate(new Date());
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDate(date) {
  return date.slice(5).replace("-", "/");
}

function weekdayLabel(date) {
  return ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T00:00:00`).getDay()];
}

function isWeekend(date) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function monthChanged(previous, current) {
  return previous && previous.slice(0, 7) !== current.slice(0, 7);
}

let toastTimer = null;
let detailReturnFocus = null;
let detailReturnSelector = "";

function showToast(message, options = {}) {
  const toast = $("#toast");
  if (!toast) return;
  const { type = "status", actionLabel = "", onAction = null } = options;
  if (toastTimer) window.clearTimeout(toastTimer);
  toast.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.classList.toggle("error", type === "error");
  if (actionLabel && typeof onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = actionLabel;
    action.addEventListener("click", async () => {
      if (action.disabled) return;
      action.disabled = true;
      try {
        await onAction();
      } catch (error) {
        showToast(`撤销失败：${error.message}`, { type: "error" });
      }
    }, { once: true });
    toast.appendChild(action);
  }
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), actionLabel ? 7000 : 3000);
}

function safeColor(value, fallback = "#2563eb") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
}

function saveDesktopPreferences() {
  const preferences = {
    activeView: state.activeView,
    scale: state.scale,
    zoom: state.zoom,
    rangeMode: state.rangeMode,
    taskViewMode: state.taskViewMode,
    taskSort: state.taskSort,
    sidebarCollapsed: state.sidebarCollapsed
  };
  try {
    window.localStorage.setItem(DESKTOP_PREFS_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are optional and must never block task work.
  }
}

function isBusy(key) {
  return state.busyActions.has(key);
}

async function runBusyAction(key, action, options = {}) {
  if (isBusy(key)) return false;
  const { control = null, relatedControls = [], busyText = "处理中…", onError = null, renderBusy = null } = options;
  const button = control?.closest?.("button") || control;
  const originalText = button?.textContent;
  state.busyActions.add(key);
  if (button) {
    button.disabled = true;
    if (busyText) button.textContent = busyText;
  }
  relatedControls.filter(Boolean).forEach((item) => { item.disabled = true; });
  renderBusy?.();
  try {
    await action();
    return true;
  } catch (error) {
    onError?.(error);
    showToast(error.message || "操作失败", { type: "error" });
    return false;
  } finally {
    state.busyActions.delete(key);
    if (button?.isConnected) {
      button.disabled = false;
      if (originalText !== undefined) button.textContent = originalText;
    }
    relatedControls.filter((item) => item?.isConnected).forEach((item) => { item.disabled = false; });
    renderBusy?.();
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || "请求失败");
    error.code = payload?.code || "REQUEST_FAILED";
    error.details = payload?.details || {};
    error.status = response.status;
    throw error;
  }
  return payload;
}

function filterQuery() {
  const params = new URLSearchParams();
  if (state.filters.member_id) params.set("member_id", state.filters.member_id);
  if (state.filters.status) params.set("status", state.filters.status);
  if (state.filters.start_date) params.set("start_date", state.filters.start_date);
  if (state.filters.end_date) params.set("end_date", state.filters.end_date);
  if (state.filters.overdue) params.set("overdue", "1");
  if (state.filters.overlap) params.set("overlap", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function loadData() {
  const [dashboard, logs, templates, archiveTasks, trash, maintenancePreview] = await Promise.all([
    api(`/api/dashboard${filterQuery()}`),
    api("/api/logs"),
    api("/api/templates"),
    api("/api/archive/tasks"),
    api("/api/trash"),
    api("/api/maintenance/preview")
  ]);
  Object.assign(state, dashboard, {
    logs,
    templates,
    archiveTasks,
    trash,
    maintenancePreview,
    filteredTaskIds: new Set(dashboard.filtered_task_ids || dashboard.tasks.map((task) => task.id))
  });
  const returnedFilters = dashboard.filters || {};
  state.filters = {
    member_id: returnedFilters.member_id || "",
    status: returnedFilters.status || "",
    start_date: returnedFilters.start_date || "",
    end_date: returnedFilters.end_date || "",
    overdue: returnedFilters.overdue === "1" || returnedFilters.overdue === true,
    overlap: returnedFilters.overlap === "1" || returnedFilters.overlap === true
  };
  state.selectedTaskIds = new Set([...state.selectedTaskIds].filter((id) => state.tasks.some((task) => task.id === id)));
  if (state.activeTaskId && !state.tasks.some((task) => task.id === state.activeTaskId)) state.activeTaskId = null;
  if (state.activeAssignmentId && !state.assignments.some((item) => item.id === state.activeAssignmentId)) state.activeAssignmentId = null;
  render();
}

function taskPassesSearch(task) {
  const q = state.search.trim().toLowerCase();
  if (!q) return true;
  const checklist = task.checklist.map((item) => item.title).join(" ");
  return `${task.title} ${task.description} ${task.status} ${checklist} ${task.assignments.map((item) => item.member_name).join(" ")}`.toLowerCase().includes(q);
}

function visibleTasks() {
  return state.tasks.filter((task) => state.filteredTaskIds.has(task.id) && taskPassesSearch(task));
}

function sortedVisibleTasks() {
  const tasks = [...visibleTasks()];
  const byName = (a, b) => a.title.localeCompare(b.title, "zh-CN", { numeric: true, sensitivity: "base" }) || a.default_start_date.localeCompare(b.default_start_date);
  const byTime = (a, b) => a.default_start_date.localeCompare(b.default_start_date) || a.default_end_date.localeCompare(b.default_end_date) || byName(a, b);
  if (state.taskSort === "time_desc") return tasks.sort((a, b) => byTime(b, a));
  if (state.taskSort === "name_asc") return tasks.sort(byName);
  if (state.taskSort === "name_desc") return tasks.sort((a, b) => byName(b, a));
  return tasks.sort(byTime);
}

function visibleAssignments() {
  const visibleIds = new Set(visibleTasks().map((task) => task.id));
  return state.assignments.filter((item) => visibleIds.has(item.task_id));
}

function renderStats() {
  const stats = state.stats || {};
  const cards = [
    ["成员", stats.total_members ?? 0, "当前管理人数"],
    ["任务", stats.total_tasks ?? 0, "未归档任务数"],
    ["进行中", stats.active_assignments ?? 0, "个人任务分配"],
    ["逾期", stats.overdue_assignments ?? 0, "需要处理"],
    ["重叠", stats.overlapping_members ?? 0, "存在并行任务的成员"]
  ];
  $("#stats").innerHTML = cards.map(([label, value, hint], index) => `
    ${index >= 3 ? `<button type="button" class="stat-card" data-stat-filter="${index === 3 ? "overdue" : "overlap"}" aria-pressed="${index === 3 ? state.filters.overdue : state.filters.overlap}">` : `<article class="stat-card">`}
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    ${index >= 3 ? "</button>" : "</article>"}
  `).join("");
  $("#summary").textContent = `${stats.total_members ?? 0} 名成员，${stats.total_tasks ?? 0} 个任务，${stats.overdue_assignments ?? 0} 条逾期提醒`;
}

function activeFilterEntries() {
  const member = state.members.find((item) => String(item.id) === state.filters.member_id);
  return [
    state.search && ["search", `关键词：${state.search}`],
    member && ["member_id", `成员：${member.name}`],
    state.filters.status && ["status", `状态：${statusLabels[state.filters.status] || state.filters.status}`],
    state.filters.start_date && ["start_date", `开始后：${state.filters.start_date}`],
    state.filters.end_date && ["end_date", `结束前：${state.filters.end_date}`],
    state.filters.overdue && ["overdue", "逾期"],
    state.filters.overlap && ["overlap", "重叠"]
  ].filter(Boolean);
}

function renderFilterFeedback() {
  const filters = $("#activeFilters");
  if (filters) {
    const entries = activeFilterEntries();
    filters.innerHTML = entries.map(([key, label]) => `
      <button type="button" class="filter-chip" data-remove-filter="${key}" aria-label="移除${escapeHtml(label)}">${escapeHtml(label)} <span aria-hidden="true">×</span></button>
    `).join("") || `<span class="meta">未启用筛选</span>`;
  }
  const count = $("#filterResultCount");
  if (count) count.textContent = `匹配 ${visibleTasks().length} / ${state.tasks.length} 个任务`;
}

function renderFilters() {
  $("#filterMember").innerHTML = `<option value="">全部成员</option>${state.members.map((member) => `<option value="${member.id}" ${state.filters.member_id === String(member.id) ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}`;
  $("#filterStatus").innerHTML = `<option value="">全部状态</option>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${state.filters.status === value ? "selected" : ""}>${label}</option>`).join("")}`;
  $("#filterStart").value = state.filters.start_date;
  $("#filterEnd").value = state.filters.end_date;
  $("#taskSort").value = state.taskSort;
  $("#filterOverdue").checked = state.filters.overdue;
  $("#filterOverlap").checked = state.filters.overlap;
  const search = $("#searchInput");
  if (search && search.value !== state.search) search.value = state.search;
  renderFilterFeedback();
}

function renderMembers() {
  $("#memberList").classList.toggle("stacked", state.stackMemberList);
  const query = state.memberSearch.trim().toLowerCase();
  const visibleMembers = state.members.filter((member) => !query || `${member.name} ${member.role || ""}`.toLowerCase().includes(query));
  $("#memberList").innerHTML = visibleMembers.map((member) => `
    <div class="member-item">
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <span>${escapeHtml(member.role || "未设置角色")} · ${member.status === "inactive" ? "停用" : "活跃"}</span>
      </div>
      <button type="button" data-edit-member="${member.id}">编辑</button>
    </div>
  `).join("") || `<div class="empty small">${state.members.length ? "没有匹配的成员。" : "还没有成员，先点“新增成员”添加第一个成员。"}</div>`;

  const activeMembers = state.members.filter((item) => item.status === "active");
  $("#memberChoices").innerHTML = activeMembers.map((member) => `
    <label data-member-choice-option data-search-text="${escapeHtml(`${member.name} ${member.role || ""}`.toLowerCase())}">
      <input type="checkbox" name="member_ids" value="${member.id}">
      <span>${escapeHtml(member.name)}${member.role ? ` · ${escapeHtml(member.role)}` : ""}</span>
    </label>
  `).join("") || `<p class="meta">还没有可选成员，请先添加成员。</p>`;
  if (activeMembers.length) {
    $("#memberChoices").insertAdjacentHTML("beforeend", `<p class="meta" data-member-choice-empty hidden>没有匹配的成员。</p>`);
  }
  filterMemberChoiceOptions();
}

function renderTemplates() {
  $("#templateSelect").innerHTML = `<option value="">不用模板</option>${state.templates.map((template) => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join("")}`;
  $("#templateList").innerHTML = state.templates.map((template) => `
    <div class="template-item">
      <span class="swatch" style="background:${safeColor(template.color, "#0f766e")}"></span>
      <div>
        <strong>${escapeHtml(template.name)}</strong>
        <small>${template.duration_days} 天 · ${template.checklist.length} 个检查项</small>
      </div>
      <div class="template-actions">
        <button type="button" data-edit-template="${template.id}">编辑</button>
        <button type="button" data-delete-template="${template.id}">删除</button>
      </div>
    </div>
  `).join("") || `<div class="empty small">暂无模板</div>`;
}

function getRange(assignments) {
  const today = state.today || todayLocalDate();
  if (state.rangeMode === "smart") {
    if (!assignments.length) return { start: today, end: addDays(today, 30), days: 31 };
    const current = assignments.filter((item) => item.start_date <= today && item.end_date >= today);
    let focus = current;
    if (!focus.length) {
      const ranked = [...assignments].sort((a, b) => {
        const distanceA = a.end_date < today ? daysBetween(a.end_date, today) : daysBetween(today, a.start_date);
        const distanceB = b.end_date < today ? daysBetween(b.end_date, today) : daysBetween(today, b.start_date);
        if (distanceA !== distanceB) return distanceA - distanceB;
        const futureA = a.start_date > today ? 0 : 1;
        const futureB = b.start_date > today ? 0 : 1;
        return futureA - futureB || a.start_date.localeCompare(b.start_date) || a.id - b.id;
      });
      focus = ranked.slice(0, 1);
    }
    const starts = focus.map((item) => item.start_date).sort();
    const ends = focus.map((item) => item.end_date).sort();
    const start = addDays(starts[0], -2);
    const end = addDays(ends.at(-1), 3);
    return { start, end, days: Math.max(1, daysBetween(start, end) + 1) };
  }
  if (state.rangeMode !== "all") {
    if (state.rangeMode === "week") {
      const day = new Date(`${today}T00:00:00`).getDay();
      const offset = day === 0 ? -6 : 1 - day;
      const start = addDays(today, offset);
      const end = addDays(start, 6);
      return { start, end, days: 7 };
    }
    if (state.rangeMode === "month") {
      const date = new Date(`${today}T00:00:00`);
      const start = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
      const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const end = formatLocalDate(endDate);
      return { start, end, days: daysBetween(start, end) + 1 };
    }
    const days = Number(state.rangeMode);
    const start = today;
    const end = addDays(today, days);
    return { start, end, days: days + 1 };
  }
  if (!assignments.length) {
    const start = today;
    return { start, end: addDays(start, 30), days: 31 };
  }
  const starts = assignments.map((item) => item.start_date).sort();
  const ends = assignments.map((item) => item.end_date).sort();
  const start = addDays(starts[0], -2);
  const end = addDays(ends.at(-1), 3);
  return { start, end, days: Math.max(1, daysBetween(start, end) + 1) };
}

function ganttEmptyState(kind) {
  if (kind === "empty") {
    return `<div class="empty empty-action"><strong>还没有任务</strong><p>新建第一个任务后，将在这里显示排期。</p><button type="button" data-open-task-dialog>新建任务</button></div>`;
  }
  return `<div class="empty empty-action"><strong>当前范围/筛选无数据</strong><p>可以清空条件回到智能范围，或直接查看逾期任务。</p><div class="empty-actions"><button type="button" data-empty-show-all>查看全部任务</button><button type="button" data-empty-show-overdue>查看逾期任务</button></div></div>`;
}

function unitWidth() {
  const zoom = Number(state.zoom || 34);
  if (state.scale === "week") return Math.max(6, Math.round(zoom * 0.38));
  if (state.scale === "month") return Math.max(3, Math.round(zoom * 0.16));
  return zoom;
}

function labelStep() {
  if (state.scale === "week") return 7;
  if (state.scale === "month") return 14;
  return 3;
}

function layoutMemberAssignments(items) {
  if (!state.stackTasks) {
    return [...items].sort((a, b) => a.start_date.localeCompare(b.start_date)).map((item) => ({ ...item, lane: 0 }));
  }
  const lanes = [];
  return [...items].sort((a, b) => a.start_date.localeCompare(b.start_date)).map((item) => {
    let lane = lanes.findIndex((end) => item.start_date > end);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(item.end_date);
    } else {
      lanes[lane] = item.end_date;
    }
    return { ...item, lane };
  });
}

function renderGantt() {
  const assignments = visibleAssignments();
  const range = getRange(assignments);
  const rangeAssignments = assignments.filter((item) => item.end_date >= range.start && item.start_date <= range.end);
  const busyMemberIds = new Set(rangeAssignments.map((item) => item.member_id));
  const membersForRows = state.onlyBusyMembers ? state.members.filter((member) => busyMemberIds.has(member.id)) : state.members;
  const colWidth = unitWidth();
  const width = range.days * colWidth;
  const ticks = Array.from({ length: range.days }, (_, index) => addDays(range.start, index));
  const todayOffset = state.today >= range.start && state.today <= range.end ? daysBetween(range.start, state.today) * colWidth : null;
  $("#rangeLabel").textContent = `${range.start} 至 ${range.end}`;

  if (!state.tasks.length) {
    $("#gantt").innerHTML = ganttEmptyState("empty");
    return;
  }
  if (!assignments.length || !rangeAssignments.length) {
    $("#gantt").innerHTML = ganttEmptyState("filtered");
    return;
  }

  const header = `
    <div class="gantt-header">
      <div class="member-heading">成员</div>
      <div class="date-scale" style="grid-template-columns: repeat(${range.days}, ${colWidth}px); width:${width}px">
        ${ticks.map((date, index) => {
          const classes = ["date-tick", isWeekend(date) ? "weekend" : "", monthChanged(ticks[index - 1], date) ? "month-start" : ""].filter(Boolean).join(" ");
          const label = index % labelStep() === 0 ? `${formatDate(date)} 周${weekdayLabel(date)}` : "";
          return `<div class="${classes}">${label}</div>`;
        }).join("")}
      </div>
    </div>
  `;

  const rows = membersForRows.map((member) => {
    const own = layoutMemberAssignments(rangeAssignments.filter((item) => item.member_id === member.id));
    const lanes = Math.max(1, ...own.map((item) => item.lane + 1));
    const rowHeight = Math.max(78, 18 + lanes * 31);
    const bars = own.map((item) => {
      const visibleStart = item.start_date < range.start ? range.start : item.start_date;
      const visibleEnd = item.end_date > range.end ? range.end : item.end_date;
      const start = daysBetween(range.start, visibleStart);
      const duration = Math.max(1, daysBetween(visibleStart, visibleEnd) + 1);
      const barLeft = start * colWidth + 2;
      const barWidth = Math.max(32, duration * colWidth - 4);
      const classes = [
        "bar",
        item.is_completed ? "done" : "",
        item.is_overdue ? "overdue" : "",
        item.task_status === "paused" ? "paused" : "",
        item.task_status === "planned" ? "planned" : "",
        item.task_status === "cancelled" ? "cancelled" : "",
        item.id === state.activeAssignmentId ? "selected-assignment" : "",
        item.task_id === state.activeTaskId ? "selected-task" : ""
      ].filter(Boolean).join(" ");
      return `
        <button
          class="${classes}"
          style="left:${barLeft}px; top:${14 + item.lane * 31}px; width:${barWidth}px; background:${safeColor(item.color)}"
          title="${escapeHtml(item.task_title)}：${item.start_date} 至 ${item.end_date}，${statusLabels[item.task_status]}"
          data-tooltip="${escapeHtml(`${item.task_title}\n${item.member_name}\n${item.start_date} 至 ${item.end_date}\n状态：${statusLabels[item.task_status]}\n进度：${item.progress}%`)}"
          data-select-assignment="${item.id}"
          data-gantt-bar="${item.id}"
          data-range-start="${range.start}"
          data-range-end="${range.end}"
          data-range-days="${range.days}"
          data-col-width="${colWidth}"
          type="button"
        >
          <span class="bar-handle left" data-resize-edge="start"></span>
          <span class="bar-label">${escapeHtml(item.task_title)}</span>
          <span class="bar-progress" style="width:${Math.max(0, Math.min(100, Number(item.progress || 0)))}%"></span>
          <span class="bar-handle right" data-resize-edge="end"></span>
        </button>
      `;
    }).join("");
    const weekendBands = ticks.map((date, index) => isWeekend(date)
      ? `<div class="weekend-band" style="left:${index * colWidth}px; width:${colWidth}px"></div>`
      : "").join("");
    const monthBands = ticks.map((date, index) => monthChanged(ticks[index - 1], date)
      ? `<div class="month-line" style="left:${index * colWidth}px"></div>`
      : "").join("");
    return `
      <div class="gantt-row" style="min-height:${rowHeight}px">
        <div class="member-cell">
          <strong>${escapeHtml(member.name)}</strong>
          <span>${escapeHtml(member.role || "未设置角色")} · ${own.length} 个任务</span>
        </div>
        <div class="timeline" style="grid-template-columns: repeat(${range.days}, ${colWidth}px); width:${width}px; min-height:${rowHeight}px; background-size:${colWidth}px 100%">
          ${weekendBands}
          ${monthBands}
          ${todayOffset === null ? "" : `<div class="today-line" style="left:${todayOffset}px"></div>`}
          ${bars || `<div class="empty small">暂无任务</div>`}
        </div>
      </div>
    `;
  }).join("");

  $("#gantt").innerHTML = header + (rows || ganttEmptyState("filtered"));
}

function checklistSummary(task) {
  const total = task.checklist.length;
  if (!total) return "无检查项";
  const done = task.checklist.filter((item) => item.is_done).length;
  return `${done}/${total} 已完成`;
}

function taskPrimaryAction(task) {
  if (task.status === "archived") return "";
  return `<button type="button" data-archive-task="${task.id}">归档</button>`;
}

function taskHasIncompleteProgress(task) {
  return task.assignments.some((assignment) => Number(assignment.progress) < 100);
}

function taskCompletionAction(task) {
  if (["completed", "archived"].includes(task.status)) return "";
  const busy = isBusy(`complete-task-${task.id}`);
  return `<button type="button" data-complete-task="${task.id}" ${busy ? "disabled aria-busy=\"true\"" : ""}>${busy ? "完成中…" : "标记完成"}</button>`;
}

function taskCompletionHint(task) {
  return task.status !== "completed" && taskHasIncompleteProgress(task)
    ? `<p class="notice completion-hint">部分成员进度低于 100%；标记完成不会改动个人进度。</p>`
    : "";
}

function taskListEmptyState() {
  return state.tasks.length
    ? `<div class="empty empty-action"><strong>没有匹配的任务</strong><button type="button" data-empty-show-all>查看全部任务</button></div>`
    : `<div class="empty empty-action"><strong>还没有任务</strong><button type="button" data-open-task-dialog>新建任务</button></div>`;
}

function executionV3Task(task) {
  if (!state.v3ExecutionContextEnabled) return null;
  return state.v3ExecutionTaskIndex.get(Number(task.id)) || null;
}

function executionV3SampleText(sample, { detail = false } = {}) {
  const label = sample.planning_label || sample.model || "未命名样品";
  const model = sample.model ? `型号 ${sample.model}` : "型号待补";
  const identifier = sample.formal_identifier || sample.temporary_identifier ? `编号 ${sample.formal_identifier || sample.temporary_identifier}` : "编号待补";
  const eta = sample.eta_pending ? "ETA 待确认" : `ETA ${sample.current_eta_date || "待补"}`;
  const arrival = sample.actual_arrival_date ? ` · 到样 ${sample.actual_arrival_date}` : "";
  return detail
    ? `${escapeHtml(label)} · ${escapeHtml(model)} · ${escapeHtml(identifier)} · ${escapeHtml(eta)}${escapeHtml(arrival)}`
    : `${escapeHtml(label)} · ${escapeHtml(eta)}`;
}

function executionV3Context(task, { detail = false } = {}) {
  const v3Task = executionV3Task(task);
  if (!v3Task) return "";
  const topic = v3Task.topic || {};
  const sourceGroup = v3Task.source_group || {};
  const cryostat = v3Task.cryostat || {};
  const testItems = Array.isArray(v3Task.test_items)
    ? v3Task.test_items.map((item) => item?.name || item?.label || item?.title).filter(Boolean)
    : [];
  const samples = Array.isArray(v3Task.samples) ? v3Task.samples : [];
  const purpose = v3Task.test_purpose || "测试目的待补充";
  const items = testItems.length ? testItems.join("、") : "测试项待补充";
  const sampleSummary = samples.length ? samples.map((sample) => executionV3SampleText(sample, { detail })).join("；") : "暂无关联样品";
  const cryostatLabel = v3Task.cryostat_pending ? "待确认" : (cryostat.name || "待确认");
  if (detail) {
    return `
      <section class="v3-task-context-summary" aria-label="专题任务结构化信息">
        <span>专题：${escapeHtml(topic.name || "待补充")}</span>
        <span>来源小组：${escapeHtml(sourceGroup.name || "待补充")}</span>
        <span>制冷机：${escapeHtml(cryostatLabel)}</span>
      </section>
      <p class="v3-task-purpose-line"><strong>测试目的：</strong>${escapeHtml(purpose)}</p>
      <p class="meta"><strong>测试项：</strong>${escapeHtml(items)}</p>
      <div class="v3-task-context-summary" aria-label="关联样品">
        <span>样品：${sampleSummary}</span>
      </div>
    `;
  }
  return `
    <div class="v3-task-context-line" aria-label="专题任务结构化信息">
      <span>专题：${escapeHtml(topic.name || "待补充")}</span>
      <span>来源：${escapeHtml(sourceGroup.name || "待补充")}</span>
      <span>制冷机：${escapeHtml(cryostatLabel)}</span>
    </div>
    <p class="v3-task-purpose-line"><strong>测试目的：</strong>${escapeHtml(purpose)}</p>
    <small class="meta"><strong>测试项：</strong>${escapeHtml(items)} · <strong>样品：</strong>${sampleSummary}</small>
  `;
}

function renderTasks() {
  const tasks = sortedVisibleTasks();
  const container = $("#taskCards");
  $("#taskSort").value = state.taskSort;
  $$("[data-task-view-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.taskViewMode === state.taskViewMode);
  });
  container.className = state.taskViewMode === "list" ? "task-list-view" : "task-grid";
  if (state.taskViewMode === "list") {
    container.innerHTML = `
      <div class="task-list-header">
        <span>任务</span>
        <span>时间</span>
        <span>成员</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      ${tasks.map((task) => `
        <article class="task-list-row ${state.selectedTaskIds.has(task.id) ? "selected" : ""}">
          <div class="task-list-title">
            <label class="select-task"><input type="checkbox" data-task-check="${task.id}" ${state.selectedTaskIds.has(task.id) ? "checked" : ""}></label>
            <span class="swatch" style="background:${safeColor(task.color)}"></span>
            <div>
              <strong>${escapeHtml(task.title)}</strong>
              <small>${escapeHtml(task.description || "无描述")} · 清单 ${checklistSummary(task)}${task.status !== "completed" && taskHasIncompleteProgress(task) ? " · 完成时个人进度保持不变" : ""}</small>
              ${executionV3Context(task)}
            </div>
          </div>
          <div>${task.default_start_date}<br><span>${task.default_end_date}</span></div>
          <div>${task.assignments.map((assignment) => escapeHtml(assignment.member_name)).join("、") || "未分配"}</div>
          <div><span class="status ${task.status}">${statusLabels[task.status] || task.status}</span></div>
          <div class="task-list-actions">
            <button type="button" data-select-task="${task.id}">详情</button>
            ${taskCompletionAction(task)}
            <button type="button" data-edit-task="${task.id}">编辑</button>
            ${taskPrimaryAction(task)}
            <button class="danger" type="button" data-delete-task="${task.id}">删除</button>
          </div>
        </article>
      `).join("") || taskListEmptyState()}
    `;
    return;
  }

  container.innerHTML = tasks.map((task) => `
    <article class="task-card ${state.selectedTaskIds.has(task.id) ? "selected" : ""}">
      <div class="task-title-line">
        <label class="select-task"><input type="checkbox" data-task-check="${task.id}" ${state.selectedTaskIds.has(task.id) ? "checked" : ""}></label>
        <h3><span class="swatch" style="background:${safeColor(task.color)}"></span>${escapeHtml(task.title)}</h3>
      </div>
      <p class="meta">${escapeHtml(task.description || "无描述")}</p>
      <p class="meta">${task.default_start_date} 至 ${task.default_end_date} <span class="status ${task.status}">${statusLabels[task.status] || task.status}</span></p>
      <p class="meta">检查清单：${checklistSummary(task)}</p>
      ${executionV3Context(task)}
      ${taskCompletionHint(task)}
      <div class="assignment-list">
        ${task.assignments.map((assignment) => `
          <div class="assignment">
            <span>${escapeHtml(assignment.member_name)}：${assignment.start_date} 至 ${assignment.end_date}，进度 ${assignment.progress}%</span>
            <button type="button" data-select-assignment="${assignment.id}">详情</button>
          </div>
        `).join("") || `<p class="meta">尚未分配成员</p>`}
      </div>
      <div class="card-actions">
        <button type="button" data-select-task="${task.id}">任务详情</button>
        ${taskCompletionAction(task)}
        <button type="button" data-edit-task="${task.id}">编辑</button>
        ${taskPrimaryAction(task)}
        <button class="danger" type="button" data-delete-task="${task.id}">删除</button>
      </div>
    </article>
  `).join("") || taskListEmptyState();
}

function renderLoad() {
  const allRows = state.stats?.member_load || [];
  const memberFilter = $("#loadMemberFilter");
  if (memberFilter) {
    memberFilter.innerHTML = `<option value="">全部成员</option>${state.members.map((member) => `<option value="${member.id}" ${state.loadMemberId === String(member.id) ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}`;
  }
  const period = $("#loadPeriod");
  if (period) period.value = state.loadPeriod;
  const rows = allRows.filter((row) => !state.loadMemberId || String(row.member_id) === state.loadMemberId);
  const periodColumns = {
    current: ["当前", "current_count"],
    7: ["未来 7 天", "next7_count"],
    30: ["未来 30 天", "next30_count"]
  };
  const [periodLabel, periodField] = periodColumns[state.loadPeriod] || periodColumns.current;
  $("#loadTable").innerHTML = `
    <table>
      <thead><tr><th>成员</th><th>${periodLabel}</th><th>逾期</th><th>已完成</th><th>重叠</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr class="${row.overlap_count > 0 || row.overdue_count > 0 ? "warn-row" : ""}">
            <td><strong>${escapeHtml(row.member_name)}</strong><br><span>${escapeHtml(row.role || "")}</span></td>
            <td>${row[periodField]}</td>
            <td>${row.overdue_count}</td>
            <td>${row.completed_count}</td>
            <td>${row.overlap_count}</td>
          </tr>
        `).join("") || `<tr><td colspan="5" class="empty">没有匹配的成员负载。</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderLogs() {
  const types = [...new Set(state.logs.map((log) => log.change_type))].sort();
  const typeFilter = $("#logTypeFilter");
  if (typeFilter) {
    typeFilter.innerHTML = `<option value="">全部类型</option>${types.map((type) => `<option value="${escapeHtml(type)}" ${state.logType === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}`;
  }
  if ($("#logSearchInput") && $("#logSearchInput").value !== state.logSearch) $("#logSearchInput").value = state.logSearch;
  if ($("#logDateFilter")) $("#logDateFilter").value = state.logDate;
  const query = state.logSearch.trim().toLowerCase();
  const logs = state.logs.filter((log) => {
    if (state.logType && log.change_type !== state.logType) return false;
    if (state.logDate && String(log.created_at).slice(0, 10) !== state.logDate) return false;
    if (!query) return true;
    return `${log.change_type} ${log.task_id ?? ""} ${log.assignment_id ?? ""} ${log.member_id ?? ""}`.toLowerCase().includes(query);
  });
  $("#logs").innerHTML = logs.map((log) => `
    <div class="log-item">
      <time>${new Date(log.created_at).toLocaleString()}</time>
      <div>
        <strong>${escapeHtml(log.change_type)}</strong>
        <div class="meta">任务 ID：${log.task_id ?? "-"}；分配 ID：${log.assignment_id ?? "-"}；成员 ID：${log.member_id ?? "-"}</div>
      </div>
    </div>
  `).join("") || `<div class="empty">没有匹配的修改日志。</div>`;
}

function renderMaintenance() {
  const preview = state.maintenancePreview || {};
  $("#clearLogsHint").textContent = `将清理 ${preview.logs ?? 0} 条操作日志，不影响成员、任务和分配。`;
  $("#purgeArchivedHint").textContent = `将把 ${preview.archived_tasks ?? 0} 个归档任务移动到回收站。`;
  $("#trashHint").textContent = `回收站中有 ${preview.deleted_tasks ?? 0} 个任务、${preview.deleted_members ?? 0} 名成员。`;

  $("#archiveList").innerHTML = state.archiveTasks.map((task) => `
    <div class="recovery-item">
      <div>
        <strong>${escapeHtml(task.title)}</strong>
        <span>${task.default_start_date} 至 ${task.default_end_date}</span>
      </div>
      <button type="button" data-restore-task="${task.id}">恢复</button>
    </div>
  `).join("") || `<div class="empty small">暂无归档任务。</div>`;

  const taskRows = state.trash.tasks.map((task) => `
    <div class="recovery-item">
      <div>
        <strong>任务：${escapeHtml(task.title)}</strong>
        <span>删除时间：${task.deleted_at || "-"}</span>
      </div>
      <button type="button" data-restore-task="${task.id}">恢复</button>
    </div>
  `).join("");
  const memberRows = state.trash.members.map((member) => `
    <div class="recovery-item">
      <div>
        <strong>成员：${escapeHtml(member.name)}</strong>
        <span>删除时间：${member.deleted_at || "-"}</span>
      </div>
      <button type="button" data-restore-member="${member.id}">恢复</button>
    </div>
  `).join("");
  $("#trashList").innerHTML = taskRows + memberRows || `<div class="empty small">回收站为空。</div>`;
}

function renderSelection() {
  const batchCompletes = $("#batchStatus")?.value === "completed";
  const hasIncompleteProgress = batchCompletes && [...state.selectedTaskIds].some((id) => {
    const task = state.tasks.find((item) => item.id === id);
    return task && taskHasIncompleteProgress(task);
  });
  $("#selectionInfo").textContent = state.selectedTaskIds.size
    ? `已选择 ${state.selectedTaskIds.size} 个任务${hasIncompleteProgress ? "；完成不会覆盖个人进度" : ""}`
    : "未选择任务";
  $("#batchApplyBtn").disabled = state.selectedTaskIds.size === 0;
  const batchbar = $(".batchbar");
  if (batchbar) batchbar.hidden = state.activeView !== "tasks" || state.selectedTaskIds.size === 0;
  $$("[data-task-check]").forEach((input) => {
    input.checked = state.selectedTaskIds.has(Number(input.dataset.taskCheck));
  });
}

const viewLabels = {
  gantt: "甘特图",
  tasks: "任务",
  load: "负载",
  logs: "日志",
  maintenance: "维护"
};

function renderViewState() {
  $$('[data-view]').forEach((button) => {
    const active = button.dataset.view === state.activeView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $$('[data-toolbar-view]').forEach((toolbar) => {
    toolbar.hidden = toolbar.dataset.toolbarView !== state.activeView;
  });
  $$(".view").forEach((view) => {
    const active = view.id === `${state.activeView}View`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  const viewTitle = $("#viewTitle");
  if (viewTitle) viewTitle.textContent = viewLabels[state.activeView];
  document.title = `${viewLabels[state.activeView]} · 小组任务管理与甘特图系统`;
  const sidebar = $("#memberSidebar");
  if (sidebar) sidebar.classList.toggle("is-collapsed", state.sidebarCollapsed);
  const workspace = $(".workspace");
  if (workspace) workspace.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  const sidebarToggle = $("#toggleMemberSidebar") || $("[data-toggle-sidebar]");
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
    sidebarToggle.setAttribute("aria-label", state.sidebarCollapsed ? "展开成员栏" : "收起成员栏");
  }
  const scale = $("#scaleSelect");
  if (scale) scale.value = state.scale;
  const zoom = $("#zoomRange");
  if (zoom) zoom.value = String(state.zoom);
  const range = $("#rangeSelect");
  if (range) range.value = state.rangeMode;
}

function renderChecklist(task) {
  return `
    <div class="checklist-box">
      <h3>检查清单</h3>
      ${task.checklist.map((item) => `
        <label class="check-item">
          <input type="checkbox" data-check-item="${item.id}" ${item.is_done ? "checked" : ""}>
          <span>${escapeHtml(item.title)}</span>
          <button type="button" data-delete-check-item="${item.id}">删除</button>
        </label>
      `).join("") || `<p class="meta">还没有检查项。</p>`}
      <div class="add-check-item">
        <input data-new-check-title="${task.id}" placeholder="新增检查项">
        <button type="button" data-add-check-item="${task.id}">添加</button>
      </div>
    </div>
  `;
}

function renderDetail() {
  const pane = $("#detailPane");
  const content = $("#detailContent") || pane;
  const assignment = state.assignments.find((item) => item.id === state.activeAssignmentId);
  if (assignment) {
    const task = state.tasks.find((item) => item.id === assignment.task_id);
    pane.hidden = false;
    pane.classList.add("is-open");
    content.innerHTML = `
      <section class="detail-card">
        <h2>${escapeHtml(assignment.task_title)}</h2>
        <p class="meta">${escapeHtml(assignment.task_description || "无描述")}</p>
        ${task ? executionV3Context(task, { detail: true }) : ""}
        <dl>
          <dt>成员</dt><dd>${escapeHtml(assignment.member_name)}</dd>
          <dt>状态</dt><dd>${statusLabels[assignment.task_status]}</dd>
          <dt>个人时间</dt><dd>${assignment.start_date} 至 ${assignment.end_date}</dd>
          <dt>进度</dt><dd>${assignment.progress}%</dd>
          <dt>备注</dt><dd>${escapeHtml(assignment.note || "无")}</dd>
        </dl>
        <div class="detail-actions">
          ${task ? taskCompletionAction(task) : ""}
          <button type="button" data-edit-assignment="${assignment.id}">编辑个人分配</button>
          <button type="button" data-edit-task="${assignment.task_id}">编辑任务整体</button>
          <button type="button" data-remove-assignment="${assignment.id}">移除该成员</button>
        </div>
        ${task ? renderChecklist(task) + memberAddBlock(task) : ""}
      </section>
    `;
    return;
  }

  const task = state.tasks.find((item) => item.id === state.activeTaskId);
  if (task) {
    pane.hidden = false;
    pane.classList.add("is-open");
    content.innerHTML = `
      <section class="detail-card">
        <h2>${escapeHtml(task.title)}</h2>
        <p class="meta">${escapeHtml(task.description || "无描述")}</p>
        ${executionV3Context(task, { detail: true })}
        <dl>
          <dt>默认时间</dt><dd>${task.default_start_date} 至 ${task.default_end_date}</dd>
          <dt>状态</dt><dd>${statusLabels[task.status]}</dd>
          <dt>参与人数</dt><dd>${task.assignments.length}</dd>
          <dt>清单</dt><dd>${checklistSummary(task)}</dd>
        </dl>
        ${taskCompletionHint(task)}
        <div class="detail-actions">
          ${taskCompletionAction(task)}
          <button type="button" data-edit-task="${task.id}">编辑任务</button>
          ${taskPrimaryAction(task)}
          <button type="button" data-delete-task="${task.id}">删除任务</button>
        </div>
        ${memberAssignmentBlock(task)}
        ${renderChecklist(task)}
        ${memberAddBlock(task)}
      </section>
    `;
    return;
  }

  pane.classList.remove("is-open");
  pane.hidden = true;
  content.innerHTML = "";
}

function rememberDetailTrigger(trigger) {
  detailReturnFocus = trigger?.focus ? trigger : null;
  if (trigger?.dataset.selectAssignment) {
    detailReturnSelector = `[data-select-assignment="${trigger.dataset.selectAssignment}"]`;
  } else if (trigger?.dataset.selectTask) {
    detailReturnSelector = `[data-select-task="${trigger.dataset.selectTask}"]`;
  } else {
    detailReturnSelector = "";
  }
}

function closeDetail({ restoreFocus = true } = {}) {
  const trigger = detailReturnFocus;
  const returnSelector = detailReturnSelector;
  detailReturnFocus = null;
  detailReturnSelector = "";
  state.activeAssignmentId = null;
  state.activeTaskId = null;
  renderGantt();
  renderDetail();

  if (!restoreFocus) return;
  const activeView = document.getElementById(`${state.activeView}View`);
  const candidates = [
    trigger,
    returnSelector ? activeView?.querySelector(returnSelector) : null,
    activeView?.querySelector("button:not([disabled]), input:not([disabled]), select:not([disabled])"),
    document.querySelector(`[data-view="${state.activeView}"]`),
    $("#newTaskBtn")
  ];
  const target = candidates.find((candidate) => (
    candidate?.isConnected
    && typeof candidate.focus === "function"
    && candidate.getClientRects().length > 0
  ));
  target?.focus();
}

function memberAssignmentBlock(task) {
  return `
    <div class="assigned-members">
      <h3>当前成员</h3>
      <div class="assigned-member-list">
        ${task.assignments.map((assignment) => `
          <div class="assigned-member-item">
            <div>
              <strong>${escapeHtml(assignment.member_name)}</strong>
              <span>${assignment.start_date} 至 ${assignment.end_date} · 进度 ${assignment.progress}%</span>
              ${assignment.note ? `<small>${escapeHtml(assignment.note)}</small>` : ""}
            </div>
            <div class="assigned-member-actions">
              <button type="button" data-select-assignment="${assignment.id}">详情</button>
              <button type="button" data-remove-assignment="${assignment.id}">移除</button>
            </div>
          </div>
        `).join("") || `<p class="meta">当前还没有分配成员。</p>`}
      </div>
    </div>
  `;
}

function memberAddBlock(task) {
  const assigned = new Set(task.assignments.map((item) => item.member_id));
  const choices = state.members.filter((member) => member.status === "active" && !assigned.has(member.id));
  return `
    <div class="add-members">
      <h3>追加成员</h3>
      <input class="member-search-input" data-member-search="${task.id}" placeholder="搜索成员姓名或角色">
      <div class="check-list compact add-member-list">
        ${choices.map((member) => `
          <label data-add-member-option data-search-text="${escapeHtml(`${member.name} ${member.role || ""}`.toLowerCase())}">
            <input type="checkbox" data-add-member="${member.id}">
            <span>${escapeHtml(member.name)}${member.role ? ` · ${escapeHtml(member.role)}` : ""}</span>
          </label>
        `).join("") || `<p class="meta">没有可追加成员。</p>`}
        ${choices.length ? `<p class="meta" data-add-member-empty hidden>没有匹配的成员。</p>` : ""}
      </div>
      <button type="button" data-add-members-to-task="${task.id}">追加到任务</button>
    </div>
  `;
}

function render() {
  renderViewState();
  renderStats();
  renderFilters();
  renderMembers();
  renderTemplates();
  renderGantt();
  renderTasks();
  renderLoad();
  renderLogs();
  renderMaintenance();
  renderSelection();
  renderDetail();
  renderFilterFeedback();
}

function openMemberEditor(id) {
  const member = id ? state.members.find((item) => item.id === Number(id)) : null;
  $("#editTitle").textContent = member ? `编辑成员：${member.name}` : "新增成员";
  $("#editFields").innerHTML = `
    <label>姓名<input name="name" value="${escapeHtml(member?.name || "")}" required></label>
    <label>角色<input name="role" value="${escapeHtml(member?.role || "")}"></label>
    <label>邮箱<input name="email" type="email" value="${escapeHtml(member?.email || "")}"></label>
    <label>状态
      <select name="status">
        <option value="active" ${member?.status !== "inactive" ? "selected" : ""}>活跃</option>
        <option value="inactive" ${member?.status === "inactive" ? "selected" : ""}>停用</option>
      </select>
    </label>
    ${member ? `<button class="danger" type="button" data-delete-member="${member.id}">删除成员</button>` : ""}
  `;
  $("#editForm").querySelector('[name="type"]').value = "member";
  $("#editForm").querySelector('[name="id"]').value = member?.id || "";
  $("#editDialog").showModal();
}

function openTaskEditor(id) {
  const task = state.tasks.find((item) => item.id === Number(id));
  if (!task) return;
  $("#editTitle").textContent = `编辑任务：${task.title}`;
  $("#editFields").innerHTML = `
    <label>任务名称<input name="title" value="${escapeHtml(task.title)}" required></label>
    <label>描述<textarea name="description" rows="3">${escapeHtml(task.description || "")}</textarea></label>
    <div class="two-cols">
      <label>默认开始<input name="default_start_date" type="date" value="${task.default_start_date}" required></label>
      <label>默认结束<input name="default_end_date" type="date" value="${task.default_end_date}" required></label>
    </div>
    <div class="two-cols">
      <label>颜色<input name="color" type="color" value="${safeColor(task.color)}"></label>
      <label>状态
        <select name="status">
          <option value="auto" ${["planned", "active"].includes(task.status) ? "selected" : ""}>自动判断</option>
          ${Object.entries(manualStatusLabels).map(([value, label]) => `<option value="${value}" ${task.status === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
    </div>
    <label class="inline"><input name="sync_assignments" type="checkbox"> 同步更新所有成员个人时间</label>
  `;
  $("#editForm").querySelector('[name="type"]').value = "task";
  $("#editForm").querySelector('[name="id"]').value = task.id;
  $("#editDialog").showModal();
}

async function openExecutionTaskEditor(id, trigger) {
  const task = state.tasks.find((item) => item.id === Number(id));
  const v3Task = executionV3Task(task);
  if (!v3Task) return openTaskEditor(id);
  const topicId = Number(v3Task.topic_id);
  if (!Number.isFinite(topicId)) return openTaskEditor(id);
  try {
    if (!v3State.topic || Number(v3State.topic.id) !== topicId) await v3LoadTopic(topicId);
    setV2View("execution");
    v3SetView("execution");
    v3OpenTaskDialog(trigger, v3Task.id);
  } catch (error) {
    showToast(v3ErrorText(error), { type: "error" });
  }
}

function openAssignmentEditor(id) {
  const assignment = state.assignments.find((item) => item.id === Number(id));
  if (!assignment) return;
  $("#editTitle").textContent = `编辑个人任务：${assignment.member_name}`;
  $("#editFields").innerHTML = `
    <p class="meta">${escapeHtml(assignment.task_title)}</p>
    <div class="two-cols">
      <label>开始<input name="start_date" type="date" value="${assignment.start_date}" required></label>
      <label>结束<input name="end_date" type="date" value="${assignment.end_date}" required></label>
    </div>
    <label>进度<input name="progress" type="number" min="0" max="100" value="${assignment.progress}"></label>
    <label>备注<textarea name="note" rows="3">${escapeHtml(assignment.note || "")}</textarea></label>
  `;
  $("#editForm").querySelector('[name="type"]').value = "assignment";
  $("#editForm").querySelector('[name="id"]').value = assignment.id;
  $("#editDialog").showModal();
}

async function submitEdit(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submitButton = formElement.querySelector('[type="submit"]');
  await runBusyAction("edit-form", async () => {
    const form = new FormData(formElement);
    const type = form.get("type");
    const id = form.get("id");
    const payload = Object.fromEntries(form);
    delete payload.type;
    delete payload.id;
    payload.sync_assignments = form.get("sync_assignments") === "on";

    if (type === "member") {
      if (id) await api(`/api/members/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/api/members", { method: "POST", body: JSON.stringify(payload) });
      showToast(id ? "成员已更新" : "成员已新增");
    } else if (type === "task") {
      await api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast(payload.sync_assignments ? "任务和个人时间已同步" : "任务已更新");
    } else if (type === "assignment") {
      payload.progress = Number(payload.progress || 0);
      await api(`/api/assignments/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("个人分配已更新");
    }
    $("#editDialog").close();
    await loadData();
  }, { control: submitButton, busyText: "保存中…" });
}

function setDefaultDates() {
  const today = todayLocalDate();
  $("#taskForm").elements.default_start_date.value = today;
  $("#taskForm").elements.default_end_date.value = addDays(today, 13);
}

function setTaskFormError(message = "") {
  const error = $("#taskFormError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function openTaskDialog() {
  if (isBusy("create-task")) return;
  const dialog = $("#taskDialog");
  const form = $("#taskForm");
  if (!dialog || !form) return;
  setTaskFormError();
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => form.elements.title?.focus(), 0);
}

function closeTaskDialog() {
  if (isBusy("create-task")) return;
  const dialog = $("#taskDialog");
  if (dialog?.open) dialog.close();
  $("#newTaskBtn")?.focus();
}

function applyTemplate(templateId) {
  const template = state.templates.find((item) => item.id === Number(templateId));
  if (!template) return;
  const form = $("#taskForm");
  form.elements.title.value = template.name;
  form.elements.description.value = template.description || "";
  form.elements.color.value = safeColor(template.color, "#0f766e");
  form.elements.default_end_date.value = addDays(form.elements.default_start_date.value || todayLocalDate(), template.duration_days - 1);
  form.elements.checklist.value = template.checklist.join("\n");
}

function editTemplate(templateId) {
  const template = state.templates.find((item) => item.id === Number(templateId));
  if (!template) return;
  const form = $("#templateForm");
  form.elements.id.value = template.id;
  form.elements.name.value = template.name;
  form.elements.description.value = template.description || "";
  form.elements.color.value = safeColor(template.color, "#0f766e");
  form.elements.duration_days.value = template.duration_days;
  form.elements.checklist.value = template.checklist.join("\n");
  showToast("模板已载入，可修改后保存");
}

function resetTemplateForm() {
  const form = $("#templateForm");
  form.reset();
  form.elements.id.value = "";
  form.elements.color.value = "#0f766e";
  form.elements.duration_days.value = 7;
}

function updateFilterFromControls() {
  state.filters.member_id = $("#filterMember").value;
  state.filters.status = $("#filterStatus").value;
  state.filters.start_date = $("#filterStart").value;
  state.filters.end_date = $("#filterEnd").value;
  state.filters.overdue = $("#filterOverdue").checked;
  state.filters.overlap = $("#filterOverlap").checked;
}

function showImportErrors(result) {
  const errors = result.errors || [];
  $("#importErrors").innerHTML = errors.length
    ? errors.map((item) => `<div>第 ${item.line} 行：${escapeHtml(item.error)}</div>`).join("")
    : "";
}

function downloadBackup(backup, label) {
  if (!backup) return;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${label}-${new Date().toISOString().replaceAll(":", "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function scrollGanttToToday() {
  const shell = document.querySelector(".gantt-shell");
  const line = document.querySelector(".today-line");
  if (!shell || !line) return showToast("当前甘特图范围内没有今天线");
  const left = Number.parseFloat(line.style.left || "0");
  shell.scrollLeft = Math.max(0, left - shell.clientWidth / 2);
}

function pointerDayIndex(event, drag, mode = "start") {
  const rect = drag.timeline.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const raw = mode === "end"
    ? Math.ceil(x / drag.colWidth) - 1
    : Math.floor(x / drag.colWidth);
  return clamp(raw, 0, drag.rangeDays - 1);
}

function visibleBarDuration(start, end, rangeStart, rangeEnd) {
  const visibleStart = start < rangeStart ? rangeStart : start;
  const visibleEnd = end > rangeEnd ? rangeEnd : end;
  return Math.max(1, daysBetween(visibleStart, visibleEnd) + 1);
}

function startGanttDrag(event) {
  const bar = event.target.closest("[data-gantt-bar]");
  if (!bar) return;
  const assignment = state.assignments.find((item) => item.id === Number(bar.dataset.ganttBar));
  if (!assignment) return;
  if (assignment.id !== state.activeAssignmentId) return;
  event.preventDefault();
  event.stopPropagation();
  const edge = event.target.closest("[data-resize-edge]")?.dataset.resizeEdge || "move";
  const timeline = bar.closest(".timeline");
  if (!timeline) return;
  const rangeStart = bar.dataset.rangeStart;
  const rangeEnd = bar.dataset.rangeEnd;
  const colWidth = Number(bar.dataset.colWidth);
  const timelineRect = timeline.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  const visibleStartIndex = Math.max(0, daysBetween(rangeStart, assignment.start_date));
  const pointerOffsetDays = Math.floor((event.clientX - barRect.left) / colWidth);
  state.drag = {
    assignmentId: assignment.id,
    edge,
    pointerId: event.pointerId,
    colWidth,
    rangeStart,
    rangeEnd,
    rangeDays: Number(bar.dataset.rangeDays),
    timeline,
    pointerOffsetDays: clamp(pointerOffsetDays, 0, Math.max(0, daysBetween(assignment.start_date, assignment.end_date))),
    visibleStartIndex,
    startLeft: barRect.left - timelineRect.left,
    originalStart: assignment.start_date,
    originalEnd: assignment.end_date,
    previewStart: assignment.start_date,
    previewEnd: assignment.end_date,
    bar
  };
  bar.classList.add("dragging");
  bar.setPointerCapture?.(event.pointerId);
}

function previewGanttDrag(event) {
  if (!state.drag) return;
  const drag = state.drag;
  const originalDuration = Math.max(0, daysBetween(drag.originalStart, drag.originalEnd));
  let nextStart = drag.originalStart;
  let nextEnd = drag.originalEnd;

  if (drag.edge === "move") {
    const targetStartIndex = pointerDayIndex(event, drag, "start") - drag.pointerOffsetDays;
    const clampedStartIndex = clamp(targetStartIndex, 0, Math.max(0, drag.rangeDays - originalDuration - 1));
    nextStart = addDays(drag.rangeStart, clampedStartIndex);
    nextEnd = addDays(nextStart, originalDuration);
  } else if (drag.edge === "start") {
    nextStart = addDays(drag.rangeStart, pointerDayIndex(event, drag, "start"));
    if (nextStart > drag.originalEnd) nextStart = drag.originalEnd;
  } else if (drag.edge === "end") {
    nextEnd = addDays(drag.rangeStart, pointerDayIndex(event, drag, "end"));
    if (nextEnd < drag.originalStart) nextEnd = drag.originalStart;
  }

  drag.previewStart = nextStart;
  drag.previewEnd = nextEnd;
  const visibleNextStart = nextStart < drag.rangeStart ? drag.rangeStart : nextStart;
  const offset = daysBetween(drag.rangeStart, visibleNextStart) - drag.visibleStartIndex;
  if (drag.edge === "move") {
    drag.bar.style.transform = `translateX(${offset * drag.colWidth}px)`;
  } else {
    const widthDays = visibleBarDuration(nextStart, nextEnd, drag.rangeStart, drag.rangeEnd);
    drag.bar.style.width = `${Math.max(32, widthDays * drag.colWidth - 4)}px`;
    if (drag.edge === "start") drag.bar.style.transform = `translateX(${offset * drag.colWidth}px)`;
  }
  drag.bar.dataset.tooltip = `${drag.bar.dataset.tooltip?.split("\n")[0] || ""}\n${nextStart} 至 ${nextEnd}`;
}

async function finishGanttDrag(event) {
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;
  drag.bar.classList.remove("dragging");
  drag.bar.releasePointerCapture?.(drag.pointerId);
  drag.bar.style.transform = "";
  drag.bar.style.width = "";

  const changed = drag.previewStart !== drag.originalStart || drag.previewEnd !== drag.originalEnd;
  if (!changed) return;

  const assignment = state.assignments.find((item) => item.id === drag.assignmentId);
  const title = assignment?.task_title || `分配 ${drag.assignmentId}`;
  const message = `确认只调整该成员的任务时间？\n\n${title}\n${drag.originalStart} 至 ${drag.originalEnd}\n改为\n${drag.previewStart} 至 ${drag.previewEnd}`;
  if (!window.confirm(message)) {
    renderGantt();
    return;
  }
  await runBusyAction(`drag-assignment-${drag.assignmentId}`, async () => {
    await api(`/api/assignments/${drag.assignmentId}`, {
      method: "PUT",
      body: JSON.stringify({
        start_date: drag.previewStart,
        end_date: drag.previewEnd
      })
    });
    showToast("个人任务时间已更新");
    await loadData();
  }, { onError: renderGantt });
}

async function addMembersToTask(taskId, control = null) {
  const ids = $$("[data-add-member]:checked").map((input) => Number(input.dataset.addMember));
  if (!ids.length) return showToast("请选择要追加的成员", { type: "error" });
  await runBusyAction(`add-members-${taskId}`, async () => {
    await api(`/api/tasks/${taskId}/members`, { method: "POST", body: JSON.stringify({ member_ids: ids }) });
    showToast("成员已追加");
    await loadData();
  }, { control, busyText: "追加中…" });
}

async function completeTask(taskId, control = null) {
  const numericTaskId = Number(taskId);
  const task = state.tasks.find((item) => item.id === numericTaskId);
  if (!task || task.status === "completed") return;
  const incompleteProgress = taskHasIncompleteProgress(task);
  await runBusyAction(`complete-task-${numericTaskId}`, async () => {
    await api(`/api/tasks/${numericTaskId}`, { method: "PUT", body: JSON.stringify({ status: "completed" }) });
    showToast(incompleteProgress ? "任务已完成，个人进度保持不变" : "任务已完成");
    await loadData();
  }, {
    control,
    busyText: "完成中…",
    renderBusy: () => {
      renderTasks();
      renderDetail();
    }
  });
}

async function applyBatch() {
  const taskIds = [...state.selectedTaskIds];
  if (!taskIds.length) return showToast("请先选择任务", { type: "error" });
  const status = $("#batchStatus").value || undefined;
  const endDate = $("#batchEndDate").value || undefined;
  const incompleteProgress = status === "completed" && taskIds.some((id) => {
    const task = state.tasks.find((item) => item.id === id);
    return task && taskHasIncompleteProgress(task);
  });
  await runBusyAction("batch-apply", async () => {
    const payload = { task_ids: taskIds };
    if (status) payload.status = status;
    if (endDate) {
      payload.default_end_date = endDate;
      payload.sync_assignments = $("#batchSync").checked;
    }
    await api("/api/batch/tasks", { method: "POST", body: JSON.stringify(payload) });
    state.selectedTaskIds.clear();
    showToast(incompleteProgress ? "任务已批量完成，个人进度保持不变" : "批量操作已完成");
    await loadData();
  }, { control: $("#batchApplyBtn"), busyText: "应用中…" });
}

async function deleteTaskById(taskId, control = null) {
  const numericTaskId = Number(taskId);
  const task = state.tasks.find((item) => item.id === numericTaskId);
  const name = task?.title || `ID ${taskId}`;
  if (!window.confirm(`确认删除任务「${name}」？删除后可在回收站恢复。`)) return;
  await runBusyAction(`delete-task-${numericTaskId}`, async () => {
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (state.activeTaskId === numericTaskId) state.activeTaskId = null;
    if (task?.assignments.some((item) => item.id === state.activeAssignmentId)) state.activeAssignmentId = null;
    state.selectedTaskIds.delete(numericTaskId);
    showToast("任务已删除", {
      actionLabel: "撤销",
      onAction: async () => {
        await api(`/api/tasks/${numericTaskId}/restore`, { method: "POST", body: "{}" });
        showToast("删除已撤销");
        await loadData();
      }
    });
    await loadData();
  }, { control, busyText: "删除中…" });
}

function filterAddMemberOptions(input) {
  const query = input.value.trim().toLowerCase();
  const block = input.closest(".add-members");
  if (!block) return;
  const options = [...block.querySelectorAll("[data-add-member-option]")];
  let visible = 0;
  for (const option of options) {
    const match = !query || option.dataset.searchText.includes(query);
    option.hidden = !match;
    if (match) visible += 1;
  }
  const empty = block.querySelector("[data-add-member-empty]");
  if (empty) empty.hidden = visible > 0;
}

function filterMemberChoiceOptions() {
  const input = $("#memberChoiceSearch");
  const list = $("#memberChoices");
  if (!input || !list) return;
  const query = input.value.trim().toLowerCase();
  const options = [...list.querySelectorAll("[data-member-choice-option]")];
  let visible = 0;
  for (const option of options) {
    const match = !query || option.dataset.searchText.includes(query);
    option.hidden = !match;
    if (match) visible += 1;
  }
  const empty = list.querySelector("[data-member-choice-empty]");
  if (empty) empty.hidden = visible > 0;
}

function bindEvents() {
  $("#refreshBtn").addEventListener("click", (event) => runBusyAction("refresh", loadData, { control: event.currentTarget, busyText: "刷新中…" }));
  $("#newTaskBtn").addEventListener("click", (event) => {
    if (v2State.activeV2View === "assignment" && v2State.assignmentPlanId) return openV2AssignmentDialog(v2State.assignmentPlanId, event.currentTarget);
    return openTaskDialog();
  });
  $("#cancelTaskCreate").addEventListener("click", closeTaskDialog);
  $("#cancelTaskCreateTop")?.addEventListener("click", closeTaskDialog);
  $("#taskDialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeTaskDialog();
  });
  $("#dataMenuBtn").addEventListener("click", () => {
    state.activeView = "maintenance";
    saveDesktopPreferences();
    renderViewState();
    renderSelection();
  });
  $("#toggleMemberSidebar").addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    saveDesktopPreferences();
    renderViewState();
  });
  $("#memberSearchInput").addEventListener("input", (event) => {
    state.memberSearch = event.target.value;
    renderMembers();
  });
  $("#newMemberBtn").addEventListener("click", () => openMemberEditor());
  $("#stackMemberList").addEventListener("change", (event) => {
    state.stackMemberList = event.target.checked;
    renderMembers();
  });
  $("#cancelEdit").addEventListener("click", () => $("#editDialog").close());
  $("#cancelTemplateEditBtn").addEventListener("click", resetTemplateForm);
  $("#editForm").addEventListener("submit", submitEdit);

  $("#templateSelect").addEventListener("change", (event) => applyTemplate(event.target.value));
  $("#memberChoiceSearch").addEventListener("input", filterMemberChoiceOptions);
  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderGantt();
    renderTasks();
    renderFilterFeedback();
  });
  $("#scaleSelect").addEventListener("change", (event) => {
    state.scale = event.target.value;
    saveDesktopPreferences();
    renderGantt();
  });
  $("#zoomRange").addEventListener("input", (event) => {
    state.zoom = Number(event.target.value);
    saveDesktopPreferences();
    renderGantt();
  });
  $("#rangeSelect").addEventListener("change", (event) => {
    state.rangeMode = event.target.value;
    saveDesktopPreferences();
    renderGantt();
  });
  $("#onlyBusyMembers").addEventListener("change", (event) => {
    state.onlyBusyMembers = event.target.checked;
    renderGantt();
  });
  $("#stackTasks").addEventListener("change", (event) => {
    state.stackTasks = event.target.checked;
    renderGantt();
  });
  $("#todayBtn").addEventListener("click", scrollGanttToToday);

  ["filterMember", "filterStatus", "filterStart", "filterEnd", "filterOverdue", "filterOverlap"].forEach((id) => {
    $(`#${id}`).addEventListener("change", async () => {
      updateFilterFromControls();
      try {
        await loadData();
      } catch (error) {
        showToast(error.message, { type: "error" });
      }
    });
  });
  $("#loadPeriod").addEventListener("change", (event) => {
    state.loadPeriod = event.target.value;
    renderLoad();
  });
  $("#loadMemberFilter").addEventListener("change", (event) => {
    state.loadMemberId = event.target.value;
    renderLoad();
  });
  $("#logSearchInput").addEventListener("input", (event) => {
    state.logSearch = event.target.value;
    renderLogs();
  });
  $("#logTypeFilter").addEventListener("change", (event) => {
    state.logType = event.target.value;
    renderLogs();
  });
  $("#logDateFilter").addEventListener("change", (event) => {
    state.logDate = event.target.value;
    renderLogs();
  });
  $("#taskSort").addEventListener("change", (event) => {
    state.taskSort = event.target.value;
    saveDesktopPreferences();
    renderTasks();
  });
  $$("[data-task-view-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.taskViewMode = button.dataset.taskViewMode;
      saveDesktopPreferences();
      renderTasks();
    });
  });
  $("#clearFiltersBtn").addEventListener("click", async () => {
    state.filters = { member_id: "", status: "", start_date: "", end_date: "", overdue: false, overlap: false };
    state.search = "";
    try {
      await loadData();
    } catch (error) {
      showToast(error.message, { type: "error" });
    }
  });

  $$("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      saveDesktopPreferences();
      renderViewState();
      renderSelection();
    });
  });

  $("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setTaskFormError();
    await runBusyAction("create-task", async () => {
      const form = new FormData(formElement);
      const payload = Object.fromEntries(form);
      payload.member_ids = form.getAll("member_ids").map(Number);
      payload.checklist = String(payload.checklist || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
      formElement.reset();
      formElement.elements.color.value = "#2563eb";
      formElement.elements.status.value = "auto";
      setDefaultDates();
      $("#memberChoiceSearch").value = "";
      if ($("#taskDialog")?.open) $("#taskDialog").close();
      showToast("任务已创建");
      await loadData();
      $("#newTaskBtn")?.focus();
    }, {
      control: $("#createTaskSubmit"),
      relatedControls: [$("#cancelTaskCreate"), $("#cancelTaskCreateTop"), $("#newTaskBtn")],
      busyText: "创建中…",
      onError: (error) => {
        setTaskFormError(error.message);
        formElement.elements.title?.focus();
      }
    });
  });

  $("#templateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    const templateId = payload.id;
    delete payload.id;
    if (!payload.name) return showToast("模板名不能为空", { type: "error" });
    payload.duration_days = Number(payload.duration_days || 7);
    payload.checklist = String(payload.checklist || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    await runBusyAction("save-template", async () => {
      if (templateId) {
        await api(`/api/templates/${templateId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/api/templates", { method: "POST", body: JSON.stringify(payload) });
      }
      resetTemplateForm();
      showToast(templateId ? "模板已更新" : "模板已保存");
      await loadData();
    }, { control: event.currentTarget.querySelector('[type="submit"]'), busyText: "保存中…" });
  });

  $("#importMembersBtn").addEventListener("click", async () => {
    await runBusyAction("import-members", async () => {
      const result = await api("/api/import/members", { method: "POST", body: JSON.stringify({ csv: $("#membersCsv").value }) });
      showImportErrors(result);
      showToast(`已导入 ${result.created} 名成员${result.errors?.length ? "，部分行失败" : ""}`);
      await loadData();
    }, { control: $("#importMembersBtn"), busyText: "导入中…" });
  });

  $("#importTasksBtn").addEventListener("click", async () => {
    await runBusyAction("import-tasks", async () => {
      const result = await api("/api/import/tasks", { method: "POST", body: JSON.stringify({ csv: $("#tasksCsv").value }) });
      showImportErrors(result);
      showToast(`已导入 ${result.created} 个任务${result.errors?.length ? "，部分行失败" : ""}`);
      await loadData();
    }, { control: $("#importTasksBtn"), busyText: "导入中…" });
  });

  $("#batchApplyBtn").addEventListener("click", applyBatch);
  $("#batchStatus").addEventListener("change", renderSelection);
  $("#archiveSelectedBtn").addEventListener("click", async () => {
    if (!state.selectedTaskIds.size) return showToast("请先选择任务");
    if (!window.confirm(`确认归档选中的 ${state.selectedTaskIds.size} 个任务？归档后会从日常视图移到维护页归档区。`)) return;
    const taskIds = [...state.selectedTaskIds];
    await runBusyAction("archive-selected", async () => {
      await api("/api/batch/tasks", { method: "POST", body: JSON.stringify({ task_ids: taskIds, status: "archived" }) });
      state.selectedTaskIds.clear();
      showToast("已归档所选任务", {
        actionLabel: "撤销",
        onAction: async () => {
          await Promise.all(taskIds.map((id) => api(`/api/tasks/${id}/restore`, { method: "POST", body: "{}" })));
          showToast("归档已撤销");
          await loadData();
        }
      });
      await loadData();
    }, { control: $("#archiveSelectedBtn"), busyText: "归档中…" });
  });

  $("#clearLogsBtn").addEventListener("click", async () => {
    if (!window.confirm("确认清空全部操作日志？操作前会自动下载备份。")) return;
    await runBusyAction("clear-logs", async () => {
      const result = await api("/api/maintenance/clear-logs", { method: "POST", body: "{}" });
      downloadBackup(result.backup, "before-clear-logs");
      showToast(`已清空 ${result.deleted} 条日志`);
      await loadData();
    }, { control: $("#clearLogsBtn"), busyText: "清理中…" });
  });
  $("#purgeArchivedBtn").addEventListener("click", async () => {
    if (!window.confirm("确认把所有归档任务移入回收站？操作前会自动下载备份。")) return;
    await runBusyAction("purge-archived", async () => {
      const result = await api("/api/maintenance/purge-archived", { method: "POST", body: "{}" });
      downloadBackup(result.backup, "before-purge-archived");
      showToast(`已将 ${result.deleted} 个归档任务移入回收站`);
      await loadData();
    }, { control: $("#purgeArchivedBtn"), busyText: "移动中…" });
  });
  $("#resetSampleBtn").addEventListener("click", async () => {
    const text = window.prompt("输入 RESET 确认重置示例数据");
    if (text !== "RESET") return showToast("已取消重置");
    await runBusyAction("reset-sample", async () => {
      const result = await api("/api/maintenance/reset-sample", { method: "POST", body: "{}" });
      downloadBackup(result.backup, "before-reset-sample");
      state.selectedTaskIds.clear();
      state.activeAssignmentId = null;
      state.activeTaskId = null;
      showToast("示例数据已重置");
      await loadData();
    }, { control: $("#resetSampleBtn"), busyText: "重置中…" });
  });

  document.body.addEventListener("change", async (event) => {
    const taskCheck = event.target.closest("[data-task-check]");
    if (taskCheck) {
      const id = Number(taskCheck.dataset.taskCheck);
      if (taskCheck.checked) state.selectedTaskIds.add(id);
      else state.selectedTaskIds.delete(id);
      renderSelection();
      return;
    }
    const checkItem = event.target.closest("[data-check-item]");
    if (checkItem) {
      const previous = !checkItem.checked;
      await runBusyAction(`check-item-${checkItem.dataset.checkItem}`, async () => {
        await api(`/api/checklist/${checkItem.dataset.checkItem}`, { method: "PUT", body: JSON.stringify({ is_done: checkItem.checked }) });
        await loadData();
      }, { onError: () => { checkItem.checked = previous; } });
    }
  });

  document.body.addEventListener("pointerdown", startGanttDrag);
  document.body.addEventListener("pointermove", previewGanttDrag);
  document.body.addEventListener("pointerup", finishGanttDrag);
  document.body.addEventListener("pointercancel", finishGanttDrag);

  document.body.addEventListener("input", (event) => {
    const search = event.target.closest("[data-member-search]");
    if (search) filterAddMemberOptions(search);
  });

  document.body.addEventListener("click", async (event) => {
    const target = event.target;
    const action = (selector) => target.closest(selector);

    if (action("#closeDetailBtn")) {
      closeDetail();
      return;
    }
    if (action("[data-open-task-dialog]")) return openTaskDialog();
    if (action("[data-complete-task]")) return completeTask(action("[data-complete-task]").dataset.completeTask, action("[data-complete-task]"));
    if (action("[data-stat-filter]")) {
      const type = action("[data-stat-filter]").dataset.statFilter;
      state.filters[type] = true;
      if (!["gantt", "tasks"].includes(state.activeView)) state.activeView = "tasks";
      saveDesktopPreferences();
      await runBusyAction(`stat-filter-${type}`, loadData, { control: action("[data-stat-filter]"), busyText: "筛选中…" });
      return;
    }
    if (action("[data-remove-filter]")) {
      const key = action("[data-remove-filter]").dataset.removeFilter;
      if (key === "search") {
        state.search = "";
        renderGantt();
        renderTasks();
        renderFilters();
      } else {
        state.filters[key] = ["overdue", "overlap"].includes(key) ? false : "";
        await runBusyAction(`remove-filter-${key}`, loadData, { control: action("[data-remove-filter]"), busyText: "移除中…" });
      }
      return;
    }
    if (action("[data-empty-show-all]")) {
      state.filters = { member_id: "", status: "", start_date: "", end_date: "", overdue: false, overlap: false };
      state.search = "";
      state.rangeMode = "smart";
      saveDesktopPreferences();
      await runBusyAction("empty-show-all", loadData, { control: action("[data-empty-show-all]"), busyText: "加载中…" });
      return;
    }
    if (action("[data-empty-show-overdue]")) {
      state.filters.overdue = true;
      state.rangeMode = "smart";
      saveDesktopPreferences();
      await runBusyAction("empty-show-overdue", loadData, { control: action("[data-empty-show-overdue]"), busyText: "加载中…" });
      return;
    }
    if (action("[data-maintenance-target]")) {
      const id = action("[data-maintenance-target]").dataset.maintenanceTarget;
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (action("[data-edit-member]")) return openMemberEditor(action("[data-edit-member]").dataset.editMember);
    if (action("[data-edit-task]")) {
      const trigger = action("[data-edit-task]");
      return openExecutionTaskEditor(trigger.dataset.editTask, trigger);
    }
    if (action("[data-edit-assignment]")) return openAssignmentEditor(action("[data-edit-assignment]").dataset.editAssignment);
    if (action("[data-select-assignment]")) {
      const trigger = action("[data-select-assignment]");
      rememberDetailTrigger(trigger);
      state.activeAssignmentId = Number(trigger.dataset.selectAssignment);
      state.activeTaskId = null;
      renderGantt();
      renderDetail();
      return;
    }
    if (action("[data-select-task]")) {
      const trigger = action("[data-select-task]");
      rememberDetailTrigger(trigger);
      state.activeTaskId = Number(trigger.dataset.selectTask);
      state.activeAssignmentId = null;
      renderGantt();
      renderDetail();
      return;
    }
    if (action("[data-add-members-to-task]")) return addMembersToTask(action("[data-add-members-to-task]").dataset.addMembersToTask, action("[data-add-members-to-task]"));
    if (action("[data-add-check-item]")) {
      const taskId = action("[data-add-check-item]").dataset.addCheckItem;
      const input = $(`[data-new-check-title="${taskId}"]`);
      if (!input.value.trim()) return showToast("检查项不能为空", { type: "error" });
      await runBusyAction(`add-check-${taskId}`, async () => {
        await api(`/api/tasks/${taskId}/checklist`, { method: "POST", body: JSON.stringify({ title: input.value.trim() }) });
        showToast("检查项已添加");
        await loadData();
      }, { control: action("[data-add-check-item]"), busyText: "添加中…" });
      return;
    }
    if (action("[data-delete-check-item]")) {
      const id = action("[data-delete-check-item]").dataset.deleteCheckItem;
      await runBusyAction(`delete-check-${id}`, async () => {
        await api(`/api/checklist/${id}`, { method: "DELETE" });
        showToast("检查项已删除");
        await loadData();
      }, { control: action("[data-delete-check-item]"), busyText: "删除中…" });
      return;
    }
    if (action("[data-delete-template]")) {
      const id = action("[data-delete-template]").dataset.deleteTemplate;
      await runBusyAction(`delete-template-${id}`, async () => {
        await api(`/api/templates/${id}`, { method: "DELETE" });
        showToast("模板已删除");
        await loadData();
      }, { control: action("[data-delete-template]"), busyText: "删除中…" });
      return;
    }
    if (action("[data-edit-template]")) {
      editTemplate(action("[data-edit-template]").dataset.editTemplate);
      return;
    }
    if (action("[data-restore-task]")) {
      const id = action("[data-restore-task]").dataset.restoreTask;
      await runBusyAction(`restore-task-${id}`, async () => {
        await api(`/api/tasks/${id}/restore`, { method: "POST", body: "{}" });
        showToast("任务已恢复");
        await loadData();
      }, { control: action("[data-restore-task]"), busyText: "恢复中…" });
      return;
    }
    if (action("[data-restore-member]")) {
      const id = action("[data-restore-member]").dataset.restoreMember;
      await runBusyAction(`restore-member-${id}`, async () => {
        await api(`/api/members/${id}/restore`, { method: "POST", body: "{}" });
        showToast("成员已恢复");
        await loadData();
      }, { control: action("[data-restore-member]"), busyText: "恢复中…" });
      return;
    }
    if (action("[data-remove-assignment]")) {
      const id = action("[data-remove-assignment]").dataset.removeAssignment;
      await runBusyAction(`remove-assignment-${id}`, async () => {
        await api(`/api/assignments/${id}`, { method: "DELETE" });
        state.activeAssignmentId = null;
        showToast("已移除该成员分配");
        await loadData();
      }, { control: action("[data-remove-assignment]"), busyText: "移除中…" });
      return;
    }
    if (action("[data-archive-task]")) {
      const taskId = Number(action("[data-archive-task]").dataset.archiveTask);
      const task = state.tasks.find((item) => item.id === taskId);
      const name = task?.title || `ID ${taskId}`;
      if (!window.confirm(`确认归档任务「${name}」？归档后会从日常视图移到维护页归档区。`)) return;
      await runBusyAction(`archive-task-${taskId}`, async () => {
        await api(`/api/tasks/${taskId}/archive`, { method: "POST" });
        showToast("任务已归档", {
          actionLabel: "撤销",
          onAction: async () => {
            await api(`/api/tasks/${taskId}/restore`, { method: "POST", body: "{}" });
            showToast("归档已撤销");
            await loadData();
          }
        });
        await loadData();
      }, { control: action("[data-archive-task]"), busyText: "归档中…" });
      return;
    }
    if (action("[data-delete-task]")) {
      return deleteTaskById(action("[data-delete-task]").dataset.deleteTask, action("[data-delete-task]"));
    }
    if (action("[data-delete-member]")) {
      const id = action("[data-delete-member]").dataset.deleteMember;
      await runBusyAction(`delete-member-${id}`, async () => {
        await api(`/api/members/${id}`, { method: "DELETE" });
        $("#editDialog").close();
        showToast("成员已删除");
        await loadData();
      }, { control: action("[data-delete-member]"), busyText: "删除中…" });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.querySelector("dialog[open]")) return;
    const topicPane = $("#v3TopicDetailPane");
    if (topicPane && !topicPane.hidden && topicPane.classList.contains("is-open")) {
      event.preventDefault();
      if (typeof v3CloseTopicDetail === "function") v3CloseTopicDetail();
      return;
    }
    const planPane = $("#planDetailPane");
    if (planPane && !planPane.hidden && planPane.classList.contains("is-open")) {
      event.preventDefault();
      closeV2PlanDetail();
      return;
    }
    const pane = $("#detailPane");
    if (!pane || pane.hidden || !pane.classList.contains("is-open")) return;
    event.preventDefault();
    closeDetail();
  });
}

// V2 is deliberately isolated from the V1 task workspace. It only coordinates
// the approved additive APIs and frozen desktop DOM; V1 rendering remains the
// owner of the execution and management subviews it already supports.
const V2_PREFS_KEY = "teamTaskGantt.v2Prefs.v1";
const v2PreferenceDefaults = {
  activeV2View: "workbench",
  executionView: "gantt",
  managementView: "logs",
  arrivalWindowDays: 7,
  groupBy: "none",
  search: "",
  displayStatus: "",
  sourceGroupId: "",
  cryostatId: "",
  primaryMemberId: "",
  includeArchived: false
};

function readV2Preferences() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(V2_PREFS_KEY) || "null");
    if (!raw || typeof raw !== "object") return { ...v2PreferenceDefaults };
    const next = { ...v2PreferenceDefaults };
    if (["workbench", "plans", "assignment", "execution", "acceptance", "management"].includes(raw.activeV2View)) next.activeV2View = raw.activeV2View;
    if (["gantt", "tasks", "load"].includes(raw.executionView)) next.executionView = raw.executionView;
    if (["logs", "maintenance"].includes(raw.managementView)) next.managementView = raw.managementView;
    if (Number.isInteger(Number(raw.arrivalWindowDays)) && Number(raw.arrivalWindowDays) >= 0 && Number(raw.arrivalWindowDays) <= 365) next.arrivalWindowDays = Number(raw.arrivalWindowDays);
    if (["none", "source_group", "cryostat", "primary_member", "project_tag", "topic_tag"].includes(raw.groupBy)) next.groupBy = raw.groupBy;
    for (const key of ["search", "displayStatus", "sourceGroupId", "cryostatId", "primaryMemberId"]) if (typeof raw[key] === "string") next[key] = raw[key];
    if (typeof raw.includeArchived === "boolean") next.includeArchived = raw.includeArchived;
    return next;
  } catch {
    return { ...v2PreferenceDefaults };
  }
}

const v2State = {
  ...readV2Preferences(),
  sourceGroups: [],
  contactsByGroup: new Map(),
  cryostats: [],
  plans: [],
  allPlans: [],
  planMeta: null,
  status: null,
  activePlanId: null,
  activePlan: null,
  assignmentPlanId: "",
  acceptancePlanId: "",
  submissionStatus: "",
  planDraftItems: [],
  planEditId: null,
  planEditVersion: null,
  etaPlan: null,
  etaPreview: null,
  cryostatPlan: null,
  cryostatPreview: null,
  assignmentPlan: null,
  assignmentTaskId: null,
  assignmentPreview: null,
  submissionTask: null,
  submissionPlan: null,
  reviewSubmission: null,
  resourceEdit: null,
  busy: new Set(),
  dialogReturnFocus: new Map(),
  planDetailReturnFocus: null,
  planDetailReturnSelector: "",
  planDetailOriginView: null,
  initialized: false
};

const v2StatusLabels = {
  testing: "正在测试中",
  delayed: "延期",
  arriving_within_window: "规定时间内到来",
  arriving_outside_window: "规定时间外到来",
  time_pending: "时间待确认",
  completed: "已完成",
  unclassified: "已到样，尚未测试"
};

function saveV2Preferences() {
  const value = {};
  for (const key of Object.keys(v2PreferenceDefaults)) value[key] = v2State[key];
  try {
    window.localStorage.setItem(V2_PREFS_KEY, JSON.stringify(value));
  } catch {
    // Preferences are optional and never block work.
  }
}

async function v2Api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || "请求失败");
    error.code = payload?.code || "REQUEST_FAILED";
    error.details = payload?.details || {};
    error.status = response.status;
    throw error;
  }
  return payload;
}

function v2ErrorText(error) {
  const labels = {
    STALE_PREVIEW: "数据已变化，请核对新的影响预览后再次确认。",
    VERSION_CONFLICT: "计划已被其他操作更新，请刷新后重试。",
    CONFLICT_ACK_REQUIRED: "存在冲突，请核对预览后明确确认。",
    RESOURCE_INACTIVE: "所选资源已停用，请重新选择。",
    CHECKLIST_TEMPLATE_STALE: "验收清单模板已更新，请重新打开后提交。",
    SUBMISSION_PENDING: "该任务已有待验收成果。",
    TASK_ALREADY_ACCEPTED: "该任务成果已经验收通过。"
  };
  return labels[error?.code] || error?.message || "操作失败";
}

function setV2FormError(id, message = "") {
  const node = $(id);
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

async function runV2Busy(key, action, { control = null, formError = "", busyText = "处理中…" } = {}) {
  if (v2State.busy.has(key)) return false;
  const button = control?.closest?.("button") || control;
  const oldText = button?.textContent;
  v2State.busy.add(key);
  if (button) {
    button.disabled = true;
    if (busyText) button.textContent = busyText;
  }
  if (formError) setV2FormError(formError);
  try {
    await action();
    return true;
  } catch (error) {
    const message = v2ErrorText(error);
    if (formError) setV2FormError(formError, message);
    else showToast(message, { type: "error" });
    return false;
  } finally {
    v2State.busy.delete(key);
    if (button?.isConnected) {
      button.disabled = false;
      if (oldText !== undefined) button.textContent = oldText;
    }
  }
}

function v2Json(method, body) {
  return { method, body: JSON.stringify(body) };
}

function nullableId(value) {
  return value === "" || value === null || value === undefined ? null : Number(value);
}

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function actorValue(value) {
  return String(value ?? "").trim() || "本地用户";
}

function v2Option(value, label, selected = false, disabled = false) {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}${disabled ? " disabled" : ""}>${escapeHtml(label)}</option>`;
}

function v2ConflictCodes(conflicts = []) {
  return [...new Set(conflicts.map((item) => item.code).filter(Boolean))].sort();
}

function v2ConflictHtml(conflicts = []) {
  if (!conflicts.length) return '<p>未发现日期、负载或制冷机冲突。</p>';
  return `<ul>${conflicts.map((item) => {
    const dates = item.date_range ? `${item.date_range.start_date}～${item.date_range.end_date}` : "";
    return `<li><strong>${escapeHtml(item.code)}</strong> ${escapeHtml(dates)}${item.member_ids?.length ? ` · 成员 ${escapeHtml(item.member_ids.join(", "))}` : ""}${item.plan_ids?.length ? ` · 计划 ${escapeHtml(item.plan_ids.join(", "))}` : ""}</li>`;
  }).join("")}</ul>`;
}

function setV2View(view, focusTab = false) {
  if (!["workbench", "plans", "assignment", "execution", "acceptance", "management"].includes(view)) return;
  v2State.activeV2View = view;
  $$('[data-v2-view]').forEach((tab) => {
    const active = tab.dataset.v2View === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $$('[data-v2-toolbar-view]').forEach((toolbar) => { toolbar.hidden = toolbar.dataset.v2ToolbarView !== view; });
  $$('[data-v2-panel]').forEach((panel) => {
    const active = panel.dataset.v2Panel === view;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  const newTask = $("#newTaskBtn");
  if (newTask) newTask.hidden = !["assignment", "execution"].includes(view);
  if (view === "execution") {
    state.activeView = v2State.executionView;
    saveDesktopPreferences();
    renderViewState();
    renderSelection();
  } else if (view === "management") {
    state.activeView = v2State.managementView;
    saveDesktopPreferences();
    renderViewState();
  }
  updateV2DocumentTitle();
  saveV2Preferences();
  if (focusTab) $("[data-v2-view].active")?.focus();
  if (view === "acceptance") loadV2Submissions().catch((error) => showToast(v2ErrorText(error), { type: "error" }));
}

function updateV2DocumentTitle() {
  document.title = `${$("[data-v2-view].active")?.textContent?.trim() || "工作台"} · 小组任务管理与甘特图系统`;
}

function syncV2Controls() {
  $("#planSearchInput").value = v2State.search;
  $("#planStatusFilter").value = v2State.displayStatus;
  $("#planSourceFilter").value = v2State.sourceGroupId;
  $("#planCryostatFilter").value = v2State.cryostatId;
  $("#planOwnerFilter").value = v2State.primaryMemberId;
  $("#planGroupBy").value = v2State.groupBy;
  $("#arrivalWindowDays").value = String(v2State.arrivalWindowDays);
  $("#planIncludeArchived").checked = v2State.includeArchived;
}

function renderV2ResourceOptions() {
  const activeGroups = v2State.sourceGroups.filter((item) => item.is_active);
  const activeCryostats = v2State.cryostats.filter((item) => item.status === "active");
  const currentValues = {
    planSourceFilter: v2State.sourceGroupId,
    planCryostatFilter: v2State.cryostatId,
    planOwnerFilter: v2State.primaryMemberId,
    planSourceGroup: $("#planSourceGroup")?.value || "",
    planCryostat: $("#planCryostat")?.value || "",
    cryostatChangeSelect: $("#cryostatChangeSelect")?.value || "",
    resourceSourceGroup: $("#resourceSourceGroup")?.value || ""
  };
  $("#planSourceFilter").innerHTML = v2Option("", "全部来源") + v2State.sourceGroups.map((item) => v2Option(item.id, item.name, String(item.id) === currentValues.planSourceFilter)).join("");
  $("#planCryostatFilter").innerHTML = v2Option("", "全部设备") + v2State.cryostats.map((item) => v2Option(item.id, item.name, String(item.id) === currentValues.planCryostatFilter)).join("");
  $("#planOwnerFilter").innerHTML = v2Option("", "全部负责人") + state.members.filter((item) => item.status === "active").map((item) => v2Option(item.id, item.name, String(item.id) === currentValues.planOwnerFilter)).join("");
  $("#planSourceGroup").innerHTML = v2Option("", "请选择来源小组") + activeGroups.map((item) => v2Option(item.id, item.name, String(item.id) === currentValues.planSourceGroup)).join("");
  $("#planCryostat").innerHTML = v2Option("", "请选择制冷机") + activeCryostats.map((item) => v2Option(item.id, item.name, String(item.id) === currentValues.planCryostat)).join("");
  $("#cryostatChangeSelect").innerHTML = v2Option("", "请选择制冷机") + activeCryostats.map((item) => v2Option(item.id, item.name, String(item.id) === currentValues.cryostatChangeSelect)).join("");
  $("#resourceSourceGroup").innerHTML = v2Option("", "请选择来源小组") + activeGroups.map((item) => v2Option(item.id, item.name, String(item.id) === currentValues.resourceSourceGroup)).join("");
  syncV2Controls();
}

function v2PlanParams() {
  const params = new URLSearchParams({
    window_days: String(v2State.arrivalWindowDays),
    group_by: v2State.groupBy,
    include_archived: v2State.includeArchived ? "1" : "0",
    limit: "200",
    sort: "eta_asc"
  });
  if (v2State.search) params.set("search", v2State.search);
  if (v2State.displayStatus) params.set("display_status", v2State.displayStatus);
  if (v2State.sourceGroupId) params.set("source_group_id", v2State.sourceGroupId);
  if (v2State.cryostatId) params.set("cryostat_id", v2State.cryostatId);
  if (v2State.primaryMemberId) params.set("primary_member_id", v2State.primaryMemberId);
  return params;
}

function v2HasPlanFilters() {
  return Boolean(v2State.search || v2State.displayStatus || v2State.sourceGroupId || v2State.cryostatId || v2State.primaryMemberId || v2State.includeArchived);
}

function v2StatusChip(plan) {
  const status = plan.display_status || "unclassified";
  const label = v2StatusLabels[status];
  return `<span class="v2-status-chip" data-status="${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function v2PlanRow(plan) {
  const eta = plan.eta_pending ? "到样时间待确认" : `预计到样 ${plan.current_eta_date || "—"}`;
  const cryostat = plan.cryostat_pending ? "制冷机待定" : (plan.cryostat?.name || "未设置制冷机");
  const archived = plan.archived ? " · 已归档" : "";
  return `<article class="v2-plan-row" data-plan-row="${plan.id}">
    <div><strong>${escapeHtml(plan.name)}</strong> ${v2StatusChip(plan)}</div>
    <p>${escapeHtml(plan.source_group?.name || "未知来源")} · 型号 ${escapeHtml(plan.sample_model)}${plan.sample_identifier ? ` · 编号 ${escapeHtml(plan.sample_identifier)}` : ""}</p>
    <p>${escapeHtml(eta)} · ${escapeHtml(cryostat)}${plan.eta_drift_days ? ` · 漂移 ${escapeHtml(plan.eta_drift_days)} 天` : ""}${archived}</p>
    <button class="ghost-button" type="button" data-open-plan-detail="${plan.id}" data-plan-id="${plan.id}">查看详情</button>
  </article>`;
}

function renderV2Plans() {
  const stats = v2State.planMeta?.stats || {};
  const statKeys = {
    testing: "testing", delayed: "delayed", arriving_within_window: "within",
    arriving_outside_window: "outside", time_pending: "pending", completed: "completed"
  };
  $$("#planStats [data-plan-status]").forEach((card) => {
    card.querySelector("strong").textContent = String(stats[statKeys[card.dataset.planStatus]] ?? 0);
    card.classList.toggle("active", v2State.displayStatus === card.dataset.planStatus);
  });
  const windowNote = $("#planStats [data-plan-status='arriving_within_window'] small");
  if (windowNote) windowNote.textContent = `未来 ${v2State.arrivalWindowDays} 天`;
  $("#planResultCount").textContent = `${v2State.planMeta?.total ?? v2State.plans.length} 个计划`;
  let html = "";
  const groups = v2State.groupBy === "none" ? [] : (v2State.planMeta?.groups || []);
  let groupIndex = 0;
  let remainingInGroup = 0;
  for (const plan of v2State.plans) {
    if (groups.length && remainingInGroup === 0) {
      const group = groups[groupIndex++];
      remainingInGroup = group?.count || 0;
      html += `<h3 class="v2-group-heading">${escapeHtml(group?.label || "未设置")}</h3>`;
    }
    html += v2PlanRow(plan);
    if (remainingInGroup > 0) remainingInGroup -= 1;
  }
  if (!html) {
    const template = $(v2HasPlanFilters() ? "#planFilterEmptyStateTemplate" : "#planTrueEmptyStateTemplate");
    html = template?.innerHTML || '<div class="v2-empty-state"><h3>没有计划</h3></div>';
  }
  $("#planOverviewList").innerHTML = html;
  $("#planList").innerHTML = html;
  renderV2PlanSelectors();
}

function renderV2PlanSelectors() {
  const plans = v2State.allPlans.filter((plan) => !plan.archived);
  const assignment = v2State.assignmentPlanId;
  const acceptance = v2State.acceptancePlanId;
  $("#assignmentPlanFilter").innerHTML = v2Option("", "请选择计划") + plans.map((plan) => v2Option(plan.id, plan.name, String(plan.id) === String(assignment))).join("");
  $("#acceptancePlanFilter").innerHTML = v2Option("", "全部计划") + plans.map((plan) => v2Option(plan.id, plan.name, String(plan.id) === String(acceptance))).join("");
  $("#openAssignmentBtn").disabled = !v2State.assignmentPlanId;
}

async function loadV2Resources() {
  const [groups, cryostats, status] = await Promise.all([
    v2Api("/api/v2/source-groups?include_inactive=1&limit=200&sort=name_asc"),
    v2Api("/api/v2/cryostats?include_inactive=1&limit=200&sort=name_asc"),
    v2Api("/api/v2/status")
  ]);
  v2State.sourceGroups = groups.data;
  v2State.cryostats = cryostats.data;
  v2State.status = status.data;
  const contactResults = await Promise.all(v2State.sourceGroups.map(async (group) => {
    const result = await v2Api(`/api/v2/source-groups/${group.id}/contacts?include_inactive=1&limit=200&sort=name_asc`);
    return [group.id, result.data];
  }));
  v2State.contactsByGroup = new Map(contactResults);
  renderV2ResourceOptions();
  renderV2ResourceAdmin();
}

async function loadV2Plans() {
  const allParams = new URLSearchParams({ window_days: String(v2State.arrivalWindowDays), include_archived: "0", limit: "200", sort: "name_asc" });
  const [result, all] = await Promise.all([
    v2Api(`/api/v2/plans?${v2PlanParams()}`),
    v2Api(`/api/v2/plans?${allParams}`)
  ]);
  v2State.plans = result.data;
  v2State.allPlans = all.data;
  v2State.planMeta = result.meta;
  renderV2Plans();
}

async function loadV2Workspace() {
  await Promise.all([loadV2Resources(), loadV2Plans()]);
  v2State.initialized = true;
  if (v2State.assignmentPlanId && v2State.plans.some((plan) => String(plan.id) === String(v2State.assignmentPlanId))) await loadV2AssignmentPlan(v2State.assignmentPlanId);
  if (v2State.activeV2View === "acceptance") await loadV2Submissions();
  updateV2DocumentTitle();
}

function renderV2ResourceAdmin() {
  const source = $("#sourceGroupAdmin");
  if (source) source.innerHTML = `
    <span class="eyebrow">业务来源</span><h2>来源小组与联系人</h2>
    <p>停用资源保留历史引用；联系人按来源小组维护。</p>
    <div class="v2-detail-list">${v2State.sourceGroups.map((group) => {
      const contacts = v2State.contactsByGroup.get(group.id) || [];
      return `<div><strong>${escapeHtml(group.name)}</strong>${group.is_active ? "" : "（已停用）"}
        <div>${contacts.map((contact) => `<span>${escapeHtml(contact.name)}${contact.title ? ` · ${escapeHtml(contact.title)}` : ""}${contact.is_active ? "" : "（已停用）"} <button class="small-button" type="button" data-edit-resource="source_contact" data-resource-id="${contact.id}" data-source-group-id="${group.id}">编辑</button></span>`).join("<br>") || "暂无联系人"}</div>
        <div class="form-actions"><button class="small-button" type="button" data-edit-resource="source_group" data-resource-id="${group.id}">编辑小组</button><button class="small-button" type="button" data-open-resource-dialog="source_contact" data-source-group-id="${group.id}">新增联系人</button></div>
      </div>`;
    }).join("") || "<div>尚未维护来源小组</div>"}</div>
    <button class="ghost-button" type="button" data-open-resource-dialog="source_group">新增来源小组</button>`;
  const cryostat = $("#cryostatAdmin");
  if (cryostat) cryostat.innerHTML = `
    <span class="eyebrow">设备资源</span><h2>制冷机</h2><p>停用不会删除既有计划历史。</p>
    <div class="v2-detail-list">${v2State.cryostats.map((item) => {
      const visibleNote = String(item.note || "").replace(/^V\d+(?:\.\d+)?\s*/i, "").trim() || "无备注";
      return `<div><strong>${escapeHtml(item.name)}</strong> · ${item.status === "active" ? "启用" : "停用"}<br><span>${escapeHtml(visibleNote)}</span> <button class="small-button" type="button" data-edit-resource="cryostat" data-resource-id="${item.id}">编辑</button></div>`;
    }).join("") || "<div>尚未维护制冷机</div>"}</div>
    <button class="ghost-button" type="button" data-open-resource-dialog="cryostat">新增制冷机</button>`;
  const status = $("#migrationStatus");
  if (status) status.innerHTML = `<span class="eyebrow">数据状态</span><h2>迁移与备份</h2><p>数据结构已就绪 · 完整性 ${escapeHtml(v2State.status?.quick_check || "未读取")} · 关联异常 ${escapeHtml(v2State.status?.foreign_key_violations ?? "—")}</p><a class="ghost-link" href="/api/v2/backup">读取完整 JSON 备份</a>`;
}

function rememberV2PlanTrigger(trigger, planId) {
  v2State.planDetailReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  v2State.planDetailReturnSelector = `[data-open-plan-detail][data-plan-id="${planId}"]`;
}

function restoreV2Focus(element, selector = "") {
  window.requestAnimationFrame(() => {
    const visible = (node) => node?.isConnected && !node.hidden && !node.closest("[hidden]");
    const fallback = selector ? $$(selector).find(visible) : null;
    const panel = $(`[data-v2-panel="${v2State.activeV2View}"]`);
    const firstControl = panel ? [...panel.querySelectorAll("button, input, select, textarea, a[href]")].find(visible) : null;
    const target = visible(element) ? element : fallback || firstControl || $("[data-v2-view].active") || $("#newPlanBtn");
    target?.focus();
  });
}

function closeV2PlanDetail({ restoreFocus = true } = {}) {
  const pane = $("#planDetailPane");
  if (!pane || pane.hidden) return;
  pane.classList.remove("is-open");
  pane.hidden = true;
  v2State.activePlanId = null;
  v2State.activePlan = null;
  const trigger = v2State.planDetailReturnFocus;
  const selector = v2State.planDetailReturnSelector;
  const originView = v2State.planDetailOriginView;
  v2State.planDetailReturnFocus = null;
  v2State.planDetailReturnSelector = "";
  v2State.planDetailOriginView = null;
  renderV2Plans();
  if (originView && originView !== v2State.activeV2View) setV2View(originView);
  if (restoreFocus) restoreV2Focus(trigger, selector);
}

function renderV2TestItem(item, plan) {
  return `<div><strong>${escapeHtml(item.title)}</strong> · ${item.is_required ? "必测" : "可选"}<p>${escapeHtml(item.acceptance_criteria || "未设置验收标准")}</p>${!item.archived ? `<button class="small-button" type="button" data-edit-test-item="${item.id}" data-plan-id="${plan.id}">编辑</button>` : "（已归档）"}</div>`;
}

function renderV2Task(task, plan) {
  const primary = task.primary_member?.name || "未设置";
  const collaborators = task.collaborators?.map((item) => item.name).join("、") || "无";
  const latest = plan.latest_submissions?.find((item) => item.task_lineage_key === task.task_lineage_key);
  return `<div><strong>${escapeHtml(task.title)}</strong> · ${escapeHtml(statusLabels[task.status] || task.status)}
    <p>${escapeHtml(task.default_start_date)}～${escapeHtml(task.default_end_date)} · 主责 ${escapeHtml(primary)} · 协作 ${escapeHtml(collaborators)} · ${escapeHtml(task.estimated_hours)}h${task.after_arrival ? " · 到样后" : ""}</p>
    <div class="form-actions"><button class="small-button" type="button" data-edit-plan-task="${task.id}" data-plan-id="${plan.id}">编辑分配</button>${!task.deleted_at && latest?.status !== "accepted" && latest?.status !== "submitted" ? `<button class="small-button" type="button" data-open-submission="${task.id}" data-plan-id="${plan.id}">提交成果</button>` : ""}</div>
    ${latest ? `<p>最新成果：${escapeHtml(latest.status)} #${latest.sequence}</p>` : ""}
  </div>`;
}

function renderV2SubmissionCard(submission, planName = "") {
  const safeLink = submission.resource_kind === "url" && /^https?:\/\//i.test(submission.resource_value)
    ? `<a href="${escapeHtml(submission.resource_value)}" target="_blank" rel="noopener noreferrer">打开成果 URL</a>`
    : `<span>${escapeHtml(submission.resource_value)}</span>`;
  return `<article class="v2-plan-row" data-submission-id="${submission.id}">
    <div><strong>${escapeHtml(submission.task_title_snapshot)}</strong> · ${escapeHtml(planName)} · ${escapeHtml(submission.status)}</div>
    <p>${escapeHtml(submission.description)} · 提交人 ${escapeHtml(submission.submitter_label)} · ${escapeHtml(submission.submitted_at)}</p>
    <p>${safeLink}</p>
    ${submission.status === "submitted" && submission.task_id !== null ? `<button class="ghost-button" type="button" data-open-review="${submission.id}">人工验收</button>` : ""}
  </article>`;
}

function renderV2PlanDetail(plan) {
  const pane = $("#planDetailPane");
  $("#planDetailTitle").textContent = plan.name;
  const status = plan.display_status
    ? ` · 状态 ${escapeHtml(v2StatusLabels[plan.display_status])}`
    : '<span class="visually-hidden"> · 状态：已到样，尚未测试</span>';
  const template = plan.acceptance_template;
  $("#planDetailContent").innerHTML = `
    <section><h3>计划信息</h3><div class="v2-detail-list"><div><strong>${escapeHtml(plan.name)}</strong> ${v2StatusChip(plan)}<p>${escapeHtml(plan.purpose)}</p><p>来源 ${escapeHtml(plan.source_group.name)} · 对方 ${escapeHtml(plan.counterpart_contact?.name || "未填写")} · 我方 ${escapeHtml(plan.local_liaison_name || "未填写")}</p><p>型号 ${escapeHtml(plan.sample_model)} · 编号 ${escapeHtml(plan.sample_identifier || "未补录")}${status}</p><p>预计到样 ${escapeHtml(plan.eta_pending ? "待确认" : plan.current_eta_date || "—")} · 实际到样 ${escapeHtml(plan.actual_arrival_date || "未到样")} · 制冷机 ${escapeHtml(plan.cryostat_pending ? "待定" : plan.cryostat?.name || "—")}</p></div></div></section>
    <div class="form-actions">
      <button class="small-button" type="button" data-edit-plan="${plan.id}">编辑计划</button>
      <button class="small-button" type="button" data-open-eta-change="${plan.id}">修订到样</button>
      <button class="small-button" type="button" data-open-cryostat-change="${plan.id}">修订制冷机</button>
      <button class="small-button" type="button" data-confirm-arrival="${plan.id}">记录实际到样</button>
      <button class="small-button" type="button" data-toggle-plan-archive="${plan.id}" data-restore="${plan.archived ? "1" : "0"}">${plan.archived ? "恢复计划" : "归档计划"}</button>
    </div>
    <section><h3>结构化测试项</h3><div id="testItemList" class="v2-detail-list">${plan.test_items.map((item) => renderV2TestItem(item, plan)).join("") || "<div>暂无测试项</div>"}</div><button class="small-button" type="button" data-add-test-item="${plan.id}">新增测试项</button></section>
    <section><h3>人员任务</h3><div class="v2-detail-list">${plan.plan_tasks.map((task) => renderV2Task(task, plan)).join("") || "<div>尚未人工创建任务</div>"}</div><button class="small-button" type="button" data-open-assignment-dialog data-plan-id="${plan.id}">人工创建任务</button></section>
    <section><h3>验收模板</h3><div class="v2-detail-list"><div><strong>${escapeHtml(template?.name || "未设置")}</strong><p>${template?.items?.map((item) => escapeHtml(item.label)).join("；") || "暂无清单项"}</p><button class="small-button" type="button" data-edit-acceptance-template="${plan.id}">维护模板</button></div></div></section>
    <section><h3>最新成果</h3><div class="v2-detail-list">${plan.latest_submissions.map((item) => renderV2SubmissionCard(item, plan.name)).join("") || "<div>暂无成果提交</div>"}</div></section>
    <section><h3>确认与变更历史</h3><div id="planHistoryList" class="v2-detail-list">${plan.events.map((event) => `<div><strong>${escapeHtml(event.event_type)}</strong> · ${escapeHtml(event.actor_label)}<p>${escapeHtml(event.created_at)}</p></div>`).join("") || "<div>暂无历史</div>"}</div></section>`;
  pane.hidden = false;
  pane.classList.add("is-open");
}

async function openV2PlanDetail(planId, trigger = null) {
  const paneWasOpen = !$("#planDetailPane").hidden && $("#planDetailPane").classList.contains("is-open");
  const originView = v2State.activeV2View;
  if (!paneWasOpen) {
    rememberV2PlanTrigger(trigger, planId);
    v2State.planDetailOriginView = originView;
  }
  if (v2State.activeV2View !== "plans") setV2View("plans");
  try {
    const [result, events] = await Promise.all([
      v2Api(`/api/v2/plans/${planId}`),
      v2Api(`/api/v2/plans/${planId}/events?limit=50&sort=id_desc`)
    ]);
    result.data.events = events.data;
    v2State.activePlanId = Number(planId);
    v2State.activePlan = result.data;
    renderV2PlanDetail(result.data);
    window.requestAnimationFrame(() => $("#closePlanDetailBtn")?.focus());
  } catch (error) {
    if (!paneWasOpen && originView !== v2State.activeV2View) setV2View(originView);
    if (!paneWasOpen) {
      v2State.planDetailReturnFocus = null;
      v2State.planDetailReturnSelector = "";
      v2State.planDetailOriginView = null;
    }
    throw error;
  }
}

function openV2Dialog(id, trigger, focusSelector) {
  const dialog = $(id);
  if (!dialog) return;
  v2State.dialogReturnFocus.set(id, trigger instanceof HTMLElement ? trigger : document.activeElement);
  if (!dialog.open) dialog.showModal();
  window.requestAnimationFrame(() => dialog.querySelector(focusSelector)?.focus());
}

function closeV2Dialog(id, { restoreFocus = true } = {}) {
  const dialog = $(id);
  if (!dialog?.open) return;
  dialog.close();
  const trigger = v2State.dialogReturnFocus.get(id);
  v2State.dialogReturnFocus.delete(id);
  if (restoreFocus) restoreV2Focus(trigger);
}

async function fillV2Contacts(groupId, selected = "") {
  const contacts = v2State.contactsByGroup.get(Number(groupId)) || [];
  $("#planCounterpartContact").innerHTML = v2Option("", "稍后补充") + contacts.filter((item) => item.is_active || String(item.id) === String(selected)).map((item) => v2Option(item.id, `${item.name}${item.title ? ` · ${item.title}` : ""}`, String(item.id) === String(selected), !item.is_active)).join("");
}

function renderV2PlanDraftItems() {
  $("#planTestItemDrafts").innerHTML = v2State.planDraftItems.map((item, index) => `<div><strong>${escapeHtml(item.title)}</strong> · ${item.is_required ? "必测" : "可选"}<p>${escapeHtml(item.acceptance_criteria || "未设置验收标准")}</p><button class="small-button" type="button" data-remove-plan-draft="${index}">移除</button></div>`).join("") || "<div>至少添加一个测试项。</div>";
  const draftTitle = $("#planTestItemEditor [name='test_item_title']");
  if (draftTitle) draftTitle.required = !v2State.planEditId && v2State.planDraftItems.length === 0;
}

async function openV2PlanDialog(plan = null, trigger = null) {
  const form = $("#planForm");
  form.reset();
  setV2FormError("#planFormError");
  v2State.planEditId = plan?.id || null;
  v2State.planEditVersion = plan?.version || null;
  v2State.planDraftItems = plan?.test_items?.map((item) => ({
    title: item.title,
    description: item.description || "",
    acceptance_criteria: item.acceptance_criteria || "",
    is_required: Boolean(item.is_required),
    position: item.position
  })) || [];
  $("#planDialogTitle").textContent = plan ? "编辑测控计划" : "新建测控计划";
  $("#planEtaPending").disabled = Boolean(plan);
  $("#planCryostatPending").disabled = Boolean(plan);
  $("#planEtaDate").disabled = Boolean(plan);
  $("#planCryostat").disabled = Boolean(plan);
  $("#planSourceGroup").value = plan ? String(plan.source_group.id) : "";
  await fillV2Contacts(plan?.source_group?.id || "", plan?.counterpart_contact?.id || "");
  if (plan) {
    $("#planName").value = plan.name;
    $("#planPurpose").value = plan.purpose;
    $("#planSampleModel").value = plan.sample_model;
    $("#planEtaDate").value = plan.current_eta_date || "";
    $("#planEtaPending").checked = plan.eta_pending;
    $("#planCryostat").value = plan.cryostat?.id ? String(plan.cryostat.id) : "";
    $("#planCryostatPending").checked = plan.cryostat_pending;
    $("#planLocalLiaison").value = plan.local_liaison_name || "";
    $("#planSampleIdentifier").value = plan.sample_identifier || "";
    $("#planIdentifierKind").value = plan.identifier_kind || "";
    $("#planProjectTag").value = plan.project_tag || "";
    $("#planTopicTag").value = plan.topic_tag || "";
  }
  $("#planTestItemEditor").hidden = Boolean(plan);
  $("#planTestItemDrafts").hidden = Boolean(plan);
  renderV2PlanDraftItems();
  openV2Dialog("#planDialog", trigger, "#planName");
}

function addV2PlanDraft() {
  const title = $("#planTestItemEditor [name='test_item_title']").value.trim();
  if (!title) return setV2FormError("#planFormError", "请填写测试项名称。");
  v2State.planDraftItems.push({
    title,
    description: "",
    acceptance_criteria: $("#planTestItemEditor [name='test_item_acceptance_criteria']").value.trim(),
    is_required: $("#planTestItemEditor [name='test_item_required']").checked,
    position: v2State.planDraftItems.length
  });
  $("#planTestItemEditor [name='test_item_title']").value = "";
  $("#planTestItemEditor [name='test_item_acceptance_criteria']").value = "";
  renderV2PlanDraftItems();
  setV2FormError("#planFormError");
}

function v2PlanFormPayload() {
  const identifier = nullableText($("#planSampleIdentifier").value);
  const base = {
    source_group_id: Number($("#planSourceGroup").value),
    counterpart_contact_id: nullableId($("#planCounterpartContact").value),
    local_liaison_name: $("#planLocalLiaison").value.trim(),
    name: $("#planName").value.trim(),
    purpose: $("#planPurpose").value.trim(),
    sample_model: $("#planSampleModel").value.trim(),
    sample_identifier: identifier,
    identifier_kind: identifier ? ($("#planIdentifierKind").value || null) : null,
    project_tag: nullableText($("#planProjectTag").value),
    topic_tag: nullableText($("#planTopicTag").value),
    actor_label: "本地用户"
  };
  if (v2State.planEditId) return { ...base, expected_version: v2State.planEditVersion };
  return {
    ...base,
    current_eta_date: $("#planEtaPending").checked ? null : ($("#planEtaDate").value || null),
    eta_pending: $("#planEtaPending").checked,
    cryostat_id: $("#planCryostatPending").checked ? null : nullableId($("#planCryostat").value),
    cryostat_pending: $("#planCryostatPending").checked,
    test_items: v2State.planDraftItems.map((item, position) => ({ ...item, position })),
    acceptance_template: { name: "计划验收清单", items: [{ label: "结果引用可访问且说明完整", position: 0 }] }
  };
}

async function saveV2Plan(event) {
  event.preventDefault();
  if (!v2State.planEditId && !v2State.planDraftItems.length) return setV2FormError("#planFormError", "至少添加一个结构化测试项。");
  await runV2Busy("save-plan", async () => {
    const payload = v2PlanFormPayload();
    const path = v2State.planEditId ? `/api/v2/plans/${v2State.planEditId}` : "/api/v2/plans";
    const method = v2State.planEditId ? "PUT" : "POST";
    const result = await v2Api(path, v2Json(method, payload));
    closeV2Dialog("#planDialog");
    showToast(v2State.planEditId ? "计划已更新" : "计划已创建");
    await loadV2Plans();
    if (v2State.activePlanId === result.data.id) await openV2PlanDetail(result.data.id, v2State.planDetailReturnFocus);
  }, { control: $("#savePlanBtn"), formError: "#planFormError", busyText: "正在保存…" });
}

function openV2ResourceDialog(kind, trigger, { id = null, sourceGroupId = null } = {}) {
  const aliases = { "source-group": "source_group", "source-contact": "source_contact" };
  kind = aliases[kind] || kind;
  $("#resourceForm").reset();
  setV2FormError("#resourceFormError");
  let item = null;
  if (kind === "source_group") item = v2State.sourceGroups.find((row) => row.id === Number(id));
  if (kind === "cryostat") item = v2State.cryostats.find((row) => row.id === Number(id));
  if (kind === "source_contact") item = [...v2State.contactsByGroup.values()].flat().find((row) => row.id === Number(id));
  v2State.resourceEdit = { kind, id: item?.id || null, sourceGroupId: Number(sourceGroupId || item?.source_group_id || 0) || null, item };
  $("#resourceType").value = kind;
  $("#resourceType").disabled = Boolean(item) || kind === "source_contact";
  $("#resourceName").value = item?.name || "";
  $("#resourceSourceGroup").value = v2State.resourceEdit.sourceGroupId ? String(v2State.resourceEdit.sourceGroupId) : "";
  $("#resourceTitle").value = item?.title || "";
  $("#resourceContactText").value = item?.contact_text || "";
  $("#resourceNote").value = item?.note || "";
  $("#resourceIsActive").checked = kind === "cryostat" ? item?.status !== "inactive" : item?.is_active !== false;
  syncV2ResourceFields();
  $("#resourceDialogTitle").textContent = `${item ? "编辑" : "新增"}${kind === "source_group" ? "来源小组" : kind === "source_contact" ? "来源联系人" : "制冷机"}`;
  openV2Dialog("#resourceDialog", trigger, "#resourceName");
}

function syncV2ResourceFields() {
  const kind = $("#resourceType").value;
  $("#resourceSourceGroup").closest("label").hidden = kind !== "source_contact";
  $("#resourceTitle").closest("label").hidden = kind !== "source_contact";
  $("#resourceContactText").closest("label").hidden = kind !== "source_contact";
  $("#resourceNote").closest("label").hidden = kind === "source_contact";
  $("#resourceIsActive").closest("label").hidden = !v2State.resourceEdit?.item;
}

async function saveV2Resource(event) {
  event.preventDefault();
  await runV2Busy("save-resource", async () => {
    const edit = v2State.resourceEdit || { kind: $("#resourceType").value };
    const kind = edit.kind;
    const name = $("#resourceName").value.trim();
    let path;
    let method;
    let payload;
    if (kind === "source_group") {
      path = edit.id ? `/api/v2/source-groups/${edit.id}` : "/api/v2/source-groups";
      method = edit.id ? "PUT" : "POST";
      payload = { name, note: $("#resourceNote").value.trim() };
      if (edit.id) Object.assign(payload, { is_active: $("#resourceIsActive").checked, expected_updated_at: edit.item.updated_at });
    } else if (kind === "source_contact") {
      const groupId = edit.sourceGroupId || Number($("#resourceSourceGroup").value);
      path = edit.id ? `/api/v2/source-contacts/${edit.id}` : `/api/v2/source-groups/${groupId}/contacts`;
      method = edit.id ? "PUT" : "POST";
      payload = { name, title: $("#resourceTitle").value.trim(), contact_text: $("#resourceContactText").value.trim() };
      if (edit.id) Object.assign(payload, { is_active: $("#resourceIsActive").checked, expected_updated_at: edit.item.updated_at });
    } else {
      path = edit.id ? `/api/v2/cryostats/${edit.id}` : "/api/v2/cryostats";
      method = edit.id ? "PUT" : "POST";
      payload = { name, note: $("#resourceNote").value.trim() };
      if (edit.id) Object.assign(payload, { status: $("#resourceIsActive").checked ? "active" : "inactive", expected_updated_at: edit.item.updated_at });
    }
    await v2Api(path, v2Json(method, payload));
    closeV2Dialog("#resourceDialog");
    showToast("资源已保存");
    await Promise.all([loadV2Resources(), loadV2Plans()]);
    await v3RefreshAfterChange(undefined, { reloadLegacy: false });
  }, { control: $("#saveResourceBtn"), formError: "#resourceFormError", busyText: "正在保存…" });
}

async function openV2EtaDialog(planId, trigger) {
  const result = await v2Api(`/api/v2/plans/${planId}`);
  v2State.etaPlan = result.data;
  v2State.etaPreview = null;
  $("#etaChangeForm").reset();
  $("#etaChangeDate").value = result.data.current_eta_date || "";
  $("#etaChangePending").checked = result.data.eta_pending;
  $("#etaActorLabel").value = "";
  $("#etaImpactPreview").innerHTML = '<h3>影响预览</h3><p>默认不移动任务；填写后先预览。</p>';
  $("#etaCandidateTasks").innerHTML = "";
  $("#etaProtectedTasks").innerHTML = "";
  setV2FormError("#etaChangeFormError");
  openV2Dialog("#etaChangeDialog", trigger, "#etaChangeDate");
  await previewV2Eta([]);
}

function v2EtaInput(selectedTaskIds = null) {
  const selected = selectedTaskIds || $$("#etaCandidateTasks [data-eta-task]").filter((input) => input.checked).map((input) => Number(input.dataset.etaTask));
  return {
    new_eta_date: $("#etaChangePending").checked ? null : ($("#etaChangeDate").value || null),
    eta_pending: $("#etaChangePending").checked,
    selected_task_ids: [...new Set(selected)].sort((a, b) => a - b),
    actor_label: actorValue($("#etaActorLabel").value),
    expected_version: v2State.etaPlan.version
  };
}

function renderV2EtaPreview(preview, notice = "") {
  $("#etaImpactPreview").innerHTML = `<h3>影响预览</h3>${notice ? `<p><strong>${escapeHtml(notice)}</strong></p>` : ""}<p>原预计 ${escapeHtml(preview.old_eta.current_eta_date || "待确认")} · 漂移 ${escapeHtml(preview.delta_days ?? "—")} 天 · 已选择 ${preview.normalized_input.selected_task_ids.length} 项</p>${v2ConflictHtml(preview.conflicts)}`;
  $("#etaCandidateTasks").innerHTML = preview.eligible_tasks.map((task) => `<label><input type="checkbox" data-eta-task="${task.task_id}"${task.selected ? " checked" : ""}> <span>${escapeHtml(task.title)}：${escapeHtml(task.old_start_date)}～${escapeHtml(task.old_end_date)} → ${escapeHtml(task.new_start_date)}～${escapeHtml(task.new_end_date)}</span></label>`).join("") || "<p>没有符合条件的未开始到样后任务。</p>";
  $("#etaProtectedTasks").innerHTML = preview.protected_tasks.map((task) => `<div><strong>${escapeHtml(task.title)}</strong> · ${escapeHtml(task.reason)}</div>`).join("") || "<div>没有受保护任务。</div>";
}

async function previewV2Eta(selectedTaskIds = null, notice = "") {
  await runV2Busy("preview-eta", async () => {
    const result = await v2Api(`/api/v2/plans/${v2State.etaPlan.id}/eta/preview`, v2Json("POST", v2EtaInput(selectedTaskIds)));
    v2State.etaPreview = result.data;
    renderV2EtaPreview(result.data, notice);
  }, { control: $("#previewEtaChangeBtn"), formError: "#etaChangeFormError", busyText: "预览中…" });
}

async function confirmV2Eta(event) {
  event.preventDefault();
  if (!v2State.etaPreview) return previewV2Eta();
  await runV2Busy("confirm-eta", async () => {
    const input = v2EtaInput();
    try {
      const result = await v2Api(`/api/v2/plans/${v2State.etaPlan.id}/eta/confirm`, v2Json("POST", {
        ...input,
        preview_token: v2State.etaPreview.preview_token,
        acknowledged_conflict_codes: v2ConflictCodes(v2State.etaPreview.conflicts)
      }));
      v2State.etaPlan = result.data.plan;
      closeV2Dialog("#etaChangeDialog");
      showToast(`预计到样已确认，平移 ${result.data.moved_tasks.length} 个任务`);
      await refreshV2AfterPlanChange(result.data.plan.id);
    } catch (error) {
      if (["STALE_PREVIEW", "VERSION_CONFLICT"].includes(error.code)) {
        const fresh = await v2Api(`/api/v2/plans/${v2State.etaPlan.id}`);
        v2State.etaPlan = fresh.data;
        const result = await v2Api(`/api/v2/plans/${v2State.etaPlan.id}/eta/preview`, v2Json("POST", { ...input, expected_version: fresh.data.version }));
        v2State.etaPreview = result.data;
        renderV2EtaPreview(result.data, "数据已变化，请核对新预览并再次确认。");
        setV2FormError("#etaChangeFormError", "数据已变化，本次没有保存；请再次确认。");
        return;
      }
      throw error;
    }
  }, { control: $("#confirmEtaChangeBtn"), formError: "#etaChangeFormError", busyText: "正在确认…" });
}

async function openV2CryostatDialog(planId, trigger) {
  const result = await v2Api(`/api/v2/plans/${planId}`);
  v2State.cryostatPlan = result.data;
  v2State.cryostatPreview = null;
  $("#cryostatChangeForm").reset();
  $("#cryostatChangeSelect").value = result.data.cryostat?.id ? String(result.data.cryostat.id) : "";
  $("#cryostatChangePending").checked = result.data.cryostat_pending;
  $("#cryostatConflictPreview").innerHTML = '<h3>冲突预览</h3><p>选择设备后先预览。</p>';
  setV2FormError("#cryostatChangeFormError");
  openV2Dialog("#cryostatChangeDialog", trigger, "#cryostatChangeSelect");
  await previewV2Cryostat();
}

function v2CryostatInput() {
  return {
    new_cryostat_id: $("#cryostatChangePending").checked ? null : nullableId($("#cryostatChangeSelect").value),
    cryostat_pending: $("#cryostatChangePending").checked,
    actor_label: actorValue($("#cryostatActorLabel").value),
    expected_version: v2State.cryostatPlan.version
  };
}

function renderV2CryostatPreview(preview, notice = "") {
  $("#cryostatConflictPreview").innerHTML = `<h3>冲突预览</h3>${notice ? `<p><strong>${escapeHtml(notice)}</strong></p>` : ""}<p>${escapeHtml(preview.old_cryostat?.name || "待定")} → ${escapeHtml(preview.new_cryostat?.name || "待定")}${preview.plan_date_range ? ` · ${escapeHtml(preview.plan_date_range.start_date)}～${escapeHtml(preview.plan_date_range.end_date)}` : " · 尚无任务日期"}</p>${v2ConflictHtml(preview.conflicts)}`;
}

async function previewV2Cryostat(notice = "") {
  await runV2Busy("preview-cryostat", async () => {
    const result = await v2Api(`/api/v2/plans/${v2State.cryostatPlan.id}/cryostat/preview`, v2Json("POST", v2CryostatInput()));
    v2State.cryostatPreview = result.data;
    renderV2CryostatPreview(result.data, notice);
  }, { control: $("#previewCryostatChangeBtn"), formError: "#cryostatChangeFormError", busyText: "预览中…" });
}

async function confirmV2Cryostat(event) {
  event.preventDefault();
  if (!v2State.cryostatPreview) return previewV2Cryostat();
  await runV2Busy("confirm-cryostat", async () => {
    const input = v2CryostatInput();
    try {
      const result = await v2Api(`/api/v2/plans/${v2State.cryostatPlan.id}/cryostat/confirm`, v2Json("POST", {
        ...input,
        preview_token: v2State.cryostatPreview.preview_token,
        acknowledged_conflict_codes: v2ConflictCodes(v2State.cryostatPreview.conflicts)
      }));
      closeV2Dialog("#cryostatChangeDialog");
      showToast("计划制冷机已确认");
      await refreshV2AfterPlanChange(result.data.plan.id);
    } catch (error) {
      if (["STALE_PREVIEW", "VERSION_CONFLICT"].includes(error.code)) {
        const fresh = await v2Api(`/api/v2/plans/${v2State.cryostatPlan.id}`);
        v2State.cryostatPlan = fresh.data;
        const result = await v2Api(`/api/v2/plans/${fresh.data.id}/cryostat/preview`, v2Json("POST", { ...input, expected_version: fresh.data.version }));
        v2State.cryostatPreview = result.data;
        renderV2CryostatPreview(result.data, "数据已变化，请核对新预览并再次确认。");
        setV2FormError("#cryostatChangeFormError", "数据已变化，本次没有保存；请再次确认。");
        return;
      }
      throw error;
    }
  }, { control: $("#confirmCryostatChangeBtn"), formError: "#cryostatChangeFormError", busyText: "正在确认…" });
}

async function loadV2AssignmentPlan(planId) {
  if (!planId) {
    v2State.assignmentPlan = null;
    $("#assignmentTaskList").innerHTML = '<div class="v2-empty-state"><h3>请选择测控计划</h3><p>选择后由人明确创建并分配任务。</p></div>';
    $("#assignmentConflictSummary").textContent = "选择计划后显示人员负载、日期重叠和制冷机冲突；最终决定由人作出。";
    return;
  }
  const result = await v2Api(`/api/v2/plans/${planId}`);
  v2State.assignmentPlanId = String(planId);
  v2State.assignmentPlan = result.data;
  const tasks = result.data.plan_tasks.filter((task) => !task.deleted_at);
  $("#assignmentTaskList").innerHTML = tasks.length ? tasks.map((task) => renderV2Task(task, result.data)).join("") : $(result.data.test_items.length ? "#assignmentNoTasksTemplate" : "#assignmentNoTestItemsTemplate").innerHTML;
  $("#assignmentConflictSummary").textContent = `计划「${result.data.name}」已有 ${tasks.length} 个正式人工任务；冲突只提示，不自动改派。`;
  $("#openAssignmentBtn").disabled = !result.data.test_items.length;
}

async function openV2AssignmentDialog(planId, trigger, taskId = null) {
  const result = await v2Api(`/api/v2/plans/${planId}`);
  const plan = result.data;
  const task = taskId ? plan.plan_tasks.find((item) => item.id === Number(taskId)) : null;
  v2State.assignmentPlan = plan;
  v2State.assignmentPlanId = String(plan.id);
  v2State.assignmentTaskId = task?.id || null;
  v2State.assignmentPreview = null;
  $("#assignmentForm").reset();
  $("#assignmentDialogTitle").textContent = task ? "编辑人员任务" : "创建人员任务";
  $("#assignmentTestItem").innerHTML = v2Option("", "计划级任务") + plan.test_items.filter((item) => !item.archived).map((item) => v2Option(item.id, item.title, task?.test_item_id === item.id)).join("");
  const members = state.members.filter((item) => item.status === "active" || task?.assignments.some((assignment) => assignment.member_id === item.id));
  $("#assignmentPrimaryMember").innerHTML = v2Option("", "请选择负责人") + members.map((item) => v2Option(item.id, item.name, task?.primary_member?.id === item.id)).join("");
  const collaboratorIds = new Set(task?.collaborators?.map((item) => item.id) || []);
  $("#assignmentCollaborators").innerHTML = members.map((item) => v2Option(item.id, item.name, collaboratorIds.has(item.id))).join("");
  if (task) {
    $("#assignmentTitle").value = task.title;
    $("#assignmentDescription").value = task.description || "";
    $("#assignmentAfterArrival").checked = task.after_arrival;
    $("#assignmentStartDate").value = task.default_start_date;
    $("#assignmentEndDate").value = task.default_end_date;
    $("#assignmentEstimatedHours").value = String(task.estimated_hours);
  } else {
    const start = plan.actual_arrival_date || plan.current_eta_date || todayLocalDate();
    $("#assignmentStartDate").value = start;
    $("#assignmentEndDate").value = start;
    $("#assignmentEstimatedHours").value = "0.5";
  }
  $("#assignmentDialogConflictSummary").innerHTML = '<h3>冲突预览</h3><p>填写后点击预览；系统不会自动指派或改派成员。</p>';
  setV2FormError("#assignmentFormError");
  openV2Dialog("#assignmentDialog", trigger, "#assignmentTitle");
}

function v2AssignmentInput() {
  return {
    test_item_id: nullableId($("#assignmentTestItem").value),
    title: $("#assignmentTitle").value.trim(),
    description: $("#assignmentDescription").value.trim(),
    primary_member_id: Number($("#assignmentPrimaryMember").value),
    collaborator_member_ids: [...$("#assignmentCollaborators").selectedOptions].map((option) => Number(option.value)).filter((id) => id !== Number($("#assignmentPrimaryMember").value)).sort((a, b) => a - b),
    start_date: $("#assignmentStartDate").value,
    end_date: $("#assignmentEndDate").value,
    estimated_hours: Number($("#assignmentEstimatedHours").value),
    after_arrival: $("#assignmentAfterArrival").checked,
    expected_version: v2State.assignmentPlan.version
  };
}

function renderV2AssignmentPreview(preview, notice = "") {
  const load = preview.related_load.flatMap((member) => member.weeks.map((week) => `成员 ${member.member_id} ${week.week_start}: ${week.hours_before}h → ${week.hours_after}h`));
  $("#assignmentDialogConflictSummary").innerHTML = `<h3>冲突预览</h3>${notice ? `<p><strong>${escapeHtml(notice)}</strong></p>` : ""}${v2ConflictHtml(preview.conflicts)}${load.length ? `<p>${load.map(escapeHtml).join("；")}</p>` : ""}`;
}

async function previewV2Assignment(notice = "") {
  await runV2Busy("preview-assignment", async () => {
    const path = v2State.assignmentTaskId ? `/api/v2/plan-tasks/${v2State.assignmentTaskId}/preview` : `/api/v2/plans/${v2State.assignmentPlan.id}/tasks/preview`;
    const result = await v2Api(path, v2Json("POST", v2AssignmentInput()));
    v2State.assignmentPreview = result.data;
    renderV2AssignmentPreview(result.data, notice);
  }, { control: $("#previewAssignmentBtn"), formError: "#assignmentFormError", busyText: "预览中…" });
}

async function confirmV2Assignment(event) {
  event.preventDefault();
  if (!v2State.assignmentPreview) {
    await previewV2Assignment("请核对预览后再次点击人工确认。");
    return;
  }
  await runV2Busy("confirm-assignment", async () => {
    const input = v2AssignmentInput();
    const path = v2State.assignmentTaskId ? `/api/v2/plan-tasks/${v2State.assignmentTaskId}` : `/api/v2/plans/${v2State.assignmentPlan.id}/tasks`;
    const method = v2State.assignmentTaskId ? "PUT" : "POST";
    try {
      const result = await v2Api(path, v2Json(method, {
        ...input,
        preview_token: v2State.assignmentPreview.preview_token,
        acknowledged_conflict_codes: v2ConflictCodes(v2State.assignmentPreview.conflicts),
        actor_label: "本地用户"
      }));
      const planId = result.data.plan_task.plan_id;
      closeV2Dialog("#assignmentDialog");
      showToast(v2State.assignmentTaskId ? "人工任务已更新" : "人工任务已创建");
      await refreshV2AfterPlanChange(planId, { reloadV1: true });
      await loadV2AssignmentPlan(planId);
    } catch (error) {
      if (["STALE_PREVIEW", "VERSION_CONFLICT"].includes(error.code)) {
        const fresh = await v2Api(`/api/v2/plans/${v2State.assignmentPlan.id}`);
        v2State.assignmentPlan = fresh.data;
        v2State.assignmentPreview = null;
        await previewV2Assignment("数据已变化，请核对新预览并再次确认。");
        setV2FormError("#assignmentFormError", "数据已变化，本次没有保存；请再次确认。");
        return;
      }
      throw error;
    }
  }, { control: $("#saveAssignmentBtn"), formError: "#assignmentFormError", busyText: "正在确认…" });
}

async function openV2SubmissionDialog(taskId, planId, trigger) {
  const result = await v2Api(`/api/v2/plans/${planId}`);
  const task = result.data.plan_tasks.find((item) => item.id === Number(taskId));
  if (!task) throw new Error("任务不存在或已删除");
  v2State.submissionTask = task;
  v2State.submissionPlan = result.data;
  $("#submissionForm").reset();
  setV2FormError("#submissionFormError");
  $("#submissionChecklist").innerHTML = result.data.acceptance_template.items.map((item) => `<label><input type="checkbox" data-submission-template-item="${item.id}"> <span>${escapeHtml(item.label)}</span></label>`).join("");
  openV2Dialog("#submissionDialog", trigger, "#submissionDescription");
}

async function saveV2Submission(event) {
  event.preventDefault();
  await runV2Busy("save-submission", async () => {
    const resourceKind = $("#submissionResourceKind").value;
    const resourceValue = $("#submissionResourceValue").value.trim();
    if (resourceKind === "url") {
      let parsed;
      try { parsed = new URL(resourceValue); } catch { throw new Error("请输入有效的 HTTP/HTTPS URL。"); }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("成果 URL 只允许 HTTP/HTTPS 协议。");
    }
    const latest = v2State.submissionPlan.latest_submissions.find((item) => item.task_lineage_key === v2State.submissionTask.task_lineage_key);
    const payload = {
      description: $("#submissionDescription").value.trim(),
      submitter_label: actorValue($("#submissionSubmitter").value),
      resource_kind: resourceKind,
      resource_value: resourceValue,
      checklist: $$("#submissionChecklist [data-submission-template-item]").map((input) => ({ template_item_id: Number(input.dataset.submissionTemplateItem), checked: input.checked })),
      supersedes_submission_id: latest?.status === "returned" ? latest.id : null
    };
    await v2Api(`/api/v2/tasks/${v2State.submissionTask.id}/submissions`, v2Json("POST", payload));
    const planId = v2State.submissionPlan.id;
    closeV2Dialog("#submissionDialog");
    showToast("成果已提交，等待人工验收");
    await refreshV2AfterPlanChange(planId, { reloadV1: true });
    await loadV2Submissions();
  }, { control: $("#saveSubmissionBtn"), formError: "#submissionFormError", busyText: "正在提交…" });
}

async function openV2ReviewDialog(submissionId, trigger) {
  let submission = null;
  for (const plan of v2State.allPlans) {
    const result = await v2Api(`/api/v2/plans/${plan.id}/submissions?limit=200&sort=submitted_desc`);
    submission = result.data.find((item) => item.id === Number(submissionId));
    if (submission) break;
  }
  if (!submission) throw new Error("成果记录不存在");
  v2State.reviewSubmission = submission;
  $("#reviewForm").reset();
  setV2FormError("#reviewFormError");
  $("#reviewChecklist").innerHTML = submission.checklist_snapshot.map((item) => `<div><label><input type="checkbox" data-review-template-item="${item.template_item_id}"> <span>${escapeHtml(item.label)}</span></label><input type="text" data-review-note="${item.template_item_id}" maxlength="1000" placeholder="可选备注"></div>`).join("");
  openV2Dialog("#reviewDialog", trigger, "#reviewDecision");
}

async function saveV2Review(event) {
  event.preventDefault();
  await runV2Busy("save-review", async () => {
    const decision = $("#reviewDecision").value;
    if (!decision) throw new Error("请选择通过或退回。");
    const checks = $$("#reviewChecklist [data-review-template-item]");
    if (decision === "accepted" && checks.some((input) => !input.checked)) throw new Error("通过验收前必须确认全部清单项。");
    const payload = {
      decision,
      reviewer_label: actorValue($("#reviewerLabel").value),
      comment: $("#reviewComment").value.trim(),
      checklist: checks.map((input) => ({
        template_item_id: Number(input.dataset.reviewTemplateItem),
        passed: input.checked,
        note: $(`[data-review-note="${input.dataset.reviewTemplateItem}"]`)?.value.trim() || ""
      })),
      expected_version: v2State.reviewSubmission.version
    };
    if (decision === "returned" && !payload.comment) throw new Error("退回时必须填写意见。");
    const result = await v2Api(`/api/v2/submissions/${v2State.reviewSubmission.id}/review`, v2Json("POST", payload));
    const planId = result.data.submission.plan_id;
    closeV2Dialog("#reviewDialog");
    showToast(decision === "accepted" ? "成果已人工验收通过" : "成果已退回，任务恢复执行");
    await refreshV2AfterPlanChange(planId, { reloadV1: true });
    await loadV2Submissions();
  }, { control: $("#saveReviewBtn"), formError: "#reviewFormError", busyText: "正在记录…" });
}

async function loadV2Submissions() {
  const selectedPlan = v2State.acceptancePlanId;
  const planRows = selectedPlan
    ? v2State.allPlans.filter((plan) => String(plan.id) === String(selectedPlan))
    : v2State.allPlans.filter((plan) => !plan.archived);
  const rows = [];
  for (const plan of planRows) {
    const params = new URLSearchParams({ limit: "200", sort: "submitted_desc" });
    if (v2State.submissionStatus) params.set("status", v2State.submissionStatus);
    const result = await v2Api(`/api/v2/plans/${plan.id}/submissions?${params}`);
    rows.push(...result.data.map((submission) => ({ submission, plan })));
  }
  rows.sort((a, b) => b.submission.submitted_at.localeCompare(a.submission.submitted_at) || b.submission.id - a.submission.id);
  $("#submissionList").innerHTML = rows.map(({ submission, plan }) => renderV2SubmissionCard(submission, plan.name)).join("");
  const empty = $("#acceptanceEmptyState");
  empty.hidden = rows.length > 0 || Boolean(selectedPlan || v2State.submissionStatus);
  if (!rows.length && (selectedPlan || v2State.submissionStatus)) $("#submissionList").innerHTML = $("#acceptanceFilterEmptyTemplate").innerHTML;
}

async function refreshV2AfterPlanChange(planId, { reloadV1 = false } = {}) {
  await loadV2Plans();
  if (reloadV1) await loadData();
  updateV2DocumentTitle();
  if (v2State.activePlanId === Number(planId)) {
    const result = await v2Api(`/api/v2/plans/${planId}`);
    v2State.activePlan = result.data;
    renderV2PlanDetail(result.data);
  }
}

async function toggleV2PlanArchive(planId, restore, trigger) {
  const result = await v2Api(`/api/v2/plans/${planId}`);
  if (!window.confirm(`确认${restore ? "恢复" : "归档"}计划「${result.data.name}」？`)) return;
  await runV2Busy(`archive-plan-${planId}`, async () => {
    const changed = await v2Api(`/api/v2/plans/${planId}/${restore ? "restore" : "archive"}`, v2Json("POST", { actor_label: "本地用户", expected_version: result.data.version }));
    showToast(restore ? "计划已恢复" : "计划已归档");
    await refreshV2AfterPlanChange(changed.data.plan.id);
  }, { control: trigger, busyText: restore ? "恢复中…" : "归档中…" });
}

async function confirmV2Arrival(planId, trigger) {
  const result = await v2Api(`/api/v2/plans/${planId}`);
  const plan = result.data;
  const date = window.prompt("实际到样日期（YYYY-MM-DD）", plan.actual_arrival_date || todayLocalDate());
  if (date === null) return;
  const identifier = window.prompt("样品编号（可留空）", plan.sample_identifier || "");
  if (identifier === null) return;
  let kind = plan.identifier_kind;
  if (identifier.trim() && !kind) {
    const input = window.prompt("编号类型：输入 formal 或 temporary", "temporary");
    if (input === null) return;
    kind = input.trim();
  }
  await runV2Busy(`arrival-${planId}`, async () => {
    const changed = await v2Api(`/api/v2/plans/${planId}/arrival`, v2Json("POST", {
      actual_arrival_date: date.trim(),
      sample_identifier: nullableText(identifier),
      identifier_kind: identifier.trim() ? kind : null,
      actor_label: "本地用户",
      expected_version: plan.version
    }));
    showToast("实际到样已记录；未测试时主状态保持空白");
    await refreshV2AfterPlanChange(changed.data.plan.id);
  }, { control: trigger, busyText: "记录中…" });
}

async function addV2TestItem(planId, trigger) {
  const result = await v2Api(`/api/v2/plans/${planId}`);
  const title = window.prompt("测试项名称");
  if (!title?.trim()) return;
  const criteria = window.prompt("验收标准（可留空）", "");
  if (criteria === null) return;
  await runV2Busy(`add-test-item-${planId}`, async () => {
    await v2Api(`/api/v2/plans/${planId}/test-items`, v2Json("POST", { title: title.trim(), description: "", acceptance_criteria: criteria.trim(), is_required: true, position: result.data.test_items.length, actor_label: "本地用户", expected_version: result.data.version }));
    showToast("测试项已添加");
    await refreshV2AfterPlanChange(planId);
  }, { control: trigger, busyText: "添加中…" });
}

async function editV2TestItem(itemId, planId, trigger) {
  const result = await v2Api(`/api/v2/plans/${planId}`);
  const item = result.data.test_items.find((row) => row.id === Number(itemId));
  if (!item) return;
  const title = window.prompt("测试项名称", item.title);
  if (!title?.trim()) return;
  const criteria = window.prompt("验收标准", item.acceptance_criteria || "");
  if (criteria === null) return;
  await runV2Busy(`edit-test-item-${itemId}`, async () => {
    await v2Api(`/api/v2/test-items/${itemId}`, v2Json("PUT", { title: title.trim(), description: item.description || "", acceptance_criteria: criteria.trim(), is_required: Boolean(item.is_required), position: item.position, archived: Boolean(item.archived), actor_label: "本地用户", expected_version: result.data.version }));
    showToast("测试项已更新");
    await refreshV2AfterPlanChange(planId);
  }, { control: trigger, busyText: "保存中…" });
}

async function editV2AcceptanceTemplate(planId, trigger) {
  const [result, planResult] = await Promise.all([
    v2Api(`/api/v2/plans/${planId}/acceptance-template`),
    v2Api(`/api/v2/plans/${planId}`)
  ]);
  const template = result.data;
  const labels = window.prompt("验收清单（每行一项）", template.items.map((item) => item.label).join("\n"));
  if (labels === null) return;
  const items = labels.split(/\r?\n/).map((label) => label.trim()).filter(Boolean).map((label, position) => ({ label, position }));
  if (!items.length) return showToast("验收清单至少包含一项", { type: "error" });
  await runV2Busy(`template-${planId}`, async () => {
    await v2Api(`/api/v2/plans/${planId}/acceptance-template`, v2Json("PUT", { name: template.name, items, actor_label: "本地用户", expected_version: planResult.data.version }));
    showToast("验收模板已生成新版本");
    await refreshV2AfterPlanChange(planId);
  }, { control: trigger, busyText: "保存中…" });
}

function clearV2PlanFilters() {
  Object.assign(v2State, { search: "", displayStatus: "", sourceGroupId: "", cryostatId: "", primaryMemberId: "", includeArchived: false });
  syncV2Controls();
  saveV2Preferences();
  return loadV2Plans();
}

let v2SearchTimer = null;

function bindV2Events() {
  $$('[data-v2-view]').forEach((tab) => tab.addEventListener("click", () => setV2View(tab.dataset.v2View)));
  $$('[data-execution-view]').forEach((tab) => tab.addEventListener("click", () => {
    v2State.executionView = tab.dataset.executionView;
    saveV2Preferences();
  }));
  $$('[data-management-view]').forEach((tab) => tab.addEventListener("click", () => {
    v2State.managementView = tab.dataset.managementView;
    saveV2Preferences();
  }));
  $("#dataMenuBtn").addEventListener("click", () => {
    v2State.managementView = "maintenance";
    setV2View("management");
  });
  $("#refreshBtn").addEventListener("click", (event) => runV2Busy("v2-refresh", loadV2Workspace, { control: event.currentTarget, busyText: "刷新中…" }));
  $("#planSearchInput").addEventListener("input", (event) => {
    v2State.search = event.target.value.trim();
    saveV2Preferences();
    window.clearTimeout(v2SearchTimer);
    v2SearchTimer = window.setTimeout(() => loadV2Plans().catch((error) => showToast(v2ErrorText(error), { type: "error" })), 250);
  });
  for (const [id, key] of [["#planStatusFilter", "displayStatus"], ["#planSourceFilter", "sourceGroupId"], ["#planCryostatFilter", "cryostatId"], ["#planOwnerFilter", "primaryMemberId"], ["#planGroupBy", "groupBy"]]) {
    $(id).addEventListener("change", async (event) => {
      v2State[key] = event.target.value;
      saveV2Preferences();
      await loadV2Plans();
    });
  }
  $("#arrivalWindowDays").addEventListener("change", async (event) => {
    const value = clamp(Number.parseInt(event.target.value, 10) || 0, 0, 365);
    v2State.arrivalWindowDays = value;
    event.target.value = String(value);
    saveV2Preferences();
    await loadV2Plans();
  });
  $("#planIncludeArchived").addEventListener("change", async (event) => {
    v2State.includeArchived = event.target.checked;
    saveV2Preferences();
    await loadV2Plans();
  });
  $$("#planStats [data-plan-status]").forEach((card) => card.addEventListener("click", async () => {
    v2State.displayStatus = v2State.displayStatus === card.dataset.planStatus ? "" : card.dataset.planStatus;
    $("#planStatusFilter").value = v2State.displayStatus;
    saveV2Preferences();
    await loadV2Plans();
  }));
  $("#assignmentPlanFilter").addEventListener("change", async (event) => {
    v2State.assignmentPlanId = event.target.value;
    await loadV2AssignmentPlan(event.target.value);
  });
  $("#acceptancePlanFilter").addEventListener("change", async (event) => {
    v2State.acceptancePlanId = event.target.value;
    await loadV2Submissions();
  });
  $("#submissionStatusFilter").addEventListener("change", async (event) => {
    v2State.submissionStatus = event.target.value;
    await loadV2Submissions();
  });
  $("#openAssignmentBtn").addEventListener("click", (event) => openV2AssignmentDialog(v2State.assignmentPlanId, event.currentTarget));
  $("#closePlanDetailBtn").addEventListener("click", () => closeV2PlanDetail());
  $("#addPlanTestItemBtn").addEventListener("click", addV2PlanDraft);
  $("#planSourceGroup").addEventListener("change", (event) => fillV2Contacts(event.target.value));
  $("#planEtaPending").addEventListener("change", (event) => {
    $("#planEtaDate").disabled = event.target.checked;
    if (event.target.checked) $("#planEtaDate").value = "";
  });
  $("#planCryostatPending").addEventListener("change", (event) => {
    $("#planCryostat").disabled = event.target.checked;
    if (event.target.checked) $("#planCryostat").value = "";
  });
  $("#resourceType").addEventListener("change", () => {
    v2State.resourceEdit = { kind: $("#resourceType").value, id: null, sourceGroupId: null, item: null };
    syncV2ResourceFields();
  });
  $("#previewEtaChangeBtn").addEventListener("click", () => previewV2Eta());
  $("#previewCryostatChangeBtn").addEventListener("click", () => previewV2Cryostat());
  $("#previewAssignmentBtn").addEventListener("click", () => previewV2Assignment());
  $("#etaChangePending").addEventListener("change", (event) => {
    $("#etaChangeDate").disabled = event.target.checked;
    if (event.target.checked) $("#etaChangeDate").value = "";
    v2State.etaPreview = null;
  });
  $("#cryostatChangePending").addEventListener("change", (event) => {
    $("#cryostatChangeSelect").disabled = event.target.checked;
    if (event.target.checked) $("#cryostatChangeSelect").value = "";
    v2State.cryostatPreview = null;
  });
  $("#etaChangeDate").addEventListener("input", () => { v2State.etaPreview = null; });
  $("#etaActorLabel").addEventListener("input", () => { v2State.etaPreview = null; });
  $("#cryostatChangeSelect").addEventListener("change", () => { v2State.cryostatPreview = null; });
  $("#cryostatActorLabel").addEventListener("input", () => { v2State.cryostatPreview = null; });
  $("#assignmentForm").addEventListener("input", (event) => {
    if (!event.target.closest("#previewAssignmentBtn, #saveAssignmentBtn")) v2State.assignmentPreview = null;
  });
  $("#assignmentForm").addEventListener("change", () => { v2State.assignmentPreview = null; });
  $("#planForm").addEventListener("submit", saveV2Plan);
  $("#etaChangeForm").addEventListener("submit", confirmV2Eta);
  $("#cryostatChangeForm").addEventListener("submit", confirmV2Cryostat);
  $("#assignmentForm").addEventListener("submit", confirmV2Assignment);
  $("#submissionForm").addEventListener("submit", saveV2Submission);
  $("#reviewForm").addEventListener("submit", saveV2Review);
  $("#resourceForm").addEventListener("submit", saveV2Resource);
  const dialogBindings = [
    ["#planDialog", "#closePlanDialogBtn", "#cancelPlanBtn"],
    ["#etaChangeDialog", "#closeEtaChangeDialogBtn", "#cancelEtaChangeBtn"],
    ["#cryostatChangeDialog", "#closeCryostatChangeDialogBtn", "#cancelCryostatChangeBtn"],
    ["#assignmentDialog", "#closeAssignmentDialogBtn", "#cancelAssignmentBtn"],
    ["#submissionDialog", "#closeSubmissionDialogBtn", "#cancelSubmissionBtn"],
    ["#reviewDialog", "#closeReviewDialogBtn", "#cancelReviewBtn"],
    ["#resourceDialog", "#closeResourceDialogBtn", "#cancelResourceBtn"]
  ];
  for (const [dialogId, ...buttons] of dialogBindings) {
    buttons.forEach((buttonId) => $(buttonId).addEventListener("click", () => closeV2Dialog(dialogId)));
    $(dialogId).addEventListener("cancel", (event) => {
      event.preventDefault();
      closeV2Dialog(dialogId);
    });
  }
  document.body.addEventListener("change", async (event) => {
    const etaTask = event.target.closest("[data-eta-task]");
    if (etaTask) await previewV2Eta();
  });
  document.body.addEventListener("click", async (event) => {
    const action = (selector) => event.target.closest(selector);
    if (action("[data-open-plan-dialog]")) {
      const planId = action("[data-open-plan-dialog]").dataset.planId || v2State.assignmentPlanId;
      const plan = planId ? (await v2Api(`/api/v2/plans/${planId}`)).data : null;
      await openV2PlanDialog(plan, action("[data-open-plan-dialog]"));
      return;
    }
    if (action("[data-clear-plan-filters]")) return clearV2PlanFilters();
    if (action("[data-clear-submission-filters]")) {
      v2State.acceptancePlanId = "";
      v2State.submissionStatus = "";
      $("#acceptancePlanFilter").value = "";
      $("#submissionStatusFilter").value = "";
      return loadV2Submissions();
    }
    if (action("[data-open-plan-detail]")) return openV2PlanDetail(action("[data-open-plan-detail]").dataset.openPlanDetail, action("[data-open-plan-detail]"));
    if (action("[data-edit-plan]")) {
      const result = await v2Api(`/api/v2/plans/${action("[data-edit-plan]").dataset.editPlan}`);
      return openV2PlanDialog(result.data, action("[data-edit-plan]"));
    }
    if (action("[data-open-eta-change]")) return openV2EtaDialog(action("[data-open-eta-change]").dataset.openEtaChange, action("[data-open-eta-change]"));
    if (action("[data-open-cryostat-change]")) return openV2CryostatDialog(action("[data-open-cryostat-change]").dataset.openCryostatChange, action("[data-open-cryostat-change]"));
    if (action("[data-open-assignment-dialog]")) return openV2AssignmentDialog(action("[data-open-assignment-dialog]").dataset.planId || v2State.assignmentPlanId || v2State.activePlanId, action("[data-open-assignment-dialog]"));
    if (action("[data-edit-plan-task]")) return openV2AssignmentDialog(action("[data-edit-plan-task]").dataset.planId, action("[data-edit-plan-task]"), action("[data-edit-plan-task]").dataset.editPlanTask);
    if (action("[data-open-submission]")) return openV2SubmissionDialog(action("[data-open-submission]").dataset.openSubmission, action("[data-open-submission]").dataset.planId, action("[data-open-submission]"));
    if (action("[data-open-review]")) return openV2ReviewDialog(action("[data-open-review]").dataset.openReview, action("[data-open-review]"));
    if (action("[data-open-resource-dialog]")) return openV2ResourceDialog(action("[data-open-resource-dialog]").dataset.openResourceDialog, action("[data-open-resource-dialog]"), { sourceGroupId: action("[data-open-resource-dialog]").dataset.sourceGroupId });
    if (action("[data-edit-resource]")) return openV2ResourceDialog(action("[data-edit-resource]").dataset.editResource, action("[data-edit-resource]"), { id: action("[data-edit-resource]").dataset.resourceId, sourceGroupId: action("[data-edit-resource]").dataset.sourceGroupId });
    if (action("[data-remove-plan-draft]")) {
      v2State.planDraftItems.splice(Number(action("[data-remove-plan-draft]").dataset.removePlanDraft), 1);
      v2State.planDraftItems.forEach((item, index) => { item.position = index; });
      return renderV2PlanDraftItems();
    }
    if (action("[data-toggle-plan-archive]")) return toggleV2PlanArchive(action("[data-toggle-plan-archive]").dataset.togglePlanArchive, action("[data-toggle-plan-archive]").dataset.restore === "1", action("[data-toggle-plan-archive]"));
    if (action("[data-confirm-arrival]")) return confirmV2Arrival(action("[data-confirm-arrival]").dataset.confirmArrival, action("[data-confirm-arrival]"));
    if (action("[data-add-test-item]")) return addV2TestItem(action("[data-add-test-item]").dataset.addTestItem, action("[data-add-test-item]"));
    if (action("[data-edit-test-item]")) return editV2TestItem(action("[data-edit-test-item]").dataset.editTestItem, action("[data-edit-test-item]").dataset.planId, action("[data-edit-test-item]"));
    if (action("[data-edit-acceptance-template]")) return editV2AcceptanceTemplate(action("[data-edit-acceptance-template]").dataset.editAcceptanceTemplate, action("[data-edit-acceptance-template]"));
  });
}

bindEvents();
bindV2Events();
setDefaultDates();
renderViewState();
renderSelection();
setV2View(v2State.activeV2View);
loadData()
  .then(loadV2Workspace)
  .catch((error) => showToast(v2ErrorText(error), { type: "error" }));

/* Topic/sample/task-chain client surface. It keeps the V1/V2 compatibility
   data and APIs intact; all writes still go through human preview/confirm
   endpoints. */
const v3State = {
  mode: "topic", activeView: "workbench", topics: [], groups: [], cryostats: [], members: [],
  topic: null, samples: [], tasks: [], submissions: [], template: null,
  topicDetails: new Map(), activeSampleId: null, activeTaskId: null, activeSubmissionId: null,
  taskEditId: null, taskEditVersion: null,
  preview: null, taskDraftMembers: [], editMembers: [], returnFocus: new Map(), busy: new Set(),
  search: "", status: "", source: "", cryostat: "", groupBy: "none", windowDays: 7, includeArchived: false, onlyPending: false, workbenchFocus: "",
  acceptanceStatus: "", assignmentTopicId: "", topicDetailReturnFocus: null, topicDetailReturnView: null,
  taskOrderBusy: false, taskOrderNotice: "", topicEditId: null, sampleEditId: null
};

function v3ErrorText(error) {
  return error?.message || error?.details?.reason || "专题操作失败";
}

async function v3Api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = payload?.error && typeof payload.error === "object" ? payload.error : payload;
    const error = new Error(detail?.message || detail?.error || "请求失败");
    error.code = detail?.code || payload?.code || "REQUEST_FAILED";
    error.details = detail?.details || payload?.details || {};
    error.status = response.status;
    throw error;
  }
  return payload;
}

function v3Json(method, body) { return { method, body: JSON.stringify(body) }; }
function v3Today() { return todayLocalDate(); }
function v3Esc(value) { return escapeHtml(value ?? ""); }
function v3Group(id) { return v3State.groups.find((item) => Number(item.id) === Number(id)); }
function v3Cryostat(id) { return v3State.cryostats.find((item) => Number(item.id) === Number(id)); }
function v3Member(id) { return v3State.members.find((item) => Number(item.id) === Number(id)); }
function v3RebuildExecutionTaskIndex() {
  state.v3ExecutionTaskIndex.clear();
  v3State.topicDetails.forEach((detail) => {
    const samplesById = new Map((detail.samples || []).map((sample) => [Number(sample.id), sample]));
    (detail.tasks || []).forEach((task) => {
      const legacyTaskId = Number(task.task_id);
      if (!Number.isFinite(legacyTaskId)) return;
      const topic = task.topic || detail.topic || {};
      const samples = (task.samples || []).map((sample) => ({ ...(samplesById.get(Number(sample.id)) || {}), ...sample }));
      state.v3ExecutionTaskIndex.set(legacyTaskId, {
        ...task,
        topic,
        source_group: task.source_group || v3Group(topic.source_group_id) || {},
        cryostat: task.cryostat || v3Cryostat(task.cryostat_id) || {},
        samples
      });
    });
  });
}
function v3Open(dialog, trigger = document.activeElement) {
  if (!dialog) return;
  v3State.returnFocus.set(dialog.id, trigger instanceof HTMLElement ? trigger : null);
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => (dialog.querySelector("[autofocus]") || dialog.querySelector("input,select,textarea,button"))?.focus(), 0);
}
function v3Close(dialog) {
  if (!dialog) return;
  const trigger = v3State.returnFocus.get(dialog.id);
  if (dialog.open) dialog.close();
  if (trigger?.isConnected) trigger.focus();
  v3State.returnFocus.delete(dialog.id);
}
function v3RenderTopicDetail() {
  const pane = $("#v3TopicDetailPane"), topic = v3State.topic;
  if (!pane || !topic) return;
  $("#v3TopicDetailTitle").textContent = topic.name;
  $("#v3TopicSampleDetailList").innerHTML = v3State.samples.length
    ? v3State.samples.map((sample) => `<div><strong>${v3Esc(sample.planning_label)}</strong><span>${v3Esc(sample.model)} · ${sample.eta_pending ? "ETA 待确认" : `ETA ${v3Esc(sample.current_eta_date || "—")}`}</span></div>`).join("")
    : "<p>暂无样品。</p>";
  $("#v3TopicTaskDetailList").innerHTML = v3State.tasks.length
    ? v3State.tasks.map((task) => `<div><strong>${v3Esc(task.title)}</strong><span>${task.is_required === 0 ? "可选" : "必做"} · ${v3StatusMarkup(task.display_status)}</span></div>`).join("")
    : "<p>暂无连续任务。</p>";
}
function v3OpenTopicDetail(trigger, returnView = v3State.activeView) {
  const pane = $("#v3TopicDetailPane");
  if (!pane || !v3State.topic) return;
  v3RenderTopicDetail();
  v3State.topicDetailReturnFocus = trigger instanceof HTMLElement ? trigger : null;
  v3State.topicDetailReturnView = returnView;
  pane.hidden = false;
  pane.classList.add("is-open");
  window.setTimeout(() => $("#v3CloseTopicDetailBtn")?.focus(), 0);
}
function v3CloseTopicDetail({ restoreFocus = true } = {}) {
  const pane = $("#v3TopicDetailPane"), trigger = v3State.topicDetailReturnFocus, returnView = v3State.topicDetailReturnView;
  if (!pane) return;
  pane.hidden = true;
  pane.classList.remove("is-open");
  v3State.topicDetailReturnFocus = null;
  v3State.topicDetailReturnView = null;
  if (restoreFocus && returnView && returnView !== v3State.activeView) {
    setV2View(returnView);
    v3SetView(returnView);
  }
  if (restoreFocus && trigger?.isConnected && !trigger.closest("[hidden]")) trigger.focus();
}
function v3SetBusy(key, busy) { if (busy) v3State.busy.add(key); else v3State.busy.delete(key); }
function v3FormError(id, error = null) { const node = $(id); if (!node) return; node.hidden = !error; node.textContent = error ? v3ErrorText(error) : ""; }
function v3TopicStatus(detail) {
  const tasks = detail.tasks || [], samples = detail.samples || [];
  const requiredTasks = tasks.filter((task) => task.is_required !== 0);
  if (requiredTasks.length && requiredTasks.every((task) => task.display_status === "completed")) return "completed";
  if (tasks.some((task) => task.display_status === "active")) return "testing";
  const pendingSamples = samples.filter((sample) => !sample.actual_arrival_date);
  // Arrival is a fact, not a workflow state. Once every sample has arrived and
  // no task has started, the topic intentionally has no visible primary chip.
  if (samples.length && !pendingSamples.length) return null;
  if (pendingSamples.some((sample) => sample.eta_pending || !sample.current_eta_date)) return "time_pending";
  const today = v3Today();
  if (pendingSamples.some((sample) => sample.current_eta_date < today)) return "delayed";
  if (pendingSamples.some((sample) => sample.current_eta_date <= addDays(today, v3State.windowDays))) return "arriving_within_window";
  return samples.length ? "arriving_outside_window" : "time_pending";
}
function v3StatusLabel(status) { if (!status) return ""; return ({ testing: "测试中", delayed: "延期", arriving_within_window: "规定时间内到来", arriving_outside_window: "规定时间外到来", time_pending: "ETA 待确认", completed: "已完成", active: "测试中", planned: "待规划", paused: "已暂停", cancelled: "已取消", submitted: "待验收", accepted: "已通过", returned: "已退回" }[status] || "待规划"); }
function v3StatusClass(status) { return `v3-status-${status || "pending"}`; }
function v3StatusMarkup(status, { blankText = "实际到样，尚未开始测试" } = {}) {
  return status ? `<span class="v3-status-chip ${v3StatusClass(status)}">${v3Esc(v3StatusLabel(status))}</span>` : `<span class="visually-hidden">${v3Esc(blankText)}</span>`;
}

async function v3LoadMembers() {
  const result = await api("/api/members");
  v3State.members = Array.isArray(result) ? result.filter((m) => m.status === "active") : [];
}
async function v3LoadTopics() {
  const params = new URLSearchParams();
  if (v3State.search) params.set("search", v3State.search);
  if (v3State.includeArchived) params.set("include_archived", "1");
  const result = (await v3Api(`/api/v3/topics${params.toString() ? `?${params}` : ""}`)).data || {};
  v3State.topics = result.items || [];
  v3State.groups = result.groups || [];
  v3State.cryostats = result.cryostats || [];
  await Promise.all(v3State.topics.map(async (topic) => {
    try {
      const [samples, tasks, submissions, events] = await Promise.all([
        v3Api(`/api/v3/topics/${topic.id}/samples`), v3Api(`/api/v3/topics/${topic.id}/tasks`), v3Api(`/api/v3/topics/${topic.id}/submissions`), v3Api(`/api/v3/topics/${topic.id}/events`)
      ]);
      v3State.topicDetails.set(topic.id, { topic, samples: samples.data?.items || [], tasks: tasks.data?.items || [], submissions: submissions.data?.items || [], events: events.data?.items || [] });
    } catch { v3State.topicDetails.set(topic.id, { topic, samples: [], tasks: [], submissions: [], events: [] }); }
  }));
  v3RebuildExecutionTaskIndex();
  renderTasks();
  renderDetail();
  v3RenderTopicList();
  v3RenderTopics();
  v3RenderWorkbenchOverview();
  v3FillResourceSelects();
}
function v3FillSelect(id, items, label = (item) => item.name, empty = "请选择") {
  const select = $(id); if (!select) return;
  const value = select.value; select.innerHTML = `<option value="">${empty}</option>` + items.map((item) => `<option value="${v3Esc(item.id)}">${v3Esc(label(item))}</option>`).join("");
  if ([...select.options].some((option) => option.value === value)) select.value = value;
}
function v3FillResourceSelects() {
  v3FillSelect("#v3TopicSourceGroup", v3State.groups.filter((g) => g.is_active !== 0), (item) => item.name, "请选择来源小组");
  v3FillSelect("#v3TopicDefaultCryostatInput", v3State.cryostats.filter((c) => c.status === "active"), (item) => item.name, "不设默认值");
  v3FillSelect("#v3CryostatSelect", v3State.cryostats.filter((c) => c.status === "active"), (item) => item.name, "请选择制冷机");
  v3FillSelect("#v3TaskCryostat", v3State.cryostats.filter((c) => c.status === "active"), (item) => item.name, "请选择制冷机");
  v3FillSelect("#v3TopicCryostatFilter", v3State.cryostats.filter((c) => c.status === "active"), (item) => item.name, "全部制冷机");
  v3FillSelect("#v3AssignmentTopicFilter", v3State.topics, (item) => item.name, "请选择专题");
  v3FillSelect("#v3AcceptanceTopicFilter", v3State.topics, (item) => item.name, "全部专题");
  const source = $("#v3TopicSourceFilter"); if (source) { const value = source.value; source.innerHTML = "<option value=''>全部来源</option>" + v3State.groups.map((g) => `<option value="${v3Esc(g.id)}">${v3Esc(g.name)}</option>`).join(""); if ([...source.options].some((o) => o.value === value)) source.value = value; }
}
async function v3FillContacts(groupId) {
  const select = $("#v3TopicContact"); if (!select) return;
  if (!groupId) { select.innerHTML = "<option value=''>稍后补充</option>"; return; }
  try { const result = await v2Api(`/api/v2/source-groups/${groupId}/contacts`); const rows = result.data || []; select.innerHTML = "<option value=''>稍后补充</option>" + rows.map((row) => `<option value="${row.id}">${v3Esc(row.name)}</option>`).join(""); } catch (error) { select.innerHTML = "<option value=''>稍后补充</option>"; showToast(v3ErrorText(error), { type: "error" }); }
}
function v3RenderTopicList() {
  const list = $("#v3TopicList"); if (!list) return;
  const topics = v3State.topics || [];
  const count = $("#v3TopicListCount"); if (count) count.textContent = `${topics.length}`;
  if (!topics.length) {
    list.innerHTML = "<div class='v3-empty-state compact'><p>当前还没有专题，请从新建专题开始。</p></div>";
    return;
  }
  const activeId = v3State.topic ? Number(v3State.topic.id) : null;
  list.innerHTML = topics.map((topic) => {
    const detail = v3State.topicDetails.get(topic.id);
    const status = detail ? v3TopicStatus(detail) : null;
    const active = activeId === Number(topic.id);
    const sampleCount = detail ? (detail.samples || []).length : Number(topic.sample_count || 0);
    const taskCount = detail ? (detail.tasks || []).length : Number(topic.task_count || 0);
    return `<button class="v3-topic-row compact${active ? " is-active" : ""}" type="button" data-v3-open-topic="${topic.id}" aria-current="${active ? "true" : "false"}"><span>${v3Esc(topic.name)}</span><small>${v3Esc(v3Group(topic.source_group_id)?.name || "来源小组")} · ${sampleCount} 个样品 · ${taskCount} 个任务</small>${v3StatusMarkup(status)}</button>`;
  }).join("");
}
function v3TopicHasPending(detail) {
  const samples = detail.samples || [], tasks = detail.tasks || [], submissions = detail.submissions || [];
  return samples.some((sample) => (!sample.actual_arrival_date && (sample.eta_pending || !sample.current_eta_date || sample.current_eta_date < v3Today())) || (sample.actual_arrival_date && sample.actual_arrival_date >= v3DaysAgoIso(7))) || tasks.some((task) => task.display_status === "active" || !task.primary_member_id || !(task.efforts || []).some((effort) => Number(effort.planned_half_hours || 0) > 0)) || submissions.some((submission) => submission.status === "submitted");
}
function v3DaysAgoIso(days) { return addDays(v3Today(), -Math.max(0, Number(days) || 0)); }
function v3TopicHasFocus(detail, focus) {
  const samples = detail.samples || [], tasks = detail.tasks || [], submissions = detail.submissions || [];
  if (focus === "pending_eta") return samples.some((sample) => !sample.actual_arrival_date && (sample.eta_pending || !sample.current_eta_date));
  if (focus === "recent_arrival") return samples.some((sample) => sample.actual_arrival_date && sample.actual_arrival_date >= v3DaysAgoIso(7));
  if (focus === "delayed") return samples.some((sample) => !sample.actual_arrival_date && sample.current_eta_date && sample.current_eta_date < v3Today());
  if (focus === "testing") return tasks.some((task) => task.display_status === "active");
  if (focus === "unassigned") return tasks.some((task) => !task.primary_member_id || !(task.efforts || []).some((effort) => Number(effort.planned_half_hours || 0) > 0));
  if (focus === "submitted") return submissions.some((submission) => submission.status === "submitted");
  return true;
}
function v3TopicCryostatMatch(detail, value) {
  if (!value) return true;
  return (detail.tasks || []).some((task) => String(task.cryostat_id || "") === String(value));
}
function v3WorkbenchStatusLabel(focus) { return ({ pending_eta: "待确认 ETA", recent_arrival: "近期到样", delayed: "延期样品", testing: "测试中任务", unassigned: "待人工分配", submitted: "待验收成果" }[focus] || "全部事项"); }
function v3EventLabel(type) { return ({ topic_create: "创建专题", topic_update: "更新专题", sample_create: "加入样品", sample_update: "更新样品", sample_arrival: "记录到样", sample_eta_confirm: "确认 ETA", sample_eta: "预计到样", sample_delayed: "样品延期", task_create: "创建任务", task_update: "更新任务", task_order: "调整任务顺序", task_start: "任务开始", task_end: "任务结束", task_submit: "提交成果", submission_create: "提交成果", review_accept: "成果通过", review_return: "成果退回" }[type] || type || "专题变更"); }
function v3RenderTopics() {
  const list = $("#v3TopicOverviewList"); if (!list) return;
  const entries = v3State.topics.map((topic) => ({ ...topic, detail: v3State.topicDetails.get(topic.id) || { topic, samples: [], tasks: [], submissions: [], events: [] } }));
  const filtered = entries.filter((entry) => {
    const status = v3TopicStatus(entry.detail);
    return (!v3State.status || status === v3State.status) && (!v3State.source || String(entry.source_group_id) === String(v3State.source)) && v3TopicCryostatMatch(entry.detail, v3State.cryostat) && (!v3State.onlyPending || v3TopicHasPending(entry.detail)) && v3TopicHasFocus(entry.detail, v3State.workbenchFocus);
  });
  const stats = { testing: 0, delayed: 0, arriving_within_window: 0, arriving_outside_window: 0, time_pending: 0, completed: 0 };
  entries.forEach((entry) => { const status = v3TopicStatus(entry.detail); if (status && Object.prototype.hasOwnProperty.call(stats, status)) stats[status] += 1; });
  $$("#v3TopicStats [data-v3-stat]").forEach((card) => { const key = card.dataset.v3Stat; const value = card.querySelector("strong"); if (value) value.textContent = stats[key] ?? 0; card.setAttribute("aria-pressed", String(v3State.status === key)); });
  v3RenderWorkbenchOverview(entries);
  const count = $("#v3TopicResultCount"); if (count) count.textContent = `${filtered.length} 个专题`;
  if (!filtered.length) { list.innerHTML = v3State.topics.length ? ($("#v3TopicFilterEmptyTemplate")?.innerHTML || "<div class='v3-empty-state'><h3>没有匹配专题</h3></div>") : ($("#v3TopicTrueEmptyTemplate")?.innerHTML || "<div class='v3-empty-state'><h3>还没有专题</h3></div>"); return; }
  const grouped = new Map();
  filtered.forEach((entry) => {
    const status = v3TopicStatus(entry.detail); const group = v3Group(entry.source_group_id);
    let label = "";
    if (v3State.groupBy === "source_group") label = group?.name || "未指定来源小组";
    if (v3State.groupBy === "status") label = v3StatusLabel(status) || "实际到样，尚未开始测试";
    if (v3State.groupBy === "cryostat") {
      const taskCryostats = [...new Set((entry.detail.tasks || []).map((task) => v3Cryostat(task.cryostat_id)?.name || (task.cryostat_pending ? "待定" : "未指定")))];
      label = taskCryostats.length ? taskCryostats.join("、") : "未指定制冷机";
    }
    const bucket = grouped.get(label) || []; bucket.push({ entry, status, group }); grouped.set(label, bucket);
  });
  list.innerHTML = [...grouped.entries()].map(([label, rows], groupIndex) => `<section class="v3-topic-group"${label ? ` aria-labelledby="v3TopicGroup-${groupIndex}"` : ""}>${label ? `<h3 id="v3TopicGroup-${groupIndex}" class="v3-topic-group-title">${v3Esc(label)}</h3>` : ""}${rows.map(({ entry, status, group }) => { const samples = entry.detail.samples || [], tasks = entry.detail.tasks || []; const sampleRows = samples.map((sample) => `<tr><th scope="row">${v3Esc(sample.planning_label)}</th><td>${v3Esc(sample.model)}</td><td>${sample.actual_arrival_date ? `到样 ${v3Esc(sample.actual_arrival_date)}` : sample.eta_pending ? "ETA 待确认" : v3Esc(sample.current_eta_date || "—")}</td></tr>`).join(""); const taskRows = tasks.map((task) => `<tr><th scope="row">${v3Esc(task.title)}</th><td>${v3StatusMarkup(task.display_status)}</td><td>${v3Esc(v3Cryostat(task.cryostat_id)?.name || (task.cryostat_pending ? "待定" : "未指定"))}</td><td>${task.efforts?.length ? task.efforts.map((effort) => v3Esc(effort.name)).join("、") : "待分配"}</td></tr>`).join(""); return `<details class="v3-topic-table-row"><summary><span class="v3-topic-table-main"><span class="eyebrow">${v3Esc(group?.name || "来源小组")}</span><strong>${v3Esc(entry.name)}</strong><small>${v3Esc(entry.purpose || "")}</small></span><span class="v3-topic-row-facts">${v3StatusMarkup(status)}<span>${samples.length} 个样品</span><span>${tasks.length} 个任务</span></span></summary><div class="v3-topic-table-details"><div class="v3-topic-detail-actions"><span>专题负责人：${v3Esc(entry.source_contact_name || "待确认")}</span><button class="ghost-button compact" type="button" data-v3-open-topic="${entry.id}">进入专题</button></div>${samples.length ? `<table class="v3-workbench-table"><caption>样品明细</caption><thead><tr><th>标签</th><th>型号</th><th>ETA/到样</th></tr></thead><tbody>${sampleRows}</tbody></table>` : "<p class='v3-inline-note'>暂无样品规划。</p>"}${tasks.length ? `<table class="v3-workbench-table"><caption>任务明细</caption><thead><tr><th>任务</th><th>状态</th><th>制冷机</th><th>负责人</th></tr></thead><tbody>${taskRows}</tbody></table>` : "<p class='v3-inline-note'>暂无任务。</p>"}</div></details>`; }).join("")}</section>`).join("");
}
function v3RenderWorkbenchOverview(entries = null) {
  const digest = $("#v3WorkbenchDigest"); if (!digest) return;
  const rows = entries || v3State.topics.map((topic) => ({ ...topic, detail: v3State.topicDetails.get(topic.id) || { topic, samples: [], tasks: [], submissions: [], events: [] } }));
  const counts = { pending_eta: 0, recent_arrival: 0, delayed: 0, testing: 0, unassigned: 0, submitted: 0 };
  const queue = [], events = [];
  rows.forEach((entry) => {
    const detail = entry.detail, group = v3Group(entry.source_group_id), samples = detail.samples || [], tasks = detail.tasks || [], submissions = detail.submissions || [];
    samples.forEach((sample) => {
      if (!sample.actual_arrival_date && (sample.eta_pending || !sample.current_eta_date)) { counts.pending_eta += 1; queue.push({ kind: "pending_eta", actionKind: "topic", topicId: entry.id, group: group?.name, topic: entry.name, sample: `${sample.planning_label} · ${sample.model}`, eta: "待确认", cryostat: "—", owner: "待确认", action: "补充 ETA" }); }
      if (sample.actual_arrival_date && sample.actual_arrival_date >= v3DaysAgoIso(7)) { counts.recent_arrival += 1; queue.push({ kind: "recent_arrival", actionKind: "topic", topicId: entry.id, group: group?.name, topic: entry.name, sample: `${sample.planning_label} · ${sample.model}`, eta: `到样 ${sample.actual_arrival_date}`, cryostat: "—", owner: "待开始测试", action: "查看任务" }); }
      if (!sample.actual_arrival_date && sample.current_eta_date && sample.current_eta_date < v3Today()) { counts.delayed += 1; queue.push({ kind: "delayed", actionKind: "topic", topicId: entry.id, group: group?.name, topic: entry.name, sample: `${sample.planning_label} · ${sample.model}`, eta: sample.current_eta_date, cryostat: "—", owner: "待确认到样", action: "确认到样" }); }
    });
    tasks.forEach((task) => {
      const owner = task.efforts?.length ? task.efforts.map((effort) => effort.name).join("、") : "待分配"; const cryostat = v3Cryostat(task.cryostat_id)?.name || (task.cryostat_pending ? "待定" : "未指定"); const sample = task.samples?.[0];
      if (task.display_status === "active") { counts.testing += 1; queue.push({ kind: "testing", actionKind: "execution", topicId: entry.id, taskId: task.id, group: group?.name, topic: entry.name, sample: sample ? `${sample.planning_label} · ${sample.model}` : "未绑定样品", task: task.title, eta: `${task.start_date || "待排期"}～${task.end_date || "待排期"}`, cryostat, owner, action: "打开执行" }); }
      if (!task.primary_member_id || !task.efforts?.some((effort) => Number(effort.planned_half_hours || 0) > 0)) { counts.unassigned += 1; queue.push({ kind: "unassigned", actionKind: "assignment", topicId: entry.id, taskId: task.id, group: group?.name, topic: entry.name, sample: sample ? `${sample.planning_label} · ${sample.model}` : "未绑定样品", task: task.title, eta: `${task.start_date || "待排期"}～${task.end_date || "待排期"}`, cryostat, owner, action: "人工分配" }); }
    });
    submissions.filter((submission) => submission.status === "submitted").forEach((submission) => { counts.submitted += 1; queue.push({ kind: "submitted", actionKind: "acceptance", topicId: entry.id, taskId: submission.topic_task_id, group: group?.name, topic: entry.name, sample: "按提交快照", task: `任务 #${submission.topic_task_id}`, eta: "待人工验收", cryostat: "—", owner: submission.submitted_by || "本地用户", action: "打开验收" }); });
    samples.filter((sample) => !sample.actual_arrival_date && sample.current_eta_date).forEach((sample) => events.push({ event_type: sample.current_eta_date < v3Today() ? "sample_delayed" : "sample_eta", created_at: sample.current_eta_date, topicId: entry.id, sampleId: sample.id, topicName: entry.name, groupName: group?.name || "来源小组", actor: "计划 ETA" }));
    tasks.forEach((task) => { if (task.start_date) events.push({ event_type: "task_start", created_at: task.start_date, topicId: entry.id, taskId: task.id, topicName: entry.name, groupName: group?.name || "来源小组", actor: "任务排期", taskTitle: task.title }); if (task.end_date) events.push({ event_type: "task_end", created_at: task.end_date, topicId: entry.id, taskId: task.id, topicName: entry.name, groupName: group?.name || "来源小组", actor: "任务排期", taskTitle: task.title }); });
    (detail.events || []).forEach((event) => { const taskId = event.taskId || event.topic_task_id || null; const actionKind = event.actionKind || (["submission", "acceptance", "review_accept", "review_return"].includes(event.event_type) ? "acceptance" : taskId ? "execution" : "topic"); events.push({ ...event, taskId, actionKind, topicId: entry.id, topicName: entry.name, groupName: group?.name || "来源小组" }); });
  });
  $$("#v3WorkbenchSummaryGrid [data-v3-workbench-stat]").forEach((card) => { const key = card.dataset.v3WorkbenchStat; const value = card.querySelector("strong"); if (value) value.textContent = counts[key] ?? 0; card.setAttribute("aria-pressed", String(v3State.workbenchFocus === key)); });
  const focus = $("#v3WorkbenchFocus"); if (focus) focus.textContent = v3WorkbenchStatusLabel(v3State.workbenchFocus);
  let visibleQueue = queue.filter((item) => (!v3State.onlyPending || ["pending_eta", "recent_arrival", "delayed", "testing", "unassigned", "submitted"].includes(item.kind)) && (!v3State.workbenchFocus || item.kind === v3State.workbenchFocus));
  visibleQueue.sort((a, b) => String(a.eta).localeCompare(String(b.eta)));
  const queueList = $("#v3WorkbenchQueueList"), queueCount = $("#v3WorkbenchQueueCount"); if (queueCount) queueCount.textContent = `${visibleQueue.length} 项`;
  if (queueList) queueList.innerHTML = visibleQueue.length ? visibleQueue.slice(0, 30).map((item) => `<article class="v3-workbench-queue-item"><div class="v3-workbench-queue-main"><span class="v3-queue-kind is-${v3Esc(item.kind)}">${v3Esc(v3WorkbenchStatusLabel(item.kind))}</span><strong>${v3Esc(item.task || item.sample || "待处理事项")}</strong><small>${v3Esc(item.group || "来源小组")} · ${v3Esc(item.topic || "专题")}</small><span>${v3Esc(item.sample || "")} · ETA/日期：${v3Esc(item.eta || "—")} · 制冷机：${v3Esc(item.cryostat || "—")} · 负责人：${v3Esc(item.owner || "待确认")}</span></div><button class="ghost-button compact" type="button" data-v3-workbench-action="${v3Esc(item.actionKind || "topic")}" data-v3-workbench-topic="${item.topicId}" data-v3-workbench-task="${item.taskId || ""}">${v3Esc(item.action)}</button></article>`).join("") : "<div class='v3-empty-state compact'><h3>当前没有待处理事项</h3><p>可清空筛选或等待新的专题事件。</p></div>";
  const today = v3Today(), recentCutoff = v3DaysAgoIso(14), futureLimit = addDays(today, v3State.windowDays); const eventDate = (event) => String(event.created_at || "").slice(0, 10); const upcoming = events.filter((event) => eventDate(event) >= today && eventDate(event) <= futureLimit).sort((a, b) => eventDate(a).localeCompare(eventDate(b))); const recent = events.filter((event) => eventDate(event) < today && eventDate(event) >= recentCutoff).sort((a, b) => eventDate(b).localeCompare(eventDate(a))); const orderedEvents = [...upcoming, ...recent].slice(0, 16); const eventList = $("#v3WorkbenchEventList"); if (eventList) eventList.innerHTML = orderedEvents.length ? orderedEvents.map((event) => `<li class="v3-workbench-event"><time datetime="${v3Esc(event.created_at || "")}">${v3Esc(event.created_at || "")}</time><div><strong>${v3Esc(v3EventLabel(event.event_type))}</strong><span>${v3Esc(event.groupName)} · ${v3Esc(event.topicName)}${event.taskTitle ? ` · ${v3Esc(event.taskTitle)}` : ""}</span><small>操作者：${v3Esc(event.actor || "本地用户")}</small><button class="ghost-button compact" type="button" data-v3-workbench-action="${v3Esc(event.actionKind || (event.taskId ? "execution" : "topic"))}" data-v3-workbench-topic="${event.topicId}" data-v3-workbench-task="${event.taskId || ""}">${event.actionKind === "acceptance" ? "进入验收" : event.taskId ? "进入任务" : "查看专题"}</button></div></li>`).join("") : "<li class='v3-empty-state compact'><p>暂无近期或即将发生的事件。</p></li>";
}
function v3RenderTopic() {
  const topic = v3State.topic; if (!topic) return;
  const group = v3Group(topic.source_group_id), samples = v3State.samples, tasks = v3State.tasks;
  $("#v3TopicName").textContent = topic.name; $("#v3TopicPurpose").textContent = topic.purpose;
  $("#v3TopicSource").textContent = group?.name || "—"; $("#v3TopicSampleSummary").textContent = `${samples.length} 个样品`;
  $("#v3TopicTaskSummary").textContent = `${tasks.length} 个连续任务`; $("#v3TopicDefaultCryostat").textContent = v3Cryostat(topic.default_cryostat_id)?.name || "不设默认";
  $("#v3TopicBreadcrumb").textContent = `${group?.name || "来源小组"} / ${topic.name}`;
  $("#v3TopicListCount").textContent = `${v3State.topics.length}`;
  v3RenderTopicList();
  $("#v3SampleCount").textContent = `${samples.length} 个样品`; $("#v3TaskChainCount").textContent = `${tasks.length} 个任务`;
  $("#v3SampleList").innerHTML = samples.length ? samples.map((sample) => `<article class="v3-sample-card"><div><strong>${v3Esc(sample.planning_label)}</strong><span>${v3Esc(sample.model)}</span><small>${sample.formal_identifier || sample.temporary_identifier ? `编号：${v3Esc(sample.formal_identifier || sample.temporary_identifier)}` : "编号待补"}</small></div><div><span class="v3-eta-chip">${sample.eta_pending ? "ETA 待确认" : `ETA ${v3Esc(sample.current_eta_date || "—")}`}</span>${sample.actual_arrival_date ? `<small>到样 ${v3Esc(sample.actual_arrival_date)}</small>` : ""}<div class="v3-card-actions"><button class="ghost-button compact" type="button" data-v3-open-sample-edit="${sample.id}">编辑样品</button><button class="ghost-button compact" type="button" data-v3-open-eta="${sample.id}">修订 ETA</button></div></div></article>`).join("") : "<li class='v3-empty-state compact'><h3>样品池为空</h3><p>先记录规划标签和型号，后续再补编号。</p></li>";
  $("#v3TaskChainList").innerHTML = tasks.length ? tasks.map((task, index) => `<li class="v3-task-card"><div><strong>${v3Esc(task.title)}</strong>${v3StatusMarkup(task.display_status)}<span class="v3-required-chip">${task.is_required === 0 ? "可选" : "必做"}</span><p>${v3Esc(task.start_date || "待排期")} ～ ${v3Esc(task.end_date || "待排期")} · ${task.samples.map((s) => v3Esc(s.planning_label)).join("、")}</p><div class="v3-task-context-line">${v3TaskContextText(task)}</div><p class="v3-task-purpose-line">${v3Esc(task.test_purpose || "测试目的待补充")}</p><small>测试项：${task.test_items?.length ? task.test_items.map((item) => v3Esc(item.name || item.label)).join("、") : "待补充"} · ${task.efforts?.map((e) => `${v3Esc(e.name)} ${Number(e.planned_half_hours || 0) / 2}h`).join(" · ") || "未完成人工分配"}</small></div><div class="v3-card-actions"><div class="v3-task-order-actions" aria-label="人工调整任务顺序"><button class="ghost-button compact" type="button" data-v3-move-task="up" data-v3-task-id="${task.id}" aria-label="任务上移"${index === 0 || v3State.taskOrderBusy ? " disabled" : ""}>↑</button><button class="ghost-button compact" type="button" data-v3-move-task="down" data-v3-task-id="${task.id}" aria-label="任务下移"${index === tasks.length - 1 || v3State.taskOrderBusy ? " disabled" : ""}>↓</button></div><button class="ghost-button compact" type="button" data-v3-open-task-editor="${task.id}">编辑全部</button><button class="ghost-button compact" type="button" data-v3-open-submission="${task.id}">提交成果</button></div></li>`).join("") : "<li class='v3-empty-state compact'><h3>任务链为空</h3><p>从第一个任务开始，逐步建立前后关系。</p></li>";
  const orderStatus = $("#v3TaskOrderStatus"); if (orderStatus) orderStatus.textContent = v3State.taskOrderNotice || "";
  const editTopic = $("#v3EditTopicBtn"); if (editTopic) { editTopic.dataset.v3OpenTopicEdit = topic.id; editTopic.disabled = false; }
  v3RenderAssignment(); v3RenderAcceptance(); v3RenderTopicDetail();
}
async function v3LoadTopic(id) {
  if (!v3State.members.length) await v3LoadMembers();
  const [topic, samples, tasks, template, submissions, events] = await Promise.all([v3Api(`/api/v3/topics/${id}`), v3Api(`/api/v3/topics/${id}/samples`), v3Api(`/api/v3/topics/${id}/tasks`), v3Api(`/api/v3/topics/${id}/acceptance-template`), v3Api(`/api/v3/topics/${id}/submissions`), v3Api(`/api/v3/topics/${id}/events`)]);
  v3State.topic = topic.data; v3State.samples = samples.data?.items || []; v3State.tasks = tasks.data?.items || []; v3State.template = template.data || null;
  v3State.topicDetails.set(v3State.topic.id, { topic: v3State.topic, samples: v3State.samples, tasks: v3State.tasks, submissions: submissions.data?.items || [], events: events.data?.items || [] });
  v3RebuildExecutionTaskIndex();
  renderTasks();
  renderDetail();
  await v3LoadSubmissions(); v3RenderTopic(); v3RenderWorkbenchOverview();
}
async function v3RefreshAfterChange(topicId = v3State.topic?.id, { reloadLegacy = true } = {}) {
  const selectedTopicId = topicId == null ? null : Number(topicId);
  await Promise.all([
    v3LoadMembers(),
    v3LoadTopics(),
    reloadLegacy ? loadData() : Promise.resolve()
  ]);
  if (Number.isFinite(selectedTopicId) && v3State.topics.some((topic) => Number(topic.id) === selectedTopicId)) {
    await v3LoadTopic(selectedTopicId);
  } else {
    v3RenderAssignment();
    v3RenderAcceptance();
    v3RenderManagement();
  }
}
async function v3LoadSubmissions() {
  if (!v3State.topic) return; const result = await v3Api(`/api/v3/topics/${v3State.topic.id}/submissions`); v3State.submissions = result.data?.items || [];
}
function v3SyncPanels(view = v3State.activeView) {
  const topic = v3State.mode === "topic";
  const main = document.querySelector("main.page");
  main?.classList.toggle("v3-topic-mode", topic);
  $("#v3TopicModeBtn")?.classList.toggle("active", topic);
  $("#v3TopicModeBtn")?.setAttribute("aria-selected", String(topic));
  $("#v2LegacyModeBtn")?.classList.toggle("active", !topic);
  $("#v2LegacyModeBtn")?.setAttribute("aria-selected", String(!topic));

  // Legacy V1/V2 content remains mounted for compatibility, but the topic
  // route presents its own primary surface inside the same six work areas.
  const toggleLegacy = (node, hidden) => {
    if (hidden) {
      if (!Object.prototype.hasOwnProperty.call(node.dataset, "v3WasHidden")) node.dataset.v3WasHidden = String(node.hidden);
      node.hidden = true;
    } else if (Object.prototype.hasOwnProperty.call(node.dataset, "v3WasHidden")) {
      node.hidden = node.dataset.v3WasHidden === "true";
      delete node.dataset.v3WasHidden;
    }
  };
  $$('[data-v3-legacy-content]').forEach((node) => toggleLegacy(node, topic));
  $$('[data-v3-legacy-toolbar]').forEach((node) => {
    if (topic) toggleLegacy(node, true);
    else {
      delete node.dataset.v3WasHidden;
      node.hidden = node.dataset.v2ToolbarView !== view;
    }
  });
  $$('[data-v3-toolbar-view]').forEach((node) => { node.hidden = !topic || node.dataset.v3ToolbarView !== view; });
  $("[data-v3-legacy-plan-action]")?.toggleAttribute("hidden", topic);
  $$('[data-v3-panel]').forEach((node) => {
    node.hidden = !topic || node.dataset.v3Panel !== view;
  });
  const topicDetailPane = $("#v3TopicDetailPane");
  if (topicDetailPane && (!topic || view !== "plans")) {
    topicDetailPane.hidden = true;
    topicDetailPane.classList.remove("is-open");
    v3State.topicDetailReturnFocus = null;
    v3State.topicDetailReturnView = null;
  }
  // The execution area intentionally keeps the V1 gantt/tasks/load visible;
  // this context strip only adds the selected topic breadcrumb.
  if (topic && view === "execution") $("#v3ExecutionContext")?.removeAttribute("hidden");
  $("#v3NewTopicBtn") && ($("#v3NewTopicBtn").hidden = !topic || !["workbench", "plans"].includes(view));
  $("#newPlanBtn") && ($("#newPlanBtn").hidden = topic);
  if (view === "plans") $("#v3ModelNav")?.removeAttribute("hidden");
  document.title = `${$("[data-v2-view].active")?.textContent?.trim() || "工作台"} · 小组任务管理与甘特图系统`;
}

function v3ShowMode(mode) {
  v3State.mode = mode === "legacy" ? "legacy" : "topic";
  state.v3ExecutionContextEnabled = v3State.mode === "topic";
  const targetView = v3State.mode === "legacy"
    ? "plans"
    : (v2State.activeV2View === "plans" ? "plans" : (v2State.activeV2View || "workbench"));
  if (v2State.activeV2View !== targetView) setV2View(targetView);
  v3SetView(targetView);
  if (v3State.mode === "topic") Promise.all([v3LoadMembers(), v3LoadTopics()]).catch((error) => showToast(v3ErrorText(error), { type: "error" }));
}

function v3SetView(view) {
  if (!["workbench", "plans", "assignment", "execution", "acceptance", "management"].includes(view)) view = "workbench";
  v3State.activeView = view;
  if (v3State.mode === "topic" && view === "management" && v2State.managementView !== "maintenance") {
    v2State.managementView = "maintenance";
    state.activeView = "maintenance";
    saveV2Preferences();
    renderViewState();
  }
  v3SyncPanels(view);
  if (view === "plans") {
    v3RenderTopicList();
    if (v3State.topic) v3RenderTopic();
  }
  if (view === "assignment") v3RenderAssignment();
  if (view === "acceptance") v3RenderAcceptance();
  if (view === "management") v3RenderManagement();
}

function v3RenderAssignment() {
  const topic = v3State.topic; const select = $("#v3AssignmentTopicFilter"); if (select && topic) select.value = String(topic.id);
  const tasks = v3State.tasks || []; $("#v3AssignmentTaskCount") && ($("#v3AssignmentTaskCount").textContent = `${tasks.length} 个任务`);
  const list = $("#v3AssignmentTaskList"); if (list) list.innerHTML = tasks.length ? tasks.map((task) => `<button class="v3-task-card compact" type="button" data-v3-open-member="${task.id}"><strong>${v3Esc(task.title)}</strong><span>${task.efforts?.map((e) => `${v3Esc(e.name)} ${Number(e.planned_half_hours || 0) / 2}h`).join("、") || "未分配"}</span></button>`).join("") : "<div class='v3-empty-state compact'><p>选择专题后显示任务。</p></div>";
  const active = v3State.tasks.find((task) => task.id === v3State.activeTaskId); const memberList = $("#v3TaskMemberList"); if (memberList) memberList.innerHTML = active?.efforts?.length ? active.efforts.map((e) => `<div class="v3-member-hour-row"><strong>${v3Esc(e.name)}</strong><span>${Number(e.planned_half_hours || 0) / 2} 小时</span></div>`).join("") : "<div class='v3-empty-state compact'><p>选择任务后显示成员集合。</p></div>";
}
function v3RenderAcceptance() {
  const list = $("#v3SubmissionList"); if (!list) return; const rows = v3State.submissions.filter((row) => !v3State.acceptanceStatus || row.status === v3State.acceptanceStatus); $("#v3SubmissionCount") && ($("#v3SubmissionCount").textContent = `${rows.length} 项`);
  list.innerHTML = rows.length ? rows.map((row) => `<article class="v3-submission-card"><div><strong>任务 #${row.topic_task_id}</strong><span class="v3-status-chip v3-status-${row.status}">${row.status === "submitted" ? "待验收" : row.status === "accepted" ? "已通过" : "已退回"}</span><p>${v3Esc(row.description)}</p></div><button class="ghost-button compact" type="button" data-v3-open-review="${row.id}">人工验收</button></article>`).join("") : "<div class='v3-empty-state compact'><h3>没有待验收成果</h3><p>任务提交后会在这里等待人工通过或退回。</p></div>";
}
function v3RenderManagement() {
  const count = $("#v3ActiveCryostatCount"); if (count) count.textContent = v3State.cryostats.filter((c) => c.status === "active").length;
  const members = $("#v3ActiveMemberCount"); if (members) members.textContent = v3State.members.length;
  const badge = $("#v3MigrationBadge"); if (badge) { badge.textContent = "数据版本已就绪"; badge.className = "v3-status-badge is-success"; }
  const text = $("#v3MigrationStatusText"); if (text) text.textContent = "历史接口保持不变，专题、样品与任务链独立维护。";
}

function v3OpenTopicDialog(trigger, topicId = null) {
  const topic = topicId ? (v3State.topics.find((item) => Number(item.id) === Number(topicId)) || (v3State.topic?.id === Number(topicId) ? v3State.topic : null)) : null;
  v3State.topicEditId = topic?.id || null;
  $("#v3TopicForm").reset(); v3FormError("#v3TopicFormError"); v3FillResourceSelects();
  $("#v3TopicDialogTitle").textContent = topic ? "编辑专题" : "新建专题";
  $("#v3SaveTopicBtn").textContent = topic ? "确认保存" : "保存专题";
  const source = $("#v3TopicSourceGroup"); if (source) { source.value = topic?.source_group_id || v3State.source || ""; if (source.value) v3FillContacts(source.value).then(() => { if (topic?.source_contact_id != null) $("#v3TopicContact").value = String(topic.source_contact_id); }).catch(() => {}); }
  $("#v3TopicNameInput").value = topic?.name || ""; $("#v3TopicPurposeInput").value = topic?.purpose || "";
  $("#v3TopicDefaultCryostatInput").value = topic?.default_cryostat_id ? String(topic.default_cryostat_id) : "";
  v3Open($("#v3TopicDialog"), trigger);
}
async function v3SaveTopic(event) {
  event.preventDefault(); if (v3State.busy.has("topic")) return; const form = event.currentTarget; if (!form.reportValidity()) return; const sourceGroupId = Number($("#v3TopicSourceGroup").value); const contactValue = $("#v3TopicContact").value; const sameSourceGroup = v3State.topicEditId && Number(v3State.topic?.source_group_id) === sourceGroupId; const sourceContactId = contactValue ? Number(contactValue) : (sameSourceGroup ? (v3State.topic?.source_contact_id ?? null) : null); const body = { source_group_id: sourceGroupId, source_contact_id: sourceContactId, name: $("#v3TopicNameInput").value.trim(), purpose: $("#v3TopicPurposeInput").value.trim(), default_cryostat_id: $("#v3TopicDefaultCryostatInput").value ? Number($("#v3TopicDefaultCryostatInput").value) : null, actor: "本地用户" };
  const topicId = v3State.topicEditId; if (topicId) body.expected_version = v3State.topic?.version;
  v3SetBusy("topic", true); try { await v3Api(topicId ? `/api/v3/topics/${topicId}` : "/api/v3/topics", v3Json(topicId ? "PUT" : "POST", body)); v3Close($("#v3TopicDialog")); await v3RefreshAfterChange(topicId || undefined, { reloadLegacy: false }); showToast(topicId ? "专题已更新" : "专题已创建"); } catch (error) { v3FormError("#v3TopicFormError", error); } finally { v3SetBusy("topic", false); }
}
function v3OpenSampleDialog(trigger, sampleId = null) {
  if (!v3State.topic) return showToast("请先选择专题", { type: "error" });
  const sample = sampleId ? v3State.samples.find((item) => Number(item.id) === Number(sampleId)) : null;
  v3State.sampleEditId = sample?.id || null; $("#v3SampleForm").reset(); $("#v3SampleEtaPending").checked = false; v3FormError("#v3SampleFormError");
  $("#v3SampleDialogTitle").textContent = sample ? "编辑样品规划" : "新增样品"; $("#v3SaveSampleBtn").textContent = sample ? "确认保存" : "保存样品";
  if (sample) {
    $("#v3SampleLabel").value = sample.planning_label || ""; $("#v3SampleModel").value = sample.model || "";
    const identifier = sample.formal_identifier || sample.temporary_identifier || ""; $("#v3SampleIdentifier").value = identifier; $("#v3SampleIdentifierKind").value = sample.formal_identifier ? "formal" : sample.temporary_identifier ? "temporary" : "";
    $("#v3SampleCurrentEta").value = sample.current_eta_date || sample.initial_eta_date || ""; $("#v3SampleInitialEta").value = sample.initial_eta_date || ""; $("#v3SampleEtaPending").checked = Boolean(sample.eta_pending); $("#v3SampleArrivalDate").value = sample.actual_arrival_date || "";
  }
  v3Open($("#v3SampleDialog"), trigger);
}
async function v3SaveSample(event) {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity() || !v3State.topic) return; const pending = $("#v3SampleEtaPending").checked; const eta = pending ? null : $("#v3SampleCurrentEta").value || $("#v3SampleInitialEta").value; if (!pending && !eta) { v3FormError("#v3SampleFormError", new Error("请填写当前 ETA，或勾选 ETA 待确认")); return; }
  const kind = $("#v3SampleIdentifierKind").value, identifier = $("#v3SampleIdentifier").value.trim(); const body = { planning_label: $("#v3SampleLabel").value.trim(), model: $("#v3SampleModel").value.trim(), initial_eta_date: $("#v3SampleInitialEta").value || null, eta_date: eta, eta_pending: pending ? 1 : 0, formal_identifier: kind === "formal" ? (identifier || null) : null, temporary_identifier: kind === "temporary" ? (identifier || null) : null, notes: "", actor: "本地用户" };
  v3SetBusy("sample", true); try { const topicId = v3State.topic.id; const sampleId = v3State.sampleEditId; const old = sampleId ? v3State.samples.find((item) => Number(item.id) === Number(sampleId)) : null; let result; if (sampleId) { result = await v3Api(`/api/v3/samples/${sampleId}`, v3Json("PUT", { planning_label: body.planning_label, model: body.model, initial_eta_date: $("#v3SampleInitialEta").value || null, formal_identifier: body.formal_identifier, temporary_identifier: body.temporary_identifier, notes: body.notes, expected_version: old?.version, actor: "本地用户" })); if (old && (old.current_eta_date !== eta || Boolean(old.eta_pending) !== pending)) { const preview = (await v3Api(`/api/v3/samples/${sampleId}/eta/preview`, v3Json("POST", { new_eta_date: eta, eta_pending: pending ? 1 : 0, selected_task_ids: [] }))).data; const confirmed = await v3Api(`/api/v3/samples/${sampleId}/eta/confirm`, v3Json("POST", { new_eta_date: eta, eta_pending: pending ? 1 : 0, selected_task_ids: [], preview_token: preview.preview_token, actor: "本地用户" })); result = { data: confirmed.data?.sample || confirmed.data }; } } else result = await v3Api(`/api/v3/topics/${topicId}/samples`, v3Json("POST", body)); const arrival = $("#v3SampleArrivalDate").value; const sampleResult = result?.data || result; if (arrival && old?.actual_arrival_date !== arrival) await v3Api(`/api/v3/samples/${sampleResult.id}/arrival`, v3Json("POST", { actual_arrival_date: arrival, expected_version: sampleResult.version, actor: "本地用户" })); v3Close($("#v3SampleDialog")); await v3RefreshAfterChange(topicId); showToast(sampleId ? "样品规划已更新" : "样品已加入规划池"); } catch (error) { v3FormError("#v3SampleFormError", error); } finally { v3SetBusy("sample", false); }
}
function v3RenderTaskMemberDraft() {
  const box = $("#v3TaskMemberEditor"); if (!box) return; const selected = new Map(v3State.taskDraftMembers.map((m) => [Number(m.member_id), m])); box.innerHTML = v3State.members.length ? v3State.members.map((member) => `<label><input type="checkbox" data-v3-task-member value="${member.id}"${selected.has(member.id) ? " checked" : ""}> ${v3Esc(member.name)}<input class="v3-hours-input" data-v3-task-hours="${member.id}" type="number" min="0" step="0.5" value="${Number(selected.get(member.id)?.planned_half_hours || 0) / 2}" aria-label="${v3Esc(member.name)}预计工时（小时）"></label>`).join("") : `<div class="v3-empty-state compact"><p>暂无可用成员，请先在成员维护中启用成员。</p></div>`;
}
function v3ReadTaskMembers() { v3State.taskDraftMembers = $$('[data-v3-task-member]:checked').map((node) => ({ member_id: Number(node.value), planned_half_hours: Math.round(Number($(`[data-v3-task-hours="${node.value}"]`)?.value || 0) * 2) })); return v3State.taskDraftMembers; }
function v3TaskItemsToText(items = []) { return (items || []).map((item) => `${item.name || item.label || ""}${item.acceptance_criteria ? ` | ${item.acceptance_criteria}` : ""}`).join("\n"); }
function v3TaskItemsFromText(value) { return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const [name, ...criteria] = line.split("|"); return { name: name.trim(), acceptance_criteria: criteria.join("|").trim(), is_required: 1 }; }); }
function v3TaskContextText(task = null) { const topic = task?.topic || v3State.topic; const group = task?.source_group || v3Group(topic?.source_group_id); const cryostat = task?.cryostat?.name || (task?.cryostat_pending ? "待定" : v3Cryostat(task?.cryostat_id)?.name) || "未指定"; return `<span>专题：${v3Esc(topic?.name || "—")}</span><span>来源小组：${v3Esc(group?.name || "—")}</span><span>制冷机：${v3Esc(cryostat)}</span>`; }
function v3TaskUpdateBody(task, overrides = {}) { const members = overrides.member_efforts || task.efforts?.map((e) => ({ member_id: e.member_id, planned_half_hours: e.planned_half_hours })) || []; const primary = overrides.primary_member_id || task.primary_member_id || members[0]?.member_id; return { title: overrides.title ?? task.title, description: overrides.description ?? task.description ?? "", test_purpose: overrides.test_purpose ?? task.test_purpose ?? "", test_items: overrides.test_items ?? task.test_items ?? [], predecessor_task_id: null, sample_ids: overrides.sample_ids ?? task.samples.map((s) => s.id), position: overrides.position ?? task.position, is_required: overrides.is_required ?? (task.is_required !== 0 ? 1 : 0), primary_member_id: primary, participant_member_ids: members.filter((m) => m.member_id !== primary).map((m) => m.member_id), member_efforts: members, cryostat_id: overrides.cryostat_id ?? task.cryostat_id ?? null, cryostat_pending: overrides.cryostat_pending ?? task.cryostat_pending ?? 0, start_date: overrides.start_date ?? task.start_date, end_date: overrides.end_date ?? task.end_date, after_arrival: overrides.after_arrival ?? task.after_arrival ?? 0, expected_version: task.version }; }
function v3TaskBody() { const selected = v3ReadTaskMembers(); const samples = $$('[data-v3-task-sample]:checked').map((node) => Number(node.value)); const task = v3State.taskEditId ? v3State.tasks.find((item) => Number(item.id) === Number(v3State.taskEditId)) : null; return { title: $("#v3TaskTitle").value.trim(), description: $("#v3TaskDescription").value.trim(), test_purpose: $("#v3TaskPurpose").value.trim(), test_items: v3TaskItemsFromText($("#v3TaskItems").value), predecessor_task_id: null, sample_ids: samples, position: task?.position ?? v3State.tasks.length, is_required: $("#v3TaskRequired").checked ? 1 : 0, primary_member_id: selected[0]?.member_id, participant_member_ids: selected.slice(1).map((item) => item.member_id), member_efforts: selected, cryostat_id: $("#v3TaskCryostat").value ? Number($("#v3TaskCryostat").value) : null, cryostat_pending: $("#v3TaskCryostatPending").checked ? 1 : 0, start_date: $("#v3TaskStartDate").value, end_date: $("#v3TaskEndDate").value, after_arrival: $("#v3TaskAfterArrival").checked ? 1 : 0, ...(task ? { expected_version: task.version } : {}) }; }
function v3RenderTaskSamples(selectedIds = []) { const selected = new Set(selectedIds.map(Number)); const box = $("#v3TaskSamples"); if (!box) return; box.innerHTML = v3State.samples.map((s) => `<label><input type="checkbox" data-v3-task-sample value="${s.id}"${selected.has(Number(s.id)) ? " checked" : ""}> ${v3Esc(s.planning_label)} · ${v3Esc(s.model)}${s.eta_pending ? " · ETA待确认" : s.current_eta_date ? ` · ETA ${v3Esc(s.current_eta_date)}` : ""}</label>`).join("") || "<p>暂无样品，请先在这里新增样品。</p>"; }
function v3ToggleQuickSampleEditor() { const editor = $("#v3QuickSampleEditor"); const button = $("#v3ToggleQuickSampleBtn"); if (!editor || !button) return; editor.hidden = !editor.hidden; button.setAttribute("aria-expanded", String(!editor.hidden)); if (!editor.hidden) $("#v3TaskQuickSampleLabel")?.focus(); }
async function v3QuickAddTaskSample() { const topicId = v3State.topic?.id; if (!topicId) return; const label = $("#v3TaskQuickSampleLabel").value.trim(); const model = $("#v3TaskQuickSampleModel").value.trim(); const pending = $("#v3TaskQuickSampleEtaPending").checked; const eta = pending ? null : $("#v3TaskQuickSampleEta").value || null; if (!label || !model) return $("#v3QuickSampleStatus").textContent = "请填写规划标签和样品型号。"; if (!pending && !eta) return $("#v3QuickSampleStatus").textContent = "请填写 ETA，或勾选 ETA 待确认。"; const kind = $("#v3TaskQuickSampleIdentifierKind").value; const identifier = $("#v3TaskQuickSampleIdentifier").value.trim(); const selectedIds = $$('[data-v3-task-sample]:checked').map((node) => Number(node.value)); const button = $("#v3QuickSampleSaveBtn"); button.disabled = true; $("#v3QuickSampleStatus").textContent = "正在加入样品池…"; try { const result = await v3Api(`/api/v3/topics/${topicId}/samples`, v3Json("POST", { planning_label: label, model, eta_date: eta, eta_pending: pending ? 1 : 0, formal_identifier: kind === "formal" ? (identifier || null) : null, temporary_identifier: kind === "temporary" ? (identifier || null) : null, notes: "", actor: "本地用户" })); selectedIds.push(Number(result.data.id)); await v3RefreshAfterChange(topicId, { reloadLegacy: false }); v3RenderTaskSamples(selectedIds); $("#v3TaskQuickSampleLabel").value = ""; $("#v3TaskQuickSampleModel").value = ""; $("#v3TaskQuickSampleIdentifier").value = ""; $("#v3TaskQuickSampleIdentifierKind").value = ""; $("#v3QuickSampleStatus").textContent = "样品已加入并选中。"; } catch (error) { $("#v3QuickSampleStatus").textContent = v3ErrorText(error); } finally { button.disabled = false; } }
function v3OpenTaskDialog(trigger, taskId = null) { if (!v3State.topic) return showToast("请先选择专题", { type: "error" }); const task = taskId ? v3State.tasks.find((item) => Number(item.id) === Number(taskId)) : null; if (taskId && !task) return showToast("任务不存在或已刷新，请重试", { type: "error" }); v3State.taskEditId = task?.id || null; v3State.taskEditVersion = task?.version || null; $("#v3TaskForm").reset(); $("#v3TaskDialogTitle").textContent = task ? "编辑任务" : "新增链任务"; $("#v3TaskDialogHint").textContent = task ? "所有任务配置在这里维护；保存后专题、执行中心和任务投影会一起刷新。" : "创建和编辑都在这里完成；保存后专题、执行中心和任务投影会一起刷新。"; $("#v3SaveTaskBtn").textContent = task ? "确认保存" : "确认创建"; $("#v3TaskRequired").checked = task ? task.is_required !== 0 : true; $("#v3TaskAfterArrival").checked = Boolean(task?.after_arrival); $("#v3TaskTitle").value = task?.title || ""; $("#v3TaskDescription").value = task?.description || ""; $("#v3TaskContextSummary").innerHTML = v3TaskContextText(task); $("#v3TaskPurpose").value = task?.test_purpose || v3State.topic.purpose || ""; $("#v3TaskItems").value = v3TaskItemsToText(task?.test_items || []); v3FormError("#v3TaskFormError"); v3State.preview = null; v3State.taskDraftMembers = task?.efforts?.map((e) => ({ member_id: e.member_id, planned_half_hours: e.planned_half_hours })) || []; v3RenderTaskSamples(task?.samples?.map((s) => s.id) || []); $("#v3TaskQuickSampleLabel").value = ""; $("#v3TaskQuickSampleModel").value = ""; $("#v3TaskQuickSampleIdentifier").value = ""; $("#v3TaskQuickSampleIdentifierKind").value = ""; $("#v3TaskQuickSampleEta").value = v3Today(); $("#v3TaskQuickSampleEtaPending").checked = false; $("#v3QuickSampleEditor").hidden = true; $("#v3ToggleQuickSampleBtn").setAttribute("aria-expanded", "false"); $("#v3QuickSampleStatus").textContent = ""; v3FillResourceSelects(); const defaultCryostat = task?.cryostat_id || v3State.topic.default_cryostat_id || ""; $("#v3TaskCryostat").value = defaultCryostat ? String(defaultCryostat) : ""; $("#v3TaskCryostatPending").checked = task ? Boolean(task.cryostat_pending) : !defaultCryostat; $("#v3TaskStartDate").value = task?.start_date || v3Today(); $("#v3TaskEndDate").value = task?.end_date || addDays(v3Today(), 1); v3RenderTaskMemberDraft(); v3Open($("#v3TaskDialog"), trigger); }
function v3RenderTaskPreview(result) { $("#v3TaskPreviewResult")?.remove(); const html = result.conflicts.length ? `<strong>需要人工确认的冲突：</strong><ul>${result.conflicts.map((c) => `<li>${v3Esc(c.type)} ${v3Esc(c.date || "")}</li>`).join("")}</ul><label><input id="v3TaskAck" type="checkbox"> 我确认继续</label>` : "<strong>预览通过，可确认保存。</strong>"; $("#v3TaskPreview").insertAdjacentHTML("beforeend", `<div id="v3TaskPreviewResult" class="v3-preview-result">${html}</div>`); }
async function v3PreviewTask() { try { const body = v3TaskBody(); if (!body.primary_member_id) throw new Error("请先人工选择至少一名成员"); if (!body.sample_ids.length) throw new Error("请至少选择一个样品"); const path = v3State.taskEditId ? `/api/v3/topic-tasks/${v3State.taskEditId}/preview` : `/api/v3/topics/${v3State.topic.id}/tasks/preview`; const result = await v3Api(path, v3Json("POST", body)); v3State.preview = result.data; v3RenderTaskPreview(result.data); } catch (error) { v3FormError("#v3TaskFormError", error); } }
async function v3SaveTask(event) { event.preventDefault(); try { if (!v3State.preview) { await v3PreviewTask(); return; } if (v3State.preview.conflicts.length && !$("#v3TaskAck")?.checked) throw new Error("请先确认预览中的冲突"); const body = { ...v3TaskBody(), preview_token: v3State.preview.preview_token, ack: true, actor: "本地用户" }; const taskId = v3State.taskEditId; const path = taskId ? `/api/v3/topic-tasks/${taskId}` : `/api/v3/topics/${v3State.topic.id}/tasks`; await v3Api(path, v3Json(taskId ? "PUT" : "POST", body)); const topicId = v3State.topic.id; v3Close($("#v3TaskDialog")); await v3RefreshAfterChange(topicId); showToast(taskId ? "任务已更新" : "连续任务已创建"); } catch (error) { v3FormError("#v3TaskFormError", error); } }
async function v3MoveTask(taskId, direction) {
  if (!v3State.topic || v3State.taskOrderBusy) return;
  const index = v3State.tasks.findIndex((task) => Number(task.id) === Number(taskId)); if (index < 0) return;
  const target = direction === "up" ? index - 1 : index + 1; if (target < 0 || target >= v3State.tasks.length) return;
  const previous = v3State.tasks.slice(); const reordered = previous.slice(); [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  v3State.tasks = reordered; v3State.taskOrderBusy = true; v3State.taskOrderNotice = "正在保存人工顺序…"; v3RenderTopic();
  try {
    const result = await v3Api(`/api/v3/topics/${v3State.topic.id}/task-order`, v3Json("PUT", { ordered_task_ids: reordered.map((task) => Number(task.id)), actor: "本地用户" }));
    const rows = result.data || result; if (Array.isArray(rows)) v3State.tasks = rows;
    v3State.topicDetails.set(v3State.topic.id, { topic: v3State.topic, samples: v3State.samples, tasks: v3State.tasks }); v3RebuildExecutionTaskIndex(); renderTasks(); renderDetail();
    v3State.taskOrderNotice = "顺序已保存"; showToast("任务顺序已更新");
  } catch (error) {
    try {
      await v3LoadTopic(v3State.topic.id);
      v3State.taskOrderNotice = `顺序保存失败：${v3ErrorText(error)}，已重新读取服务端顺序，请确认当前事实`;
    } catch (reloadError) {
      v3State.tasks = previous;
      v3State.taskOrderNotice = `顺序保存失败且无法重读服务端：${v3ErrorText(reloadError)}，请手动刷新确认`;
    }
    v3RenderTopic(); showToast(v3State.taskOrderNotice, { type: "error" });
  } finally { v3State.taskOrderBusy = false; v3RenderTopic(); }
}
function v3OpenTaskDetail(taskId, trigger) { return v3OpenTaskDialog(trigger, taskId); }
async function v3SaveTaskDetail(event) { event.preventDefault(); const task = v3State.tasks.find((item) => Number(item.id) === Number(v3State.activeTaskId)); if (!task) return; try { const body = v3TaskUpdateBody(task, { description: $("#v3TaskDetailDescription").value.trim(), test_purpose: $("#v3TaskDetailPurpose").value.trim(), test_items: v3TaskItemsFromText($("#v3TaskDetailItems").value) }); const acknowledged = Boolean($("#v3TaskDetailAck")?.checked); const preview = (await v3Api(`/api/v3/topic-tasks/${task.id}/preview`, v3Json("POST", body))).data; $("#v3TaskDetailPreview")?.remove(); if (preview.conflicts.length && !acknowledged) { $("#v3TaskDetailFacts").insertAdjacentHTML("afterend", `<section id="v3TaskDetailPreview" class="v3-preview"><strong>保存前需要人工确认：</strong><p>${preview.conflicts.map((item) => v3Esc(item.type)).join("、")}</p><label><input id="v3TaskDetailAck" type="checkbox"> 我确认继续</label></section>`); return; } await v3Api(`/api/v3/topic-tasks/${task.id}`, v3Json("PUT", { ...body, preview_token: preview.preview_token, ack: true, actor: "本地用户" })); v3Close($("#v3TaskDetailDialog")); await v3RefreshAfterChange(v3State.topic.id); showToast("任务定义已更新"); } catch (error) { v3FormError("#v3TaskDetailFormError", error); } }
function v3OpenMemberDialog(taskId, trigger) { const task = v3State.tasks.find((item) => Number(item.id) === Number(taskId)); if (!task) return; v3State.activeTaskId = task.id; v3State.editMembers = task.efforts?.map((e) => ({ member_id: e.member_id, planned_half_hours: e.planned_half_hours })) || []; const choices = $("#v3MemberChoices"); choices.innerHTML = v3State.members.map((m) => `<label><input type="checkbox" data-v3-edit-member value="${m.id}"${v3State.editMembers.some((e) => e.member_id === m.id) ? " checked" : ""}> ${v3Esc(m.name)}</label>`).join(""); $("#v3MemberHoursInputs").innerHTML = v3State.members.map((m) => `<label>${v3Esc(m.name)}<input type="number" min="0" step="0.5" data-v3-edit-hours="${m.id}" value="${(Number(v3State.editMembers.find((e) => e.member_id === m.id)?.planned_half_hours || 0) / 2)}"></label>`).join(""); $("#v3CoordinatorMember").innerHTML = `<option value="">未指定（保存时使用首个已选成员）</option>` + v3State.members.map((m) => `<option value="${m.id}"${m.id === task.primary_member_id ? " selected" : ""}>${v3Esc(m.name)}</option>`).join(""); v3FormError("#v3MemberFormError"); v3State.preview = null; v3Open($("#v3MemberDialog"), trigger); }
function v3ReadEditMembers() { return $$('[data-v3-edit-member]:checked').map((node) => ({ member_id: Number(node.value), planned_half_hours: Math.round(Number($(`[data-v3-edit-hours="${node.value}"]`)?.value || 0) * 2) })); }
async function v3SaveMembers(event) { event.preventDefault(); const task = v3State.tasks.find((item) => item.id === v3State.activeTaskId); if (!task) return; try { const members = v3ReadEditMembers(); if (!members.length) throw new Error("至少保留一名人工负责人"); const primary = Number($("#v3CoordinatorMember").value) || members[0].member_id; const body = { title: task.title, description: task.description, test_purpose: task.test_purpose || "", test_items: task.test_items || [], predecessor_task_id: null, sample_ids: task.samples.map((s) => s.id), position: task.position, is_required: task.is_required !== 0 ? 1 : 0, primary_member_id: primary, participant_member_ids: members.filter((m) => m.member_id !== primary).map((m) => m.member_id), member_efforts: members, cryostat_id: task.cryostat_id, cryostat_pending: task.cryostat_pending, start_date: task.start_date, end_date: task.end_date, after_arrival: task.after_arrival, expected_version: task.version }; const preview = (await v3Api(`/api/v3/topic-tasks/${task.id}/preview`, v3Json("POST", body))).data; v3State.preview = preview; $("#v3MemberPreview").innerHTML = `<h3 id="v3MemberPreviewTitle">成员与负载预览</h3><p>${preview.conflicts.length ? preview.conflicts.map((c) => v3Esc(c.type)).join("、") : "预览通过"}</p>${preview.conflicts.length ? '<label><input id="v3MemberAck" type="checkbox"> 我确认继续</label>' : ""}`; if (preview.conflicts.length && !$("#v3MemberAck")?.checked) throw new Error("请先勾选确认冲突"); await v3Api(`/api/v3/topic-tasks/${task.id}`, v3Json("PUT", { ...body, preview_token: preview.preview_token, ack: true, actor: "本地用户" })); v3Close($("#v3MemberDialog")); await v3RefreshAfterChange(v3State.topic.id); showToast("成员与工时已更新"); } catch (error) { v3FormError("#v3MemberFormError", error); } }
function v3OpenEta(sampleId, trigger) { const sample = v3State.samples.find((s) => s.id === Number(sampleId)); if (!sample) return; v3State.activeSampleId = sample.id; v3State.preview = null; $("#v3EtaDate").value = sample.current_eta_date || ""; $("#v3EtaPending").checked = Boolean(sample.eta_pending); $("#v3EtaCandidateTasks").innerHTML = "<p>填写新 ETA 后点击重新预览。</p>"; $("#v3EtaProtectedTasks").innerHTML = ""; v3FormError("#v3EtaFormError"); v3Open($("#v3EtaDialog"), trigger); }
async function v3PreviewEta() { try { const body = { new_eta_date: $("#v3EtaPending").checked ? null : $("#v3EtaDate").value || null, eta_pending: $("#v3EtaPending").checked ? 1 : 0, selected_task_ids: [] }; const result = (await v3Api(`/api/v3/samples/${v3State.activeSampleId}/eta/preview`, v3Json("POST", body))).data; v3State.preview = result; $("#v3EtaCandidateTasks").innerHTML = (result.eligible_tasks || []).map((task) => `<label><input type="checkbox" data-v3-eta-task value="${task.task_id}"> ${v3Esc(task.title || `任务 ${task.task_id}`)} ${v3Esc(task.old_start_date)}～${v3Esc(task.old_end_date)}</label>`).join("") || "<p>没有符合条件的未开始到样后任务。</p>"; $("#v3EtaProtectedTasks").innerHTML = (result.protected_tasks || []).map((task) => `<div>${v3Esc(task.title)} · ${v3Esc(task.reason)}</div>`).join("") || "<p>无受保护任务。</p>"; $("#v3EtaImpactPreview").innerHTML = `<h3 id="v3EtaImpactTitle">影响预览</h3><p>将更新样品 ETA；默认不平移任务，已选择 ${(result.selected_task_ids || []).length} 项。</p>`; } catch (error) { v3FormError("#v3EtaFormError", error); } }
async function v3SaveEta(event) { event.preventDefault(); try { if (!v3State.preview) await v3PreviewEta(); const selected = $$('[data-v3-eta-task]:checked').map((node) => Number(node.value)); const body = { new_eta_date: $("#v3EtaPending").checked ? null : $("#v3EtaDate").value || null, eta_pending: $("#v3EtaPending").checked ? 1 : 0, selected_task_ids: selected, preview_token: v3State.preview.preview_token, actor: "本地用户" }; await v3Api(`/api/v3/samples/${v3State.activeSampleId}/eta/confirm`, v3Json("POST", body)); const topicId = v3State.topic.id; v3Close($("#v3EtaDialog")); await v3RefreshAfterChange(topicId); showToast("样品 ETA 已更新"); } catch (error) { v3FormError("#v3EtaFormError", error); } }
function v3OpenCryostat(taskId, trigger) { const task = v3State.tasks.find((t) => t.id === Number(taskId)); if (!task) return; v3State.activeTaskId = task.id; $("#v3CryostatSelect").value = task.cryostat_id || ""; $("#v3CryostatPending").checked = Boolean(task.cryostat_pending); v3State.preview = null; v3FormError("#v3CryostatFormError"); v3Open($("#v3CryostatDialog"), trigger); }
async function v3PreviewCryostat() { try { const body = { new_cryostat_id: $("#v3CryostatPending").checked ? null : Number($("#v3CryostatSelect").value) || null, cryostat_pending: $("#v3CryostatPending").checked ? 1 : 0, task_ids: [v3State.activeTaskId] }; const result = (await v3Api(`/api/v3/topics/${v3State.topic.id}/cryostat/preview`, v3Json("POST", body))).data; v3State.preview = result; $("#v3CryostatPreview").innerHTML = `<h3 id="v3CryostatPreviewTitle">冲突预览</h3><p>${result.conflicts?.length ? result.conflicts.map((c) => v3Esc(c.type)).join("、") : "未发现冲突，可人工确认保存。"}</p>`; } catch (error) { v3FormError("#v3CryostatFormError", error); } }
async function v3SaveCryostat(event) { event.preventDefault(); try { if (!v3State.preview) await v3PreviewCryostat(); const body = { new_cryostat_id: $("#v3CryostatPending").checked ? null : Number($("#v3CryostatSelect").value) || null, cryostat_pending: $("#v3CryostatPending").checked ? 1 : 0, task_ids: [v3State.activeTaskId], preview_token: v3State.preview.preview_token, actor: "本地用户" }; await v3Api(`/api/v3/topics/${v3State.topic.id}/cryostat/confirm`, v3Json("POST", body)); const topicId = v3State.topic.id; v3Close($("#v3CryostatDialog")); await v3RefreshAfterChange(topicId); showToast("任务制冷机已更新"); } catch (error) { v3FormError("#v3CryostatFormError", error); } }
function v3OpenSubmission(taskId, trigger) { const task = v3State.tasks.find((t) => t.id === Number(taskId)); if (!task) return; v3State.activeTaskId = task.id; $("#v3SubmissionSampleItems").innerHTML = task.samples.map((s) => `<span>${v3Esc(s.planning_label)} · ${v3Esc(s.model)}</span>`).join(""); const items = v3State.template?.items || []; $("#v3SubmissionChecklistInput").innerHTML = items.map((item) => `<label><input type="checkbox" data-v3-submit-check value="${item.id}" checked> ${v3Esc(item.label)}</label>`).join("") || "<p>暂无验收模板条目，请先在资源维护中建立模板。</p>"; $("#v3SubmissionDescription").value = ""; $("#v3SubmissionResourceValue").value = ""; v3FormError("#v3SubmissionFormError"); v3Open($("#v3SubmissionDialog"), trigger); }
async function v3SaveSubmission(event) { event.preventDefault(); try { const task = v3State.tasks.find((t) => t.id === v3State.activeTaskId); if (!task) return; const resource = $("#v3SubmissionResourceValue").value.trim(); const kind = $("#v3SubmissionResourceKind").value; const resourceUrl = kind === "local_path" && !/^file:/i.test(resource) ? `file://${resource.replace(/^[/\\]+/, "")}` : resource; const body = { sample_ids: task.samples.map((s) => s.id), description: $("#v3SubmissionDescription").value.trim(), resource_url: resourceUrl, submitted_by: $("#v3SubmissionSubmitter").value.trim() || "本地用户", template_item_ids: $$('[data-v3-submit-check]').map((node) => ({ id: Number(node.value), checked: node.checked })) }; await v3Api(`/api/v3/tasks/${task.id}/submissions`, v3Json("POST", body)); const topicId = v3State.topic.id; v3Close($("#v3SubmissionDialog")); await v3RefreshAfterChange(topicId); setV2View("acceptance"); v3SetView("acceptance"); showToast("成果已提交，等待人工验收"); } catch (error) { v3FormError("#v3SubmissionFormError", error); } }
function v3OpenReview(submissionId, trigger) { const submission = v3State.submissions.find((row) => row.id === Number(submissionId)); if (!submission) return; v3State.activeSubmissionId = submission.id; let checklist = []; try { checklist = JSON.parse(submission.checklist_snapshot_json || "[]"); } catch {} $("#v3ReviewChecklist").innerHTML = checklist.map((item) => `<label><input type="checkbox" data-v3-review-check value="${item.id}"${item.checked ? " checked" : ""}> ${v3Esc(item.label)}</label>`).join(""); $("#v3ReviewSampleSnapshot").innerHTML = `<p>任务样品集合已按提交快照冻结。</p>`; $("#v3ReviewDecision").value = ""; $("#v3ReviewComment").value = ""; v3FormError("#v3ReviewFormError"); v3Open($("#v3ReviewDialog"), trigger); }
async function v3SaveReview(event) { event.preventDefault(); try { const decision = $("#v3ReviewDecision").value; if (!decision) throw new Error("请选择验收结论"); const body = { decision, reviewer: $("#v3ReviewerLabel").value.trim() || "本地用户", reason: $("#v3ReviewComment").value.trim(), checked_items: $$('[data-v3-review-check]').map((node) => ({ id: Number(node.value), passed: node.checked })) }; await v3Api(`/api/v3/submissions/${v3State.activeSubmissionId}/review`, v3Json("POST", body)); const topicId = v3State.topic.id; v3Close($("#v3ReviewDialog")); await v3RefreshAfterChange(topicId); showToast(decision === "accepted" ? "成果已通过" : "成果已退回"); } catch (error) { v3FormError("#v3ReviewFormError", error); } }
async function v3OpenLegacy(trigger) { const plans = (await v2Api("/api/v2/plans?limit=200")).data || []; $("#v3LegacyPlanSelect").innerHTML = `<option value="">请选择计划</option>` + plans.map((p) => `<option value="${p.id}">${v3Esc(p.name)}</option>`).join(""); v3FormError("#v3LegacyFormError"); v3Open($("#v3LegacyDialog"), trigger); }
async function v3PreviewLegacy() { try { const planId = Number($("#v3LegacyPlanSelect").value); if (!v3State.topic || !planId) throw new Error("请选择专题和旧计划"); v3State.preview = (await v3Api(`/api/v3/topics/${v3State.topic.id}/legacy-plans/preview`, v3Json("POST", { v2_plan_ids: [planId] }))).data; $("#v3LegacyPreview").innerHTML = `<h3 id="v3LegacyPreviewTitle">复制预览</h3><pre>${v3Esc(JSON.stringify(v3State.preview.snapshot, null, 2))}</pre>`; } catch (error) { v3FormError("#v3LegacyFormError", error); } }
async function v3SaveLegacy(event) { event.preventDefault(); try { if (!$("#v3LegacyAcknowledge").checked) throw new Error("请确认旧计划与专题独立维护"); if (!v3State.preview) await v3PreviewLegacy(); const topicId = v3State.topic.id; const planId = Number($("#v3LegacyPlanSelect").value); await v3Api(`/api/v3/topics/${topicId}/legacy-plans/confirm`, v3Json("POST", { v2_plan_ids: [planId], preview_token: v3State.preview.preview_token, actor: "本地用户" })); v3Close($("#v3LegacyDialog")); await v3RefreshAfterChange(topicId); showToast("旧计划已复制为历史引用"); } catch (error) { v3FormError("#v3LegacyFormError", error); } }
async function v3PreviewMigration() { try { const [status, backup] = await Promise.all([v3Api("/api/v3/status"), v3Api("/api/v3/backup")]); $("#v3MigrationChecks").innerHTML = `<li>数据版本 ${status.data.schema_version} · ${v3Esc(status.data.checksum)}</li><li>专题表 ${status.data.tables}、索引 ${status.data.indexes}、端点 ${status.data.endpoints}</li><li>备份接口可用：${v3Esc(backup.data.created_at)}</li>`; } catch (error) { v3FormError("#v3MigrationFormError", error); } }

async function v3OpenWorkbenchAction(trigger) {
  const action = trigger?.dataset.v3WorkbenchAction || "topic";
  const topicId = Number(trigger?.dataset.v3WorkbenchTopic);
  const taskId = Number(trigger?.dataset.v3WorkbenchTask) || null;
  if (!topicId) return;
  if (action === "execution") { await v3LoadTopic(topicId); v3State.activeTaskId = taskId; setV2View("execution"); v3SetView("execution"); return; }
  if (action === "assignment") { await v3LoadTopic(topicId); v3State.activeTaskId = taskId; setV2View("assignment"); v3SetView("assignment"); v3RenderAssignment(); return; }
  if (action === "acceptance") { await v3LoadTopic(topicId); v3State.activeTaskId = taskId; setV2View("acceptance"); v3SetView("acceptance"); v3RenderAcceptance(); return; }
  const returnView = v3State.activeView; await v3LoadTopic(topicId); if (returnView !== "plans") setV2View("plans"); v3SetView("plans"); v3CloseTopicDetail({ restoreFocus: false }); $("#v3TopicView")?.scrollIntoView({ block: "start" });
}
function v3BindDialog(id, closeId, cancelId) { const dialog = $(id); if (!dialog) return; [closeId, cancelId].forEach((button) => $(button)?.addEventListener("click", () => v3Close(dialog))); dialog.addEventListener("cancel", (event) => { event.preventDefault(); v3Close(dialog); }); }
function bindV3Events() {
  if (window.__v3Bound) return; window.__v3Bound = true;
  $("#v3TopicModeBtn")?.addEventListener("click", () => v3ShowMode("topic")); $("#v2LegacyModeBtn")?.addEventListener("click", () => v3ShowMode("legacy"));
  $$('[data-v2-view]').forEach((tab) => tab.addEventListener("click", () => {
    const view = tab.dataset.v2View || "workbench";
    if (v3State.mode === "legacy" && view !== "plans") v3ShowMode("topic");
    if (v3State.mode === "topic") v3SetView(view);
  }));
  $("#dataMenuBtn")?.addEventListener("click", () => {
    if (v3State.mode === "legacy") v3State.mode = "topic";
    v3SetView("management");
  });
  $("#refreshBtn")?.addEventListener("click", () => {
    if (v3State.mode !== "topic") return;
    Promise.all([v3LoadMembers(), v3LoadTopics()]).catch((error) => showToast(v3ErrorText(error), { type: "error" }));
  });
  $("#v3NewTopicBtn")?.addEventListener("click", (event) => v3OpenTopicDialog(event.currentTarget));
  $("#v3TopicSearchInput")?.addEventListener("input", (event) => { v3State.search = event.target.value.trim(); window.clearTimeout(v3State.searchTimer); v3State.searchTimer = window.setTimeout(() => v3LoadTopics().catch((e) => showToast(v3ErrorText(e), { type: "error" })), 220); });
  $("#v3TopicSourceGroup")?.addEventListener("change", (event) => v3FillContacts(event.target.value));
  $("#v3TopicStatusFilter")?.addEventListener("change", (event) => { v3State.status = event.target.value; v3RenderTopics(); }); $("#v3TopicSourceFilter")?.addEventListener("change", (event) => { v3State.source = event.target.value; v3RenderTopics(); }); $("#v3WindowDays")?.addEventListener("change", (event) => { v3State.windowDays = clamp(Number(event.target.value) || 7, 0, 365); event.target.value = String(v3State.windowDays); v3RenderTopics(); }); $("#v3IncludeArchived")?.addEventListener("change", (event) => { v3State.includeArchived = event.target.checked; v3LoadTopics().catch((e) => showToast(v3ErrorText(e), { type: "error" })); });
  $("#v3TopicGroupBy")?.addEventListener("change", (event) => { v3State.groupBy = event.target.value; v3RenderTopics(); });
  $("#v3TopicCryostatFilter")?.addEventListener("change", (event) => { v3State.cryostat = event.target.value; v3RenderTopics(); });
  $("#v3OnlyPending")?.addEventListener("change", (event) => { v3State.onlyPending = event.target.checked; v3RenderTopics(); });
  $$("#v3WorkbenchSummaryGrid [data-v3-workbench-stat]").forEach((card) => card.addEventListener("click", () => { const key = card.dataset.v3WorkbenchStat; v3State.workbenchFocus = v3State.workbenchFocus === key ? "" : key; v3RenderTopics(); }));
  $$("#v3TopicStats [data-v3-stat]").forEach((card) => card.addEventListener("click", () => { v3State.status = v3State.status === card.dataset.v3Stat ? "" : card.dataset.v3Stat; $("#v3TopicStatusFilter").value = v3State.status; v3RenderTopics(); }));
  $$('[data-v3-topic-view]').forEach((tab) => tab.addEventListener("click", () => { $$('[data-v3-topic-view]').forEach((item) => { item.classList.toggle("active", item === tab); item.setAttribute("aria-selected", String(item === tab)); }); $$('[data-v3-topic-panel]').forEach((panel) => { panel.hidden = panel.dataset.v3TopicPanel !== tab.dataset.v3TopicView; panel.classList.toggle("active", !panel.hidden); }); }));
  $("#v3TopicForm")?.addEventListener("submit", v3SaveTopic); $("#v3SampleForm")?.addEventListener("submit", v3SaveSample); $("#v3TaskForm")?.addEventListener("submit", v3SaveTask); $("#v3TaskDetailForm")?.addEventListener("submit", v3SaveTaskDetail); $("#v3MemberForm")?.addEventListener("submit", v3SaveMembers); $("#v3EtaForm")?.addEventListener("submit", v3SaveEta); $("#v3CryostatForm")?.addEventListener("submit", v3SaveCryostat); $("#v3SubmissionForm")?.addEventListener("submit", v3SaveSubmission); $("#v3ReviewForm")?.addEventListener("submit", v3SaveReview); $("#v3LegacyForm")?.addEventListener("submit", v3SaveLegacy);
  $("#v3ToggleQuickSampleBtn")?.addEventListener("click", v3ToggleQuickSampleEditor); $("#v3QuickSampleSaveBtn")?.addEventListener("click", v3QuickAddTaskSample);
  $("#v3TaskForm")?.addEventListener("input", (event) => { if (event.target.closest("#v3TaskPreviewResult")) return; v3State.preview = null; $("#v3TaskPreviewResult")?.remove(); v3FormError("#v3TaskFormError"); }); $("#v3TaskForm")?.addEventListener("change", (event) => { if (event.target.closest("#v3TaskPreviewResult")) return; v3State.preview = null; $("#v3TaskPreviewResult")?.remove(); });
  $("#v3PreviewTaskBtn")?.addEventListener("click", v3PreviewTask); $("#v3PreviewEtaBtn")?.addEventListener("click", v3PreviewEta); $("#v3PreviewCryostatBtn")?.addEventListener("click", v3PreviewCryostat); $("#v3PreviewLegacyBtn")?.addEventListener("click", v3PreviewLegacy); $("#v3PreviewMigrationBtn")?.addEventListener("click", v3PreviewMigration);
  $("#v3AssignmentTopicFilter")?.addEventListener("change", async (event) => { const id = Number(event.target.value); if (id) { await v3LoadTopic(id); setV2View("assignment"); v3SetView("assignment"); } }); $("#v3AcceptanceTopicFilter")?.addEventListener("change", async (event) => { const id = Number(event.target.value); if (id) await v3LoadTopic(id); v3RenderAcceptance(); }); $("#v3AcceptanceStatusFilter")?.addEventListener("change", (event) => { v3State.acceptanceStatus = event.target.value; v3RenderAcceptance(); });
  const dialogs = [["#v3TopicDialog", "#v3CloseTopicDialogBtn", "#v3CancelTopicBtn"], ["#v3SampleDialog", "#v3CloseSampleDialogBtn", "#v3CancelSampleBtn"], ["#v3TaskDialog", "#v3CloseTaskDialogBtn", "#v3CancelTaskBtn"], ["#v3TaskDetailDialog", "#v3CloseTaskDetailDialogBtn", "#v3CancelTaskDetailBtn"], ["#v3MemberDialog", "#v3CloseMemberDialogBtn", "#v3CancelMemberBtn"], ["#v3EtaDialog", "#v3CloseEtaDialogBtn", "#v3CancelEtaBtn"], ["#v3CryostatDialog", "#v3CloseCryostatDialogBtn", "#v3CancelCryostatBtn"], ["#v3SubmissionDialog", "#v3CloseSubmissionDialogBtn", "#v3CancelSubmissionBtn"], ["#v3ReviewDialog", "#v3CloseReviewDialogBtn", "#v3CancelReviewBtn"], ["#v3LegacyDialog", "#v3CloseLegacyDialogBtn", "#v3CancelLegacyBtn"], ["#v3MigrationDialog", "#v3CloseMigrationDialogBtn", "#v3CancelMigrationBtn"]]; dialogs.forEach((item) => v3BindDialog(...item));
  $("#v3CloseTopicDetailBtn")?.addEventListener("click", () => v3CloseTopicDetail());
  document.addEventListener("keydown", (event) => { if (event.key !== "Escape" || event.defaultPrevented) return; const openDialog = document.querySelector("dialog[open]"); if (openDialog) return; const pane = $("#v3TopicDetailPane"); if (pane && !pane.hidden) v3CloseTopicDetail(); });
  document.body.addEventListener("keydown", (event) => {
    const row = event.target.closest?.("[data-v3-open-topic]");
    if (!row || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    row.click();
  });
  document.body.addEventListener("click", async (event) => { const action = (selector) => event.target.closest(selector); try {
    if (action("[data-v3-workbench-action]")) return v3OpenWorkbenchAction(action("[data-v3-workbench-action]"));
    if (action("[data-v3-open-topic]")) { const trigger = action("[data-v3-open-topic]"), returnView = v3State.activeView; const id = Number(trigger.dataset.v3OpenTopic); await v3LoadTopic(id); if (returnView !== "plans") setV2View("plans"); v3SetView("plans"); v3CloseTopicDetail({ restoreFocus: false }); $("#v3TopicView")?.scrollIntoView({ block: "start" }); return; }
    if (action("[data-v3-clear-topic-filters]")) { v3State.status = ""; v3State.source = ""; v3State.cryostat = ""; v3State.onlyPending = false; v3State.workbenchFocus = ""; $("#v3TopicStatusFilter").value = ""; $("#v3TopicSourceFilter").value = ""; $("#v3TopicCryostatFilter").value = ""; $("#v3OnlyPending").checked = false; v3RenderTopics(); return; }
    if (action("[data-v3-open-topic-dialog]")) return v3OpenTopicDialog(action("[data-v3-open-topic-dialog]"));
    if (action("[data-v3-open-topic-edit]")) return v3OpenTopicDialog(action("[data-v3-open-topic-edit]"), action("[data-v3-open-topic-edit]").dataset.v3OpenTopicEdit);
    if (action("[data-v3-open-sample-dialog]")) return v3OpenSampleDialog(action("[data-v3-open-sample-dialog]"));
    if (action("[data-v3-open-sample-edit]")) return v3OpenSampleDialog(action("[data-v3-open-sample-edit]"), action("[data-v3-open-sample-edit]").dataset.v3OpenSampleEdit);
    if (action("[data-v3-open-task-dialog]")) return v3OpenTaskDialog(action("[data-v3-open-task-dialog]"));
    if (action("[data-v3-move-task]")) return v3MoveTask(action("[data-v3-move-task]").dataset.v3TaskId, action("[data-v3-move-task]").dataset.v3MoveTask);
    if (action("[data-v3-open-task-editor]")) return v3OpenTaskDialog(action("[data-v3-open-task-editor]"), action("[data-v3-open-task-editor]").dataset.v3OpenTaskEditor);
    if (action("[data-v3-open-task-detail]")) return v3OpenTaskDetail(action("[data-v3-open-task-detail]").dataset.v3OpenTaskDetail, action("[data-v3-open-task-detail]"));
    if (action("[data-v3-open-member-dialog]")) { if (!v3State.activeTaskId) return showToast("请先选择任务", { type: "error" }); return v3OpenTaskDialog(action("[data-v3-open-member-dialog]"), v3State.activeTaskId); }
    if (action("[data-v3-open-member]")) { setV2View("assignment"); v3SetView("assignment"); return v3OpenTaskDialog(action("[data-v3-open-member]"), action("[data-v3-open-member]").dataset.v3OpenMember); }
    if (action("[data-v3-open-eta]")) return v3OpenEta(action("[data-v3-open-eta]").dataset.v3OpenEta, action("[data-v3-open-eta]"));
    if (action("[data-v3-open-cryostat]")) return v3OpenTaskDialog(action("[data-v3-open-cryostat]"), action("[data-v3-open-cryostat]").dataset.v3OpenCryostat);
    if (action("[data-v3-open-submission]")) return v3OpenSubmission(action("[data-v3-open-submission]").dataset.v3OpenSubmission, action("[data-v3-open-submission]"));
    if (action("[data-v3-open-review]")) return v3OpenReview(action("[data-v3-open-review]").dataset.v3OpenReview, action("[data-v3-open-review]"));
    if (action("[data-v3-open-legacy-dialog]")) return v3OpenLegacy(action("[data-v3-open-legacy-dialog]"));
    if (action("[data-v3-open-migration-preview]")) { v3Open($("#v3MigrationDialog"), action("[data-v3-open-migration-preview]")); return v3PreviewMigration(); }
  } catch (error) { showToast(v3ErrorText(error), { type: "error" }); } });
}

bindV3Events();
v3ShowMode("topic");

// V5 unified desktop workspace. The V4 DOM remains in a hidden compatibility
// container so old links and data projections can continue to be loaded while
// all new edits use the V5 canonical service endpoints.
const v5State = {
  resources: { source_groups: [], members: [], cryostats: [] },
  topics: [],
  tasks: [],
  samples: [],
  expandedTopics: new Set(),
  selectedTaskId: null,
  editingTaskId: null,
  editingTopicId: null,
  editingResource: null,
  dialogSampleIds: new Set(),
  dialogSampleDrafts: new Map(),
  dialogMemberIds: new Set(),
  dialogMemberDates: new Map(),
  inlineMemberIds: new Set(),
  customComboboxOptions: {},
  resourceSearch: {},
  filterExpressions: {
    editor: { groups: [] },
    execution: { groups: [] }
  },
  filterDraft: null,
  filterDraftSurface: "",
  showArchivedTopics: false,
  topicMove: null,
  execution: {
    activeView: "gantt",
    scale: "week",
    granularity: 3,
    range: "smart",
    onlyBusy: false,
    stack: true,
    search: "",
    sourceId: "",
    topicId: "",
    status: "",
    memberId: "",
    sampleId: "",
    cryostatId: "",
    from: "",
    to: "",
    memberSearch: "",
    anchorDate: null,
    selectedTaskId: null,
    schedule: null
  },
  loaded: false
};

const v5StatusMeta = {
  waiting: { label: "等待样品", icon: "○" },
  "sample-delayed": { label: "样品交付延期", icon: "!" },
  testing: { label: "正在测试", icon: "▶" },
  "test-delayed": { label: "测试延期", icon: "!" },
  completed: { label: "已完成", icon: "✓" }
};
const v5ResourceLabels = { "source-groups": "来源小组", members: "测控成员", cryostats: "制冷机" };
const v5ResourceKeys = { "source-groups": "source_groups", members: "members", cryostats: "cryostats" };
function v5ResourceRows(kind) { return v5State.resources[v5ResourceKeys[kind] || kind] || []; }

async function v5Api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const apiError = payload?.error;
    const error = new Error(typeof apiError === "object" ? apiError?.message || "V5 请求失败" : apiError || "V5 请求失败");
    error.code = (typeof apiError === "object" ? apiError?.code : payload?.code) || "REQUEST_FAILED";
    error.details = (typeof apiError === "object" ? apiError?.details : payload?.details) || {};
    error.status = response.status;
    throw error;
  }
  return payload?.data !== undefined ? payload.data : payload;
}

function v5Json(method, payload) { return { method, body: JSON.stringify(payload) }; }
function v5ErrorText(error) {
  const labels = { VERSION_CONFLICT: "数据已被其他操作更新，请刷新后重试。", STALE_PREVIEW: "保存预览已过期，请重新确认。", RESOURCE_DISABLED: "资源已停用，请重新选择启用资源。", CONFLICTS_NOT_ACKNOWLEDGED: "存在排期冲突，请确认后再保存。" };
  if (error?.code === "VALIDATION_ERROR" && error.details?.field) return `${error.details.field}：${error.details.reason || "填写内容不符合要求"}`;
  return labels[error?.code] || error?.message || "操作失败";
}
function v5SetSync(message, isError = false) { const node = $("#v5SyncStatus"); if (node) { node.textContent = message; node.classList.toggle("is-error", isError); } }
function v5Open(id) { const dialog = $(id); if (!dialog) return; if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", ""); }
function v5Close(id) { const dialog = $(id); if (!dialog) return; if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); }
function v5SetFormError(id, message = "") { const node = $(id); if (!node) return; node.textContent = message; node.hidden = !message; }
function v5Option(value, label, selected = false, disabled = false) { return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}${disabled ? " disabled" : ""}>${escapeHtml(label)}</option>`; }
function v5ResourceActive(kind, item) { return kind === "source-groups" ? Number(item.is_active) === 1 : kind === "members" ? item.status === "active" : item.status === "active"; }
function v5ResourceName(kind, id) { const item = v5ResourceRows(kind).find((row) => Number(row.id) === Number(id)); return item?.name || "待补充"; }
function v5TopicName(id) { return v5State.topics.find((row) => Number(row.id) === Number(id))?.name || "无专题"; }
function v5StatusChip(task) { const meta = v5StatusMeta[task.status] || v5StatusMeta.waiting; return `<span class="v5-status-chip status-${escapeHtml(task.status || "waiting")}" title="${escapeHtml(meta.label)}">${meta.icon} ${meta.label}</span>`; }
function v5TaskSearchText(task) { return [task.task_number, task.title, task.purpose, task.notes, task.topic?.name, task.source_group?.name, task.cryostat?.name, ...(task.samples || []).flatMap((sample) => [sample.model, sample.sample_no, sample.notes]), ...(task.test_items || []).flatMap((item) => [item.name, item.acceptance_criteria, item.note]), ...(task.participants || []).map((member) => member.name)].join(" ").toLowerCase(); }
const v5FilterStatusOptions = [{ value: "waiting", label: "等待样品" }, { value: "sample-delayed", label: "样品交付延期" }, { value: "testing", label: "正在测试" }, { value: "test-delayed", label: "测试延期" }, { value: "completed", label: "已完成" }];
const v5FilterSchemas = {
  editor: [
    { field: "search", label: "关键词", kind: "text", supportsNegate: true },
    { field: "sourceId", label: "来源小组", kind: "multi", source: "source_groups", supportsNegate: true },
    { field: "status", label: "状态", kind: "multi", source: "status", supportsNegate: true },
    { field: "cryostatId", label: "制冷机", kind: "multi", source: "cryostats", supportsNegate: true }
  ],
  execution: [
    { field: "search", label: "关键词", kind: "text", supportsNegate: true },
    { field: "sourceId", label: "来源小组", kind: "multi", source: "source_groups", supportsNegate: true },
    { field: "topicId", label: "专题", kind: "multi", source: "topics", supportsNegate: true },
    { field: "status", label: "状态", kind: "multi", source: "status", supportsNegate: true },
    { field: "memberId", label: "成员", kind: "multi", source: "members", supportsNegate: true },
    { field: "sampleId", label: "样品", kind: "multi", source: "samples", supportsNegate: true },
    { field: "cryostatId", label: "制冷机", kind: "multi", source: "cryostats", supportsNegate: true },
    { field: "from", label: "开始日期不晚于", kind: "date", supportsNegate: false },
    { field: "to", label: "结束日期不早于", kind: "date", supportsNegate: false }
  ]
};
function v5FilterSchema(surface, field) { return (v5FilterSchemas[surface] || []).find((schema) => schema.field === field) || null; }
function v5EmptyFilterExpression() { return { groups: [] }; }
function v5CloneFilterExpression(expression) { return JSON.parse(JSON.stringify(expression || v5EmptyFilterExpression())); }
function v5FilterConditionHasValue(condition) { return Array.isArray(condition?.value) ? condition.value.length > 0 : String(condition?.value || "").trim() !== ""; }
function v5FilterNormaliseValues(condition) { return Array.isArray(condition?.value) ? condition.value.map(String).filter(Boolean) : String(condition?.value || "").trim() ? [String(condition.value)] : []; }
function v5FilterOptionValues(surface, schema) {
  if (schema.source === "status") return v5FilterStatusOptions;
  if (schema.source === "source_groups") return v5State.resources.source_groups.filter((item) => v5ResourceActive("source-groups", item) || v5State.tasks.some((task) => Number(task.source_group_id) === Number(item.id))).map((item) => ({ value: item.id, label: `${item.name}${v5ResourceActive("source-groups", item) ? "" : "（停用）"}` }));
  if (schema.source === "topics") return v5State.topics.filter((topic) => topic.status === "active" || v5State.tasks.some((task) => Number(task.topic_id) === Number(topic.id))).map((item) => ({ value: item.id, label: `${item.name}${item.status === "archived" ? "（归档）" : ""}` }));
  if (schema.source === "members") return v5State.resources.members.filter((item) => v5ResourceActive("members", item) || v5State.tasks.some((task) => v5ExecutionTaskMembers(task).some((member) => Number(member.id) === Number(item.id)))).map((item) => ({ value: item.id, label: `${item.name}${item.role ? ` · ${item.role}` : ""}` }));
  if (schema.source === "samples") return v5State.samples.map((item) => ({ value: item.id, label: `${item.model || "未命名样品"}${item.sample_no ? ` · ${item.sample_no}` : ""}`, search: item.notes || "" }));
  if (schema.source === "cryostats") return v5State.resources.cryostats.filter((item) => v5ResourceActive("cryostats", item) || v5State.tasks.some((task) => Number(task.cryostat_id) === Number(item.id))).map((item) => ({ value: item.id, label: `${item.name}${v5ResourceActive("cryostats", item) ? "" : "（停用）"}` }));
  return [];
}
function v5FilterKeywordOptionValues(surface) {
  if (!["editor", "execution"].includes(surface)) return [];
  const values = new Set(); const add = (value) => { const text = String(value || "").trim(); if (text) values.add(text); };
  v5State.tasks.forEach((task) => {
    [task.task_number, task.title, task.topic?.name, task.source_group?.name, task.cryostat?.name].forEach(add);
    (task.samples || []).forEach((sample) => [sample.model, sample.sample_no, sample.notes].forEach(add));
    (task.test_items || []).forEach((item) => add(item.name));
    (task.participants || []).forEach((member) => add(member.name));
  });
  return [...values].sort((left, right) => left.localeCompare(right, "zh-CN")).slice(0, 120);
}
function v5FilterAutocompleteOptions(surface, schema) {
  if (schema?.kind === "text") return v5FilterKeywordOptionValues(surface).map((value) => ({ value, label: value }));
  return v5FilterOptionValues(surface, schema).map((option) => ({ value: String(option.value), label: option.label }));
}
function v5FilterKeywordMatches(surface, query) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("zh-CN");
  return v5FilterKeywordOptionValues(surface).filter((value) => !normalizedQuery || value.toLocaleLowerCase("zh-CN").includes(normalizedQuery)).slice(0, 20);
}
function v5FilterAutocompleteMatches(surface, schema, query) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("zh-CN");
  return v5FilterAutocompleteOptions(surface, schema).filter((option) => !normalizedQuery || `${option.label} ${option.value}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery)).slice(0, 20);
}
function v5FilterKeywordInput(key) { return document.querySelector(`[data-v5-filter-autocomplete-input="${key}"]`); }
function v5FilterKeywordMenu(key) { return document.querySelector(`[data-v5-filter-options="${key}"]`); }
function v5FilterCloseKeywordSuggestions(key) {
  const menu = v5FilterKeywordMenu(key); const input = v5FilterKeywordInput(key); if (!menu) return;
  menu.hidden = true; if (input) input.setAttribute("aria-expanded", "false");
}
function v5FilterRenderAutocompleteSuggestions(surface, schema, key, query = "", condition = null) {
  const menu = v5FilterKeywordMenu(key); const input = v5FilterKeywordInput(key); if (!menu) return;
  const values = v5FilterAutocompleteMatches(surface, schema, query); const selected = new Set(v5FilterNormaliseValues(condition || {}));
  menu.innerHTML = values.length ? values.map((option) => `<button type="button" class="v5-filter-autocomplete-option${selected.has(String(option.value)) ? " is-selected" : ""}" role="option" data-v5-filter-option="${key}" data-v5-filter-option-value="${escapeHtml(option.value)}"${schema.kind === "multi" ? " data-v5-filter-option-multi=\"true\"" : ""}><span>${escapeHtml(option.label)}</span>${schema.kind === "multi" && selected.has(String(option.value)) ? "<small>已选</small>" : ""}</button>`).join("") : `<span class="v5-filter-autocomplete-empty">${schema.kind === "multi" ? "没有匹配候选项" : "没有匹配候选项，可继续自由输入"}</span>`;
  menu.hidden = false; if (input) input.setAttribute("aria-expanded", "true");
}
function v5ShowFilterAutocompleteForInput(input) {
  if (!input || !v5State.filterDraft) return false;
  const key = input.dataset.v5FilterAutocompleteInput; const [groupIndex, conditionIndex] = key.split("-").map(Number); const condition = v5State.filterDraft.groups[groupIndex]?.conditions?.[conditionIndex]; const schema = v5FilterSchema(v5State.filterDraftSurface, condition?.field);
  if (!schema) return false;
  v5FilterRenderAutocompleteSuggestions(v5State.filterDraftSurface, schema, key, input.value, condition);
  return true;
}
function v5FilterRenderKeywordSuggestions(surface, key, query = "") { const [groupIndex, conditionIndex] = key.split("-").map(Number); const condition = v5State.filterDraft?.groups?.[groupIndex]?.conditions?.[conditionIndex]; const schema = v5FilterSchema(surface, condition?.field) || v5FilterSchema(surface, "search") || { kind: "text" }; v5FilterRenderAutocompleteSuggestions(surface, schema, key, query, condition); }
function v5FilterCloseAllKeywordSuggestions() { $$('[data-v5-filter-options]').forEach((menu) => v5FilterCloseKeywordSuggestions(menu.dataset.v5FilterOptions)); }
function v5CloseAllV5AutocompleteMenus() { $$(".v5-filter-autocomplete-menu").forEach((menu) => { menu.hidden = true; const input = menu.closest(".v5-filter-autocomplete, .v5-task-autocomplete, .v5-resource-search-autocomplete")?.querySelector("input"); if (input) input.setAttribute("aria-expanded", "false"); }); }
function v5FilterTaskValues(task, field) {
  if (field === "search") return [v5TaskSearchText(task)];
  if (field === "sourceId") return task.source_group_id == null ? [] : [String(task.source_group_id)];
  if (field === "topicId") return task.topic_id == null ? [] : [String(task.topic_id)];
  if (field === "status") return task.status ? [String(task.status)] : [];
  if (field === "memberId") return v5ExecutionTaskMembers(task).map((member) => String(member.id));
  if (field === "sampleId") return (task.samples || []).map((sample) => String(sample.id));
  if (field === "cryostatId") return task.cryostat_id == null ? [] : [String(task.cryostat_id)];
  if (field === "from") return v5ExecutionDateValue(task.end_date) ? [task.end_date] : [];
  if (field === "to") return v5ExecutionDateValue(task.start_date) ? [task.start_date] : [];
  return [];
}
function v5FilterConditionMatches(task, condition) {
  const schema = v5FilterSchema(condition.surface, condition.field) || v5FilterSchema("execution", condition.field) || v5FilterSchema("editor", condition.field); if (!schema || !v5FilterConditionHasValue(condition)) return true;
  const selected = v5FilterNormaliseValues(condition); const taskValues = v5FilterTaskValues(task, condition.field); let matches;
  if (schema.kind === "text") matches = taskValues.some((value) => String(value).toLocaleLowerCase("zh-CN").includes(selected[0].toLocaleLowerCase("zh-CN")));
  else if (schema.kind === "date") matches = !taskValues.length || (condition.field === "from" ? taskValues.some((value) => value >= selected[0]) : taskValues.some((value) => value <= selected[0]));
  else matches = condition.match === "all" ? selected.every((value) => taskValues.includes(value)) : selected.some((value) => taskValues.includes(value));
  return condition.negate ? !matches : matches;
}
function v5FilterGroupMatches(task, group) { const conditions = (group?.conditions || []).filter(v5FilterConditionHasValue); if (!conditions.length) return true; return group.logic === "or" ? conditions.some((condition) => v5FilterConditionMatches(task, condition)) : conditions.every((condition) => v5FilterConditionMatches(task, condition)); }
function v5FilterExpressionMatches(task, expression) { const groups = (expression?.groups || []).filter((group) => (group.conditions || []).some(v5FilterConditionHasValue)); if (!groups.length) return true; let result = v5FilterGroupMatches(task, groups[0]); for (let index = 1; index < groups.length; index += 1) { const groupResult = v5FilterGroupMatches(task, groups[index]); result = groups[index].connector === "or" ? result || groupResult : result && groupResult; } return result; }
function v5FilterExpressionSummary(expression) { const groups = (expression?.groups || []).flatMap((group) => (group.conditions || []).filter(v5FilterConditionHasValue)); return groups.length ? `${groups.length} 条条件` : "未设置组合筛选"; }
function v5FilterQuickConfig(surface) {
  if (surface === "editor") return [{ field: "search", selector: "#v5TaskSearch", negate: "#v5TaskSearchNot" }, { field: "sourceId", selector: "#v5TaskSourceFilter", negate: "#v5TaskSourceNot" }, { field: "status", selector: "#v5TaskStatusFilter", negate: "#v5TaskStatusNot" }, { field: "cryostatId", selector: "#v5TaskCryostatFilter", negate: "#v5TaskCryostatNot" }];
  return [{ field: "search", selector: "#v5ExecutionSearch", negate: "#v5ExecutionSearchNot" }, { field: "sourceId", selector: "#v5ExecutionSource", negate: "#v5ExecutionSourceNot" }, { field: "topicId", selector: "#v5ExecutionTopic", negate: "#v5ExecutionTopicNot" }, { field: "status", selector: "#v5ExecutionStatus", negate: "#v5ExecutionStatusNot" }, { field: "memberId", selector: "#v5ExecutionMember", negate: "#v5ExecutionMemberNot" }, { field: "sampleId", selector: "#v5ExecutionSample", negate: "#v5ExecutionSampleNot" }, { field: "cryostatId", selector: "#v5ExecutionCryostat", negate: "#v5ExecutionCryostatNot" }, { field: "from", selector: "#v5ExecutionFrom" }, { field: "to", selector: "#v5ExecutionTo" }];
}
function v5FilterQuickValue(node, schema) { if (!node) return ""; return schema?.kind === "multi" ? String(node.dataset.v5QuickValue || "") : String(node.value || ""); }
function v5FilterExpressionFromQuick(surface) { const group = { id: `group-${Date.now()}`, logic: "and", connector: "and", conditions: [] }; v5FilterQuickConfig(surface).forEach(({ field, selector, negate }) => { const node = $(selector); const schema = v5FilterSchema(surface, field); const value = v5FilterQuickValue(node, schema); if (!value) return; group.conditions.push({ id: `condition-${field}-${Date.now()}-${group.conditions.length}`, surface, field, value: schema?.kind === "multi" ? [String(value)] : value, match: "any", negate: Boolean(negate && $(negate)?.checked) }); }); return group.conditions.length ? { groups: [group] } : v5EmptyFilterExpression(); }
function v5EnsureFilterExpression(surface) { if (!v5State.filterExpressions[surface] || !Array.isArray(v5State.filterExpressions[surface].groups) || !v5State.filterExpressions[surface].groups.length) v5State.filterExpressions[surface] = v5FilterExpressionFromQuick(surface); return v5State.filterExpressions[surface]; }
function v5FilteredTasks() {
  // The editor projection has one filter source of truth; do not reintroduce
  // a legacy status branch that can run outside the task callback scope.
  const expression = v5EnsureFilterExpression("editor");
  return v5State.tasks.filter((task) => v5FilterExpressionMatches(task, expression));
}
function v5FilterFieldConditions(surface, field, expression = v5EnsureFilterExpression(surface)) { return (expression.groups || []).flatMap((group) => group.conditions || []).filter((condition) => condition.field === field && v5FilterConditionHasValue(condition)); }
function v5RenderQuickFilterState(surface) {
  const expression = v5EnsureFilterExpression(surface); const summary = v5FilterExpressionSummary(expression); const summaryNode = surface === "editor" ? $("#v5EditorFilterSummary") : $("#v5ExecutionFilterSummary"); if (summaryNode) summaryNode.textContent = summary;
  v5FilterQuickConfig(surface).forEach(({ field, selector, negate }) => { const node = $(selector); const conditions = v5FilterFieldConditions(surface, field, expression); const condition = conditions.length === 1 ? conditions[0] : null; if (node) { const values = condition ? v5FilterNormaliseValues(condition) : []; const schema = v5FilterSchema(surface, field); const option = schema?.kind === "multi" ? v5FilterAutocompleteOptions(surface, schema).find((item) => String(item.value) === String(values[0])) : null; node.dataset.v5QuickValue = values.length === 1 ? values[0] : ""; node.value = option?.label || (schema?.kind === "text" ? values[0] || "" : ""); node.title = values.length > 1 ? `组合条件：${values.length} 个值` : ""; } if (negate) { const toggle = $(negate); toggle.checked = Boolean(condition?.negate); toggle.indeterminate = conditions.length > 1; } });
  v5RenderQuickAutocompleteOptions(surface);
}

function v5QuickAutocompleteMenu(key) { return document.querySelector(`[data-v5-quick-options="${key}"]`); }
function v5QuickAutocompleteInput(key) { return document.querySelector(`[data-v5-quick-input="${key}"]`); }
function v5QuickAutocompleteOptions(surface, field) { const schema = v5FilterSchema(surface, field); return schema ? v5FilterAutocompleteOptions(surface, schema) : []; }
function v5RenderQuickAutocomplete(surface, field, query = "") {
  const key = `${surface}-${field}`; const input = v5QuickAutocompleteInput(key); const menu = v5QuickAutocompleteMenu(key); if (!input || !menu) return;
  const schema = v5FilterSchema(surface, field); const normalized = String(query || "").trim().toLocaleLowerCase("zh-CN"); const options = v5QuickAutocompleteOptions(surface, field).filter((option) => !normalized || `${option.label} ${option.value}`.toLocaleLowerCase("zh-CN").includes(normalized)).slice(0, 20); const selected = String(input.dataset.v5QuickValue || "");
  const clearLabel = schema?.kind === "text" ? "清除关键词" : `全部${schema?.label || "选项"}`; const clear = `<button type="button" class="v5-filter-autocomplete-option${!selected && !input.value ? " is-selected" : ""}" role="option" data-v5-quick-option="${key}" data-v5-quick-option-value="" data-v5-quick-option-label="${escapeHtml(clearLabel)}">${escapeHtml(clearLabel)}</button>`;
  menu.innerHTML = clear + (options.length ? options.map((option) => `<button type="button" class="v5-filter-autocomplete-option${String(option.value) === selected ? " is-selected" : ""}" role="option" data-v5-quick-option="${key}" data-v5-quick-option-value="${escapeHtml(option.value)}" data-v5-quick-option-label="${escapeHtml(option.label)}"><span>${escapeHtml(option.label)}</span>${String(option.value) === selected ? "<small>已选</small>" : ""}</button>`).join("") : `<span class="v5-filter-autocomplete-empty">没有匹配候选项</span>`);
  menu.hidden = false; input.setAttribute("aria-expanded", "true");
}
function v5RenderQuickAutocompleteOptions(surface) { v5FilterQuickConfig(surface).filter(({ field }) => v5FilterSchema(surface, field)?.kind !== "date").forEach(({ field }) => { const key = `${surface}-${field}`; const input = v5QuickAutocompleteInput(key); const keepOpen = input && document.activeElement === input; v5RenderQuickAutocomplete(surface, field, keepOpen ? input.value : ""); if (!keepOpen) v5QuickAutocompleteMenu(key)?.setAttribute("hidden", ""); }); }
function v5RenderFilterOptions() {
  v5RenderQuickAutocompleteOptions("editor");
  v5RenderQuickFilterState("editor");
}
function v5FilterConditionFromField(surface, field) { const schema = v5FilterSchema(surface, field); return { id: `condition-${field}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, surface, field, value: schema?.kind === "multi" ? [] : "", match: "any", negate: false }; }
function v5FilterRenderValue(surface, schema, condition, groupIndex, conditionIndex) {
  const key = `${groupIndex}-${conditionIndex}`; const values = v5FilterNormaliseValues(condition);
  if (schema.kind === "text" || schema.kind === "multi") {
    const menuId = `v5FilterKeywordOptions-${surface}-${key}`; const options = v5FilterAutocompleteOptions(surface, schema); const selectedLabels = new Map(options.map((option) => [String(option.value), option.label]));
    const selectedMarkup = schema.kind === "multi" ? `<div class="v5-filter-autocomplete-selected" data-v5-filter-selected="${key}">${values.length ? values.map((value) => `<span class="v5-filter-autocomplete-chip">${escapeHtml(selectedLabels.get(String(value)) || value)}<button type="button" data-v5-filter-chip-remove="${key}" data-v5-filter-chip-value="${escapeHtml(value)}" aria-label="移除${escapeHtml(selectedLabels.get(String(value)) || value)}">×</button></span>`).join("") : `<span class="v5-filter-autocomplete-placeholder">未选择</span>`}</div>` : "";
    const inputValue = schema.kind === "multi" ? "" : String(condition.value || ""); const placeholder = schema.kind === "multi" ? "输入后选择，可多选" : "输入关键词…";
    return `<div class="v5-filter-autocomplete${schema.kind === "multi" ? " is-multi" : ""}" data-v5-filter-autocomplete="${key}" data-v5-filter-autocomplete-surface="${surface}" data-v5-filter-autocomplete-field="${schema.field}">${selectedMarkup}<input type="search" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="${menuId}" data-v5-filter-autocomplete-input="${key}"${schema.kind === "text" ? ` data-v5-filter-value="${key}"` : ` data-v5-filter-multi-input="${key}"`} value="${escapeHtml(inputValue)}" placeholder="${placeholder}"><div id="${menuId}" class="v5-filter-autocomplete-menu" data-v5-filter-options="${key}" role="listbox" hidden></div></div>`;
  }
  if (schema.kind === "date") return `<input type="date" data-v5-filter-value="${key}" value="${escapeHtml(condition.value || "")}">`;
}
function v5FilterConditionMarkup(surface, condition, groupIndex, conditionIndex) {
  const schema = v5FilterSchema(surface, condition.field) || v5FilterSchemas[surface][0]; const key = `${groupIndex}-${conditionIndex}`; const values = v5FilterNormaliseValues(condition); const match = schema.kind === "multi" ? `<label class="v5-filter-match">匹配<select data-v5-filter-match="${key}"><option value="any"${condition.match !== "all" ? " selected" : ""}>任一</option><option value="all"${condition.match === "all" ? " selected" : ""}>全部</option></select></label>` : ""; const negate = schema.supportsNegate ? `<label class="v5-filter-negate"><input type="checkbox" data-v5-filter-negate="${key}"${condition.negate ? " checked" : ""}> 非</label>` : `<span class="v5-filter-date-note">日期不支持非/多选</span>`;
  return `<div class="v5-filter-condition" data-v5-filter-condition="${key}"><div class="v5-filter-condition-head"><strong>${escapeHtml(schema.label)}</strong>${negate}${match}<button type="button" class="icon-button" data-v5-filter-remove="${key}" aria-label="删除${escapeHtml(schema.label)}条件">×</button></div><div class="v5-filter-condition-value">${v5FilterRenderValue(surface, schema, condition, groupIndex, conditionIndex)}</div><small class="v5-filter-condition-hint">${schema.kind === "multi" ? `${values.length ? `已选 ${values.length} 项` : "可多选"} · 非作用于整条条件` : schema.kind === "date" ? "单日期边界条件" : "文本包含匹配"}</small></div>`;
}
function v5RenderFilterBuilder() {
  const surface = v5State.filterDraftSurface; const expression = v5State.filterDraft || v5EmptyFilterExpression(); const node = $("#v5FilterConditions"); if (!node) return; if (!expression.groups?.length) { node.innerHTML = `<div class="v5-empty-state compact"><p>还没有条件。添加条件后可组合 AND / OR。</p></div>`; return; }
  node.innerHTML = expression.groups.map((group, groupIndex) => `${groupIndex ? `<div class="v5-filter-group-connector"><select data-v5-filter-group-connector="${groupIndex}" aria-label="条件组连接方式"><option value="and"${group.connector !== "or" ? " selected" : ""}>AND</option><option value="or"${group.connector === "or" ? " selected" : ""}>OR</option></select></div>` : ""}<section class="v5-filter-group"><header><span>条件组 ${groupIndex + 1}</span><label>组内逻辑<select data-v5-filter-group-logic="${groupIndex}"><option value="and"${group.logic !== "or" ? " selected" : ""}>全部满足（AND）</option><option value="or"${group.logic === "or" ? " selected" : ""}>任一满足（OR）</option></select></label>${expression.groups.length > 1 ? `<button type="button" class="small-button danger-button" data-v5-filter-remove-group="${groupIndex}">删除组</button>` : ""}</header><div class="v5-filter-condition-list">${(group.conditions || []).map((condition, conditionIndex) => v5FilterConditionMarkup(surface, condition, groupIndex, conditionIndex)).join("") || `<p class="v5-muted">此组还没有条件。</p>`}</div></section>`).join("");
}
function v5RenderFilterAddFieldOptions(surface) { const node = $("#v5FilterAddField"); if (!node) return; node.innerHTML = v5FilterSchemas[surface].map((schema) => v5Option(schema.field, schema.label)).join(""); }
function v5OpenFilterDialog(surface) { v5State.filterDraftSurface = surface; v5State.filterDraft = v5CloneFilterExpression(v5EnsureFilterExpression(surface)); $("#v5FilterDialogTitle").textContent = surface === "editor" ? "任务全量编辑台组合筛选" : "执行中心组合筛选"; $("#v5FilterDialogHint").textContent = "不同条件之间可使用 AND / OR；非和多选作用于当前条件；日期不支持非和多选。"; v5RenderFilterAddFieldOptions(surface); v5RenderFilterBuilder(); v5Open("#v5FilterDialog"); }
function v5FilterNormaliseExpression(expression) { const groups = (expression?.groups || []).map((group, index) => ({ id: group.id || `group-${Date.now()}-${index}`, connector: group.connector === "or" ? "or" : "and", logic: group.logic === "or" ? "or" : "and", conditions: (group.conditions || []).filter(v5FilterConditionHasValue).map((condition) => ({ ...condition, value: Array.isArray(condition.value) ? condition.value.map(String) : String(condition.value || ""), match: condition.match === "all" ? "all" : "any", negate: Boolean(condition.negate) })) })).filter((group) => group.conditions.length); return { groups }; }
function v5ApplyFilterExpression(surface, expression) {
  v5State.filterExpressions[surface] = v5FilterNormaliseExpression(expression);
  v5RenderQuickFilterState(surface);
  if (surface === "execution") {
    // Keep the legacy execution state in sync so the member sidebar and
    // existing view controls continue to reflect builder-applied filters.
    v5FilterQuickConfig("execution").forEach(({ field }) => {
      const conditions = v5FilterFieldConditions("execution", field, v5State.filterExpressions.execution);
      const values = conditions.length === 1 ? v5FilterNormaliseValues(conditions[0]) : [];
      v5State.execution[field] = values.length === 1 ? values[0] : "";
    });
  }
  if (surface === "editor") v5RenderTree(); else v5RenderExecution();
}
function v5ResetFilterSurface(surface) { v5State.filterExpressions[surface] = v5EmptyFilterExpression(); v5FilterQuickConfig(surface).forEach(({ field, selector, negate }) => { const node = $(selector); if (node) { node.value = ""; delete node.dataset.v5QuickValue; } if (surface === "execution") v5State.execution[field] = ""; if (negate) { const toggle = $(negate); if (toggle) { toggle.checked = false; toggle.indeterminate = false; } } }); if (surface === "editor") { if ($("#v5TaskStatusNot")) $("#v5TaskStatusNot").checked = false; v5RenderTree(); } else v5RenderExecution(); }
function v5UpdateQuickFilter(surface, field) { const config = v5FilterQuickConfig(surface).find((item) => item.field === field); if (!config) return; const node = $(config.selector); const schema = v5FilterSchema(surface, field); const value = v5FilterQuickValue(node, schema); if (surface === "execution") v5State.execution[field] = value; const expression = v5CloneFilterExpression(v5EnsureFilterExpression(surface)); expression.groups = (expression.groups || []).map((group) => ({ ...group, conditions: (group.conditions || []).filter((condition) => condition.field !== field) })); if (value) { if (!expression.groups.length) expression.groups.push({ id: `group-${Date.now()}`, logic: "and", connector: "and", conditions: [] }); expression.groups[0].conditions.push({ ...v5FilterConditionFromField(surface, field), value: schema?.kind === "multi" ? [String(value)] : value, negate: Boolean(config.negate && $(config.negate)?.checked) }); } v5ApplyFilterExpression(surface, expression); }

function v5RenderTree() {
  const node = $("#v5TopicTaskTree"); if (!node) return;
  const tasks = v5FilteredTasks(); const taskIds = new Set(tasks.map((task) => Number(task.id)));
  const topicRows = v5State.topics.filter((topic) => topic.status === "active" || v5State.showArchivedTopics);
  $("#v5TreeCount").textContent = `${tasks.length} 个任务 · ${topicRows.filter((topic) => v5State.tasks.some((task) => Number(task.topic_id) === Number(topic.id) && taskIds.has(Number(task.id)))).length} 个专题`;
  if (!topicRows.length) { node.innerHTML = `<div class="v5-empty-state"><h3>还没有专题</h3><p>先新增一个专题，或创建任务后再归类。</p><button class="primary-action" type="button" data-v5-new-topic>新增专题</button></div>`; return; }
  node.innerHTML = topicRows.map((topic) => {
    const topicTasks = tasks.filter((task) => Number(task.topic_id) === Number(topic.id)).sort((a, b) => (a.start_date || "9999").localeCompare(b.start_date || "9999") || String(a.updated_at || "").localeCompare(String(b.updated_at || "")));
    const expanded = v5State.expandedTopics.has(Number(topic.id));
    const archived = topic.status === "archived";
    const topicButtons = topic.system_key === "unassigned" ? "" : `<button class="small-button" type="button" data-v5-edit-topic="${topic.id}">编辑</button><button class="small-button danger-button" type="button" data-v5-delete-topic="${topic.id}">删除</button>`;
    const tasksMarkup = expanded ? topicTasks.map((task) => `<div class="v5-task-row${Number(v5State.selectedTaskId) === Number(task.id) ? " is-selected" : ""}" data-v5-select-task="${task.id}" tabindex="0" role="button"><span class="v5-task-accent${task.color ? " has-color" : ""}"${task.color ? ` style="--task-accent:${escapeHtml(task.color)}"` : ""}></span><span class="v5-task-title"><strong>${escapeHtml(task.task_number || `TASK-${task.id}`)} · ${escapeHtml(task.title)}</strong><small>${escapeHtml(task.source_group?.name || "来源小组待补充")} · ${escapeHtml((task.samples || []).map((sample) => sample.model || sample.sample_no).filter(Boolean).join("、") || "样品待补充")}</small></span><span class="v5-task-meta v5-task-date">${escapeHtml(task.start_date || "未排期")} → ${escapeHtml(task.end_date || "—")}</span><span class="v5-task-meta v5-task-cryostat">${escapeHtml(task.cryostat?.name || "制冷机待补充")}</span><span class="v5-task-status">${v5StatusChip(task)}</span><span class="v5-task-meta v5-task-participants">${escapeHtml((task.participants || []).map((member) => member.name).join("、") || "未分配")}</span><button class="small-button" type="button" data-v5-move-task="${task.id}" aria-label="重新归类任务">移动</button></div>`).join("") : "";
    return `<section class="v5-topic-group${archived ? " is-archived" : ""}"><div class="v5-topic-row"><button class="v5-topic-toggle" type="button" data-v5-toggle-topic="${topic.id}" aria-expanded="${expanded}">${expanded ? "▾" : "▸"}</button><span class="v5-topic-main"><strong>${escapeHtml(topic.name)}</strong><small>${topic.status === "archived" ? "专题完成归档" : `${topicTasks.length} 个匹配任务`}</small></span><span class="v5-topic-actions">${topicButtons}</span></div>${tasksMarkup || (expanded ? `<div class="v5-empty-state" style="padding:18px"><p>${topicTasks.length ? "没有符合当前筛选的任务" : "该专题还没有任务"}</p><button class="small-button" type="button" data-v5-new-task-topic="${topic.id}">新增任务</button></div>` : "")}</section>`;
  }).join("");
}

function v5InlineTestItemMarkup(item = {}) {
  return `<div class="v5-repeatable-item v5-inline-test-item"><input data-inline-test-item-field="name" value="${escapeHtml(item.name || "")}" placeholder="测试项名称" aria-label="测试项名称"><input data-inline-test-item-field="acceptance_criteria" value="${escapeHtml(item.acceptance_criteria || "")}" placeholder="测试要求" aria-label="测试要求"><textarea data-inline-test-item-field="note" rows="1" placeholder="备注" aria-label="测试项备注">${escapeHtml(item.note || "")}</textarea><button class="small-button danger-button" type="button" data-v5-remove-inline-test-item>删除</button></div>`;
}

function v5RenderInlineTestItems(items = []) {
  const list = $("#v5InlineTestItems"); if (!list) return;
  const rows = items.length ? items : [{ name: "", acceptance_criteria: "", note: "" }];
  list.innerHTML = rows.map(v5InlineTestItemMarkup).join("");
}

function v5InlineMemberMarkup(member, task, selectedIds = null) {
  const memberId = Number(member.id);
  const current = selectedIds ? selectedIds.has(memberId) : (task.participants || []).some((item) => Number(item.id) === memberId);
  const resourceActive = v5ResourceActive("members", member);
  const selectable = resourceActive || current;
  return `<label class="v5-inline-member${resourceActive ? "" : " is-inactive"}"><input class="v5-inline-member-check" type="checkbox" value="${member.id}"${current ? " checked" : ""}${selectable ? "" : " disabled"}> <span>${escapeHtml(member.name)} <small>${escapeHtml(member.role || "")}</small>${resourceActive ? "" : " <em>停用</em>"}</span></label>`;
}

function v5InlineMemberSummaryMarkup(task, selectedIds = null) {
  const selected = selectedIds || new Set((task.participants || []).map((member) => Number(member.id)));
  const names = v5State.resources.members.filter((member) => selected.has(Number(member.id))).map((member) => member.name);
  const preview = names.slice(0, 3).map(escapeHtml).join("、");
  const suffix = names.length > 3 ? `、等 ${names.length} 名` : "";
  return `<strong>已选 ${selected.size} 名</strong><span>${preview ? `${preview}${suffix}` : "尚未分配成员"}</span>`;
}

function v5InlineMembersMarkup(task, query = "", selectedIds = null) {
  const selected = selectedIds || new Set((task.participants || []).map((member) => Number(member.id)));
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const members = v5State.resources.members.filter((member) => {
    if (!normalizedQuery) return true;
    return `${member.name || ""} ${member.role || ""}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });
  return members.length ? members.map((member) => v5InlineMemberMarkup(member, task, selected)).join("") : `<span class="v5-muted v5-inline-member-empty">没有匹配的成员</span>`;
}

function v5RenderInlineMembers(task, query = "") {
  const form = document.querySelector("#v5InlineTaskForm"); const list = document.querySelector("#v5InlineMembersList");
  if (!form || !list || !task) return;
  const selected = new Set([...form.querySelectorAll(".v5-inline-member-check:checked")].map((input) => Number(input.value)));
  list.innerHTML = v5InlineMembersMarkup(task, query, selected);
}

function v5RenderInlineMemberSummary(task, form = document.querySelector("#v5InlineTaskForm")) {
  const summary = form?.querySelector("[data-v5-inline-member-summary]");
  if (!summary || !task) return;
  const selected = new Set([...form.querySelectorAll(".v5-inline-member-check:checked")].map((input) => Number(input.value)));
  summary.innerHTML = v5InlineMemberSummaryMarkup(task, selected);
}

function v5InlineTaskOptions(task) {
  const topicOptions = v5State.topics.filter((topic) => topic.status === "active" || Number(topic.id) === Number(task.topic_id)).map((topic) => ({ value: topic.id, label: `${topic.name}${topic.status === "archived" ? "（归档）" : ""}` }));
  const sourceOptions = v5State.resources.source_groups.filter((item) => v5ResourceActive("source-groups", item) || Number(item.id) === Number(task.source_group_id)).map((item) => ({ value: item.id, label: `${item.name}${v5ResourceActive("source-groups", item) ? "" : "（停用）"}` }));
  const cryostatOptions = v5State.resources.cryostats.filter((item) => v5ResourceActive("cryostats", item) || Number(item.id) === Number(task.cryostat_id)).map((item) => ({ value: item.id, label: `${item.name}${v5ResourceActive("cryostats", item) ? "" : "（停用）"}` }));
  const memberOptions = v5State.resources.members.filter((item) => v5ResourceActive("members", item) || (task.participants || []).some((member) => Number(member.id) === Number(item.id))).map((member) => ({ value: member.id, label: `${member.name}${member.role ? ` · ${member.role}` : ""}`, search: member.role }));
  v5State.customComboboxOptions = { ...v5State.customComboboxOptions, "inline-topic": topicOptions, "inline-source": sourceOptions, "inline-cryostat": cryostatOptions, "inline-members": memberOptions };
  return { topicOptions, sourceOptions, cryostatOptions, memberOptions };
}

function v5RenderSelectedTask() {
  const pane = $("#v5EditorPane"); const task = v5State.tasks.find((row) => Number(row.id) === Number(v5State.selectedTaskId));
  if (!pane) return;
  if (!task) { pane.innerHTML = `<div class="v5-empty-state"><span class="v5-empty-icon">✎</span><h3 id="v5EditorPaneTitle">选择任务开始编辑</h3><p>专题、来源小组、测试目的、样品、排期、制冷机和参与成员都可以在这里一次完成。</p><button id="v5EmptyNewTaskBtn" class="primary-action" type="button">新增任务</button></div>`; return; }
  const missing = [task.source_group_id, task.purpose, task.samples?.length, task.start_date && task.end_date, task.cryostat_id, task.participant_member_ids?.length].filter((value) => !value).length;
  const options = v5InlineTaskOptions(task);
  v5State.inlineMemberIds = new Set((task.participants || []).map((member) => Number(member.id)));
  const color = /^#[0-9a-f]{3,8}$/i.test(task.color || "") ? task.color : "#2563eb";
  pane.innerHTML = `<div class="v5-editor-pane-header"><div><span class="v5-eyebrow">${escapeHtml(task.task_number || `TASK-${task.id}`)}</span><h3>${escapeHtml(task.title)}</h3><small class="v5-muted">${escapeHtml(v5TopicName(task.topic_id))} · ${missing ? `${missing} 项待补充` : "信息完整"}</small></div><div class="v5-topic-actions"><button class="small-button" type="button" data-v5-edit-task="${task.id}">全量编辑</button></div></div><form id="v5InlineTaskForm" class="v5-inline-task-form" data-v5-inline-task="${task.id}"><div class="v5-editor-pane-body"><div class="v5-editor-section"><h4>当前状态</h4><div>${v5StatusChip(task)}</div></div><div class="v5-editor-section"><h4>任务属性（可直接编辑）</h4><div class="v5-editor-fields"><label>所属专题<div class="v5-task-autocomplete v5-inline-task-autocomplete" data-v5-task-combobox="inline-topic"><input type="search" data-v5-task-input="inline-topic" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="v5InlineTopicOptions" required placeholder="选择专题"><div id="v5InlineTopicOptions" class="v5-filter-autocomplete-menu" data-v5-task-options="inline-topic" role="listbox" hidden></div></div></label><label>来源小组<div class="v5-task-autocomplete v5-inline-task-autocomplete" data-v5-task-combobox="inline-source"><input type="search" data-v5-task-input="inline-source" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="v5InlineSourceOptions" placeholder="待补充"><div id="v5InlineSourceOptions" class="v5-filter-autocomplete-menu" data-v5-task-options="inline-source" role="listbox" hidden></div></div></label><label>制冷机<div class="v5-task-autocomplete v5-inline-task-autocomplete" data-v5-task-combobox="inline-cryostat"><input type="search" data-v5-task-input="inline-cryostat" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="v5InlineCryostatOptions" placeholder="待补充"><div id="v5InlineCryostatOptions" class="v5-filter-autocomplete-menu" data-v5-task-options="inline-cryostat" role="listbox" hidden></div></div></label><label>任务颜色<input name="color" type="color" value="${escapeHtml(color)}"></label><label class="full">测试目的<textarea name="purpose" rows="2">${escapeHtml(task.purpose || "")}</textarea></label><fieldset class="v5-inline-test-fieldset full"><legend>测试项</legend><div id="v5InlineTestItems" class="v5-inline-test-items">${(task.test_items || []).length ? task.test_items.map(v5InlineTestItemMarkup).join("") : v5InlineTestItemMarkup()}</div><button class="small-button" type="button" data-v5-inline-add-test-item>增加测试项</button></fieldset><div class="v5-inline-schedule-fields full"><label>计划开始<input name="start_date" type="date" value="${escapeHtml(task.start_date || "")}"></label><label>计划结束<input name="end_date" type="date" value="${escapeHtml(task.end_date || "")}"></label></div><fieldset class="v5-inline-member-fieldset full"><legend>参与成员</legend><div class="v5-task-autocomplete v5-task-autocomplete-multi v5-inline-member-autocomplete" data-v5-task-combobox="inline-members"><div class="v5-task-selected" data-v5-task-selected="inline-members"></div><input type="search" data-v5-task-input="inline-members" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="v5InlineMemberOptions" placeholder="输入姓名或角色"><div id="v5InlineMemberOptions" class="v5-filter-autocomplete-menu" data-v5-task-options="inline-members" role="listbox" hidden></div></div><p class="v5-field-hint">已选成员可在标签中移除；停用但已选成员会保留并标记。</p></fieldset><label class="full">备注<textarea name="notes" rows="3">${escapeHtml(task.notes || "")}</textarea></label></div><p class="v5-field-hint">样品明细在“全量编辑”中维护：样品型号、样品编号、预计交付时间和样品备注。</p></div><div class="v5-inline-actions"><span class="v5-form-error" id="v5InlineTaskFormError" role="alert" aria-live="polite" hidden></span><div><button class="small-button" type="button" data-v5-inline-cancel>取消</button><button class="primary-action" type="submit">保存摘要修改</button></div></div></form><footer class="v5-editor-footer"><span class="v5-muted">人工阶段：${escapeHtml(task.manual_phase === "testing" ? "正在测试" : task.manual_phase === "completed" ? "已完成" : "等待样品")}</span><div class="actions"><button class="small-button" type="button" data-v5-start-testing="${task.id}"${task.manual_phase === "testing" || task.manual_phase === "completed" ? " disabled" : ""}>开始测试</button><button class="small-button" type="button" data-v5-complete-task="${task.id}"${task.manual_phase === "completed" ? " disabled" : ""}>标记完成</button></div></footer>`;
  pane.querySelectorAll(".v5-inline-test-fieldset, .v5-inline-schedule-fields, .v5-inline-member-fieldset").forEach((section) => { section.style.gridColumn = "1 / -1"; });
  const scheduleFields = pane.querySelector(".v5-inline-schedule-fields");
  if (scheduleFields) { scheduleFields.style.display = "grid"; scheduleFields.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))"; scheduleFields.style.gap = "9px"; }
  // Keep canonical form names (name="topic_id", name="source_group_id", name="cryostat_id") on the generated controls.
  const inlineFieldNames = { "inline-topic": "topic_id", "inline-source": "source_group_id", "inline-cryostat": "cryostat_id" };
  Object.entries(inlineFieldNames).forEach(([key, name]) => v5TaskComboboxInput(key)?.setAttribute("name", name));
  v5TaskRenderSingleCombobox("inline-topic", options.topicOptions, task.topic_id, "选择专题");
  v5TaskRenderSingleCombobox("inline-source", options.sourceOptions, task.source_group_id, "待补充");
  v5TaskRenderSingleCombobox("inline-cryostat", options.cryostatOptions, task.cryostat_id, "待补充");
  v5TaskRenderMultiPicker("inline-members", options.memberOptions, v5State.inlineMemberIds, "输入姓名或角色");
}

function v5InlineTaskPayload(task, form) {
  const memberIds = [...v5State.inlineMemberIds].map(Number);
  const memberDates = memberIds.map((memberId) => {
    const current = (task.participants || []).find((member) => Number(member.id) === memberId);
    return { member_id: memberId, start_date: current?.start_date || task.start_date || null, end_date: current?.end_date || task.end_date || null };
  });
  const testItems = [...form.querySelectorAll(".v5-inline-test-item")].map((row) => ({ name: row.querySelector('[data-inline-test-item-field="name"]')?.value.trim() || "", acceptance_criteria: row.querySelector('[data-inline-test-item-field="acceptance_criteria"]')?.value.trim() || "", note: row.querySelector('[data-inline-test-item-field="note"]')?.value.trim() || "" })).filter((item) => item.name);
  const topicId = Number(v5TaskCombobox("inline-topic")?.dataset.v5TaskValue);
  if (!Number.isInteger(topicId) || topicId <= 0) throw new Error("请选择所属专题");
  return { topic_id: topicId, source_group_id: Number(v5TaskCombobox("inline-source")?.dataset.v5TaskValue) || null, cryostat_id: Number(v5TaskCombobox("inline-cryostat")?.dataset.v5TaskValue) || null, purpose: form.elements.purpose.value.trim(), notes: form.elements.notes.value.trim(), color: form.elements.color.value, start_date: form.elements.start_date.value || null, end_date: form.elements.end_date.value || null, participant_member_ids: memberIds, member_dates: memberDates, test_items: testItems, manual_phase: task.manual_phase || "waiting", actor: "本地用户" };
}

async function v5SaveInlineTask(event) {
  event.preventDefault(); const form = event.target.closest("#v5InlineTaskForm"); if (!form) return; const taskId = Number(form.dataset.v5InlineTask); const task = v5State.tasks.find((row) => Number(row.id) === taskId);
  if (!task) return;
  try {
    const payload = v5InlineTaskPayload(task, form); const preview = await v5Api(`/api/v5/tasks/${task.id}/preview`, v5Json("POST", { ...payload, expected_version: task.version }));
    if (preview.conflicts?.length) { const summary = preview.conflicts.map((item) => item.type === "MEMBER_DATE_OVERLAP" ? `成员 ${item.member_id} 与任务“${item.title}”重叠` : item.type === "CRYOSTAT_DATE_OVERLAP" ? `制冷机与任务“${item.title}”重叠` : item.type).join("；"); if (!window.confirm(`保存前发现冲突：${summary}\n\n仍要保存吗？`)) return; }
    const saved = await v5Api(`/api/v5/tasks/${task.id}`, v5Json("PUT", { ...payload, preview_token: preview.preview_token, ack: Boolean(preview.conflicts?.length), expected_version: task.version }));
    v5State.selectedTaskId = saved.id; await v5LoadAll(); v5State.selectedTaskId = saved.id; v5RenderTree(); v5RenderSelectedTask(); showToast("摘要修改已保存");
  } catch (error) { v5SetFormError("#v5InlineTaskFormError", v5ErrorText(error)); }
}

function v5TaskCombobox(key) { return document.querySelector(`[data-v5-task-combobox="${key}"]`); }
function v5TaskComboboxInput(key) { return v5TaskCombobox(key)?.querySelector("[data-v5-task-input]"); }
function v5TaskComboboxMenu(key) { return v5TaskCombobox(key)?.querySelector("[data-v5-task-options]"); }
function v5TaskOptionMatches(options, query) { const normalized = String(query || "").trim().toLocaleLowerCase("zh-CN"); return options.filter((option) => !normalized || `${option.label} ${option.search || ""}`.toLocaleLowerCase("zh-CN").includes(normalized)).slice(0, 30); }
function v5ShowQuickAutocompleteForInput(input) {
  if (!input) return false;
  const [surface, ...fieldParts] = input.dataset.v5QuickInput.split("-"); v5RenderQuickAutocomplete(surface, fieldParts.join("-"), input.value);
  return true;
}
function v5ShowTaskAutocompleteForInput(input) {
  if (!input) return false;
  const key = input.dataset.v5TaskInput || input.closest("[data-v5-task-combobox]")?.dataset.v5TaskCombobox; const menu = v5TaskComboboxMenu(key); if (!key || !menu) return false;
  const options = v5TaskOptionMatches(v5TaskOptions(key), input.value);
  menu.innerHTML = options.map((option) => `<button type="button" class="v5-filter-autocomplete-option" role="option" data-v5-task-option="${key}" data-v5-task-option-value="${escapeHtml(option.value)}" data-v5-task-option-label="${escapeHtml(option.label)}">${escapeHtml(option.label)}</button>`).join("") || `<span class="v5-filter-autocomplete-empty">没有匹配候选项</span>`;
  menu.hidden = false; input.setAttribute("aria-expanded", "true");
  return true;
}
function v5TaskRenderSingleCombobox(key, options, selectedValue, placeholder) {
  const wrapper = v5TaskCombobox(key); const input = v5TaskComboboxInput(key); const menu = v5TaskComboboxMenu(key); if (!wrapper || !input || !menu) return;
  const selected = options.find((option) => String(option.value) === String(selectedValue || "")); wrapper.dataset.v5TaskValue = selected ? String(selected.value) : ""; input.value = selected?.label || ""; input.placeholder = placeholder;
  const clear = `<button type="button" class="v5-filter-autocomplete-option${selected ? "" : " is-selected"}" role="option" data-v5-task-option="${key}" data-v5-task-option-value="" data-v5-task-option-label="${escapeHtml(placeholder)}">${escapeHtml(placeholder)}</button>`;
  menu.innerHTML = clear + options.map((option) => `<button type="button" class="v5-filter-autocomplete-option${selected && String(option.value) === String(selected.value) ? " is-selected" : ""}" role="option" data-v5-task-option="${key}" data-v5-task-option-value="${escapeHtml(option.value)}" data-v5-task-option-label="${escapeHtml(option.label)}"><span>${escapeHtml(option.label)}</span>${selected && String(option.value) === String(selected.value) ? "<small>已选</small>" : ""}</button>`).join("");
}
function v5TaskRenderMultiPicker(key, options, selectedValues, placeholder) {
  const wrapper = v5TaskCombobox(key); const input = v5TaskComboboxInput(key); const menu = v5TaskComboboxMenu(key); const selected = new Set([...selectedValues].map(String)); if (!wrapper || !input || !menu) return;
  const labels = new Map(options.map((option) => [String(option.value), option.label])); const chips = [...selected].map((value) => `<span class="v5-filter-autocomplete-chip">${escapeHtml(labels.get(value) || value)}<button type="button" data-v5-task-chip-remove="${key}" data-v5-task-chip-value="${escapeHtml(value)}" aria-label="移除${escapeHtml(labels.get(value) || value)}">×</button></span>`).join(""); const selectedNode = wrapper.querySelector("[data-v5-task-selected]"); if (selectedNode) selectedNode.innerHTML = chips || `<span class="v5-filter-autocomplete-placeholder">未选择</span>`;
  input.placeholder = placeholder; input.value = ""; menu.innerHTML = v5TaskOptionMatches(options, "").map((option) => `<button type="button" class="v5-filter-autocomplete-option${selected.has(String(option.value)) ? " is-selected" : ""}" role="option" data-v5-task-option="${key}" data-v5-task-option-value="${escapeHtml(option.value)}" data-v5-task-option-label="${escapeHtml(option.label)}"><span>${escapeHtml(option.label)}</span>${selected.has(String(option.value)) ? "<small>已选</small>" : ""}</button>`).join("") || `<span class="v5-filter-autocomplete-empty">没有可选项</span>`;
}
function v5TaskOptions(key) {
  if (Array.isArray(v5State.customComboboxOptions?.[key])) return v5State.customComboboxOptions[key];
  if (key === "topic") return v5State.topics.map((topic) => ({ value: topic.id, label: `${topic.name}${topic.status === "archived" ? "（归档）" : ""}` }));
  if (key === "topic-status") return [{ value: "active", label: "正在进行" }, { value: "archived", label: "专题完成归档" }];
  if (key === "source") return v5State.resources.source_groups.map((item) => ({ value: item.id, label: `${item.name}${v5ResourceActive("source-groups", item) ? "" : "（停用）"}` }));
  if (key === "cryostat") return v5State.resources.cryostats.map((item) => ({ value: item.id, label: `${item.name}${v5ResourceActive("cryostats", item) ? "" : "（停用）"}` }));
  if (key === "members") return v5State.resources.members.map((member) => ({ value: member.id, label: `${member.name}${member.role ? ` · ${member.role}` : ""}`, search: member.role }));
  return [];
}
function v5RenderTaskPickers() {
  v5TaskRenderMultiPicker("members", v5TaskOptions("members"), v5State.dialogMemberIds, "输入姓名或角色");
}
function v5RenderSamplesInForm() {
  $$("#v5TaskSamples .v5-sample-edit-row").forEach((row) => { const id = Number(row.dataset.v5SampleRow); if (id) v5State.dialogSampleDrafts.set(id, { model: row.querySelector('[data-sample-field="model"]')?.value || "", sample_no: row.querySelector('[data-sample-field="sample_no"]')?.value || "", eta_date: row.querySelector('[data-sample-field="eta_date"]')?.value || "", eta_pending: row.querySelector('[data-sample-field="eta_pending"]')?.checked || false, notes: row.querySelector('[data-sample-field="notes"]')?.value || "" }); });
  const selected = v5State.dialogSampleIds; const all = v5State.samples.slice().sort((a, b) => String(a.eta_date || "9999").localeCompare(String(b.eta_date || "9999")) || a.id - b.id); const selectedRows = all.filter((sample) => selected.has(Number(sample.id)));
  $("#v5TaskSamples").innerHTML = selectedRows.length ? selectedRows.map((sample) => { const draft = v5State.dialogSampleDrafts.get(Number(sample.id)) || sample; const sampleLabel = escapeHtml(draft.model || "未命名样品"); return `<div class="v5-choice-item" data-v5-sample-row="${sample.id}"><input class="v5-sample-check" type="checkbox" value="${sample.id}" checked hidden><div class="v5-sample-edit-row" data-v5-sample-row="${sample.id}"><div class="v5-repeatable-header" style="grid-column:1/-1"><strong>${sampleLabel}</strong><button type="button" class="ghost-button small-button" data-v5-task-remove-sample="${sample.id}" aria-label="从任务中移除样品 ${sampleLabel}" title="从任务中移除，不删除样品数据">移除样品</button></div><input data-sample-field="model" value="${escapeHtml(draft.model || "")}" aria-label="样品型号"><input data-sample-field="sample_no" value="${escapeHtml(draft.sample_no || "")}" placeholder="编号（可后补）" aria-label="样品编号"><input data-sample-field="eta_date" type="date" value="${escapeHtml(draft.eta_date || "")}" aria-label="预计交付时间"><label class="v5-check-inline"><input class="v5-eta-pending-checkbox" data-sample-field="eta_pending" type="checkbox" style="width:14px;height:14px;min-height:14px;padding:0;border:0;background:transparent;accent-color:var(--accent);"${draft.eta_pending ? " checked" : ""}>ETA 待确认</label><input data-sample-field="notes" value="${escapeHtml(draft.notes || "")}" placeholder="样品备注" aria-label="样品备注"></div></div>`; }).join("") : `<div class="v5-empty-state" style="padding:12px"><p>尚未添加样品，可在下方添加。</p></div>`;
  v5RenderTaskPickers();
}
function v5RenderMembersInForm(task = null) {
  $$("#v5TaskMembers .v5-member-choice-item").forEach((row) => { const id = Number(row.dataset.v5MemberRow); if (id) v5State.dialogMemberDates.set(id, { start_date: row.querySelector(".v5-member-start")?.value || "", end_date: row.querySelector(".v5-member-end")?.value || "" }); });
  const selected = v5State.dialogMemberIds; const rows = v5State.resources.members.filter((member) => selected.has(Number(member.id))).map((member) => { const current = task?.participants?.find((item) => Number(item.id) === Number(member.id)); const dates = v5State.dialogMemberDates.get(Number(member.id)) || { start_date: current?.start_date || task?.start_date || "", end_date: current?.end_date || task?.end_date || "" }; return `<div class="v5-member-choice-item" data-v5-member-row="${member.id}"><input class="v5-member-check" type="checkbox" value="${member.id}" checked hidden><span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.role || "")}</small></span><button type="button" class="small-button danger-button" data-v5-task-remove-member="${member.id}">移除</button><input class="v5-member-start" data-member-id="${member.id}" type="date" value="${escapeHtml(dates.start_date)}" aria-label="${escapeHtml(member.name)}参与开始"><input class="v5-member-end" data-member-id="${member.id}" type="date" value="${escapeHtml(dates.end_date)}" aria-label="${escapeHtml(member.name)}参与结束"></div>`; }).join("");
  $("#v5TaskMembers").innerHTML = rows || `<div class="v5-empty-state" style="padding:12px"><p>尚未选择成员，可在上方输入并选择。</p></div>`; v5RenderTaskPickers();
}

function v5RenderTaskForm(task = null, defaultTopicId = null) {
  const form = $("#v5TaskForm"); if (!form) return;
  v5State.editingTaskId = task?.id || null; v5State.dialogSampleIds = new Set((task?.samples || []).map((sample) => Number(sample.id))); v5State.dialogSampleDrafts = new Map((task?.samples || []).map((sample) => [Number(sample.id), { model: sample.model || "", sample_no: sample.sample_no || "", eta_date: sample.eta_date || "", eta_pending: Boolean(sample.eta_pending), notes: sample.notes || "" }])); v5State.dialogMemberIds = new Set((task?.participants || []).map((member) => Number(member.id))); v5State.dialogMemberDates = new Map((task?.participants || []).map((member) => [Number(member.id), { start_date: member.start_date || task?.start_date || "", end_date: member.end_date || task?.end_date || "" }]));
  $("#v5TaskDialogTitle").textContent = task ? `编辑 ${task.task_number || `TASK-${task.id}`}` : "新增任务";
  $("#v5TaskNumber").value = task?.task_number || "保存后生成"; $("#v5TaskTitle").value = task?.title || ""; $("#v5TaskPurpose").value = task?.purpose || ""; $("#v5TaskNotes").value = task?.notes || ""; $("#v5TaskColor").value = /^#[0-9a-f]{3,8}$/i.test(task?.color || "") ? task.color : "#2563eb"; $("#v5TaskStart").value = task?.start_date || ""; $("#v5TaskEnd").value = task?.end_date || "";
  v5TaskRenderSingleCombobox("topic", v5TaskOptions("topic"), task?.topic_id ?? defaultTopicId ?? v5State.topics.find((row) => row.system_key === "unassigned")?.id, "选择专题");
  v5TaskRenderSingleCombobox("source", v5TaskOptions("source"), task?.source_group_id, "待补充");
  v5TaskRenderSingleCombobox("cryostat", v5TaskOptions("cryostat"), task?.cryostat_id, "待补充");
  $("#v5TestItemsEditor").innerHTML = (task?.test_items?.length ? task.test_items : [{ name: "", acceptance_criteria: "", note: "" }]).map((item) => `<div class="v5-repeatable-item"><input data-test-item-field="name" value="${escapeHtml(item.name || "")}" placeholder="测试项名称"><input data-test-item-field="acceptance_criteria" value="${escapeHtml(item.acceptance_criteria || "")}" placeholder="测试要求"><textarea data-test-item-field="note" rows="1" placeholder="备注">${escapeHtml(item.note || "")}</textarea><button class="small-button danger-button" type="button" data-v5-remove-test-item>删除</button></div>`).join("");
  v5RenderMembersInForm(task);
  $("#v5TaskForm").querySelectorAll('[name="manual_phase"]').forEach((input) => { input.checked = input.value === (task?.manual_phase || "waiting"); });
  v5RenderSamplesInForm(task); v5SetFormError("#v5TaskFormError");
}

function v5OpenTaskEditor(taskId = null, defaultTopicId = null) { const task = taskId == null ? null : v5State.tasks.find((row) => Number(row.id) === Number(taskId)); if (taskId != null && !task) return; v5RenderTaskForm(task, defaultTopicId); v5Open("#v5TaskDialog"); }

async function v5SaveTask(event) {
  event.preventDefault(); const task = v5State.tasks.find((row) => Number(row.id) === Number(v5State.editingTaskId));
  try {
    const sampleIds = [...v5State.dialogSampleIds].map(Number);
    const memberIds = [...v5State.dialogMemberIds].map(Number);
    const memberDates = memberIds.map((memberId) => ({ member_id: memberId, start_date: $(`#v5TaskMembers .v5-member-start[data-member-id="${memberId}"]`)?.value || null, end_date: $(`#v5TaskMembers .v5-member-end[data-member-id="${memberId}"]`)?.value || null }));
    const testItems = $$("#v5TestItemsEditor .v5-repeatable-item").map((row) => ({ name: row.querySelector('[data-test-item-field="name"]')?.value.trim() || "", acceptance_criteria: row.querySelector('[data-test-item-field="acceptance_criteria"]')?.value.trim() || "", note: row.querySelector('[data-test-item-field="note"]')?.value.trim() || "" })).filter((item) => item.name);
    const selectedTopicId = Number(v5TaskCombobox("topic")?.dataset.v5TaskValue);
    const fallbackTopicId = Number(v5State.topics.find((row) => row.system_key === "unassigned")?.id);
    const topicId = Number.isInteger(selectedTopicId) && selectedTopicId > 0 ? selectedTopicId : Number.isInteger(fallbackTopicId) && fallbackTopicId > 0 ? fallbackTopicId : null;
    const payload = { ...(topicId ? { topic_id: topicId } : {}), source_group_id: Number(v5TaskCombobox("source")?.dataset.v5TaskValue) || null, cryostat_id: Number(v5TaskCombobox("cryostat")?.dataset.v5TaskValue) || null, title: $("#v5TaskTitle").value.trim(), purpose: $("#v5TaskPurpose").value.trim(), notes: $("#v5TaskNotes").value.trim(), color: $("#v5TaskColor").value, start_date: $("#v5TaskStart").value || null, end_date: $("#v5TaskEnd").value || null, sample_ids: sampleIds, participant_member_ids: memberIds, member_dates: memberDates, test_items: testItems, manual_phase: $("#v5TaskForm input[name=manual_phase]:checked")?.value || "waiting", actor: "本地用户" };
    if (!payload.title) throw new Error("请填写任务名称");
    const sampleRows = $$("#v5TaskSamples .v5-sample-edit-row");
    payload.sample_updates = sampleRows.map((row) => { const sampleId = Number(row.dataset.v5SampleRow); const sample = v5State.samples.find((item) => Number(item.id) === sampleId); return sample ? { sample_id: sampleId, model: row.querySelector('[data-sample-field="model"]')?.value.trim(), sample_no: row.querySelector('[data-sample-field="sample_no"]')?.value.trim() || null, eta_date: row.querySelector('[data-sample-field="eta_date"]')?.value || null, eta_pending: row.querySelector('[data-sample-field="eta_pending"]')?.checked || false, notes: row.querySelector('[data-sample-field="notes"]')?.value.trim() || "", expected_version: sample.version } : null; }).filter(Boolean);
    const previewPath = task ? `/api/v5/tasks/${task.id}/preview` : "/api/v5/tasks/preview"; const preview = await v5Api(previewPath, v5Json("POST", { ...payload, ...(task ? { expected_version: task.version } : {}) }));
    if (preview.conflicts?.length) { const summary = preview.conflicts.map((item) => item.type === "MEMBER_DATE_OVERLAP" ? `成员 ${item.member_id} 与任务“${item.title}”重叠` : item.type === "CRYOSTAT_DATE_OVERLAP" ? `制冷机与任务“${item.title}”重叠` : item.type).join("；"); if (!window.confirm(`保存前发现冲突：${summary}\n\n仍要保存吗？`)) return; }
    const savePayload = { ...payload, preview_token: preview.preview_token, ack: Boolean(preview.conflicts?.length), ...(task ? { expected_version: task.version } : {}) };
    const saved = task ? await v5Api(`/api/v5/tasks/${task.id}`, v5Json("PUT", savePayload)) : await v5Api("/api/v5/tasks", v5Json("POST", savePayload));
    v5Close("#v5TaskDialog"); await v5LoadAll(); v5State.selectedTaskId = saved.id; v5RenderTree(); v5RenderSelectedTask(); showToast(task ? "任务已更新" : "任务已创建");
  } catch (error) { v5SetFormError("#v5TaskFormError", v5ErrorText(error)); }
}

function v5ResourceSearchOptions(kind) {
  return v5ResourceRows(kind).map((item) => ({ value: item.name, label: `${item.name}${item.role ? ` · ${item.role}` : ""}`, search: `${item.role || ""} ${item.note || ""}` }));
}
function v5RenderResourceSearchOptions(kind, query = "") {
  const input = document.querySelector(`[data-v5-resource-search="${kind}"]`); const menu = document.querySelector(`[data-v5-resource-options="${kind}"]`); if (!input || !menu) return;
  const normalized = String(query || "").trim().toLocaleLowerCase("zh-CN"); const options = v5ResourceSearchOptions(kind).filter((option) => !normalized || `${option.label} ${option.search}`.toLocaleLowerCase("zh-CN").includes(normalized)).slice(0, 30);
  menu.innerHTML = `<button type="button" class="v5-filter-autocomplete-option${!input.value ? " is-selected" : ""}" data-v5-resource-option="${kind}" data-v5-resource-option-value="" data-v5-resource-option-label="全部">全部</button>` + (options.length ? options.map((option) => `<button type="button" class="v5-filter-autocomplete-option${String(input.value) === String(option.value) ? " is-selected" : ""}" data-v5-resource-option="${kind}" data-v5-resource-option-value="${escapeHtml(option.value)}" data-v5-resource-option-label="${escapeHtml(option.label)}"><span>${escapeHtml(option.label)}</span></button>`).join("") : `<span class="v5-filter-autocomplete-empty">没有匹配资源</span>`);
  menu.hidden = false; input.setAttribute("aria-expanded", "true");
}
function v5RenderExecutionMemberSearchOptions(query = "") {
  const input = $("#v5ExecutionMemberSearch"); const menu = $("#v5ExecutionMemberSearchOptions"); if (!input || !menu) return;
  const normalized = String(query || "").trim().toLocaleLowerCase("zh-CN"); const options = v5State.resources.members.map((member) => ({ value: member.name, label: `${member.name}${member.role ? ` · ${member.role}` : ""}`, search: member.role || "" })).filter((option) => !normalized || `${option.label} ${option.search}`.toLocaleLowerCase("zh-CN").includes(normalized)).slice(0, 30);
  menu.innerHTML = `<button type="button" class="v5-filter-autocomplete-option${!input.value ? " is-selected" : ""}" data-v5-execution-member-option-value="" data-v5-execution-member-option-label="全部">全部</button>` + (options.length ? options.map((option) => `<button type="button" class="v5-filter-autocomplete-option${String(input.value) === String(option.value) ? " is-selected" : ""}" data-v5-execution-member-option-value="${escapeHtml(option.value)}" data-v5-execution-member-option-label="${escapeHtml(option.label)}"><span>${escapeHtml(option.label)}</span></button>`).join("") : `<span class="v5-filter-autocomplete-empty">没有匹配成员</span>`);
  menu.hidden = false; input.setAttribute("aria-expanded", "true");
}
function v5RenderResourceList(kind, targetId) {
  const list = $(targetId); if (!list) return; const query = (v5State.resourceSearch[kind] || "").toLowerCase(); const rows = v5ResourceRows(kind).filter((item) => !query || `${item.name} ${item.role || ""} ${item.note || ""}`.toLowerCase().includes(query));
  list.innerHTML = rows.length ? rows.map((item) => { const active = v5ResourceActive(kind, item); const stateLabel = active ? "启用" : "停用"; const referenceCount = Number(item.reference_count || 0); const currentCount = Number(item.current_task_count || 0); const detail = kind === "members" ? `${item.role || "未填写角色"} · ${stateLabel}` : `${item.note || "无备注"} · ${stateLabel}`; return `<div class="v5-resource-item${active ? "" : " is-inactive"}"><div><strong>${escapeHtml(item.name)}<span class="v5-resource-state">${stateLabel}</span></strong><small>${escapeHtml(detail)}</small><small>历史引用 ${referenceCount} 个 · 当前任务 ${currentCount} 个</small></div><div class="v5-resource-item-actions"><button class="small-button" type="button" data-v5-edit-resource="${kind}:${item.id}">编辑</button></div></div>`; }).join("") : `<div class="v5-empty-state" style="padding:25px 10px"><p>没有匹配资源</p></div>`;
}
function v5RenderResourceStats() {
  const groups = v5State.resources.source_groups || [];
  const members = v5State.resources.members || [];
  const cryostats = v5State.resources.cryostats || [];
  const resources = [
    ...groups.map((item) => ({ kind: "source-groups", item })),
    ...members.map((item) => ({ kind: "members", item })),
    ...cryostats.map((item) => ({ kind: "cryostats", item }))
  ];
  const total = resources.length;
  const active = resources.filter(({ kind, item }) => v5ResourceActive(kind, item)).length;
  const references = resources.reduce((sum, { item }) => sum + Number(item.reference_count || 0), 0);
  const current = resources.reduce((sum, { item }) => sum + Number(item.current_task_count || 0), 0);
  const values = { "#v5ResourceTotal": total, "#v5ResourceActive": active, "#v5ResourceReferences": references, "#v5ResourceCurrent": current };
  Object.entries(values).forEach(([selector, value]) => { const node = $(selector); if (node) node.textContent = String(value); });
}
function v5RenderResources() { v5RenderResourceList("source-groups", "#v5SourceGroupsList"); v5RenderResourceList("members", "#v5MembersList"); v5RenderResourceList("cryostats", "#v5CryostatsList"); v5RenderResourceStats(); const stamp = $("#v5ResourceUpdated"); if (stamp) stamp.textContent = `${v5State.resources.source_groups.length} 个小组 · ${v5State.resources.members.length} 名成员 · ${v5State.resources.cryostats.length} 台制冷机`; }
function v5OpenResourceEditor(kind, id = null) { const item = id == null ? null : v5ResourceRows(kind).find((row) => Number(row.id) === Number(id)); v5State.editingResource = { kind, id: item?.id || null, updated_at: item?.updated_at || null }; $("#v5ResourceDialogTitle").textContent = `${item ? "编辑" : "新增"}${v5ResourceLabels[kind]}`; $("#v5ResourceKind").value = kind; $("#v5ResourceName").value = item?.name || ""; $("#v5ResourceRole").value = item?.role || ""; $("#v5ResourceNote").value = item?.note || ""; $("#v5ResourceActive").checked = kind === "source-groups" ? item ? Number(item.is_active) === 1 : true : item ? item.status === "active" : true; $("#v5ResourceRoleWrap").hidden = kind !== "members"; v5SetFormError("#v5ResourceFormError"); v5Open("#v5ResourceDialog"); }
async function v5SaveResource(event) { event.preventDefault(); const editing = v5State.editingResource; const kind = $("#v5ResourceKind").value; try { const payload = { name: $("#v5ResourceName").value.trim(), note: $("#v5ResourceNote").value.trim(), actor: "本地用户" }; if (kind === "members") { payload.role = $("#v5ResourceRole").value.trim(); payload.status = $("#v5ResourceActive").checked ? "active" : "inactive"; } else if (kind === "source-groups") payload.is_active = $("#v5ResourceActive").checked; else payload.status = $("#v5ResourceActive").checked ? "active" : "inactive"; const path = editing?.id ? `/api/v5/resources/${kind}/${editing.id}` : `/api/v5/resources/${kind}`; if (editing?.id) payload.expected_updated_at = editing.updated_at; await v5Api(path, v5Json(editing?.id ? "PUT" : "POST", payload)); v5Close("#v5ResourceDialog"); await v5LoadAll(); showToast(`${v5ResourceLabels[kind]}已保存`); } catch (error) { v5SetFormError("#v5ResourceFormError", v5ErrorText(error)); } }

function v5OpenTopicEditor(topicId = null) { const topic = topicId == null ? null : v5State.topics.find((row) => Number(row.id) === Number(topicId)); v5State.editingTopicId = topic?.id || null; $("#v5TopicDialogTitle").textContent = topic ? "编辑专题" : "新增专题"; $("#v5TopicName").value = topic?.name || ""; $("#v5TopicPurpose").value = topic?.purpose || ""; $("#v5TopicNotes").value = topic?.notes || ""; v5TaskRenderSingleCombobox("topic-status", v5TaskOptions("topic-status"), topic?.status || "active", "选择状态"); $("#v5TopicStatus").disabled = topic?.system_key === "unassigned"; v5SetFormError("#v5TopicFormError"); v5Open("#v5TopicDialog"); }
async function v5SaveTopic(event) { event.preventDefault(); const topic = v5State.topics.find((row) => Number(row.id) === Number(v5State.editingTopicId)); try { const payload = { name: $("#v5TopicName").value.trim(), purpose: $("#v5TopicPurpose").value.trim(), status: v5TaskCombobox("topic-status")?.dataset.v5TaskValue || "active", notes: $("#v5TopicNotes").value.trim(), actor: "本地用户" }; if (!payload.name) throw new Error("请填写专题名称"); const path = topic ? `/api/v5/topics/${topic.id}` : "/api/v5/topics"; if (topic) payload.expected_version = topic.version; await v5Api(path, v5Json(topic ? "PUT" : "POST", payload)); v5Close("#v5TopicDialog"); await v5LoadAll(); showToast(topic ? "专题已更新" : "专题已创建"); } catch (error) { v5SetFormError("#v5TopicFormError", v5ErrorText(error)); } }
function v5TopicMoveTargets(sourceId) { return v5State.topics.filter((topic) => Number(topic.id) !== Number(sourceId) && topic.status === "active"); }
function v5RenderTopicMovePreview() {
  const move = v5State.topicMove; const targetId = Number(v5TaskCombobox("topic-move")?.dataset.v5TaskValue); const target = v5State.topics.find((topic) => Number(topic.id) === targetId); const preview = $("#v5TopicMovePreview"); if (!move || !preview) return;
  const source = v5State.topics.find((topic) => Number(topic.id) === Number(move.sourceId)); const taskIds = move.mode === "task" ? [move.taskId] : v5State.tasks.filter((task) => Number(task.topic_id) === Number(move.sourceId)).map((task) => Number(task.id));
  if (!target) { preview.innerHTML = `<p class="v5-muted">请选择目标专题。</p>`; return; }
  const taskNames = v5State.tasks.filter((task) => taskIds.includes(Number(task.id))).slice(0, 5).map((task) => escapeHtml(task.title)).join("、");
  preview.innerHTML = `<div class="v5-topic-move-summary"><strong>${move.mode === "delete" ? `归档专题“${escapeHtml(source?.name || "")}` : `移动任务“${escapeHtml(v5State.tasks.find((task) => Number(task.id) === Number(move.taskId))?.title || "")}`}</strong><span>目标专题：${escapeHtml(target.name)}</span><span>将影响 ${taskIds.length} 个任务${taskNames ? `：${taskNames}${taskIds.length > 5 ? " 等" : ""}` : ""}</span>${move.mode === "delete" ? "<span class=\"v5-muted\">原专题会完成归档，不会删除历史任务。</span>" : ""}</div>`;
}
function v5OpenTopicMove(mode, idValue) {
  const move = mode === "task" ? { mode, taskId: Number(idValue), sourceId: v5State.tasks.find((task) => Number(task.id) === Number(idValue))?.topic_id } : { mode: "delete", sourceId: Number(idValue) };
  if (!move.sourceId || (mode === "task" && !move.taskId)) return;
  const source = v5State.topics.find((topic) => Number(topic.id) === Number(move.sourceId)); if (!source) return;
  const targets = v5TopicMoveTargets(move.sourceId); if (!targets.length) { showToast("没有可用的目标专题，请先新增专题。", { type: "error" }); return; }
  v5State.topicMove = move; v5State.customComboboxOptions = { ...v5State.customComboboxOptions, "topic-move": targets.map((topic) => ({ value: topic.id, label: topic.system_key === "unassigned" ? `${topic.name}（系统专题）` : topic.name })) }; $("#v5TopicMoveDialogTitle").textContent = mode === "task" ? "重新归类任务" : "归档并迁移专题"; $("#v5TopicMoveHint").textContent = mode === "task" ? `当前专题：${source.name}。请选择任务要归属的专题。` : `专题“${source.name}”中的任务将整体迁移后归档。`;
  $("#v5TopicMoveSaveBtn").textContent = mode === "task" ? "确认重新归类" : "确认归档并迁移"; v5SetFormError("#v5TopicMoveFormError"); v5Open("#v5TopicMoveDialog"); v5TaskRenderSingleCombobox("topic-move", v5TaskOptions("topic-move"), targets.find((topic) => topic.system_key === "unassigned")?.id || targets[0].id, "选择目标专题"); v5RenderTopicMovePreview();
}
async function v5SaveTopicMove(event) { event.preventDefault(); const move = v5State.topicMove; const targetId = Number(v5TaskCombobox("topic-move")?.dataset.v5TaskValue); if (!move || !targetId) return; try { if (move.mode === "task") { await v5Api(`/api/v5/topics/${move.sourceId}/move-tasks`, v5Json("POST", { target_topic_id: targetId, task_ids: [move.taskId], actor: "本地用户" })); } else { const topic = v5State.topics.find((row) => Number(row.id) === Number(move.sourceId)); await v5Api(`/api/v5/topics/${move.sourceId}`, v5Json("DELETE", { target_topic_id: targetId, expected_version: topic.version, actor: "本地用户" })); } v5Close("#v5TopicMoveDialog"); v5State.topicMove = null; await v5LoadAll(); showToast(move.mode === "task" ? "任务已重新归类" : "专题已归档，任务已迁移"); } catch (error) { v5SetFormError("#v5TopicMoveFormError", v5ErrorText(error)); } }

async function v5StartTesting(taskId, complete = false) { const task = v5State.tasks.find((row) => Number(row.id) === Number(taskId)); if (!task) return; try { const path = complete ? `/api/v5/tasks/${task.id}/complete` : `/api/v5/tasks/${task.id}/start-testing`; await v5Api(path, v5Json("POST", { expected_version: task.version, actor: "本地用户" })); await v5LoadAll(); v5State.selectedTaskId = task.id; v5RenderTree(); v5RenderSelectedTask(); showToast(complete ? "任务已标记完成" : "任务已切换为正在测试"); } catch (error) { showToast(v5ErrorText(error), { type: "error" }); } }

function v5ExecutionTaskMembers(task) { return Array.isArray(task?.participants) ? task.participants : []; }
function v5ExecutionDateValue(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : ""; }
function v5ExecutionTaskHasSample(task, sampleId) { return !sampleId || (task.samples || []).some((sample) => Number(sample.id) === Number(sampleId)); }
function v5ExecutionFilteredTasks() {
  return v5State.tasks.filter((task) => v5FilterExpressionMatches(task, v5EnsureFilterExpression("execution")));
}
function v5ExecutionOptionList(selector, values, emptyLabel, getLabel, getValue, selected) {
  const node = $(selector); if (!node) return;
  node.innerHTML = v5Option("", emptyLabel, !selected) + values.map((value) => v5Option(getValue(value), getLabel(value), String(getValue(value)) === String(selected))).join("");
}
function v5RenderExecutionFilterOptions() {
  const execution = v5State.execution;
  v5RenderQuickAutocompleteOptions("execution");
  ["#v5ExecutionSearch", "#v5ExecutionFrom", "#v5ExecutionTo"].forEach((selector) => { const node = $(selector); if (node) node.value = execution[selector === "#v5ExecutionSearch" ? "search" : selector === "#v5ExecutionFrom" ? "from" : "to"] || ""; });
  const selects = [["#v5ExecutionScale", execution.scale], ["#v5ExecutionRange", execution.range]];
  selects.forEach(([selector, value]) => { const node = $(selector); if (node) node.value = value || ""; });
  const granularity = v5ExecutionGranularityValue(); const granularityInput = $("#v5ExecutionGranularity"); const granularityOutput = $("#v5ExecutionGranularityValue");
  if (granularityInput) { granularityInput.value = String(granularity); granularityInput.setAttribute("aria-valuetext", v5ExecutionGranularityLabel(granularity)); }
  if (granularityOutput) granularityOutput.textContent = v5ExecutionGranularityLabel(granularity);
  const onlyBusy = $("#v5ExecutionOnlyBusy"); const stack = $("#v5ExecutionStack"); if (onlyBusy) onlyBusy.checked = Boolean(execution.onlyBusy); if (stack) stack.checked = execution.stack !== false;
  v5RenderQuickFilterState("execution");
}
function v5ExecutionGranularityValue(value = v5State.execution.granularity) { const parsed = Number(value); return Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, 5) : 3; }
function v5ExecutionGranularityLabel(value) { return ({ 1: "紧凑", 2: "精简", 3: "标准", 4: "细致", 5: "精细" })[v5ExecutionGranularityValue(value)] || "标准"; }
function v5ExecutionStartOfUnit(date, scale) {
  if (scale === "day") return date;
  const value = new Date(`${date}T00:00:00`);
  if (scale === "week") { const day = value.getDay(); value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day)); return formatLocalDate(value); }
  value.setDate(1); return formatLocalDate(value);
}
function v5ExecutionNextUnit(date, scale) {
  const value = new Date(`${date}T00:00:00`);
  if (scale === "day") value.setDate(value.getDate() + 1);
  else if (scale === "week") value.setDate(value.getDate() + 7);
  else value.setMonth(value.getMonth() + 1, 1);
  return formatLocalDate(value);
}
function v5ExecutionBuildRange(tasks) {
  const execution = v5State.execution; const dated = tasks.filter((task) => v5ExecutionDateValue(task.start_date) && v5ExecutionDateValue(task.end_date));
  const today = todayLocalDate(); let start = execution.anchorDate || today; let end = addDays(start, 30);
  if (execution.range === "all" && dated.length) { start = dated.map((task) => task.start_date).sort()[0]; end = dated.map((task) => task.end_date).sort().at(-1); }
  else if (execution.range === "smart" && dated.length) { if (execution.anchorDate) { start = addDays(execution.anchorDate, -7); end = addDays(execution.anchorDate, 30); } else { start = addDays(dated.map((task) => task.start_date).sort()[0], -3); end = addDays(dated.map((task) => task.end_date).sort().at(-1), 3); } }
  else if (/^\d+$/.test(execution.range)) { start = execution.anchorDate || today; end = addDays(start, Number(execution.range)); }
  else if (execution.range === "week") { start = v5ExecutionStartOfUnit(execution.anchorDate || today, "week"); end = addDays(start, 6); }
  else if (execution.range === "month") { start = v5ExecutionStartOfUnit(execution.anchorDate || today, "month"); const next = new Date(`${start}T00:00:00`); next.setMonth(next.getMonth() + 1, 0); end = formatLocalDate(next); }
  start = v5ExecutionStartOfUnit(start, execution.scale); end = v5ExecutionNextUnit(v5ExecutionStartOfUnit(end, execution.scale), execution.scale); end = addDays(end, -1);
  if (end < start) end = addDays(start, 1);
  const units = []; let cursor = start; while (cursor <= end && units.length < 500) { const next = v5ExecutionNextUnit(cursor, execution.scale); units.push({ start: cursor, end: next <= end ? addDays(next, -1) : end }); cursor = next; }
  return { start, end, units };
}
function v5ExecutionUnitWidth() { const base = v5State.execution.scale === "day" ? 42 : v5State.execution.scale === "week" ? 106 : 145; const density = [0.7, 0.85, 1, 1.2, 1.42][v5ExecutionGranularityValue() - 1]; return Math.max(28, Math.round(base * density)); }
function v5ExecutionOffset(range, date) { if (!date || date < range.start) return 0; const unit = v5State.execution.scale; if (unit === "day") return daysBetween(range.start, date); if (unit === "week") return Math.floor(daysBetween(range.start, date) / 7); const start = new Date(`${range.start}T00:00:00`); const value = new Date(`${date}T00:00:00`); return (value.getFullYear() - start.getFullYear()) * 12 + value.getMonth() - start.getMonth(); }
function v5ExecutionDuration(range, start, end) { const clippedStart = start < range.start ? range.start : start; const clippedEnd = end > range.end ? range.end : end; if (clippedEnd < range.start || clippedStart > range.end) return 0; const width = v5ExecutionUnitWidth(); if (v5State.execution.scale === "day") return Math.max(16, (daysBetween(clippedStart, clippedEnd) + 1) * width - 6); if (v5State.execution.scale === "week") return Math.max(22, (daysBetween(clippedStart, clippedEnd) + 1) / 7 * width - 6); const units = v5ExecutionOffset(range, clippedEnd) - v5ExecutionOffset(range, clippedStart) + 1; return Math.max(22, units * width - 6); }
function v5ExecutionPosition(range, start, end) { const width = v5ExecutionUnitWidth(); const safeStart = start && start > range.start ? start : range.start; return { left: v5ExecutionOffset(range, safeStart) * width + 3, width: v5ExecutionDuration(range, start || range.start, end || range.end) }; }
function v5ExecutionTaskBar(task, range, member = null, lane = 0) {
  const start = v5ExecutionDateValue(member ? (member.start_date || task.start_date) : task.start_date); const end = v5ExecutionDateValue(member ? (member.end_date || task.end_date) : task.end_date); if (!start || !end) return ""; const position = v5ExecutionPosition(range, start, end); if (!position.width) return "";
  const label = member ? `${member.name} · ${task.title}` : task.title; const tone = member ? "member-bar" : "task-bar"; const color = /^#[0-9a-f]{3,8}$/i.test(task.color || "") ? task.color : "#2563eb"; const barLabel = member?.__ganttLabel || (member ? member.name : task.title);
  return `<button type="button" class="v5-execution-bar ${tone}${task.status === "test-delayed" || task.status === "sample-delayed" ? " is-delayed" : ""}" style="left:${position.left}px;width:${position.width}px;top:${member ? 10 + lane * 28 : 10}px;--task-accent:${escapeHtml(color)}" data-v5-exec-select-task="${task.id}"${member ? ` data-v5-exec-edit-member="${task.id}" data-v5-exec-member="${member.id}"` : ""} title="${escapeHtml(label)}：${escapeHtml(start)} 至 ${escapeHtml(end)}">${escapeHtml(barLabel)}</button>`;
}
function v5ExecutionMemberLanes(task, members) {
  const lanes = []; return members.slice().sort((a, b) => String(a.start_date || "").localeCompare(String(b.start_date || ""))).map((member) => { if (v5State.execution.stack === false) return { member, lane: 0 }; let lane = lanes.findIndex((end) => !end || member.start_date > end); if (lane < 0) { lane = lanes.length; lanes.push(member.end_date); } else lanes[lane] = member.end_date; return { member, lane }; });
}
function v5ExecutionGridBackground(range) { const width = v5ExecutionUnitWidth(); const today = todayLocalDate(); const todayIndex = today >= range.start && today <= range.end ? v5ExecutionOffset(range, today) : null; return { width, todayIndex, grid: `repeating-linear-gradient(to right, #eef2f7 0, #eef2f7 1px, transparent 1px, transparent ${width}px)` }; }
function v5ExecutionAssignmentLanes(items) {
  const lanes = [];
  return items.slice().sort((a, b) => String(a.member?.start_date || a.task.start_date || "").localeCompare(String(b.member?.start_date || b.task.start_date || ""))).map((item) => {
    if (v5State.execution.stack === false) return { ...item, lane: 0 };
    const start = item.member?.start_date || item.task.start_date || ""; const end = item.member?.end_date || item.task.end_date || "";
    let lane = lanes.findIndex((lastEnd) => !lastEnd || start > lastEnd);
    if (lane < 0) { lane = lanes.length; lanes.push(end); } else lanes[lane] = end;
    return { ...item, lane };
  });
}
function v5ExecutionMemberGanttRows(tasks) {
  const rows = new Map();
  const ensure = (key, member = null) => { if (!rows.has(key)) rows.set(key, { key, member, items: [] }); return rows.get(key); };
  v5State.resources.members.filter((member) => v5ResourceActive("members", member)).forEach((member) => ensure(`member-${member.id}`, member));
  tasks.forEach((task) => {
    const members = v5ExecutionTaskMembers(task).filter((member) => !v5State.execution.memberId || String(member.id) === String(v5State.execution.memberId));
    if (!members.length) { ensure("unassigned", null).items.push({ task, member: null }); return; }
    members.forEach((member) => ensure(`member-${member.id}`, member).items.push({ task, member }));
  });
  const query = String(v5State.execution.memberSearch || "").trim().toLocaleLowerCase("zh-CN");
  return [...rows.values()].filter((row) => {
    if (v5State.execution.memberId && row.key !== `member-${v5State.execution.memberId}`) return false;
    if (v5State.execution.onlyBusy && !row.items.length) return false;
    if (query && row.member && !`${row.member.name || ""} ${row.member.role || ""}`.toLocaleLowerCase("zh-CN").includes(query)) return false;
    return row.items.length || row.member;
  }).sort((a, b) => {
    if (a.key === "unassigned") return 1; if (b.key === "unassigned") return -1;
    return String(a.member?.name || "").localeCompare(String(b.member?.name || ""), "zh-CN");
  });
}
function v5RenderExecutionGantt(tasks) {
  const node = $("#v5ExecutionGantt"); if (!node) return; if (!tasks.length) { node.innerHTML = `<div class="v5-empty-state"><h3>当前筛选没有任务</h3><p>清除筛选或调整日期范围后重试。</p></div>`; return; }
  const range = v5ExecutionBuildRange(tasks); const { width, todayIndex, grid } = v5ExecutionGridBackground(range); const totalWidth = range.units.length * width; const rows = v5ExecutionMemberGanttRows(tasks);
  const header = `<div class="v5-execution-gantt-scroll"><div class="v5-execution-gantt-canvas" style="--v5-exec-track-width:${totalWidth}px"><div class="v5-execution-gantt-header"><div class="v5-execution-label-heading">成员 / 任务</div><div class="v5-execution-timeline-header" style="width:${totalWidth}px">${range.units.map((unit) => `<span style="width:${width}px">${escapeHtml(unit.start.slice(0, 7))}<small>${escapeHtml(unit.start.slice(5))}</small></span>`).join("")}</div></div>${rows.map((row) => { const lanes = v5ExecutionAssignmentLanes(row.items); const laneCount = lanes.length ? Math.max(...lanes.map((item) => item.lane)) + 1 : 0; const rowHeight = Math.max(60, 36 + laneCount * 28); const background = `background-image:${grid};`; const bars = lanes.map(({ task, member, lane }) => member ? v5ExecutionTaskBar(task, range, { ...member, __ganttLabel: task.title }, lane) : v5ExecutionTaskBar(task, range)).join(""); const first = row.items[0]; const labelTask = first?.task; const meta = row.member ? `${row.items.length} 个任务 · ${row.member.role || "测控成员"}` : `${row.items.length} 个未分配任务`; return `<div class="v5-execution-gantt-row${row.items.some((item) => Number(item.task.id) === Number(v5State.execution.selectedTaskId)) ? " is-selected" : ""}" style="min-height:${rowHeight}px"><div class="v5-execution-row-label"><button type="button" data-v5-exec-select-task="${labelTask?.id || ""}"><strong>${escapeHtml(row.member?.name || "未分配成员")}</strong><small>${escapeHtml(meta)}</small><span>${labelTask ? v5StatusChip(labelTask) : ""} <em>${escapeHtml(labelTask?.source_group?.name || "成员任务时间轴")}</em></span></button></div><div class="v5-execution-timeline" style="width:${totalWidth}px;min-height:${rowHeight}px;${background}">${todayIndex === null ? "" : `<i class="v5-execution-today-line" style="left:${todayIndex * width}px"></i>`}${bars || `<span class="v5-execution-unscheduled">暂无任务</span>`}</div></div>`; }).join("")}</div></div>`;
  node.innerHTML = header; const label = $("#v5ExecutionRangeLabel"); if (label) label.textContent = `${range.start} 至 ${range.end} · ${range.units.length} 个${v5State.execution.scale === "day" ? "日" : v5State.execution.scale === "week" ? "周" : "月"}`;
}
function v5ExecutionLoadRows(tasks) {
  const rows = new Map(); const add = (member, task) => { if (!member) return; const id = Number(member.id); if (!rows.has(id)) rows.set(id, { member, tasks: [], days: 0, overlaps: 0 }); const row = rows.get(id); row.tasks.push({ task, member }); if (member.start_date && member.end_date) row.days += Math.max(1, daysBetween(member.start_date, member.end_date) + 1); };
  tasks.forEach((task) => v5ExecutionTaskMembers(task).forEach((member) => add(member, task))); rows.forEach((row) => { const sorted = row.tasks.filter((item) => item.member.start_date && item.member.end_date).sort((a, b) => a.member.start_date.localeCompare(b.member.start_date)); for (let i = 1; i < sorted.length; i += 1) if (sorted[i].member.start_date <= sorted[i - 1].member.end_date) row.overlaps += 1; }); return [...rows.values()].sort((a, b) => b.tasks.length - a.tasks.length || a.member.name.localeCompare(b.member.name, "zh-CN"));
}
function v5ExecutionVisibleMemberRows(tasks) {
  const rows = v5ExecutionLoadRows(tasks);
  const withEmpty = v5State.resources.members.filter((member) => v5ResourceActive("members", member) || tasks.some((task) => v5ExecutionTaskMembers(task).some((assigned) => Number(assigned.id) === Number(member.id)))).map((member) => rows.find((row) => Number(row.member.id) === Number(member.id)) || { member, tasks: [], days: 0, overlaps: 0 });
  const query = String(v5State.execution.memberSearch || "").trim().toLocaleLowerCase("zh-CN");
  const filtered = withEmpty.filter((row) => !query || `${row.member.name || ""} ${row.member.role || ""}`.toLocaleLowerCase("zh-CN").includes(query));
  return v5State.execution.onlyBusy ? filtered.filter((row) => row.tasks.length) : filtered;
}
function v5RenderExecutionMemberList(tasks) {
  const node = $("#v5ExecutionMemberList"); if (!node) return;
  const rows = v5ExecutionVisibleMemberRows(tasks); const search = $("#v5ExecutionMemberSearch"); if (search && search.value !== v5State.execution.memberSearch) search.value = v5State.execution.memberSearch || "";
  node.innerHTML = rows.length ? rows.map((row) => `<button type="button" class="v5-execution-member-item${String(row.member.id) === String(v5State.execution.memberId) ? " is-selected" : ""}" data-v5-exec-member-filter="${row.member.id}"><span class="v5-execution-member-avatar">${escapeHtml(String(row.member.name || "?").slice(0, 1))}</span><span class="v5-execution-member-copy"><strong>${escapeHtml(row.member.name)}</strong><small>${escapeHtml(row.member.role || "测控成员")}</small></span><span class="v5-execution-member-count">${row.tasks.length}<small>任务</small></span></button>`).join("") : `<div class="v5-empty-state compact"><p>${v5State.execution.memberSearch ? "没有匹配成员。" : "当前没有可显示的成员。"}</p></div>`;
}
function v5RenderExecutionLoad(tasks) { const node = $("#v5ExecutionLoad"); const rows = v5ExecutionVisibleMemberRows(tasks); $("#v5ExecutionLoadCount").textContent = `${rows.length} 名成员`; v5RenderExecutionMemberList(tasks); if (!node) return; node.innerHTML = rows.length ? `<table class="v5-execution-load-table"><thead><tr><th>成员</th><th>任务数</th><th>排期天数</th><th>重叠</th></tr></thead><tbody>${rows.map((row) => `<tr class="${String(row.member.id) === String(v5State.execution.memberId) ? "is-selected" : ""}"><td><button type="button" data-v5-exec-member-filter="${row.member.id}"><strong>${escapeHtml(row.member.name)}</strong><small>${escapeHtml(row.member.role || "测控成员")}</small></button></td><td>${row.tasks.length}</td><td>${row.days}</td><td>${row.overlaps || "—"}</td></tr>`).join("")}</tbody></table>` : `<div class="v5-empty-state" style="padding:24px 10px"><p>当前筛选没有成员负载。</p></div>`; }
function v5RenderExecutionStats(tasks) { const stats = $("#v5ExecutionStats"); if (!stats) return; const delayed = tasks.filter((task) => task.status === "sample-delayed" || task.status === "test-delayed").length; const testing = tasks.filter((task) => task.status === "testing").length; const scheduled = tasks.filter((task) => task.start_date && task.end_date).length; const members = new Set(tasks.flatMap((task) => v5ExecutionTaskMembers(task).map((member) => Number(member.id)))); stats.innerHTML = `<article><span>当前任务</span><strong>${tasks.length}</strong><small>${scheduled} 个已排期</small></article><article><span>正在测试</span><strong>${testing}</strong><small>需要人工切换阶段</small></article><article class="is-warning"><span>延期任务</span><strong>${delayed}</strong><small>按当前日期自动计算</small></article><article><span>涉及成员</span><strong>${members.size}</strong><small>当前筛选范围</small></article>`; }
function v5RenderExecutionDetail() { const node = $("#v5ExecutionDetail"); if (!node) return; const task = v5State.tasks.find((row) => Number(row.id) === Number(v5State.execution.selectedTaskId)); if (!task) { node.innerHTML = `<div class="v5-empty-state" style="padding:25px 12px"><p>点击任务条或任务列表查看详情。</p></div>`; return; } const members = v5ExecutionTaskMembers(task); node.innerHTML = `<div class="v5-execution-detail-body"><div class="v5-execution-detail-title"><strong>${escapeHtml(task.task_number || `TASK-${task.id}`)} · ${escapeHtml(task.title)}</strong>${v5StatusChip(task)}</div><p class="v5-muted">${escapeHtml(v5TopicName(task.topic_id))} · ${escapeHtml(task.source_group?.name || "来源小组待补充")} · ${escapeHtml(task.cryostat?.name || "制冷机待补充")}</p><dl class="v5-execution-facts"><div><dt>任务排期</dt><dd>${escapeHtml(task.start_date || "未排期")} → ${escapeHtml(task.end_date || "—")}</dd></div><div><dt>测试目的</dt><dd>${escapeHtml(task.purpose || "待补充")}</dd></div><div><dt>样品</dt><dd>${escapeHtml((task.samples || []).map((sample) => [sample.model, sample.sample_no].filter(Boolean).join(" · ")).filter(Boolean).join("、") || "待补充")}</dd></div></dl><div class="v5-execution-detail-actions"><button type="button" class="primary-action" data-v5-exec-edit-task="${task.id}">修改任务时间</button><button type="button" class="ghost-button" data-v5-open-editor="${task.id}">打开全量编辑</button></div><div class="v5-execution-member-list"><h4>成员排期</h4>${members.length ? members.map((member) => `<div class="v5-execution-member-row"><span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.start_date || "未排期")} → ${escapeHtml(member.end_date || "—")}</small></span><button type="button" class="small-button" data-v5-exec-edit-member="${task.id}" data-v5-exec-member="${member.id}">修改</button></div>`).join("") : `<p class="v5-muted">尚未分配成员。</p>`}</div></div>`; }
function v5RenderExecutionTaskList(tasks) { const node = $("#v5ExecutionTaskList"); if (!node) return; $("#v5ExecutionTaskCount").textContent = `${tasks.length} 个任务`; node.innerHTML = tasks.length ? tasks.map((task) => `<button type="button" class="v5-execution-task-list-row${Number(task.id) === Number(v5State.execution.selectedTaskId) ? " is-selected" : ""}" data-v5-exec-select-task="${task.id}"><span class="v5-task-accent${task.color ? " has-color" : ""}"${task.color ? ` style="--task-accent:${escapeHtml(task.color)}"` : ""}></span><span><strong>${escapeHtml(task.task_number || `TASK-${task.id}`)} · ${escapeHtml(task.title)}</strong><small>${escapeHtml(v5TopicName(task.topic_id))} · ${escapeHtml(task.start_date || "未排期")} → ${escapeHtml(task.end_date || "—")}</small></span><span>${v5StatusChip(task)}</span><span class="v5-execution-task-members">${escapeHtml(v5ExecutionTaskMembers(task).map((member) => member.name).join("、") || "未分配")}</span></button>`).join("") : `<div class="v5-empty-state" style="padding:24px"><p>没有符合条件的任务。</p></div>`; }
function v5SetExecutionSubView(view) { const next = ["gantt", "tasks", "load"].includes(view) ? view : "gantt"; v5State.execution.activeView = next; $$('[data-v5-exec-view]').forEach((button) => { const active = button.dataset.v5ExecView === next; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); }); $$('[data-v5-exec-panel]').forEach((panel) => { const active = panel.dataset.v5ExecPanel === next; panel.hidden = !active; panel.classList.toggle("active", active); }); }
function v5RenderExecution() { const tasks = v5ExecutionFilteredTasks(); v5RenderExecutionFilterOptions(); v5RenderExecutionStats(tasks); v5RenderExecutionGantt(tasks); v5RenderExecutionLoad(tasks); v5RenderExecutionDetail(); v5RenderExecutionTaskList(tasks); v5SetExecutionSubView(v5State.execution.activeView); }

function v5OpenScheduleEditor(taskId, mode = "task", memberId = null) { const task = v5State.tasks.find((row) => Number(row.id) === Number(taskId)); if (!task) return; const schedule = v5State.execution.schedule = { mode, taskId: task.id, memberId: memberId == null ? null : Number(memberId), preview: null }; const member = v5ExecutionTaskMembers(task).find((row) => Number(row.id) === Number(memberId)); v5State.customComboboxOptions = { ...v5State.customComboboxOptions, "schedule-member": v5ExecutionTaskMembers(task).map((row) => ({ value: row.id, label: row.name })) }; $("#v5ScheduleDialogTitle").textContent = mode === "member" ? "修改成员排期" : "修改任务时间"; $("#v5ScheduleDialogHint").textContent = mode === "member" ? `仅修改 ${member?.name || "目标成员"} 在该任务中的日期，保存时自动检查冲突。` : "可选择是否同步所有成员；保存时自动检查冲突。"; $("#v5ScheduleTaskSummary").innerHTML = `<strong>${escapeHtml(task.task_number || `TASK-${task.id}`)} · ${escapeHtml(task.title)}</strong><p>${escapeHtml(v5TopicName(task.topic_id))} · 当前任务排期：${escapeHtml(task.start_date || "未排期")} → ${escapeHtml(task.end_date || "—")}</p>`; $("#v5ScheduleStart").value = mode === "member" ? (member?.start_date || task.start_date || "") : (task.start_date || ""); $("#v5ScheduleEnd").value = mode === "member" ? (member?.end_date || task.end_date || "") : (task.end_date || ""); $("#v5ScheduleMemberField").hidden = mode !== "member"; $("#v5ScheduleSyncField").hidden = mode === "member"; $("#v5ScheduleSync").checked = mode === "task"; $("#v5ScheduleBoundaryHint").textContent = mode === "member" ? "成员日期超出任务整体范围时，保存前会提示确认；如需扩展任务整体，请在全量编辑台修改任务日期。" : "同步所有成员会将每位成员的起止日一起平移到新的任务日期。"; v5TaskRenderSingleCombobox("schedule-member", v5TaskOptions("schedule-member"), memberId, "选择成员"); v5SetFormError("#v5ScheduleFormError"); $("#v5ScheduleSaveBtn").disabled = false; v5Open("#v5ScheduleDialog"); }
async function v5PreviewSchedule() { const schedule = v5State.execution.schedule; if (!schedule) return null; const task = v5State.tasks.find((row) => Number(row.id) === Number(schedule.taskId)); if (!task) return null; const start = $("#v5ScheduleStart").value; const end = $("#v5ScheduleEnd").value; if (!start || !end || end < start) throw new Error("请填写有效的开始和结束日期。"); const path = schedule.mode === "member" ? `/api/v5/tasks/${task.id}/member-schedule-preview` : `/api/v5/tasks/${task.id}/schedule-preview`; const memberId = Number(v5TaskCombobox("schedule-member")?.dataset.v5TaskValue); if (schedule.mode === "member" && (!Number.isInteger(memberId) || memberId <= 0)) throw new Error("请选择成员"); const payload = schedule.mode === "member" ? { member_id: memberId, start_date: start, end_date: end } : { start_date: start, end_date: end, sync_members: $("#v5ScheduleSync").checked }; schedule.memberId = schedule.mode === "member" ? memberId : null; schedule.preview = await v5Api(path, v5Json("POST", payload)); return schedule.preview; }
async function v5SaveSchedule(event) { event.preventDefault(); const schedule = v5State.execution.schedule; const task = v5State.tasks.find((row) => Number(row.id) === Number(schedule?.taskId)); if (!schedule || !task) return; try { v5SetFormError("#v5ScheduleFormError"); const preview = await v5PreviewSchedule(); if (!preview) return; const conflicts = preview.conflicts || []; const conflictText = conflicts.map((conflict) => `${conflict.type || "排期冲突"}：${conflict.message || conflict.reason || "请确认影响"}`).join("\n"); const ack = conflicts.length ? window.confirm(`排期检查发现 ${conflicts.length} 项影响：\n${conflictText}\n\n是否继续保存？`) : false; if (conflicts.length && !ack) { v5SetFormError("#v5ScheduleFormError", "已取消保存，排期未发生变化。若确认继续，请再次点击保存并在提示中确认影响。"); return; } const start = $("#v5ScheduleStart").value; const end = $("#v5ScheduleEnd").value; const payload = schedule.mode === "member" ? { member_id: schedule.memberId, start_date: start, end_date: end, preview_token: preview.preview_token, expected_version: task.version, ack } : { start_date: start, end_date: end, sync_members: $("#v5ScheduleSync").checked, preview_token: preview.preview_token, expected_version: task.version, ack }; await v5Api(`/api/v5/tasks/${task.id}/${schedule.mode === "member" ? "member-schedule" : "schedule"}`, v5Json("POST", payload)); v5Close("#v5ScheduleDialog"); v5State.execution.selectedTaskId = task.id; schedule.preview = null; await v5LoadAll(); showToast(schedule.mode === "member" ? "成员排期已更新" : "任务排期已更新"); } catch (error) { v5SetFormError("#v5ScheduleFormError", v5ErrorText(error)); } }

async function v5LoadAll() { v5SetSync("正在同步 V5 数据…"); try { const topicPath = v5State.showArchivedTopics ? "/api/v5/topics?include_archived=1" : "/api/v5/topics"; const [resources, topics, tasks, samples] = await Promise.all([v5Api("/api/v5/resources"), v5Api(topicPath), v5Api("/api/v5/tasks"), v5Api("/api/v5/samples")]); v5State.resources = resources; v5State.topics = topics.items || []; v5State.tasks = tasks.items || []; v5State.samples = samples.items || []; if (!v5State.expandedTopics.size) v5State.topics.forEach((topic) => v5State.expandedTopics.add(Number(topic.id))); v5State.loaded = true; v5RenderFilterOptions(); v5RenderTree(); v5RenderSelectedTask(); v5RenderResources(); v5RenderExecution(); v5SetSync(`已同步 · ${v5State.tasks.length} 个任务 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`); } catch (error) { v5SetSync(v5ErrorText(error), true); $("#v5TopicTaskTree").innerHTML = `<div class="v5-empty-state"><h3>V5 数据读取失败</h3><p>${escapeHtml(v5ErrorText(error))}</p><button class="ghost-button" type="button" data-v5-retry>重试</button></div>`; } }

function v5SetView(view) { $$("[data-v5-view]").forEach((button) => { const active = button.dataset.v5View === view; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); }); $$("[data-v5-panel]").forEach((panel) => { const active = panel.dataset.v5Panel === view; panel.hidden = !active; panel.classList.toggle("active", active); }); const title = { editor: "任务全量编辑台", resources: "资源维护", execution: "执行中心" }[view] || "任务全量编辑台"; const hint = { editor: "在一个页面补齐任务字段，专题、资源和任务始终使用同一份事实。", resources: "维护稳定 ID 资源，名称改动会同步到任务树和执行中心。", execution: "查看成员负载与任务时间安排，所有时间修改都回写同一份任务事实。" }[view]; $("#v5PageTitle").textContent = title; $("#v5PageHint").textContent = hint; $("#v5NewTaskBtn").hidden = view !== "editor"; if (view === "resources") v5RenderResources(); }

const v5SetViewBase = v5SetView;
v5SetView = function v5SetViewWithExecution(view) { v5SetViewBase(view); if (view === "execution") v5RenderExecution(); };

function bindV5Events() {
  if (window.__v5Bound) return; window.__v5Bound = true;
  $$('[data-v5-view]').forEach((button) => button.addEventListener("click", () => v5SetView(button.dataset.v5View)));
  $("#v5RefreshBtn")?.addEventListener("click", () => v5LoadAll()); $("#v5NewTaskBtn")?.addEventListener("click", () => v5OpenTaskEditor()); $("#v5EmptyNewTaskBtn")?.addEventListener("click", () => v5OpenTaskEditor()); $("#v5NewTopicBtn")?.addEventListener("click", () => v5OpenTopicEditor()); $("#v5ExpandAllBtn")?.addEventListener("click", () => { v5State.topics.forEach((topic) => v5State.expandedTopics.add(Number(topic.id))); v5RenderTree(); }); $("#v5CollapseAllBtn")?.addEventListener("click", () => { v5State.expandedTopics.clear(); v5RenderTree(); });
  $("#v5OpenEditorFilters")?.addEventListener("click", () => v5OpenFilterDialog("editor")); $("#v5ClearTaskFilters")?.addEventListener("click", () => v5ResetFilterSurface("editor"));
  v5FilterQuickConfig("editor").forEach(({ field, selector, negate }) => { const node = $(selector); const schema = v5FilterSchema("editor", field); node?.addEventListener(schema?.kind === "text" ? "input" : "change", () => v5UpdateQuickFilter("editor", field)); if (negate) $(negate)?.addEventListener("change", () => v5UpdateQuickFilter("editor", field)); });
  $("#v5TaskForm")?.addEventListener("submit", v5SaveTask); $("#v5TopicForm")?.addEventListener("submit", v5SaveTopic); $("#v5ResourceForm")?.addEventListener("submit", v5SaveResource); $("#v5TopicMoveForm")?.addEventListener("submit", v5SaveTopicMove); $("#v5TopicMoveTarget")?.addEventListener("change", v5RenderTopicMovePreview); $("#v5ShowArchivedTopics")?.addEventListener("change", (event) => { v5State.showArchivedTopics = event.target.checked; v5LoadAll(); });
  $("#v5TaskSamples")?.addEventListener("change", (event) => { if (!event.target.classList.contains("v5-sample-check")) return; v5State.dialogSampleIds = new Set($$("#v5TaskSamples .v5-sample-check:checked").map((input) => Number(input.value))); v5RenderSamplesInForm(v5State.tasks.find((task) => Number(task.id) === Number(v5State.editingTaskId))); });
  $("#v5AddTestItemBtn")?.addEventListener("click", () => $("#v5TestItemsEditor").insertAdjacentHTML("beforeend", `<div class="v5-repeatable-item"><input data-test-item-field="name" placeholder="测试项名称"><input data-test-item-field="acceptance_criteria" placeholder="测试要求"><textarea data-test-item-field="note" rows="1" placeholder="备注"></textarea><button class="small-button danger-button" type="button" data-v5-remove-test-item>删除</button></div>`));
  $("#v5AddSampleBtn")?.addEventListener("click", async () => { const model = $("#v5SampleModel").value.trim(); const eta = $("#v5SampleEta").value || null; const pending = $("#v5SampleEtaPending").checked; const notes = $("#v5SampleNotes").value.trim(); try { if (!model || (!eta && !pending)) throw new Error("新增样品需要填写样品型号，并填写 ETA 或勾选待确认"); const sample = await v5Api("/api/v5/samples", v5Json("POST", { model, eta_date: eta, eta_pending: pending, notes, actor: "本地用户" })); v5State.samples.push(sample); v5State.dialogSampleIds.add(Number(sample.id)); $("#v5SampleModel").value = ""; $("#v5SampleEta").value = ""; $("#v5SampleEtaPending").checked = false; $("#v5SampleNotes").value = ""; v5RenderSamplesInForm(v5State.tasks.find((task) => Number(task.id) === Number(v5State.editingTaskId))); showToast("样品已新增"); } catch (error) { v5SetFormError("#v5TaskFormError", v5ErrorText(error)); } });
  document.body.addEventListener("submit", (event) => { if (event.target.closest("#v5InlineTaskForm")) v5SaveInlineTask(event); });
  document.body.addEventListener("input", (event) => {
    if (!event.target.matches("[data-v5-inline-member-search]")) return;
    const taskId = Number(event.target.closest("#v5InlineTaskForm")?.dataset.v5InlineTask);
    const task = v5State.tasks.find((row) => Number(row.id) === taskId);
    v5RenderInlineMembers(task, event.target.value);
  });
  document.body.addEventListener("change", (event) => {
    if (!event.target.matches(".v5-inline-member-check")) return;
    const form = event.target.closest("#v5InlineTaskForm"); const taskId = Number(form?.dataset.v5InlineTask);
    v5RenderInlineMemberSummary(v5State.tasks.find((row) => Number(row.id) === taskId), form);
  });
  document.body.addEventListener("click", async (event) => { const action = (selector) => event.target.closest(selector); try { if (action("[data-v5-close-dialog]")) return v5Close(`#${action("[data-v5-close-dialog]").dataset.v5CloseDialog}`); if (action("[data-v5-toggle-topic]")) { const id = Number(action("[data-v5-toggle-topic]").dataset.v5ToggleTopic); if (v5State.expandedTopics.has(id)) v5State.expandedTopics.delete(id); else v5State.expandedTopics.add(id); return v5RenderTree(); } if (action("[data-v5-move-task]")) return v5OpenTopicMove("task", Number(action("[data-v5-move-task]").dataset.v5MoveTask)); if (action("[data-v5-select-task]")) { v5State.selectedTaskId = Number(action("[data-v5-select-task]").dataset.v5SelectTask); v5RenderTree(); return v5RenderSelectedTask(); } if (action("[data-v5-edit-task]")) return v5OpenTaskEditor(Number(action("[data-v5-edit-task]").dataset.v5EditTask)); if (action("[data-v5-new-task-topic]")) return v5OpenTaskEditor(null, Number(action("[data-v5-new-task-topic]").dataset.v5NewTaskTopic)); if (action("[data-v5-new-topic]")) return v5OpenTopicEditor(); if (action("[data-v5-edit-topic]")) return v5OpenTopicEditor(Number(action("[data-v5-edit-topic]").dataset.v5EditTopic)); if (action("[data-v5-delete-topic]")) return v5OpenTopicMove("delete", Number(action("[data-v5-delete-topic]").dataset.v5DeleteTopic)); if (action("[data-v5-start-testing]")) return v5StartTesting(Number(action("[data-v5-start-testing]").dataset.v5StartTesting)); if (action("[data-v5-complete-task]")) return v5StartTesting(Number(action("[data-v5-complete-task]").dataset.v5CompleteTask), true); if (action("[data-v5-retry]")) return v5LoadAll(); if (action("[data-v5-back-editor]")) return v5SetView("editor"); if (action("[data-v5-open-maintenance]")) { $("#legacyV2Content").hidden = false; setV2View("management"); return; } if (action("[data-v5-add-resource]")) return v5OpenResourceEditor(action("[data-v5-add-resource]").dataset.v5AddResource); if (action("[data-v5-edit-resource]")) { const [kind, id] = action("[data-v5-edit-resource]").dataset.v5EditResource.split(":"); return v5OpenResourceEditor(kind, Number(id)); } if (action("[data-v5-inline-toggle-members]")) { const button = action("[data-v5-inline-toggle-members]"); const panel = document.querySelector(`#${button.getAttribute("aria-controls")}`); if (!panel) return; const open = panel.hidden; panel.hidden = !open; button.setAttribute("aria-expanded", String(open)); if (open) document.querySelector("[data-v5-inline-member-search]")?.focus(); return; } if (action("[data-v5-inline-add-test-item]")) { $("#v5InlineTestItems")?.insertAdjacentHTML("beforeend", v5InlineTestItemMarkup()); return; } if (action("[data-v5-remove-inline-test-item]")) { action("[data-v5-remove-inline-test-item]").closest(".v5-inline-test-item")?.remove(); return; } if (action("[data-v5-inline-cancel]")) return v5RenderSelectedTask(); if (action("[data-v5-remove-test-item]")) { action("[data-v5-remove-test-item]").closest(".v5-repeatable-item")?.remove(); return; } } catch (error) { showToast(v5ErrorText(error), { type: "error" }); } });
  $("#v5FilterForm")?.addEventListener("submit", (event) => { event.preventDefault(); const surface = v5State.filterDraftSurface; if (!surface) return; v5ApplyFilterExpression(surface, v5State.filterDraft); v5Close("#v5FilterDialog"); });
  $("#v5FilterAddCondition")?.addEventListener("click", () => { const surface = v5State.filterDraftSurface; if (!surface) return; const field = $("#v5FilterAddField")?.value || v5FilterSchemas[surface][0].field; if (!v5State.filterDraft.groups.length) v5State.filterDraft.groups.push({ id: `group-${Date.now()}`, logic: "and", connector: "and", conditions: [] }); v5State.filterDraft.groups[0].conditions.push(v5FilterConditionFromField(surface, field)); v5RenderFilterBuilder(); });
  $("#v5FilterAddGroup")?.addEventListener("click", () => { const surface = v5State.filterDraftSurface; if (!surface) return; v5State.filterDraft.groups.push({ id: `group-${Date.now()}`, logic: "and", connector: "and", conditions: [] }); v5RenderFilterBuilder(); });
  $("#v5FilterReset")?.addEventListener("click", () => { const surface = v5State.filterDraftSurface; if (!surface) return; v5ApplyFilterExpression(surface, v5EmptyFilterExpression()); v5Close("#v5FilterDialog"); });
  document.body.addEventListener("focusin", (event) => { v5ShowFilterAutocompleteForInput(event.target.closest("[data-v5-filter-autocomplete-input]")); });
  document.body.addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-v5-filter-autocomplete-input]");
    if (!input) {
      const option = event.target.closest("[data-v5-filter-option]");
      if (!option) return;
      const key = option.dataset.v5FilterOption; const menu = option.closest("[data-v5-filter-autocomplete]")?.querySelector(".v5-filter-autocomplete-menu"); const options = [...(menu?.querySelectorAll("[data-v5-filter-option]") || [])]; const index = options.indexOf(option);
      if (event.key === "Escape") { event.preventDefault(); v5FilterCloseKeywordSuggestions(key); v5FilterKeywordInput(key)?.focus(); }
      else if (event.key === "ArrowDown" && options.length) { event.preventDefault(); options[(index + 1) % options.length].focus(); }
      else if (event.key === "ArrowUp" && options.length) { event.preventDefault(); options[(index - 1 + options.length) % options.length].focus(); }
      return;
    }
    const key = input.dataset.v5FilterAutocompleteInput;
    if (event.key === "Escape") { event.preventDefault(); v5FilterCloseKeywordSuggestions(key); return; }
    if (event.key === "ArrowDown") { const first = v5FilterKeywordMenu(key)?.querySelector("[data-v5-filter-option]"); if (first) { event.preventDefault(); first.focus(); } }
  });
  document.body.addEventListener("input", (event) => { const key = event.target.dataset.v5FilterValue || event.target.dataset.v5FilterMultiInput; if (!key || !v5State.filterDraft) return; const [groupIndex, conditionIndex] = key.split("-").map(Number); const condition = v5State.filterDraft.groups[groupIndex]?.conditions?.[conditionIndex]; if (!condition) return; if (event.target.dataset.v5FilterMultiInput) { const schema = v5FilterSchema(v5State.filterDraftSurface, condition.field); v5FilterRenderAutocompleteSuggestions(v5State.filterDraftSurface, schema, key, event.target.value, condition); } else { condition.value = event.target.value; v5FilterRenderKeywordSuggestions(v5State.filterDraftSurface, key, event.target.value); } });
  document.body.addEventListener("change", (event) => { if (!v5State.filterDraft) return; const key = event.target.dataset.v5FilterValue || event.target.dataset.v5FilterMatch || event.target.dataset.v5FilterNegate; if (key) { const [groupIndex, conditionIndex] = key.split("-").map(Number); const condition = v5State.filterDraft.groups[groupIndex]?.conditions?.[conditionIndex]; if (!condition) return; if (event.target.dataset.v5FilterValue) condition.value = event.target.multiple ? [...event.target.selectedOptions].map((option) => option.value) : event.target.value; else if (event.target.dataset.v5FilterMatch) condition.match = event.target.value === "all" ? "all" : "any"; else condition.negate = event.target.checked; return; } const groupLogic = event.target.dataset.v5FilterGroupLogic; if (groupLogic) { const group = v5State.filterDraft.groups[Number(groupLogic)]; if (group) group.logic = event.target.value === "or" ? "or" : "and"; return; } const groupConnector = event.target.dataset.v5FilterGroupConnector; if (groupConnector) { const group = v5State.filterDraft.groups[Number(groupConnector)]; if (group) group.connector = event.target.value === "or" ? "or" : "and"; } });
  document.body.addEventListener("keydown", (event) => { const input = event.target.closest("[data-v5-resource-search], [data-v5-execution-member-search]"); const option = event.target.closest("[data-v5-resource-option], [data-v5-execution-member-option-value]"); if (input && event.key === "Escape") { event.preventDefault(); v5CloseAllV5AutocompleteMenus(); return; } if (input && event.key === "ArrowDown") { const first = input.closest(".v5-resource-search-autocomplete")?.querySelector("[data-v5-resource-option], [data-v5-execution-member-option-value]"); if (first) { event.preventDefault(); first.focus(); } } if (option) { const menu = option.closest(".v5-resource-search-autocomplete"); const options = [...(menu?.querySelectorAll("[data-v5-resource-option], [data-v5-execution-member-option-value]") || [])]; const index = options.indexOf(option); if (event.key === "ArrowDown" && options.length) { event.preventDefault(); options[(index + 1) % options.length].focus(); } else if (event.key === "ArrowUp" && options.length) { event.preventDefault(); options[(index - 1 + options.length) % options.length].focus(); } else if (event.key === "Escape") { event.preventDefault(); v5CloseAllV5AutocompleteMenus(); menu?.querySelector("input")?.focus(); } } });
  document.body.addEventListener("click", (event) => {
    const autocompleteInput = event.target.closest("[data-v5-filter-autocomplete-input]");
    if (autocompleteInput && v5ShowFilterAutocompleteForInput(autocompleteInput)) return;
    const option = event.target.closest("[data-v5-filter-option]");
    if (option && v5State.filterDraft) {
      const key = option.dataset.v5FilterOption; const [groupIndex, conditionIndex] = key.split("-").map(Number); const condition = v5State.filterDraft.groups[groupIndex]?.conditions?.[conditionIndex];
      if (condition) { const value = option.dataset.v5FilterOptionValue || ""; if (option.dataset.v5FilterOptionMulti) { const values = v5FilterNormaliseValues(condition); condition.value = values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; v5RenderFilterBuilder(); const nextInput = v5FilterKeywordInput(key); const schema = v5FilterSchema(v5State.filterDraftSurface, condition.field); if (nextInput && schema) { nextInput.focus(); v5FilterRenderAutocompleteSuggestions(v5State.filterDraftSurface, schema, key, nextInput.value, condition); } } else { condition.value = value; const input = v5FilterKeywordInput(key); if (input) input.value = condition.value; v5FilterCloseKeywordSuggestions(key); } }
      return;
    }
    const chip = event.target.closest("[data-v5-filter-chip-remove]");
    if (chip && v5State.filterDraft) { const key = chip.dataset.v5FilterChipRemove; const [groupIndex, conditionIndex] = key.split("-").map(Number); const condition = v5State.filterDraft.groups[groupIndex]?.conditions?.[conditionIndex]; if (condition) { condition.value = v5FilterNormaliseValues(condition).filter((value) => value !== chip.dataset.v5FilterChipValue); v5RenderFilterBuilder(); } return; }
    if (!event.target.closest("[data-v5-filter-autocomplete]")) v5CloseAllV5AutocompleteMenus();
    const remove = event.target.closest("[data-v5-filter-remove]"); if (remove && v5State.filterDraft) { const [groupIndex, conditionIndex] = remove.dataset.v5FilterRemove.split("-").map(Number); v5State.filterDraft.groups[groupIndex]?.conditions?.splice(conditionIndex, 1); v5RenderFilterBuilder(); return; } const removeGroup = event.target.closest("[data-v5-filter-remove-group]"); if (removeGroup && v5State.filterDraft) { v5State.filterDraft.groups.splice(Number(removeGroup.dataset.v5FilterRemoveGroup), 1); v5RenderFilterBuilder(); }
  });
  document.body.addEventListener("focusin", (event) => { if (v5ShowQuickAutocompleteForInput(event.target.closest("[data-v5-quick-input]"))) return; v5ShowTaskAutocompleteForInput(event.target.closest("[data-v5-task-input]")); });
  document.body.addEventListener("input", (event) => { const input = event.target.closest("[data-v5-quick-input]"); if (input) { const [surface, ...fieldParts] = input.dataset.v5QuickInput.split("-"); const field = fieldParts.join("-"); const schema = v5FilterSchema(surface, field); if (schema?.kind === "multi") delete input.dataset.v5QuickValue; v5RenderQuickAutocomplete(surface, field, input.value); } const taskInput = event.target.closest("[data-v5-task-input]"); if (taskInput) { const key = taskInput.dataset.v5TaskInput || taskInput.closest("[data-v5-task-combobox]")?.dataset.v5TaskCombobox; if (!["samples", "members", "inline-members"].includes(key)) { const wrapper = v5TaskCombobox(key); if (wrapper) delete wrapper.dataset.v5TaskValue; } const menu = v5TaskComboboxMenu(key); if (menu) { const options = v5TaskOptionMatches(v5TaskOptions(key), taskInput.value); menu.innerHTML = options.map((option) => `<button type="button" class="v5-filter-autocomplete-option" role="option" data-v5-task-option="${key}" data-v5-task-option-value="${escapeHtml(option.value)}" data-v5-task-option-label="${escapeHtml(option.label)}">${escapeHtml(option.label)}</button>`).join("") || `<span class="v5-filter-autocomplete-empty">没有匹配候选项</span>`; menu.hidden = false; taskInput.setAttribute("aria-expanded", "true"); } } });
  document.body.addEventListener("keydown", (event) => { const input = event.target.closest("[data-v5-quick-input], [data-v5-task-input]"); const option = event.target.closest("[data-v5-quick-option], [data-v5-task-option]"); if (input) { const key = input.dataset.v5QuickInput || input.dataset.v5TaskInput || input.closest("[data-v5-task-combobox]")?.dataset.v5TaskCombobox; if (event.key === "Escape") { event.preventDefault(); v5CloseAllV5AutocompleteMenus(); return; } if (event.key === "ArrowDown") { const first = input.closest(".v5-filter-autocomplete, .v5-task-autocomplete")?.querySelector("[data-v5-quick-option], [data-v5-task-option]"); if (first) { event.preventDefault(); first.focus(); } } } else if (option) { const menu = option.closest(".v5-filter-autocomplete, .v5-task-autocomplete"); const options = [...(menu?.querySelectorAll("[data-v5-quick-option], [data-v5-task-option]") || [])]; const index = options.indexOf(option); if (event.key === "ArrowDown" && options.length) { event.preventDefault(); options[(index + 1) % options.length].focus(); } else if (event.key === "ArrowUp" && options.length) { event.preventDefault(); options[(index - 1 + options.length) % options.length].focus(); } else if (event.key === "Escape") { event.preventDefault(); v5CloseAllV5AutocompleteMenus(); menu?.querySelector("input")?.focus(); } } });
  document.body.addEventListener("click", (event) => {
    const quickInput = event.target.closest("[data-v5-quick-input]");
    if (quickInput && v5ShowQuickAutocompleteForInput(quickInput)) return;
    const taskInput = event.target.closest("[data-v5-task-input]");
    if (taskInput && v5ShowTaskAutocompleteForInput(taskInput)) return;
    const resourceInput = event.target.closest("[data-v5-resource-search]");
    if (resourceInput) { v5RenderResourceSearchOptions(resourceInput.dataset.v5ResourceSearch, resourceInput.value); return; }
    const executionMemberInput = event.target.closest("[data-v5-execution-member-search]");
    if (executionMemberInput) { v5RenderExecutionMemberSearchOptions(executionMemberInput.value); return; }
    const quickOption = event.target.closest("[data-v5-quick-option]");
    if (quickOption) { const [surface, ...fieldParts] = quickOption.dataset.v5QuickOption.split("-"); const field = fieldParts.join("-"); const input = v5QuickAutocompleteInput(`${surface}-${field}`); if (input) { input.dataset.v5QuickValue = quickOption.dataset.v5QuickOptionValue || ""; input.value = quickOption.dataset.v5QuickOptionValue ? (quickOption.dataset.v5QuickOptionLabel || "") : ""; v5UpdateQuickFilter(surface, field); } v5CloseAllV5AutocompleteMenus(); return; }
    const resourceOption = event.target.closest("[data-v5-resource-option]");
    if (resourceOption) { const kind = resourceOption.dataset.v5ResourceOption; const input = document.querySelector(`[data-v5-resource-search="${kind}"]`); if (input) { input.value = resourceOption.dataset.v5ResourceOptionValue || ""; v5State.resourceSearch[kind] = input.value; v5RenderResources(); } v5CloseAllV5AutocompleteMenus(); return; }
    const executionMemberOption = event.target.closest("[data-v5-execution-member-option-value]");
    if (executionMemberOption) { const input = $("#v5ExecutionMemberSearch"); if (input) { input.value = executionMemberOption.dataset.v5ExecutionMemberOptionValue || ""; v5State.execution.memberSearch = input.value; v5RenderExecution(); } v5CloseAllV5AutocompleteMenus(); return; }
    const taskOption = event.target.closest("[data-v5-task-option]");
    if (taskOption) { const key = taskOption.dataset.v5TaskOption; const value = taskOption.dataset.v5TaskOptionValue || ""; if (key === "members") { const id = Number(value); if (v5State.dialogMemberIds.has(id)) v5State.dialogMemberIds.delete(id); else v5State.dialogMemberIds.add(id); v5RenderMembersInForm(v5State.tasks.find((task) => Number(task.id) === Number(v5State.editingTaskId))); } else if (key === "inline-members") { const id = Number(value); if (v5State.inlineMemberIds.has(id)) v5State.inlineMemberIds.delete(id); else v5State.inlineMemberIds.add(id); v5TaskRenderMultiPicker(key, v5TaskOptions(key), v5State.inlineMemberIds, "输入姓名或角色"); v5TaskComboboxInput(key)?.focus(); } else { const wrapper = v5TaskCombobox(key); if (wrapper) { wrapper.dataset.v5TaskValue = value; const input = v5TaskComboboxInput(key); if (input) input.value = taskOption.dataset.v5TaskOptionLabel && value ? taskOption.dataset.v5TaskOptionLabel : ""; } if (key === "topic-move") v5RenderTopicMovePreview(); v5CloseAllV5AutocompleteMenus(); } return; }
    const taskChip = event.target.closest("[data-v5-task-chip-remove]");
    if (taskChip) { const key = taskChip.dataset.v5TaskChipRemove; const id = Number(taskChip.dataset.v5TaskChipValue); if (key === "members") { v5State.dialogMemberIds.delete(id); v5RenderMembersInForm(v5State.tasks.find((task) => Number(task.id) === Number(v5State.editingTaskId))); } else if (key === "inline-members") { v5State.inlineMemberIds.delete(id); v5TaskRenderMultiPicker(key, v5TaskOptions(key), v5State.inlineMemberIds, "输入姓名或角色"); } return; }
    const removeSample = event.target.closest("[data-v5-task-remove-sample]"); if (removeSample) { v5State.dialogSampleIds.delete(Number(removeSample.dataset.v5TaskRemoveSample)); v5RenderSamplesInForm(); return; }
    const removeMember = event.target.closest("[data-v5-task-remove-member]"); if (removeMember) { v5State.dialogMemberIds.delete(Number(removeMember.dataset.v5TaskRemoveMember)); v5RenderMembersInForm(v5State.tasks.find((task) => Number(task.id) === Number(v5State.editingTaskId))); return; }
    if (!event.target.closest(".v5-filter-autocomplete, .v5-task-autocomplete, .v5-resource-search-autocomplete")) v5CloseAllV5AutocompleteMenus();
  });
  $$('[data-v5-resource-search]').forEach((input) => { input.addEventListener("focus", () => v5RenderResourceSearchOptions(input.dataset.v5ResourceSearch, input.value)); input.addEventListener("input", () => { v5State.resourceSearch[input.dataset.v5ResourceSearch] = input.value; v5RenderResources(); v5RenderResourceSearchOptions(input.dataset.v5ResourceSearch, input.value); }); });
}

bindV5Events();
function bindV5ExecutionEvents() {
  if (window.__v5ExecutionBound) return; window.__v5ExecutionBound = true;
  const update = (key, value) => { v5State.execution[key] = value; v5RenderExecution(); };
  $("#v5OpenExecutionFilters")?.addEventListener("click", () => v5OpenFilterDialog("execution"));
  v5FilterQuickConfig("execution").forEach(({ field, selector, negate }) => { const node = $(selector); const schema = v5FilterSchema("execution", field); node?.addEventListener(schema?.kind === "text" ? "input" : "change", () => v5UpdateQuickFilter("execution", field)); if (negate) $(negate)?.addEventListener("change", () => v5UpdateQuickFilter("execution", field)); });
  [["#v5ExecutionScale", "scale"], ["#v5ExecutionRange", "range"]].forEach(([selector, key]) => $(selector)?.addEventListener("change", (event) => update(key, event.target.value)));
  $("#v5ExecutionGranularity")?.addEventListener("input", (event) => { const value = v5ExecutionGranularityValue(event.target.value); v5State.execution.granularity = value; event.target.setAttribute("aria-valuetext", v5ExecutionGranularityLabel(value)); const output = $("#v5ExecutionGranularityValue"); if (output) output.textContent = v5ExecutionGranularityLabel(value); v5RenderExecutionGantt(v5ExecutionFilteredTasks()); });
  $("#v5ExecutionOnlyBusy")?.addEventListener("change", (event) => update("onlyBusy", event.target.checked)); $("#v5ExecutionStack")?.addEventListener("change", (event) => update("stack", event.target.checked)); $("#v5ExecutionMemberSearch")?.addEventListener("focus", (event) => v5RenderExecutionMemberSearchOptions(event.target.value)); $("#v5ExecutionMemberSearch")?.addEventListener("input", (event) => { update("memberSearch", event.target.value); v5RenderExecutionMemberSearchOptions(event.target.value); });
  $("#v5ExecutionToday")?.addEventListener("click", () => { v5State.execution.anchorDate = todayLocalDate(); v5State.execution.range = "smart"; v5RenderExecutionFilterOptions(); v5RenderExecution(); });
  $("#v5ExecutionClear")?.addEventListener("click", () => { v5ResetFilterSurface("execution"); Object.assign(v5State.execution, { search: "", sourceId: "", topicId: "", status: "", memberId: "", sampleId: "", cryostatId: "", from: "", to: "", memberSearch: "", anchorDate: null }); });
  $("#v5ScheduleForm")?.addEventListener("submit", v5SaveSchedule);
  document.body.addEventListener("click", (event) => { const action = (selector) => event.target.closest(selector); const view = action("[data-v5-exec-view]"); if (view) { v5SetExecutionSubView(view.dataset.v5ExecView); return; } const selected = action("[data-v5-exec-select-task]"); if (selected) { v5State.execution.selectedTaskId = Number(selected.dataset.v5ExecSelectTask); v5RenderExecution(); } const taskEdit = action("[data-v5-exec-edit-task]"); if (taskEdit) { v5State.execution.selectedTaskId = Number(taskEdit.dataset.v5ExecEditTask); return v5OpenScheduleEditor(Number(taskEdit.dataset.v5ExecEditTask)); } const memberEdit = action("[data-v5-exec-edit-member]"); if (memberEdit) return v5OpenScheduleEditor(Number(memberEdit.dataset.v5ExecEditMember), "member", Number(memberEdit.dataset.v5ExecMember)); const memberFilter = action("[data-v5-exec-member-filter]"); if (memberFilter) { const memberSelect = $("#v5ExecutionMember"); const selectedId = String(memberFilter.dataset.v5ExecMemberFilter); if (memberSelect) memberSelect.value = selectedId === String(memberSelect.value) ? "" : selectedId; v5UpdateQuickFilter("execution", "memberId"); } const editor = action("[data-v5-open-editor]"); if (editor) { v5State.selectedTaskId = Number(editor.dataset.v5OpenEditor); v5SetView("editor"); v5RenderTree(); v5RenderSelectedTask(); } });
}
bindV5ExecutionEvents();
v5SetView("editor");
v5LoadAll();
