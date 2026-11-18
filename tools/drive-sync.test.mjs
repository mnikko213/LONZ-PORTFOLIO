/* Tests for tools/drive-sync.mjs. Run from the repo root:  node --test tools/

   Nothing here uses the network. Folder pages come from tools/fixtures/ (saved from Google, plus one
   hand-built page with every entry shape), downloads come from a fake fetch, and the import path runs on
   tiny media made with ffmpeg in a temp folder. Without ffmpeg those tests are skipped with a message. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    main, parseFolderId, parseHiddenId, cleanTitle, classify, naturalCompare, parseListedDate, changedOnDrive,
    decide, parseFolderPage, entryFromApi, exifOrientation, fixtureId, decodeEntities
} from './drive-sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'drive-sync.mjs');
const page = (name) => fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const NOW = new Date('2026-11-18T06:30:00Z');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const haveFfmpeg = [FFMPEG, FFPROBE].every((tool) => spawnSync(tool, ['-version'], { windowsHide: true }).status === 0);
const NEEDS_FFMPEG = haveFfmpeg ? false : 'ffmpeg and ffprobe were not found (put them on PATH or set FFMPEG / FFPROBE)';

const temp = [];
const tempDir = (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temp.push(dir);
    return dir;
};
after(() => temp.forEach((dir) => {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) { /* a leftover temp folder is not worth a red test */ }
}));

/* ---------- helpers ---------- */

// A site folder with a drive.config.json, as the script expects to find it. Reading the public folder
// pages is an opt-in ("access": "public-page"); most tests here exercise that path, so the helper opts in.
function makeSite({ folders = [], hidden = [], builtin = null, access = 'public-page', labels = null } = {}) {
    const root = tempDir('drive-sync-site-');
    fs.writeFileSync(path.join(root, 'drive.config.json'), JSON.stringify({ folders, hidden, access, ...(labels ? { labels } : {}) }));
    if (builtin) {
        fs.mkdirSync(path.join(root, 'data'));
        fs.writeFileSync(path.join(root, 'data', 'drive-builtin.json'), JSON.stringify({ items: builtin }));
    }
    return root;
}

const setConfig = (root, config) => fs.writeFileSync(path.join(root, 'drive.config.json'), JSON.stringify(config));
const manifest = (root) => JSON.parse(fs.readFileSync(path.join(root, 'data', 'drive.json'), 'utf8'));
const manifestBytes = (root) => fs.readFileSync(path.join(root, 'data', 'drive.json'));
const assets = (root) => (fs.existsSync(path.join(root, 'assets', 'drive')) ? fs.readdirSync(path.join(root, 'assets', 'drive')).sort() : []);

// Every file under a folder with its content hash and modification time.
function snapshot(root) {
    const seen = {};
    const walk = (dir) => {
        for (const one of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, one.name);
            if (one.isDirectory()) walk(file);
            else seen[path.relative(root, file)] = `${crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')} ${fs.statSync(file).mtimeMs}`;
        }
    };
    walk(root);
    return seen;
}

async function run(root, args = [], io = {}) {
    const out = [];
    const err = [];
    const code = await main(['--root', root, ...args], {
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        env: { ...process.env, DRIVE_API_KEY: '', GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', ...(io.env || {}) },
        fetch: io.fetch || (async () => { throw new TypeError('fetch failed'); }),
        now: () => io.now || NOW,
        limits: { backoffMs: 1, ...(io.limits || {}) }
    });
    return { code, out, err, all: [...out, ...err].join('\n') };
}

// Builds a folder page with the exact markup of the saved real pages.
const realPage = page('folder-web-designs.html');
const PAGE_HEAD = realPage.slice(0, realPage.indexOf('<div class="flip-entries">') + '<div class="flip-entries">'.length);
const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function folderPage(title, entries) {
    const rows = entries.map((e) => {
        const href = e.folder ? `https://drive.google.com/drive/folders/${e.id}` : `https://drive.google.com/file/d/${e.id}/view?usp=drive_web`;
        const icon = e.folder ? '<div aria-label="Folder" class="icon-color-1 drive-sprite-folder-list-shared-icon"></div>'
            : `<img src="https://drive-thirdparty.googleusercontent.com/16/type/${e.mime || 'image/png'}" alt=""/>`;
        return `<div class="flip-entry" id="entry-${e.id}" tabindex="0" role="link"><div class="flip-entry-info"><a href="${href}" target="_blank">`
            + `<div class="flip-entry-list-icon">${icon}</div><div class="flip-entry-title">${esc(e.name)}</div></a></div>`
            + `<div class="flip-entry-last-modified"><div>${e.date || 'Mar 9'}</div></div></div>`;
    });
    return `${PAGE_HEAD.replace('<title>WEB DESIGNS</title>', `<title>${esc(title)}</title>`)}${rows.join('')}</div></div></body></html>`;
}

// A pretend Google: folder pages, file downloads, preview pictures and the Drive API, all from memory.
function fakeDrive({ folders = {}, files = {}, previews = {}, api = null } = {}) {
    const calls = [];
    const keyed = [];      // every host that was sent an API key
    const answer = (body, type, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
    const serve = (thing, type) => {
        if (thing === undefined) return answer(page('error-404.html'), 'text/html; charset=utf-8', 404);
        if (typeof thing === 'number') return answer('busy', 'text/plain', thing);
        if (thing === 'offline') throw new TypeError('fetch failed');
        if (thing === 'webpage') return answer('<html><title>Google Drive - Virus scan warning</title></html>', 'text/html; charset=utf-8');
        return answer(typeof thing === 'string' ? thing : fs.readFileSync(thing.file), type || thing.type);
    };
    const fetch = async (url, init = {}) => {
        const u = new URL(url);
        const id = u.searchParams.get('id') || u.pathname.replace(/^\/d\//, '').split('=')[0];
        calls.push(`${u.host}${u.pathname.startsWith('/d/') ? '/d/' : u.pathname} ${id}`);
        if ((init.headers || {})['x-goog-api-key']) keyed.push(u.host);
        if (u.host === 'drive.google.com' && u.pathname === '/embeddedfolderview') return serve(folders[id], 'text/html; charset=utf-8');
        if (u.host === 'drive.usercontent.google.com') return serve(files[id]);
        if (u.host === 'lh3.googleusercontent.com') return previews[id] ? serve({ file: previews[id], type: 'image/png' }) : answer('nope', 'text/html', 500);
        if (u.host === 'www.googleapis.com' && api) return api(u, init);
        throw new TypeError('fetch failed');
    };
    return { fetch, calls, keyed, downloads: () => calls.filter((c) => c.startsWith('drive.usercontent.google.com')).length };
}

const ROOT = 'root-folder-00000001';
const SUB = 'sub-folder-000000001';
const LINK = `https://drive.google.com/drive/folders/${ROOT}`;

/* ---------- 1. pure helpers ---------- */

test('folder links: every usual shape gives the id, anything else is refused', () => {
    const id = '1bbLJtDv6jUpr_zYZG6JoOniDPYJIz0H6';
    for (const ref of [
        id, `  ${id}  `,
        `https://drive.google.com/drive/folders/${id}`,
        `https://drive.google.com/drive/folders/${id}?usp=sharing`,
        `https://drive.google.com/drive/u/0/folders/${id}?usp=drive_link`,
        `https://drive.google.com/drive/mobile/folders/${id}`,
        `https://drive.google.com/open?id=${id}`,
        `https://drive.google.com/embeddedfolderview?id=${id}#list`,
        `drive.google.com/drive/folders/${id}`
    ]) assert.equal(parseFolderId(ref), id, ref);
    for (const ref of ['', 'short', null, 42, 'https://drive.google.com/drive/folders/', 'https://drive.google.com/drive/folders/abc',
        `https://drive.google.com/file/d/${id}/view`, `https://www.dropbox.com/folders/${id}`, `https://evil.example/drive/folders/${id}`,
        `${id}/../../etc`, 'has spaces in it and is long enough']) assert.equal(parseFolderId(ref), null, String(ref));
});

test('hidden entries: a bare id, a file link or a folder link', () => {
    const id = '165_SOpVekL-4LK5LgaW_X5qydLHZUBqc';
    assert.equal(parseHiddenId(id), id);
    assert.equal(parseHiddenId(`https://drive.google.com/file/d/${id}/view?usp=drive_link`), id);
    assert.equal(parseHiddenId(`https://drive.google.com/drive/folders/${id}`), id);
    assert.equal(parseHiddenId(`https://drive.google.com/open?id=${id}`), id);
    assert.equal(parseHiddenId('G-1.png'), null);
});

test('titles: extension off, underscores to spaces, ordering prefix off only when letters remain', () => {
    const cases = {
        'G-1.png': 'G-1',
        'POSTER - 29.JPG': 'POSTER - 29',
        '8Box Solutions Inc. PART 1.png': '8Box Solutions Inc. PART 1',
        '01 - Launch teaser.mp4': 'Launch teaser',
        '003_final_cut.mov': 'final cut',
        '1. Intro.mp4': 'Intro',
        '2) Second   one.webp': 'Second one',
        '01-Title.jpg': 'Title',
        '01 - 02.png': '01 - 02',
        '007.jpg': '007',
        '2024_Portfolio.png': '2024 Portfolio',
        '24 Hours promo.mp4': '24 Hours promo',
        '2-in-1 combo.png': '2-in-1 combo',
        '1.5x speed.mp4': '1.5x speed',
        '3D Logo.webm': '3D Logo',
        'behind_the_scenes.MOV': 'behind the scenes',
        'Showreel 2026': 'Showreel 2026',
        'Poster v2.5': 'Poster v2.5',
        'archive.tar.gz': 'archive.tar.gz',
        '  spaced\t out  .jpeg': 'spaced out',
        'line\nbreak‮.png': 'line break',
        '.png': 'Untitled',
        '___.mp4': 'Untitled'
    };
    for (const [name, title] of Object.entries(cases)) assert.equal(cleanTitle(name), title, JSON.stringify(name));
    assert.equal(cleanTitle(`${'x'.repeat(500)}.png`).length, 120);
});

test('classification: the mime type decides, the extension is the fallback', () => {
    const cases = [
        ['a.png', 'image/png', 'image'], ['a.JPG', 'image/jpeg', 'image'], ['a.webp', '', 'image'], ['a.gif', '', 'image'],
        ['IMG_1.HEIC', 'image/heif', 'image'], ['a.heic', '', 'image'], ['a.jpeg', '', 'image'],
        ['a.mp4', 'video/mp4', 'video'], ['a.mov', 'video/quicktime', 'video'], ['a.webm', '', 'video'], ['a.m4v', '', 'video'],
        ['a.mkv', 'video/x-matroska', 'video'], ['a.avi', 'video/x-msvideo', 'video'],
        ['No extension', 'video/mp4', 'video'], ['No extension', 'image/png', 'image'],
        ['raw.mkv', 'application/octet-stream', 'video'], ['phone.mp4', 'video/3gpp', 'video'],
        ['folder.png', 'application/vnd.google-apps.folder', 'folder'],
        ['notes.png', 'text/plain', 'other'], ['a.psd', 'image/vnd.adobe.photoshop', 'other'], ['logo.svg', 'image/svg+xml', 'other'],
        ['a.pdf', 'application/pdf', 'other'], ['a.zip', '', 'other'], ['Doc', 'application/vnd.google-apps.document', 'other'],
        ['Link', 'application/vnd.google-apps.shortcut', 'other'], ['a.png.exe', '', 'other'], ['a.tiff', 'image/tiff', 'other'], ['', '', 'other']
    ];
    for (const [name, mime, kind] of cases) assert.equal(classify(name, mime), kind, `${name} (${mime})`);
});

test('natural sort: numbers by value, case ignored, never ambiguous', () => {
    const names = ['G-10.png', 'g-2.png', 'G-1.png', 'G-28.png', 'G-9.png', 'POSTER - 30.PNG', 'POSTER - 29.JPG', 'a10b2', 'a10b10', 'A2', 'a02', 'a2'];
    assert.deepEqual([...names].sort(naturalCompare),
        ['A2', 'a02', 'a2', 'a10b2', 'a10b10', 'G-1.png', 'g-2.png', 'G-9.png', 'G-10.png', 'G-28.png', 'POSTER - 29.JPG', 'POSTER - 30.PNG']);
    assert.deepEqual([...names].reverse().sort(naturalCompare), [...names].sort(naturalCompare), 'the input order does not matter');
    assert.equal(naturalCompare('same', 'same'), 0);
    assert.ok(naturalCompare('99999999999999999999998', '99999999999999999999999') < 0);
});

test('listed dates: US short date, month + day (year guessed), clock time, and rubbish', () => {
    const date = (shown, now = NOW) => parseListedDate(shown, now);
    assert.deepEqual(date('10/17/25'), { modified: '2025-10-17', rev: '' });
    assert.deepEqual(date('1/5/2024'), { modified: '2024-01-05', rev: '' });
    assert.deepEqual(date('Mar 9'), { modified: '2026-03-09', rev: '' });
    assert.deepEqual(date('Jun 14, 2023'), { modified: '2023-06-14', rev: '' });
    assert.deepEqual(date('Nov 18'), { modified: '2026-11-18', rev: '' });
    // just after New Year our clock is ahead of Google's: "Dec 30" still means last year
    assert.deepEqual(date('Dec 30', new Date('2027-01-01T03:00:00Z')), { modified: '2026-12-30', rev: '' });
    assert.deepEqual(date('2:14 PM'), { modified: '2026-11-18', rev: '14:14' });
    assert.deepEqual(date('12:05 AM'), { modified: '2026-11-18', rev: '00:05' });
    assert.deepEqual(date('12:30 pm'), { modified: '2026-11-18', rev: '12:30' });
    assert.deepEqual(date('23:59'), { modified: '2026-11-18', rev: '23:59' });
    for (const junk of ['', 'Yesterday', '17.10.25', '17/10/2025', '2/30/25', 'Foo 9', '25:00', undefined]) {
        assert.deepEqual(date(junk), { modified: '', rev: '' }, String(junk));
    }
});

test('changedOnDrive: a real change is seen, a display quirk is not', () => {
    const day = (modified, rev = '') => ({ modified, rev });
    assert.equal(changedOnDrive(day('2026-03-09'), day('2026-03-09')), false);
    assert.equal(changedOnDrive(day('2026-03-09'), day('2026-03-10')), true);
    assert.equal(changedOnDrive(day(''), day('2026-03-10')), false, 'unknown before');
    assert.equal(changedOnDrive(day('2026-03-09'), day('')), false, 'unknown now');
    // imported on the day it changed (clock time), then the page shows a day that may be off by one
    assert.equal(changedOnDrive(day('2026-11-18', '14:14'), day('2026-11-18', '14:14')), false);
    assert.equal(changedOnDrive(day('2026-11-18', '14:14'), day('2026-11-18', '17:30')), true, 'replaced the same day');
    assert.equal(changedOnDrive(day('2026-11-18', '14:14'), day('2026-11-17')), false, 'time zone slack');
    assert.equal(changedOnDrive(day('2026-11-18', '14:14'), day('2026-11-19')), false, 'time zone slack');
    assert.equal(changedOnDrive(day('2026-11-18', '14:14'), day('2026-11-21')), true);
    // a clock time means "changed today": always newer than a day recorded earlier
    assert.equal(changedOnDrive(day('2026-11-18'), day('2026-11-18', '09:00')), true);
    assert.equal(changedOnDrive(day(''), day('2026-11-18', '09:00')), true);
    // Drive API timestamps are exact
    const t1 = '2026-11-18T06:14:03.000Z';
    assert.equal(changedOnDrive(day('2026-11-18', t1), day('2026-11-18', t1)), false);
    assert.equal(changedOnDrive(day('2026-11-18', t1), day('2026-11-18', '2026-11-18T09:00:00.000Z')), true);
    // switching between the folder page and the API must not re-import everything
    assert.equal(changedOnDrive(day('2026-03-09'), day('2026-03-10', '2026-03-10T01:00:00.000Z')), false);
    assert.equal(changedOnDrive(day('2026-03-10', '2026-03-10T01:00:00.000Z'), day('2026-03-09')), false);
    assert.equal(changedOnDrive(day('2026-03-09'), day('2026-03-12', '2026-03-12T01:00:00.000Z')), true);
});

test('decide: add, update, retry or keep', () => {
    const item = { id: 'x'.repeat(20), kind: 'image', modified: '2026-03-09', rev: '' };
    const prev = { type: 'image', modified: '2026-03-09' };
    assert.equal(decide(item, undefined, undefined), 'add');
    assert.equal(decide(item, prev, undefined), 'keep');
    assert.equal(decide({ ...item, modified: '2026-04-01' }, prev, undefined), 'update');
    assert.equal(decide(item, prev, undefined, { present: false }), 'update', 'files went missing');
    assert.equal(decide({ ...item, kind: 'video' }, prev, undefined), 'update', 'type changed');
    const failed = (why, tries) => ({ problem: { why, tries, modified: '2026-03-09' } });
    assert.equal(decide(item, undefined, failed('download', 1)), 'retry');
    assert.equal(decide(item, undefined, failed('download', 3)), 'keep', 'gave up');
    assert.equal(decide(item, undefined, failed('download', 3), { retry: true }), 'retry', 'manual run');
    assert.equal(decide({ ...item, modified: '2026-04-01' }, undefined, failed('download', 3)), 'add', 'a new version starts over');
    assert.equal(decide(item, undefined, failed('long')), 'keep');
    assert.equal(decide(item, undefined, failed('long'), { retry: true }), 'keep', 'a manual run cannot shorten a video');
    assert.equal(decide(item, undefined, failed('full'), { room: false }), 'keep');
    assert.equal(decide(item, undefined, failed('full'), { room: true }), 'retry');
    // an update that failed: the old version stays and the new one is not hammered forever
    const stuck = { problem: { why: 'convert', tries: 3, modified: '2026-04-01' } };
    assert.equal(decide({ ...item, modified: '2026-04-01' }, prev, stuck), 'keep');
    assert.equal(decide({ ...item, modified: '2026-05-05' }, prev, stuck), 'update');
});

test('EXIF orientation is read from the JPEG header', () => {
    const exif = (order, value) => {
        const le = order === 'II';
        const tiff = Buffer.alloc(26);
        tiff.write(order, 0, 'latin1');
        if (le) { tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(value, 18); }
        else { tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4); tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(value, 18); }
        const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
        head.writeUInt16BE(2 + 6 + tiff.length, 4);
        return Buffer.concat([head, Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from([0xff, 0xda, 0, 2])]);
    };
    assert.equal(exifOrientation(exif('II', 6)), 6);
    assert.equal(exifOrientation(exif('MM', 8)), 8);
    assert.equal(exifOrientation(exif('MM', 99)), 1, 'nonsense value');
    assert.equal(exifOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xda, 0, 2])), 1, 'no EXIF');
    assert.equal(exifOrientation(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')), 1, 'not a JPEG');
    assert.equal(exifOrientation(Buffer.alloc(0)), 1);
    assert.equal(exifOrientation(exif('II', 6).subarray(0, 20)), 1, 'cut off');
});

test('fixture ids are stable, valid and do not depend on the slash style', () => {
    assert.equal(fixtureId('Posters/a.png'), fixtureId('Posters\\a.png'));
    assert.notEqual(fixtureId('Posters/a.png'), fixtureId('Posters/b.png'));
    assert.match(fixtureId('x'), /^[A-Za-z0-9_-]{15,}$/);
    assert.equal(fixtureId('Posters/a.png'), 'fixture-9e292130cac2aa5b', 'the same on every machine');
});

test('HTML entities in names are decoded', () => {
    assert.equal(decodeEntities('Tom &amp; Jerry&#39;s &lt;b&gt; &quot;x&quot; &#x1F600; &unknown;'), 'Tom & Jerry\'s <b> "x" \u{1F600} &unknown;');
});

/* ---------- 2. the folder page parser, against saved pages ---------- */

describe('folder page parser', () => {
    test('a folder of folders (saved from Google)', () => {
        const got = parseFolderPage(page('folder-root.html'), NOW);
        assert.equal(got.name, 'GRAPHIC DESIGNS');
        assert.deepEqual(got.entries.map((e) => [e.id, e.name, e.kind]), [
            ['1d-swrKHI2fP6XZzm7i97a6ewqaP05X60', 'Archives', 'folder'],
            ['1FlrsAOZxZsGJUlYPs2EupcnmWusyhSsw', 'Pong Soles', 'folder']
        ]);
    });

    test('a folder of pictures (saved from Google)', () => {
        const got = parseFolderPage(page('folder-web-designs.html'), NOW);
        assert.equal(got.name, 'WEB DESIGNS');
        assert.deepEqual(got.entries[0], {
            id: '1sgTtjnEbeM8V3RLIWj_5hf8D0RWscc6D', name: '8Box Solutions Inc. PART 1.png', kind: 'image', mime: 'image/png',
            modified: '2026-03-09', rev: '', size: 0, seconds: 0, caption: '', thumb: ''
        });
        assert.equal(got.entries.length, 3);
    });

    test('mixed-case extensions and jpeg / png mime types (saved from Google)', () => {
        const got = parseFolderPage(page('folder-archives.html'), NOW);
        assert.equal(got.entries.length, 14);
        assert.ok(got.entries.every((e) => e.kind === 'image' && e.modified === '2026-03-09'));
        assert.deepEqual(got.entries.slice(0, 2).map((e) => [e.name, e.mime]), [['POSTER - 29.JPG', 'image/jpeg'], ['POSTER - 30.PNG', 'image/png']]);
    });

    test('every entry shape: folders, videos, documents, odd names, clock times', () => {
        const got = parseFolderPage(page('folder-mixed.html'), NOW);
        assert.equal(got.name, 'MIXED & MATCHED');
        const brief = Object.fromEntries(got.entries.map((e) => [e.name, `${e.kind} ${e.modified} ${e.rev}`.trim()]));
        assert.deepEqual(brief, {
            'Clips & Reels': 'folder 2026-03-09',
            '01 - Launch teaser.mp4': 'video 2026-11-18 14:14',
            'behind_the_scenes.MOV': 'video 2025-11-02',
            "Client's logo & mark.png": 'image 2026-03-09',
            'Brief.pdf': 'other 2026-03-09',
            'Mood board': 'other 2026-03-09',
            'source files.zip': 'other 2024-01-05',
            'poster-final.psd': 'other 2026-03-09',
            'Showreel 2026': 'video 2026-06-14',
            'notes.png': 'other 2026-03-09',
            'raw-dump.mkv': 'video 2026-03-09',
            'G-10.jpg': 'image 2025-10-24',
            'G-2.JPG': 'image 2025-10-17'
        });
    });

    test('an empty folder is fine', () => {
        assert.deepEqual(parseFolderPage(page('folder-empty.html'), NOW), { name: 'Empty folder', entries: [] });
    });

    test('a folder entry is read through the id its link opens', () => {
        const shortcut = page('folder-root.html').replace('id="entry-1d-swrKHI2fP6XZzm7i97a6ewqaP05X60"', 'id="entry-1ShortcutIdAAAAAAAAAAAAAAAAAAAAAAAA"');
        assert.deepEqual(parseFolderPage(shortcut, NOW).entries.map((e) => [e.id, e.kind]),
            [['1d-swrKHI2fP6XZzm7i97a6ewqaP05X60', 'folder'], ['1FlrsAOZxZsGJUlYPs2EupcnmWusyhSsw', 'folder']]);
    });

    test('anything that is not a complete folder list is refused', () => {
        assert.throws(() => parseFolderPage(page('error-404.html'), NOW), /Error 404/);
        assert.throws(() => parseFolderPage('<html><title>Sign in</title><body>Sign in to continue</body></html>', NOW), /not a Drive folder list/);
        assert.throws(() => parseFolderPage('', NOW), /not a Drive folder list/);
        const good = page('folder-web-designs.html');
        assert.throws(() => parseFolderPage(good.slice(0, good.length - 400), NOW), /incomplete/);
        assert.throws(() => parseFolderPage(good.replace('<div class="flip-entry-title">', '<div class="new-title-class">'), NOW), /could not be read/);
        assert.throws(() => parseFolderPage(good.replace('id="entry-1sgTtjnEbeM8V3RLIWj_5hf8D0RWscc6D"', 'id="entry-../../x"'), NOW), /could not be read/);
        assert.throws(() => parseFolderPage(good.replace('class="flip-entry" id="entry-1y09', 'class="flip-entry" data-x="1" id="entry-1y09'), NOW), /could not be read/);
    });
});

/* ---------- 3. the safety rule and the listing sources (no ffmpeg needed) ---------- */

// A site that already shows one Drive picture, so there is something to lose.
function siteWithOnePicture(config) {
    const root = makeSite(config);
    const id = 'old-picture-00000001';
    fs.mkdirSync(path.join(root, 'assets', 'drive'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'drive', `${id}.webp`), 'full');
    fs.writeFileSync(path.join(root, 'assets', 'drive', `${id}-sm.webp`), 'small');
    fs.writeFileSync(path.join(root, 'data', 'drive.json'), `${JSON.stringify({
        version: 1, syncedAt: '2026-01-01T00:00:00Z',
        items: [{ id, type: 'image', title: 'Old picture', group: 'Art', path: ['Root', 'Art'], modified: '2026-01-01',
            drive: `https://drive.google.com/file/d/${id}/view`, src: `assets/drive/${id}.webp`, w: 10, h: 10, thumb: `assets/drive/${id}-sm.webp`, tw: 5, th: 5 }]
    }, null, 2)}\n`);
    return root;
}

describe('safety: a folder that cannot be listed changes nothing', () => {
    const second = 'second-root-0000001';
    const goodRoot = folderPage('Root', [{ id: SUB, name: 'Art', folder: true }]);
    // code 1: something the owner has to fix (the run fails and GitHub tells them).
    // code 0: Google did not answer properly this once (the run is skipped with a warning).
    const cases = {
        'a configured folder is private or deleted (Error 404 page)': { code: 1, folders: { [ROOT]: goodRoot, [SUB]: folderPage('Art', []) }, expect: /number 2 in drive\.config\.json \(second-root-0000001\).*HTTP 404/ },
        'a subfolder keeps answering HTTP 500': { code: 0, folders: { [ROOT]: goodRoot, [SUB]: 500, [second]: folderPage('Two', []) }, expect: /"Art" \(sub-folder-000000001\).*HTTP 500/ },
        'the answer is some other web page': { code: 0, folders: { [ROOT]: '<html><title>Sorry</title>unusual traffic</html>', [second]: folderPage('Two', []) }, expect: /number 1 in drive\.config\.json.*not a Drive folder list/ },
        'the network is down': { code: 0, folders: { [ROOT]: 'offline', [second]: 'offline' }, expect: /no answer from Google/ },
        'the page is cut off half way': { code: 0, folders: { [ROOT]: goodRoot.slice(0, -30), [second]: folderPage('Two', []) }, expect: /incomplete/ }
    };
    for (const [name, { code, folders, expect }] of Object.entries(cases)) {
        test(name, async () => {
            const root = siteWithOnePicture({ folders: [LINK, second] });
            const before = snapshot(root);
            for (const args of [[], ['--plan']]) {
                const drive = fakeDrive({ folders });
                const got = await run(root, args, { fetch: drive.fetch });
                assert.equal(got.code, code, got.all);
                assert.match(got.all, expect);
                assert.match(got.all, /Nothing was changed/);
                const answers = got.out.filter((line) => /^(changes|summary)=/.test(line));
                if (code === 0) {
                    assert.match(got.all, /This run was skipped/);
                    // the workflow reads these two lines; "no changes" keeps its later steps from running
                    assert.deepEqual(answers, args.length ? ['changes=false', 'summary=skipped, Google did not answer'] : []);
                } else {
                    assert.deepEqual(answers, [], 'no answer lines when the run failed');
                }
                assert.deepEqual(snapshot(root), before);
                assert.equal(drive.downloads(), 0);
            }
        });
    }

    test('without a key the run waits: Google is not contacted and nothing changes', async () => {
        const root = siteWithOnePicture({ folders: [LINK], access: 'api' });
        const before = snapshot(root);
        const drive = fakeDrive({ folders: { [ROOT]: folderPage('Root', []) } });
        const plan = await run(root, ['--plan'], { fetch: drive.fetch });
        assert.equal(plan.code, 0, plan.all);
        assert.deepEqual(plan.out, ['changes=false', 'summary=waiting for the DRIVE_API_KEY secret']);
        const got = await run(root, [], { fetch: drive.fetch });
        assert.equal(got.code, 0, got.all);
        assert.match(got.all, /waiting for its key/);
        assert.deepEqual(snapshot(root), before);
        // leaving "access" out means the same: the public pages are only read when the owner asks for it
        fs.writeFileSync(path.join(root, 'drive.config.json'), JSON.stringify({ folders: [LINK], hidden: [] }));
        assert.deepEqual((await run(root, ['--plan'], { fetch: drive.fetch })).out, ['changes=false', 'summary=waiting for the DRIVE_API_KEY secret']);
        assert.deepEqual(drive.calls, []);
        assert.deepEqual(snapshot(root), { ...before, 'drive.config.json': snapshot(root)['drive.config.json'] });
    });

    test('a broken drive.config.json changes nothing either', async () => {
        const root = siteWithOnePicture({ folders: [LINK] });
        const drive = fakeDrive({ folders: { [ROOT]: folderPage('Root', []) } });
        const broken = {
            '{ "folders": [ "https://drive.google.com/drive/folders/abc" ] }': /entry 1 of "folders" is not a Google Drive folder link/,
            '{ "folders": "nope" }': /"folders" must be a list/,
            [`{ "folders": [ "${LINK}" ], "hidden": [ "G-1.png" ] }`]: /entry 1 of "hidden"/,
            [`{ "folders": [ "${LINK}" ], "labels": [ "Posters" ] }`]: /"labels" must look like/,
            [`{ "folders": [ "${LINK}" ], "labels": { "Archives": "" } }`]: /"labels" must look like/,
            [`{ "folders": [ "${LINK}" ], "access": "scrape" }`]: /"access" must be "api" or "public-page"/,
            [`{ "folders": [ "${LINK}"  "x" ] }`]: /not valid JSON/,
            '': /not valid JSON/
        };
        for (const [config, expect] of Object.entries(broken)) {
            fs.writeFileSync(path.join(root, 'drive.config.json'), config);
            const before = snapshot(root);
            const got = await run(root, [], { fetch: drive.fetch });
            assert.equal(got.code, 1, config);
            assert.match(got.all, expect);
            assert.deepEqual(snapshot(root), before);
        }
        fs.rmSync(path.join(root, 'drive.config.json'));
        assert.match((await run(root, [], { fetch: drive.fetch })).all, /drive\.config\.json is missing/);
    });

    test('a broken data/drive.json is reported, not overwritten', async () => {
        const root = siteWithOnePicture({ folders: [LINK] });
        fs.writeFileSync(path.join(root, 'data', 'drive.json'), '<<<<<<< HEAD');
        const before = snapshot(root);
        const got = await run(root, [], { fetch: fakeDrive({ folders: { [ROOT]: folderPage('Root', []) } }).fetch });
        assert.equal(got.code, 1);
        assert.match(got.all, /data\/drive\.json is not valid JSON/);
        assert.deepEqual(snapshot(root), before);
    });
});

test('a trailing comma or a byte-order mark in drive.config.json is forgiven', async () => {
    const root = makeSite();
    fs.writeFileSync(path.join(root, 'drive.config.json'), `﻿{\n  "folders": [\n    "${LINK}",\n  ],\n  "hidden": [],\n  "access": "public-page",\n}\n`);
    const drive = fakeDrive({ folders: { [ROOT]: folderPage('Root, [x]', []) } });
    const got = await run(root, [], { fetch: drive.fetch });
    assert.equal(got.code, 0, got.all);
    assert.match(got.all, /folder "Root, \[x\]": 0 files in 1 folder/);
    // the first run always leaves a manifest behind, so the page never asks for a missing file
    assert.deepEqual(manifest(root).items, []);
    assert.deepEqual((await run(root, ['--plan'], { fetch: drive.fetch })).out, ['changes=false', 'summary=no changes']);
});

test('an empty "folders" list is treated as a slip, not as "remove everything"', async () => {
    const root = siteWithOnePicture({ folders: [] });
    const before = snapshot(root);
    const got = await run(root, []);
    assert.equal(got.code, 1);
    assert.match(got.all, /"folders" is empty/);
    assert.deepEqual(snapshot(root), before);
});

test('an emptied Drive folder really empties the site list (and only then)', async () => {
    const root = siteWithOnePicture({ folders: [LINK] });
    const drive = fakeDrive({ folders: { [ROOT]: page('folder-empty.html') } });
    assert.deepEqual((await run(root, ['--plan'], { fetch: drive.fetch })).out, ['changes=true', 'summary=1 removed']);
    const got = await run(root, [], { fetch: drive.fetch });
    assert.equal(got.code, 0, got.all);
    assert.match(got.all, /removed "Old picture": no longer in the Drive folders/);
    assert.deepEqual(manifest(root).items, []);
    assert.deepEqual(assets(root), []);
});

test('crawl: order, depth, hidden folders, built-in files, ignored files, the file limit', async () => {
    const deep = (n) => `deep-folder-0000000${n}`;
    const folders = {
        [ROOT]: page('folder-mixed.html').replace(/1FAKEfolder1x+/g, SUB),
        [SUB]: folderPage('renamed since', [
            { id: deep(1), name: 'Level 2', folder: true }, { id: 'hidden-folder-00001', name: 'Drafts', folder: true },
            { id: 'clip-in-sub-0000001', name: 'b.mp4', mime: 'video/mp4' }, { id: 'pic-in-sub-00000001', name: 'a.png' }
        ]),
        [deep(1)]: folderPage('x', [{ id: deep(2), name: 'Level 3', folder: true }]),
        [deep(2)]: folderPage('x', [{ id: deep(3), name: 'Level 4', folder: true }, { id: 'pic-level-3-0000001', name: 'deep.png' }]),
        [deep(3)]: folderPage('x', [{ id: 'pic-level-4-0000001', name: 'too deep.png' }])
    };
    const root = makeSite({ folders: [LINK, ROOT], hidden: ['hidden-folder-00001', `https://drive.google.com/file/d/${'1FAKEg10'.padEnd(33, 'x')}/view`], builtin: { ['1FAKEg2'.padEnd(33, 'x')]: { file: 'x' } } });
    const drive = fakeDrive({ folders });
    const got = await run(root, ['--plan', '--verbose'], { fetch: drive.fetch });
    assert.equal(got.code, 0, got.all);
    assert.deepEqual(got.out, ['changes=true', 'summary=8 new']);
    // a folder's own files in natural order, then its subfolders; the folder name comes from its parent's list
    const planned = got.err.filter((line) => line.includes('would add')).map((line) => line.trim().replace('would add ', ''));
    assert.deepEqual(planned, [
        'video "Launch teaser" (MIXED & MATCHED)', 'video "behind the scenes" (MIXED & MATCHED)', 'picture "Client\'s logo & mark" (MIXED & MATCHED)',
        'video "raw-dump" (MIXED & MATCHED)', 'video "Showreel 2026" (MIXED & MATCHED)',
        'picture "a" (Clips & Reels)', 'video "b" (Clips & Reels)', 'picture "deep" (Level 3)'
    ]);
    assert.match(got.all, /1 already built into the site/);
    assert.match(got.all, /2 hidden in drive\.config\.json/);
    assert.match(got.all, /5 other files ignored/);
    assert.match(got.all, /1 folder not read: only 3 levels/);
    assert.ok(!drive.calls.some((c) => c.includes('hidden-folder')), 'a hidden folder is not even listed');
    assert.equal(drive.calls.filter((c) => c.endsWith(ROOT)).length, 1, 'a folder configured twice is read once');

    // "labels": the site's own name for a Drive folder, whatever the letter case
    const hiddenOnes = ['hidden-folder-00001', `https://drive.google.com/file/d/${'1FAKEg10'.padEnd(33, 'x')}/view`];
    setConfig(root, { folders: [LINK], access: 'public-page', hidden: hiddenOnes, labels: { ' clips & reels ': 'Reels' } });
    const renamed = await run(root, ['--plan', '--verbose'], { fetch: drive.fetch });
    assert.match(renamed.all, /would add picture "a" \(Reels\)/);
    assert.match(renamed.all, /would add video "b" \(Reels\)/);
    assert.match(renamed.all, /would add video "Launch teaser" \(MIXED & MATCHED\)/);
    setConfig(root, { folders: [LINK, ROOT], access: 'public-page', hidden: hiddenOnes });

    const capped = await run(root, ['--plan', '--verbose'], { fetch: drive.fetch, limits: { files: 3 } });
    assert.deepEqual(capped.out, ['changes=true', 'summary=3 new']);
    assert.match(capped.all, /5 files left out: the site shows at most 3 Drive files/);
    assert.deepEqual(capped.err.filter((line) => line.includes('would add')).map((line) => line.trim()), planned.slice(0, 3).map((line) => `would add ${line}`));
});

describe('listing through the Drive API (DRIVE_API_KEY)', () => {
    const KEY = 'AIzaSy-not-a-real-key-000000000000000';
    const file = (id, name, mimeType, modifiedTime, extra = {}) => ({ id, name, mimeType, modifiedTime, ...extra });
    const api = (seen, { rootStatus = 200, listStatus = 200 } = {}) => (u, init) => {
        seen.push(u.pathname + u.search);
        const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if ((init.headers || {})['x-goog-api-key'] !== KEY) return json({ error: { message: 'API key not valid' } }, 400);
        if (u.pathname === `/drive/v3/files/${ROOT}`) {
            return rootStatus === 200 ? json({ id: ROOT, name: 'API Root', mimeType: 'application/vnd.google-apps.folder' })
                : json({ error: { message: `File not found: ${ROOT}. (key ${KEY})` } }, rootStatus);
        }
        if (listStatus !== 200) return json({ error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } }, listStatus);
        const q = u.searchParams.get('q');
        if (q === `'${ROOT}' in parents and trashed = false` && !u.searchParams.get('pageToken')) {
            return json({ nextPageToken: 'page two', files: [
                file(SUB, 'Sub', 'application/vnd.google-apps.folder', '2026-03-09T10:00:00.000Z'),
                file('api-picture-0000001', '02 - Poster.png', 'image/png', '2026-03-09T10:00:00.000Z', { size: '1234', imageMediaMetadata: { width: 10, height: 10 } })
            ] });
        }
        if (q === `'${ROOT}' in parents and trashed = false`) {
            assert.equal(u.searchParams.get('pageToken'), 'page two');
            return json({ files: [
                file('api-video-000000001', 'clip.mov', 'video/quicktime', '2026-11-18T05:00:00.000Z', { size: '999', videoMediaMetadata: { durationMillis: '2500' } }),
                file('api-doc-00000000001', 'Notes', 'application/vnd.google-apps.document', '2026-03-09T10:00:00.000Z'),
                file('api-shortcut-000001', 'Link.png', 'application/vnd.google-apps.shortcut', '2026-03-09T10:00:00.000Z')
            ] });
        }
        return json({ files: [] });
    };

    test('pagination, the same entry shape as the folder page, and the key never shows up in the log', async () => {
        const seen = [];
        const root = makeSite({ folders: [LINK], access: 'api' });
        const drive = fakeDrive({ api: api(seen) });
        const got = await run(root, ['--plan', '--verbose'], { fetch: drive.fetch, env: { DRIVE_API_KEY: KEY } });
        assert.equal(got.code, 0, got.all);
        assert.deepEqual(got.out, ['changes=true', 'summary=2 new']);
        assert.match(got.all, /through the Drive API/);
        assert.match(got.all, /folder "API Root": 4 files in 1 folder/);
        assert.match(got.all, /would add picture "Poster" \(API Root\)/);
        assert.match(got.all, /2 other files ignored/);
        assert.ok(!got.all.includes(KEY));
        assert.equal(seen.length, 4, 'folder check, two pages, one subfolder');
        // the key travels in a header, never in an address that could be logged
        assert.ok(!seen.some((url) => url.includes(KEY)));
        assert.deepEqual([...new Set(drive.keyed)], ['www.googleapis.com']);
        assert.match(seen[1], /fields=nextPageToken(%2C|,)files(%28|\()id(%2C|,)name(%2C|,)mimeType(%2C|,)modifiedTime(%2C|,)size(%2C|,)description(%2C|,)thumbnailLink(%2C|,)videoMediaMetadata(%2C|,)imageMediaMetadata(%29|\))/);

        const fromApi = entryFromApi(file('api-video-000000001', 'clip.mov', 'video/quicktime', '2026-11-18T05:00:00.000Z', { size: '999', videoMediaMetadata: { durationMillis: '2500' } }));
        assert.deepEqual(fromApi, { id: 'api-video-000000001', name: 'clip.mov', kind: 'video', mime: 'video/quicktime', modified: '2026-11-18', rev: '2026-11-18T05:00:00.000Z', size: 999, seconds: 2.5, caption: '', thumb: '' });
        // the description typed on Drive is the caption; only a Google picture address is kept as the thumbnail
        const described = entryFromApi(file('api-video-000000002', 'ad.mp4', 'video/mp4', '2026-11-18T05:00:00.000Z',
            { description: '  Pet care ad,\n 60 seconds ', thumbnailLink: 'https://lh3.googleusercontent.com/drive-storage/abc=s220' }));
        assert.deepEqual([described.caption, described.thumb], ['Pet care ad, 60 seconds', 'https://lh3.googleusercontent.com/drive-storage/abc=s220']);
        assert.equal(entryFromApi(file('api-video-000000003', 'x.mp4', 'video/mp4', '', { thumbnailLink: 'http://lh3.googleusercontent.com.evil.example/x=s220' })).thumb, '');
        assert.equal(entryFromApi(file('api-video-000000004', 'x.mp4', 'video/mp4', '', { thumbnailLink: 'https://evil.example/x=s220', description: 7 })).caption, '');
        assert.deepEqual(Object.keys(fromApi), Object.keys(parseFolderPage(page('folder-web-designs.html'), NOW).entries[0]));
        assert.throws(() => entryFromApi({ id: '../x', name: 'a.png' }), /without an id/);
    });

    test('a private folder or an API error stops the run without leaking the key', async () => {
        for (const options of [{ rootStatus: 404 }, { listStatus: 403 }]) {
            const root = siteWithOnePicture({ folders: [LINK], access: 'api' });
            const before = snapshot(root);
            const got = await run(root, [], { fetch: fakeDrive({ api: api([], options) }).fetch, env: { DRIVE_API_KEY: KEY } });
            // a rate limit is a hiccup (the run is skipped); a folder the key cannot see is the owner's to fix
            assert.equal(got.code, options.listStatus === 403 ? 0 : 1, got.all);
            assert.match(got.all, /the Drive API answered HTTP 40[34]/);
            assert.ok(!got.all.includes(KEY), got.all);
            assert.deepEqual(snapshot(root), before);
            // a folder the key cannot see says what to change, and the sentence ends once
            if (options.rootStatus === 404) {
                assert.match(got.all, /it is not shared with "Anyone with the link: Viewer", or it was deleted \(the Drive API answered HTTP 404\)\. Nothing was changed\./);
            }
        }
    });

    test('an answer that breaks off is a skipped run; a key that cannot be a key is the owner\'s to fix', async () => {
        // HTTP 200 whose body is cut short: Google's hiccup, so the run is skipped, not failed
        const cut = () => new Response('{"id": "' + ROOT + '", "na', { status: 200, headers: { 'content-type': 'application/json' } });
        const root = siteWithOnePicture({ folders: [LINK], access: 'api' });
        const before = snapshot(root);
        const broken = await run(root, ['--plan'], { fetch: fakeDrive({ api: cut }).fetch, env: { DRIVE_API_KEY: KEY } });
        assert.equal(broken.code, 0, broken.all);
        assert.match(broken.all, /the Drive API answer broke off\. This run was skipped/);
        assert.deepEqual(broken.out, ['changes=false', 'summary=skipped, Google did not answer']);
        assert.deepEqual(snapshot(root), before);

        // a key pasted with a line break or a stray character: said plainly, nothing sent, the key not printed
        for (const bad of [`${KEY.slice(0, 12)}\n${KEY.slice(12)}`, `${KEY.slice(0, 12)}\u200b${KEY.slice(12)}`, `${KEY} extra`]) {
            const drive = fakeDrive({ api: api([]) });
            const got = await run(root, [], { fetch: drive.fetch, env: { DRIVE_API_KEY: bad } });
            assert.equal(got.code, 1, got.all);
            assert.match(got.all, /The DRIVE_API_KEY secret holds a space, a line break or an invisible character/);
            assert.equal(drive.calls.length, 0, 'nothing is sent with a key that cannot be one');
            assert.ok(!got.all.includes(KEY.slice(0, 12)), got.all);
            assert.deepEqual(snapshot(root), before);
        }

        // a key shape with a dot in it is let through to Google
        const dotted = fakeDrive({ api: api([]) });
        const sent = await run(root, ['--plan'], { fetch: dotted.fetch, env: { DRIVE_API_KEY: 'AQ.Ab8-not_a.real~key' } });
        assert.ok(dotted.calls.length > 0, sent.all);
        assert.match(sent.all, /the Drive API answered HTTP 400: API key not valid\. Nothing was changed\./);
        // Google's own sentence ends in a full stop; the report does not end in two
        const stopped = () => new Response(JSON.stringify({ error: { message: 'Bad Request.' } }), { status: 400, headers: { 'content-type': 'application/json' } });
        const twice = await run(root, ['--plan'], { fetch: fakeDrive({ api: stopped }).fetch, env: { DRIVE_API_KEY: KEY } });
        assert.match(twice.all, /HTTP 400: Bad Request\. Nothing was changed\./);

        // an error message that quotes the key is masked before it is cut to length
        const quoting = (u, init) => new Response(JSON.stringify({ error: { message: `${'x'.repeat(140)} ${init.headers['x-goog-api-key']}` } }),
            { status: 400, headers: { 'content-type': 'application/json' } });
        const quoted = await run(root, [], { fetch: fakeDrive({ api: quoting }).fetch, env: { DRIVE_API_KEY: KEY } });
        assert.equal(quoted.code, 1, quoted.all);
        assert.match(quoted.all, /the Drive API answered HTTP 400/);
        assert.ok(!quoted.all.includes(KEY.slice(0, 10)), quoted.all);
    });
});

/* ---------- 4. command line ---------- */

test('--plan prints exactly two lines on stdout; the rest goes to stderr', () => {
    const drive = tempDir('drive-sync-fixture-');
    fs.mkdirSync(path.join(drive, 'Posters'));
    fs.writeFileSync(path.join(drive, 'Posters', 'one.png'), 'not really a picture');
    fs.writeFileSync(path.join(drive, 'notes.txt'), 'ignored');
    const site = makeSite();
    const got = spawnSync(process.execPath, [SCRIPT, '--plan', '--fixture', drive, '--root', site], { encoding: 'utf8', env: { ...process.env, DRIVE_API_KEY: '', GITHUB_ACTIONS: '' } });
    assert.equal(got.status, 0, got.stderr);
    assert.equal(got.stdout, 'changes=true\nsummary=1 new\n');
    assert.match(got.stderr, /Found 1 picture and 0 videos/);
    assert.deepEqual(fs.readdirSync(site), ['drive.config.json'], '--plan writes nothing');

    const missing = spawnSync(process.execPath, [SCRIPT, '--plan', '--fixture', path.join(drive, 'nope'), '--root', site], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, '');
    assert.match(missing.stderr, /Could not read the Drive folder/);

    assert.equal(spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' }).status, 2);
    const unsafe = spawnSync(process.execPath, [SCRIPT, '--fixture', drive], { encoding: 'utf8' });
    assert.equal(unsafe.status, 2, 'the test mode refuses to run against the real site');
    assert.match(unsafe.stderr, /--fixture needs --root/);
    assert.match(spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' }).stdout, /^Usage:/);
});

test('the files the owner and the integrator edit are valid', () => {
    const repo = path.dirname(HERE);
    const config = JSON.parse(fs.readFileSync(path.join(repo, 'drive.config.json'), 'utf8'));
    assert.ok(config.folders.length > 0 && config.folders.every((ref) => parseFolderId(ref)), 'every folder entry is a Drive folder link');
    assert.ok(config.hidden.every((ref) => parseHiddenId(ref)));
    assert.ok(['api', 'public-page'].includes(config.access ?? 'api'));
    assert.ok(Object.values(config.labels ?? {}).every((name) => typeof name === 'string' && name.trim()));
    const builtin = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'drive-builtin.json'), 'utf8'));
    for (const [id, entry] of Object.entries(builtin.items)) {
        assert.match(id, /^[A-Za-z0-9_-]{15,}$/);
        assert.ok(fs.existsSync(path.join(repo, entry.file)), `${entry.file} exists`);
    }
});

/* ---------- 5. the whole import path, on tiny generated media ---------- */

describe('import (needs ffmpeg)', { skip: NEEDS_FFMPEG }, () => {
    let media;
    const ffmpeg = (...args) => {
        const got = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true });
        assert.equal(got.status, 0, got.stderr);
    };
    const probe = (file) => {
        const got = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', windowsHide: true });
        assert.equal(got.status, 0, got.stderr);
        return JSON.parse(got.stdout);
    };

    before(() => {
        const dir = tempDir('drive-sync-media-');
        media = {
            dir,
            png: path.join(dir, 'picture.png'), wide: path.join(dir, 'wide.png'), jpg: path.join(dir, 'photo.jpg'),
            clip: path.join(dir, 'clip.mp4'), tall: path.join(dir, 'tall.mov'), long: path.join(dir, 'long.mp4')
        };
        ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=1', '-frames:v', '1', media.png);
        ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=2000x1000:rate=1', '-frames:v', '1', media.wide);
        // a 2-second clip with sound, a portrait phone clip without sound at 60 fps, and a 21-minute slideshow
        ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', media.clip);
        ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=60', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', media.tall);
        ffmpeg('-f', 'lavfi', '-i', 'color=c=teal:size=64x64:rate=1', '-t', '1260', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', media.long);
        // a phone photo: pixels stored sideways (40x60) plus an EXIF note saying "turn me" (orientation 6)
        const plain = path.join(dir, 'sideways.jpg');
        ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=40x60:rate=1', '-frames:v', '1', plain);
        const tiff = Buffer.from('4d4d002a00000008000101120003000000010006000000000000', 'hex');
        const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 2 + 6 + tiff.length]), Buffer.from('Exif\0\0', 'latin1'), tiff]);
        const bytes = fs.readFileSync(plain);
        fs.writeFileSync(media.jpg, Buffer.concat([bytes.subarray(0, 2), app1, bytes.subarray(2)]));
    });

    // A fixture "Drive": Posters/ with pictures, Reels/ with videos.
    function makeFixture() {
        const drive = tempDir('drive-sync-fixture-');
        fs.mkdirSync(path.join(drive, 'Posters'));
        fs.mkdirSync(path.join(drive, 'Reels'));
        fs.copyFileSync(media.png, path.join(drive, 'Posters', '01 - First_poster.png'));
        fs.copyFileSync(media.wide, path.join(drive, 'Posters', 'wide.PNG'));
        fs.copyFileSync(media.jpg, path.join(drive, 'Posters', 'phone photo.jpg'));
        fs.copyFileSync(media.clip, path.join(drive, 'Reels', 'clip.mp4'));
        fs.copyFileSync(media.tall, path.join(drive, 'Reels', 'tall.mov'));
        fs.writeFileSync(path.join(drive, 'readme.txt'), 'not media');
        return drive;
    }

    test('fixture sync: converts, is idempotent, updates, hides and removes', async () => {
        const drive = makeFixture();
        const site = makeSite();
        const first = await run(site, ['--fixture', drive]);
        assert.equal(first.code, 0, first.all);
        assert.match(first.all, /Done: 5 imported, 0 failed, 0 removed, 0 unchanged/);

        const data = manifest(site);
        assert.deepEqual(Object.keys(data), ['version', 'syncedAt', 'items', 'sync']);
        assert.equal(data.version, 1);
        assert.match(data.syncedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        assert.deepEqual(data.items.map((item) => `${item.group}/${item.title}`),
            ['Posters/First poster', 'Posters/phone photo', 'Posters/wide', 'Reels/clip', 'Reels/tall']);
        const [poster, photo, wide, clip, tall] = data.items;
        const root = path.basename(drive);
        assert.deepEqual(poster, {
            id: poster.id, type: 'image', title: 'First poster', group: 'Posters', path: [root, 'Posters'], modified: poster.modified,
            drive: `https://drive.google.com/file/d/${poster.id}/view`,
            src: `assets/drive/${poster.id}.webp`, w: 640, h: 480, thumb: `assets/drive/${poster.id}-sm.webp`, tw: 480, th: 360
        });
        assert.equal(poster.id, fixtureId('Posters/01 - First_poster.png'));
        assert.match(poster.modified, /^\d{4}-\d{2}-\d{2}$/);
        assert.deepEqual([wide.w, wide.h, wide.tw, wide.th], [1600, 800, 480, 240], 'scaled down, never up');
        assert.deepEqual([photo.w, photo.h], [60, 40], 'the EXIF turn is applied');
        assert.deepEqual(clip, {
            id: clip.id, type: 'video', title: 'clip', group: 'Reels', path: [root, 'Reels'], modified: clip.modified,
            drive: `https://drive.google.com/file/d/${clip.id}/view`, hosted: true,
            src: `assets/drive/${clip.id}.mp4`, poster: `assets/drive/${clip.id}-poster.webp`, w: 320, h: 240, duration: 2,
            bytes: fs.statSync(path.join(site, 'assets', 'drive', `${clip.id}.mp4`)).size
        });
        assert.deepEqual([tall.w, tall.h], [540, 960], 'portrait is at most 540 wide');
        assert.ok(tall.duration >= 1 && tall.duration <= 1.1 && String(tall.duration).length <= 3, `seconds with one decimal: ${tall.duration}`);

        // what was written is what the manifest says
        for (const item of data.items) {
            const real = probe(path.join(site, item.src)).streams.find((s) => s.codec_type === 'video');
            assert.deepEqual([real.width, real.height], [item.w, item.h], item.title);
        }
        const video = probe(path.join(site, clip.src));
        const [v, a] = [video.streams.find((s) => s.codec_type === 'video'), video.streams.find((s) => s.codec_type === 'audio')];
        assert.deepEqual([v.codec_name, v.profile, v.pix_fmt, a.codec_name, a.channels], ['h264', 'High', 'yuv420p', 'aac', 2]);
        assert.equal(fs.readFileSync(path.join(site, clip.src)).indexOf('moov') < fs.readFileSync(path.join(site, clip.src)).indexOf('mdat'), true, 'faststart');
        const portrait = probe(path.join(site, tall.src));
        assert.equal(portrait.streams.length, 1, 'a silent source stays silent');
        assert.equal(portrait.streams[0].r_frame_rate, '30/1', '60 fps is capped at 30');
        assert.equal(probe(path.join(site, clip.poster)).streams[0].width, 320);
        assert.equal(assets(site).length, 10);
        assert.ok(manifestBytes(site).toString().endsWith('}\n') && !manifestBytes(site).includes('\r'));

        // second run: nothing to do, nothing rewritten
        const before = snapshot(site);
        assert.deepEqual((await run(site, ['--fixture', drive, '--plan'])).out, ['changes=false', 'summary=no changes']);
        const second = await run(site, ['--fixture', drive]);
        assert.match(second.all, /Done: 0 imported, 0 failed, 0 removed, 5 unchanged\. data\/drive\.json unchanged/);
        assert.deepEqual(snapshot(site), before);

        // a file changes on "Drive": only that one is imported again
        fs.copyFileSync(media.png, path.join(drive, 'Posters', 'wide.PNG'));
        fs.utimesSync(path.join(drive, 'Posters', 'wide.PNG'), new Date('2030-01-02T03:04:05Z'), new Date('2030-01-02T03:04:05Z'));
        assert.deepEqual((await run(site, ['--fixture', drive, '--plan'])).out, ['changes=true', 'summary=1 changed']);
        const third = await run(site, ['--fixture', drive]);
        assert.match(third.all, /~ updated picture "wide" \(Posters\): 640x480/);
        assert.match(third.all, /Done: 1 imported, 0 failed, 0 removed, 4 unchanged/);
        const now = manifest(site);
        assert.deepEqual([now.items[2].w, now.items[2].modified], [640, '2030-01-02']);
        assert.deepEqual(now.items.filter((item) => item.id !== wide.id), data.items.filter((item) => item.id !== wide.id));

        // hide one file, delete another, drop a non-media file in
        setConfig(site, { folders: [], hidden: [clip.id] });
        fs.rmSync(path.join(drive, 'Posters', 'phone photo.jpg'));
        fs.writeFileSync(path.join(drive, 'Reels', 'notes.pdf'), 'pdf');
        assert.deepEqual((await run(site, ['--fixture', drive, '--plan'])).out, ['changes=true', 'summary=2 removed']);
        const fourth = await run(site, ['--fixture', drive]);
        assert.match(fourth.all, /- removed "clip": hidden in drive\.config\.json/);
        assert.match(fourth.all, /- removed "phone photo": no longer in the Drive folders/);
        assert.deepEqual(manifest(site).items.map((item) => item.title), ['First poster', 'wide', 'tall']);
        assert.deepEqual(assets(site), [`${poster.id}-sm.webp`, `${poster.id}.webp`, `${tall.id}-poster.webp`, `${tall.id}.mp4`, `${wide.id}-sm.webp`, `${wide.id}.webp`].sort());

        // a lost file is repaired, a stray one is swept away, an unknown one is left alone
        fs.rmSync(path.join(site, 'assets', 'drive', `${poster.id}-sm.webp`));
        fs.writeFileSync(path.join(site, 'assets', 'drive', 'stray-file-000000001.webp'), 'x');
        fs.writeFileSync(path.join(site, 'assets', 'drive', 'README.txt'), 'kept');
        const fifth = await run(site, ['--fixture', drive]);
        assert.match(fifth.all, /~ updated picture "First poster"/);
        assert.deepEqual(assets(site).filter((name) => !/^fixture-/.test(name)), ['README.txt']);
        assert.ok(fs.existsSync(path.join(site, 'assets', 'drive', `${poster.id}-sm.webp`)));
    });

    test('videos that are too long, too big or over the site budget become Drive player links', async () => {
        const drive = tempDir('drive-sync-fixture-');
        fs.copyFileSync(media.long, path.join(drive, 'long.mp4'));
        fs.copyFileSync(media.clip, path.join(drive, 'clip.mp4'));
        const site = makeSite();
        const first = await run(site, ['--fixture', drive], { limits: { videoBytes: 20000 } });
        assert.equal(first.code, 0, first.all);
        assert.match(first.all, /added video "clip" \(.*\) as a Google Drive player: it is still larger than 0 MB after compression/);
        assert.match(first.all, /added video "long" \(.*\) as a Google Drive player: it is longer than 20 minutes/);
        const data = manifest(site);
        for (const item of data.items) {
            assert.deepEqual(Object.keys(item), ['id', 'type', 'title', 'group', 'path', 'modified', 'drive', 'hosted', 'poster']);
            assert.equal(item.hosted, false);
            assert.ok(fs.statSync(path.join(site, item.poster)).size > 0, 'a poster cut from the downloaded file');
        }
        assert.deepEqual(Object.values(data.sync).map((note) => note.problem.why).sort(), ['big', 'long']);
        assert.deepEqual(assets(site).filter((name) => name.endsWith('.mp4')), []);
        // not tried again by itself, not even on a manual run
        assert.deepEqual((await run(site, ['--fixture', drive, '--plan', '--retry'], { limits: { videoBytes: 20000 } })).out, ['changes=false', 'summary=no changes']);

        const full = makeSite();
        const none = await run(full, ['--fixture', drive], { limits: { totalBytes: 1000 } });
        assert.match(none.all, /as a Google Drive player: the site's media folder is full/);
        assert.deepEqual(manifest(full).items.map((item) => [item.hosted, 'poster' in item]), [[false, false], [false, false]]);
        // once there is room again, the short clip is hosted after all
        assert.deepEqual((await run(full, ['--fixture', drive, '--plan'])).out, ['changes=true', 'summary=2 to retry']);
        const later = await run(full, ['--fixture', drive]);
        assert.match(later.all, /~ retried video "clip".*320x240/);
        assert.deepEqual(manifest(full).items.map((item) => item.hosted), [true, false]);
    });

    test('a run that is out of time leaves the rest for the next run', async () => {
        const drive = makeFixture();
        const site = makeSite();
        const rushed = await run(site, ['--fixture', drive], { limits: { softMs: -1 } });
        assert.equal(rushed.code, 0, rushed.all);
        assert.match(rushed.all, /5 files left for the next run/);
        assert.deepEqual(manifest(site).items, []);
        assert.deepEqual((await run(site, ['--fixture', drive, '--plan'])).out, ['changes=true', 'summary=5 new']);
        // the hard stop: a download that would not fit in the remaining time is not even started
        const cut = await run(site, ['--fixture', drive], { limits: { hardMs: -1 } });
        assert.match(cut.all, /5 files left for the next run/);
        assert.deepEqual(assets(site), []);
    });

    test('through the Drive API: files and thumbnails come from the API, and the key goes nowhere else', async () => {
        const KEY = 'AIzaSy-not-a-real-key-000000000000000';
        const pic = 'api-picture-0000001';
        const vid = 'api-video-000000001';
        const heic = 'api-heic-0000000001';
        const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        const api = (u, init) => {
            if ((init.headers || {})['x-goog-api-key'] !== KEY) return json({ error: { message: 'API key not valid' } }, 400);
            if (u.searchParams.get('alt') === 'media') {
                const id = u.pathname.split('/').pop();
                if (id === pic) return new Response(fs.readFileSync(media.png), { headers: { 'content-type': 'image/png' } });
                if (id === vid) return new Response(fs.readFileSync(media.clip), { headers: { 'content-type': 'video/mp4' } });
                return json({ error: { message: 'File not found' } }, 404);
            }
            if (u.pathname === `/drive/v3/files/${ROOT}`) return json({ id: ROOT, name: 'WEB DESIGNS', mimeType: 'application/vnd.google-apps.folder' });
            return json({ files: [
                { id: pic, name: 'Home page.png', mimeType: 'image/png', modifiedTime: '2026-03-09T10:00:00.000Z', description: 'Landing page design.' },
                { id: vid, name: 'Promo.mp4', mimeType: 'video/mp4', modifiedTime: '2026-03-09T10:00:00.000Z', size: '1000', description: '  A 2 second\n promo ' },
                { id: heic, name: 'IMG_1.HEIC', mimeType: 'image/heif', modifiedTime: '2026-03-09T10:00:00.000Z', thumbnailLink: `https://lh3.googleusercontent.com/d/${heic}=s220` }
            ] });
        };
        const drive = fakeDrive({ api, previews: { [heic]: media.png } });
        const site = makeSite({ folders: [LINK], access: 'api', labels: { 'web designs': 'Web designs' } });
        const env = { DRIVE_API_KEY: KEY };
        const got = await run(site, [], { fetch: drive.fetch, env });
        assert.equal(got.code, 0, got.all);
        assert.match(got.all, /through the Drive API/);
        assert.match(got.all, /Done: 3 imported, 0 failed/);
        assert.ok(!got.all.includes(KEY));

        const items = manifest(site).items;
        assert.deepEqual(items.map((item) => [item.title, item.group, item.caption]), [
            ['Home page', 'Web designs', 'Landing page design.'], [cleanTitle('IMG_1.HEIC'), 'Web designs', undefined], ['Promo', 'Web designs', 'A 2 second promo']
        ]);
        assert.deepEqual(items[0].path, ['WEB DESIGNS'], 'the path keeps the real Drive name');
        assert.equal(items[2].hosted, true);
        assert.equal(items[2].bytes, fs.statSync(path.join(site, items[2].src)).size);
        assert.equal(JSON.stringify(manifest(site)).includes('googleusercontent'), false, 'the short-lived thumbnail address is not stored');

        // nothing was read from the public pages; the key only ever went to the API host
        assert.ok(drive.calls.every((c) => c.startsWith('www.googleapis.com') || c.startsWith('lh3.googleusercontent.com')), drive.calls.join('\n'));
        assert.ok(drive.keyed.length > 0 && drive.keyed.every((host) => host === 'www.googleapis.com'));
        assert.deepEqual((await run(site, ['--plan'], { fetch: drive.fetch, env })).out, ['changes=false', 'summary=no changes']);
    });

    test('through the Drive API: a redirect is followed without the key', async () => {
        const KEY = 'AIzaSy-not-a-real-key-000000000000000';
        const pic = 'api-picture-0000001';
        const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        const asked = [];      // [host, manual redirect?, key sent?]
        const fetch = async (url, init = {}) => {
            const u = new URL(url);
            const keyed = Boolean((init.headers || {})['x-goog-api-key']);
            asked.push([u.host, init.redirect === 'manual', keyed]);
            if (u.host === 'files.example.com') {
                return keyed ? json({ error: { message: 'the key was passed on' } }, 500)
                    : new Response(fs.readFileSync(media.png), { headers: { 'content-type': 'image/png' } });
            }
            if (u.host !== 'www.googleapis.com') throw new TypeError('fetch failed');
            if (u.searchParams.get('alt') === 'media') return new Response(null, { status: 302, headers: { location: `https://files.example.com/${pic}` } });
            if (u.pathname === `/drive/v3/files/${ROOT}`) return json({ id: ROOT, name: 'Posters', mimeType: 'application/vnd.google-apps.folder' });
            return json({ files: [{ id: pic, name: 'Poster.png', mimeType: 'image/png', modifiedTime: '2026-03-09T10:00:00.000Z' }] });
        };
        const site = makeSite({ folders: [LINK], access: 'api' });
        const got = await run(site, [], { fetch, env: { DRIVE_API_KEY: KEY } });
        assert.equal(got.code, 0, got.all);
        assert.match(got.all, /Done: 1 imported, 0 failed/);
        assert.deepEqual(manifest(site).items.map((item) => item.title), ['Poster']);
        // every request that carried the key went to the API host and refused to follow redirects by itself
        assert.ok(asked.filter((a) => a[2]).every((a) => a[0] === 'www.googleapis.com' && a[1]), JSON.stringify(asked));
        assert.ok(asked.some((a) => a[0] === 'files.example.com' && !a[2]), JSON.stringify(asked));

        // a redirect that leads nowhere usable is a failed download, not a crash
        const nowhere = async (url, init = {}) => {
            const u = new URL(url);
            if (u.searchParams.get('alt') === 'media') return new Response(null, { status: 302, headers: { location: 'http://files.example.com/x' } });
            return fetch(url, init);
        };
        const other = makeSite({ folders: [LINK], access: 'api' });
        const lost = await run(other, [], { fetch: nowhere, env: { DRIVE_API_KEY: KEY } });
        assert.match(lost.all, /Google sent a redirect without a usable address/);
        assert.deepEqual(assets(other), []);
        // and so is a redirect with no address at all: the request is not repeated without the key
        let bare = 0;
        const blank = async (url, init = {}) => {
            const u = new URL(url);
            if (u.searchParams.get('alt') !== 'media') return fetch(url, init);
            bare += 1;
            return new Response(null, { status: 302 });
        };
        const third = makeSite({ folders: [LINK], access: 'api' });
        const none = await run(third, [], { fetch: blank, env: { DRIVE_API_KEY: KEY } });
        assert.match(none.all, /Google sent a redirect without a usable address/);
        assert.equal(bare, 1, 'asked once');
    });

    test('a Drive name cannot write a GitHub log command', async () => {
        const drive = tempDir('drive-sync-fixture-');
        fs.mkdirSync(path.join(drive, 'Posters ##[warning]x'));
        fs.copyFileSync(media.png, path.join(drive, 'Posters ##[warning]x', 'sale ##[error]boo.png'));
        fs.writeFileSync(path.join(drive, 'Posters ##[warning]x', 'bad ##[group]y.png'), 'not a picture');
        const site = makeSite();
        const got = await run(site, ['--fixture', drive], { env: { GITHUB_ACTIONS: 'true' } });
        assert.equal(got.code, 0, got.all);
        assert.match(got.all, /added picture "sale # \[error\]boo"/);
        // the file that cannot be read is reported on a warning line, which goes through the same filter
        assert.match(got.all, /::warning title=Drive sync::Could not import picture "bad # \[group\]y"/);
        assert.ok(!got.all.includes('##['), got.all);
    });

    describe('through the public folder pages', () => {
        const ids = { ok: 'picture-ok-000000001', bad: 'picture-bad-00000001', gone: 'video-gone-000000001', clip: 'video-clip-000000001' };
        const listing = (extra = {}) => ({
            [ROOT]: folderPage('Portfolio', [{ id: SUB, name: 'Client work', folder: true }]),
            [SUB]: folderPage('ignored', [
                { id: ids.ok, name: '02 - Poster.png', date: '2:14 PM', ...extra.ok }, { id: ids.bad, name: 'Broken.jpg', mime: 'image/jpeg' },
                { id: ids.gone, name: 'Lost reel.mp4', mime: 'video/mp4' }, { id: ids.clip, name: 'Reel.mp4', mime: 'video/mp4', ...extra.clip },
                { id: 'a-google-doc-0000001', name: 'Notes', mime: 'application/vnd.google-apps.document' }
            ])
        });
        const files = () => ({
            [ids.ok]: { file: media.png, type: 'image/png' }, [ids.bad]: 'webpage', [ids.gone]: 500,
            [ids.clip]: { file: media.clip, type: 'video/mp4' }
        });

        test('one failed download does not stop the others; failures are retried a few times, then left alone', async () => {
            const site = makeSite({ folders: [LINK] });
            const drive = fakeDrive({ folders: listing(), files: files(), previews: { [ids.gone]: media.png } });
            const first = await run(site, [], { fetch: drive.fetch });
            assert.equal(first.code, 0, first.all);
            assert.match(first.all, /\+ added picture "Poster" \(Client work\): 640x480/);
            assert.match(first.all, /\+ added video "Reel" \(Client work\): 320x240, 2 s/);
            assert.match(first.all, /Could not import picture "Broken" \(Client work\): the download failed \(Google sent a web page instead of the file.*attempt 1 of 3/);
            assert.match(first.all, /Could not import video "Lost reel" \(Client work\): the download failed \(Google answered HTTP 500\)\. The site shows it in a Google Drive player meanwhile/);
            assert.match(first.all, /Done: 2 imported, 2 failed, 0 removed, 0 unchanged/);

            const data = manifest(site);
            assert.deepEqual(data.items.map((item) => item.title), ['Poster', 'Lost reel', 'Reel']);
            assert.deepEqual(data.items[0].path, ['Portfolio', 'Client work']);
            assert.equal(data.items[0].modified, '2026-11-18', 'a clock time means today');
            assert.deepEqual(data.items[1], {
                id: ids.gone, type: 'video', title: 'Lost reel', group: 'Client work', path: ['Portfolio', 'Client work'], modified: '2026-03-09',
                drive: `https://drive.google.com/file/d/${ids.gone}/view`, hosted: false, poster: `assets/drive/${ids.gone}-poster.webp`
            });
            assert.ok(fs.statSync(path.join(site, data.items[1].poster)).size > 0, "the poster comes from Drive's own thumbnail");
            assert.deepEqual(data.sync, {
                [ids.ok]: { rev: '14:14' },
                [ids.bad]: { title: 'Broken', problem: { why: 'download', tries: 1, modified: '2026-03-09' } },
                [ids.gone]: { problem: { why: 'download', tries: 1, modified: '2026-03-09' } }
            });
            assert.equal(drive.calls.filter((c) => c.includes(ids.gone) && c.startsWith('drive.usercontent')).length, 2, 'HTTP 500 gets one retry');
            assert.equal(drive.calls.filter((c) => c.includes(ids.bad) && c.startsWith('drive.usercontent')).length, 1, 'a web page does not');

            // runs 2 and 3 try again, run 4 has given up; a manual run tries once more
            for (const tries of [2, 3]) {
                assert.deepEqual((await run(site, ['--plan'], { fetch: drive.fetch })).out, ['changes=true', 'summary=2 to retry']);
                await run(site, [], { fetch: drive.fetch });
                assert.equal(manifest(site).sync[ids.bad].problem.tries, tries);
            }
            assert.deepEqual((await run(site, ['--plan'], { fetch: drive.fetch })).out, ['changes=false', 'summary=no changes']);
            const quiet = snapshot(site);
            const calls = drive.downloads();
            assert.equal((await run(site, [], { fetch: drive.fetch })).code, 0);
            assert.deepEqual(snapshot(site), quiet, 'an unchanged Drive leaves every byte alone');
            assert.equal(drive.downloads(), calls);
            assert.deepEqual((await run(site, ['--plan', '--retry'], { fetch: drive.fetch })).out, ['changes=true', 'summary=2 to retry']);

            // the owner fixes both files: everything is on the site and the notes are gone
            const fixed = fakeDrive({ folders: listing(), files: { ...files(), [ids.bad]: { file: media.jpg, type: 'image/jpeg' }, [ids.gone]: { file: media.tall, type: 'video/quicktime' } } });
            const mended = await run(site, ['--retry'], { fetch: fixed.fetch });
            assert.match(mended.all, /~ retried picture "Broken"/);
            assert.match(mended.all, /~ retried video "Lost reel" \(Client work\): 540x960/);
            assert.deepEqual(manifest(site).items.map((item) => [item.title, item.hosted]), [['Poster', undefined], ['Broken', undefined], ['Lost reel', true], ['Reel', true]]);
            assert.deepEqual(manifest(site).sync, { [ids.ok]: { rev: '14:14' } });
        });

        test('renames, moves and date-format quirks never cause a new download', async () => {
            const site = makeSite({ folders: [LINK] });
            const first = fakeDrive({ folders: listing(), files: { ...files(), [ids.bad]: { file: media.png, type: 'image/png' }, [ids.gone]: { file: media.clip, type: 'video/mp4' } } });
            assert.equal((await run(site, [], { fetch: first.fetch })).code, 0);
            const before = snapshot(site);

            // next day: the clock time became a date (one day off, as time zones do), same files
            const nextDay = fakeDrive({ folders: listing({ ok: { date: 'Nov 17' } }), files: {} });
            const later = { fetch: nextDay.fetch, now: new Date('2026-11-19T10:00:00Z') };
            assert.deepEqual((await run(site, ['--plan'], later)).out, ['changes=false', 'summary=no changes']);
            assert.equal((await run(site, [], later)).code, 0);
            assert.deepEqual(snapshot(site), before);

            // next year the same dates are shown as 3/9/26 instead of "Mar 9"
            const nextYear = fakeDrive({ folders: Object.fromEntries(Object.entries(listing({ ok: { date: '11/17/26' } })).map(([id, html]) => [id, html.replaceAll('Mar 9', '3/9/26')])), files: {} });
            const muchLater = { fetch: nextYear.fetch, now: new Date('2027-02-01T10:00:00Z') };
            assert.deepEqual((await run(site, ['--plan'], muchLater)).out, ['changes=false', 'summary=no changes']);

            // renamed and moved to another folder: only the text changes
            const moved = fakeDrive({ folders: {
                [ROOT]: folderPage('Portfolio', [{ id: SUB, name: 'Client work', folder: true }, { id: ids.ok, name: 'Hero poster.png', date: 'Nov 17' }]),
                [SUB]: listing()[SUB].replace(new RegExp(`<div class="flip-entry" id="entry-${ids.ok}".*?</div></div></div>`), '')
            }, files: {} });
            assert.deepEqual((await run(site, ['--plan'], { ...later, fetch: moved.fetch })).out, ['changes=true', 'summary=details updated']);
            const renamed = await run(site, [], { ...later, fetch: moved.fetch });
            assert.equal(renamed.code, 0, renamed.all);
            const item = manifest(site).items[0];
            assert.deepEqual([item.id, item.title, item.group, item.path, item.modified], [ids.ok, 'Hero poster', 'Portfolio', ['Portfolio'], '2026-11-18']);
            assert.equal(moved.downloads(), 0);
            assert.equal(snapshot(site)[path.join('assets', 'drive', `${ids.ok}.webp`)], before[path.join('assets', 'drive', `${ids.ok}.webp`)]);

            // replaced on Drive the same day it was imported: the clock time moves, so it is imported again
            const replaced = fakeDrive({ folders: listing({ ok: { date: '5:30 PM' } }), files: { [ids.ok]: { file: media.wide, type: 'image/png' } } });
            const again = await run(site, [], { fetch: replaced.fetch });
            assert.match(again.all, /~ updated picture "Poster" \(Client work\): 1600x800/);
            assert.equal(manifest(site).sync[ids.ok].rev, '17:30');
        });

        test("Drive's preview picture is the second way in (and the first for HEIC photos)", async () => {
            const site = makeSite({ folders: [LINK] });
            const heic = 'iphone-photo-0000001';
            const odd = 'odd-picture-00000001';
            const drive = fakeDrive({
                folders: { [ROOT]: folderPage('Portfolio', [{ id: heic, name: 'IMG_0001.HEIC', mime: 'image/heif' }, { id: odd, name: 'animated.webp', mime: 'image/webp' }]) },
                files: { [heic]: { file: media.clip, type: 'image/heif' }, [odd]: 'webpage' },
                previews: { [heic]: media.jpg, [odd]: media.png }
            });
            const got = await run(site, [], { fetch: drive.fetch });
            assert.equal(got.code, 0, got.all);
            assert.match(got.all, /\+ added picture "IMG 0001" \(Portfolio\): 60x40/);
            assert.match(got.all, /\+ added picture "animated" \(Portfolio\): 640x480, \d+ KB \(from Drive's preview picture\)/);
            assert.deepEqual(drive.calls.filter((c) => c.startsWith('drive.usercontent')), [`drive.usercontent.google.com/download ${odd}`], 'the HEIC file itself is never downloaded');
            assert.deepEqual(manifest(site).items.map((item) => [item.title, item.w, item.h]), [['animated', 640, 480], ['IMG 0001', 60, 40]]);
            assert.equal(manifest(site).sync, undefined);
        });

        test('a changed file that cannot be fetched keeps the version already on the site', async () => {
            const site = makeSite({ folders: [LINK] });
            const good = { ...files(), [ids.bad]: { file: media.png, type: 'image/png' }, [ids.gone]: { file: media.clip, type: 'video/mp4' } };
            assert.equal((await run(site, [], { fetch: fakeDrive({ folders: listing(), files: good }).fetch })).code, 0);
            const before = manifest(site);
            const kept = snapshot(site);
            const changed = fakeDrive({ folders: listing({ clip: { date: '6/1/27' } }), files: { ...good, [ids.clip]: 'webpage' } });
            const got = await run(site, [], { fetch: changed.fetch });
            assert.match(got.all, /Could not import video "Reel".*The version already on the site stays/);
            const now = manifest(site);
            assert.deepEqual(now.items, before.items);
            assert.deepEqual(now.sync[ids.clip], { problem: { why: 'download', tries: 1, modified: '2027-06-01' } });
            for (const name of [`${ids.clip}.mp4`, `${ids.clip}-poster.webp`]) {
                assert.equal(snapshot(site)[path.join('assets', 'drive', name)], kept[path.join('assets', 'drive', name)]);
            }
        });
    });
});
