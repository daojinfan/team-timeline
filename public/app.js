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
    if (action("[data-edit-task]")) return openTaskEditor(action("[data-edit-task]").dataset.editTask);
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
  preview: null, taskDraftMembers: [], editMembers: [], returnFocus: new Map(), busy: new Set(),
  search: "", status: "", source: "", groupBy: "none", windowDays: 7, includeArchived: false,
  acceptanceStatus: "", assignmentTopicId: "", topicDetailReturnFocus: null, topicDetailReturnView: null
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
    ? v3State.tasks.map((task) => `<div><strong>${v3Esc(task.title)}</strong><span>${task.is_required === 0 ? "可选" : "必做"} · ${v3Esc(v3StatusLabel(task.display_status))}</span></div>`).join("")
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
  if (samples.some((sample) => sample.eta_pending || !sample.current_eta_date)) return "time_pending";
  const today = v3Today();
  if (samples.some((sample) => sample.current_eta_date < today && !sample.actual_arrival_date)) return "delayed";
  if (samples.some((sample) => sample.current_eta_date <= addDays(today, v3State.windowDays))) return "arriving_within_window";
  return samples.length ? "arriving_outside_window" : "time_pending";
}
function v3StatusLabel(status) { return ({ testing: "测试中", delayed: "延期", arriving_within_window: "规定时间内到来", arriving_outside_window: "规定时间外到来", time_pending: "ETA 待确认", completed: "已完成" }[status] || "待规划"); }
function v3StatusClass(status) { return `v3-status-${status || "pending"}`; }

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
      const [samples, tasks] = await Promise.all([
        v3Api(`/api/v3/topics/${topic.id}/samples`), v3Api(`/api/v3/topics/${topic.id}/tasks`)
      ]);
      v3State.topicDetails.set(topic.id, { topic, samples: samples.data?.items || [], tasks: tasks.data?.items || [] });
    } catch { v3State.topicDetails.set(topic.id, { topic, samples: [], tasks: [] }); }
  }));
  v3RebuildExecutionTaskIndex();
  renderTasks();
  renderDetail();
  v3RenderTopics();
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
  v3FillSelect("#v3AssignmentTopicFilter", v3State.topics, (item) => item.name, "请选择专题");
  v3FillSelect("#v3AcceptanceTopicFilter", v3State.topics, (item) => item.name, "全部专题");
  const source = $("#v3TopicSourceFilter"); if (source) { const value = source.value; source.innerHTML = "<option value=''>全部来源</option>" + v3State.groups.map((g) => `<option value="${v3Esc(g.id)}">${v3Esc(g.name)}</option>`).join(""); if ([...source.options].some((o) => o.value === value)) source.value = value; }
}
async function v3FillContacts(groupId) {
  const select = $("#v3TopicContact"); if (!select) return;
  if (!groupId) { select.innerHTML = "<option value=''>稍后补充</option>"; return; }
  try { const result = await v2Api(`/api/v2/source-groups/${groupId}/contacts`); const rows = result.data || []; select.innerHTML = "<option value=''>稍后补充</option>" + rows.map((row) => `<option value="${row.id}">${v3Esc(row.name)}</option>`).join(""); } catch (error) { select.innerHTML = "<option value=''>稍后补充</option>"; showToast(v3ErrorText(error), { type: "error" }); }
}
function v3RenderTopics() {
  const list = $("#v3TopicOverviewList"); if (!list) return;
  const entries = v3State.topics.map((topic) => ({ ...topic, detail: v3State.topicDetails.get(topic.id) || { topic, samples: [], tasks: [] } }));
  const filtered = entries.filter((entry) => {
    const status = v3TopicStatus(entry.detail);
    return (!v3State.status || status === v3State.status) && (!v3State.source || String(entry.source_group_id) === String(v3State.source));
  });
  const stats = { testing: 0, delayed: 0, arriving_within_window: 0, arriving_outside_window: 0, time_pending: 0, completed: 0 };
  entries.forEach((entry) => { stats[v3TopicStatus(entry.detail)] += 1; });
  $$("#v3TopicStats [data-v3-stat]").forEach((card) => { const key = card.dataset.v3Stat; const value = card.querySelector("strong"); if (value) value.textContent = stats[key] ?? 0; card.setAttribute("aria-pressed", String(v3State.status === key)); });
  const count = $("#v3TopicResultCount"); if (count) count.textContent = `${filtered.length} 个专题`;
  if (!filtered.length) { list.innerHTML = v3State.topics.length ? ($("#v3TopicFilterEmptyTemplate")?.innerHTML || "<div class='v3-empty-state'><h3>没有匹配专题</h3></div>") : ($("#v3TopicTrueEmptyTemplate")?.innerHTML || "<div class='v3-empty-state'><h3>还没有专题</h3></div>"); return; }
  list.innerHTML = filtered.map((entry) => {
    const status = v3TopicStatus(entry.detail); const group = v3Group(entry.source_group_id);
    return `<article class="v3-topic-row" data-v3-open-topic="${entry.id}" tabindex="0"><div><span class="eyebrow">${v3Esc(group?.name || "来源小组")}</span><h3>${v3Esc(entry.name)}</h3><p>${v3Esc(entry.purpose)}</p></div><div class="v3-topic-row-facts"><span class="v3-status-chip ${v3StatusClass(status)}">${v3StatusLabel(status)}</span><span>${entry.sample_count || entry.detail.samples.length} 个样品</span><span>${entry.task_count || entry.detail.tasks.length} 个任务</span></div></article>`;
  }).join("");
}
function v3RenderTopic() {
  const topic = v3State.topic; if (!topic) return;
  const group = v3Group(topic.source_group_id), samples = v3State.samples, tasks = v3State.tasks;
  $("#v3TopicName").textContent = topic.name; $("#v3TopicPurpose").textContent = topic.purpose;
  $("#v3TopicSource").textContent = group?.name || "—"; $("#v3TopicSampleSummary").textContent = `${samples.length} 个样品`;
  $("#v3TopicTaskSummary").textContent = `${tasks.length} 个连续任务`; $("#v3TopicDefaultCryostat").textContent = v3Cryostat(topic.default_cryostat_id)?.name || "不设默认";
  $("#v3TopicBreadcrumb").textContent = `${group?.name || "来源小组"} / ${topic.name}`;
  $("#v3TopicListCount").textContent = `${v3State.topics.length}`;
  $("#v3TopicList").innerHTML = v3State.topics.map((item) => `<button class="v3-topic-row compact" type="button" data-v3-open-topic="${item.id}"><span>${v3Esc(item.name)}</span><small>${v3Esc(v3Group(item.source_group_id)?.name || "")}</small></button>`).join("");
  $("#v3SampleCount").textContent = `${samples.length} 个样品`; $("#v3TaskChainCount").textContent = `${tasks.length} 个任务`;
  $("#v3SampleList").innerHTML = samples.length ? samples.map((sample) => `<article class="v3-sample-card"><div><strong>${v3Esc(sample.planning_label)}</strong><span>${v3Esc(sample.model)}</span><small>${sample.formal_identifier || sample.temporary_identifier ? `编号：${v3Esc(sample.formal_identifier || sample.temporary_identifier)}` : "编号待补"}</small></div><div><span class="v3-eta-chip">${sample.eta_pending ? "ETA 待确认" : `ETA ${v3Esc(sample.current_eta_date || "—")}`}</span>${sample.actual_arrival_date ? `<small>到样 ${v3Esc(sample.actual_arrival_date)}</small>` : ""}<button class="ghost-button compact" type="button" data-v3-open-eta="${sample.id}">修订 ETA</button></div></article>`).join("") : "<li class='v3-empty-state compact'><h3>样品池为空</h3><p>先记录规划标签和型号，后续再补编号。</p></li>";
  $("#v3TaskChainList").innerHTML = tasks.length ? tasks.map((task) => `<li class="v3-task-card"><div><strong>${v3Esc(task.title)}</strong><span class="v3-status-chip ${v3StatusClass(task.display_status)}">${v3StatusLabel(task.display_status)}</span><span class="v3-required-chip">${task.is_required === 0 ? "可选" : "必做"}</span><p>${v3Esc(task.start_date || "待排期")} ～ ${v3Esc(task.end_date || "待排期")} · ${task.samples.map((s) => v3Esc(s.planning_label)).join("、")}</p><div class="v3-task-context-line">${v3TaskContextText(task)}</div><p class="v3-task-purpose-line">${v3Esc(task.test_purpose || "测试目的待补充")}</p><small>测试项：${task.test_items?.length ? task.test_items.map((item) => v3Esc(item.name || item.label)).join("、") : "待补充"} · ${task.efforts?.map((e) => `${v3Esc(e.name)} ${Number(e.planned_half_hours || 0) / 2}h`).join(" · ") || "未完成人工分配"}</small></div><div class="v3-card-actions"><button class="ghost-button compact" type="button" data-v3-open-task-detail="${task.id}">任务详情</button><button class="ghost-button compact" type="button" data-v3-open-member="${task.id}">成员与工时</button><button class="ghost-button compact" type="button" data-v3-open-cryostat="${task.id}">制冷机</button><button class="ghost-button compact" type="button" data-v3-open-submission="${task.id}">提交成果</button></div></li>`).join("") : "<li class='v3-empty-state compact'><h3>任务链为空</h3><p>从第一个任务开始，逐步建立前后关系。</p></li>";
  v3RenderAssignment(); v3RenderAcceptance(); v3RenderTopicDetail();
}
async function v3LoadTopic(id) {
  if (!v3State.members.length) await v3LoadMembers();
  const [topic, samples, tasks, template] = await Promise.all([v3Api(`/api/v3/topics/${id}`), v3Api(`/api/v3/topics/${id}/samples`), v3Api(`/api/v3/topics/${id}/tasks`), v3Api(`/api/v3/topics/${id}/acceptance-template`)]);
  v3State.topic = topic.data; v3State.samples = samples.data?.items || []; v3State.tasks = tasks.data?.items || []; v3State.template = template.data || null;
  v3State.topicDetails.set(v3State.topic.id, { topic: v3State.topic, samples: v3State.samples, tasks: v3State.tasks });
  v3RebuildExecutionTaskIndex();
  renderTasks();
  renderDetail();
  await v3LoadSubmissions(); v3RenderTopic();
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
  if (view === "plans" && v3State.topic) v3RenderTopic();
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

function v3OpenTopicDialog(trigger) {
  $("#v3TopicForm").reset(); v3FormError("#v3TopicFormError"); v3FillResourceSelects(); const source = $("#v3TopicSourceGroup"); if (v3State.source) source.value = v3State.source; v3Open($("#v3TopicDialog"), trigger);
}
async function v3SaveTopic(event) {
  event.preventDefault(); if (v3State.busy.has("topic")) return; const form = event.currentTarget; if (!form.reportValidity()) return; const body = { source_group_id: Number($("#v3TopicSourceGroup").value), source_contact_id: $("#v3TopicContact").value ? Number($("#v3TopicContact").value) : null, name: $("#v3TopicNameInput").value.trim(), purpose: $("#v3TopicPurposeInput").value.trim(), default_cryostat_id: $("#v3TopicDefaultCryostatInput").value ? Number($("#v3TopicDefaultCryostatInput").value) : null, actor: "本地用户" };
  v3SetBusy("topic", true); try { await v3Api("/api/v3/topics", v3Json("POST", body)); v3Close($("#v3TopicDialog")); await v3LoadTopics(); showToast("专题已创建"); } catch (error) { v3FormError("#v3TopicFormError", error); } finally { v3SetBusy("topic", false); }
}
function v3OpenSampleDialog(trigger) { if (!v3State.topic) return showToast("请先选择专题", { type: "error" }); $("#v3SampleForm").reset(); $("#v3SampleEtaPending").checked = false; v3FormError("#v3SampleFormError"); v3Open($("#v3SampleDialog"), trigger); }
async function v3SaveSample(event) {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity() || !v3State.topic) return; const pending = $("#v3SampleEtaPending").checked; const eta = pending ? null : $("#v3SampleCurrentEta").value || $("#v3SampleInitialEta").value; if (!pending && !eta) { v3FormError("#v3SampleFormError", new Error("请填写当前 ETA，或勾选 ETA 待确认")); return; }
  const kind = $("#v3SampleIdentifierKind").value, identifier = $("#v3SampleIdentifier").value.trim(); const body = { planning_label: $("#v3SampleLabel").value.trim(), model: $("#v3SampleModel").value.trim(), eta_date: eta, eta_pending: pending ? 1 : 0, formal_identifier: kind === "formal" ? (identifier || null) : null, temporary_identifier: kind === "temporary" ? (identifier || null) : null, notes: "", actor: "本地用户" };
  v3SetBusy("sample", true); try { const result = await v3Api(`/api/v3/topics/${v3State.topic.id}/samples`, v3Json("POST", body)); const arrival = $("#v3SampleArrivalDate").value; if (arrival) await v3Api(`/api/v3/samples/${result.data.id}/arrival`, v3Json("POST", { actual_arrival_date: arrival, actor: "本地用户" })); v3Close($("#v3SampleDialog")); await v3LoadTopic(v3State.topic.id); await v3LoadTopics(); showToast("样品已加入规划池"); } catch (error) { v3FormError("#v3SampleFormError", error); } finally { v3SetBusy("sample", false); }
}
function v3RenderTaskMemberDraft() {
  const box = $("#v3TaskPreview"); if (!box) return; const selected = new Map(v3State.taskDraftMembers.map((m) => [Number(m.member_id), m])); box.innerHTML = `<h3 id="v3TaskPreviewTitle">人工分配与创建预览</h3><div class="v3-member-choice-grid">${v3State.members.map((member) => `<label><input type="checkbox" data-v3-task-member value="${member.id}"${selected.has(member.id) ? " checked" : ""}> ${v3Esc(member.name)}<input class="v3-hours-input" data-v3-task-hours="${member.id}" type="number" min="0" step="0.5" value="${Number(selected.get(member.id)?.planned_half_hours || 0) / 2}" aria-label="${v3Esc(member.name)}预计工时（小时）"></label>`).join("")}</div><p>至少选择一名成员；每人的预计工时按 0.5 小时递增，系统不会替你分配。</p>`;
}
function v3ReadTaskMembers() { v3State.taskDraftMembers = $$('[data-v3-task-member]:checked').map((node) => ({ member_id: Number(node.value), planned_half_hours: Math.round(Number($(`[data-v3-task-hours="${node.value}"]`)?.value || 0) * 2) })); return v3State.taskDraftMembers; }
function v3TaskItemsToText(items = []) { return (items || []).map((item) => `${item.name || item.label || ""}${item.acceptance_criteria ? ` | ${item.acceptance_criteria}` : ""}`).join("\n"); }
function v3TaskItemsFromText(value) { return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const [name, ...criteria] = line.split("|"); return { name: name.trim(), acceptance_criteria: criteria.join("|").trim(), is_required: 1 }; }); }
function v3TaskContextText(task = null) { const topic = task?.topic || v3State.topic; const group = task?.source_group || v3Group(topic?.source_group_id); const cryostat = task?.cryostat?.name || (task?.cryostat_pending ? "待定" : v3Cryostat(task?.cryostat_id)?.name) || "未指定"; return `<span>专题：${v3Esc(topic?.name || "—")}</span><span>来源小组：${v3Esc(group?.name || "—")}</span><span>制冷机：${v3Esc(cryostat)}</span>`; }
function v3TaskUpdateBody(task, overrides = {}) { const members = overrides.member_efforts || task.efforts?.map((e) => ({ member_id: e.member_id, planned_half_hours: e.planned_half_hours })) || []; const primary = overrides.primary_member_id || task.primary_member_id || members[0]?.member_id; return { title: overrides.title ?? task.title, description: overrides.description ?? task.description ?? "", test_purpose: overrides.test_purpose ?? task.test_purpose ?? "", test_items: overrides.test_items ?? task.test_items ?? [], predecessor_task_id: overrides.predecessor_task_id ?? task.predecessor_task_id ?? null, sample_ids: overrides.sample_ids ?? task.samples.map((s) => s.id), position: overrides.position ?? task.position, is_required: overrides.is_required ?? (task.is_required !== 0 ? 1 : 0), primary_member_id: primary, participant_member_ids: members.filter((m) => m.member_id !== primary).map((m) => m.member_id), member_efforts: members, cryostat_id: overrides.cryostat_id ?? task.cryostat_id ?? null, cryostat_pending: overrides.cryostat_pending ?? task.cryostat_pending ?? 0, start_date: overrides.start_date ?? task.start_date, end_date: overrides.end_date ?? task.end_date, after_arrival: overrides.after_arrival ?? task.after_arrival ?? 0, expected_version: task.version }; }
function v3TaskBody() { const selected = v3ReadTaskMembers(); const samples = $$('[data-v3-task-sample]:checked').map((node) => Number(node.value)); return { title: $("#v3TaskTitle").value.trim(), description: $("#v3TaskDescription").value.trim(), test_purpose: $("#v3TaskPurpose").value.trim(), test_items: v3TaskItemsFromText($("#v3TaskItems").value), predecessor_task_id: $("#v3TaskPredecessor").value ? Number($("#v3TaskPredecessor").value) : null, sample_ids: samples, position: v3State.tasks.length, is_required: $("#v3TaskRequired").checked ? 1 : 0, primary_member_id: selected[0]?.member_id, participant_member_ids: selected.slice(1).map((item) => item.member_id), member_efforts: selected, cryostat_id: $("#v3TaskCryostat").value ? Number($("#v3TaskCryostat").value) : null, cryostat_pending: $("#v3TaskCryostatPending").checked ? 1 : 0, start_date: $("#v3TaskStartDate").value, end_date: $("#v3TaskEndDate").value, after_arrival: 0 } }
function v3OpenTaskDialog(trigger) { if (!v3State.topic) return showToast("请先选择专题", { type: "error" }); $("#v3TaskForm").reset(); $("#v3TaskRequired").checked = true; $("#v3TaskContextSummary").innerHTML = v3TaskContextText(); $("#v3TaskPurpose").value = v3State.topic.purpose || ""; $("#v3TaskItems").value = ""; v3FormError("#v3TaskFormError"); v3State.preview = null; v3State.taskDraftMembers = []; $("#v3TaskSamples").innerHTML = v3State.samples.map((s) => `<label><input type="checkbox" data-v3-task-sample value="${s.id}"> ${v3Esc(s.planning_label)} · ${v3Esc(s.model)}</label>`).join("") || "<p>暂无样品，请先建立样品池。</p>"; $("#v3TaskPredecessor").innerHTML = `<option value="">链头（无前置）</option>` + v3State.tasks.map((t) => `<option value="${t.id}">${v3Esc(t.title)}</option>`).join(""); v3FillResourceSelects(); $("#v3TaskStartDate").value = v3Today(); $("#v3TaskEndDate").value = addDays(v3Today(), 1); v3RenderTaskMemberDraft(); v3Open($("#v3TaskDialog"), trigger); }
async function v3PreviewTask() { try { const body = v3TaskBody(); if (!body.primary_member_id) throw new Error("请先人工选择至少一名成员"); if (!body.sample_ids.length) throw new Error("请至少选择一个样品"); const result = await v3Api(`/api/v3/topics/${v3State.topic.id}/tasks/preview`, v3Json("POST", body)); v3State.preview = result.data; $("#v3TaskPreview").insertAdjacentHTML("beforeend", `<div class="v3-preview-result">${result.data.conflicts.length ? `<strong>需要人工确认的冲突：</strong><ul>${result.data.conflicts.map((c) => `<li>${v3Esc(c.type)} ${v3Esc(c.date || "")}</li>`).join("")}</ul><label><input id="v3TaskAck" type="checkbox"> 我确认继续</label>` : "<strong>预览通过，可确认创建。</strong>"}</div>`); } catch (error) { v3FormError("#v3TaskFormError", error); } }
async function v3SaveTask(event) { event.preventDefault(); try { if (!v3State.preview) { await v3PreviewTask(); return; } if (v3State.preview.conflicts.length && !$("#v3TaskAck")?.checked) throw new Error("请先确认预览中的冲突"); const body = { ...v3TaskBody(), preview_token: v3State.preview.preview_token, ack: true, actor: "本地用户" }; await v3Api(`/api/v3/topics/${v3State.topic.id}/tasks`, v3Json("POST", body)); v3Close($("#v3TaskDialog")); await v3LoadTopic(v3State.topic.id); await v3LoadTopics(); showToast("连续任务已创建"); } catch (error) { v3FormError("#v3TaskFormError", error); } }
function v3OpenTaskDetail(taskId, trigger) { const task = v3State.tasks.find((item) => Number(item.id) === Number(taskId)); if (!task) return; v3State.activeTaskId = task.id; v3State.preview = null; $("#v3TaskDetailContext").innerHTML = v3TaskContextText(task); $("#v3TaskDetailPurpose").value = task.test_purpose || ""; $("#v3TaskDetailItems").value = v3TaskItemsToText(task.test_items); $("#v3TaskDetailDescription").value = task.description || ""; $("#v3TaskDetailFacts").innerHTML = `<div>样品<strong>${task.samples?.length || 0} 个</strong></div><div>计划日期<strong>${v3Esc(task.start_date || "待排期")} ～ ${v3Esc(task.end_date || "待排期")}</strong></div><div>任务状态<strong>${v3Esc(v3StatusLabel(task.display_status))}</strong></div>`; v3FormError("#v3TaskDetailFormError"); v3Open($("#v3TaskDetailDialog"), trigger); }
async function v3SaveTaskDetail(event) { event.preventDefault(); const task = v3State.tasks.find((item) => Number(item.id) === Number(v3State.activeTaskId)); if (!task) return; try { const body = v3TaskUpdateBody(task, { description: $("#v3TaskDetailDescription").value.trim(), test_purpose: $("#v3TaskDetailPurpose").value.trim(), test_items: v3TaskItemsFromText($("#v3TaskDetailItems").value) }); const acknowledged = Boolean($("#v3TaskDetailAck")?.checked); const preview = (await v3Api(`/api/v3/topic-tasks/${task.id}/preview`, v3Json("POST", body))).data; $("#v3TaskDetailPreview")?.remove(); if (preview.conflicts.length && !acknowledged) { $("#v3TaskDetailFacts").insertAdjacentHTML("afterend", `<section id="v3TaskDetailPreview" class="v3-preview"><strong>保存前需要人工确认：</strong><p>${preview.conflicts.map((item) => v3Esc(item.type)).join("、")}</p><label><input id="v3TaskDetailAck" type="checkbox"> 我确认继续</label></section>`); return; } await v3Api(`/api/v3/topic-tasks/${task.id}`, v3Json("PUT", { ...body, preview_token: preview.preview_token, ack: true, actor: "本地用户" })); v3Close($("#v3TaskDetailDialog")); await v3LoadTopic(v3State.topic.id); await v3LoadTopics(); showToast("任务定义已更新"); } catch (error) { v3FormError("#v3TaskDetailFormError", error); } }
function v3OpenMemberDialog(taskId, trigger) { const task = v3State.tasks.find((item) => Number(item.id) === Number(taskId)); if (!task) return; v3State.activeTaskId = task.id; v3State.editMembers = task.efforts?.map((e) => ({ member_id: e.member_id, planned_half_hours: e.planned_half_hours })) || []; const choices = $("#v3MemberChoices"); choices.innerHTML = v3State.members.map((m) => `<label><input type="checkbox" data-v3-edit-member value="${m.id}"${v3State.editMembers.some((e) => e.member_id === m.id) ? " checked" : ""}> ${v3Esc(m.name)}</label>`).join(""); $("#v3MemberHoursInputs").innerHTML = v3State.members.map((m) => `<label>${v3Esc(m.name)}<input type="number" min="0" step="0.5" data-v3-edit-hours="${m.id}" value="${(Number(v3State.editMembers.find((e) => e.member_id === m.id)?.planned_half_hours || 0) / 2)}"></label>`).join(""); $("#v3CoordinatorMember").innerHTML = `<option value="">未指定（保存时使用首个已选成员）</option>` + v3State.members.map((m) => `<option value="${m.id}"${m.id === task.primary_member_id ? " selected" : ""}>${v3Esc(m.name)}</option>`).join(""); v3FormError("#v3MemberFormError"); v3State.preview = null; v3Open($("#v3MemberDialog"), trigger); }
function v3ReadEditMembers() { return $$('[data-v3-edit-member]:checked').map((node) => ({ member_id: Number(node.value), planned_half_hours: Math.round(Number($(`[data-v3-edit-hours="${node.value}"]`)?.value || 0) * 2) })); }
async function v3SaveMembers(event) { event.preventDefault(); const task = v3State.tasks.find((item) => item.id === v3State.activeTaskId); if (!task) return; try { const members = v3ReadEditMembers(); if (!members.length) throw new Error("至少保留一名人工负责人"); const primary = Number($("#v3CoordinatorMember").value) || members[0].member_id; const body = { title: task.title, description: task.description, test_purpose: task.test_purpose || "", test_items: task.test_items || [], predecessor_task_id: task.predecessor_task_id || null, sample_ids: task.samples.map((s) => s.id), position: task.position, is_required: task.is_required !== 0 ? 1 : 0, primary_member_id: primary, participant_member_ids: members.filter((m) => m.member_id !== primary).map((m) => m.member_id), member_efforts: members, cryostat_id: task.cryostat_id, cryostat_pending: task.cryostat_pending, start_date: task.start_date, end_date: task.end_date, after_arrival: task.after_arrival, expected_version: task.version }; const preview = (await v3Api(`/api/v3/topic-tasks/${task.id}/preview`, v3Json("POST", body))).data; v3State.preview = preview; $("#v3MemberPreview").innerHTML = `<h3 id="v3MemberPreviewTitle">成员与负载预览</h3><p>${preview.conflicts.length ? preview.conflicts.map((c) => v3Esc(c.type)).join("、") : "预览通过"}</p>${preview.conflicts.length ? '<label><input id="v3MemberAck" type="checkbox"> 我确认继续</label>' : ""}`; if (preview.conflicts.length && !$("#v3MemberAck")?.checked) throw new Error("请先勾选确认冲突"); await v3Api(`/api/v3/topic-tasks/${task.id}`, v3Json("PUT", { ...body, preview_token: preview.preview_token, ack: true, actor: "本地用户" })); v3Close($("#v3MemberDialog")); await v3LoadTopic(v3State.topic.id); showToast("成员与工时已更新"); } catch (error) { v3FormError("#v3MemberFormError", error); } }
function v3OpenEta(sampleId, trigger) { const sample = v3State.samples.find((s) => s.id === Number(sampleId)); if (!sample) return; v3State.activeSampleId = sample.id; v3State.preview = null; $("#v3EtaDate").value = sample.current_eta_date || ""; $("#v3EtaPending").checked = Boolean(sample.eta_pending); $("#v3EtaCandidateTasks").innerHTML = "<p>填写新 ETA 后点击重新预览。</p>"; $("#v3EtaProtectedTasks").innerHTML = ""; v3FormError("#v3EtaFormError"); v3Open($("#v3EtaDialog"), trigger); }
async function v3PreviewEta() { try { const body = { new_eta_date: $("#v3EtaPending").checked ? null : $("#v3EtaDate").value || null, eta_pending: $("#v3EtaPending").checked ? 1 : 0, selected_task_ids: [] }; const result = (await v3Api(`/api/v3/samples/${v3State.activeSampleId}/eta/preview`, v3Json("POST", body))).data; v3State.preview = result; $("#v3EtaCandidateTasks").innerHTML = (result.eligible_tasks || []).map((task) => `<label><input type="checkbox" data-v3-eta-task value="${task.task_id}"> ${v3Esc(task.title || `任务 ${task.task_id}`)} ${v3Esc(task.old_start_date)}～${v3Esc(task.old_end_date)}</label>`).join("") || "<p>没有符合条件的未开始到样后任务。</p>"; $("#v3EtaProtectedTasks").innerHTML = (result.protected_tasks || []).map((task) => `<div>${v3Esc(task.title)} · ${v3Esc(task.reason)}</div>`).join("") || "<p>无受保护任务。</p>"; $("#v3EtaImpactPreview").innerHTML = `<h3 id="v3EtaImpactTitle">影响预览</h3><p>将更新样品 ETA；默认不平移任务，已选择 ${(result.selected_task_ids || []).length} 项。</p>`; } catch (error) { v3FormError("#v3EtaFormError", error); } }
async function v3SaveEta(event) { event.preventDefault(); try { if (!v3State.preview) await v3PreviewEta(); const selected = $$('[data-v3-eta-task]:checked').map((node) => Number(node.value)); const body = { new_eta_date: $("#v3EtaPending").checked ? null : $("#v3EtaDate").value || null, eta_pending: $("#v3EtaPending").checked ? 1 : 0, selected_task_ids: selected, preview_token: v3State.preview.preview_token, actor: "本地用户" }; await v3Api(`/api/v3/samples/${v3State.activeSampleId}/eta/confirm`, v3Json("POST", body)); v3Close($("#v3EtaDialog")); await v3LoadTopic(v3State.topic.id); await v3LoadTopics(); showToast("样品 ETA 已更新"); } catch (error) { v3FormError("#v3EtaFormError", error); } }
function v3OpenCryostat(taskId, trigger) { const task = v3State.tasks.find((t) => t.id === Number(taskId)); if (!task) return; v3State.activeTaskId = task.id; $("#v3CryostatSelect").value = task.cryostat_id || ""; $("#v3CryostatPending").checked = Boolean(task.cryostat_pending); v3State.preview = null; v3FormError("#v3CryostatFormError"); v3Open($("#v3CryostatDialog"), trigger); }
async function v3PreviewCryostat() { try { const body = { new_cryostat_id: $("#v3CryostatPending").checked ? null : Number($("#v3CryostatSelect").value) || null, cryostat_pending: $("#v3CryostatPending").checked ? 1 : 0, task_ids: [v3State.activeTaskId] }; const result = (await v3Api(`/api/v3/topics/${v3State.topic.id}/cryostat/preview`, v3Json("POST", body))).data; v3State.preview = result; $("#v3CryostatPreview").innerHTML = `<h3 id="v3CryostatPreviewTitle">冲突预览</h3><p>${result.conflicts?.length ? result.conflicts.map((c) => v3Esc(c.type)).join("、") : "未发现冲突，可人工确认保存。"}</p>`; } catch (error) { v3FormError("#v3CryostatFormError", error); } }
async function v3SaveCryostat(event) { event.preventDefault(); try { if (!v3State.preview) await v3PreviewCryostat(); const body = { new_cryostat_id: $("#v3CryostatPending").checked ? null : Number($("#v3CryostatSelect").value) || null, cryostat_pending: $("#v3CryostatPending").checked ? 1 : 0, task_ids: [v3State.activeTaskId], preview_token: v3State.preview.preview_token, actor: "本地用户" }; await v3Api(`/api/v3/topics/${v3State.topic.id}/cryostat/confirm`, v3Json("POST", body)); v3Close($("#v3CryostatDialog")); await v3LoadTopic(v3State.topic.id); showToast("任务制冷机已更新"); } catch (error) { v3FormError("#v3CryostatFormError", error); } }
function v3OpenSubmission(taskId, trigger) { const task = v3State.tasks.find((t) => t.id === Number(taskId)); if (!task) return; v3State.activeTaskId = task.id; $("#v3SubmissionSampleItems").innerHTML = task.samples.map((s) => `<span>${v3Esc(s.planning_label)} · ${v3Esc(s.model)}</span>`).join(""); const items = v3State.template?.items || []; $("#v3SubmissionChecklistInput").innerHTML = items.map((item) => `<label><input type="checkbox" data-v3-submit-check value="${item.id}" checked> ${v3Esc(item.label)}</label>`).join("") || "<p>暂无验收模板条目，请先在资源维护中建立模板。</p>"; $("#v3SubmissionDescription").value = ""; $("#v3SubmissionResourceValue").value = ""; v3FormError("#v3SubmissionFormError"); v3Open($("#v3SubmissionDialog"), trigger); }
async function v3SaveSubmission(event) { event.preventDefault(); try { const task = v3State.tasks.find((t) => t.id === v3State.activeTaskId); if (!task) return; const resource = $("#v3SubmissionResourceValue").value.trim(); const kind = $("#v3SubmissionResourceKind").value; const resourceUrl = kind === "local_path" && !/^file:/i.test(resource) ? `file://${resource.replace(/^[/\\]+/, "")}` : resource; const body = { sample_ids: task.samples.map((s) => s.id), description: $("#v3SubmissionDescription").value.trim(), resource_url: resourceUrl, submitted_by: $("#v3SubmissionSubmitter").value.trim() || "本地用户", template_item_ids: $$('[data-v3-submit-check]').map((node) => ({ id: Number(node.value), checked: node.checked })) }; await v3Api(`/api/v3/tasks/${task.id}/submissions`, v3Json("POST", body)); v3Close($("#v3SubmissionDialog")); await v3LoadTopic(v3State.topic.id); setV2View("acceptance"); v3SetView("acceptance"); showToast("成果已提交，等待人工验收"); } catch (error) { v3FormError("#v3SubmissionFormError", error); } }
function v3OpenReview(submissionId, trigger) { const submission = v3State.submissions.find((row) => row.id === Number(submissionId)); if (!submission) return; v3State.activeSubmissionId = submission.id; let checklist = []; try { checklist = JSON.parse(submission.checklist_snapshot_json || "[]"); } catch {} $("#v3ReviewChecklist").innerHTML = checklist.map((item) => `<label><input type="checkbox" data-v3-review-check value="${item.id}"${item.checked ? " checked" : ""}> ${v3Esc(item.label)}</label>`).join(""); $("#v3ReviewSampleSnapshot").innerHTML = `<p>任务样品集合已按提交快照冻结。</p>`; $("#v3ReviewDecision").value = ""; $("#v3ReviewComment").value = ""; v3FormError("#v3ReviewFormError"); v3Open($("#v3ReviewDialog"), trigger); }
async function v3SaveReview(event) { event.preventDefault(); try { const decision = $("#v3ReviewDecision").value; if (!decision) throw new Error("请选择验收结论"); const body = { decision, reviewer: $("#v3ReviewerLabel").value.trim() || "本地用户", reason: $("#v3ReviewComment").value.trim(), checked_items: $$('[data-v3-review-check]').map((node) => ({ id: Number(node.value), passed: node.checked })) }; await v3Api(`/api/v3/submissions/${v3State.activeSubmissionId}/review`, v3Json("POST", body)); v3Close($("#v3ReviewDialog")); await v3LoadTopic(v3State.topic.id); showToast(decision === "accepted" ? "成果已通过" : "成果已退回"); } catch (error) { v3FormError("#v3ReviewFormError", error); } }
async function v3OpenLegacy(trigger) { const plans = (await v2Api("/api/v2/plans?limit=200")).data || []; $("#v3LegacyPlanSelect").innerHTML = `<option value="">请选择计划</option>` + plans.map((p) => `<option value="${p.id}">${v3Esc(p.name)}</option>`).join(""); v3FormError("#v3LegacyFormError"); v3Open($("#v3LegacyDialog"), trigger); }
async function v3PreviewLegacy() { try { const planId = Number($("#v3LegacyPlanSelect").value); if (!v3State.topic || !planId) throw new Error("请选择专题和旧计划"); v3State.preview = (await v3Api(`/api/v3/topics/${v3State.topic.id}/legacy-plans/preview`, v3Json("POST", { v2_plan_ids: [planId] }))).data; $("#v3LegacyPreview").innerHTML = `<h3 id="v3LegacyPreviewTitle">复制预览</h3><pre>${v3Esc(JSON.stringify(v3State.preview.snapshot, null, 2))}</pre>`; } catch (error) { v3FormError("#v3LegacyFormError", error); } }
async function v3SaveLegacy(event) { event.preventDefault(); try { if (!$("#v3LegacyAcknowledge").checked) throw new Error("请确认旧计划与专题独立维护"); if (!v3State.preview) await v3PreviewLegacy(); const planId = Number($("#v3LegacyPlanSelect").value); await v3Api(`/api/v3/topics/${v3State.topic.id}/legacy-plans/confirm`, v3Json("POST", { v2_plan_ids: [planId], preview_token: v3State.preview.preview_token, actor: "本地用户" })); v3Close($("#v3LegacyDialog")); showToast("旧计划已复制为历史引用"); } catch (error) { v3FormError("#v3LegacyFormError", error); } }
async function v3PreviewMigration() { try { const [status, backup] = await Promise.all([v3Api("/api/v3/status"), v3Api("/api/v3/backup")]); $("#v3MigrationChecks").innerHTML = `<li>数据版本 ${status.data.schema_version} · ${v3Esc(status.data.checksum)}</li><li>专题表 ${status.data.tables}、索引 ${status.data.indexes}、端点 ${status.data.endpoints}</li><li>备份接口可用：${v3Esc(backup.data.created_at)}</li>`; } catch (error) { v3FormError("#v3MigrationFormError", error); } }

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
  $("#v3TopicGroupBy")?.addEventListener("change", (event) => { v3State.groupBy = event.target.value; }); $$("#v3TopicStats [data-v3-stat]").forEach((card) => card.addEventListener("click", () => { v3State.status = v3State.status === card.dataset.v3Stat ? "" : card.dataset.v3Stat; $("#v3TopicStatusFilter").value = v3State.status; v3RenderTopics(); }));
  $$('[data-v3-topic-view]').forEach((tab) => tab.addEventListener("click", () => { $$('[data-v3-topic-view]').forEach((item) => { item.classList.toggle("active", item === tab); item.setAttribute("aria-selected", String(item === tab)); }); $$('[data-v3-topic-panel]').forEach((panel) => { panel.hidden = panel.dataset.v3TopicPanel !== tab.dataset.v3TopicView; panel.classList.toggle("active", !panel.hidden); }); }));
  $("#v3TopicForm")?.addEventListener("submit", v3SaveTopic); $("#v3SampleForm")?.addEventListener("submit", v3SaveSample); $("#v3TaskForm")?.addEventListener("submit", v3SaveTask); $("#v3TaskDetailForm")?.addEventListener("submit", v3SaveTaskDetail); $("#v3MemberForm")?.addEventListener("submit", v3SaveMembers); $("#v3EtaForm")?.addEventListener("submit", v3SaveEta); $("#v3CryostatForm")?.addEventListener("submit", v3SaveCryostat); $("#v3SubmissionForm")?.addEventListener("submit", v3SaveSubmission); $("#v3ReviewForm")?.addEventListener("submit", v3SaveReview); $("#v3LegacyForm")?.addEventListener("submit", v3SaveLegacy);
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
    if (action("[data-v3-open-topic]")) { const trigger = action("[data-v3-open-topic]"), returnView = v3State.activeView; const id = Number(trigger.dataset.v3OpenTopic); await v3LoadTopic(id); if (returnView !== "plans") setV2View("plans"); v3SetView("plans"); v3OpenTopicDetail(trigger, returnView); return; }
    if (action("[data-v3-clear-topic-filters]")) { v3State.status = ""; v3State.source = ""; $("#v3TopicStatusFilter").value = ""; $("#v3TopicSourceFilter").value = ""; v3RenderTopics(); return; }
    if (action("[data-v3-open-topic-dialog]")) return v3OpenTopicDialog(action("[data-v3-open-topic-dialog]"));
    if (action("[data-v3-open-sample-dialog]")) return v3OpenSampleDialog(action("[data-v3-open-sample-dialog]"));
    if (action("[data-v3-open-task-dialog]")) return v3OpenTaskDialog(action("[data-v3-open-task-dialog]")); if (action("[data-v3-open-task-detail]")) return v3OpenTaskDetail(action("[data-v3-open-task-detail]").dataset.v3OpenTaskDetail, action("[data-v3-open-task-detail]"));
    if (action("[data-v3-open-member]")) { setV2View("assignment"); v3SetView("assignment"); return v3OpenMemberDialog(action("[data-v3-open-member]").dataset.v3OpenMember, action("[data-v3-open-member]")); }
    if (action("[data-v3-open-eta]")) return v3OpenEta(action("[data-v3-open-eta]").dataset.v3OpenEta, action("[data-v3-open-eta]"));
    if (action("[data-v3-open-cryostat]")) return v3OpenCryostat(action("[data-v3-open-cryostat]").dataset.v3OpenCryostat, action("[data-v3-open-cryostat]"));
    if (action("[data-v3-open-submission]")) return v3OpenSubmission(action("[data-v3-open-submission]").dataset.v3OpenSubmission, action("[data-v3-open-submission]"));
    if (action("[data-v3-open-review]")) return v3OpenReview(action("[data-v3-open-review]").dataset.v3OpenReview, action("[data-v3-open-review]"));
    if (action("[data-v3-open-legacy-dialog]")) return v3OpenLegacy(action("[data-v3-open-legacy-dialog]"));
    if (action("[data-v3-open-migration-preview]")) { v3Open($("#v3MigrationDialog"), action("[data-v3-open-migration-preview]")); return v3PreviewMigration(); }
  } catch (error) { showToast(v3ErrorText(error), { type: "error" }); } });
}

bindV3Events();
v3ShowMode("topic");
