/* LONZ RUN: the bonus game that plays on the hand-held console. Vanilla JS, no dependencies.
   The console only ever calls press() and release(), so touch, mouse and keyboard play the same.

   window.LONZ_GAME.create(canvas, { sprites, sfx, onExit, onScore })
   returns { start, press, release, pause, destroy }. */
(function () {
    'use strict';

    var W = 152, H = 164;            // fixed logical size, the shape of the console screen (76 x 82 of its units)
    var GROUND = 134;                // y of the top row of the ground
    var FLOOR = GROUND + 1;          // sprites stand one pixel into the ground so their ink soles show against it
    var PX = 22;                     // left edge of the runner on screen
    var STEP = 1000 / 60;            // one update, in ms
    var SPEED0 = 1.4, SPEED1 = 2.6;  // px per update: first stride and top speed
    var RAMP = 9000;                 // px of running it takes to reach top speed
    var JUMP = 3.9, GRAVITY = 0.26;  // a tap rises 27 px and lands half a second later
    var FLOAT = 0.21;                // gravity while A is held on the way up: about 7 px higher
    var METRE = 8;                   // px of running per point of distance
    var STORE = 'lonz-run-best';

    // the site palette
    var NIGHT = '#16123a', DEEP = '#0d0a26', RAISE = '#231d55', INK = '#1a1530';
    var CREAM = '#f6ecd6', DIM = '#c9c2e8', ORANGE = '#ff7a2f', ORANGE_D = '#c2410c';
    var TEAL = '#1fb5a3', TEAL_D = '#0b6e64', PURPLE_H = '#7b61ff', PURPLE_D = '#3a2896';
    var YELLOW = '#ffd23f', YELLOW_D = '#d99a00', PINK = '#ff8fb1';

    // name: frame width, height, and the colour of the stand-in block if the PNG cannot load
    var SPRITES = { runner: [12, 14, ORANGE], bug: [12, 10, PURPLE_H], coin: [12, 14, YELLOW], flag: [10, 14, YELLOW] };

    // 5 x 5 bitmap font. Five base-32 digits per glyph, one per row, leftmost pixel in the top bit.
    var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!+';
    var ROWS = 'ehvhhuhuhufgggfuhhhuvgugvvguggfgjhfhhvhhe444e722ichisihggggvhrlhhhpljhehhheuhugg' +
        'ehliduhuihfge1uv4444hhhhehhha4hhlrhha4ahha444v248v' +
        'ejlpe4c44eu1egvu1e1uiiv22vgu1ueguhev1244eheheehf1e' + '4440404e40';

    // repeatable pseudo-random number in [0, 1), for scenery that must not change between frames
    function noise(n) {
        var v = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
        return v - Math.floor(v);
    }

    function pad(n) {
        n = String(n);
        while (n.length < 5) n = '0' + n;
        return n;
    }

    function create(canvas, options) {
        var o = options || {};
        var ctx = canvas.getContext('2d');
        var calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
        var img = {}, broken = {};
        var raf = 0, last = 0, acc = 0;
        var started = false, frozen = false, dead = false;
        var mode = 'title';           // title | play | pause | over
        var tick = 0;                 // updates since create(): drives the blinking text
        var down = {};                // buttons held right now
        var best = 0, fresh = false;  // best score so far, and whether the last run beat it
        var run;                      // the current run, see reset()
        var zoom = 0;                 // canvas pixels per game pixel, always a whole number

        // The canvas holds the picture at a whole multiple of its logical size: the smallest one that covers
        // the screen pixels it is shown on. When the two match, every game pixel is a clean block. When they
        // cannot (the console at three quarters of its size on a plain screen), the browser shrinks the sharp
        // picture smoothly, so strokes stay even instead of being one or two pixels wide at random.
        function fit() {
            var box = canvas.getBoundingClientRect();
            var want = (box.width || W) * (window.devicePixelRatio || 1) / W;
            var z = Math.min(8, Math.max(1, Math.ceil(want - 0.02)));
            canvas.style.imageRendering = Math.abs(want - z) < 0.02 ? 'pixelated' : 'auto';
            if (z === zoom) return false;
            zoom = z;
            canvas.width = W * z;
            canvas.height = H * z;
            ctx.setTransform(z, 0, 0, z, 0, 0);
            ctx.imageSmoothingEnabled = false;
            return true;
        }
        function refit() {
            if (!dead && fit() && started) draw();
        }

        fit();
        window.addEventListener('resize', refit);
        try { best = Math.max(0, parseInt(window.localStorage.getItem(STORE), 10) || 0); } catch (e) { best = 0; }
        Object.keys(SPRITES).forEach(function (name) {
            var im = new Image();
            im.onerror = function () { broken[name] = true; };
            im.src = (o.sprites == null ? 'assets/img/sprites/' : o.sprites) + name + '.png';
            img[name] = im;
        });

        function sfx(name) {
            if (typeof o.sfx !== 'function') return;
            try { o.sfx(name); } catch (e) { /* sound is optional */ }
        }

        function reset() {
            run = {
                x: 0, speed: SPEED0,         // px run so far, px per update
                h: 0, vy: 0, air: false,     // height above the ground and upward speed
                buffer: 0,                   // updates a jump press stays armed, so one made just before landing still counts
                t: 0,                        // updates this run has been moving: drives the sprite animation
                coins: 0, score: 0,
                things: [],                  // bugs and coins ahead
                pop: 0, popT: 0,             // the "+10" over his head: its value and the updates it has left
                next: W + Math.round(SPEED0 * 120),   // where the next group spawns: the first bug shows up two seconds in
                groups: 0, over: 0, flash: 0
            };
            for (var i = 0; i < 3; i++) run.things.push({ coin: true, x: 170 + i * 16, h: 2 });
        }

        /* ---------------------------------------------------------------
           Update: one fixed 60 Hz step
           --------------------------------------------------------------- */
        function spawn() {
            var x = run.next, r = Math.random(), w = 44, i, n;
            if (run.groups++ && r < 0.24) {
                // three coins in a row: on the ground, or up where only a jump reaches
                n = Math.random() < 0.5 ? 2 : 22;
                for (i = 0; i < 3; i++) run.things.push({ coin: true, x: x + i * 16, h: n });
            } else {
                // one bug, or two side by side once the run is fast enough to carry a tap across both
                n = run.speed > 2 && r > 0.74 ? 2 : 1;
                w = n * 11 + 1;
                for (i = 0; i < n; i++) run.things.push({ x: x + i * 11 });
                if (r < 0.6) run.things.push({ coin: true, x: x + (w >> 1) - 6, h: 22 });
            }
            // the next group is at least a second of running away: time to land, look and jump again
            run.next = x + w + Math.round(run.speed * (62 + Math.random() * 48));
        }

        function crash() {
            mode = 'over';
            run.flash = 3;
            run.popT = 0;
            run.vy = 3;                      // knocked into the air, then through the floor
            fresh = run.score > best;
            if (fresh) {
                best = run.score;
                try { window.localStorage.setItem(STORE, String(best)); } catch (e) { /* private mode: best lasts this visit */ }
            }
            sfx('back');
            if (typeof o.onScore === 'function') o.onScore(run.score, best);
        }

        function update() {
            var i, t, dx;
            tick++;
            if (mode === 'pause') return;
            run.t++;
            if (mode === 'title') {
                if (!calm.matches) run.x += 1;
                return;
            }
            if (mode === 'over') {
                run.over++;
                if (run.flash) run.flash--;
                if (run.h > -60) { run.vy -= GRAVITY; run.h += run.vy; }
                return;
            }

            run.speed = SPEED0 + (SPEED1 - SPEED0) * Math.min(1, run.x / RAMP);
            run.x += run.speed;
            run.score = Math.floor(run.x / METRE) + run.coins * 10;

            if (run.buffer) run.buffer--;
            if (run.popT) run.popT--;
            if (run.air) {
                run.vy -= run.vy > 0 && (down.a || down.up) ? FLOAT : GRAVITY;
                run.h += run.vy;
                if (run.h <= 0) { run.h = 0; run.vy = 0; run.air = false; }
            }
            if (!run.air && run.buffer) {
                run.buffer = 0;
                run.air = true;
                run.vy = JUMP;
                sfx('select');
            }

            if (run.x + W + 16 >= run.next) spawn();
            for (i = run.things.length - 1; i >= 0; i--) {
                t = run.things[i];
                dx = t.x - run.x - PX;       // how far its left edge is ahead of the runner's
                if (dx < -PX - 12) {
                    run.things.splice(i, 1);
                } else if (!t.coin) {
                    // forgiving boxes: 6 px of body against 8 px of shell, and the feet must be under 7 px up
                    if (Math.abs(dx) < 7 && run.h < 7) { crash(); return; }
                } else if (Math.abs(dx) < 10 && run.h + 14 > t.h + 2 && run.h < t.h + 12) {
                    run.things.splice(i, 1);
                    run.coins++;
                    run.score += 10;
                    run.pop = run.popT ? run.pop + 10 : 10;   // coins taken in a row add up in one popup
                    run.popT = 24;
                    sfx('coin');
                }
            }
        }

        /* ---------------------------------------------------------------
           Draw: whole pixels only, no fillText (it blurs at this size)
           --------------------------------------------------------------- */
        function text(str, x, y, color, scale, shade) {
            var s = scale || 1, i, r, c, at, bits;
            if (shade) text(str, x + 1, y + 1, shade, s);
            ctx.fillStyle = color;
            for (i = 0; i < str.length; i++, x += 6 * s) {
                at = CHARS.indexOf(str.charAt(i));
                for (r = 0; at >= 0 && r < 5; r++) {
                    bits = parseInt(ROWS.charAt(at * 5 + r), 32);
                    for (c = 0; c < 5; c++) {
                        if (bits & (16 >> c)) ctx.fillRect(x + c * s, y + r * s, s, s);
                    }
                }
            }
        }
        function center(str, y, color, scale, shade) {
            text(str, (W - (str.length * 6 - 1) * (scale || 1)) >> 1, y, color, scale, shade);
        }
        // big lettering with the stepped shadow of the site's display type
        function logo(str, y, color, shade) {
            var x = (W - (str.length * 6 - 1) * 4) >> 1;
            text(str, x + 4, y + 4, DEEP, 4);
            text(str, x + 2, y + 2, shade, 4);
            text(str, x, y, color, 4);
        }
        // a box in the site's notched-corner frame
        function panel(x, y, w, h) {
            ctx.fillStyle = INK;
            ctx.fillRect(x + 4, y + 2, w - 4, h + 2);
            ctx.fillRect(x + 2, y + 4, w + 2, h - 4);
            ctx.fillStyle = CREAM;
            ctx.fillRect(x + 2, y, w - 4, h);
            ctx.fillRect(x, y + 2, w, h - 4);
            ctx.fillStyle = DEEP;
            ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
        }
        function sprite(name, frame, x, y) {
            var d = SPRITES[name], im = img[name];
            if (im.complete && im.naturalWidth) {
                ctx.drawImage(im, frame * d[0], 0, d[0], d[1], x, y, d[0], d[1]);
            } else if (broken[name]) {
                ctx.fillStyle = d[2];
                ctx.fillRect(x + 2, y + 2, d[0] - 4, d[1] - 2);
            }
        }
        // a row of flat roofs with a few lit windows in their top `lit` px; rate is how much of the camera travel it follows
        function city(cam, rate, slot, low, high, color, glow, lit) {
            var off = Math.floor(cam * rate), i = Math.floor(off / slot), end = i + Math.ceil(W / slot) + 1, x, bw, bh, k;
            for (; i < end; i++) {
                x = i * slot - off;
                bw = slot - 1 - Math.floor(noise(i * 3 + slot) * 5);
                bh = low + Math.floor(noise(i + slot) * (high - low));
                ctx.fillStyle = color;
                ctx.fillRect(x, GROUND - bh, bw, bh);
                ctx.fillStyle = glow;
                for (k = 0; k < 3; k++) {
                    ctx.fillRect(x + 2 + 3 * Math.floor(noise(i * 5 + k) * (bw - 4) / 3),
                        GROUND - bh + 3 + 4 * Math.floor(noise(i * 9 + k) * Math.min(bh - 6, lit) / 4), 2, 2);
                }
            }
        }

        function draw() {
            var cam = Math.floor(run.x), still = calm.matches, i, t, x, s;

            // night sky: stars, a moon, two rows of skyline (the parallax goes when motion is reduced)
            ctx.fillStyle = NIGHT;
            ctx.fillRect(0, 0, W, H);
            for (i = 0; i < 18; i++) {
                if (!still && ((tick >> 4) + i * 7) % 24 === 0) continue;   // twinkle
                ctx.fillStyle = i % 3 ? DIM : CREAM;
                ctx.fillRect(Math.floor(noise(i) * W), 16 + Math.floor(noise(i + 50) * 72), 1, 1);
            }
            ctx.fillStyle = CREAM;
            ctx.fillRect(133, 24, 5, 9);
            ctx.fillRect(131, 26, 9, 5);
            ctx.fillRect(132, 25, 7, 7);
            ctx.fillStyle = DIM;
            ctx.fillRect(134, 27, 2, 2);
            ctx.fillRect(137, 30, 1, 1);
            // warm windows only high up on the far row, so nothing bright sits behind the runner and the bugs
            city(still ? 0 : cam, 0.12, 22, 30, 64, RAISE, YELLOW_D, 12);
            city(still ? 0 : cam, 0.3, 14, 8, 26, DEEP, PURPLE_D, 99);

            // ground: a bright edge over teal tiles with dark seams, laid like bricks
            ctx.fillStyle = TEAL_D;
            ctx.fillRect(0, GROUND, W, H - GROUND);
            ctx.fillStyle = DEEP;
            for (i = 0; i < 4; i++) {
                ctx.fillRect(0, GROUND + 9 + i * 8, W, 1);
                for (x = -((cam + i * 8) % 16); x < W; x += 16) ctx.fillRect(x, GROUND + 2 + i * 8, 1, 7);
            }
            ctx.fillStyle = TEAL;
            ctx.fillRect(0, GROUND, W, 2);

            if (mode !== 'title') {
                // a flag every 100 points of distance
                i = Math.floor((cam + W - PX - 8) / (100 * METRE));
                x = i * 100 * METRE + PX + 8 - cam;
                if (i > 0 && x > -10) {
                    sprite('flag', 0, x, FLOOR - 14);
                    s = i * 100 + 'M';
                    text(s, x + 2 - s.length * 3, FLOOR - 22, DIM);
                }
                for (i = 0; i < run.things.length; i++) {
                    t = run.things[i];
                    if (t.coin) sprite('coin', ((run.t >> 3) + (t.x >> 4)) & 3, t.x - cam, FLOOR - 14 - t.h);
                    else sprite('bug', ((run.t >> 3) + t.x) & 1, t.x - cam, FLOOR - 10);
                }
            }
            if (run.air && mode !== 'over') {
                ctx.fillStyle = TEAL_D;                    // his shadow stays on the ground while he is in the air
                ctx.fillRect(PX + 3, GROUND, 6, 1);
            }
            sprite('runner', mode === 'over' || run.air ? 5 : mode === 'title' && still ? 4 : Math.floor(run.x / 7) % 4,
                PX, FLOOR - 14 - Math.round(run.h));
            if (run.popT) {
                s = '+' + run.pop;
                text(s, PX + 6 - s.length * 3, FLOOR - 22 - Math.round(run.h) - ((24 - run.popT) >> 1), YELLOW, 1, INK);
            }

            if (mode === 'title') {
                logo('LONZ', 20, ORANGE, ORANGE_D);
                logo('RUN', 46, TEAL, TEAL_D);
                if (still || tick % 50 < 32) center('PRESS A', 82, CREAM, 2, INK);
                center('BEST ' + pad(best), 102, DIM, 1, INK);
                center('B EXIT', 153, CREAM, 1, INK);
            } else {
                text(pad(run.score), 4, 4, CREAM, 2, INK);
                s = String(run.coins);
                x = W - 4 - (s.length * 12 - 2);
                text(s, x, 4, CREAM, 2, INK);
                sprite('coin', 0, x - 15, 2);
            }
            if (mode === 'play' && run.x < 300) center('A JUMP', 151, CREAM, 2, INK);
            if (mode === 'pause') {
                panel(20, 44, 112, 54);
                center('PAUSED', 54, YELLOW, 2);
                center('START RESUME', 74, CREAM);
                center('B EXIT', 84, DIM);
            }
            if (mode === 'over' && run.over > 30) {
                panel(6, 38, 140, 78);
                center('GAME OVER', 47, PINK, 2);
                center('SCORE ' + pad(run.score), 65, CREAM, 2);
                center(fresh ? 'NEW BEST!' : 'BEST ' + pad(best), 81, fresh ? YELLOW : DIM, 2);
                center('A RETRY   B EXIT', 101, CREAM);
            }
            if (run.flash && !still) {
                ctx.fillStyle = CREAM;
                ctx.fillRect(0, 0, W, H);
            }
        }

        /* ---------------------------------------------------------------
           Loop: requestAnimationFrame feeding fixed steps
           --------------------------------------------------------------- */
        function frame(now) {
            var dt = last ? now - last : STEP, stepped = false;
            raf = window.requestAnimationFrame(frame);
            last = now;
            if (!(dt >= 0) || Math.abs(dt - STEP) < 2) dt = STEP;   // a 60 Hz screen gets exactly one update per frame
            acc += dt > 100 ? 100 : dt;                   // a hidden tab or a slow frame is not replayed
            while (acc > STEP - 0.5 && !dead && !frozen) {
                update();
                acc -= STEP;
                stepped = true;
            }
            if (stepped && !dead && !frozen) draw();
        }
        function kick() {
            window.cancelAnimationFrame(raf);
            last = 0;
            acc = 0;
            raf = window.requestAnimationFrame(frame);
        }

        /* ---------------------------------------------------------------
           Public surface
           --------------------------------------------------------------- */
        function begin() {
            reset();
            fresh = false;
            mode = 'play';
            sfx('start');
        }
        function exit() {
            if (typeof o.onExit === 'function') o.onExit();
        }

        function start() {
            if (dead) return;
            reset();
            mode = 'title';
            started = true;
            fit();
            draw();                                        // the title is up before the first frame comes round
            if (!frozen) kick();
        }

        function press(name) {
            var go = name === 'a' || name === 'up';
            if (dead || !started) return;
            if (frozen) { frozen = false; kick(); }        // a button means the player is back, even if pause(false) never came
            down[name] = true;
            if (mode === 'title') {
                if (go || name === 'start') begin();
                else if (name === 'b') exit();
            } else if (mode === 'play') {
                if (go) run.buffer = 8;
                else if (name === 'start') { mode = 'pause'; run.buffer = 0; }
            } else if (mode === 'pause') {
                if (name === 'start') mode = 'play';
                else if (name === 'b') exit();
            } else if (name === 'b') {
                exit();
            } else if (run.over > 30 && (go || name === 'start')) {
                begin();                                   // only once the panel is up, so mashing A cannot skip it
            }
        }

        function release(name) {
            if (!dead) down[name] = false;
        }

        // true stops the loop; false, or the next button press, starts it again.
        // A run that was cut off waits on its PAUSED screen instead of carrying on unwatched.
        function pause(flag) {
            flag = !!flag;
            if (dead || flag === frozen) return;
            frozen = flag;
            if (!started) return;
            if (!flag) { kick(); return; }
            window.cancelAnimationFrame(raf);
            raf = 0;
            down = {};
            if (mode === 'play') { mode = 'pause'; run.buffer = 0; }
            draw();
        }

        function destroy() {
            if (dead) return;
            dead = true;
            window.cancelAnimationFrame(raf);
            raf = 0;
            window.removeEventListener('resize', refit);
            Object.keys(img).forEach(function (name) { img[name].onerror = null; });
            ctx.clearRect(0, 0, W, H);
            canvas.style.imageRendering = '';
            img = {};
            o = {};                                        // no callback can fire from here on
        }

        return { start: start, press: press, release: release, pause: pause, destroy: destroy };
    }

    window.LONZ_GAME = { create: create };
})();
