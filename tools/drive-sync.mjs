/* Drive sync: copies new pictures and videos from public Google Drive folders into this site.

   The owner only edits drive.config.json. A scheduled GitHub Action (.github/workflows/drive-sync.yml)
   runs this file: it lists the folders, imports what is new as small WebP / MP4 files in assets/drive/
   and writes data/drive.json, which the page reads. No npm packages are needed.

   How it reaches Drive:
     - With DRIVE_API_KEY set (a repository secret), everything goes through the official Drive API.
       This is the supported way and the default ("access": "api" in drive.config.json).
     - Without a key the run does nothing and says so. It is not an error.
     - "access": "public-page" reads Google's public folder pages without a key. Google's robots.txt asks
       automated tools not to read those pages, so this is the owner's informed choice, never the default.

   Run from anywhere:
     node tools/drive-sync.mjs              import what changed
     node tools/drive-sync.mjs --plan       only look; prints "changes=" and "summary=" for the workflow
     node tools/drive-sync.mjs --retry      also try again the files that kept failing
     node tools/drive-sync.mjs --verbose    more detail in the log
     node tools/drive-sync.mjs --fixture <dir> --root <dir>
                                            offline test mode: the first folder plays Drive, the second the site

   Needs Node 20+ and ffmpeg + ffprobe on PATH (or the FFMPEG / FFPROBE variables).

   Files it reads and writes:
     drive.config.json        { "folders": [links], "hidden": [file or folder ids/links to leave out],
                                "labels": { "Drive folder name": "Name on the site" }, "access": "api" }
     data/drive-builtin.json  Drive files that already ship with the site by hand; they are skipped
     data/drive.json          { version, syncedAt, items } for the page. A "sync" block may follow: this
                              tool's own notes per file id (a finer change stamp, or why an import failed
                              and how often it was tried). The page ignores it.
     assets/drive/            <id>.webp + <id>-sm.webp per picture, <id>.mp4 + <id>-poster.webp per video

   Safety rule: if any folder cannot be listed, nothing on disk is touched, so a Google hiccup can never
   empty the site. A hiccup (no answer, HTTP 5xx, rate limit) skips the run with a warning and exit code 0;
   a problem the owner has to fix (a private folder, a bad key, a broken config) ends with exit code 1. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

export const LIMITS = {
    depth: 3,                           // folder levels read below each configured folder
    files: 400,                         // pictures + videos kept in total
    folders: 150,                       // folders read in total
    requests: 4,                        // listing requests at the same time
    imports: 3,                         // pictures converted at the same time
    backoffMs: 3000,                    // wait before the single retry of a request
    listTimeoutMs: 45 * 1000,
    downloadTimeoutMs: 10 * 60 * 1000,
    downloadBytes: 700 * MB,
    imageSide: 1600,
    thumbWidth: 480,
    videoSeconds: 20 * 60,
    videoBytes: 45 * MB,
    totalBytes: 600 * MB,               // assets/drive stays under this so GitHub Pages (1 GB) keeps deploying
    encodeTimeoutMs: 12 * 60 * 1000,
    softMs: 12 * 60 * 1000,             // after this long, new work waits for the next run
    hardMs: 22 * 60 * 1000,             // downloads and ffmpeg are cut off here (the workflow is stopped at 30 min)
    tries: 3                            // failed attempts per file version before it waits for a manual run
};

const ID_RE = /^[A-Za-z0-9_-]{15,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_RE = /^\d{2}:\d{2}$/;
const ASSET_RE = /^[A-Za-z0-9_-]{15,}(?:-sm\.webp|-poster\.webp|\.webp|\.mp4)$/;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi']);
const MIME_KIND = {
    'image/png': 'image', 'image/jpeg': 'image', 'image/jpg': 'image', 'image/webp': 'image', 'image/gif': 'image',
    'image/heic': 'image', 'image/heif': 'image',
    'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video', 'video/x-m4v': 'video',
    'video/x-matroska': 'video', 'video/x-msvideo': 'video', 'video/avi': 'video'
};

const LIST_URL = (id) => `https://drive.google.com/embeddedfolderview?id=${id}#list`;
const DOWNLOAD_URL = (id) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
const PREVIEW_URL = (id, size) => `https://lh3.googleusercontent.com/d/${id}=${size}`;
const VIEW_URL = (id) => `https://drive.google.com/file/d/${id}/view`;
const API_URL = 'https://www.googleapis.com/drive/v3/';
const API_FIELDS = 'nextPageToken,files(id,name,mimeType,modifiedTime,size,description,thumbnailLink,videoMediaMetadata,imageMediaMetadata)';
const API_FILE_URL = (id) => `${API_URL}files/${id}?alt=media&supportsAllDrives=true`;
// thumbnailLink from the API: a short-lived picture address on a Google host, ending in "=s220"
const THUMB_RE = /^https:\/\/[a-z0-9.-]+\.(?:googleusercontent\.com|google\.com)\/[^\s"'<>]+$/i;
const ACCESS = ['api', 'public-page'];

// Why a file is not (fully) on the site. `again` marks the kinds worth another automatic try.
const WHY = {
    download: { again: true, text: () => 'the download failed' },
    convert: { again: true, text: () => 'it could not be converted' },
    slow: { again: false, text: () => 'it took too long to convert' },
    long: { again: false, text: (l) => `it is longer than ${Math.round(l.videoSeconds / 60)} minutes` },
    big: { again: false, text: (l) => `it is still larger than ${megabytes(l.videoBytes)} after compression` },
    huge: { again: false, text: (l) => `it is larger than ${megabytes(l.downloadBytes)}` },
    full: { again: false, text: (l) => `the site's media folder is full (${megabytes(l.totalBytes)})` }
};

// An expected failure with a message a person can act on.
class Problem extends Error {
    constructor(message, { retry = false, why = '', defer = false, timeout = false } = {}) {
        super(message);
        this.retry = retry;         // transient: worth one more try right away
        this.why = why;             // key of WHY, when this decides what happens to the file
        this.defer = defer;         // the run is out of time: leave the file for the next run
        this.timeout = timeout;
    }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const megabytes = (bytes) => `${Math.round(bytes / MB)} MB`;
const fileSize = (bytes) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------------------------------------------------------------
   1. Names, ids, sorting and dates (pure helpers)
   --------------------------------------------------------------- */

// File and folder names come from Drive, so they are only ever cleaned up and stored as text.
function tidy(text, max = 120) {
    const clean = String(text ?? '').normalize('NFC')
        .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ').trim();
    return Array.from(clean).slice(0, max).join('').trim();
}

function driveId(ref, pathPattern) {
    const text = typeof ref === 'string' ? ref.trim() : '';
    if (ID_RE.test(text)) return text;
    if (/^https?:\/\//i.test(text) && !/^https?:\/\/([a-z0-9-]+\.)*google\.com\//i.test(text)) return null;
    const found = pathPattern.exec(text) || /[?&]id=([A-Za-z0-9_-]+)/.exec(text);
    return found && ID_RE.test(found[1]) ? found[1] : null;
}

// .../drive/folders/<id>, .../drive/u/0/folders/<id>?usp=sharing, open?id=<id>, or a bare id
export function parseFolderId(ref) {
    return driveId(ref, /\/folders\/([A-Za-z0-9_-]+)/);
}

// "hidden" takes a file or a folder: a bare id or any share link
export function parseHiddenId(ref) {
    return driveId(ref, /\/(?:folders|d)\/([A-Za-z0-9_-]+)/);
}

export function extOf(name) {
    const found = /\.([A-Za-z0-9]{1,5})$/.exec(String(name).trim());
    return found ? found[1].toLowerCase() : '';
}

// The mime type decides when Drive gives one; the file extension is the fallback.
export function classify(name, mime = '') {
    const type = String(mime || '').toLowerCase().split(';')[0].trim();
    if (type === FOLDER_MIME) return 'folder';
    if (MIME_KIND[type]) return MIME_KIND[type];
    const ext = extOf(name);
    const byName = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : 'other';
    if (!type || type === 'application/octet-stream') return byName;
    return type.startsWith(byName + '/') ? byName : 'other';
}

const MEDIA_EXT_RE = /\.(?:png|jpe?g|webp|gif|heic|heif|mp4|mov|webm|m4v|mkv|avi)$/i;
// "01 - ", "003_", "1. ", "2) " or "01-": only an ordering prefix when letters follow
const ORDER_PREFIX_RE = /^(?:\d{1,3}\s*[-\u2013\u2014]+\s+|\d{1,3}_+|\d{1,3}[.)]\s+|0\d{1,2}-+)\s*(?=.*\p{L})/u;

export function cleanTitle(name) {
    const base = tidy(name, 300).replace(MEDIA_EXT_RE, '').replace(ORDER_PREFIX_RE, '');
    return tidy(base.replace(/_+/g, ' ')) || 'Untitled';
}

// "G-2" before "G-10"; case does not matter; the raw text breaks ties so the order never wobbles
export function naturalCompare(a, b) {
    const left = String(a).toLowerCase().match(/\d+|\D+/g) || [];
    const right = String(b).toLowerCase().match(/\d+|\D+/g) || [];
    const shared = Math.min(left.length, right.length);
    for (let i = 0; i < shared; i++) {
        if (left[i] === right[i]) continue;
        if (/^\d/.test(left[i]) && /^\d/.test(right[i])) {
            const x = left[i].replace(/^0+(?=\d)/, '');
            const y = right[i].replace(/^0+(?=\d)/, '');
            if (x.length !== y.length) return x.length - y.length;
            if (x !== y) return x < y ? -1 : 1;
            continue;
        }
        return left[i] < right[i] ? -1 : 1;
    }
    if (left.length !== right.length) return left.length - right.length;
    return a < b ? -1 : a > b ? 1 : 0;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body) => {
        if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? all;
        const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    });
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function isoDate(year, month, day) {
    const time = Date.UTC(year, month - 1, day);
    const date = new Date(time);
    const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    return real ? date.toISOString().slice(0, 10) : '';
}

// The folder page shows "10/17/25" for other years, "Mar 9" for this year and "2:14 PM" for today.
// Returns { modified: 'YYYY-MM-DD' or '', rev: 'HH:MM' when only a clock time was shown }.
export function parseListedDate(text, now = new Date()) {
    const shown = String(text ?? '').replace(/\s+/g, ' ').trim();
    const unknown = { modified: '', rev: '' };
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(shown);
    if (m) return { modified: isoDate(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2])), rev: '' };
    m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:, (\d{4}))?$/.exec(shown);
    if (m) {
        const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (!month) return unknown;
        let year = Number(m[3]) || now.getUTCFullYear();
        // no year means "this year" on Google's clock; a date in our future must be last year's
        if (!m[3] && Date.UTC(year, month - 1, Number(m[2])) > now.getTime() + 2 * DAY) year -= 1;
        return { modified: isoDate(year, month, Number(m[2])), rev: '' };
    }
    m = /^(\d{1,2}):(\d{2})(?::\d{2})? ?([ap])\.?m\.?$/i.exec(shown) || /^(\d{1,2}):(\d{2})$/.exec(shown);
    if (m) {
        let hour = Number(m[1]);
        if (m[3]) hour = (hour % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
        if (hour > 23 || Number(m[2]) > 59) return unknown;
        return { modified: now.toISOString().slice(0, 10), rev: `${String(hour).padStart(2, '0')}:${m[2]}` };
    }
    return unknown;
}

function dayGap(a, b) {
    return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;
}

// Did the file change on Drive since `was` was recorded? Both are { modified, rev }, where rev is ''
// (only the day is known), 'HH:MM' (the folder page showed a clock time: changed "today") or a full
// timestamp from the Drive API. A day that is not known never counts as a change.
export function changedOnDrive(was, now) {
    if (CLOCK_RE.test(now.rev)) return was.rev !== now.rev;     // "today" is always newer than any day on record
    if (!was.modified || !now.modified) return false;
    if (was.rev && now.rev && !CLOCK_RE.test(was.rev)) return was.rev !== now.rev;
    // a clock time or API timestamp and a listed day can be one calendar day apart (time zones)
    const slack = was.rev || now.rev ? 1 : 0;
    return dayGap(was.modified, now.modified) > slack;
}

// EXIF orientation (1..8) of a JPEG, read straight from the file header; 1 when there is none.
export function exifOrientation(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
    let at = 2;
    while (at + 4 <= buf.length && buf[at] === 0xff) {
        const marker = buf[at + 1];
        const length = buf.readUInt16BE(at + 2);
        if (marker === 0xda || marker === 0xd9 || length < 2) break;
        if (marker === 0xe1 && buf.toString('latin1', at + 4, at + 10) === 'Exif\0\0') {
            return tiffOrientation(buf.subarray(at + 10, at + 2 + length));
        }
        at += 2 + length;
    }
    return 1;
}

function tiffOrientation(tiff) {
    const order = tiff.toString('latin1', 0, 2);
    if (tiff.length < 14 || (order !== 'II' && order !== 'MM')) return 1;
    const u16 = (at) => (order === 'II' ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
    const u32 = (at) => (order === 'II' ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
    const dir = u32(4);
    if (u16(2) !== 42 || dir + 2 > tiff.length) return 1;
    for (let i = 0, count = u16(dir); i < count; i++) {
        const entry = dir + 2 + i * 12;
        if (entry + 12 > tiff.length) break;
        if (u16(entry) === 0x0112) {
            const value = u16(entry + 8);
            return value >= 1 && value <= 8 ? value : 1;
        }
    }
    return 1;
}

// Stable fake Drive id for --fixture, from the path inside the fixture folder (two FNV-1a passes).
export function fixtureId(relativePath) {
    const text = String(relativePath).replace(/\\/g, '/').normalize('NFC');
    let a = 0x811c9dc5;
    let b = 0x9747b28c;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193) >>> 0;
        b = Math.imul(b ^ (code + i), 0x01000193) >>> 0;
    }
    return `fixture-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/* ---------------------------------------------------------------
   2. Listing one folder. Three sources, one entry shape:
      { id, name, kind, mime, modified, rev, size, seconds, caption, thumb }
   --------------------------------------------------------------- */
function makeEntry({ id, name, mime = '', modified = '', rev = '', size = 0, seconds = 0, caption = '', thumb = '' }) {
    return { id, name: String(name), kind: classify(name, mime), mime: String(mime).toLowerCase(), modified, rev, size, seconds, caption, thumb };
}

// The static HTML that drive.google.com/embeddedfolderview returns for a public folder.
export function parseFolderPage(html, now = new Date()) {
    const page = String(html);
    const title = decodeEntities((/<title>([\s\S]*?)<\/title>/i.exec(page) || [])[1] || '');
    if (/^Error \d{3}/.test(title.trim())) throw new Problem(`Google answered "${tidy(title, 60)}"`);
    if (!page.includes('id="flip-contents"') || !page.includes('class="flip-entries"')) {
        throw new Problem('the answer was not a Drive folder list', { retry: true });
    }
    if (!/<\/html>\s*$/i.test(page)) throw new Problem('the folder list arrived incomplete', { retry: true });
    const unreadable = new Problem('an entry could not be read (Google may have changed the page)');
    const parts = page.split('<div class="flip-entry" id="entry-').slice(1);
    if (parts.length !== (page.match(/class="flip-entry"/g) || []).length) throw unreadable;
    const entries = parts.map((part) => {
        const entryId = part.slice(0, Math.max(0, part.indexOf('"')));
        const href = decodeEntities((/<a href="([^"]*)"/.exec(part) || [])[1] || '');
        const name = /<div class="flip-entry-title">([\s\S]*?)<\/div>/.exec(part);
        const date = /<div class="flip-entry-last-modified"><div>([\s\S]*?)<\/div>/.exec(part);
        const icon = decodeEntities((/<div class="flip-entry-list-icon"><img src="([^"]*)"/.exec(part) || [])[1] || '');
        if (!ID_RE.test(entryId) || !href || !name) throw unreadable;
        // a folder is read through the id its link opens (the two only differ for shortcuts)
        const folder = (/\/folders\/([A-Za-z0-9_-]+)/.exec(href) || [])[1];
        const id = folder && ID_RE.test(folder) ? folder : entryId;
        const mime = folder ? FOLDER_MIME : (/\/type\/([a-z0-9.+-]+\/[a-z0-9.+-]+)$/i.exec(icon) || [])[1] || '';
        return makeEntry({ id, name: decodeEntities(name[1]), mime, ...parseListedDate(date ? decodeEntities(date[1]) : '', now) });
    });
    return { name: tidy(title), entries };
}

// One entry of a Drive API v3 files.list answer.
export function entryFromApi(file) {
    if (!file || !ID_RE.test(file.id) || typeof file.name !== 'string') {
        throw new Problem('the Drive API sent an entry without an id or a name');
    }
    const time = /^\d{4}-\d{2}-\d{2}T/.test(file.modifiedTime || '') ? file.modifiedTime : '';
    const millis = Number(file.videoMediaMetadata && file.videoMediaMetadata.durationMillis);
    return makeEntry({
        id: file.id, name: file.name, mime: file.mimeType || '', modified: time.slice(0, 10), rev: time,
        size: Number(file.size) || 0, seconds: millis > 0 ? millis / 1000 : 0,
        // the description the owner typed on Drive becomes the caption on the site
        caption: typeof file.description === 'string' ? tidy(file.description, 240) : '',
        thumb: typeof file.thumbnailLink === 'string' && THUMB_RE.test(file.thumbnailLink) ? file.thumbnailLink : ''
    });
}

// The API's thumbnail address at the size we want ("s1600-rj", "w480-rj").
function sizedThumb(link, size) {
    if (!link) return '';
    return /=s\d+(?:-[a-z0-9-]+)?$/i.test(link) ? link.replace(/=s\d+(?:-[a-z0-9-]+)?$/i, `=${size}`) : link;
}

// Network errors are described by their code only, so a URL (or the API key in it) is never printed.
function netReason(error) {
    const cause = error && error.cause;
    return (cause && (cause.code || cause.name)) || (error && error.name) || 'network error';
}

const timedOut = (error) => Boolean(error) && (error.name === 'TimeoutError' || error.name === 'AbortError');

function discard(response) {
    try {
        if (response.body) response.body.cancel().catch(() => {});
    } catch (e) { /* nothing to free */ }
}

async function withRetry(ctx, run) {
    try {
        return await run();
    } catch (error) {
        if (!(error instanceof Problem) || !error.retry) throw error;
        ctx.note(`  (${error.message}; trying once more)`);
        await sleep(ctx.limits.backoffMs);
        return run();
    }
}

async function listViaPage(ctx, id) {
    return withRetry(ctx, async () => {
        let response;
        try {
            response = await ctx.fetch(LIST_URL(id), {
                headers: { 'accept-language': 'en-US,en;q=0.9' },   // keeps the date format predictable
                redirect: 'follow',
                signal: AbortSignal.timeout(ctx.limits.listTimeoutMs)
            });
        } catch (error) {
            throw new Problem(`no answer from Google (${netReason(error)})`, { retry: true });
        }
        if (response.status !== 200) {
            discard(response);
            const gone = [401, 403, 404].includes(response.status);
            throw new Problem(gone ? `it is not shared with "Anyone with the link", or it was deleted (HTTP ${response.status})`
                : `Google answered HTTP ${response.status}`, { retry: !gone });
        }
        let html;
        try {
            html = await response.text();
        } catch (error) {
            throw new Problem(`the answer broke off (${netReason(error)})`, { retry: true });
        }
        return parseFolderPage(html, ctx.now());
    });
}

async function apiGet(ctx, query) {
    return withRetry(ctx, async () => {
        let response;
        try {
            response = await ctx.fetch(`${API_URL}${query}`, {
                headers: { 'x-goog-api-key': ctx.apiKey },      // in a header, so it can never end up in a logged address
                redirect: 'manual',                             // and never passed on to wherever a redirect points
                signal: AbortSignal.timeout(ctx.limits.listTimeoutMs)
            });
        } catch (error) {
            throw new Problem(`no answer from the Drive API (${netReason(error)})`, { retry: true });
        }
        let body = null;
        try {
            body = await response.json();
        } catch (error) { /* reported below */ }
        if (response.status === 200 && body) return body;
        // an answer that started well and then broke off is Google's hiccup, not something to fix here
        if (response.status === 200) throw new Problem('the Drive API answer broke off', { retry: true });
        // for a key, "not found" means the key may not see it: not shared with everyone, or gone
        if (response.status === 404) {
            throw new Problem('it is not shared with "Anyone with the link: Viewer", or it was deleted (the Drive API answered HTTP 404)');
        }
        const detail = body && body.error ? body.error : {};
        // the key is taken out before the message is cut, so a cut can never leave half of it behind
        const said = detail.message ? `: ${tidy(String(detail.message).split(ctx.apiKey).join('***'), 160).replace(/[.\s]+$/, '')}` : '';
        const busy = response.status === 429 || response.status >= 500 || /rateLimit/i.test(JSON.stringify(detail.errors || ''));
        throw new Problem(`the Drive API answered HTTP ${response.status}${said}`, { retry: busy });
    });
}

async function listViaApi(ctx, id, isRoot) {
    let name = '';
    if (isRoot) {
        // an API key sees a private folder as empty, so the folder itself is checked first
        const folder = await apiGet(ctx, `files/${id}?fields=id,name,mimeType,trashed&supportsAllDrives=true`);
        if (folder.mimeType !== FOLDER_MIME) throw new Problem('it is not a folder');
        if (folder.trashed) throw new Problem('it is in the trash');
        name = tidy(folder.name);
    }
    const entries = [];
    const base = `files?q=${encodeURIComponent(`'${id}' in parents and trashed = false`)}&fields=${API_FIELDS}`
        + '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true';
    for (let page = 0, token = ''; ; page++) {
        if (page >= 20) throw new Problem('it holds more files than this tool reads');
        const answer = await apiGet(ctx, base + (token ? `&pageToken=${encodeURIComponent(token)}` : ''));
        if (!Array.isArray(answer.files)) throw new Problem('the Drive API answer had no file list');
        answer.files.forEach((file) => entries.push(entryFromApi(file)));
        if (!answer.nextPageToken) return { name, entries };
        token = String(answer.nextPageToken);
    }
}

async function saveBody(response, dest, maxBytes) {
    const handle = await fs.promises.open(dest, 'w');
    let bytes = 0;
    try {
        for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > maxBytes) throw new Problem(`it is larger than ${megabytes(maxBytes)}`, { why: 'huge' });
            await handle.write(chunk);
        }
    } finally {
        await handle.close();
    }
    return bytes;
}

// Where a redirect answer points, as a full https address ('' when it has none).
function redirectTarget(response, from) {
    try {
        const where = response.headers.get('location');
        if (!where) return '';
        const next = new URL(where, from);
        return next.protocol === 'https:' ? next.href : '';
    } catch (error) {
        return '';
    }
}

// Streams a URL to disk. A web page instead of the file (sign-in, quota, virus scan) is a failure.
async function download(ctx, url, dest, { maxBytes, timeoutMs, pictureOnly = false, headers = undefined }) {
    return withRetry(ctx, async () => {
        let response;
        try {
            response = await ctx.fetch(url, { redirect: headers ? 'manual' : 'follow', headers, signal: AbortSignal.timeout(timeoutMs) });
            if (headers && response.status >= 300 && response.status < 400) {
                // the key is for the API host only: a redirect is followed once, without it
                const next = redirectTarget(response, url);
                discard(response);
                if (!next) throw new Problem('Google sent a redirect without a usable address', { why: 'download' });
                response = await ctx.fetch(next, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
            }
        } catch (error) {
            if (error instanceof Problem) throw error;
            const late = timedOut(error);
            throw new Problem(late ? 'Google did not answer in time' : `no answer from Google (${netReason(error)})`,
                { retry: !late, why: 'download', timeout: late });
        }
        const type = String(response.headers.get('content-type') || '').toLowerCase();
        const refuse = (message, extra) => {
            discard(response);
            return new Problem(message, { why: 'download', ...extra });
        };
        if (response.status === 429 || response.status >= 500) throw refuse(`Google answered HTTP ${response.status}`, { retry: true });
        if (!response.ok) throw refuse(`Google answered HTTP ${response.status}`);
        if (type.startsWith('text/html')) throw refuse('Google sent a web page instead of the file (sign-in, quota or virus-scan notice)');
        if (pictureOnly && !type.startsWith('image/')) throw refuse('Drive has no preview picture for it');
        if (Number(response.headers.get('content-length')) > maxBytes) throw refuse(`it is larger than ${megabytes(maxBytes)}`, { why: 'huge' });
        if (!response.body) throw refuse('the answer was empty');
        let bytes;
        try {
            bytes = await saveBody(response, dest, maxBytes);
        } catch (error) {
            if (error instanceof Problem) throw error;
            const late = timedOut(error);
            throw new Problem(late ? 'the download took too long' : `the download broke off (${netReason(error)})`,
                { retry: !late, why: 'download', timeout: late });
        }
        if (!bytes) throw new Problem('the file is empty', { why: 'download' });
        return bytes;
    });
}

// With a key everything goes through the Drive API. Without one (only when drive.config.json opted in
// with "access": "public-page") the public folder pages and download links are used.
function driveSource(ctx) {
    const viaApi = Boolean(ctx.apiKey);
    const key = viaApi ? { 'x-goog-api-key': ctx.apiKey } : undefined;
    const preview = (item, size) => (viaApi ? sizedThumb(item.thumb, size) : PREVIEW_URL(item.id, size));
    return {
        label: viaApi ? 'the Drive API' : 'the public folder pages',
        list: (id, isRoot) => (viaApi ? listViaApi(ctx, id, isRoot) : listViaPage(ctx, id)),
        fetchFile: (item, dest, timeoutMs) => download(ctx, viaApi ? API_FILE_URL(item.id) : DOWNLOAD_URL(item.id), dest,
            { maxBytes: ctx.limits.downloadBytes, timeoutMs, headers: key }),
        // the thumbnail address is already signed for us, so the key is not sent with it
        fetchPreview: (item, size, dest) => (preview(item, size)
            ? download(ctx, preview(item, size), dest, { maxBytes: 40 * MB, timeoutMs: 60 * 1000, pictureOnly: true }).then(() => true, () => false)
            : Promise.resolve(false))
    };
}

// --fixture: a local folder plays the Drive folder, so the whole import path runs offline.
function fixtureSource(dir) {
    const rootDir = path.resolve(dir);
    const rootId = fixtureId('');
    const places = new Map([[rootId, { file: rootDir, rel: '' }]]);
    return {
        label: 'a local fixture folder',
        roots: [{ id: rootId, label: `the fixture folder ${rootDir}` }],
        async list(id) {
            const here = places.get(id);
            let found;
            try {
                found = fs.readdirSync(here.file, { withFileTypes: true });
            } catch (error) {
                throw new Problem(`it cannot be read (${error.code || error.message})`);
            }
            const entries = [];
            for (const one of found) {
                const rel = here.rel ? `${here.rel}/${one.name}` : one.name;
                const file = path.join(here.file, one.name);
                places.set(fixtureId(rel), { file, rel });
                if (one.isDirectory()) {
                    entries.push(makeEntry({ id: fixtureId(rel), name: one.name, mime: FOLDER_MIME }));
                } else if (one.isFile()) {
                    const stat = fs.statSync(file);
                    const time = stat.mtime.toISOString();
                    entries.push(makeEntry({ id: fixtureId(rel), name: one.name, modified: time.slice(0, 10), rev: time, size: stat.size }));
                }
            }
            return { name: path.basename(rootDir), entries };
        },
        async fetchFile(item, dest) {
            try {
                fs.copyFileSync(places.get(item.id).file, dest);
            } catch (error) {
                throw new Problem(`the fixture file cannot be copied (${error.code || error.message})`, { why: 'download' });
            }
            return fs.statSync(dest).size;
        },
        fetchPreview: async () => false
    };
}

/* ---------------------------------------------------------------
   3. Crawl: every folder, level by level, into one ordered list
   --------------------------------------------------------------- */
async function mapLimit(list, limit, work) {
    const results = new Array(list.length);
    let next = 0;
    let failure = null;
    const worker = async () => {
        while (next < list.length && !failure) {
            const index = next++;
            try {
                results[index] = await work(list[index], index);
            } catch (error) {
                failure = failure || error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
    if (failure) throw failure;
    return results;
}

// Any folder that cannot be listed stops the whole run (see the safety rule at the top).
async function crawl(ctx, source, roots, hidden) {
    const queued = new Set(roots.map((root) => root.id));
    const top = roots.map((root) => ({ id: root.id, label: root.label, name: '', depth: 0, files: [], folders: [] }));
    const notes = { listed: 0, hidden: 0, tooDeep: 0, tooMany: 0 };
    let level = top;
    while (level.length) {
        const pages = await mapLimit(level, ctx.limits.requests, async (node) => {
            try {
                return await source.list(node.id, node.depth === 0);
            } catch (error) {
                const what = node.depth === 0 ? node.label : `"${node.name}" (${node.id})`;
                const hiccup = error instanceof Problem && error.retry;      // no answer, HTTP 5xx, rate limit
                const tip = node.depth === 0 || hiccup ? '' : ' To leave this folder out, add its id to "hidden" in drive.config.json.';
                const problem = new Problem(`Could not read the Drive folder ${what}: ${error.message}.${tip}`);
                problem.hiccup = hiccup;
                throw problem;
            }
        });
        const below = [];
        level.forEach((node, index) => {
            notes.listed += 1;
            if (node.depth === 0) node.name = tidy(pages[index].name) || 'Drive';
            const entries = [...pages[index].entries].sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.id, b.id));
            for (const entry of entries) {
                if (entry.kind !== 'folder') node.files.push(entry);
                else if (hidden.has(entry.id)) notes.hidden += 1;
                else if (queued.has(entry.id)) continue;
                else if (node.depth >= ctx.limits.depth) notes.tooDeep += 1;
                else if (queued.size >= ctx.limits.folders) notes.tooMany += 1;
                else {
                    queued.add(entry.id);
                    const child = { id: entry.id, name: tidy(entry.name) || 'Untitled folder', depth: node.depth + 1, files: [], folders: [] };
                    node.folders.push(child);
                    below.push(child);
                }
            }
        });
        level = below;
    }
    return { top, notes };
}

// A folder's own files first (natural order), then each subfolder the same way.
function flatten(node, trail, out, seen) {
    const here = [...trail, node.name];
    for (const file of node.files) {
        if (seen.has(file.id)) continue;
        seen.add(file.id);
        out.push({ ...file, group: node.name, path: here });
    }
    node.folders.forEach((folder) => flatten(folder, here, out, seen));
    return out;
}

function selectMedia(files, { hidden, builtin, limit }) {
    const counts = { other: 0, hidden: 0, builtin: 0, over: 0 };
    const media = [];
    const cut = new Set();
    for (const file of files) {
        if (file.kind !== 'image' && file.kind !== 'video') counts.other += 1;
        else if (hidden.has(file.id)) counts.hidden += 1;
        else if (builtin.has(file.id)) counts.builtin += 1;
        else if (media.length < limit) media.push(file);
        else {
            counts.over += 1;
            cut.add(file.id);
        }
    }
    return { media, counts, cut };
}

/* ---------------------------------------------------------------
   4. Config, manifest and the plan (what changed since last time)
   --------------------------------------------------------------- */

// Hand-edited JSON often ends a list with a comma; forgive that one mistake.
function withoutTrailingCommas(text) {
    const closes = /\s*[\]}]/y;
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            out += ch;
            if (ch === '\\') out += text[++i] ?? '';
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        closes.lastIndex = i + 1;
        if (ch !== ',' || !closes.test(text)) out += ch;
    }
    return out;
}

function readJson(file, label) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw new Problem(`${label} cannot be read (${error.code || error.message}).`);
    }
    try {
        return JSON.parse(text);
    } catch (strict) {
        try {
            return JSON.parse(withoutTrailingCommas(text));
        } catch (error) {
            throw new Problem(`${label} is not valid JSON (${tidy(strict.message, 160)}). Look for a missing quote, comma or bracket.`);
        }
    }
}

function readConfig(ctx, fixture) {
    const data = readJson(path.join(ctx.root, 'drive.config.json'), 'drive.config.json');
    if (data === undefined && fixture) return { roots: [], hidden: new Set(), labels: new Map(), access: 'api' };
    if (data === undefined) throw new Problem('drive.config.json is missing. It lists the Drive folders to show: { "folders": [ "<folder link>" ], "hidden": [] }');
    const bad = (text) => new Problem(`drive.config.json: ${text}`);
    if (!data || typeof data !== 'object' || !Array.isArray(data.folders)) throw bad('"folders" must be a list of Google Drive folder links.');
    // an empty list is far more likely a slip than a wish to empty the site
    if (!data.folders.length && !fixture) throw bad('"folders" is empty. Add at least one Google Drive folder link.');
    if (data.hidden !== undefined && !Array.isArray(data.hidden)) throw bad('"hidden" must be a list of file ids or links (or an empty list).');
    const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
    if (data.labels !== undefined && !(plain(data.labels) && Object.values(data.labels).every((name) => typeof name === 'string' && name.trim()))) {
        throw bad('"labels" must look like { "Drive folder name": "Name on the site" }.');
    }
    if (data.access !== undefined && !ACCESS.includes(data.access)) throw bad(`"access" must be "${ACCESS.join('" or "')}".`);
    const roots = [];
    data.folders.forEach((ref, index) => {
        const id = parseFolderId(ref);
        if (!id) throw bad(`entry ${index + 1} of "folders" is not a Google Drive folder link or id: "${tidy(ref, 90)}"`);
        if (!roots.some((root) => root.id === id)) roots.push({ id, label: `number ${index + 1} in drive.config.json (${id})` });
    });
    const hidden = new Set();
    (data.hidden || []).forEach((ref, index) => {
        const id = parseHiddenId(ref);
        if (!id) throw bad(`entry ${index + 1} of "hidden" is not a Google Drive file link or id: "${tidy(ref, 90)}"`);
        hidden.add(id);
    });
    // a Drive folder name (any letter case) and the name the site shows for it
    const labels = new Map(Object.entries(data.labels || {}).map(([from, to]) => [from.trim().toLowerCase(), tidy(to, 60)]));
    return { roots, hidden, labels, access: data.access || 'api' };
}

// Drive files that already ship with the site as hand-made copies (data/drive-builtin.json).
function readBuiltin(ctx) {
    const data = readJson(path.join(ctx.root, 'data', 'drive-builtin.json'), 'data/drive-builtin.json');
    if (data === undefined) return new Set();
    if (!data || typeof data.items !== 'object' || data.items === null || Array.isArray(data.items)) {
        throw new Problem('data/drive-builtin.json must look like { "items": { "<drive id>": { "file": "..." } } }.');
    }
    return new Set(Object.keys(data.items).filter((id) => ID_RE.test(id)));
}

const str = (value) => (typeof value === 'string' ? value : '');

// Sync notes kept next to the items: { rev, title, problem: { why, tries, modified, rev } } per id.
function cleanNotes(raw) {
    const notes = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return notes;
    for (const [id, value] of Object.entries(raw)) {
        if (!ID_RE.test(id) || !value || typeof value !== 'object') continue;
        const note = {};
        if (str(value.rev)) note.rev = value.rev;
        if (str(value.title)) note.title = tidy(value.title);
        const problem = value.problem;
        if (problem && typeof problem === 'object' && WHY[problem.why]) {
            note.problem = { why: problem.why };
            if (Number.isInteger(problem.tries) && problem.tries > 0) note.problem.tries = Math.min(problem.tries, 99);
            note.problem.modified = DATE_RE.test(str(problem.modified)) ? problem.modified : '';
            if (str(problem.rev)) note.problem.rev = problem.rev;
        }
        if (Object.keys(note).length) notes[id] = note;
    }
    return notes;
}

function readManifest(ctx) {
    const data = readJson(ctx.manifestFile, 'data/drive.json');
    if (data === undefined) return { syncedAt: '', items: [], sync: {} };
    if (!data || data.version !== 1 || !Array.isArray(data.items)) {
        throw new Problem('data/drive.json is not a version 1 manifest. Fix it, or delete it to import everything again.');
    }
    const items = data.items.filter((item) => item && ID_RE.test(item.id) && (item.type === 'image' || item.type === 'video'));
    return { syncedAt: str(data.syncedAt), items, sync: cleanNotes(data.sync) };
}

const assetPath = (id, suffix) => `assets/drive/${id}${suffix}`;
const positive = (value) => Number.isFinite(value) && value > 0;

// The manifest entry for a listed file, with media fields taken from `media` (a fresh import or the
// previous entry). File paths are always rebuilt from the id, never copied from text.
function buildEntry(item, modified, media) {
    const entry = {
        id: item.id, type: item.kind, title: cleanTitle(item.name), group: item.group, path: item.path,
        modified, drive: VIEW_URL(item.id)
    };
    if (item.caption) entry.caption = item.caption;
    if (item.kind === 'image') {
        return { ...entry, src: assetPath(item.id, '.webp'), w: media.w, h: media.h, thumb: assetPath(item.id, '-sm.webp'), tw: media.tw, th: media.th };
    }
    if (media.hosted) {
        const hosted = { ...entry, hosted: true, src: assetPath(item.id, '.mp4'), poster: assetPath(item.id, '-poster.webp'), w: media.w, h: media.h, duration: media.duration };
        return positive(media.bytes) ? { ...hosted, bytes: media.bytes } : hosted;
    }
    return media.poster ? { ...entry, hosted: false, poster: assetPath(item.id, '-poster.webp') } : { ...entry, hosted: false };
}

function assetNames(entry) {
    if (entry.type === 'image') return [`${entry.id}.webp`, `${entry.id}-sm.webp`];
    if (entry.hosted) return [`${entry.id}.mp4`, `${entry.id}-poster.webp`];
    return entry.poster ? [`${entry.id}-poster.webp`] : [];
}

// A previous entry is only trusted when its numbers make sense and its files are still on disk.
function usable(ctx, entry) {
    const sizes = entry.type === 'image' ? [entry.w, entry.h, entry.tw, entry.th]
        : entry.hosted ? [entry.w, entry.h, entry.duration] : [];
    return sizes.every(positive) && assetNames(entry).every((name) => {
        try {
            return fs.statSync(path.join(ctx.assetDir, name)).size > 0;
        } catch (error) {
            return false;
        }
    });
}

const stamp = (thing) => ({ modified: str(thing.modified), rev: str(thing.rev) });

// What to do with one listed file: 'add', 'update', 'retry' or 'keep'.
export function decide(item, prev, note, { retry = false, room = true, present = true, tries = LIMITS.tries } = {}) {
    const problem = note && note.problem;
    if (!prev && !problem) return 'add';
    // compare with the newest version already dealt with: the one that failed, else the published one
    const last = problem ? stamp(problem) : { modified: str(prev.modified), rev: str(note && note.rev) };
    if (changedOnDrive(last, stamp(item))) return prev ? 'update' : 'add';
    if (prev && (prev.type !== item.kind || !present)) return 'update';
    if (!problem) return 'keep';
    if (problem.why === 'full') return room ? 'retry' : 'keep';
    return WHY[problem.why].again && (retry || (problem.tries || 1) < tries) ? 'retry' : 'keep';
}

// The files in assets/drive that this tool wrote: only names made of a Drive id and one of our endings.
function ownAssets(ctx) {
    try {
        return fs.readdirSync(ctx.assetDir, { withFileTypes: true })
            .filter((one) => one.isFile() && ASSET_RE.test(one.name)).map((one) => one.name);
    } catch (error) {
        return [];      // no folder yet
    }
}

function mediaBytes(ctx) {
    return ownAssets(ctx).reduce((total, name) => {
        try {
            return total + fs.statSync(path.join(ctx.assetDir, name)).size;
        } catch (error) {
            return total;
        }
    }, 0);
}

const hasRoom = (ctx) => mediaBytes(ctx) + ctx.limits.videoBytes <= ctx.limits.totalBytes;

function makePlan(ctx, prev, media, retry) {
    const published = new Map(prev.items.map((item) => [item.id, item]));
    const room = hasRoom(ctx);
    const steps = media.map((item) => {
        const found = published.get(item.id);
        const present = found ? usable(ctx, found) : true;
        const note = prev.sync[item.id];
        const action = decide(item, found, note, { retry, room, present, tries: ctx.limits.tries });
        // an entry whose files are gone (or that was another kind of file) is not worth keeping if the repair fails
        const before = found && present && found.type === item.kind ? found : undefined;
        return { item, before, note, action };
    });
    const listed = new Set(media.map((item) => item.id));
    const gone = prev.items.filter((item) => !listed.has(item.id));
    return { steps, gone };
}

const attemptNumber = (step) => (step.action === 'retry' && step.note && step.note.problem ? step.note.problem.tries || 0 : 0) + 1;

// The next manifest. A file without a result (kept, or left for the next run) carries over as it was;
// a failed import keeps the version that is already on the site.
function buildManifest(prev, plan, outcomes) {
    const items = [];
    const sync = {};
    for (const step of plan.steps) {
        const { item, before, note } = step;
        const outcome = outcomes.get(item.id);
        const result = outcome && outcome.kind !== 'deferred' ? outcome : null;
        const fresh = Boolean(result) && result.kind !== 'failed';
        const known = stamp(item);
        let entry = null;
        if (fresh) entry = buildEntry(item, known.modified, result.media);
        else if (before) entry = buildEntry(item, str(before.modified) || known.modified, before);
        else if (result && item.kind === 'video') entry = buildEntry(item, known.modified, { hosted: false, poster: result.poster });
        if (entry) items.push(entry);

        const next = {};
        const rev = fresh ? known.rev : str(note && note.rev);
        if (rev && entry) next.rev = rev;
        if (!entry) next.title = cleanTitle(item.name);
        if (result && result.why) {
            next.problem = { why: result.why };
            if (WHY[result.why].again) next.problem.tries = attemptNumber(step);
            next.problem.modified = known.modified;
            if (known.rev) next.problem.rev = known.rev;
        } else if (!fresh && note && note.problem) {
            next.problem = note.problem;
        }
        if (next.rev || next.problem) sync[item.id] = next;
    }
    return { syncedAt: prev.syncedAt, items, sync };
}

const sameContent = (a, b) => JSON.stringify([a.items, a.sync]) === JSON.stringify([b.items, b.sync]);

function writeManifest(ctx, manifest) {
    const out = { version: 1, syncedAt: manifest.syncedAt, items: manifest.items };
    if (Object.keys(manifest.sync).length) out.sync = manifest.sync;
    fs.mkdirSync(path.dirname(ctx.manifestFile), { recursive: true });
    fs.writeFileSync(`${ctx.manifestFile}.tmp`, `${JSON.stringify(out, null, 2)}\n`);
    fs.renameSync(`${ctx.manifestFile}.tmp`, ctx.manifestFile);
}

// Our files in assets/drive that the manifest no longer points to.
function unusedAssets(ctx, manifest) {
    const wanted = new Set(manifest.items.flatMap(assetNames));
    return ownAssets(ctx).filter((name) => !wanted.has(name));
}

/* ---------------------------------------------------------------
   5. Download + convert (ffmpeg does the pixel work)
   --------------------------------------------------------------- */

// Files are read by content from neutral names, and only as these container types: a text file posing
// as a video (a playlist, a concat script) can never make ffmpeg open other files or URLs.
const SAFE_INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,avi,gif,png_pipe,jpeg_pipe,webp_pipe,image2'];
const TURN = { 2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2' };
// portrait at most 540 wide, square 720, landscape 1280; never upscaled; even sizes
const VIDEO_SCALE = "scale=w='trunc(min(iw,if(lt(abs(iw-ih),iw/50),720,if(lt(iw,ih),540,1280)))/2)*2':h=-2:flags=lanczos";
// HDR phone footage (HLG / PQ) looks grey when simply cut to 8 bits; this maps it to normal colours
const TONE_MAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
const fitInside = (w, h) => `scale=w='min(iw,${w})':h='min(ih,${h})':force_original_aspect_ratio=decrease:flags=lanczos`;

function execFile(ctx, command, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: ctx.childEnv });
        let out = '';
        let err = '';
        let late = false;
        const timer = setTimeout(() => {
            late = true;
            child.kill('SIGKILL');
        }, timeoutMs);
        child.stdout.on('data', (chunk) => { if (out.length < 8 * MB) out += chunk; });
        child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-4000); });
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, late }); });
    });
}

// The last thing ffmpeg said, without the temp folder it likes to quote.
function lastLine(ctx, output) {
    const line = String(output).split(/\r?\n/).filter((one) => one.trim()).pop() || 'no details';
    return tidy(line.split(ctx.tmp).join('').replace(/[\\/]item-\w+[\\/]/g, ''), 200);
}

// Runs one slow step inside what is left of this run. Running out of *our* time is not the file's fault.
async function within(ctx, wantMs, run) {
    const allowed = Math.min(wantMs, ctx.started + ctx.limits.hardMs - Date.now());
    if (allowed <= 0) throw new Problem('this run is out of time', { defer: true });
    try {
        return await run(allowed);
    } catch (error) {
        if (error instanceof Problem && error.timeout && allowed < wantMs) throw new Problem('this run is out of time', { defer: true });
        throw error;
    }
}

async function ffmpeg(ctx, args, wantMs = 3 * 60 * 1000) {
    return within(ctx, wantMs, async (timeoutMs) => {
        const result = await execFile(ctx, ctx.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], timeoutMs);
        if (result.late) throw new Problem('ffmpeg ran out of time', { why: 'slow', timeout: true });
        if (result.code !== 0) throw new Problem(`ffmpeg: ${lastLine(ctx, result.err)}`, { why: 'convert' });
    });
}

async function probe(ctx, file) {
    const result = await execFile(ctx, ctx.ffprobe, ['-v', 'error', ...SAFE_INPUT, '-print_format', 'json', '-show_format', '-show_streams', file], 60 * 1000);
    if (result.late || result.code !== 0) throw new Problem(`ffprobe: ${result.late ? 'ran out of time' : lastLine(ctx, result.err)}`, { why: 'convert' });
    let data;
    try {
        data = JSON.parse(result.out);
    } catch (error) {
        throw new Problem('ffprobe gave no usable answer', { why: 'convert' });
    }
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const videos = streams.filter((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const first = videos[0] || {};
    return {
        tracks: videos.length,
        w: Number(first.width) || 0,
        h: Number(first.height) || 0,
        // the picture track's own length; the container's is often a few frames of sound longer
        seconds: Number(first.duration) || Number(data.format && data.format.duration) || 0,
        hdr: ['smpte2084', 'arib-std-b67'].includes(first.color_transfer)
    };
}

// One still frame -> WebP that fits inside `box`. Returns the real pixel size.
async function toWebp(ctx, src, out, { box, quality, turn = '', tone = '', seek = null }) {
    const still = seek === null;    // pictures are turned by hand (below); videos by ffmpeg itself
    const filters = [turn, fitInside(box[0], box[1]), tone].filter(Boolean).join(',');
    await ffmpeg(ctx, [...(still ? ['-noautorotate'] : ['-ss', seek.toFixed(2)]), ...SAFE_INPUT, '-i', src,
        '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-dn', '-map_metadata', '-1', '-vf', filters,
        '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', out]);
    const made = await probe(ctx, out);
    if (!made.w || !made.h) throw new Problem('the converted picture is empty', { why: 'convert' });
    return made;
}

function place(ctx, from, name) {
    fs.mkdirSync(ctx.assetDir, { recursive: true });
    const to = path.join(ctx.assetDir, name);
    try {
        fs.renameSync(from, to);
    } catch (error) {
        fs.copyFileSync(from, to);      // the temp folder is on another drive
        fs.rmSync(from, { force: true });
    }
    ctx.touched = true;
}

function readHead(file, bytes = 256 * 1024) {
    const handle = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(bytes);
        return buf.subarray(0, fs.readSync(handle, buf, 0, bytes, 0));
    } finally {
        fs.closeSync(handle);
    }
}

async function importImage(ctx, source, item, work) {
    const { imageSide, thumbWidth } = ctx.limits;
    const full = path.join(work, 'full.webp');
    const small = path.join(work, 'small.webp');
    const heic = /hei[cf]/.test(item.mime) || ['heic', 'heif'].includes(extOf(item.name));
    const convert = async (src) => {
        const turn = TURN[exifOrientation(readHead(src))] || '';
        const big = await toWebp(ctx, src, full, { box: [imageSide, imageSide], quality: 82, turn });
        const thumb = await toWebp(ctx, src, small, { box: [thumbWidth, thumbWidth * 2], quality: 72, turn });
        return { w: big.w, h: big.h, tw: thumb.w, th: thumb.h };
    };
    const fromFile = async () => {
        const src = path.join(work, 'source.bin');
        await within(ctx, ctx.limits.downloadTimeoutMs, (ms) => source.fetchFile(item, src, ms));
        if (heic && (await probe(ctx, src)).tracks !== 1) throw new Problem('this HEIC photo is stored in tiles', { why: 'convert' });
        return convert(src);
    };
    const fromPreview = async () => {
        const src = path.join(work, 'preview.bin');
        if (!(await source.fetchPreview(item, `s${imageSide}-rj`, src))) throw new Problem('Drive has no preview of it', { why: 'convert' });
        return convert(src);
    };
    // Two ways in: the file itself, or the preview picture Drive makes of it. The preview rescues files
    // ffmpeg cannot read, and goes first for iPhone HEIC photos (ffmpeg builds disagree about their tiles).
    const [first, second] = heic ? [fromPreview, fromFile] : [fromFile, fromPreview];
    let media;
    let how = '';
    try {
        media = await first();
    } catch (error) {
        if (!(error instanceof Problem) || error.defer) throw error;
        try {
            media = await second();
            how = heic ? '' : " (from Drive's preview picture)";
        } catch (other) {
            throw other instanceof Problem && other.defer ? other : error;
        }
    }
    const bytes = fs.statSync(full).size;
    place(ctx, full, `${item.id}.webp`);
    place(ctx, small, `${item.id}-sm.webp`);
    return { media, detail: `${media.w}x${media.h}, ${fileSize(bytes)}${how}` };
}

async function encodeVideo(ctx, src, out, info) {
    const timeoutMs = ctx.limits.encodeTimeoutMs;
    const run = (tone, ms) => ffmpeg(ctx, [...SAFE_INPUT, '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
        '-map_metadata', '-1', '-map_chapters', '-1',
        '-vf', [VIDEO_SCALE, tone, 'format=yuv420p'].filter(Boolean).join(','), '-fpsmax', '30',
        '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '48000',
        // stop writing just past the size limit instead of finishing a file that will be thrown away
        '-movflags', '+faststart', '-fs', String(ctx.limits.videoBytes + MB), '-f', 'mp4', out], ms);
    if (!info.hdr || !ctx.canToneMap) return run('', timeoutMs);
    const started = Date.now();
    try {
        return await run(TONE_MAP, timeoutMs);
    } catch (error) {
        if (!(error instanceof Problem) || error.timeout || error.defer) throw error;
        ctx.note(`  (HDR colour conversion failed: ${error.message}; converting without it)`);
        return run('', Math.max(1000, timeoutMs - (Date.now() - started)));
    }
}

// A poster for a video that is not hosted: a frame of the downloaded file, else Drive's own thumbnail.
async function sparePoster(ctx, source, item, work, from) {
    const out = path.join(work, 'spare-poster.webp');
    const box = [ctx.limits.thumbWidth, ctx.limits.thumbWidth * 2];
    const ways = [];
    if (from) {
        const tone = from.info.hdr && ctx.canToneMap ? TONE_MAP : '';
        ways.push(() => toWebp(ctx, from.file, out, { box, quality: 72, tone, seek: Math.min(1, from.info.seconds / 3) }));
    }
    ways.push(async () => {
        const preview = path.join(work, 'preview.bin');
        if (!(await source.fetchPreview(item, `w${ctx.limits.thumbWidth}-rj`, preview))) throw new Problem('Drive has no thumbnail for it');
        await toWebp(ctx, preview, out, { box, quality: 72 });
    });
    for (const make of ways) {
        try {
            await make();
            place(ctx, out, `${item.id}-poster.webp`);
            return true;
        } catch (error) {
            ctx.note(`  (no poster this way for ${item.id}: ${error.message})`);
        }
    }
    return false;
}

async function importVideo(ctx, source, item, work) {
    const limits = ctx.limits;
    const notHosted = async (why, from = null) => ({ why, media: { hosted: false, poster: await sparePoster(ctx, source, item, work, from) } });
    if (!hasRoom(ctx)) return notHosted('full');
    if (item.size > limits.downloadBytes) return notHosted('huge');
    if (item.seconds > limits.videoSeconds) return notHosted('long');

    const src = path.join(work, 'source.bin');
    try {
        await within(ctx, limits.downloadTimeoutMs, (ms) => source.fetchFile(item, src, ms));
    } catch (error) {
        if (error instanceof Problem && error.why === 'huge') return notHosted('huge');
        throw error;
    }
    const info = await probe(ctx, src);
    if (!info.tracks || !info.w || !info.h) throw new Problem('it has no video track', { why: 'convert' });
    const from = { file: src, info };
    if (info.seconds > limits.videoSeconds) return notHosted('long', from);

    const out = path.join(work, 'video.mp4');
    try {
        await encodeVideo(ctx, src, out, info);
    } catch (error) {
        if (error instanceof Problem && error.why === 'slow') return notHosted('slow', from);
        throw error;
    }
    const bytes = fs.statSync(out).size;
    if (bytes > limits.videoBytes) return notHosted('big', from);
    const made = await probe(ctx, out);
    if (!made.w || !made.h || !made.seconds) throw new Problem('the converted video is empty', { why: 'convert' });
    const poster = path.join(work, 'poster.webp');
    await toWebp(ctx, out, poster, { box: [limits.thumbWidth, limits.thumbWidth * 2], quality: 72, seek: Math.min(1, made.seconds / 3) });
    place(ctx, out, `${item.id}.mp4`);
    place(ctx, poster, `${item.id}-poster.webp`);
    const duration = Math.round(made.seconds * 10) / 10;
    return { media: { hosted: true, w: made.w, h: made.h, duration, bytes }, detail: `${made.w}x${made.h}, ${duration} s, ${fileSize(bytes)}` };
}

// One file, start to finish. Never throws for the file's own faults: the run goes on with the others.
async function attempt(ctx, source, step) {
    const { item, before } = step;
    if (Date.now() - ctx.started > ctx.limits.softMs) return { kind: 'deferred' };
    const work = fs.mkdtempSync(path.join(ctx.tmp, 'item-'));
    try {
        const made = item.kind === 'image' ? await importImage(ctx, source, item, work) : await importVideo(ctx, source, item, work);
        return { kind: made.why ? 'limited' : 'done', ...made };
    } catch (error) {
        if (error instanceof Problem && error.defer) return { kind: 'deferred' };
        const why = error instanceof Problem && WHY[error.why] ? error.why : 'convert';
        // a new video that cannot be fetched still gets a place on the site (Drive's own player)
        const poster = item.kind === 'video' && !before ? await sparePoster(ctx, source, item, work, null) : false;
        return { kind: 'failed', why, poster, detail: tidy(error && error.message, 240) };
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

async function checkTools(ctx) {
    const ask = async (command, args, name) => {
        try {
            const result = await execFile(ctx, command, args, 30 * 1000);
            if (result.code === 0) return result.out;
        } catch (error) { /* reported below */ }
        throw new Problem(`${name} was not found or does not start. Install ffmpeg, or point the ${name.toUpperCase()} variable at it.`);
    };
    await ask(ctx.ffprobe, ['-version'], 'ffprobe');
    await ask(ctx.ffmpeg, ['-version'], 'ffmpeg');
    const encoders = await ask(ctx.ffmpeg, ['-hide_banner', '-encoders'], 'ffmpeg');
    const missing = ['libwebp', 'libx264', 'aac'].filter((name) => !new RegExp(`\\s${name}\\s`).test(encoders));
    if (missing.length) throw new Problem(`This ffmpeg cannot write ${missing.join(' / ')}. Install a full ffmpeg build.`);
    const filters = await ask(ctx.ffmpeg, ['-hide_banner', '-filters'], 'ffmpeg');
    ctx.canToneMap = /\szscale\s/.test(filters) && /\stonemap\s/.test(filters);
}

/* ---------------------------------------------------------------
   6. One run: list, plan, import, write the manifest, tidy up
   --------------------------------------------------------------- */
const label = (item) => `${item.kind === 'image' ? 'picture' : 'video'} "${cleanTitle(item.name)}" (${item.group})`;

function reportListing(ctx, tree, files, media, counts) {
    // Every line that carries a name from Drive starts with our own words, so a name cannot start a "::" log
    // command. The older "##[" form is read anywhere in a line, so the log itself breaks that up (makeContext).
    for (const root of tree.top) {
        const inside = flatten(root, [], [], new Set());
        ctx.log(`  folder "${root.name}": ${plural(inside.length, 'file')} in ${plural(new Set(inside.map((f) => f.path.join('/'))).size || 1, 'folder')}`);
    }
    const pictures = files.filter((f) => f.kind === 'image').length;
    const videos = files.filter((f) => f.kind === 'video').length;
    ctx.log(`Found ${plural(pictures, 'picture')} and ${plural(videos, 'video')}; ${media.length} to show on the site.`);
    if (counts.builtin) ctx.log(`  ${counts.builtin} already built into the site (data/drive-builtin.json)`);
    if (counts.hidden + tree.notes.hidden) ctx.log(`  ${counts.hidden + tree.notes.hidden} hidden in drive.config.json`);
    if (counts.other) ctx.log(`  ${plural(counts.other, 'other file')} ignored (not a picture or video this site can show)`);
    if (counts.over) ctx.warn(`${plural(counts.over, 'file')} left out: the site shows at most ${ctx.limits.files} Drive files.`);
    if (tree.notes.tooDeep) ctx.warn(`${plural(tree.notes.tooDeep, 'folder')} not read: only ${ctx.limits.depth} levels of subfolders are followed.`);
    if (tree.notes.tooMany) ctx.warn(`${plural(tree.notes.tooMany, 'folder')} not read: at most ${ctx.limits.folders} folders are followed.`);
}

function planSummary(plan, extra) {
    const count = (action) => plan.steps.filter((step) => step.action === action).length;
    const parts = [];
    if (count('add')) parts.push(`${count('add')} new`);
    if (count('update')) parts.push(`${count('update')} changed`);
    if (count('retry')) parts.push(`${count('retry')} to retry`);
    if (plan.gone.length) parts.push(`${plan.gone.length} removed`);
    if (!parts.length && extra) parts.push('details updated');
    return parts.join(', ') || 'no changes';
}

function reportOutcome(ctx, step, outcome) {
    const { item, action } = step;
    const verb = action === 'add' ? '+ added' : action === 'update' ? '~ updated' : '~ retried';
    if (outcome.kind === 'done') {
        ctx.log(`${verb} ${label(item)}: ${outcome.detail}`);
    } else if (outcome.kind === 'limited') {
        ctx.log(`${verb} ${label(item)} as a Google Drive player: ${WHY[outcome.why].text(ctx.limits)}`);
    } else if (outcome.kind === 'failed') {
        const tries = attemptNumber(step);
        const next = !WHY[outcome.why].again ? 'It is tried again when the file changes on Drive.'
            : tries < ctx.limits.tries ? `It will be tried again on the next run (attempt ${tries} of ${ctx.limits.tries}).`
            : 'No more automatic tries; use "Run workflow" (or --retry) to try again.';
        const player = item.kind === 'video' && !(step.before && step.before.hosted);
        const kept = player ? ' The site shows it in a Google Drive player meanwhile.' : step.before ? ' The version already on the site stays.' : '';
        ctx.warn(`Could not import ${label(item)}: ${WHY[outcome.why].text(ctx.limits)} (${outcome.detail}).${kept} ${next}`);
    }
}

function removalReason(id, { hidden, builtin, cut }) {
    if (hidden.has(id)) return 'hidden in drive.config.json';
    if (builtin.has(id)) return 'now built into the site';
    if (cut.has(id)) return 'over the limit of Drive files the site shows';
    return 'no longer in the Drive folders that are read';
}

async function sync(ctx, opts) {
    const config = readConfig(ctx, Boolean(opts.fixture));
    const builtin = readBuiltin(ctx);
    const prev = readManifest(ctx);
    if (!opts.fixture && !ctx.apiKey && config.access !== 'public-page') {
        // not an error: the owner has not added the key yet, so there is nothing to read with
        const waiting = 'Drive sync is waiting for its key. Add a Google API key as the repository secret DRIVE_API_KEY '
            + '(README, "Connect Google Drive"). Nothing was changed.';
        ctx.log(waiting);
        ctx.summary(waiting);
        if (opts.plan) {
            ctx.out('changes=false');
            ctx.out('summary=waiting for the DRIVE_API_KEY secret');
        }
        return 0;
    }
    if (!opts.fixture && ctx.apiKey && !/^[\x21-\x7e]+$/.test(ctx.apiKey)) {
        // said before anything is sent, and without printing the key
        throw new Problem('The DRIVE_API_KEY secret holds a space, a line break or an invisible character, which no key has. '
            + 'Copy the key again and save the secret once more.');
    }
    const source = opts.fixture ? fixtureSource(opts.fixture) : driveSource(ctx);
    const roots = source.roots || config.roots;

    ctx.log(`Drive sync: reading ${plural(roots.length, 'folder')} through ${source.label}`);
    const tree = await crawl(ctx, source, roots, config.hidden);
    const files = tree.top.reduce((all, root) => flatten(root, [], all, new Set(all.map((f) => f.id))), []);
    const { media, counts, cut } = selectMedia(files, { hidden: config.hidden, builtin, limit: ctx.limits.files });
    reportListing(ctx, tree, files, media, counts);
    // "labels" in drive.config.json: the site shows its own name for a Drive folder
    media.forEach((item) => { item.group = config.labels.get(item.group.toLowerCase()) || item.group; });

    const plan = makePlan(ctx, prev, media, opts.retry);
    const work = plan.steps.filter((step) => step.action !== 'keep');
    const firstRun = !fs.existsSync(ctx.manifestFile);     // the page expects the file to exist, even when empty
    if (opts.plan) {
        const carried = buildManifest(prev, plan, new Map());
        const details = firstRun || !sameContent(prev, carried) || unusedAssets(ctx, carried).length > 0;
        const changes = work.length > 0 || plan.gone.length > 0 || details;
        work.forEach((step) => ctx.note(`  would ${step.action} ${label(step.item)}`));
        plan.gone.forEach((item) => ctx.note(`  would remove "${tidy(item.title, 80)}"`));
        ctx.out(`changes=${changes}`);
        ctx.out(`summary=${planSummary(plan, details)}`);
        return 0;
    }

    if (work.length) await checkTools(ctx);
    const outcomes = new Map();
    const run = async (step) => {
        const outcome = await attempt(ctx, source, step);
        outcomes.set(step.item.id, outcome);
        reportOutcome(ctx, step, outcome);
    };
    // pictures first (quick), then videos one at a time (ffmpeg already uses every core)
    await mapLimit(work.filter((step) => step.item.kind === 'image'), ctx.limits.imports, run);
    for (const step of work.filter((step) => step.item.kind === 'video')) await run(step);

    const next = buildManifest(prev, plan, outcomes);
    const changed = firstRun || !sameContent(prev, next);
    if (changed) {
        next.syncedAt = ctx.now().toISOString().replace(/\.\d+Z$/, 'Z');
        writeManifest(ctx, next);
        ctx.touched = true;
    }
    for (const item of plan.gone) ctx.log(`- removed "${tidy(item.title, 80)}": ${removalReason(item.id, { hidden: config.hidden, builtin, cut })}`);
    const unused = unusedAssets(ctx, next);
    unused.forEach((name) => fs.rmSync(path.join(ctx.assetDir, name), { force: true }));
    if (unused.length) ctx.touched = true;

    const tally = (kind) => [...outcomes.values()].filter((outcome) => outcome.kind === kind).length;
    const waiting = tally('deferred');
    if (waiting) ctx.log(`${plural(waiting, 'file')} left for the next run (this run used its time).`);
    const done = `Done: ${tally('done') + tally('limited')} imported, ${tally('failed')} failed, ${plan.gone.length} removed, `
        + `${plan.steps.length - work.length} unchanged. ${changed ? 'data/drive.json updated' : 'data/drive.json unchanged'}; `
        + `assets/drive holds ${fileSize(mediaBytes(ctx))}.`;
    ctx.log(done);
    ctx.summary(done);
    return 0;
}

/* ---------------------------------------------------------------
   7. Command line
   --------------------------------------------------------------- */
const USAGE = 'Usage: node tools/drive-sync.mjs [--plan] [--retry] [--verbose] [--fixture <dir> --root <dir>]';

function parseArgs(argv) {
    const opts = { plan: false, retry: false, verbose: false, help: false, fixture: '', root: '' };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--plan') opts.plan = true;
        else if (arg === '--retry') opts.retry = true;
        else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
        else if (arg === '--help' || arg === '-h') opts.help = true;
        else if (arg === '--fixture' || arg === '--root') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Problem(`${arg} needs a folder path.`);
            opts[arg.slice(2)] = argv[++i];
        } else throw new Problem(`Unknown option: ${tidy(arg, 40)}`);
    }
    // the test mode must never be pointed at the real site by accident
    if (opts.fixture && !opts.root) throw new Problem('--fixture needs --root <dir>: the folder that plays the site.');
    return opts;
}

function selfPath() {
    let file = decodeURIComponent(new URL(import.meta.url).pathname);
    if (/^\/[A-Za-z]:/.test(file)) file = file.slice(1);    // file:///C:/x -> C:/x
    return path.resolve(file);
}

function tempBase(env, root) {
    for (const key of ['RUNNER_TEMP', 'TMPDIR', 'TEMP', 'TMP']) {
        if (env[key] && fs.existsSync(env[key])) return env[key];
    }
    return fs.existsSync('/tmp') ? '/tmp' : root;
}

function makeContext(opts, io) {
    const env = io.env || process.env;
    const out = io.out || ((line) => process.stdout.write(`${line}\n`));
    const err = io.err || ((line) => process.stderr.write(`${line}\n`));
    const root = path.resolve(opts.root || path.dirname(path.dirname(selfPath())));
    const onGitHub = env.GITHUB_ACTIONS === 'true';
    // A file or folder name on Drive may hold "##[", which the GitHub runner reads as a log command
    // wherever it stands in a line. Nothing this tool prints needs that sequence, so it is broken up.
    const plain = (line) => String(line).replace(/##\[/g, '# [');
    const flag = (level, message) => {
        if (onGitHub) err(`::${level} title=Drive sync::${plain(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    };
    const log = opts.plan ? (line) => err(plain(line)) : (line) => out(plain(line));      // --plan keeps stdout for its two answer lines
    const { DRIVE_API_KEY: key, ...childEnv } = env;    // ffmpeg has no use for the key
    return {
        root, env, out, childEnv,
        assetDir: path.join(root, 'assets', 'drive'),
        manifestFile: path.join(root, 'data', 'drive.json'),
        limits: { ...LIMITS, ...(io.limits || {}) },
        fetch: io.fetch || globalThis.fetch,
        now: io.now || (() => new Date()),
        apiKey: opts.fixture ? '' : str(key).trim(),
        ffmpeg: env.FFMPEG || 'ffmpeg',
        ffprobe: env.FFPROBE || 'ffprobe',
        canToneMap: false,
        started: Date.now(),
        touched: false,
        tmp: '',
        log,
        note: (line) => { if (opts.verbose) log(line); },
        warn: (message) => { log(`! ${message}`); flag('warning', message); },
        fail: (message) => { err(plain(`Error: ${message}`)); flag('error', message); },
        summary: (line) => {
            if (!env.GITHUB_STEP_SUMMARY) return;
            try {
                fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `**Google Drive sync**\n\n${line}\n`);
            } catch (error) { /* the summary page is optional */ }
        }
    };
}

export async function main(argv = process.argv.slice(2), io = {}) {
    const err = io.err || ((line) => process.stderr.write(`${line}\n`));
    let opts;
    try {
        opts = parseArgs(argv);
    } catch (error) {
        err(`${error.message}\n${USAGE}`);
        return 2;
    }
    if (opts.help) {
        (io.out || ((line) => process.stdout.write(`${line}\n`)))(USAGE);
        return 0;
    }
    if (Number(process.versions.node.split('.')[0]) < 20) {
        err(`Error: this tool needs Node 20 or newer (this is ${process.versions.node}). Nothing was changed.`);
        return 1;
    }
    const ctx = makeContext(opts, io);
    try {
        if (!opts.plan) ctx.tmp = fs.mkdtempSync(path.join(tempBase(ctx.env, ctx.root), 'drive-sync-'));
        return await sync(ctx, opts);
    } catch (error) {
        const known = error instanceof Problem;
        if (known && error.hiccup && !ctx.touched) {
            // Google did not answer properly this once. Failing the run would only send the owner an email they can do nothing about.
            ctx.warn(`${error.message} This run was skipped. Nothing was changed; the next run tries again.`);
            if (opts.plan) {
                ctx.out('changes=false');
                ctx.out('summary=skipped, Google did not answer');
            }
            return 0;
        }
        const after = ctx.touched ? 'The run stopped early; data/drive.json and assets/drive are tidied up by the next run.' : 'Nothing was changed.';
        ctx.fail(`${known ? error.message : `Unexpected error: ${(error && error.stack) || error}`} ${after}`);
        return 1;
    } finally {
        if (ctx.tmp) fs.rmSync(ctx.tmp, { recursive: true, force: true });
    }
}

function isMain() {
    if (!process.argv[1]) return false;
    const real = (file) => {
        try {
            return fs.realpathSync.native(file);
        } catch (error) {
            return path.resolve(file);
        }
    };
    const a = real(process.argv[1]);
    const b = real(selfPath());
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
    main().then((code) => { process.exitCode = code; }, (error) => {
        process.stderr.write(`Error: ${(error && error.stack) || error}\n`);
        process.exitCode = 1;
    });
}
