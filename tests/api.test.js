import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createAppServer, initDatabase } from "../src/server.js";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "team-task-gantt-"));
  const database = await initDatabase(path.join(dir, "test.sqlite"));
  const server = createAppServer(database);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, options = {}) => {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { "content-type": "application/json" },
      ...options
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (options.expectError) {
      assert.equal(response.ok, false);
      return payload;
    }
    assert.equal(response.ok, true, payload.error || payload);
    return payload;
  };
  return {
    request,
    database,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      database.close();
      await rm(dir, { recursive: true, force: true });
    }
  };
}

function addDays(date, amount) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + amount);
  return next.toISOString().slice(0, 10);
}

test("dashboard exposes seeded data, templates, checklist, and stats", async () => {
  const app = await fixture();
  try {
    const dashboard = await app.request("/api/dashboard");
    const templates = await app.request("/api/templates");
    assert.ok(dashboard.members.length >= 4);
    assert.ok(dashboard.tasks.length >= 4);
    assert.ok(dashboard.tasks.some((task) => task.checklist.length > 0));
    assert.ok(dashboard.stats.member_load.length >= 4);
    assert.ok(templates.length >= 4);
  } finally {
    await app.close();
  }
});

test("structured filters return matching task ids", async () => {
  const app = await fixture();
  try {
    const task = (await app.request("/api/tasks"))[0];
    await app.request(`/api/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" })
    });
    const dashboard = await app.request("/api/dashboard?status=cancelled");
    const ids = new Set(dashboard.filtered_task_ids);
    assert.ok(ids.size > 0);
    assert.ok(dashboard.tasks.filter((item) => ids.has(item.id)).every((item) => item.status === "cancelled"));
  } finally {
    await app.close();
  }
});

test("planned and active task statuses are derived from dates", async () => {
  const app = await fixture();
  try {
    const dashboard = await app.request("/api/dashboard");
    const members = await app.request("/api/members");
    const futureStart = addDays(dashboard.today, 5);
    const futureEnd = addDays(dashboard.today, 8);

    const futureTask = await app.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Auto future task",
        default_start_date: futureStart,
        default_end_date: futureEnd,
        color: "#2563eb",
        status: "active",
        member_ids: [members[0].id]
      })
    });
    assert.equal(futureTask.status, "planned");

    const activeTask = await app.request(`/api/tasks/${futureTask.id}`, {
      method: "PUT",
      body: JSON.stringify({
        default_start_date: addDays(dashboard.today, -1),
        default_end_date: futureEnd,
        status: "auto"
      })
    });
    assert.equal(activeTask.status, "active");
  } finally {
    await app.close();
  }
});

test("archived status filter can include archived tasks", async () => {
  const app = await fixture();
  try {
    const task = (await app.request("/api/tasks"))[0];
    await app.request(`/api/tasks/${task.id}/archive`, { method: "POST", body: "{}" });
    const dashboard = await app.request("/api/dashboard?status=archived");
    assert.ok(dashboard.tasks.some((item) => item.id === task.id && item.status === "archived"));
    assert.ok(dashboard.filtered_task_ids.includes(task.id));
  } finally {
    await app.close();
  }
});

test("template and checklist workflow works", async () => {
  const app = await fixture();
  try {
    const template = await app.request("/api/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Acceptance template",
        description: "Template description",
        color: "#0f766e",
        duration_days: 5,
        checklist: ["Step one", "Step two"]
      })
    });
    assert.equal(template.checklist.length, 2);

    const editedTemplate = await app.request(`/api/templates/${template.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "Edited acceptance template",
        description: "Edited description",
        color: "#2563eb",
        duration_days: 9,
        checklist: ["Edited step"]
      })
    });
    assert.equal(editedTemplate.name, "Edited acceptance template");
    assert.equal(editedTemplate.duration_days, 9);
    assert.equal(editedTemplate.checklist.length, 1);

    const members = await app.request("/api/members");
    const task = await app.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Template task",
        description: template.description,
        default_start_date: "2026-09-01",
        default_end_date: "2026-09-06",
        color: template.color,
        status: "active",
        member_ids: [members[0].id],
        checklist: template.checklist
      })
    });
    assert.equal(task.checklist.length, 2);

    const item = await app.request(`/api/tasks/${task.id}/checklist`, {
      method: "POST",
      body: JSON.stringify({ title: "Extra check" })
    });
    const updated = await app.request(`/api/checklist/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ is_done: true })
    });
    assert.equal(updated.is_done, 1);
  } finally {
    await app.close();
  }
});

test("archive area, trash, and restore workflow works", async () => {
  const app = await fixture();
  try {
    const task = (await app.request("/api/tasks"))[0];
    await app.request(`/api/tasks/${task.id}/archive`, { method: "POST", body: "{}" });
    const archived = await app.request("/api/archive/tasks");
    assert.ok(archived.some((item) => item.id === task.id));

    await app.request(`/api/tasks/${task.id}/restore`, { method: "POST", body: "{}" });
    const afterRestore = await app.request("/api/archive/tasks");
    assert.equal(afterRestore.some((item) => item.id === task.id), false);

    await app.request(`/api/tasks/${task.id}`, { method: "DELETE" });
    const trash = await app.request("/api/trash");
    assert.ok(trash.tasks.some((item) => item.id === task.id));

    const restored = await app.request(`/api/tasks/${task.id}/restore`, { method: "POST", body: "{}" });
    assert.equal(restored.id, task.id);
    const trashAfter = await app.request("/api/trash");
    assert.equal(trashAfter.tasks.some((item) => item.id === task.id), false);
  } finally {
    await app.close();
  }
});

test("task delete is a recoverable soft delete", async () => {
  const app = await fixture();
  try {
    const task = (await app.request("/api/tasks"))[0];
    await app.request(`/api/tasks/${task.id}`, { method: "DELETE" });

    const dashboard = await app.request("/api/dashboard");
    assert.equal(dashboard.tasks.some((item) => item.id === task.id), false);

    const trash = await app.request("/api/trash");
    assert.ok(trash.tasks.some((item) => item.id === task.id));

    const restored = await app.request(`/api/tasks/${task.id}/restore`, { method: "POST", body: "{}" });
    assert.equal(restored.id, task.id);
  } finally {
    await app.close();
  }
});

test("deleted members can be restored from trash", async () => {
  const app = await fixture();
  try {
    const member = await app.request("/api/members", {
      method: "POST",
      body: JSON.stringify({ name: "Restorable member", role: "QA" })
    });
    await app.request(`/api/members/${member.id}`, { method: "DELETE" });
    const trash = await app.request("/api/trash");
    assert.ok(trash.members.some((item) => item.id === member.id));

    const restored = await app.request(`/api/members/${member.id}/restore`, { method: "POST", body: "{}" });
    assert.equal(restored.status, "active");
  } finally {
    await app.close();
  }
});

test("maintenance preview and safer maintenance backups work", async () => {
  const app = await fixture();
  try {
    const task = (await app.request("/api/tasks"))[0];
    await app.request(`/api/tasks/${task.id}/archive`, { method: "POST", body: "{}" });

    const preview = await app.request("/api/maintenance/preview");
    assert.ok(preview.archived_tasks >= 1);
    assert.ok(preview.logs >= 1);

    const purged = await app.request("/api/maintenance/purge-archived", { method: "POST", body: "{}" });
    assert.ok(purged.deleted >= 1);
    assert.ok(purged.backup.tasks.length >= 1);
    const trash = await app.request("/api/trash");
    assert.ok(trash.tasks.some((item) => item.id === task.id));

    const cleared = await app.request("/api/maintenance/clear-logs", { method: "POST", body: "{}" });
    assert.ok(cleared.backup.task_change_logs.length >= 0);
    const logs = await app.request("/api/logs");
    assert.equal(logs.length, 0);

    const reset = await app.request("/api/maintenance/reset-sample", { method: "POST", body: "{}" });
    assert.ok(reset.backup.tasks.length >= 1);
    const dashboard = await app.request("/api/dashboard");
    assert.equal(dashboard.members.length, 4);
    assert.equal(dashboard.tasks.length, 4);
  } finally {
    await app.close();
  }
});

test("core assignment behavior still works", async () => {
  const app = await fixture();
  try {
    const tasks = await app.request("/api/tasks");
    const task = tasks.find((item) => item.assignments.length >= 2);
    const updated = await app.request(`/api/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ default_end_date: "2026-09-30", sync_assignments: true })
    });
    assert.ok(updated.assignments.every((item) => item.end_date === "2026-09-30"));

    const target = updated.assignments[0];
    const other = updated.assignments[1];
    await app.request(`/api/assignments/${target.id}`, {
      method: "PUT",
      body: JSON.stringify({ end_date: "2026-10-10", progress: 55 })
    });
    const after = await app.request("/api/tasks");
    const taskAfter = after.find((item) => item.id === task.id);
    assert.equal(taskAfter.assignments.find((item) => item.id === target.id).end_date, "2026-10-10");
    assert.equal(taskAfter.assignments.find((item) => item.id === other.id).end_date, "2026-09-30");
  } finally {
    await app.close();
  }
});

test("gantt assignment adjustment only changes one member assignment", async () => {
  const app = await fixture();
  try {
    const tasks = await app.request("/api/tasks");
    const task = tasks.find((item) => item.assignments.length >= 2);
    const target = task.assignments[0];
    const other = task.assignments[1];

    await app.request(`/api/assignments/${target.id}`, {
      method: "PUT",
      body: JSON.stringify({
        start_date: "2026-11-01",
        end_date: "2026-11-08"
      })
    });

    const after = await app.request("/api/tasks");
    const updatedTask = after.find((item) => item.id === task.id);
    const updatedTarget = updatedTask.assignments.find((item) => item.id === target.id);
    const untouchedOther = updatedTask.assignments.find((item) => item.id === other.id);

    assert.equal(updatedTask.default_start_date, task.default_start_date);
    assert.equal(updatedTask.default_end_date, task.default_end_date);
    assert.equal(updatedTarget.start_date, "2026-11-01");
    assert.equal(updatedTarget.end_date, "2026-11-08");
    assert.equal(untouchedOther.start_date, other.start_date);
    assert.equal(untouchedOther.end_date, other.end_date);
  } finally {
    await app.close();
  }
});
