import { createDeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";
import { isLang, LANGUAGE_OPTIONS, stateLabel, t, type Lang } from "../i18n";
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Level = "ok" | "warn" | "bad";

type Item = {
  key: string; // stable id used to detect changes
  name: string;
  detail: string; // state shown on screen
  level: Level;
};

type Group = {
  id: string;
  title: string;
  online: boolean;
  error: string | null;
  missingKey?: boolean; // not configured yet: a warning, not a failure
  items: Item[];
};

type HomelabStatus = { checked: number; checkedLabel?: string; groups: Group[]; problems: number; lang?: Lang };

const DeskThing = createDeskThing();
const POLL_MS = 15000;

const CORES = [
  // two Komodo Core instances (ids are used as setting keys; set the URLs in the app settings)
  { id: "komodo", title: "komodo", url: "http://komodo-1.local:9120" },
  { id: "komodo-op", title: "komodo-op", url: "http://komodo-2.local:9120" },
];
const DEFAULT_HA = "http://homeassistant.local:8123";

let config: Record<string, string> = {};
let last: HomelabStatus = { checked: 0, groups: [], problems: 0 };
let prevLevels = new Map<string, Level>();
let firstPoll = true;
let lang: Lang = "en";
let timer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------- Komodo

// Komodo stack states (lowercased): running is healthy; transitional states
// are warnings; anything that means "not serving" is a problem.
const STACK_OK = new Set(["running"]);
const STACK_WARN = new Set(["deploying", "restarting", "created", "paused", "removing", "unknown"]);

function stackLevel(state: string): Level {
  const s = state.toLowerCase();
  if (STACK_OK.has(s)) return "ok";
  if (STACK_WARN.has(s)) return "warn";
  return "bad"; // stopped, down, dead, unhealthy, ...
}

async function komodo(url: string, key: string, secret: string, type: string): Promise<any> {
  const res = await fetch(url.replace(/\/+$/, "") + "/read", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": key, "X-Api-Secret": secret },
    body: JSON.stringify({ type, params: {} }),
    signal: AbortSignal.timeout(6000),
  });
  if (res.status === 401 || res.status === 403) throw new Error(t(lang, "badKey"));
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/** The core's URL; an empty URL in the settings turns that core off. */
function coreUrl(core: (typeof CORES)[number]): string {
  const id = core.id + "_url";
  return (id in config ? config[id] : core.url).trim();
}

/** "fetch failed" and timeouts mean the host does not answer. */
function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e.name === "TimeoutError" || e.message === "fetch failed") return t(lang, "noReply");
  return e.message;
}

async function checkCore(core: (typeof CORES)[number]): Promise<Group> {
  const url = coreUrl(core);
  const key = config[core.id + "_key"] || "";
  const secret = config[core.id + "_secret"] || "";
  const group: Group = { id: core.id, title: core.title, online: false, error: null, items: [] };
  if (!key || !secret) {
    group.error = t(lang, "missingKey");
    group.missingKey = true;
    return group;
  }
  try {
    const [servers, stacks] = await Promise.all([
      komodo(url, key, secret, "ListServers"),
      komodo(url, key, secret, "ListStacks"),
    ]);
    group.online = true;
    const serverNames = new Map<string, string>();
    for (const s of Array.isArray(servers) ? servers : []) {
      serverNames.set(s.id, s.name);
      const state = String(s?.info?.state ?? "unknown");
      if (state.toLowerCase() !== "ok") {
        group.items.push({
          key: core.id + "/server/" + s.id,
          name: "server " + s.name,
          detail: state.toLowerCase() === "disabled" ? t(lang, "serverDisabled") : t(lang, "serverUnreachable"),
          level: state.toLowerCase() === "disabled" ? "warn" : "bad",
        });
      }
    }
    if (!Array.isArray(stacks) || stacks.length === 0) {
      // valid key but nothing visible: usually missing Read permissions
      group.items.push({ key: core.id + "/empty", name: "stack", detail: t(lang, "noStacks"), level: "warn" });
    }
    for (const st of Array.isArray(stacks) ? stacks : []) {
      const state = String(st?.info?.state ?? "unknown");
      const services = Array.isArray(st?.info?.services) ? st.info.services.length : 0;
      group.items.push({
        key: core.id + "/stack/" + st.id,
        name: st.name,
        // "· N" = number of services; the client shows it as "(N)"
        detail: stateLabel(lang, state) + (services ? " · " + services : ""),
        level: stackLevel(state),
      });
    }
  } catch (e) {
    group.error = errorText(e);
  }
  return group;
}

// Home Assistant's IP address can change (DHCP, updates): if the configured
// URL does not answer, also try its mDNS name before raising an alarm.
const HA_FALLBACK = "http://homeassistant.local:8123";

async function fetchHa(): Promise<Response> {
  const urls = [config.ha_url || DEFAULT_HA, HA_FALLBACK].filter((u, i, a) => a.indexOf(u) === i);
  let error: unknown = null;
  for (const url of urls) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

async function checkHomeAssistant(): Promise<Group> {
  const group: Group = { id: "ha", title: "home assistant", online: false, error: null, items: [] };
  try {
    const res = await fetchHa();
    group.online = res.status < 500;
    group.items.push({
      key: "ha",
      name: "Home Assistant",
      detail: group.online ? t(lang, "online") : t(lang, "httpError", { n: res.status }),
      level: group.online ? "ok" : "bad",
    });
  } catch {
    group.items.push({ key: "ha", name: "Home Assistant", detail: t(lang, "noReply"), level: "bad" });
  }
  return group;
}

// ---------------------------------------------------------------- alerts

declare const __dirname: string;

function findAdb(): string | null {
  const candidates = [join(dirname(process.execPath), "resources", "win", "adb.exe")];
  return candidates.find((p) => existsSync(p)) || null;
}
const ADB = findAdb();

/** Turn the Car Thing screen on (see Pi Status: /tmp/screen-idle/last). */
function wakeScreen() {
  if (!ADB) return;
  execFile(ADB, ["shell", "date +%s > /tmp/screen-idle/last"], { timeout: 5000, windowsHide: true }, () => {});
}

function alert(text: string) {
  console.log("Stack Status alert: " + text);
  wakeScreen();
  DeskThing.send({ type: "alert", payload: { text, at: Date.now() } });
  // Let Pi Status (usually on screen) show it and switch over to Stack Status.
  // DeskThing 0.11 routes sendToApp back to the sender, so use a file instead:
  // Pi Status watches apps/homelab/alert.json.
  try {
    writeFileSync(join(__dirname, "..", "alert.json"), JSON.stringify({ text, at: Date.now() }));
  } catch (e) {
    console.warn("Could not write alert.json", e);
  }
}

async function poll() {
  const groups = await Promise.all([...CORES.filter((c) => coreUrl(c)).map(checkCore), checkHomeAssistant()]);
  const levels = new Map<string, Level>();
  const news: string[] = [];
  for (const g of groups) {
    const coreKey = g.id + "/core";
    // a Komodo core that does not answer is itself a problem (no blind spot)
    if (g.id !== "ha") {
      const lvl: Level = g.online ? "ok" : g.missingKey ? "warn" : "bad";
      levels.set(coreKey, lvl);
      if (!firstPoll && lvl === "bad" && prevLevels.get(coreKey) !== "bad") news.push(g.title + ": " + g.error);
    }
    for (const it of g.items) {
      levels.set(it.key, it.level);
      if (!firstPoll && it.level === "bad" && prevLevels.get(it.key) !== "bad") news.push(it.name + " " + it.detail);
    }
  }
  prevLevels = levels;
  firstPoll = false;
  let problems = 0;
  levels.forEach((l) => l === "bad" && problems++);
  // the Car Thing clock/time zone is not reliable: format the time here
  const d = new Date();
  const hh = (n: number) => (n < 10 ? "0" : "") + n;
  last = { checked: d.getTime(), checkedLabel: hh(d.getHours()) + ":" + hh(d.getMinutes()) + ":" + hh(d.getSeconds()), groups, problems, lang };
  DeskThing.send({ type: "homelab_status", payload: last });
  if (news.length) alert(news.length === 1 ? news[0] : t(lang, "nProblems", { n: news.length, list: news.slice(0, 3).join(", ") }));
}

let resend: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  if (timer) clearInterval(timer);
  poll();
  timer = setInterval(poll, POLL_MS);
  // repeat the last status: a reply to the client's first request can be lost
  if (!resend) resend = setInterval(() => DeskThing.send({ type: "homelab_status", payload: last }), 3000);
}

// ---------------------------------------------------------------- settings

function readSettings(settings: any) {
  if (!settings) return;
  for (const [id, s] of Object.entries(settings)) {
    const v = (s as any)?.value;
    if (typeof v === "string") config[id] = v.trim();
  }
}

DeskThing.on(DESKTHING_EVENTS.START, async () => {
  const before = (await DeskThing.getSettings()) as any;
  if (isLang(before?.language?.value)) lang = before.language.value;
  const settings: any = {};
  settings.language = {
    id: "language",
    label: t(lang, "setLanguage"),
    description: t(lang, "setLanguageDesc"),
    type: SETTING_TYPES.SELECT,
    value: lang,
    options: LANGUAGE_OPTIONS,
  };
  for (const core of CORES) {
    settings[core.id + "_url"] = { id: core.id + "_url", label: t(lang, "setUrl", { core: core.id }), type: SETTING_TYPES.STRING, value: core.url };
    settings[core.id + "_key"] = { id: core.id + "_key", label: t(lang, "setKey", { core: core.id }), type: SETTING_TYPES.STRING, value: "" };
    settings[core.id + "_secret"] = { id: core.id + "_secret", label: t(lang, "setSecret", { core: core.id }), type: SETTING_TYPES.STRING, value: "" };
  }
  settings.test_alert = {
    id: "test_alert",
    label: t(lang, "setTest"),
    description: t(lang, "setTestDesc"),
    type: SETTING_TYPES.BOOLEAN,
    value: false,
  };
  settings.ha_url = { id: "ha_url", label: t(lang, "setHa"), type: SETTING_TYPES.STRING, value: DEFAULT_HA };
  await DeskThing.initSettings(settings);
  const saved = (await DeskThing.getSettings()) as any;
  testAlert = saved?.test_alert?.value === true;
  readSettings(saved);
  startPolling();
});

let testAlert = false;

DeskThing.on(DESKTHING_EVENTS.SETTINGS, (data) => {
  const l = (data.payload as any)?.language?.value;
  if (isLang(l)) lang = l; // texts follow at the next poll; setting labels at next start
  const on = (data.payload as any)?.test_alert?.value === true;
  if (on && !testAlert) alert(t(lang, "testAlert"));
  testAlert = on;
  readSettings(data.payload);
  firstPoll = true; // new keys: do not raise alerts for the first round
  startPolling();
});

DeskThing.on(DESKTHING_EVENTS.GET, (data) => {
  if (data.request === "homelab_status") DeskThing.send({ type: "homelab_status", payload: last });
});

DeskThing.on(DESKTHING_EVENTS.STOP, () => {
  if (timer) clearInterval(timer);
  if (resend) clearInterval(resend);
  timer = resend = null;
});
