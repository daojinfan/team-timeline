import { families, shades, toHSV, fromHSV, textColor } from "./task-colors.js";

export function mountColorPicker(root, { base, value, title, topic = false, automatic = false, onChange }) {
  const saved = root.querySelector("[name]");
  root.replaceChildren(saved);
  const panel = document.createElement("div");
  root.append(panel);
  panel.innerHTML = `<div class="palette-swatches" role="group" aria-label="${topic ? "专题色系" : "专题色阶"}"></div>
    <span class="palette-preview"></span>
    <details><summary>更多颜色</summary>
      <div class="palette-plane" tabindex="0" role="group" aria-label="饱和度和明度，可用方向键微调"><i></i></div>
      <label>色相<input type="range" min="0" max="359"></label>
      <label>HEX<input class="palette-hex" type="text" maxlength="7" pattern="#[0-9a-fA-F]{6}" required></label>
    </details>`;
  const swatches = panel.querySelector(".palette-swatches");
  const preview = panel.querySelector(".palette-preview");
  const plane = panel.querySelector(".palette-plane");
  const hue = panel.querySelector("[type=range]");
  const hex = panel.querySelector(".palette-hex");
  let hsv;
  let auto = automatic;

  function paint(color, derive = true) {
    saved.value = color;
    const displayColor = color || "#2563eb";
    if (derive) hsv = toHSV(displayColor);
    hue.value = Math.round(hsv.h) % 360;
    hex.value = fromHSV(hsv.h, hsv.s, hsv.v);
    plane.style.setProperty("--hue", hsv.h);
    plane.firstChild.style.left = (100 * hsv.s) + "%";
    plane.firstChild.style.top = (100 * (1 - hsv.v)) + "%";
    preview.style.backgroundColor = displayColor;
    preview.style.color = textColor(displayColor);
    preview.textContent = title() || (topic ? "专题主色" : "任务预览");
    for (const button of swatches.children) button.setAttribute("aria-pressed", String(button.dataset.color === color.toLowerCase()));
  }
  function choose(color, derive = true) {
    auto = false;
    paint(color, derive);
    onChange?.();
  }
  function renderSwatches() {
    swatches.replaceChildren();
    const choices = topic ? families : shades(base).map((color, i) => [String(i + 1), color]);
    for (const [label, color] of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.color = color;
      button.title = topic ? label + "色" : "第 " + label + " 档";
      button.textContent = label;
      button.style.backgroundColor = color;
      button.style.color = textColor(color);
      button.onclick = () => choose(color);
      swatches.append(button);
    }
  }
  function selectPoint(event) {
    const rect = plane.getBoundingClientRect();
    const bound = x => Math.min(1, Math.max(0, x));
    hsv.s = bound((event.clientX - rect.left) / rect.width);
    hsv.v = 1 - bound((event.clientY - rect.top) / rect.height);
    choose(fromHSV(hsv.h, hsv.s, hsv.v), false);
  }
  plane.onpointerdown = event => {
    if (event.button !== 0) return;
    plane.setPointerCapture(event.pointerId);
    selectPoint(event);
  };
  plane.onpointermove = event => { if (plane.hasPointerCapture(event.pointerId)) selectPoint(event); };
  plane.onkeydown = event => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.01;
    hsv.s = Math.min(1, Math.max(0, hsv.s + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0)));
    hsv.v = Math.min(1, Math.max(0, hsv.v + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0)));
    choose(fromHSV(hsv.h, hsv.s, hsv.v), false);
  };
  hue.oninput = () => { hsv.h = Number(hue.value); choose(fromHSV(hsv.h, hsv.s, hsv.v), false); };
  hex.oninput = () => { if (/^#[a-f\d]{6}$/i.test(hex.value)) choose(hex.value.toLowerCase()); };
  hex.oninvalid = () => { panel.querySelector("details").open = true; };
  renderSwatches();
  paint(value);
  root.refreshPalette = (newBase, suggested) => {
    base = newBase;
    renderSwatches();
    paint(auto ? suggested : saved.value);
  };
  root.refreshTitle = () => { preview.textContent = title() || (topic ? "专题主色" : "任务预览"); };
}
