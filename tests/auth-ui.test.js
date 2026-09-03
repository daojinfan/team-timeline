import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("public/app.js", "utf8");

test("角色界面切换只切换 viewer-mode，不永久删除管理员入口", () => {
  const match = app.match(/function applyRoleSurface\(role\) \{[\s\S]*?\n\}/);
  assert.ok(match, "applyRoleSurface 应存在");
  assert.match(match[0], /document\.body\.classList\.toggle\("viewer-mode", viewer\)/);
  assert.doesNotMatch(match[0], /\.remove\(\)/);
});
