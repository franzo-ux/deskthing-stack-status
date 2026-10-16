import { createDeskThing } from "@deskthing/client";

type Level = "ok" | "warn" | "bad";
type Item = { key: string; name: string; detail: string; level: Level };
type Group = { id: string; title: string; online: boolean; error: string | null; items: Item[] };
type HomelabStatus = { checked: number; checkedLabel?: string; groups: Group[]; problems: number };

const DeskThing = createDeskThing();

// Never take keyboard focus away from the DeskThing page: if this iframe gets
// focus (a tap does that), the Car Thing buttons and knob stop driving
// DeskThing's own UI (app wheel, app switching). Taps and clicks still work.
document.addEventListener("mousedown", (e) => e.preventDefault(), true);
const $ = (id: string) => document.getElementById(id) as HTMLElement;

const TAG: Record<Level, string> = { ok: "[ OK ]", warn: "[WARN]", bad: "[FAIL]" };
const SHORT: Record<string, string> = { komodo: "komodo", "komodo-op": "komodo-op", ha: "casa" };

let status: HomelabStatus | null = null;
let troubleSince: number | null = null;

function esc(s: string) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

function pad(s: string, n: number) {
  s = String(s);
  return s.length >= n ? s.slice(0, n - 1) + " " : s + new Array(n - s.length + 1).join(" ");
}

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
}

function line(level: Level, group: string, name: string, detail: string) {
  detail = detail.replace(/ · (\d+) servizi?o?$/, " ($1)");
  return (
    '<div class="line"><span class="tag-' + level + " " + level + '">' + TAG[level] + "</span> " +
    '<span class="' + (level === "ok" ? "" : level) + '">' + esc(pad(group, 10)) + " " + esc(pad(name, 15)) + " " + esc(detail) + "</span></div>"
  );
}

const LINE_H = 24; // 16px * 1.5
const SCROLL_SPEED = LINE_H / 2.5; // about one line every 2.5 s
const MAX_PINNED = 6;

let pinnedHtml = "";
let okHtml = "";
let offset = 0;
let loopHeight = 0; // height of one copy of the OK list (+ gap) when it scrolls

function render() {
  if (!status) return;
  const problems: { level: Level; html: string }[] = [];
  const healthy: string[] = [];
  for (const g of status.groups) {
    const short = SHORT[g.id] || g.id;
    if (g.id !== "ha" && !g.online) {
      const level: Level = g.error && g.error.indexOf("manca") === 0 ? "warn" : "bad";
      problems.push({ level, html: line(level, short, "core", g.error || "non risponde") });
      continue;
    }
    for (const it of g.items) {
      const html = line(it.level, short, it.name, it.detail);
      if (it.level === "ok") healthy.push(html);
      else problems.push({ level: it.level, html });
    }
  }
  // stopped / failing first, then warnings: always on top, never scrolling
  problems.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));
  const pinned = problems.slice(0, MAX_PINNED).map((p) => '<div class="pin pin-' + p.level + '">' + p.html + "</div>");
  if (problems.length > MAX_PINNED) pinned.push('<div class="pin pin-bad"><span class="bad">… e altri ' + (problems.length - MAX_PINNED) + " problemi</span></div>");
  const nextPinned = pinned.join("");
  if (nextPinned !== pinnedHtml) {
    pinnedHtml = nextPinned;
    $("pinned").innerHTML = pinnedHtml;
    layoutScroller();
  }

  const nextOk = healthy.join("");
  if (nextOk !== okHtml) {
    okHtml = nextOk;
    layoutScroller();
  }

  const bad = problems.filter((r) => r.level === "bad").length;
  if (bad && troubleSince === null) troubleSince = Date.now();
  if (!bad) troubleSince = null;

  const t = new Date(status.checked);
  const hh = (n: number) => (n < 10 ? "0" : "") + n;
  $("foot").innerHTML = bad
    ? '<span class="bad">!! ' + bad + (bad === 1 ? " problema" : " problemi") + " da " + clock(Date.now() - (troubleSince || Date.now())) + "</span>" +
      '<span class="hd">  · ' + healthy.length + " attivi</span>"
    : '<span class="hd">ultimo controllo ' + (status.checkedLabel || hh(t.getHours()) + ":" + hh(t.getMinutes()) + ":" + hh(t.getSeconds())) + " · " + healthy.length + " attivi</span>";

  setTrouble(bad > 0);
}

/** Fill the healthy list; if it does not fit, duplicate it for a seamless loop. */
function layoutScroller() {
  const vp = $("viewport");
  const sc = $("scroller");
  sc.innerHTML = okHtml;
  const single = sc.offsetHeight;
  if (okHtml && single > vp.clientHeight) {
    sc.innerHTML = okHtml + '<div class="gap"></div>' + okHtml;
    loopHeight = single + LINE_H;
    offset = offset % loopHeight;
  } else {
    loopHeight = 0;
    offset = 0;
  }
  sc.style.transform = "translateY(" + -Math.round(offset) + "px)";
}

let lastT = 0;
function scroll(t: number) {
  const dt = lastT ? Math.min(100, t - lastT) : 16;
  lastT = t;
  if (loopHeight > 0) {
    offset = (offset + (SCROLL_SPEED * dt) / 1000) % loopHeight;
    $("scroller").style.transform = "translateY(" + -Math.round(offset) + "px)";
  }
  requestAnimationFrame(scroll);
}
requestAnimationFrame(scroll);
window.addEventListener("resize", () => layoutScroller());

// ---------- mascot: the maid walks; on trouble she trips, falls, then glitches ----------

// frame canvases and their anchor (head / centre of mass), from design/maid_frames.py
const WALK_W = 42;
const WALK_ANCHOR = 21;
const FALL_ANCHOR = 35;
const FALL_W = 67;
const RIGHT_MARGIN = 30; // stay clear of the knob corner
// speed matched to the stride so she does not slide (about 37 px per 8-frame cycle)
const WALK_SPEED = 31; // px per second
const STEP_MS = 150;
const FALL_MS = 150;

const actor = $("actor");
const frameImg = $("frame") as HTMLImageElement;
const slices = Array.prototype.slice.call(document.querySelectorAll(".slice")) as HTMLImageElement[];

// preload every frame so switching never flashes
const ALL = ([] as string[]).concat(
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => "walk_r" + i),
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => "walk_l" + i),
  [0, 1, 2, 3, 4, 5].map((i) => "fall" + i),
);
ALL.forEach((n) => (new Image().src = "mascot/" + n + ".png"));

let trouble = false;
let mode: "walk" | "fall" | "down" = "walk";
let x = 0;
let dir = 1;
let fallStart = 0;
let lastTick = 0;
let current = "";

function show(name: string) {
  if (name === current) return;
  current = name;
  const src = "mascot/" + name + ".png";
  frameImg.src = src;
  slices.forEach((sl) => (sl.src = src));
}

function setTrouble(on: boolean) {
  if (on === trouble) return;
  trouble = on;
  document.body.classList[on ? "add" : "remove"]("trouble");
  if (on) {
    mode = "fall";
    fallStart = performance.now();
  } else {
    mode = "walk";
    document.body.classList.remove("glitching");
  }
}

function tick(t: number) {
  const dt = lastTick ? Math.min(100, t - lastTick) : 16;
  lastTick = t;
  const stage = $("mascot").clientWidth;
  if (mode === "walk") {
    const max = Math.max(0, stage - WALK_W - RIGHT_MARGIN);
    x += dir * WALK_SPEED * (dt / 1000);
    if (x >= max) { x = max; dir = -1; }
    if (x <= 0) { x = 0; dir = 1; }
    show((dir > 0 ? "walk_r" : "walk_l") + (Math.floor(t / STEP_MS) % 8));
    actor.style.transform = "translateX(" + Math.round(x) + "px)";
    actor.style.transformOrigin = "0 0";
  } else {
    // she falls where she is, facing her last direction (mirrored around her body)
    const i = mode === "down" ? 5 : Math.min(5, Math.floor((t - fallStart) / FALL_MS));
    if (mode === "fall" && i === 5) {
      mode = "down";
      document.body.classList.add("glitching"); // the glitch starts once she is on the ground
    }
    show("fall" + i);
    // keep the lying body inside the screen
    const left = Math.round(Math.max(0, Math.min(stage - FALL_W - RIGHT_MARGIN, x + WALK_ANCHOR - FALL_ANCHOR)));
    actor.style.transformOrigin = FALL_ANCHOR + "px 50%";
    actor.style.transform = "translateX(" + left + "px) scaleX(" + dir + ")";
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// glitch: random horizontal bands + offsets on the two tinted copies
setInterval(() => {
  if (mode !== "down") return;
  slices.forEach((sl, i) => {
    const top = Math.floor(Math.random() * 85);
    const height = 3 + Math.floor(Math.random() * 25);
    const clip = "inset(" + top + "% 0 " + Math.max(0, 100 - top - height) + "% 0)";
    const st = sl.style as any;
    st.visibility = Math.random() < 0.75 ? "visible" : "hidden";
    st.webkitClipPath = clip;
    st.clipPath = clip;
    st.transform = "translateX(" + ((Math.random() * 14 - 7) * (i ? -1 : 1)).toFixed(0) + "px)";
  });
}, 90);

function shock() {
  document.body.classList.add("shock");
  setTimeout(() => document.body.classList.remove("shock"), 1000);
}


DeskThing.on("homelab_status", (data: any) => {
  status = data.payload as HomelabStatus;
  render();
});
DeskThing.on("alert", () => shock());

setInterval(render, 1000);
DeskThing.send({ type: "get", request: "homelab_status" } as any);
