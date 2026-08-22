import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const stylesheet = path.resolve("public/styles.css");

function parseColor(value) {
  const normalized = value.toLowerCase();
  if (normalized === "#fff") return [255, 255, 255];
  const hex = normalized.replace(/^#/, "");
  assert.match(hex, /^[0-9a-f]{6}$/, `expected a six-digit color, got ${value}`);
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(value) {
  return parseColor(value).map((channel) => channel / 255).map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function cssVariable(css, name) {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `missing ${name}`);
  return match[1];
}

function cssRule(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `missing selector ${selector}`);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated selector ${selector}`);
  return css.slice(start, end + 1);
}

test("V4 compact task/topic buttons retain readable foregrounds", async () => {
  const css = await readFile(stylesheet, "utf8");
  const buttonRule = cssRule(css, "button.v3-topic-row,");
  assert.match(buttonRule, /color:\s*var\(--text\)/);
  assert.match(buttonRule, /background:\s*var\(--surface\)/);
  assert.match(css, /button\.v3-topic-row span,[\s\S]*?button\.v3-task-card small[\s\S]*?color:\s*var\(--muted\)/);
  assert.match(css, /button\.v3-topic-row:disabled,[\s\S]*?button\.v3-task-card:disabled[\s\S]*?color:\s*var\(--muted\)/);
  assert.match(css, /button\.v3-topic-row:hover span,[\s\S]*?button\.v3-task-card:focus-visible small\s*\{[\s\S]*?color:\s*var\(--text\)/);
  assert.match(css, /button\.v3-topic-row:disabled span,[\s\S]*?button\.v3-task-card:disabled small\s*\{[\s\S]*?color:\s*var\(--text\)/);
  const mutedOnSoft = contrast(cssVariable(css, "--muted"), cssVariable(css, "--soft"));
  const textOnSoft = contrast(cssVariable(css, "--text"), cssVariable(css, "--soft"));
  assert.ok(mutedOnSoft < 4.5, `the known muted-on-soft baseline should be below AA (${mutedOnSoft.toFixed(2)})`);
  assert.ok(textOnSoft >= 4.5, `interaction descendant text-on-soft must meet AA (${textOnSoft.toFixed(2)})`);
});

test("V4 status chips expose all states and meet WCAG AA contrast", async () => {
  const css = await readFile(stylesheet, "utf8");
  for (const state of ["testing", "delayed", "arriving_within_window", "arriving_outside_window", "time_pending", "completed", "active", "planned", "paused", "cancelled", "submitted", "accepted", "returned"]) {
    assert.match(css, new RegExp(`v3-status-${state}`), `missing V3 status mapping for ${state}`);
  }
  assert.match(css, /\.v3-status-chip\s*\{[\s\S]*?display:\s*inline-flex/);
  assert.match(css, /\.v3-status-badge\.is-success\s*\{[\s\S]*?background:\s*var\(--success\)/);
  assert.match(css, /\.v2-status-chip\[data-status="completed"\]\s*\{[\s\S]*?color:\s*#022c22/);

  const colors = {
    testing: [cssVariable(css, "--v2-testing"), "#ffffff"],
    delayed: [cssVariable(css, "--v2-delayed"), "#ffffff"],
    arriving_within_window: [cssVariable(css, "--v2-within"), "#422006"],
    arriving_outside_window: [cssVariable(css, "--v2-outside"), "#ffffff"],
    time_pending: [cssVariable(css, "--v2-pending"), "#ffffff"],
    completed: [cssVariable(css, "--v2-completed"), "#022c22"]
  };
  for (const [state, [background, foreground]] of Object.entries(colors)) {
    const ratio = contrast(foreground, background);
    assert.ok(ratio >= 4.5, `${state} contrast is ${ratio.toFixed(2)}`);
  }
});
