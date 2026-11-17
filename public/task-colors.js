export const families = [
  ["蓝", "#2563eb"], ["青", "#0d9488"], ["紫", "#7c3aed"], ["橙", "#ea580c"],
  ["绿", "#43832d"], ["玫红", "#be3575"], ["靛", "#4f46a5"], ["金", "#af800c"]
];

export function topicColor(topic) {
  return topic?.base_color || families[((topic?.id || 1) - 1) % families.length][1];
}

export function rgb(hex) {
  const digits = hex.slice(1);
  const expanded = digits.length <= 4 ? [...digits].map(d => d + d).join("") : digits;
  return [0, 2, 4].map(i => parseInt(expanded.slice(i, i + 2), 16) / 255);
}

export function toHSV(hex) {
  const [r, g, b] = rgb(hex);
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  let h = 0;
  if (d && v === r) h = (g - b) / d;
  else if (d && v === g) h = 2 + (b - r) / d;
  else if (d) h = 4 + (r - g) / d;
  return { h: (60 * h + 360) % 360, s: v ? d / v : 0, v };
}

export function fromHSV(h, s, v) {
  const channel = n => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, "0");
  };
  return "#" + [5, 3, 1].map(channel).join("");
}

export function shades(base) {
  const { h, s, v } = toHSV(base);
  return Array.from({ length: 8 }, (_, i) => fromHSV(h, s * (0.32 + 0.68 * i / 7), 0.98 - (0.48 + 0.28 * (1 - v)) * i / 7));
}

export function textColor(hex) {
  const [r, g, b] = rgb(hex).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}

export function recommendColor(base, tasks, start, end) {
  const colors = shades(base);
  const uses = Array(8).fill(0);
  for (const task of tasks) {
    if (start && end && task.start_date && task.end_date && (task.start_date > end || task.end_date < start)) continue;
    const index = colors.indexOf(task.color?.toLowerCase());
    if (index >= 0) uses[index]++;
  }
  const priority = [1, 4, 7, 0, 3, 6, 2, 5];
  return colors[priority.find(i => uses[i] === Math.min(...uses))];
}

export function topicColorPlan(base, tasks) {
  const plan = [];
  for (const task of [...tasks].sort((a, b) => a.id - b.id)) {
    const color = recommendColor(base, plan, task.start_date, task.end_date);
    plan.push({ ...task, color });
  }
  return plan;
}
