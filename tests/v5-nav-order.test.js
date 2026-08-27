import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

test("V5 navigation and content panels follow the editor, execution, resources order", () => {
  const navStart = index.indexOf('<nav id="v5Nav"');
  const navEnd = index.indexOf("</nav>", navStart);
  assert.ok(navStart >= 0 && navEnd > navStart, "V5 primary navigation should be present");
  const nav = index.slice(navStart, navEnd);
  const views = [...nav.matchAll(/data-v5-view="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(views, ["editor", "execution", "resources"]);

  const panelPositions = ["v5EditorView", "v5ExecutionView", "v5ResourcesView"].map((id) => index.indexOf(`id="${id}"`));
  assert.ok(panelPositions.every((position) => position >= 0), "all V5 content panels should be present");
  assert.ok(panelPositions[0] < panelPositions[1] && panelPositions[1] < panelPositions[2], "content panel order should match navigation order");

  for (const [view, panel] of [["editor", "v5EditorView"], ["execution", "v5ExecutionView"], ["resources", "v5ResourcesView"]]) {
    assert.match(nav, new RegExp(`data-v5-view="${view}"[^>]*aria-controls="${panel}"`));
    assert.match(index, new RegExp(`<section id="${panel}"[^>]*data-v5-panel="${view}"`));
  }
  assert.match(app, /\$\$\("\[data-v5-view\]"\)/);
  assert.match(app, /\$\$\("\[data-v5-panel\]"\)/);
});
