/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * VeloCloud router pages for Cockpit: status, network, Wi-Fi, firewall.
 * The settings live in /etc/velocloud/router.json; velocloud-apply turns them
 * into the system configuration and undoes a change that is not confirmed
 * within ROLLBACK seconds.  Text coming from the system (DHCP host names,
 * Wi-Fi user names...) is only ever inserted as text, never as HTML.
 */
"use strict";
/* global cockpit */

const APPLY = "/usr/local/sbin/velocloud-apply";
const STATUS = "/usr/local/sbin/velocloud-status";
const WIFIUSER = "/usr/local/sbin/wifi-user";
const CONFIG = "/etc/velocloud/router.json";
const NEWCONFIG = "/run/velocloud/router.json.new";
const CA = "/etc/freeradius/3.0/certs/velocloud/ca.pem";
const ROLLBACK = 90;

const PORTS = [
    ["lan14", "LAN1-4"], ["lan58", "LAN5-8"], ["ge1", "GE1"],
    ["ge2", "GE2"], ["sfp1", "SFP1"], ["sfp2", "SFP2"],
];
const LABEL = Object.fromEntries(PORTS);

/* ------------------------------------------------------------ translations */

const IT = {
    "Router": "Router",
    "Status": "Stato",
    "Network": "Rete",
    "Wi-Fi": "Wi-Fi",
    "Firewall": "Firewall",
    "Ports": "Porte",
    "Internet": "Internet",
    "System": "Sistema",
    "online": "connesso",
    "offline": "non connesso",
    "Mode": "Modalità",
    "Port": "Porta",
    "Address": "Indirizzo",
    "Addresses": "Indirizzi",
    "Gateway": "Gateway",
    "DNS servers": "Server DNS",
    "Download": "Download",
    "Upload": "Upload",
    "Router address": "Indirizzo del router",
    "DHCP clients": "Client DHCP",
    "To devices": "Verso i dispositivi",
    "From devices": "Dai dispositivi",
    "off": "spento",
    "on": "acceso",
    "no card": "nessuna scheda",
    "Network name": "Nome della rete",
    "Channel": "Canale",
    "Transmit power": "Potenza di trasmissione",
    "Clients": "Client",
    "Uptime": "Acceso da",
    "Temperature": "Temperatura",
    "Memory": "Memoria",
    "Load": "Carico",
    "Kernel": "Kernel",
    "free": "libera",
    "of": "di",
    "Name": "Nome",
    "IP address": "Indirizzo IP",
    "MAC address": "Indirizzo MAC",
    "Lease": "Lease",
    "static": "fisso",
    "Make static": "Rendi fisso",
    "No devices": "Nessun dispositivo",
    "Wi-Fi clients": "Client Wi-Fi",
    "User": "Utente",
    "Signal": "Segnale",
    "Speed": "Velocità",
    "Connected": "Connesso da",
    "down": "scollegato",
    "up": "collegato",
    "unknown": "sconosciuto",
    "LAN": "LAN",
    "WAN": "WAN",
    "Off": "Spenta",
    "Internet (WAN)": "Internet (WAN)",
    "Port roles": "Ruolo delle porte",
    "Exactly one port connects to the Internet. LAN ports are bridged together and with the Wi-Fi.":
        "Una sola porta va verso Internet. Le porte LAN sono unite tra loro e con il Wi-Fi.",
    "Connection type": "Tipo di connessione",
    "Automatic (DHCP)": "Automatica (DHCP)",
    "Static address": "Indirizzo statico",
    "PPPoE (fibre/DSL with user name)": "PPPoE (fibra/ADSL con nome utente)",
    "VLAN": "VLAN",
    "0 = none. Many Italian fibre lines need 835 when the router connects directly to the ONT.":
        "0 = nessuna. Molte fibre italiane richiedono 835 se il router è collegato direttamente all'ONT.",
    "MTU": "MTU",
    "0 = automatic": "0 = automatico",
    "IPv6": "IPv6",
    "Use IPv6": "Usa IPv6",
    "Prefix length": "Lunghezza prefisso",
    "Separate several servers with spaces.": "Separa più server con spazi.",
    "Custom DNS servers": "Server DNS personalizzati",
    "Leave empty to use the provider's.": "Lascia vuoto per usare quelli del provider.",
    "PPPoE user": "Utente PPPoE",
    "PPPoE password": "Password PPPoE",
    "Local network (LAN)": "Rete locale (LAN)",
    "Router name": "Nome del router",
    "Local domain": "Dominio locale",
    "Give LAN devices IPv6 addresses from the provider's prefix": "Dai indirizzi IPv6 ai dispositivi LAN dal prefisso del provider",
    "DHCP server": "Server DHCP",
    "Hand out addresses": "Assegna gli indirizzi",
    "First address": "Primo indirizzo",
    "Last address": "Ultimo indirizzo",
    "Lease time (hours)": "Durata lease (ore)",
    "Fixed addresses": "Indirizzi fissi",
    "Add fixed address": "Aggiungi indirizzo fisso",
    "Remove": "Rimuovi",
    "Wireless network": "Rete wireless",
    "No Wi-Fi card found. Install a mini-PCIe card (for example a Qualcomm Atheros QCA988x) to use the Wi-Fi.":
        "Nessuna scheda Wi-Fi trovata. Installa una scheda mini-PCIe (per esempio una Qualcomm Atheros QCA988x) per usare il Wi-Fi.",
    "Wi-Fi on": "Wi-Fi acceso",
    "Hidden network": "Rete nascosta",
    "Band": "Banda",
    "The radio works on one band at a time.": "La radio lavora su una banda alla volta.",
    "Channel width": "Larghezza canale",
    "Wider is faster, narrower reaches further.": "Più larga è più veloce, più stretta arriva più lontano.",
    "Country": "Paese",
    "Sets the legal channels and power.": "Determina canali e potenza consentiti.",
    "Security": "Sicurezza",
    "Enterprise: a user name and password for each person": "Enterprise: nome utente e password per ogni persona",
    "Password: one password for everyone (WPA2/WPA3)": "Password: una password per tutti (WPA2/WPA3)",
    "Password": "Password",
    "Organization": "Organizzazione",
    "Name used in the security certificate.": "Nome usato nel certificato di sicurezza.",
    "Show": "Mostra",
    "Hide": "Nascondi",
    "Users": "Utenti",
    "Users are saved immediately, without Apply.": "Gli utenti vengono salvati subito, senza Applica.",
    "No users yet": "Nessun utente",
    "connected": "connesso",
    "User name": "Nome utente",
    "Repeat password": "Ripeti password",
    "Add user": "Aggiungi utente",
    "Delete user {0}?": "Eliminare l'utente {0}?",
    "The passwords differ": "Le password non coincidono",
    "Connecting devices": "Collegare i dispositivi",
    "EAP method": "Metodo EAP",
    "Phase 2": "Fase 2",
    "CA certificate": "Certificato CA",
    "Domain": "Dominio",
    "Identity": "Identità",
    "your user name": "il tuo nome utente",
    "Anonymous identity": "Identità anonima",
    "Install the CA certificate on the device (Android: Settings, Security, Install a certificate, Wi-Fi certificate). iPhone, Mac and Windows show the certificate on the first connection: check its fingerprint.":
        "Installa il certificato CA sul dispositivo (Android: Impostazioni, Sicurezza, Installa un certificato, Certificato Wi-Fi). iPhone, Mac e Windows mostrano il certificato al primo collegamento: controllane l'impronta.",
    "Fingerprint (SHA-256)": "Impronta (SHA-256)",
    "Server certificate valid until": "Certificato del server valido fino al",
    "The certificate is created when the Enterprise Wi-Fi is first applied.": "Il certificato viene creato la prima volta che si applica il Wi-Fi Enterprise.",
    "Access from the Internet": "Accesso da Internet",
    "Answer ping": "Rispondi al ping",
    "SSH": "SSH",
    "Web interface (this page)": "Interfaccia web (questa pagina)",
    "Opening the web interface or SSH to the Internet exposes the router: use strong passwords.":
        "Aprire l'interfaccia web o SSH verso Internet espone il router: usa password robuste.",
    "Port forwarding": "Port forwarding",
    "Forward ports from the Internet to a device in the LAN.": "Inoltra porte da Internet verso un dispositivo della LAN.",
    "On": "Attiva",
    "Protocol": "Protocollo",
    "External port": "Porta esterna",
    "Device": "Dispositivo",
    "Device port": "Porta dispositivo",
    "same": "uguale",
    "No rules": "Nessuna regola",
    "Add rule": "Aggiungi regola",
    "You have unsaved changes.": "Ci sono modifiche non applicate.",
    "Discard": "Annulla modifiche",
    "Apply": "Applica",
    "Applying…": "Applicazione in corso…",
    "Changes applied. Confirm them within {0} s, or the previous settings come back automatically.":
        "Modifiche applicate. Confermale entro {0} s, altrimenti tornano le impostazioni precedenti.",
    "Keep changes": "Mantieni le modifiche",
    "Undo now": "Annulla ora",
    "The settings were not applied:": "Le impostazioni non sono state applicate:",
    "Settings kept.": "Impostazioni confermate.",
    "Previous settings restored.": "Impostazioni precedenti ripristinate.",
    "The router address changes to {0}: after Apply open https://{0}/ within {1} s and confirm there.":
        "L'indirizzo del router diventa {0}: dopo Applica apri https://{0}/ entro {1} s e conferma lì.",
    "The connection was lost while applying. If you changed the router address, open https://{0}/ and confirm within {1} s; otherwise the previous settings come back automatically.":
        "La connessione si è interrotta durante l'applicazione. Se hai cambiato l'indirizzo del router apri https://{0}/ e conferma entro {1} s; altrimenti tornano automaticamente le impostazioni precedenti.",
    "Administrator access is needed for these settings.": "Per queste impostazioni serve l'accesso da amministratore.",
    "Cannot read the router status": "Impossibile leggere lo stato del router",
    "Download .crt": "Scarica .crt",
    "Download .der": "Scarica .der",
    "excellent": "ottimo",
    "good": "buono",
    "weak": "debole",
    "Save changes first, then add users.": "Applica prima le modifiche, poi aggiungi gli utenti.",
    "Front LED": "LED frontale",
    "Colour": "Colore",
    "Now showing": "Adesso mostra",
    "Always off": "Sempre spento",
    "The LED shows the colour while you choose; Apply keeps it.": "Il LED mostra il colore mentre scegli; Applica lo mantiene.",
    "Turn off at night": "Spegni di notte",
    "Off at": "Spento alle",
    "On again at": "Riacceso alle",
    "The logo LED was not found (it needs the velocloud-igb driver on a VeloCloud Edge 520).":
        "Il LED del logo non è stato trovato (serve il driver velocloud-igb su un VeloCloud Edge 520).",
    "green": "verde",
    "cyan": "azzurro",
    "blue": "blu",
    "purple": "viola",
    "red": "rosso",
    "orange": "arancione",
    "yellow": "giallo",
    "white": "bianco",
    // messages from velocloud-apply
    "exactly one port must be the WAN": "una e una sola porta deve essere la WAN",
    "at least one port must be in the LAN": "almeno una porta deve essere nella LAN",
    "not a valid IPv4 address": "non è un indirizzo IPv4 valido",
    "must be true or false": "deve essere sì o no",
    "letters, digits and '-' only, up to 63 characters": "solo lettere, cifre e '-', fino a 63 caratteri",
    "role must be lan, wan or off": "il ruolo deve essere LAN, WAN o spenta",
    "prefix must be between 8 and 30": "il prefisso deve essere tra 8 e 30",
    "the router needs a host address, not the network or broadcast address": "il router deve avere un indirizzo host, non quello di rete o di broadcast",
    "use a private address range (10.x, 172.16-31.x, 192.168.x)": "usa un intervallo privato (10.x, 172.16-31.x, 192.168.x)",
    "lower-case letters, digits and '-' only": "solo lettere minuscole, cifre e '-'",
    "the DHCP range must be inside the LAN subnet": "il range DHCP deve stare nella subnet LAN",
    "the range start must come before its end": "l'inizio del range deve venire prima della fine",
    "the range must not contain the router address": "il range non deve contenere l'indirizzo del router",
    "lease time must be 1-168 hours": "la durata deve essere 1-168 ore",
    "MAC address must look like aa:bb:cc:dd:ee:ff": "il MAC deve avere la forma aa:bb:cc:dd:ee:ff",
    "the address must be in the LAN subnet and not the router's": "l'indirizzo deve stare nella LAN e non essere quello del router",
    "address used twice": "indirizzo usato due volte",
    "letters, digits and '-' only": "solo lettere, cifre e '-'",
    "mode must be dhcp, static or pppoe": "la modalità deve essere DHCP, statica o PPPoE",
    "VLAN must be 0 (none) or 1-4094": "la VLAN deve essere 0 (nessuna) o 1-4094",
    "MTU must be 0 (automatic) or 576-9000": "l'MTU deve essere 0 (automatico) o 576-9000",
    "prefix must be 1-32": "il prefisso deve essere 1-32",
    "the gateway must be inside the WAN subnet": "il gateway deve stare nella subnet WAN",
    "the WAN subnet overlaps the LAN subnet": "la subnet WAN si sovrappone alla LAN",
    "give at least one DNS server": "indica almeno un server DNS",
    "PPPoE needs a user name": "il PPPoE richiede un nome utente",
    "quotes, backslashes and new lines are not allowed": "virgolette, backslash e a capo non sono ammessi",
    "the network name needs 1-32 bytes": "il nome della rete deve avere 1-32 byte",
    "two-letter country code, e.g. IT": "codice paese di due lettere, per esempio IT",
    "band must be 2 (2.4 GHz) or 5 (5 GHz)": "la banda deve essere 2,4 o 5 GHz",
    "width must be 20 or 40 MHz (2.4 GHz) or 20/40/80 MHz (5 GHz)": "larghezza 20 o 40 MHz (2,4 GHz) o 20/40/80 MHz (5 GHz)",
    "channel must be a number": "il canale deve essere un numero",
    "no 80 MHz block for this channel": "nessun blocco da 80 MHz per questo canale",
    "security must be enterprise or psk": "la sicurezza deve essere Enterprise o password",
    "the password needs 8-63 characters": "la password deve avere 8-63 caratteri",
    "new lines are not allowed": "gli a capo non sono ammessi",
    "letters, digits, spaces, '.', '_' and '-' only": "solo lettere, cifre, spazi, '.', '_' e '-'",
    "protocol must be tcp, udp or tcp+udp": "il protocollo deve essere tcp, udp o tcp+udp",
    "port must be 1-65535 or a range like 8000-8010": "la porta deve essere 1-65535 o un intervallo come 8000-8010",
    "the destination must be a LAN device, not the router": "la destinazione deve essere un dispositivo della LAN, non il router",
    "destination port must be 1-65535": "la porta di destinazione deve essere 1-65535",
    "a destination port only works with a single port": "la porta di destinazione funziona solo con una porta singola",
    "letters, digits, spaces, '.', '_' and '-' only, up to 40": "solo lettere, cifre, spazi, '.', '_' e '-', fino a 40",
    "invalid user name": "nome utente non valido",
    "the password needs at least 8 characters": "la password deve avere almeno 8 caratteri",
    "colour must look like #00ff00": "il colore deve avere la forma #00ff00",
    "time must look like 22:00": "l'orario deve avere la forma 22:00",
    "the LED must come back on at a different time": "il LED deve riaccendersi a un orario diverso",
};
const IT_PATTERNS = [
    [/^channel not usable here: (.*)$/, "canale non utilizzabile qui: $1"],
    [/^(tcp|udp) (\d+) is already forwarded by rule (\d+)$/, "$1 $2 è già inoltrata dalla regola $3"],
    [/^cannot read: (.*)$/, "impossibile leggere: $1"],
    [/^invalid user name: (.*)$/, "nome utente non valido: $1"],
    [/^apply failed, previous configuration restored: (.*)$/, "applicazione fallita, configurazione precedente ripristinata: $1"],
];

const LANG = (cockpit.language || navigator.language || "en").toLowerCase();
const ITALIAN = LANG.startsWith("it");

function _(s, ...args) {
    let t = (ITALIAN && IT[s]) || s;
    if (ITALIAN && !IT[s]) {
        for (const [re, rep] of IT_PATTERNS)
            if (re.test(s)) { t = s.replace(re, rep); break; }
    }
    return t.replace(/\{(\d)\}/g, (m, i) => String(args[i]));
}

/* ------------------------------------------------------------ theme */

function setTheme(style) {
    style = style || localStorage.getItem("shell:style") || "auto";
    const dark = style === "dark" ||
        (style === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("vc-dark", dark);
}
window.addEventListener("storage", e => { if (e.key === "shell:style") setTheme(); });
window.addEventListener("cockpit-style", e => { if (e instanceof CustomEvent) setTheme(e.detail.style); });
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTheme());
setTheme();

/* ------------------------------------------------------------ helpers */

function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else if (k === "class") el.className = v;
        else if (k === "value") el.value = v;
        else if (k === "checked") el.checked = v;
        else if (k === "disabled") el.disabled = v;
        else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity))
        if (c !== null && c !== undefined && c !== false)
            el.append(c instanceof Node ? c : String(c));
    return el;
}

const clone = o => JSON.parse(JSON.stringify(o));

function get(obj, path) {
    return path.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

function set(obj, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
}

function bytes(n) {
    const u = ["B", "KiB", "MiB", "GiB", "TiB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function rate(bps) {
    if (bps === undefined || bps === null) return "–";
    if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e8 ? 0 : 1)} Mbit/s`;
    return `${(bps / 1e3).toFixed(0)} kbit/s`;
}

function duration(s) {
    if (s === null || s === undefined) return "–";
    const d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return `${d} d ${hh} h`;
    if (hh) return `${hh} h ${m} min`;
    return `${m} min`;
}

function ip2int(s) {
    const p = String(s).split(".").map(Number);
    return p.length === 4 && p.every(x => x >= 0 && x <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
}

/* ------------------------------------------------------------ state */

const S = {
    saved: null,		// router.json as on disk
    cfg: null,		// edited copy
    status: null,
    prev: null,
    rates: {},
    errors: [],
    tab: "status",
    busy: false,
    notice: null,		// {kind, text}
    users: null,
    radius: {},
    showPsk: false,
    newUser: { name: "", pw: "", pw2: "" },
    channels: {},		// channels the radio may use, per band
};

/* ------------------------------------------------------------ backend */

function run(args, input) {
    return new Promise((resolve, reject) => {
        const p = cockpit.spawn(args, { superuser: "require", err: "message" });
        if (input !== undefined)
            p.input(input);
        p.then(out => resolve({ code: 0, out }))
            .catch((ex, out) => {
                if (ex && ex.exit_status !== undefined && ex.exit_status !== null)
                    resolve({ code: ex.exit_status, out: out || "", msg: ex.message });
                else
                    reject(ex);
            });
    });
}

// settings added by newer versions are missing from an older router.json:
// fill them in from the defaults, as velocloud-apply does
function withDefaults(def, cfg) {
    const out = clone(def);
    for (const [k, v] of Object.entries(cfg || {}))
        out[k] = v && typeof v === "object" && !Array.isArray(v) && def[k] && typeof def[k] === "object" && !Array.isArray(def[k])
            ? withDefaults(def[k], v) : v;
    return out;
}

async function loadConfig() {
    const cfg = await cockpit.file(CONFIG, { syntax: JSON, superuser: "require" }).read();
    const r = await run([APPLY, "--defaults"]);
    const merged = withDefaults(JSON.parse(r.out), cfg);
    S.saved = merged;
    S.cfg = clone(merged);
}

async function pollStatus() {
    if (document.hidden) return;
    try {
        const r = await run([STATUS]);
        const st = JSON.parse(r.out);
        S.prev = S.status;
        S.status = st;
        computeRates();
    } catch (e) {
        S.status = null;
    }
    renderBanner();
    if (S.tab === "status") renderBody();
}

function computeRates() {
    const a = S.prev, b = S.status;
    S.rates = {};
    if (!a || !b) return;
    const dt = b.time - a.time;
    if (dt <= 0) return;
    const r = (x, y) => (x && y ? { rx: Math.max(y.rx_bytes - x.rx_bytes, 0) * 8 / dt, tx: Math.max(y.tx_bytes - x.tx_bytes, 0) * 8 / dt } : null);
    S.rates.wan = r(a.wan.counters, b.wan.counters);
    S.rates.lan = r(a.lan.counters, b.lan.counters);
}

async function loadUsers() {
    const r = await run([WIFIUSER, "list"]).catch(() => null);
    S.users = r && r.code === 0 ? r.out.split("\n").filter(Boolean) : [];
}

async function loadRadius() {
    const r = await run([STATUS, "--radius"]).catch(() => null);
    try { S.radius = r ? JSON.parse(r.out) : {} } catch (e) { S.radius = {} }
}

function errorsOf(res) {
    return (res.errors || []).map(e => ({ path: e.path, msg: _(e.msg) }));
}

async function applyChanges() {
    const newLan = S.cfg.lan.address;
    const oldLan = S.saved.lan.address;
    S.busy = true;
    S.errors = [];
    S.notice = null;
    renderAll();
    try {
        await cockpit.file(NEWCONFIG, { syntax: JSON, superuser: "require" }).replace(S.cfg);
        const r = await run([APPLY, "--set", NEWCONFIG, "--rollback-after", String(ROLLBACK)]);
        let res;
        try { res = JSON.parse(r.out) } catch (e) { res = { ok: false, errors: [{ path: "", msg: r.msg || r.out }] } }
        if (res.ok) {
            await loadConfig();
            if (S.status)
                S.status.pending_until = res.pending_until;
        } else {
            S.errors = errorsOf(res);
        }
    } catch (e) {
        S.notice = { kind: "danger", text: _("The connection was lost while applying. If you changed the router address, open https://{0}/ and confirm within {1} s; otherwise the previous settings come back automatically.", newLan !== oldLan ? newLan : oldLan, ROLLBACK) };
    }
    S.busy = false;
    renderAll();
    pollStatus();
}

async function confirmChanges() {
    await run([APPLY, "--confirm"]);
    S.notice = { kind: "info", text: _("Settings kept.") };
    await pollStatus();
    renderAll();
}

async function undoChanges() {
    S.busy = true;
    renderAll();
    await run([APPLY, "--rollback"]).catch(() => null);
    await loadConfig();
    S.busy = false;
    S.notice = { kind: "info", text: _("Previous settings restored.") };
    await pollStatus();
    renderAll();
}

/* ------------------------------------------------------------ form controls */

function changed() {
    renderBar();
}

function errFor(path) {
    const e = S.errors.find(x => x.path === path);
    return e ? e.msg : null;
}

function input(path, opts = {}) {
    const type = opts.type || "text";
    let v = get(S.cfg, path);
    if (opts.list) v = (v || []).join(" ");
    const el = h("input", {
        type, value: v === undefined || v === null ? "" : v, placeholder: opts.placeholder,
        min: opts.min, max: opts.max, autocomplete: "off", spellcheck: "false",
    });
    el.addEventListener("input", () => {
        let val = el.value;
        if (opts.number) val = val === "" ? 0 : parseInt(val, 10);
        if (opts.list) val = val.split(/[\s,]+/).filter(Boolean);
        if (opts.upper) { val = val.toUpperCase(); el.value = val }
        set(S.cfg, path, val);
        changed();
    });
    return el;
}

function checkbox(path, label, rerender) {
    const id = "c-" + path.replace(/\W/g, "-");
    return h("div", { class: "vc-check" },
        h("input", {
            type: "checkbox", id, checked: !!get(S.cfg, path),
            onchange: e => { set(S.cfg, path, e.target.checked); changed(); if (rerender) renderBody() },
        }),
        h("label", { for: id }, label));
}

function select(path, options, opts = {}) {
    const cur = get(S.cfg, path);
    const el = h("select", {},
        options.map(([v, l]) => h("option", { value: String(v), selected: String(v) === String(cur) }, l)));
    el.addEventListener("change", () => {
        const val = opts.number ? parseInt(el.value, 10) : el.value;
        set(S.cfg, path, val);
        if (opts.onchange) opts.onchange(val);
        changed();
        if (opts.rerender) renderBody();
    });
    return el;
}

function row(label, path, control, help) {
    const err = path ? errFor(path) : null;
    return [
        h("label", {}, label),
        h("div", { class: "vc-field" + (err ? " invalid" : "") }, control,
            help ? h("div", { class: "vc-help" }, help) : null,
            err ? h("div", { class: "vc-error" }, err) : null),
    ];
}

function cell(path, control) {
    return h("td", { class: errFor(path) ? "invalid" : "", title: errFor(path) || null }, control);
}

/* ------------------------------------------------------------ rendering */

const app = document.getElementById("app");
const R = {};

function renderAll() {
    if (!R.head) {
        app.className = "";
        app.replaceChildren(
            R.head = h("div"), R.banner = h("div"), R.tabs = h("div"), R.body = h("div"), R.bar = h("div"));
    }
    renderHead();
    renderBanner();
    renderTabs();
    renderBody();
    renderBar();
}

function renderHead() {
    const st = S.status;
    R.head.replaceChildren(h("div", { class: "vc-title" },
        h("h1", {}, _("Router")),
        h("span", { class: "vc-sub" }, st ? st.system.hostname : "")));
}

function renderBanner() {
    if (!R.banner) return;
    const out = [];
    const until = S.status && S.status.pending_until;
    if (until) {
        const left = Math.max(Math.round(until - Date.now() / 1000), 0);
        out.push(h("div", { class: "vc-alert warn" },
            h("div", {}, _("Changes applied. Confirm them within {0} s, or the previous settings come back automatically.", left)),
            h("div", { class: "vc-inline" },
                h("button", { class: "vc-btn", onclick: confirmChanges, disabled: S.busy }, _("Keep changes")),
                h("button", { class: "vc-btn secondary", onclick: undoChanges, disabled: S.busy }, _("Undo now")))));
    }
    if (S.errors.length)
        out.push(h("div", { class: "vc-alert danger" },
            h("div", {}, _("The settings were not applied:"),
                h("ul", {}, S.errors.map(e => h("li", {}, e.path ? `${e.path}: ${e.msg}` : e.msg))))));
    if (S.notice)
        out.push(h("div", { class: "vc-alert " + S.notice.kind }, h("div", {}, S.notice.text),
            h("button", { class: "vc-btn link", onclick: () => { S.notice = null; renderBanner() } }, "✕")));
    R.banner.replaceChildren(...out);
}

function renderTabs() {
    const tabs = [["status", _("Status")], ["network", _("Network")], ["wifi", _("Wi-Fi")], ["firewall", _("Firewall")], ["led", "LED"]];
    R.tabs.replaceChildren(h("div", { class: "vc-tabs" }, tabs.map(([id, label]) =>
        h("button", {
            class: S.tab === id ? "active" : "",
            onclick: () => { S.tab = id; renderTabs(); renderBody(); if (id === "wifi") { loadUsers().then(renderBody); loadRadius().then(renderBody) } },
        }, label))));
}

function renderBody() {
    if (!R.body) return;
    const view = { status: viewStatus, network: viewNetwork, wifi: viewWifi, firewall: viewFirewall, led: viewLed }[S.tab];
    // keep the focused field focused when a form is redrawn
    const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    R.body.replaceChildren(view());
    if (focus) {
        const el = R.body.querySelector(`[data-key="${CSS.escape(focus)}"]`);
        if (el) el.focus();
    }
}

function dirty() {
    return S.cfg && S.saved && JSON.stringify(S.cfg) !== JSON.stringify(S.saved);
}

function renderBar() {
    if (!R.bar) return;
    if (!dirty() && !S.busy) { R.bar.replaceChildren(); return }
    let text = _("You have unsaved changes.");
    if (S.cfg.lan.address !== S.saved.lan.address)
        text = _("The router address changes to {0}: after Apply open https://{0}/ within {1} s and confirm there.", S.cfg.lan.address, ROLLBACK);
    if (S.busy) text = _("Applying…");
    R.bar.replaceChildren(h("div", { class: "vc-bar" },
        h("div", { class: "vc-bar-text" }, text),
        h("button", { class: "vc-btn secondary", disabled: S.busy, onclick: () => { S.cfg = clone(S.saved); S.errors = []; run([LEDCMD, "now"]).catch(() => null); renderAll() } }, _("Discard")),
        h("button", { class: "vc-btn", disabled: S.busy, onclick: applyChanges }, _("Apply"))));
}

/* ---------------- status */

function jack(name, role, link, speed) {
    let cls = "vc-jack " + role;
    let state;
    if (role === "off") state = _("off");
    else if (link === null) state = _("unknown");
    else if (link) { cls += " up"; state = speed >= 1000 ? `${speed / 1000} G` : speed > 0 ? `${speed} M` : _("up") }
    else state = _("down");
    return h("div", { class: cls },
        h("div", { class: "vc-jack-name" }, name),
        h("div", { class: "vc-jack-state" }, state),
        h("div", { class: "vc-jack-role" }, role === "wan" ? _("WAN") : role === "lan" ? _("LAN") : "–"));
}

function frontPanel(st) {
    const roles = S.saved.ports;
    const lanJacks = (first, dev) => [0, 1, 2, 3].map(i => {
        const n = `LAN${first + i}`;
        const j = st.jacks[n];
        return jack(n, roles[dev], j ? j.link : null, j ? j.speed : 0);
    });
    const devJack = dev => {
        const p = st.ports[dev];
        return jack(LABEL[dev], roles[dev], p ? p.carrier : null, p ? p.speed : 0);
    };
    return h("div", { class: "vc-panel" },
        h("div", { class: "vc-group" }, h("div", { class: "vc-group-label" }, "GE"), h("div", { class: "vc-group-jacks" }, devJack("ge1"), devJack("ge2"))),
        h("div", { class: "vc-group" }, h("div", { class: "vc-group-label" }, "LAN1-4"), h("div", { class: "vc-group-jacks" }, lanJacks(1, "lan14"))),
        h("div", { class: "vc-group" }, h("div", { class: "vc-group-label" }, "LAN5-8"), h("div", { class: "vc-group-jacks" }, lanJacks(5, "lan58"))),
        h("div", { class: "vc-group" }, h("div", { class: "vc-group-label" }, "SFP"), h("div", { class: "vc-group-jacks" }, devJack("sfp1"), devJack("sfp2"))));
}

function kv(pairs) {
    return h("dl", { class: "vc-kv" }, pairs.filter(Boolean).map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

function signal(dbm) {
    if (dbm === null || dbm === undefined) return "–";
    const q = dbm >= -60 ? ["ok", _("excellent")] : dbm >= -70 ? ["warn", _("good")] : ["bad", _("weak")];
    return h("span", {}, `${dbm} dBm `, h("span", { class: "vc-badge " + q[0] }, q[1]));
}

function viewStatus() {
    const st = S.status;
    if (!st) return h("div", { class: "vc-card" }, _("Cannot read the router status"));
    const wan = st.wan, w = st.wifi, sys = st.system;
    const statics = new Set((S.saved.lan.dhcp.static || []).map(x => x.mac.toLowerCase()));
    const modeName = { dhcp: _("Automatic (DHCP)"), static: _("Static address"), pppoe: "PPPoE" }[wan.mode] || wan.mode;

    return h("div", {},
        h("div", { class: "vc-card" }, h("h2", {}, _("Ports")), frontPanel(st)),
        h("div", { class: "vc-grid" },
            h("div", { class: "vc-card" },
                h("h2", {}, _("Internet"), " ", h("span", { class: "vc-badge " + (wan.online ? "ok" : "bad") }, wan.online ? _("online") : _("offline"))),
                kv([
                    [_("Mode"), modeName],
                    [_("Port"), LABEL[wan.port] + (wan.dev !== wan.port ? ` (${wan.dev})` : "")],
                    [_("Addresses"), wan.addresses.length ? wan.addresses.join(", ") : "–"],
                    [_("Gateway"), wan.gateway || "–"],
                    [_("DNS servers"), wan.dns.length ? wan.dns.join(", ") : "–"],
                    [_("Download"), rate(S.rates.wan && S.rates.wan.rx)],
                    [_("Upload"), rate(S.rates.wan && S.rates.wan.tx)],
                ])),
            h("div", { class: "vc-card" },
                h("h2", {}, _("LAN")),
                kv([
                    [_("Router address"), st.lan.addresses.join(", ") || "–"],
                    [_("DHCP clients"), String(st.leases.length)],
                    [_("To devices"), rate(S.rates.lan && S.rates.lan.tx)],
                    [_("From devices"), rate(S.rates.lan && S.rates.lan.rx)],
                ])),
            h("div", { class: "vc-card" },
                h("h2", {}, _("Wi-Fi"), " ", h("span", { class: "vc-badge " + (w.running ? "ok" : "") }, !w.present ? _("no card") : w.running ? _("on") : _("off"))),
                w.present && w.running ? kv([
                    [_("Network name"), S.saved.wifi.ssid],
                    [_("Channel"), w.channel ? `${w.channel} (${w.freq} MHz, ${w.width} MHz)` : "–"],
                    [_("Transmit power"), w.txpower ? `${w.txpower} dBm` : "–"],
                    [_("Clients"), String(w.clients.length)],
                ]) : null),
            h("div", { class: "vc-card" },
                h("h2", {}, _("System")),
                kv([
                    [_("Uptime"), duration(sys.uptime)],
                    [_("Temperature"), sys.temp !== null ? `${sys.temp.toFixed(0)} °C` : "–"],
                    [_("Memory"), `${bytes(sys.mem_available)} ${_("free")} ${_("of")} ${bytes(sys.mem_total)}`],
                    [_("Load"), sys.load.map(x => x.toFixed(2)).join(" ")],
                    [_("Kernel"), sys.kernel],
                ]))),
        h("div", { class: "vc-card" },
            h("h2", {}, _("DHCP clients")),
            st.leases.length ? h("table", { class: "vc-table" },
                h("thead", {}, h("tr", {}, [_("Name"), _("IP address"), _("MAC address"), _("Lease"), ""].map(t => h("th", {}, t)))),
                h("tbody", {}, st.leases.map(l => h("tr", {},
                    h("td", {}, l.name || "–"),
                    h("td", {}, l.ip),
                    h("td", { class: "vc-mono" }, l.mac),
                    h("td", {}, statics.has(l.mac.toLowerCase()) ? _("static") : duration(l.expires_in)),
                    h("td", {}, statics.has(l.mac.toLowerCase()) ? "" : h("button", {
                        class: "vc-btn link",
                        onclick: () => {
                            S.cfg.lan.dhcp.static.push({ mac: l.mac, ip: l.ip, name: (l.name || "").replace(/[^A-Za-z0-9-]/g, "-").slice(0, 63) });
                            S.tab = "network"; renderTabs(); renderBody(); renderBar();
                        },
                    }, _("Make static"))))))) : h("div", { class: "vc-empty" }, _("No devices"))),
        w.present && w.running ? h("div", { class: "vc-card" },
            h("h2", {}, _("Wi-Fi clients")),
            w.clients.length ? h("table", { class: "vc-table" },
                h("thead", {}, h("tr", {}, [_("User"), _("MAC address"), _("Signal"), _("Speed"), _("Connected")].map(t => h("th", {}, t)))),
                h("tbody", {}, w.clients.map(c => h("tr", {},
                    h("td", {}, c.user || "–"),
                    h("td", { class: "vc-mono" }, c.mac),
                    h("td", {}, signal(c.signal)),
                    h("td", {}, `↓ ${c.tx_rate || "–"} / ↑ ${c.rx_rate || "–"} Mbit/s`),
                    h("td", {}, duration(c.connected)))))) : h("div", { class: "vc-empty" }, _("No devices"))) : null);
}

/* ---------------- network */

function viewNetwork() {
    const c = S.cfg;
    const wan = c.wan;
    const roleOpts = [["lan", _("LAN")], ["wan", _("Internet (WAN)")], ["off", _("Off")]];
    const prefixes = [16, 20, 21, 22, 23, 24, 25, 26, 27, 28].map(p => [p, `/${p}`]);
    const dh = c.lan.dhcp;
    return h("div", {},
        h("div", { class: "vc-card" },
            h("h2", {}, _("Port roles")),
            h("p", { class: "vc-help" }, _("Exactly one port connects to the Internet. LAN ports are bridged together and with the Wi-Fi.")),
            h("div", { class: "vc-roles" }, PORTS.map(([dev, label]) =>
                h("div", { class: "vc-role" }, h("span", {}, label), select("ports." + dev, roleOpts)))),
            errFor("ports") ? h("div", { class: "vc-error" }, errFor("ports")) : null),
        h("div", { class: "vc-card" },
            h("h2", {}, _("Internet (WAN)")),
            h("div", { class: "vc-form" },
                row(_("Connection type"), "wan.mode", select("wan.mode",
                    [["dhcp", _("Automatic (DHCP)")], ["static", _("Static address")], ["pppoe", _("PPPoE (fibre/DSL with user name)")]],
                    { rerender: true })),
                wan.mode === "static" ? [
                    row(_("Address"), "wan.address", input("wan.address", { placeholder: "203.0.113.10" })),
                    row(_("Prefix length"), "wan.prefix", input("wan.prefix", { type: "number", number: true, min: 1, max: 32 })),
                    row(_("Gateway"), "wan.gateway", input("wan.gateway", { placeholder: "203.0.113.1" })),
                    row(_("DNS servers"), "wan.dns", input("wan.dns", { list: true, placeholder: "1.1.1.1 9.9.9.9" }), _("Separate several servers with spaces.")),
                ] : [
                    wan.mode === "pppoe" ? [
                        row(_("PPPoE user"), "wan.pppoe_user", input("wan.pppoe_user")),
                        row(_("PPPoE password"), "wan.pppoe_password", input("wan.pppoe_password", { type: "password" })),
                    ] : null,
                    row(_("Custom DNS servers"), "wan.dns", input("wan.dns", { list: true, placeholder: "1.1.1.1 9.9.9.9" }), _("Leave empty to use the provider's.")),
                ],
                row(_("VLAN"), "wan.vlan", input("wan.vlan", { type: "number", number: true, min: 0, max: 4094 }),
                    _("0 = none. Many Italian fibre lines need 835 when the router connects directly to the ONT.")),
                row(_("MTU"), "wan.mtu", input("wan.mtu", { type: "number", number: true, min: 0, max: 9000 }), _("0 = automatic")),
                row(_("IPv6"), "wan.ipv6", checkbox("wan.ipv6", _("Use IPv6"))))),
        h("div", { class: "vc-card" },
            h("h2", {}, _("Local network (LAN)")),
            h("div", { class: "vc-form" },
                row(_("Router name"), "hostname", input("hostname")),
                row(_("Router address"), "lan.address", input("lan.address")),
                row(_("Prefix length"), "lan.prefix", select("lan.prefix", prefixes, { number: true })),
                row(_("Local domain"), "lan.domain", input("lan.domain")),
                row(_("IPv6"), "lan.ipv6", checkbox("lan.ipv6", _("Give LAN devices IPv6 addresses from the provider's prefix"))))),
        h("div", { class: "vc-card" },
            h("h2", {}, _("DHCP server")),
            h("div", { class: "vc-form" },
                row("", "lan.dhcp.enabled", checkbox("lan.dhcp.enabled", _("Hand out addresses"), true)),
                dh.enabled ? [
                    row(_("First address"), "lan.dhcp.start", input("lan.dhcp.start")),
                    row(_("Last address"), "lan.dhcp.end", input("lan.dhcp.end")),
                    row(_("Lease time (hours)"), "lan.dhcp.lease_hours", input("lan.dhcp.lease_hours", { type: "number", number: true, min: 1, max: 168 })),
                ] : null,
                errFor("lan.dhcp") ? row("", null, h("div", { class: "vc-error" }, errFor("lan.dhcp"))) : null),
            h("h3", {}, _("Fixed addresses")),
            dh.static.length ? h("table", { class: "vc-table" },
                h("thead", {}, h("tr", {}, [_("Name"), _("MAC address"), _("IP address"), ""].map(t => h("th", {}, t)))),
                h("tbody", {}, dh.static.map((s, i) => h("tr", {},
                    cell(`lan.dhcp.static.${i}.name`, input(`lan.dhcp.static.${i}.name`)),
                    cell(`lan.dhcp.static.${i}.mac`, input(`lan.dhcp.static.${i}.mac`, { placeholder: "aa:bb:cc:dd:ee:ff" })),
                    cell(`lan.dhcp.static.${i}.ip`, input(`lan.dhcp.static.${i}.ip`)),
                    h("td", {}, h("button", { class: "vc-btn link", onclick: () => { dh.static.splice(i, 1); renderBody(); changed() } }, _("Remove"))))))) : null,
            h("button", {
                class: "vc-btn secondary",
                onclick: () => { dh.static.push({ mac: "", ip: "", name: "" }); renderBody(); changed() },
            }, _("Add fixed address"))));
}

/* ---------------- Wi-Fi */

const FALLBACK_CHANNELS = { 2: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], 5: [36, 40, 44, 48] };

function wifiChannels(band) {
    const ch = S.channels[band];
    return ch && ch.length ? ch : FALLBACK_CHANNELS[band];
}

function viewWifi() {
    const w = S.cfg.wifi;
    const st = S.status && S.status.wifi;
    const out = [];
    if (st && !st.present)
        out.push(h("div", { class: "vc-alert info" }, _("No Wi-Fi card found. Install a mini-PCIe card (for example a Qualcomm Atheros QCA988x) to use the Wi-Fi.")));
    const widths = w.band === "5" ? [[80, "80 MHz"], [40, "40 MHz"], [20, "20 MHz"]] : [[40, "40 MHz"], [20, "20 MHz"]];
    out.push(h("div", { class: "vc-card" },
        h("h2", {}, _("Wireless network")),
        h("div", { class: "vc-form" },
            row("", "wifi.enabled", checkbox("wifi.enabled", _("Wi-Fi on"))),
            row(_("Network name"), "wifi.ssid", input("wifi.ssid")),
            row("", "wifi.hidden", checkbox("wifi.hidden", _("Hidden network"))),
            row(_("Band"), "wifi.band", select("wifi.band", [["5", "5 GHz (802.11ac)"], ["2", "2.4 GHz (802.11n)"]], {
                rerender: true,
                onchange: b => {
                    const ch = wifiChannels(b);
                    if (!ch.includes(w.channel)) w.channel = b === "5" ? (ch.includes(36) ? 36 : ch[0]) : (ch.includes(6) ? 6 : ch[0]);
                    if (b === "2" && w.width === 80) w.width = 20;
                },
            }), _("The radio works on one band at a time.")),
            row(_("Channel"), "wifi.channel", select("wifi.channel", wifiChannels(w.band).map(c => [c, String(c)]), { number: true })),
            row(_("Channel width"), "wifi.width", select("wifi.width", widths, { number: true }), _("Wider is faster, narrower reaches further.")),
            row(_("Country"), "wifi.country", input("wifi.country", { placeholder: "IT", upper: true }), _("Sets the legal channels and power.")),
            row(_("Security"), "wifi.security", select("wifi.security", [
                ["enterprise", _("Enterprise: a user name and password for each person")],
                ["psk", _("Password: one password for everyone (WPA2/WPA3)")],
            ], { rerender: true })),
            w.security === "psk" ? row(_("Password"), "wifi.psk", h("div", { class: "vc-inline" },
                Object.assign(input("wifi.psk", { type: S.showPsk ? "text" : "password" }), { className: "vc-grow" }),
                h("button", { class: "vc-btn link", onclick: () => { S.showPsk = !S.showPsk; renderBody() } }, S.showPsk ? _("Hide") : _("Show"))))
                : row(_("Organization"), "wifi.org", input("wifi.org"), _("Name used in the security certificate.")))));
    if (w.security === "enterprise" && S.saved.wifi.security === "enterprise") {
        out.push(viewUsers(st));
        out.push(viewConnect());
    }
    return h("div", {}, out);
}

function viewUsers(st) {
    const online = new Set(((st && st.clients) || []).map(c => c.user).filter(Boolean));
    const nu = S.newUser;
    const msg = nu.error ? h("div", { class: "vc-error" }, nu.error) : null;
    const field = (key, type, ph) => {
        const el = h("input", { type, value: nu[key], placeholder: ph, autocomplete: "new-password", "data-key": "nu-" + key });
        el.addEventListener("input", () => { nu[key] = el.value });
        return el;
    };
    return h("div", { class: "vc-card" },
        h("h2", {}, _("Users")),
        h("p", { class: "vc-help" }, _("Users are saved immediately, without Apply.")),
        S.users === null ? h("div", { class: "vc-empty" }, "…") :
            S.users.length ? h("table", { class: "vc-table" },
                h("tbody", {}, S.users.map(u => h("tr", {},
                    h("td", {}, u, " ", online.has(u) ? h("span", { class: "vc-badge ok" }, _("connected")) : null),
                    h("td", { class: "vc-right" }, h("button", {
                        class: "vc-btn link",
                        onclick: async () => {
                            if (!window.confirm(_("Delete user {0}?", u))) return;
                            await run([WIFIUSER, "del", u]);
                            await loadUsers();
                            renderBody();
                        },
                    }, _("Remove"))))))) : h("div", { class: "vc-empty" }, _("No users yet")),
        h("h3", {}, _("Add user")),
        h("div", { class: "vc-inline" },
            field("name", "text", _("User name")),
            field("pw", "password", _("Password")),
            field("pw2", "password", _("Repeat password")),
            h("button", {
                class: "vc-btn",
                onclick: async () => {
                    nu.error = null;
                    if (nu.pw !== nu.pw2) { nu.error = _("The passwords differ"); renderBody(); return }
                    const r = await run([WIFIUSER, "add", nu.name.trim()], nu.pw + "\n");
                    if (r.code !== 0) nu.error = _((r.out || r.msg || "").trim());
                    else { nu.name = ""; nu.pw = ""; nu.pw2 = ""; await loadUsers() }
                    renderBody();
                },
            }, _("Add user"))),
        msg);
}

function pemToDer(pem) {
    const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    return Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
}

function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function viewConnect() {
    const rad = S.radius || {};
    const w = S.saved.wifi;
    const base = w.ssid.replace(/[^A-Za-z0-9._-]/g, "_") + "-CA";
    const getCa = () => cockpit.file(CA, { superuser: "require" }).read();
    return h("div", { class: "vc-card" },
        h("h2", {}, _("Connecting devices")),
        rad.server ? [
            kv([
                [_("Network name"), w.ssid],
                [_("Security"), "WPA2/WPA3-Enterprise (802.1X)"],
                [_("EAP method"), "PEAP"],
                [_("Phase 2"), "MSCHAPv2"],
                [_("CA certificate"), h("span", { class: "vc-inline" }, rad.ca_name || "CA",
                    h("button", { class: "vc-btn secondary", onclick: async () => download(base + ".crt", await getCa(), "application/x-x509-ca-cert") }, _("Download .crt")),
                    h("button", { class: "vc-btn secondary", onclick: async () => download(base + ".der", pemToDer(await getCa()), "application/x-x509-ca-cert") }, _("Download .der")))],
                [_("Domain"), h("span", { class: "vc-mono" }, rad.server)],
                [_("Identity"), _("your user name")],
                [_("Anonymous identity"), "anonymous"],
                [_("Fingerprint (SHA-256)"), h("span", { class: "vc-mono" }, rad.ca_sha256 || "–")],
                [_("Server certificate valid until"), rad.server_expires || "–"],
            ]),
            h("p", { class: "vc-help" }, _("Install the CA certificate on the device (Android: Settings, Security, Install a certificate, Wi-Fi certificate). iPhone, Mac and Windows show the certificate on the first connection: check its fingerprint.")),
        ] : h("p", { class: "vc-help" }, _("The certificate is created when the Enterprise Wi-Fi is first applied.")));
}

/* ---------------- LED */

const LEDCMD = "/usr/local/sbin/velocloud-led";
const SWATCHES = [["green", "#00ff00"], ["cyan", "#00ffff"], ["blue", "#0000ff"], ["purple", "#ff00ff"],
    ["red", "#ff0000"], ["orange", "#ff3200"], ["yellow", "#ff8c00"], ["white", "#ffffff"]];
let previewTimer = null;

function previewLed(hex) {
    // show the colour on the box right away, without saving it
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        const rgb = [1, 3, 5].map(i => String(parseInt(hex.slice(i, i + 2), 16)));
        run([LEDCMD, "preview", ...rgb]).catch(() => null);
    }, 120);
}

function setLedColor(hex) {
    S.cfg.led.color = hex.toLowerCase();
    previewLed(hex);
    changed();
}

function viewLed() {
    const led = S.cfg.led;
    const st = S.status && S.status.led;
    const picker = h("input", { type: "color", value: led.color, class: "vc-color", "aria-label": _("Colour") });
    picker.addEventListener("input", () => setLedColor(picker.value));
    const swatch = (name, hex) => {
        const b = h("button", {
            class: "vc-swatch" + (led.color.toLowerCase() === hex ? " active" : ""),
            title: _(name), "aria-label": _(name),
            onclick: () => { setLedColor(hex); renderBody() },
        });
        b.style.backgroundColor = hex;		// CSSOM: allowed by Cockpit's CSP
        return b;
    };
    let now = null;
    if (st && st.present) {
        now = h("span", { class: "vc-dot" });
        now.style.backgroundColor = st.color;
    }
    return h("div", {},
        st && !st.present ? h("div", { class: "vc-alert info" }, _("The logo LED was not found (it needs the velocloud-igb driver on a VeloCloud Edge 520).")) : null,
        h("div", { class: "vc-card" },
            h("h2", {}, _("Front LED")),
            h("div", { class: "vc-form" },
                row(_("Colour"), "led.color", h("div", { class: "vc-inline" },
                    picker,
                    SWATCHES.map(([name, hex]) => swatch(name, hex)),
                    h("button", { class: "vc-btn link", onclick: () => { setLedColor("#000000"); renderBody() } }, _("Always off"))),
                _("The LED shows the colour while you choose; Apply keeps it.")),
                now ? row(_("Now showing"), null, h("div", { class: "vc-inline" }, now, h("span", { class: "vc-mono" }, st.color))) : null,
                row("", "led.night_off", checkbox("led.night_off", _("Turn off at night"), true)),
                led.night_off ? [
                    row(_("Off at"), "led.off_at", input("led.off_at", { type: "time" })),
                    row(_("On again at"), "led.on_at", input("led.on_at", { type: "time" })),
                ] : null)));
}

/* ---------------- firewall */

function viewFirewall() {
    const fw = S.cfg.firewall;
    const leaseIps = S.status ? S.status.leases.map(l => [l.ip, l.name]) : [];
    return h("div", {},
        h("div", { class: "vc-card" },
            h("h2", {}, _("Access from the Internet")),
            checkbox("firewall.wan_ping", _("Answer ping")),
            checkbox("firewall.wan_ssh", _("SSH")),
            checkbox("firewall.wan_web", _("Web interface (this page)")),
            h("p", { class: "vc-help" }, _("Opening the web interface or SSH to the Internet exposes the router: use strong passwords."))),
        h("div", { class: "vc-card" },
            h("h2", {}, _("Port forwarding")),
            h("p", { class: "vc-help" }, _("Forward ports from the Internet to a device in the LAN.")),
            h("datalist", { id: "vc-lan-hosts" }, leaseIps.map(([ip, name]) => h("option", { value: ip }, name || ip))),
            fw.forwards.length ? h("table", { class: "vc-table" },
                h("thead", {}, h("tr", {}, [_("On"), _("Name"), _("Protocol"), _("External port"), _("Device"), _("Device port"), ""].map(t => h("th", {}, t)))),
                h("tbody", {}, fw.forwards.map((f, i) => {
                    const p = `firewall.forwards.${i}`;
                    const ip = input(p + ".ip", { placeholder: "10.11.0.50" });
                    ip.setAttribute("list", "vc-lan-hosts");
                    return h("tr", {},
                        h("td", {}, h("input", { type: "checkbox", checked: f.enabled !== false, onchange: e => { f.enabled = e.target.checked; changed() } })),
                        cell(p + ".name", input(p + ".name")),
                        cell(p + ".proto", select(p + ".proto", [["tcp", "TCP"], ["udp", "UDP"], ["tcp+udp", "TCP+UDP"]])),
                        cell(p + ".port", input(p + ".port", { placeholder: "8080" })),
                        cell(p + ".ip", ip),
                        cell(p + ".to_port", input(p + ".to_port", { type: "number", number: true, min: 0, max: 65535, placeholder: _("same") })),
                        h("td", {}, h("button", { class: "vc-btn link", onclick: () => { fw.forwards.splice(i, 1); renderBody(); changed() } }, _("Remove"))));
                }))) : h("div", { class: "vc-empty" }, _("No rules")),
            h("button", {
                class: "vc-btn secondary",
                onclick: () => { fw.forwards.push({ name: "", proto: "tcp", port: "", ip: "", to_port: 0, enabled: true }); renderBody(); changed() },
            }, _("Add rule"))));
}

/* ------------------------------------------------------------ start */

async function start() {
    try {
        await loadConfig();
    } catch (e) {
        app.className = "";
        app.replaceChildren(h("div", { class: "vc-alert danger" }, _("Administrator access is needed for these settings."), " ", String(e.message || e)));
        return;
    }
    const ch = await run([STATUS, "--wifi-channels"]).catch(() => null);
    try { S.channels = ch ? JSON.parse(ch.out) : {} } catch (e) { S.channels = {} }
    await pollStatus();
    renderAll();
    setInterval(pollStatus, 3000);
    // countdown of a pending change
    setInterval(() => { if (S.status && S.status.pending_until) renderBanner() }, 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pollStatus() });
    cockpit.addEventListener("visibilitychange", () => { if (!cockpit.hidden) pollStatus() });
}

start();
