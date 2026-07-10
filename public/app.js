const state = {
  members: [],
  tasks: [],
  assignments: [],
  logs: [],
  templates: [],
  archiveTasks: [],
  trash: { tasks: [], members: [] },
  maintenancePreview: { archived_tasks: 0, deleted_tasks: 0, deleted_members: 0, logs: 0 },
  stats: null,
  today: "",
  search: "",
  taskSort: "time_asc",
  taskViewMode: "cards",
  scale: "day",
  zoom: 60,
  rangeMode: "30",
  onlyBusyMembers: false,
  stackTasks: true,
  stackMemberList: true,
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
  drag: null
};

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

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload.error || "请求失败");
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
  state.selectedTaskIds = new Set([...state.selectedTaskIds].filter((id) => state.tasks.some((task) => task.id === id)));
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
  $("#stats").innerHTML = cards.map(([label, value, hint]) => `
    <article class="stat-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `).join("");
  $("#summary").textContent = `${stats.total_members ?? 0} 名成员，${stats.total_tasks ?? 0} 个任务，${stats.overdue_assignments ?? 0} 条逾期提醒`;
}

function renderFilters() {
  $("#filterMember").innerHTML = `<option value="">全部成员</option>${state.members.map((member) => `<option value="${member.id}" ${state.filters.member_id === String(member.id) ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}`;
  $("#filterStatus").innerHTML = `<option value="">全部状态</option>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${state.filters.status === value ? "selected" : ""}>${label}</option>`).join("")}`;
  $("#filterStart").value = state.filters.start_date;
  $("#filterEnd").value = state.filters.end_date;
  $("#taskSort").value = state.taskSort;
  $("#filterOverdue").checked = state.filters.overdue;
  $("#filterOverlap").checked = state.filters.overlap;
}

function renderMembers() {
  $("#memberList").classList.toggle("stacked", state.stackMemberList);
  $("#memberList").innerHTML = state.members.map((member) => `
    <div class="member-item">
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <span>${escapeHtml(member.role || "未设置角色")} · ${member.status === "inactive" ? "停用" : "活跃"}</span>
      </div>
      <button type="button" data-edit-member="${member.id}">编辑</button>
    </div>
  `).join("") || `<div class="empty small">还没有成员，先点“新增”添加第一个成员。</div>`;

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
      <span class="swatch" style="background:${template.color}"></span>
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
          style="left:${barLeft}px; top:${14 + item.lane * 31}px; width:${barWidth}px; background:${item.color}"
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

  $("#gantt").innerHTML = header + (rows || `<div class="empty">当前筛选下没有成员任务。可以清空筛选或关闭“只看有任务成员”。</div>`);
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
            <span class="swatch" style="background:${task.color}"></span>
            <div>
              <strong>${escapeHtml(task.title)}</strong>
              <small>${escapeHtml(task.description || "无描述")} · 清单 ${checklistSummary(task)}</small>
            </div>
          </div>
          <div>${task.default_start_date}<br><span>${task.default_end_date}</span></div>
          <div>${task.assignments.map((assignment) => escapeHtml(assignment.member_name)).join("、") || "未分配"}</div>
          <div><span class="status ${task.status}">${statusLabels[task.status] || task.status}</span></div>
          <div class="task-list-actions">
            <button type="button" data-select-task="${task.id}">详情</button>
            <button type="button" data-edit-task="${task.id}">编辑</button>
            ${taskPrimaryAction(task)}
            <button class="danger" type="button" data-delete-task="${task.id}">删除</button>
          </div>
        </article>
      `).join("") || `<div class="empty">没有匹配的任务。可以清空筛选，或在左侧新增任务。</div>`}
    `;
    return;
  }

  container.innerHTML = tasks.map((task) => `
    <article class="task-card ${state.selectedTaskIds.has(task.id) ? "selected" : ""}">
      <div class="task-title-line">
        <label class="select-task"><input type="checkbox" data-task-check="${task.id}" ${state.selectedTaskIds.has(task.id) ? "checked" : ""}></label>
        <h3><span class="swatch" style="background:${task.color}"></span>${escapeHtml(task.title)}</h3>
      </div>
      <p class="meta">${escapeHtml(task.description || "无描述")}</p>
      <p class="meta">${task.default_start_date} 至 ${task.default_end_date} <span class="status ${task.status}">${statusLabels[task.status] || task.status}</span></p>
      <p class="meta">检查清单：${checklistSummary(task)}</p>
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
        <button type="button" data-edit-task="${task.id}">编辑</button>
        ${taskPrimaryAction(task)}
        <button class="danger" type="button" data-delete-task="${task.id}">删除</button>
      </div>
    </article>
  `).join("") || `<div class="empty">没有匹配的任务。可以清空筛选，或在左侧新增任务。</div>`;
}

function renderLoad() {
  const rows = state.stats?.member_load || [];
  $("#loadTable").innerHTML = `
    <table>
      <thead><tr><th>成员</th><th>当前</th><th>7 天</th><th>30 天</th><th>逾期</th><th>结束</th><th>重叠</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr class="${row.overlap_count > 0 || row.overdue_count > 0 ? "warn-row" : ""}">
            <td><strong>${escapeHtml(row.member_name)}</strong><br><span>${escapeHtml(row.role || "")}</span></td>
            <td>${row.current_count}</td>
            <td>${row.next7_count}</td>
            <td>${row.next30_count}</td>
            <td>${row.overdue_count}</td>
            <td>${row.completed_count}</td>
            <td>${row.overlap_count}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderLogs() {
  $("#logs").innerHTML = state.logs.map((log) => `
    <div class="log-item">
      <time>${new Date(log.created_at).toLocaleString()}</time>
      <div>
        <strong>${escapeHtml(log.change_type)}</strong>
        <div class="meta">任务 ID：${log.task_id ?? "-"}；分配 ID：${log.assignment_id ?? "-"}；成员 ID：${log.member_id ?? "-"}</div>
      </div>
    </div>
  `).join("") || `<div class="empty">暂无修改日志。</div>`;
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
  $("#selectionInfo").textContent = state.selectedTaskIds.size ? `已选择 ${state.selectedTaskIds.size} 个任务` : "未选择任务";
  $("#batchApplyBtn").disabled = state.selectedTaskIds.size === 0;
  $$("[data-task-check]").forEach((input) => {
    input.checked = state.selectedTaskIds.has(Number(input.dataset.taskCheck));
  });
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
  const assignment = state.assignments.find((item) => item.id === state.activeAssignmentId);
  if (assignment) {
    const task = state.tasks.find((item) => item.id === assignment.task_id);
    pane.innerHTML = `
      <section class="detail-card">
        <h2>${escapeHtml(assignment.task_title)}</h2>
        <p class="meta">${escapeHtml(assignment.task_description || "无描述")}</p>
        <dl>
          <dt>成员</dt><dd>${escapeHtml(assignment.member_name)}</dd>
          <dt>状态</dt><dd>${statusLabels[assignment.task_status]}</dd>
          <dt>个人时间</dt><dd>${assignment.start_date} 至 ${assignment.end_date}</dd>
          <dt>进度</dt><dd>${assignment.progress}%</dd>
          <dt>备注</dt><dd>${escapeHtml(assignment.note || "无")}</dd>
        </dl>
        <div class="detail-actions">
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
    pane.innerHTML = `
      <section class="detail-card">
        <h2>${escapeHtml(task.title)}</h2>
        <p class="meta">${escapeHtml(task.description || "无描述")}</p>
        <dl>
          <dt>默认时间</dt><dd>${task.default_start_date} 至 ${task.default_end_date}</dd>
          <dt>状态</dt><dd>${statusLabels[task.status]}</dd>
          <dt>参与人数</dt><dd>${task.assignments.length}</dd>
          <dt>清单</dt><dd>${checklistSummary(task)}</dd>
        </dl>
        <div class="detail-actions">
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

  pane.innerHTML = `<div class="detail-empty">点击甘特图任务条或任务卡片查看详情</div>`;
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
      <label>颜色<input name="color" type="color" value="${task.color}"></label>
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
  const form = new FormData(event.currentTarget);
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
}

function setDefaultDates() {
  const today = todayLocalDate();
  $("#taskForm").default_start_date.value = today;
  $("#taskForm").default_end_date.value = addDays(today, 13);
}

function applyTemplate(templateId) {
  const template = state.templates.find((item) => item.id === Number(templateId));
  if (!template) return;
  const form = $("#taskForm");
  form.title.value = template.name;
  form.description.value = template.description || "";
  form.color.value = template.color;
  form.default_end_date.value = addDays(form.default_start_date.value || todayLocalDate(), template.duration_days - 1);
  form.checklist.value = template.checklist.join("\n");
}

function editTemplate(templateId) {
  const template = state.templates.find((item) => item.id === Number(templateId));
  if (!template) return;
  const form = $("#templateForm");
  form.id.value = template.id;
  form.name.value = template.name;
  form.description.value = template.description || "";
  form.color.value = template.color;
  form.duration_days.value = template.duration_days;
  form.checklist.value = template.checklist.join("\n");
  showToast("模板已载入，可修改后保存");
}

function resetTemplateForm() {
  const form = $("#templateForm");
  form.reset();
  form.id.value = "";
  form.color.value = "#0f766e";
  form.duration_days.value = 7;
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
  await api(`/api/assignments/${drag.assignmentId}`, {
    method: "PUT",
    body: JSON.stringify({
      start_date: drag.previewStart,
      end_date: drag.previewEnd
    })
  });
  showToast("个人任务时间已更新");
  await loadData();
}

async function addMembersToTask(taskId) {
  const ids = $$("[data-add-member]:checked").map((input) => Number(input.dataset.addMember));
  if (!ids.length) return showToast("请选择要追加的成员");
  await api(`/api/tasks/${taskId}/members`, { method: "POST", body: JSON.stringify({ member_ids: ids }) });
  showToast("成员已追加");
  await loadData();
}

async function applyBatch() {
  const payload = {
    task_ids: [...state.selectedTaskIds],
    status: $("#batchStatus").value || undefined,
    default_end_date: $("#batchEndDate").value || undefined,
    sync_assignments: $("#batchSync").checked
  };
  if (!payload.task_ids.length) return showToast("请先选择任务");
  await api("/api/batch/tasks", { method: "POST", body: JSON.stringify(payload) });
  state.selectedTaskIds.clear();
  showToast("批量操作已完成");
  await loadData();
}

async function deleteTaskById(taskId) {
  const numericTaskId = Number(taskId);
  const task = state.tasks.find((item) => item.id === numericTaskId);
  const name = task?.title || `ID ${taskId}`;
  if (!window.confirm(`确认删除任务「${name}」？删除后可在回收站恢复。`)) return;
  await api(`/api/tasks/${taskId}`, { method: "DELETE" });
  if (state.activeTaskId === numericTaskId) state.activeTaskId = null;
  if (task?.assignments.some((item) => item.id === state.activeAssignmentId)) state.activeAssignmentId = null;
  state.selectedTaskIds.delete(numericTaskId);
  showToast("任务已删除，可在回收站恢复");
  await loadData();
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
  $("#refreshBtn").addEventListener("click", loadData);
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
  });
  $("#scaleSelect").addEventListener("change", (event) => {
    state.scale = event.target.value;
    renderGantt();
  });
  $("#zoomRange").addEventListener("input", (event) => {
    state.zoom = Number(event.target.value);
    renderGantt();
  });
  $("#rangeSelect").addEventListener("change", (event) => {
    state.rangeMode = event.target.value;
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
      await loadData();
    });
  });
  $("#taskSort").addEventListener("change", (event) => {
    state.taskSort = event.target.value;
    renderTasks();
  });
  $$("[data-task-view-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.taskViewMode = button.dataset.taskViewMode;
      renderTasks();
    });
  });
  $("#clearFiltersBtn").addEventListener("click", async () => {
    state.filters = { member_id: "", status: "", start_date: "", end_date: "", overdue: false, overlap: false };
    await loadData();
  });

  $$("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      $$("[data-view]").forEach((item) => item.classList.remove("active"));
      $$(".view").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.view}View`).classList.add("active");
    });
  });

  $("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    payload.member_ids = form.getAll("member_ids").map(Number);
    payload.checklist = String(payload.checklist || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const memberCount = payload.member_ids.length;
    const checklistCount = payload.checklist.length;
    if (!window.confirm(`确认创建任务「${payload.title}」？\n参与成员：${memberCount} 人\n检查项：${checklistCount} 项`)) return;
    await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    event.currentTarget.color.value = "#2563eb";
    event.currentTarget.status.value = "auto";
    setDefaultDates();
    showToast("任务已创建");
    await loadData();
    await loadData();
  });

  $("#templateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    const templateId = payload.id;
    delete payload.id;
    if (!payload.name) return showToast("模板名不能为空");
    payload.duration_days = Number(payload.duration_days || 7);
    payload.checklist = String(payload.checklist || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const verb = templateId ? "更新" : "保存";
    if (!window.confirm(`确认${verb}模板「${payload.name}」？\n默认周期：${payload.duration_days} 天\n检查项：${payload.checklist.length} 项`)) return;
    if (templateId) {
      await api(`/api/templates/${templateId}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/api/templates", { method: "POST", body: JSON.stringify(payload) });
    }
    resetTemplateForm();
    showToast(templateId ? "模板已更新" : "模板已保存");
    await loadData();
    await loadData();
  });

  $("#importMembersBtn").addEventListener("click", async () => {
    const result = await api("/api/import/members", { method: "POST", body: JSON.stringify({ csv: $("#membersCsv").value }) });
    showImportErrors(result);
    showToast(`已导入 ${result.created} 名成员${result.errors?.length ? "，部分行失败" : ""}`);
    await loadData();
  });

  $("#importTasksBtn").addEventListener("click", async () => {
    const result = await api("/api/import/tasks", { method: "POST", body: JSON.stringify({ csv: $("#tasksCsv").value }) });
    showImportErrors(result);
    showToast(`已导入 ${result.created} 个任务${result.errors?.length ? "，部分行失败" : ""}`);
    await loadData();
  });

  $("#batchApplyBtn").addEventListener("click", applyBatch);
  $("#archiveSelectedBtn").addEventListener("click", async () => {
    if (!state.selectedTaskIds.size) return showToast("请先选择任务");
    if (!window.confirm(`确认归档选中的 ${state.selectedTaskIds.size} 个任务？归档后会从日常视图移到维护页归档区。`)) return;
    await api("/api/batch/tasks", { method: "POST", body: JSON.stringify({ task_ids: [...state.selectedTaskIds], status: "archived" }) });
    state.selectedTaskIds.clear();
    showToast("已归档所选任务");
    await loadData();
  });

  $("#clearLogsBtn").addEventListener("click", async () => {
    const result = await api("/api/maintenance/clear-logs", { method: "POST", body: "{}" });
    downloadBackup(result.backup, "before-clear-logs");
    showToast(`已清空 ${result.deleted} 条日志`);
    await loadData();
  });
  $("#purgeArchivedBtn").addEventListener("click", async () => {
    const result = await api("/api/maintenance/purge-archived", { method: "POST", body: "{}" });
    downloadBackup(result.backup, "before-purge-archived");
    showToast(`已将 ${result.deleted} 个归档任务移入回收站`);
    await loadData();
  });
  $("#resetSampleBtn").addEventListener("click", async () => {
    const text = window.prompt("输入 RESET 确认重置示例数据");
    if (text !== "RESET") return showToast("已取消重置");
    const result = await api("/api/maintenance/reset-sample", { method: "POST", body: "{}" });
    downloadBackup(result.backup, "before-reset-sample");
    state.selectedTaskIds.clear();
    state.activeAssignmentId = null;
    state.activeTaskId = null;
    showToast("示例数据已重置");
    await loadData();
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
      await api(`/api/checklist/${checkItem.dataset.checkItem}`, { method: "PUT", body: JSON.stringify({ is_done: checkItem.checked }) });
      await loadData();
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

    if (action("[data-edit-member]")) return openMemberEditor(action("[data-edit-member]").dataset.editMember);
    if (action("[data-edit-task]")) return openTaskEditor(action("[data-edit-task]").dataset.editTask);
    if (action("[data-edit-assignment]")) return openAssignmentEditor(action("[data-edit-assignment]").dataset.editAssignment);
    if (action("[data-select-assignment]")) {
      state.activeAssignmentId = Number(action("[data-select-assignment]").dataset.selectAssignment);
      state.activeTaskId = null;
      renderGantt();
      renderDetail();
      return;
    }
    if (action("[data-select-task]")) {
      state.activeTaskId = Number(action("[data-select-task]").dataset.selectTask);
      state.activeAssignmentId = null;
      renderGantt();
      renderDetail();
      return;
    }
    if (action("[data-add-members-to-task]")) return addMembersToTask(action("[data-add-members-to-task]").dataset.addMembersToTask);
    if (action("[data-add-check-item]")) {
      const taskId = action("[data-add-check-item]").dataset.addCheckItem;
      const input = $(`[data-new-check-title="${taskId}"]`);
      if (!input.value.trim()) return showToast("检查项不能为空");
      await api(`/api/tasks/${taskId}/checklist`, { method: "POST", body: JSON.stringify({ title: input.value.trim() }) });
      showToast("检查项已添加");
      await loadData();
      return;
    }
    if (action("[data-delete-check-item]")) {
      await api(`/api/checklist/${action("[data-delete-check-item]").dataset.deleteCheckItem}`, { method: "DELETE" });
      showToast("检查项已删除");
      await loadData();
      return;
    }
    if (action("[data-delete-template]")) {
      await api(`/api/templates/${action("[data-delete-template]").dataset.deleteTemplate}`, { method: "DELETE" });
      showToast("模板已删除");
      await loadData();
      return;
    }
    if (action("[data-edit-template]")) {
      editTemplate(action("[data-edit-template]").dataset.editTemplate);
      return;
    }
    if (action("[data-restore-task]")) {
      await api(`/api/tasks/${action("[data-restore-task]").dataset.restoreTask}/restore`, { method: "POST", body: "{}" });
      showToast("任务已恢复");
      await loadData();
      return;
    }
    if (action("[data-restore-member]")) {
      await api(`/api/members/${action("[data-restore-member]").dataset.restoreMember}/restore`, { method: "POST", body: "{}" });
      showToast("成员已恢复");
      await loadData();
      return;
    }
    if (action("[data-remove-assignment]")) {
      await api(`/api/assignments/${action("[data-remove-assignment]").dataset.removeAssignment}`, { method: "DELETE" });
      state.activeAssignmentId = null;
      showToast("已移除该成员分配");
      await loadData();
      return;
    }
    if (action("[data-archive-task]")) {
      const taskId = Number(action("[data-archive-task]").dataset.archiveTask);
      const task = state.tasks.find((item) => item.id === taskId);
      const name = task?.title || `ID ${taskId}`;
      if (!window.confirm(`确认归档任务「${name}」？归档后会从日常视图移到维护页归档区。`)) return;
      await api(`/api/tasks/${action("[data-archive-task]").dataset.archiveTask}/archive`, { method: "POST" });
      showToast("任务已归档");
      await loadData();
      return;
    }
    if (action("[data-delete-task]")) {
      return deleteTaskById(action("[data-delete-task]").dataset.deleteTask);
    }
    if (action("[data-delete-member]")) {
      await api(`/api/members/${action("[data-delete-member]").dataset.deleteMember}`, { method: "DELETE" });
      $("#editDialog").close();
      showToast("成员已删除");
      await loadData();
    }
  });
}

bindEvents();
setDefaultDates();
loadData().catch((error) => showToast(error.message));


