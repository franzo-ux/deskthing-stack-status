// User-facing strings, English (default) and Italian.
// Used by both the server (states, errors, settings labels) and the client.

export type Lang = "en" | "it";

const STRINGS = {
  en: {
    // stack states
    st_running: "running",
    st_stopped: "stopped",
    st_down: "down",
    st_dead: "dead",
    st_unhealthy: "unhealthy",
    st_deploying: "deploying…",
    st_restarting: "restarting…",
    st_created: "created",
    st_paused: "paused",
    st_removing: "removing…",
    st_unknown: "unknown",
    // errors / details
    badKey: "invalid API key",
    missingKey: "API key missing in settings",
    noReply: "not responding",
    noStacks: "none visible (permissions?)",
    serverDisabled: "disabled",
    serverUnreachable: "unreachable",
    online: "online",
    httpError: "error {n}",
    nProblems: "{n} problems: {list}",
    testAlert: "test alarm",
    // screen
    connecting: "connecting…",
    home: "home",
    lastCheck: "last check {time} · {n} running",
    problemFor: "!! {n} problem for {t}",
    problemsFor: "!! {n} problems for {t}",
    running: "{n} running",
    moreProblems: "… and {n} more problems",
    // settings
    setLanguage: "Language",
    setLanguageDesc: "Language of the app (setting labels change after restarting DeskThing)",
    setUrl: "{core} · URL",
    setKey: "{core} · API key",
    setSecret: "{core} · API secret",
    setHa: "Home Assistant · URL",
    setTest: "Test alarm",
    setTestDesc: "Turn it on to try the alert and the switch from Pi Status (then turn it off)",
  },
  it: {
    st_running: "attivo",
    st_stopped: "fermo",
    st_down: "giù",
    st_dead: "morto",
    st_unhealthy: "non sano",
    st_deploying: "deploy…",
    st_restarting: "riavvio…",
    st_created: "creato",
    st_paused: "in pausa",
    st_removing: "rimozione…",
    st_unknown: "sconosciuto",
    badKey: "chiave API non valida",
    missingKey: "manca la chiave API nelle impostazioni",
    noReply: "non risponde",
    noStacks: "nessuno visibile (permessi?)",
    serverDisabled: "disabilitato",
    serverUnreachable: "non raggiungibile",
    online: "online",
    httpError: "errore {n}",
    nProblems: "{n} problemi: {list}",
    testAlert: "allarme di prova",
    connecting: "collegamento…",
    home: "casa",
    lastCheck: "ultimo controllo {time} · {n} attivi",
    problemFor: "!! {n} problema da {t}",
    problemsFor: "!! {n} problemi da {t}",
    running: "{n} attivi",
    moreProblems: "… e altri {n} problemi",
    setLanguage: "Lingua",
    setLanguageDesc: "Lingua dell'app (le voci delle impostazioni cambiano dopo il riavvio di DeskThing)",
    setUrl: "{core} · indirizzo",
    setKey: "{core} · API key",
    setSecret: "{core} · API secret",
    setHa: "Home Assistant · indirizzo",
    setTest: "Allarme di prova",
    setTestDesc: "Attivalo per provare l'avviso e il passaggio da Pi Status (poi spegnilo)",
  },
};

export type Key = keyof typeof STRINGS.en;

export const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Italiano", value: "it" },
];

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "it";
}

/** Translate a key; {placeholders} are filled from vars. */
export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = (STRINGS[lang] || STRINGS.en)[key] || STRINGS.en[key];
  for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

/** Localized stack state ("running" -> "attivo"); unknown states pass through. */
export function stateLabel(lang: Lang, state: string): string {
  const key = ("st_" + state.toLowerCase()) as Key;
  return key in STRINGS.en ? t(lang, key) : state;
}
