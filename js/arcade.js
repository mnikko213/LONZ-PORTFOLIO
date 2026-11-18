/* LONZ PORTFOLIO: the Arcade. Cartridge shelf, LONZ BOY console and poster wall.
   Built-in items are plain links in index.html, so everything works without this file.
   data/drive.json (written by tools/drive-sync.mjs) adds whatever was imported from Google Drive.
   Needs js/script.js for window.LONZ. */
(function () {
    'use strict';

    var L = window.LONZ;
    var gb = document.getElementById('gb');
    var shelf = document.getElementById('shelf');
    if (!L || !gb || !shelf) return;

    var $ = L.$;
    var $$ = L.$$;
    var motion = L.motion;
    var sfx = L.sfx;
    var noop = function () {};

    function clock(sec) {
        if (!isFinite(sec) || sec < 0) return '--:--';
        var s = Math.round(sec);
        return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }
    function megabytes(bytes) {
        return bytes > 0 ? (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB' : '';
    }
    // which service a cartridge is an example of, for "Want one like this?"
    function needFor(group) {
        if (/\bads?\b/i.test(group)) return 'Social media ads';
        if (/web/i.test(group)) return 'Website';
        if (/art|design|graphic|poster|logo/i.test(group)) return 'Graphic design';
        return 'Video editing';
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

    // every group gets one cartridge colour; new Drive folders take the next free one
    var TONES = ['purple', 'yellow', 'pink', 'orange', 'teal'];
    var toneOf = {};
    function tone(group) {
        var k = String(group).toLowerCase();
        if (!toneOf[k]) toneOf[k] = TONES[Object.keys(toneOf).length % TONES.length];
        return toneOf[k];
    }

    // only ever load imported media from the folder the sync writes to
    var DRIVE_FILE = /^assets\/drive\/[A-Za-z0-9_-]{10,}(-sm|-poster)?\.(webp|mp4)$/;
    var DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
    function isNew(date) {
        var t = Date.parse(date);
        return isFinite(t) && Date.now() - t < 45 * 864e5;
    }

    /* ---------------------------------------------------------------
       1. The shelf: one cartridge per video
       --------------------------------------------------------------- */
    var items = [];
    var shelfFilter = $('#shelf-filter');
    var shelfGroup = '';

    function fromPage(a) {
        var group = a.getAttribute('data-group');
        toneOf[group.toLowerCase()] = a.getAttribute('data-tone');
        a.setAttribute('role', 'button');
        return {
            id: a.getAttribute('data-pak'),
            kind: 'video',
            title: $('.pak-title', a).textContent.trim(),
            group: group,
            caption: $('.pak-caption', a).textContent,
            src: a.getAttribute('href'),
            poster: a.getAttribute('data-poster'),
            label: $('img', a).getAttribute('src'),
            duration: Number(a.getAttribute('data-duration')),
            bytes: Number(a.getAttribute('data-bytes')) || 0,
            el: a
        };
    }

    function makePak(item) {
        var a = el('button', 'pak');
        a.type = 'button';
        a.setAttribute('data-tone', item.tone || tone(item.group));
        var shell = el('span', 'pak-shell');
        var label = el('span', 'pak-label');
        var im = el('img');
        im.alt = '';
        im.loading = 'lazy';
        im.width = 220;
        im.height = 140;
        im.src = item.label || 'assets/img/logo.png';
        if (item.pixel || !item.label) im.className = 'px-art';
        label.appendChild(im);
        label.appendChild(el('span', 'pak-title', item.title));
        shell.appendChild(label);
        a.appendChild(shell);
        var meta = el('span', 'pak-meta');
        meta.appendChild(el('span', '', item.group));
        // a video that plays from Drive has no length on file, so it says where it plays instead
        meta.appendChild(el('span', '', item.kind === 'game' ? 'Game' : item.kind === 'embed' ? 'Drive' : clock(item.duration)));
        a.appendChild(meta);
        a.appendChild(el('span', 'pak-caption sr-only', item.caption));
        if (item.isNew) a.appendChild(el('span', 'pak-new', 'New'));
        var li = el('li');
        li.appendChild(a);
        shelf.appendChild(li);
        item.el = a;
        return item;
    }

    function wire(item) {
        items.push(item);
        item.el.addEventListener('click', function (e) {
            e.preventDefault();
            load(item, e.detail === 0);
        });
        item.el.addEventListener('keydown', function (e) {
            if (e.key === ' ' && item.el.tagName === 'A') { e.preventDefault(); load(item, true); }
        });
    }

    function groups(list, key) {
        var seen = [];
        list.forEach(function (x) {
            var g = key(x);
            if (g && !seen.some(function (s) { return same(s, g); })) seen.push(g);
        });
        return seen;
    }

    // a row of chips: All plus one per group; hidden when there is nothing to choose
    function chips(box, names, current, pick) {
        if (!box) return;
        // the row is rebuilt on every pick, so the chip that was pressed has to get the focus back
        var hadFocus = box.contains(document.activeElement);
        box.textContent = '';
        box.hidden = names.length < 2;
        if (box.hidden) return;
        [''].concat(names).forEach(function (name) {
            var b = el('button', '', name || 'All');
            b.type = 'button';
            b.setAttribute('aria-pressed', String(same(name, current)));
            b.addEventListener('click', function () { pick(name); });
            box.appendChild(b);
            if (hadFocus && same(name, current)) b.focus({ preventScroll: true });
        });
    }

    function visibleItems() {
        return items.filter(function (it) { return !shelfGroup || same(it.group, shelfGroup); });
    }
    function drawShelf() {
        items.forEach(function (it) {
            it.el.parentNode.hidden = !!shelfGroup && !same(it.group, shelfGroup);
        });
        chips(shelfFilter, groups(items, function (it) { return it.group; }), shelfGroup, function (g) {
            shelfGroup = g;
            drawShelf();
        });
    }

    $$('.pak', shelf).forEach(function (a) { wire(fromPage(a)); });
    $$('[data-shelf]').forEach(function (link) {
        link.addEventListener('click', function () {
            var want = link.getAttribute('data-shelf');
            if (items.some(function (it) { return same(it.group, want); })) { shelfGroup = want; drawShelf(); }
        });
    });

    // the bonus game: locked until the visitor has collected a few coins
    var gameItem = makePak({
        id: 'lonz-run',
        kind: 'game',
        title: 'LONZ RUN',
        group: 'Bonus',
        tone: 'cream',
        caption: 'A tiny running game. Jump over the bugs and grab the coins.',
        label: 'assets/img/sprites/pak-run.png',
        pixel: true
    });
    wire(gameItem);
    function drawLock() {
        var need = L.unlockAt - L.coins();
        gameItem.locked = need > 0;
        gameItem.el.classList.toggle('is-locked', gameItem.locked);
        $('.pak-title', gameItem.el).textContent = gameItem.locked ? 'Locked' : gameItem.title;
        $('.pak-meta span:last-child', gameItem.el).textContent = gameItem.locked ? need + (need === 1 ? ' coin' : ' coins') + ' to go' : 'Game';
        $('.pak-caption', gameItem.el).textContent = gameItem.locked
            ? 'Bonus game, locked. Collect ' + need + ' more ' + (need === 1 ? 'coin' : 'coins') + ' to unlock it.'
            : gameItem.caption;
    }
    drawLock();
    document.addEventListener('lonz:coins', drawLock);
    drawShelf();

    /* ---------------------------------------------------------------
       2. The console
       --------------------------------------------------------------- */
    var video = $('#gb-video');
    var embedBox = $('#gb-embed');
    var canvas = $('#gb-game');
    var idle = $('#gb-idle');
    var boot = $('#gb-boot');
    var osd = $('#gb-osd');
    var nowLine = $('#gb-now');
    var timeLine = $('#gb-time');
    var seek = $('#gb-seek');
    var cartEl = $('#gb-cart');
    var statusLine = $('#gb-status');
    var nowTitle = $('#now-title');
    var nowText = $('#now-text');
    var keys = $('#keys');
    var nowCta = $('#now-cta');
    var wantOne = $('#want-one');
    var arcade = $('#videos');
    var idleTitle = nowTitle.textContent;
    var idleText = nowText.textContent;
    var videoKeys = keys.innerHTML;

    var cur = null;      // the cartridge in the console
    var mode = 'idle';   // idle | video | embed | game
    var busy = false;    // true while a cartridge is flying or booting
    var game = null;
    var gameLoading = false;   // js/game.js has been asked for and has not arrived yet
    var inView = true;         // the arcade is on screen
    var seeking = false;       // the seek thumb is being dragged
    var osdTimer = null;
    var canAnimate = typeof gb.animate === 'function';
    var volume = Number(L.store('lonz-volume'));
    if (!(volume >= 0 && volume <= 1) || L.store('lonz-volume') === null) volume = 1;

    function say(text) { statusLine.textContent = text; }
    function screen(name) {
        idle.hidden = name !== 'idle';
        video.hidden = name !== 'video';
        embedBox.hidden = name !== 'embed';
        canvas.hidden = name !== 'game';
        mode = name;
    }
    function showOsd(text, stay) {
        osd.textContent = text;
        osd.hidden = false;
        osd.style.animation = 'none';
        void osd.offsetWidth;
        osd.style.animation = '';
        clearTimeout(osdTimer);
        if (!stay) osdTimer = setTimeout(function () { osd.hidden = true; }, 1500);
    }
    function hideOsd() { clearTimeout(osdTimer); osd.hidden = true; }

    function readout() {
        var d = video.duration;
        var t = video.currentTime;
        timeLine.textContent = isFinite(d) && d > 0 ? clock(t) + ' / ' + clock(d) : '--:--';
        var p = isFinite(d) && d > 0 ? t / d : 0;
        if (!seeking) seek.value = String(Math.round(p * 1000));
        seek.style.setProperty('--seek', (p * 100).toFixed(2) + '%');
        seek.setAttribute('aria-valuetext', clock(t) + ' of ' + clock(d));
    }

    function describe(item) {
        nowTitle.textContent = item ? item.title : idleTitle;
        nowText.textContent = item ? item.caption : idleText;
        nowText.hidden = !nowText.textContent;
        var old = $('.now-meta', nowTitle.parentNode);
        if (old) old.remove();
        if (item && item.kind !== 'game') {
            var meta = el('p', 'now-meta');
            meta.appendChild(el('span', '', item.group));
            if (item.duration) meta.appendChild(el('span', '', clock(item.duration)));
            if (item.bytes) meta.appendChild(el('span', '', megabytes(item.bytes)));
            nowTitle.parentNode.insertBefore(meta, nowText);
        }
        nowCta.hidden = !item || item.kind === 'game';
        legend(item ? item.kind : 'video');
    }

    // The key legend and the button names say what the buttons do for the cartridge that is in.
    var padButtons = $$('[data-gb]', gb);
    var padNames = padButtons.map(function (b) { return b.getAttribute('aria-label'); });
    var GAME_NAMES = {
        a: 'A: jump', up: 'Up: jump', start: 'Start: pause or resume the game',
        b: 'B: quit the game, from its title, pause or game over screen',
        left: 'Left: not used in the game', right: 'Right: not used in the game',
        down: 'Down: not used in the game', select: 'Select: not used in the game'
    };
    var LEGENDS = {
        game: [['A', 'Jump'], ['Start', 'Pause'], ['B', 'Quit']],
        embed: [['B', 'Eject'], ['Start', 'Full screen'], ['Left Right', 'Change cartridge']]
    };
    function legend(kind) {
        var rows = LEGENDS[kind];
        if (rows) {
            keys.textContent = '';
            rows.forEach(function (k) {
                var row = el('div');
                row.appendChild(el('dt', '', k[0]));
                row.appendChild(el('dd', '', k[1]));
                keys.appendChild(row);
            });
        } else {
            keys.innerHTML = videoKeys;
        }
        padButtons.forEach(function (b, i) {
            var name = kind === 'game' && GAME_NAMES[b.getAttribute('data-gb')];
            b.setAttribute('aria-label', name || padNames[i]);
        });
    }

    if (wantOne) {
        wantOne.addEventListener('click', function () {
            if (cur && L.brief) L.brief(needFor(cur.group), cur.title);
        });
    }

    // --- cartridge motion: fly from the shelf, drop into the slot, pop back out
    function setCart(item, color) {
        cartEl.style.setProperty('--pak', color);
        var art = $('img', cartEl);
        art.src = item.label || 'assets/img/logo.png';
        art.className = item.pixel || !item.label ? 'px-art' : '';
        $('.pak-title', cartEl).textContent = item.title;
        cartEl.hidden = false;
    }
    function fly(item) {
        var shell = $('.pak-shell', item.el);
        var from = shell.getBoundingClientRect();
        var color = getComputedStyle(shell).backgroundColor;
        item.el.classList.add('is-loaded');
        item.el.setAttribute('aria-pressed', 'true');
        if (motion.still || !canAnimate || !from.width) {
            setCart(item, color);
            return Promise.resolve();
        }
        cartEl.hidden = false;
        cartEl.style.visibility = 'hidden';
        var slot = cartEl.getBoundingClientRect();
        cartEl.hidden = true;
        cartEl.style.visibility = '';
        var lift = slot.height * 0.72;
        var ghost = shell.cloneNode(true);
        ghost.className = 'pak-shell cart-fly';
        ghost.style.setProperty('--pak-w', from.width + 'px');
        ghost.style.setProperty('--pak', color);
        document.body.appendChild(ghost);
        var move = ghost.animate([
            { transform: 'translate(' + from.left + 'px,' + from.top + 'px) scale(1)' },
            { transform: 'translate(' + slot.left + 'px,' + (slot.top - lift) + 'px) scale(' + (slot.width / from.width) + ')' }
        ], { duration: 320, easing: 'steps(6, end)', fill: 'forwards' });
        return move.finished.then(function () {
            ghost.remove();
            setCart(item, color);
            return cartEl.animate([
                { transform: 'translateY(' + -lift + 'px)' },
                { transform: 'none' }
            ], { duration: 160, easing: 'steps(3, end)' }).finished;
        }).catch(function () { ghost.remove(); setCart(item, color); });
    }
    function pop(item) {
        var done = function () {
            cartEl.hidden = true;
            item.el.classList.remove('is-loaded');
            item.el.setAttribute('aria-pressed', 'false');
        };
        if (motion.still || !canAnimate) { done(); return Promise.resolve(); }
        return cartEl.animate([
            { transform: 'none' },
            { transform: 'translateY(-76%)' }
        ], { duration: 140, easing: 'steps(3, end)' }).finished.then(done, done);
    }
    var booted = false;
    function bootUp() {
        gb.classList.add('is-on');
        if (motion.still || booted) return Promise.resolve();
        booted = true;
        boot.hidden = false;
        return new Promise(function (resolve) {
            setTimeout(function () { sfx.play('boot'); }, 300);
            setTimeout(function () { boot.hidden = true; resolve(); }, 640);
        });
    }

    // --- media
    function tryPlay() {
        var p = video.play();
        if (p && p.catch) p.catch(function (err) {
            // only a blocked autoplay needs the hint: an eject or a file that failed reports itself
            if (mode !== 'video' || video.error || !video.paused || (err && err.name === 'AbortError')) return;
            showOsd('Press A to play', true);
        });
    }
    function stopMedia() {
        video.pause();
        video.removeAttribute('src');
        video.removeAttribute('poster');
        video.load();
        embedBox.textContent = '';
        if (game) { game.destroy(); game = null; }
        seek.disabled = true;
        seeking = false;
        seek.value = '0';
        seek.style.setProperty('--seek', '0%');
        timeLine.textContent = '--:--';
        hideOsd();
    }
    function embed(item) {
        screen('embed');
        var f = el('iframe');
        f.src = 'https://drive.google.com/file/d/' + item.driveId + '/preview';
        f.title = item.title;
        f.allow = 'autoplay; fullscreen';
        f.setAttribute('allowfullscreen', '');
        f.loading = 'lazy';
        embedBox.appendChild(f);
        timeLine.textContent = 'Drive';
        nowText.textContent = (item.caption ? item.caption + ' ' : '') + 'This one plays in the Google Drive player, so use the controls on the screen.';
        nowText.hidden = false;
        legend('embed');
    }
    // the file in the console could not be played
    function failed() {
        if (!cur || cur.kind !== 'video' || !video.getAttribute('src')) return;
        // an imported video that fails can still play from Drive itself
        if (cur.driveId) { stopMedia(); embed(cur); return; }
        seek.disabled = true;
        seeking = false;
        showOsd('Cart error', true);
        nowText.textContent = 'This video could not load. Check your connection, eject it and try again.';
        nowText.hidden = false;
        sfx.play('error');
        say('This video could not load.');
    }
    function begin(item) {
        nowLine.textContent = item.title;
        describe(item);
        if (item.kind === 'game') { startGame(); return; }
        L.quest('cart');
        say('Now playing: ' + item.title);
        if (item.kind === 'embed') { embed(item); return; }
        screen('video');
        // the file can fail while the cartridge is still flying in; say so now that the screen is on
        if (video.error) { failed(); return; }
        seek.disabled = false;
        video.muted = false;
        video.volume = volume;
        try { video.currentTime = 0; } catch (e) { /* not seekable yet */ }
        if (video.paused) tryPlay();
        readout();
    }
    function startGame() {
        screen('game');
        timeLine.textContent = 'Game';
        say('LONZ RUN loaded. Press A to start.');
        var run = function () {
            // one game at a time, and only while its cartridge is still the one in the console
            // (busy covers the moment an eject is under way: a later load starts the game from begin())
            if (busy || cur !== gameItem || mode !== 'game' || game || !window.LONZ_GAME) return;
            game = window.LONZ_GAME.create(canvas, {
                sprites: 'assets/img/sprites/',
                sfx: function (name) { sfx.play(name); },
                onExit: function () { eject(); },
                onScore: function (score, best) { timeLine.textContent = 'Best ' + best; say('Game over. Score ' + score + ', best ' + best + '.'); }
            });
            game.start();
            if (document.hidden || !inView) game.pause(true);
        };
        if (window.LONZ_GAME) { run(); return; }
        if (gameLoading) return;          // already on its way: its onload starts the game
        gameLoading = true;
        var s = el('script');
        s.src = 'js/game.js';
        s.onload = function () { gameLoading = false; run(); };
        s.onerror = function () {
            gameLoading = false;
            s.remove();                   // so the next try asks for the file again
            if (cur === gameItem) showOsd('Game failed to load', true);
        };
        document.head.appendChild(s);
    }

    // --- loading and ejecting
    function load(item, byKeyboard) {
        if (busy || !item) return;
        if (item.locked) {
            L.toast('Locked: ' + $('.pak-meta span:last-child', item.el).textContent, 2400);
            sfx.play('error');
            return;
        }
        if (cur === item) { press('a'); return; }
        busy = true;
        gb.scrollIntoView({ block: 'nearest' });
        var before = cur ? unload() : Promise.resolve();
        // start the video inside the click so phones let it play; it stays muted and hidden until the boot ends
        if (item.kind === 'video') {
            video.muted = true;
            video.src = item.src;
            if (item.poster) video.poster = item.poster;
            var p = video.play();
            if (p && p.catch) p.catch(noop);
        }
        cur = item;
        nowLine.textContent = 'Loading';
        sfx.play('insert');
        before
            .then(function () { return fly(item); })
            .then(function () { return bootUp(); })
            .then(function () {
                busy = false;
                if (cur !== item) return;
                begin(item);
                if (byKeyboard) $('.gb-a', gb).focus({ preventScroll: true });
            });
    }
    function unload() {
        var item = cur;
        stopMedia();
        return pop(item);
    }
    function eject() {
        if (!cur || busy) return;
        var item = cur;
        var hadFocus = gb.contains(document.activeElement);
        busy = true;
        sfx.play('eject');
        unload().then(function () {
            busy = false;
            cur = null;
            gb.classList.remove('is-on');
            screen('idle');
            nowLine.textContent = 'No cartridge';
            describe(null);
            say('Cartridge ejected.');
            if (hadFocus) item.el.focus({ preventScroll: true });
        });
    }
    function step(dir) {
        var list = visibleItems().filter(function (it) { return !it.locked; });
        if (!list.length) return;
        var i = list.indexOf(cur);
        var next = list[i < 0 ? 0 : (i + dir + list.length) % list.length];
        if (next === cur) { showOsd('Only one here'); return; }   // a filter with a single cartridge
        load(next);
    }
    function toggleSound() {
        if (mode !== 'video') return;
        video.muted = !video.muted;
        showOsd(video.muted ? 'Sound off' : 'Sound on');
    }

    // --- buttons
    function togglePlay() {
        if (video.error) { showOsd('Cart error', true); return; }
        hideOsd();
        if (video.ended) { video.currentTime = 0; tryPlay(); return; }
        if (video.paused) tryPlay();
        else { video.pause(); showOsd('Paused', true); }
    }
    function volumeBy(step) {
        volume = Math.min(1, Math.max(0, Math.round((volume + step) * 10) / 10));
        video.volume = volume;
        if (volume > 0) video.muted = false;
        L.store('lonz-volume', String(volume));
        showOsd('Volume ' + Math.round(volume * 10));
    }
    function fullscreen() {
        var target = mode === 'video' ? video : (mode === 'embed' ? $('iframe', embedBox) : null);
        if (!target) { showOsd(cur ? 'Not in this mode' : 'Insert a cartridge'); return; }
        if (target.requestFullscreen) {
            var p = target.requestFullscreen();
            if (p && p.catch) p.catch(noop);
        } else if (target.webkitEnterFullscreen) {
            target.webkitEnterFullscreen();
        } else if (target.webkitRequestFullscreen) {
            target.webkitRequestFullscreen();
        }
    }
    function press(name) {
        if (busy) return;
        if (name === 'left') { step(-1); return; }
        if (name === 'right') { step(1); return; }
        if (!cur) { showOsd('Insert a cartridge'); return; }
        if (name === 'b') { eject(); return; }
        if (name === 'start') { fullscreen(); return; }
        if (mode === 'embed') { showOsd('Use the player on screen'); return; }
        if (mode !== 'video') return;
        if (name === 'a') togglePlay();
        else if (name === 'select') toggleSound();
        else if (name === 'up') volumeBy(0.1);
        else if (name === 'down') volumeBy(-0.1);
    }

    // In a game the buttons are held, not clicked: press on down, release on up.
    padButtons.forEach(function (b) {
        var name = b.getAttribute('data-gb');
        var held = false;
        var ate = false;     // the game took this press, so the click that follows it is not for the console
        var down = function () {
            b.classList.add('is-down');
            ate = false;
            if (game && !held) { held = true; ate = true; game.press(name); }
        };
        var up = function () {
            b.classList.remove('is-down');
            if (game && held) game.release(name);
            held = false;
        };
        b.addEventListener('pointerdown', down);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('click', function (e) {
            // B quits the game on the way down; the click that ends that same press must not reach the empty console
            if (ate) { ate = false; if (e.detail !== 0) return; }
            if (keyTap === b) { keyTap = null; if (e.detail === 0) return; }
            if (game) {
                // a keyboard "click" has no pointer events, so tap the button for the player
                if (e.detail === 0) { game.press(name); setTimeout(function () { if (game) game.release(name); }, 120); }
                return;
            }
            sfx.play('select');
            press(name);
        });
    });

    // Keys work while focus is inside the console.
    var KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'a', b: 'b', f: 'start', m: 'select' };
    var GAME_KEYS = { ' ': 'a', z: 'a', x: 'b', Enter: 'start', p: 'start' };
    var keyTap = null;   // the button a key press was just sent from: the click some browsers add is not counted again
    function keyName(e) {
        if (e.altKey || e.ctrlKey || e.metaKey || e.target === seek) return null;
        // in a game, Enter or Space on a focused button presses that button, as its name says
        var own = game && (e.key === ' ' || e.key === 'Enter') && e.target.getAttribute && e.target.getAttribute('data-gb');
        if (own) return own;
        var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        return KEYS[key] || (game ? GAME_KEYS[key] : null) || null;
    }
    gb.addEventListener('keydown', function (e) {
        var name = keyName(e);
        if (!name) return;
        e.preventDefault();
        if (game) {
            if (e.key === ' ' || e.key === 'Enter') keyTap = e.target;
            if (!e.repeat) game.press(name);
            return;
        }
        if (!e.repeat || name === 'up' || name === 'down') press(name);
    });
    gb.addEventListener('keyup', function (e) {
        var name = keyName(e);
        if (name && game) game.release(name);
    });
    // the click Space adds comes right after the key is let go; one tick later the mark is stale,
    // wherever the focus has moved to in the meantime
    document.addEventListener('keyup', function () {
        if (keyTap) setTimeout(function () { keyTap = null; }, 0);
    });

    seek.addEventListener('input', function () {
        if (!isFinite(video.duration)) return;
        video.currentTime = (Number(seek.value) / 1000) * video.duration;
        readout();
    });
    // while the thumb is dragged the video must not pull it back; at any other time the bar follows the video
    seek.addEventListener('pointerdown', function () { seeking = true; });
    ['pointerup', 'pointercancel', 'change', 'blur'].forEach(function (name) {
        seek.addEventListener(name, function () { seeking = false; });
    });
    // from the keyboard one press moves five seconds (less on a short video), not a thousandth of the bar
    seek.addEventListener('keydown', function (e) {
        var d = video.duration;
        if (mode !== 'video' || e.altKey || e.ctrlKey || e.metaKey || !isFinite(d) || !(d > 0)) return;
        var jump = Math.min(5, d / 20);
        var t = video.currentTime;
        var to = { ArrowRight: t + jump, ArrowUp: t + jump, ArrowLeft: t - jump, ArrowDown: t - jump,
            PageUp: t + jump * 4, PageDown: t - jump * 4, Home: 0, End: d }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        video.currentTime = Math.min(d, Math.max(0, to));
        readout();
    });
    video.addEventListener('timeupdate', readout);
    video.addEventListener('loadedmetadata', readout);
    video.addEventListener('play', hideOsd);
    video.addEventListener('ended', function () { if (mode === 'video') showOsd('The end', true); });
    video.addEventListener('click', function () { if (mode === 'video' && !document.fullscreenElement) togglePlay(); });
    // while the cartridge is still flying in or booting, begin() reports the failure once the screen is on
    video.addEventListener('error', function () { if (!busy) failed(); });
    document.addEventListener('fullscreenchange', function () {
        video.controls = document.fullscreenElement === video;
    });
    // nothing keeps playing once the console is out of sight
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            inView = entries[0].isIntersecting;
            if (inView) { if (game && !document.hidden) game.pause(false); return; }
            if (document.fullscreenElement) return;
            if (mode === 'video' && !video.paused) { video.pause(); showOsd('Paused', true); }
            if (game) game.pause(true);
        }).observe(arcade);
    }
    document.addEventListener('visibilitychange', function () {
        if (game) game.pause(document.hidden || !inView);
    });

    /* ---------------------------------------------------------------
       3. The poster wall
       --------------------------------------------------------------- */
    var wall = $('#wall');
    var wallFilter = $('#wall-filter');
    var wallMore = $('#wall-more');
    var posters = [];
    var wallGroup = '';
    var wallOpen = false;
    var FIRST = window.matchMedia('(max-width: 640px)').matches ? 6 : 12;

    function poster(a) {
        var im = $('img', a);
        var p = {
            el: a,
            li: a.parentNode,
            group: a.getAttribute('data-group'),
            item: { type: 'image', src: a.getAttribute('href'), alt: im.alt, caption: im.alt, thumb: im.getAttribute('src') }
        };
        posters.push(p);
        a.addEventListener('click', function (e) {
            if (!L.openViewer) return;
            e.preventDefault();
            var list = posters.filter(function (x) { return !wallGroup || same(x.group, wallGroup); });
            L.galleries.wall = {
                title: 'Arcade: poster wall',
                label: 'Posters and designs',
                quest: 'poster',
                items: list.map(function (x) { return x.item; })
            };
            L.openViewer('wall', list.indexOf(p), a);
        });
        return p;
    }
    function drawWall() {
        var total = 0;
        var shown = 0;
        posters.forEach(function (p) {
            var mine = !wallGroup || same(p.group, wallGroup);
            if (mine) total += 1;
            var vis = mine && (wallOpen || shown < FIRST);
            if (vis) shown += 1;
            p.li.hidden = !vis;
        });
        if (wallMore) {
            wallMore.hidden = wallOpen || total <= FIRST;
            $('#wall-more-label').textContent = 'Show all ' + total;
        }
        chips(wallFilter, groups(posters, function (p) { return p.group; }), wallGroup, function (g) {
            wallGroup = g;
            drawWall();
        });
    }
    if (wall) {
        $$('.poster', wall).forEach(poster);
        if (wallMore) wallMore.addEventListener('click', function () {
            wallOpen = true;
            drawWall();
            var firstNew = posters.filter(function (p) { return !p.li.hidden; })[FIRST];
            if (firstNew) firstNew.el.focus();
        });
        drawWall();
    }

    /* ---------------------------------------------------------------
       4. Google Drive: add whatever the sync imported
       --------------------------------------------------------------- */
    function addVideo(d) {
        var hosted = d.hosted && DRIVE_FILE.test(d.src || '');
        var art = DRIVE_FILE.test(d.poster || '') ? d.poster : '';
        wire(makePak({
            id: 'drive-' + d.id,
            kind: hosted ? 'video' : 'embed',
            title: String(d.title || 'Untitled'),
            group: String(d.group || 'New'),
            caption: String(d.caption || ''),   // the file's description on Drive, when it has one
            src: hosted ? d.src : '',
            poster: art,
            label: art,
            duration: Number(d.duration) || 0,
            bytes: Number(d.bytes) || 0,
            driveId: d.id,
            isNew: isNew(d.modified)
        }));
    }
    function addPoster(d) {
        if (!wall || !DRIVE_FILE.test(d.src || '') || !DRIVE_FILE.test(d.thumb || '')) return;
        var group = String(d.group || 'New');
        var a = el('a', 'poster');
        a.href = d.src;
        a.setAttribute('data-group', group);
        var im = el('img');
        // lazy has to be set before the address, or the browser fetches every thumbnail at once
        im.loading = 'lazy';
        // the description typed on Drive, when there is one; otherwise the folder and file name
        im.alt = String(d.caption || '') || group + ': ' + String(d.title || 'untitled');
        if (d.tw && d.th) { im.width = d.tw; im.height = d.th; }
        im.src = d.thumb;
        a.appendChild(im);
        var li = el('li');
        if (d.tw && d.th) li.style.setProperty('--r', (d.tw / d.th).toFixed(4));
        li.appendChild(a);
        wall.appendChild(li);
        poster(a);
    }
    if (window.fetch) {
        fetch('data/drive.json', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (m) {
                if (!m || !Array.isArray(m.items)) return;
                m.items.forEach(function (d) {
                    if (!d || !DRIVE_ID.test(d.id || '')) return;
                    if (d.type === 'video') addVideo(d);
                    else if (d.type === 'image') addPoster(d);
                });
                // keep the bonus cartridge at the end of the shelf
                shelf.appendChild(gameItem.el.parentNode);
                items.push(items.splice(items.indexOf(gameItem), 1)[0]);
                drawShelf();
                drawWall();
            })
            .catch(noop);
    }
})();
