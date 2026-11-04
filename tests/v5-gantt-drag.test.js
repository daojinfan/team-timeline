import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createAppServer, initDatabase } from "../src/server.js";

const source = readFileSync("public/app.js", "utf8");
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `missing ${name}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/^(?:(?:async )?function |const |bindV5ExecutionEvents\(\);)/m);
  return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
const functions = ["addDays", "daysBetween", "formatLocalDate", "escapeHtml", "clamp", "v5IsFixedCycleMode", "v5ExecutionTaskMembers", "v5ExecutionDateValue", "v5Json", "v5ExecutionGranularityValue", "v5ExecutionStartOfUnit", "v5ExecutionNextUnit", "v5ExecutionUnitWidth", "v5ExecutionDateOffset", "v5ExecutionDayAtOffset", "v5ExecutionDuration", "v5ExecutionPosition", "v5ExecutionTaskBar", "v5ExecutionDragPointerDay", "v5ExecutionDragDates", "v5StartExecutionDrag", "v5PreviewExecutionDrag", "v5ResetExecutionDrag", "v5CancelExecutionDrag", "v5FinishExecutionDrag", "bindV5ExecutionEvents"];

function harness({ task, memberId = 1, role = "admin", scale = "day", fixedCycle = false, range = { start: "2099-06-01", end: "2099-06-30" }, api, confirm = true } = {}) {
  task ??= { id: 17, version: 3, title: "拖拽任务", start_date: "2099-06-05", end_date: "2099-06-10", participants: [1, 2].map((id) => ({ id, name: `成员${id}`, start_date: "2099-06-05", end_date: "2099-06-10" })) };
  const requests = []; const confirmations = []; const toasts = []; const handlers = new Map(); const timers = [];
  let loads = 0; let renders = 0;
  const context = vm.createContext({
    state: { auth: { user: { role } } },
    v5State: { tasks: [task], preferences: { fixedCycleMode: fixedCycle }, execution: { scale, granularity: 3 } },
    v5ExecutionDragState: { active: null, saving: false, suppressClick: null },
    $: () => null, $$: () => [], v5FilterQuickConfig: () => [],
    window: { confirm: (text) => { confirmations.push(text); return confirm; }, setTimeout: (callback) => timers.push(callback) },
    document: { body: { addEventListener(type, callback, capture = false) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push({ callback, capture }); } }, createElement: () => ({ style: {}, setAttribute() {}, remove() { this.removed = true; } }) },
    v5Api: async (url, options) => { const body = JSON.parse(options.body); requests.push({ url, body }); return api ? api(url, body) : { preview_token: "preview-token", conflicts: [] }; },
    v5LoadAll: async () => { loads += 1; }, v5RenderExecution: () => { renders += 1; },
    showToast: (text) => toasts.push(text), v5ErrorText: (error) => error.message
  });
  vm.runInContext(functions.map(functionSource).join("\n"), context);
  context.bindV5ExecutionEvents();
  const member = task.participants.find((row) => row.id === memberId) || null;
  const markup = context.v5ExecutionTaskBar(task, range, member);
  const classes = new Set(); const timeline = { left: 100, getBoundingClientRect() { return { left: this.left }; }, appendChild(node) { this.feedback = node; } };
  const position = context.v5ExecutionPosition(range, member?.start_date || task.start_date, member?.end_date || task.end_date);
  const bar = {
    dataset: { v5ExecDragTask: String(task.id), v5ExecDragMember: memberId == null ? "" : String(memberId), v5ExecRangeStart: range.start, v5ExecRangeEnd: range.end, v5ExecSelectTask: String(task.id) },
    style: { left: `${position.left}px`, width: `${position.width}px`, top: "10px" }, title: "原始提示",
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    closest: (selector) => selector === ".v5-execution-timeline" ? timeline : null,
    setPointerCapture(id) { this.capture = id; }, hasPointerCapture(id) { return this.capture === id; }, releasePointerCapture() { this.capture = null; }
  };
  const target = (edge) => ({ closest: (selector) => selector === "[data-v5-exec-drag-task]" || selector === "[data-v5-exec-select-task]" ? bar : selector === "[data-v5-exec-resize]" && edge ? { dataset: { v5ExecResize: edge } } : null });
  const event = (x, edge, extra = {}) => ({ clientX: x, button: 0, pointerId: 7, target: target(edge), preventDefault() {}, stopImmediatePropagation() { this.stopped = true; }, ...extra });
  const fire = async (type, data) => { data.type = type; for (const { callback } of handlers.get(type) || []) { await callback(data); if (data.stopped) break; } };
  return { context, task, bar, timeline, markup, requests, confirmations, toasts, classes, timers, event, fire, get loads() { return loads; }, get renders() { return renders; } };
}

test("current V5 bars drag through member schedule preview/save with captured version", async () => {
  const h = harness();
  assert.match(h.markup, /data-v5-exec-drag-member="1"/);
  assert.match(h.markup, /data-v5-exec-resize="start"/);
  await h.fire("pointerdown", h.event(300));
  await h.fire("pointermove", h.event(384));
  assert.equal(h.context.v5ExecutionDragState.active.previewStart, "2099-06-07");
  assert.match(h.timeline.feedback.textContent, /2099-06-07/);
  await h.fire("pointerup", h.event(426)); // The final pointer position matters too.
  assert.deepEqual(h.requests, [
    { url: "/api/v5/tasks/17/member-schedule-preview", body: { member_id: 1, start_date: "2099-06-08", end_date: "2099-06-13" } },
    { url: "/api/v5/tasks/17/member-schedule", body: { member_id: 1, start_date: "2099-06-08", end_date: "2099-06-13", preview_token: "preview-token", expected_version: 3, ack: false } }
  ]);
  assert.equal(h.loads, 1);
  assert.equal(h.bar.title, "原始提示");
  assert.equal(h.context.v5ExecutionDragState.active, null);
  const click = h.event(426); await h.fire("click", click);
  assert.equal(click.stopped, true);
  assert.equal(h.renders, 0);
});

test("click and tiny pointer jitter still select tasks without saving", async () => {
  const h = harness();
  await h.fire("pointerdown", h.event(300)); await h.fire("pointermove", h.event(302)); await h.fire("pointerup", h.event(302));
  await h.fire("click", h.event(302));
  assert.equal(h.requests.length, 0);
  assert.equal(h.renders, 1);
  assert.equal(h.context.v5State.execution.selectedTaskId, 17);
});

test("resize clamps to one day, fixed cycle preserves duration, and task bars use the task route", async () => {
  for (const [edge, delta, fixedCycle, expected] of [
    ["start", 20, false, ["2099-06-10", "2099-06-10"]],
    ["end", -20, false, ["2099-06-05", "2099-06-05"]],
    ["end", 2, false, ["2099-06-05", "2099-06-12"]],
    ["start", -2, true, ["2099-06-03", "2099-06-08"]],
    ["end", 2, true, ["2099-06-07", "2099-06-12"]]
  ]) {
    const h = harness({ memberId: null, fixedCycle });
    await h.fire("pointerdown", h.event(300, edge)); await h.fire("pointermove", h.event(300 + delta * 42, edge)); await h.fire("pointerup", h.event(300 + delta * 42, edge));
    assert.deepEqual(h.requests[0], { url: "/api/v5/tasks/17/schedule-preview", body: { start_date: expected[0], end_date: expected[1], sync_members: false } });
  }
});

test("week/month positions and pointer offsets agree on actual days, including leap February", async () => {
  const h = harness({ scale: "week" });
  const position = h.context.v5ExecutionPosition({ start: "2026-10-05", end: "2026-10-25" }, "2026-10-08", "2026-10-09");
  assert.ok(Math.abs(position.left - (3 / 7 * 106 + 3)) < 0.00001);
  await h.fire("pointerdown", h.event(300)); await h.fire("pointermove", h.event(406)); await h.fire("pointerup", h.event(406));
  assert.equal(h.requests[0].body.start_date, "2099-06-12");
  const range = { start: "2028-01-01", end: "2028-04-30" };
  const month = harness({ scale: "month", range, task: { id: 17, version: 3, title: "跨月", start_date: "2028-01-30", end_date: "2028-02-02", participants: [] }, memberId: null });
  for (const date of ["2027-12-31", "2028-01-31", "2028-02-01", "2028-02-29", "2028-03-01", "2028-04-15"]) {
    const offset = month.context.v5ExecutionDateOffset(range, date, "month");
    assert.ok(Math.abs(month.context.v5ExecutionDayAtOffset(range, offset, "month") - month.context.daysBetween(range.start, date)) < 0.00001, date);
  }
  const startX = 100 + 145 * 30 / 31; const endX = 100 + 145 * (1 + 1 / 29);
  await month.fire("pointerdown", month.event(startX)); await month.fire("pointermove", month.event(endX)); await month.fire("pointerup", month.event(endX));
  assert.equal(month.requests[0].body.start_date, "2028-02-01");
  assert.equal(month.requests[0].body.end_date, "2028-02-04");
});

test("clipped bars and scrolling keep the original date offset", async () => {
  const h = harness({ range: { start: "2099-06-08", end: "2099-06-30" } });
  await h.fire("pointerdown", h.event(110)); await h.fire("pointermove", h.event(152));
  h.timeline.left -= 42; await h.fire("pointermove", h.event(152)); await h.fire("pointerup", h.event(152));
  assert.equal(h.requests[0].body.start_date, "2099-06-07");
  assert.equal(h.requests[0].body.end_date, "2099-06-12");
});

test("cancel, lost capture, foreign pointers, and viewer access never write dates", async () => {
  for (const type of ["pointercancel", "lostpointercapture", "keydown"]) {
    const h = harness(); const original = { ...h.bar.style };
    await h.fire("pointerdown", h.event(300)); await h.fire("pointermove", h.event(384));
    await h.fire(type, h.event(384, null, { key: "Escape" })); await h.fire("pointerup", h.event(384));
    assert.equal(h.requests.length, 0); assert.deepEqual(h.bar.style, original); assert.equal(h.timeline.feedback.removed, true);
  }
  const h = harness(); await h.fire("pointerdown", h.event(300)); await h.fire("pointermove", h.event(384, null, { pointerId: 8 }));
  await h.fire("pointerup", h.event(384, null, { pointerId: 8 })); assert.equal(h.requests.length, 0);
  await h.fire("pointercancel", h.event(300));
  const viewer = harness({ role: "viewer" }); assert.doesNotMatch(viewer.markup, /data-v5-exec-resize=/);
  await viewer.fire("pointerdown", viewer.event(300)); assert.equal(viewer.context.v5ExecutionDragState.active, null);
});

test("conflicts require confirmation; cancellation and server errors restore the bar", async () => {
  for (const confirm of [false, true]) {
    const h = harness({ confirm, api: async () => ({ preview_token: "checked", conflicts: [{ type: "MEMBER_OUTSIDE_TASK_RANGE" }] }) });
    const original = { ...h.bar.style };
    await h.fire("pointerdown", h.event(300)); await h.fire("pointermove", h.event(384)); await h.fire("pointerup", h.event(384));
    assert.match(h.confirmations[0], /MEMBER_OUTSIDE_TASK_RANGE/);
    assert.equal(h.requests.length, confirm ? 2 : 1); assert.deepEqual(h.bar.style, original);
    if (confirm) assert.equal(h.requests[1].body.ack, true);
  }
  const h = harness({ api: async () => { throw new Error("STALE_PREVIEW"); } }); const original = { ...h.bar.style };
  await h.fire("pointerdown", h.event(300)); await h.fire("pointermove", h.event(384)); await h.fire("pointerup", h.event(384));
  assert.deepEqual(h.bar.style, original); assert.deepEqual(h.toasts, ["STALE_PREVIEW"]); assert.equal(h.context.v5ExecutionDragState.saving, false);
});

test("drag saves persist through V5 and legacy projections without modifying other members", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "v5-gantt-drag-"));
  const database = await initDatabase(path.join(dir, "test.sqlite"));
  const server = createAppServer(database, { auth: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = async (url, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json(); assert.ok(res.ok, JSON.stringify(data)); return data.data;
  };
  try {
    const resources = await request("/api/v5/resources"); const [first, second] = resources.members;
    const input = { title: "拖动持久化", start_date: "2099-06-05", end_date: "2099-06-10", participant_member_ids: [first.id, second.id] };
    const preview = await request("/api/v5/tasks/preview", input);
    const task = await request("/api/v5/tasks", { ...preview.normalized_input, preview_token: preview.preview_token, ack: true });
    const h = harness({ task, memberId: first.id, api: request });
    await h.fire("pointerdown", h.event(300)); await h.fire("pointermove", h.event(384)); await h.fire("pointerup", h.event(384));
    assert.equal(h.toasts.length, 1); assert.match(h.toasts[0], /已更新/);
    const saved = await request(`/api/v5/tasks/${task.id}`);
    assert.equal(saved.start_date, task.start_date); assert.equal(saved.end_date, task.end_date);
    assert.equal(saved.participants.find((row) => row.id === first.id).start_date, "2099-06-07");
    assert.equal(saved.participants.find((row) => row.id === second.id).start_date, "2099-06-05");
    assert.equal(database.prepare("SELECT start_date FROM task_assignments WHERE task_id=? AND member_id=? AND deleted_at IS NULL").get(task.legacy_task_id, first.id).start_date, "2099-06-07");
    const emptyPreview = await request("/api/v5/tasks/preview", { ...input, title: "未分配拖动", participant_member_ids: [] });
    const empty = await request("/api/v5/tasks", { ...emptyPreview.normalized_input, preview_token: emptyPreview.preview_token, ack: true });
    const unassigned = harness({ task: empty, memberId: null, api: request });
    await unassigned.fire("pointerdown", unassigned.event(300)); await unassigned.fire("pointermove", unassigned.event(258)); await unassigned.fire("pointerup", unassigned.event(258));
    assert.equal((await request(`/api/v5/tasks/${empty.id}`)).start_date, "2099-06-04");
  } finally { await new Promise((resolve) => server.close(resolve)); database.close(); await rm(dir, { recursive: true, force: true }); }
});
