/* LONZ PORTFOLIO: retro game edition. Vanilla JS, no dependencies.
   This file runs the page; js/arcade.js (console, shelf, poster wall) builds on window.LONZ. */
(function () {
    'use strict';

    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var root = document.documentElement;

    function store(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            localStorage.setItem(key, value);
        } catch (e) { return null; }
        return null;
    }

    var LONZ = window.LONZ = { $: $, $$: $$, store: store };

    // an Options row is a switch: aria-checked plus an On/Off label
    function setSwitch(btn, on) {
        if (!btn) return;
        btn.setAttribute('aria-checked', String(on));
        var v = $('.opt-v', btn);
        if (v) v.textContent = on ? 'On' : 'Off';
    }

    /* ---------------------------------------------------------------
       0. Motion switch: Options > Animations (or the OS reduced-motion
          setting) stops every looping animation, video preview and timer.
       --------------------------------------------------------------- */
    var motion = LONZ.motion = {
        still: reduceMotion.matches || store('lonz-motion') === 'off',
        fns: [],
        on: function (fn) { this.fns.push(fn); },
        set: function (still) {
            this.still = still;
            root.classList.toggle('motion-off', still);
            this.fns.forEach(function (fn) { fn(still); });
        }
    };
    root.classList.toggle('motion-off', motion.still);
    var motionBtn = $('#motion-toggle');
    function renderMotion() {
        setSwitch(motionBtn, !motion.still);
        var icon = motionBtn && $('.i', motionBtn);
        if (!icon) return;
        icon.classList.toggle('i-play', !motion.still);
        icon.classList.toggle('i-pause', motion.still);
    }
    if (motionBtn) {
        renderMotion();
        motionBtn.addEventListener('click', function () {
            var still = !motion.still;
            store('lonz-motion', still ? 'off' : 'on');
            motion.set(still);
            renderMotion();
            toast(still ? 'Animations paused' : 'Animations on');
        });
    }

    /* ---------------------------------------------------------------
       1. Sound effects (off by default, tiny square-wave blips)
       --------------------------------------------------------------- */
    var sfx = LONZ.sfx = {
        on: store('lonz-sfx') === 'on',
        ctx: null,
        play: function (kind) {
            if (!this.on) return;
            try {
                if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                var ctx = this.ctx;
                // a context made before the first tap starts suspended; wake it so the sound is heard
                if (ctx.state === 'suspended' && ctx.resume) { var woke = ctx.resume(); if (woke && woke.catch) woke.catch(function () {}); }
                var notes = {
                    select: [[660, 0.05]],
                    confirm: [[523, 0.06], [784, 0.08]],
                    start: [[392, 0.07], [523, 0.07], [784, 0.12]],
                    coin: [[988, 0.06], [1319, 0.18]],
                    back: [[392, 0.06], [262, 0.08]],
                    insert: [[196, 0.05], [147, 0.08]],
                    boot: [[784, 0.08], [1175, 0.22]],
                    eject: [[330, 0.05], [220, 0.08]],
                    error: [[196, 0.12], [185, 0.2]]
                }[kind] || [[660, 0.05]];
                var t = ctx.currentTime;
                notes.forEach(function (n) {
                    var osc = ctx.createOscillator();
                    var gain = ctx.createGain();
                    osc.type = 'square';
                    osc.frequency.value = n[0];
                    gain.gain.setValueAtTime(0.05, t);
                    gain.gain.exponentialRampToValueAtTime(0.0001, t + n[1]);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(t);
                    osc.stop(t + n[1]);
                    t += n[1];
                });
            } catch (e) { /* audio is optional */ }
        }
    };

    var sfxBtn = $('#sfx-toggle');
    var titleSound = $('#title-sound');
    function renderSfx() {
        setSwitch(sfxBtn, sfx.on);
        var icon = sfxBtn && $('.i', sfxBtn);
        if (icon) {
            icon.classList.toggle('i-volume-x', !sfx.on);
            icon.classList.toggle('i-volume-2', sfx.on);
        }
        if (titleSound) {
            titleSound.setAttribute('aria-pressed', String(sfx.on));
            $('#title-sound-v').textContent = sfx.on ? 'on' : 'off';
        }
    }
    function toggleSfx() {
        sfx.on = !sfx.on;
        store('lonz-sfx', sfx.on ? 'on' : 'off');
        renderSfx();
        sfx.play('confirm');
        toast(sfx.on ? 'Sound on' : 'Sound off');
    }
    renderSfx();
    if (sfxBtn) sfxBtn.addEventListener('click', toggleSfx);
    if (titleSound) titleSound.addEventListener('click', toggleSfx);

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-sfx], .btn, .roster-btn, .shop-opt, .ach[data-gallery], .menu-link, .stage, .talk-menu a, .map a, .filter button, .poster');
        if (!el) return;
        sfx.play(el.getAttribute('data-sfx') || 'select');
    });

    /* ---------------------------------------------------------------
       2. Night / day palette
       --------------------------------------------------------------- */
    var themeBtn = $('#theme-toggle');
    function renderTheme() {
        var night = root.getAttribute('data-theme') === 'night';
        setSwitch(themeBtn, night);
        var icon = themeBtn && $('.i', themeBtn);
        if (!icon) return;
        icon.classList.toggle('i-moon', night);
        icon.classList.toggle('i-sun', !night);
    }
    if (themeBtn) {
        renderTheme();
        themeBtn.addEventListener('click', function () {
            var next = root.getAttribute('data-theme') === 'night' ? 'day' : 'night';
            root.setAttribute('data-theme', next);
            store('lonz-theme', next);
            renderTheme();
        });
    }

    /* ---------------------------------------------------------------
       3. Toast
       --------------------------------------------------------------- */
    var toastEl = $('#toast');
    var toastTimer = null;
    function toast(msg, ms) {
        if (!toastEl) toastEl = $('#toast');
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, ms || 1800);
    }
    LONZ.toast = toast;

    function copyText(text, done, fail) {
        var legacy = function () {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            ta.remove();
            if (ok) done(); else fail();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, legacy);
        } else {
            legacy();
        }
    }

    /* ---------------------------------------------------------------
       4. HUD: the pause menu (stage map, side quests, options), the stage
          readout and the current nav word
       --------------------------------------------------------------- */
    var menuBtn = $('#menu-btn');
    var coinBtn = $('#quest-btn');
    var pause = $('#pause');
    var canPause = !!(pause && typeof pause.showModal === 'function');
    var pauseOpener = null;

    function openPause(target) {
        if (!canPause || pause.open) return;
        pauseOpener = document.activeElement;
        renderQuests();
        pause.showModal();
        sfx.play('select');
        if (target) {
            target.scrollIntoView({ block: 'nearest' });
        } else {
            var here = $('.map a[aria-current]', pause) || $('.map a', pause);
            if (here) here.focus();
        }
    }
    if (canPause) {
        if (menuBtn) menuBtn.addEventListener('click', function () { openPause(null); });
        if (coinBtn) coinBtn.addEventListener('click', function () { openPause($('#side-quests')); });
        pause.addEventListener('click', function (e) {
            // the backdrop, B Back, or choosing a stage all close the menu
            var stage = e.target.closest('.map a');
            if (stage) pauseOpener = null;
            if (e.target === pause || stage || e.target.closest('[data-close-pause]')) pause.close();
        });
        pause.addEventListener('keydown', function (e) {
            if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) pause.close();
        });
        pause.addEventListener('close', function () {
            sfx.play('back');
            if (pauseOpener && document.body.contains(pauseOpener)) pauseOpener.focus();
        });
    } else {
        if (menuBtn) menuBtn.hidden = true;
        if (coinBtn) coinBtn.hidden = true;
    }

    // stages: every top-level section, in page order
    var navLinks = $$('.nav-list a');
    var mapLinks = $$('.map a');
    var stageN = $('#hud-stage-n');
    var stageName = $('#hud-stage-name');
    var seen = {};
    try { JSON.parse(store('lonz-seen') || '[]').forEach(function (id) { seen[id] = true; }); } catch (e) { seen = {}; }
    function renderStage(id) {
        var index = -1;
        mapLinks.forEach(function (a, i) {
            var on = a.getAttribute('data-stage') === id;
            if (on) { index = i; a.setAttribute('aria-current', 'location'); } else a.removeAttribute('aria-current');
            a.classList.toggle('is-seen', !!seen[a.getAttribute('data-stage')]);
        });
        if (index > -1 && stageN) {
            stageN.textContent = (index + 1) + '/' + mapLinks.length;
            stageName.textContent = $('.map-plain', mapLinks[index]).textContent;
        }
        navLinks.forEach(function (a) {
            var on = a.getAttribute('href') === '#' + id || (id === 'certifications' && a.getAttribute('href') === '#skills');
            a.classList.toggle('is-current', on);
            if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
        });
    }
    if ('IntersectionObserver' in window && mapLinks.length) {
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var id = entry.target.id === 'intro' ? 'home' : entry.target.id;
                if (!seen[id]) {
                    seen[id] = true;
                    store('lonz-seen', JSON.stringify(Object.keys(seen)));
                    if (id !== 'home') sfx.play('select');
                }
                renderStage(id);
            });
        }, { rootMargin: '-45% 0px -50% 0px' });
        $$('main > section[id]').forEach(function (sec) { spy.observe(sec); });
    }

    // title menu: up and down move between the choices
    var titleMenu = $('#title-menu');
    if (titleMenu) {
        titleMenu.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            var rows = $$('a, button', titleMenu);
            var i = rows.indexOf(document.activeElement);
            if (i < 0) return;
            e.preventDefault();
            rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus();
            sfx.play('select');
        });
    }

    /* ---------------------------------------------------------------
       5. Level progress: the bar under the HUD fills as the page scrolls
          and the runner jogs along it towards the flag.
       --------------------------------------------------------------- */
    var xpBar = $('.xp-bar');
    if (xpBar) {
        var xpFill = $('.xp-fill', xpBar);
        var runner = $('.xp-runner', xpBar);
        var ticking = false;
        var lastY = window.scrollY;
        var idle = null;
        var paint = function () {
            ticking = false;
            var y = window.scrollY;
            var max = root.scrollHeight - window.innerHeight;
            var p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
            var x = Math.round(p * Math.max(0, xpBar.clientWidth - 24 - 30));
            var back = y < lastY;
            xpFill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
            runner.style.transform = 'translateX(' + x + 'px)' + (back ? ' scaleX(-1)' : '');
            if (!motion.still && y !== lastY) {
                runner.style.backgroundPositionX = -(Math.floor(y / 36) % 4) * 24 + 'px';
                clearTimeout(idle);
                idle = setTimeout(function () {
                    runner.style.backgroundPositionX = '-96px';
                    runner.style.transform = 'translateX(' + x + 'px)';
                }, 180);
            }
            lastY = y;
        };
        var queue = function () {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(paint);
        };
        window.addEventListener('scroll', queue, { passive: true });
        window.addEventListener('resize', queue);
        queue();
    }

    /* ---------------------------------------------------------------
       6. Side quests: visitors collect a coin for each thing they try.
          Purely for fun; nothing on the page depends on it except the
          bonus game cartridge in the Arcade.
       --------------------------------------------------------------- */
    var QUESTS = {
        start: 'Pressed start',
        level: 'Opened a level',
        cart: 'Played a cartridge',
        poster: 'Looked at a poster',
        photo: 'Flipped the portrait',
        cert: 'Checked a certificate',
        shop: 'Browsed the shop',
        hello: 'Said hello',
        cheat: 'Entered the cheat code'
    };
    var UNLOCK = 5;
    var questDone = {};
    try {
        JSON.parse(store('lonz-quests') || '[]').forEach(function (id) { if (QUESTS[id]) questDone[id] = true; });
    } catch (e) { questDone = {}; }

    var coinCount = $('#coin-count');
    var coinLabel = $('#coin-label');
    var questLog = $('#side-quests');
    function coins() { return Object.keys(questDone).length; }
    function renderQuests() {
        var n = coins();
        if (coinCount) coinCount.textContent = String(n);
        if (coinLabel) coinLabel.textContent = n + (n === 1 ? ' coin' : ' coins') + '. Open the side quests';
        if (!questLog) return;
        var open = 0;
        $$('.q', questLog).forEach(function (li) {
            var id = li.getAttribute('data-quest');
            var is = !!questDone[id];
            var secret = li.hasAttribute('data-secret') || li.classList.contains('q-secret');
            li.classList.toggle('is-done', is);
            if (secret) $('.q-name', li).textContent = is ? li.getAttribute('data-name') : '???';
            $('.q-state', li).textContent = is ? 'Done' : (secret ? 'Secret, not found yet' : 'Not done yet');
            if (!secret && is) open += 1;
        });
        var total = $$('.q:not(.q-secret)', questLog).length;
        var progress = $('#quest-progress');
        if (progress) progress.textContent = open + ' of ' + total + (questDone.cheat ? ' + secret' : '');
        var reward = $('#quest-reward');
        if (reward) {
            reward.textContent = n >= UNLOCK
                ? 'Bonus game unlocked. Look for the LONZ RUN cartridge on the Arcade shelf.'
                : 'Collect ' + (UNLOCK - n) + ' more ' + (UNLOCK - n === 1 ? 'coin' : 'coins') + ' to unlock the bonus game cartridge on the Arcade shelf.';
        }
    }
    LONZ.coins = coins;
    LONZ.unlockAt = UNLOCK;
    LONZ.quest = function (id) {
        if (!QUESTS[id] || questDone[id]) return false;
        questDone[id] = true;
        store('lonz-quests', JSON.stringify(Object.keys(questDone)));
        renderQuests();
        var n = coins();
        toast(n === UNLOCK ? '+1 coin. Bonus game unlocked!' : '+1 coin: ' + QUESTS[id], n === UNLOCK ? 3200 : 2200);
        sfx.play('coin');
        if (coinBtn) {
            coinBtn.classList.remove('is-gain');
            void coinBtn.offsetWidth;
            coinBtn.classList.add('is-gain');
        }
        document.dispatchEvent(new CustomEvent('lonz:coins', { detail: n }));
        return true;
    };
    renderQuests();

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-quest]');
        if (el && !el.closest('.q-list')) LONZ.quest(el.getAttribute('data-quest'));
        if (e.target.closest('.level a[target="_blank"]')) LONZ.quest('level');
    });

    var saveReset = $('#save-reset');
    if (saveReset) {
        saveReset.addEventListener('click', function () {
            questDone = {};
            store('lonz-quests', '[]');
            renderQuests();
            document.dispatchEvent(new CustomEvent('lonz:coins', { detail: 0 }));
            toast('Coins reset');
        });
    }
    document.addEventListener('click', function (e) {
        if (e.target.closest('.shop-opt, .shop-actions a')) LONZ.quest('shop');
    });
    renderStage('home');

    /* ---------------------------------------------------------------
       7. Reveal: windows "open" as they scroll in. Content is visible
          by default; only sections still below the fold get armed.
       --------------------------------------------------------------- */
    if ('IntersectionObserver' in window && !motion.still) {
        var reveal = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target;
                el.classList.remove('is-armed');
                el.classList.add('is-in');
                reveal.unobserve(el);
            });
        }, { rootMargin: '0px 0px -12% 0px' });
        $$('[data-reveal]').forEach(function (el) {
            if (el.getBoundingClientRect().top > window.innerHeight) {
                el.classList.add('is-armed');
                reveal.observe(el);
            }
        });
    }

    /* ---------------------------------------------------------------
       8. Intro dialog: the line types itself out once, like an RPG text
          box. The full text is always in the page; a click or a key
          skips the typing.
       --------------------------------------------------------------- */
    var talk = $('#talk-text');
    if (talk && 'IntersectionObserver' in window && !motion.still) {
        var fullLine = talk.textContent;
        var typed = null;
        var typeTimer = null;
        var typedAt = 0;
        var finishTyping = function () {
            clearInterval(typeTimer);
            if (typed) typed.remove();
            typed = null;
            talk.classList.remove('is-typing');
        };
        var startTyping = function () {
            typed = document.createElement('span');
            typed.className = 'talk-typed';
            typed.setAttribute('aria-hidden', 'true');
            talk.classList.add('is-typing');
            talk.appendChild(typed);
            typeTimer = setInterval(function () {
                typedAt += 2;
                typed.textContent = fullLine.slice(0, typedAt);
                if (typedAt >= fullLine.length) finishTyping();
            }, 24);
        };
        var talkObs = new IntersectionObserver(function (entries) {
            if (!entries[0].isIntersecting) return;
            talkObs.disconnect();
            startTyping();
        }, { threshold: 0.6 });
        talkObs.observe(talk);
        var talkBox = talk.closest('.talk-box');
        talkBox.addEventListener('click', finishTyping);
        talkBox.addEventListener('focusin', finishTyping);
        document.addEventListener('keydown', function () { if (typed) finishTyping(); });
        motion.on(function (still) { if (still) finishTyping(); });
    }

    /* ---------------------------------------------------------------
       9. CRT reel on the title screen
       --------------------------------------------------------------- */
    var reel = $('#reel');
    if (reel) {
        var slides = $$('.reel-slide', reel);
        var title = $('#reel-title');
        var toggle = $('#reel-toggle');
        var idx = 0;
        var timer = null;
        var userPaused = motion.still;
        var hoverPaused = false;
        var offscreen = false;

        // later slides carry data-src so the first paint only fetches the first image
        var load = function (slide) {
            var im = $('img[data-src]', slide);
            if (im) { im.src = im.getAttribute('data-src'); im.removeAttribute('data-src'); }
        };
        var show = function (n) {
            slides[idx].classList.remove('is-on');
            slides[idx].setAttribute('tabindex', '-1');
            idx = (n + slides.length) % slides.length;
            load(slides[idx]);
            load(slides[(idx + 1) % slides.length]);
            slides[idx].classList.add('is-on');
            slides[idx].removeAttribute('tabindex');
            if (title) title.textContent = slides[idx].getAttribute('data-title');
            if (!motion.still) {
                reel.classList.remove('is-switching');
                void reel.offsetWidth;
                reel.classList.add('is-switching');
            }
        };
        var schedule = function () {
            clearInterval(timer);
            if (userPaused || hoverPaused || offscreen) return;
            load(slides[(idx + 1) % slides.length]);
            timer = setInterval(function () { show(idx + 1); }, 3600);
        };
        var renderToggle = function () {
            if (!toggle) return;
            var icon = $('.i', toggle);
            icon.classList.toggle('i-pause', !userPaused);
            icon.classList.toggle('i-play', userPaused);
            $('.sr-only', toggle).textContent = userPaused ? 'Play the monitor slideshow' : 'Pause the monitor slideshow';
        };
        motion.on(function (still) {
            userPaused = still;
            renderToggle();
            schedule();
        });
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                offscreen = !entries[0].isIntersecting;
                schedule();
            }).observe(reel);
        }
        if (toggle) {
            toggle.addEventListener('click', function () {
                userPaused = !userPaused;
                if (!userPaused) show(idx + 1);
                renderToggle();
                schedule();
            });
        }
        reel.addEventListener('mouseenter', function () { hoverPaused = true; schedule(); });
        reel.addEventListener('mouseleave', function () { hoverPaused = false; schedule(); });
        reel.addEventListener('focusin', function () { hoverPaused = true; schedule(); });
        reel.addEventListener('focusout', function () { hoverPaused = false; schedule(); });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) clearInterval(timer); else schedule();
        });
        renderToggle();
        schedule();
    }

    /* ---------------------------------------------------------------
       10. Tabs: character select, inventory, services
           (WAI-ARIA tabs with arrow keys, Home and End)
       --------------------------------------------------------------- */
    $$('[data-panel-hidden]').forEach(function (panel) {
        panel.hidden = true;
        panel.removeAttribute('data-panel-hidden');
    });
    $$('[data-tabs]').forEach(function (group) {
        var tabs = $$('[role="tab"]', group);
        var vertical = $('[role="tablist"]', group).getAttribute('aria-orientation') === 'vertical';
        var select = function (tab, focus) {
            tabs.forEach(function (t) {
                var on = t === tab;
                t.setAttribute('aria-selected', String(on));
                t.tabIndex = on ? 0 : -1;
                var panel = document.getElementById(t.getAttribute('aria-controls'));
                if (!panel) return;
                panel.hidden = !on;
                if (on && !motion.still) {
                    panel.classList.remove('is-entering');
                    void panel.offsetWidth;
                    panel.classList.add('is-entering');
                }
            });
            if (focus) tab.focus();
        };
        tabs.forEach(function (tab, i) {
            tab.addEventListener('click', function () { select(tab, false); });
            tab.addEventListener('keydown', function (e) {
                if (e.altKey || e.ctrlKey || e.metaKey) return;
                var next = null;
                // horizontal lists use Left/Right only (Up/Down keep scrolling the page);
                // the vertical service list also takes Left/Right because it wraps to a grid on tablets
                var fwd = vertical ? ['ArrowDown', 'ArrowRight'] : ['ArrowRight'];
                var back = vertical ? ['ArrowUp', 'ArrowLeft'] : ['ArrowLeft'];
                if (fwd.indexOf(e.key) > -1) next = tabs[(i + 1) % tabs.length];
                else if (back.indexOf(e.key) > -1) next = tabs[(i - 1 + tabs.length) % tabs.length];
                else if (e.key === 'Home') next = tabs[0];
                else if (e.key === 'End') next = tabs[tabs.length - 1];
                if (next) {
                    e.preventDefault();
                    select(next, true);
                    sfx.play('select');
                }
            });
        });
    });

    /* ---------------------------------------------------------------
       11. Portrait: pixels or photo
       --------------------------------------------------------------- */
    var pBtn = $('#portrait-toggle');
    var portrait = $('#portrait');
    if (pBtn && portrait) {
        pBtn.addEventListener('click', function () {
            var photo = !portrait.classList.contains('is-photo');
            portrait.classList.toggle('is-photo', photo);
            // only the picture on show is exposed to assistive tech
            $('.portrait-px', portrait).setAttribute('aria-hidden', String(photo));
            $('.portrait-photo', portrait).setAttribute('aria-hidden', String(!photo));
            pBtn.setAttribute('aria-pressed', String(photo));
            $('.btn-label', pBtn).textContent = photo ? 'Show pixels' : 'Show photo';
            LONZ.quest('photo');
        });
    }

    /* ---------------------------------------------------------------
       12. Galleries + viewer dialog
           (js/arcade.js adds the "wall" gallery for the poster wall)
       --------------------------------------------------------------- */
    var IMG = 'assets/img/';
    function img(src, alt, caption, thumb) { return { type: 'image', src: src, alt: alt, caption: caption || alt, thumb: thumb || src }; }

    var GALLERIES = LONZ.galleries = {
        oneup: {
            title: 'Level 1-3: ONE UP',
            label: 'ONE UP screenshots',
            quest: 'level',
            items: [
                img(IMG + 'work/oneup/home.webp', 'ONE UP home screen with level, weekly streak, recovery map and Fitness Score', 'Home: level, weekly streak, recovery map and Fitness Score. Screens use a demo account.'),
                img(IMG + 'work/oneup/workout.webp', 'ONE UP active workout screen with a next-weight tip, set table and rest timer', 'Workout: next-weight tips, set logging and a rest timer that keeps running in the background.'),
                img(IMG + 'work/oneup/recovery.webp', 'ONE UP recovery map showing a front and back muscle heatmap', 'Recovery map: a front and back muscle heatmap built from finished workouts.'),
                img(IMG + 'work/oneup/progress.webp', 'ONE UP progress screen with Fitness Score ring and training calendar', 'Progress: Fitness Score from 0 to 1000, training calendar, XP and streak.'),
                img(IMG + 'work/oneup/coach.webp', 'ONE UP AI coach chat suggesting an exercise swap for a sore knee', 'AI coach: answers with real library exercises, with a Report button on every reply.'),
                img(IMG + 'work/oneup/food.webp', 'ONE UP nutrition screen with calorie ring, macros and hydration tracker', 'Nutrition: calorie and macro rings plus a hydration tracker.'),
                img(IMG + 'work/oneup/landing.webp', 'ONE UP landing page hero with the app on a phone', 'The landing page I built for the app.')
            ]
        },
        coffee: {
            title: 'Level 1-1: The Coffee Realm',
            label: 'The Coffee Realm pages and photos',
            quest: 'level',
            link: { href: 'https://www.thecoffeerealm.online', label: 'Visit the site' },
            items: [
                img(IMG + 'work/coffee/site-home.webp', 'The Coffee Realm home page: Homemade. Freshly baked. Brewed daily.', 'Home page with Order Online and Browse Menu.', IMG + 'work/coffee/site-home-sm.webp'),
                img(IMG + 'work/coffee/site-offers.webp', 'The Coffee Realm rewards page: Coming back should count for something.', 'Rewards: points on every order, traded for drinks and bakes.'),
                img(IMG + 'work/coffee/site-story.webp', 'The Coffee Realm story page with the shopfront photo', 'Our story page.'),
                img(IMG + 'work/coffee/shopfront-night.webp', 'The Coffee Realm shopfront at dusk with its lit sign', 'The shop in North Fairview, Quezon City. Photo: The Coffee Realm.'),
                img(IMG + 'work/coffee/drinks.webp', 'Matcha, iced lattes and a latte-art coffee on a green tiled table', 'Menu photography used on the site. Photo: The Coffee Realm.'),
                img(IMG + 'work/coffee/cakes.webp', 'Whole cakes on stands: carrot, chocolate, matcha and burnt Basque', 'Cakes from the bakery side. Photo: The Coffee Realm.')
            ]
        },
        jmi2: {
            title: 'Level 1-2: JMI2 Waterproofing',
            label: 'JMI2 Waterproofing pages',
            quest: 'level',
            items: [
                img(IMG + 'work/jmi2/home.webp', 'JMI2 Waterproofing home page with a drone shot of a finished roof deck', 'Home: drone-video hero and a Request a Proposal call to action.', IMG + 'work/jmi2/home-sm.webp'),
                img(IMG + 'work/jmi2/services.webp', 'JMI2 services page: Comprehensive Waterproofing Solutions', 'Services page with an editorial layout and a video hero.', IMG + 'work/jmi2/services-sm.webp'),
                img(IMG + 'work/jmi2/projects.webp', 'JMI2 featured projects grid with location labels', 'Featured projects with city-level location tags.', IMG + 'work/jmi2/projects-sm.webp'),
                img(IMG + 'work/jmi2/service-cards.webp', 'JMI2 home page service cards for three waterproofing systems', 'Three service cards on the home page.', IMG + 'work/jmi2/service-cards-sm.webp')
            ]
        },
        art: {
            title: 'Bonus stage: illustrations',
            label: 'Illustrations',
            quest: 'poster',
            items: [
                img(IMG + 'art/pic4.webp', 'Digital illustration of a red-haired character in a black choker, lettered MICHEAL', 'Micheal'),
                img(IMG + 'art/pic5.webp', 'Digital illustration of a silver-haired character in a black coat, lettered DEMON', 'Demon'),
                img(IMG + 'art/pic1.webp', 'Digital illustration of a dark-haired character in a crop top and loose jacket', 'Crop top'),
                img(IMG + 'art/pic2.webp', 'Digital illustration of a blond character in an embroidered black jacket', 'Jacket'),
                img(IMG + 'art/pic3.webp', 'Digital illustration of a red-haired character in a grey hoodie', 'Hoodie')
            ]
        },
        certs: {
            title: 'Achievements',
            label: 'Certificates',
            quest: 'cert',
            items: [
                img(IMG + 'certs/aws-cloud-foundations.webp', 'AWS Academy Graduate, Cloud Foundations training badge certificate for Mark Nikko Lonzaga, 20 hours, issued May 27, 2026', 'AWS Academy Graduate: Cloud Foundations. May 27, 2026.'),
                img(IMG + 'certs/cyber-junior-analyst.webp', 'Cisco Networking Academy certificate for Mark Nikko Lonzaga, completed Feb 26, 2026', 'Junior Cybersecurity Analyst Career Path, Cisco Networking Academy. Feb 26, 2026.'),
                img(IMG + 'certs/ccna-ensa.webp', 'Cisco Networking Academy course completion certificate: CCNA Enterprise Networking, Security, and Automation, completed Jul 21, 2025', 'CCNA: Enterprise Networking, Security, and Automation. Cisco Networking Academy course, completed Jul 21, 2025.'),
                img(IMG + 'certs/ccna-srwe.webp', 'Cisco Networking Academy course completion certificate: CCNA Switching, Routing, and Wireless Essentials, completed Jul 21, 2025', 'CCNA: Switching, Routing, and Wireless Essentials. Cisco Networking Academy course, completed Jul 21, 2025.'),
                img(IMG + 'certs/ccna-itn.webp', 'Cisco Networking Academy course completion certificate: CCNA Introduction to Networks, completed Feb 5, 2025', 'CCNA: Introduction to Networks. Cisco Networking Academy course, completed Feb 5, 2025.'),
                img(IMG + 'certs/nexus-winserver.webp', 'Nexus Cloud IT Solutions certificate of achievement: Windows Server 2019 System Administration and Automation, Aug 3, 2024', 'Windows Server 2019: System Administration and Automation, Nexus Cloud IT Solutions. Aug 3, 2024.')
            ]
        }
    };
    // the verify link belongs to the one certificate it verifies, not to the whole gallery
    GALLERIES.certs.items[0].link = { href: 'https://www.credly.com/go/bT1y6PFj', label: 'Verify AWS badge' };

    var viewer = $('#viewer');
    if (viewer && typeof viewer.showModal !== 'function') {
        // very old browsers: no <dialog>, so open the media file itself
        document.addEventListener('click', function (e) {
            var trigger = e.target.closest('[data-gallery]');
            var g = trigger && GALLERIES[trigger.getAttribute('data-gallery')];
            if (!g) return;
            e.preventDefault();
            var item = g.items[Number(trigger.getAttribute('data-index') || 0)] || g.items[0];
            window.open(item.src, '_blank', 'noopener');
        });
    }
    if (viewer && typeof viewer.showModal === 'function') {
        var vMedia = $('#viewer-media');
        var vCaption = $('#viewer-caption');
        var vCount = $('#viewer-count');
        var vStatus = $('#viewer-status');
        var vTitle = $('#viewer-title');
        var vThumbs = $('#viewer-thumbs');
        var vLink = $('#viewer-link');
        var vLinkLabel = $('#viewer-link-label');
        var current = null;
        var pos = 0;
        var opener = null;

        var render = function () {
            var item = current.items[pos];
            vMedia.textContent = '';
            var el = document.createElement('img');
            el.src = item.src;
            el.alt = item.alt;
            el.decoding = 'async';
            vMedia.appendChild(el);
            vCaption.textContent = item.caption;
            vCount.textContent = (pos + 1) + ' / ' + current.items.length;
            if (vStatus) vStatus.textContent = 'Image ' + (pos + 1) + ' of ' + current.items.length + ': ' + item.caption;
            // a link on the item wins over the gallery's own
            var link = item.link || current.link;
            vLink.hidden = !link;
            if (link) {
                vLink.href = link.href;
                vLinkLabel.textContent = link.label;
            }
            $$('.viewer-thumb', vThumbs).forEach(function (t, i) {
                if (i === pos) {
                    t.setAttribute('aria-current', 'true');
                    t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                } else {
                    t.removeAttribute('aria-current');
                }
            });
            // warm the next image
            var pre = new Image();
            pre.src = current.items[(pos + 1) % current.items.length].src;
        };

        var step = function (d) {
            pos = (pos + d + current.items.length) % current.items.length;
            render();
            sfx.play('select');
        };

        var open = function (key, index, trigger) {
            current = GALLERIES[key];
            if (!current || !current.items.length) return;
            pos = Math.max(0, Math.min(index || 0, current.items.length - 1));
            opener = trigger || null;
            vTitle.textContent = current.title;
            viewer.setAttribute('aria-label', current.label || current.title);
            vThumbs.textContent = '';
            current.items.forEach(function (item, i) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'viewer-thumb';
                b.setAttribute('aria-label', 'Show item ' + (i + 1) + ': ' + item.caption);
                var t = document.createElement('img');
                t.loading = 'lazy';
                t.alt = '';
                t.src = item.thumb;
                b.appendChild(t);
                b.addEventListener('click', function () { pos = i; render(); });
                vThumbs.appendChild(b);
            });
            viewer.showModal();
            document.body.style.overflow = 'hidden';
            render();
            $('[data-close]', viewer).focus();
            if (current.quest) LONZ.quest(current.quest);
        };
        LONZ.openViewer = open;

        var close = function () {
            if (viewer.open) viewer.close();
        };

        viewer.addEventListener('close', function () {
            vMedia.textContent = '';
            document.body.style.overflow = '';
            sfx.play('back');
            if (opener && document.body.contains(opener)) opener.focus();
        });
        viewer.addEventListener('click', function (e) {
            if (e.target === viewer) close();
        });
        $('[data-close]', viewer).addEventListener('click', close);
        $$('[data-step]', viewer).forEach(function (b) {
            b.addEventListener('click', function () { step(Number(b.getAttribute('data-step'))); });
        });
        viewer.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
            if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) close();
        });
        // swipe on touch screens (not while pinching)
        var touchX = null;
        var touchY = null;
        vMedia.addEventListener('touchstart', function (e) {
            if (e.touches.length > 1) { touchX = null; return; }
            touchX = e.touches[0].clientX;
            touchY = e.touches[0].clientY;
        }, { passive: true });
        vMedia.addEventListener('touchend', function (e) {
            if (touchX === null) return;
            var dx = e.changedTouches[0].clientX - touchX;
            var dy = e.changedTouches[0].clientY - touchY;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
            touchX = null;
        });

        document.addEventListener('click', function (e) {
            var trigger = e.target.closest('[data-gallery]');
            if (!trigger) return;
            e.preventDefault();
            open(trigger.getAttribute('data-gallery'), Number(trigger.getAttribute('data-index') || 0), trigger);
        });

        // the character-select "View full size" opens on the selected character
        var artBtn = $('[data-gallery="art"]');
        if (artBtn) {
            $$('.roster-btn').forEach(function (t, i) {
                t.addEventListener('click', function () { artBtn.setAttribute('data-index', String(i)); });
                t.addEventListener('focus', function () {
                    if (t.getAttribute('aria-selected') === 'true') artBtn.setAttribute('data-index', String(i));
                });
            });
            var roster = $('.charsel-roster');
            if (roster) {
                roster.addEventListener('keyup', function () {
                    $$('.roster-btn').forEach(function (t, i) {
                        if (t.getAttribute('aria-selected') === 'true') artBtn.setAttribute('data-index', String(i));
                    });
                });
            }
        }
    }

    /* ---------------------------------------------------------------
       13. Copy email
       --------------------------------------------------------------- */
    $$('[data-copy]').forEach(function (b) {
        b.addEventListener('click', function () {
            var text = b.getAttribute('data-copy');
            copyText(text, function () {
                toast('Email copied');
                sfx.play('coin');
                LONZ.quest('hello');
            }, function () { toast('Copy failed: ' + text, 5000); });
        });
    });

    /* ---------------------------------------------------------------
       14. Project brief: the form writes a message for the visitor's own
           email or messages app. Nothing is sent to this site;
           the draft is kept in this browser only.
       --------------------------------------------------------------- */
    var brief = $('#brief');
    if (brief) {
        var EMAIL = 'mnikkolonzaga@gmail.com';
        var PHONE = '+639512329712';
        var note = $('#brief-note');
        var noteStart = note.textContent;
        var details = brief.elements.details;
        var refRow = $('#brief-ref');
        var refText = $('#brief-ref-text');
        var reference = '';

        var setReference = function (text) {
            reference = text || '';
            refText.textContent = reference;
            refRow.hidden = !reference;
        };
        var tick = function (value) {
            var box = $('input[name="need"][value="' + value + '"]', brief);
            if (box) box.checked = true;
        };
        var compose = function () {
            var needs = $$('input[name="need"]:checked', brief).map(function (i) { return i.value; });
            var when = $('input[name="when"]:checked', brief);
            var name = brief.elements.name.value.trim();
            var budget = brief.elements.budget.value.trim();
            var text = details.value.trim();
            var lines = ['Hi Mark,', ''];
            if (needs.length) lines.push('I need: ' + needs.join(', '));
            if (reference) lines.push('Like this one: ' + reference);
            if (when) lines.push('Needed: ' + when.value);
            if (budget) lines.push('Budget: ' + budget);
            if (text) lines.push('', text);
            if (name) lines.push('', 'Thanks,', name);
            return {
                ok: needs.length > 0 || text.length > 0,
                subject: 'Project brief' + (needs.length ? ': ' + needs.join(', ') : ''),
                body: lines.join('\n')
            };
        };
        var say = function (msg, error) {
            note.textContent = msg;
            note.classList.toggle('is-error', !!error);
            if (error) details.setAttribute('aria-invalid', 'true');
            else details.removeAttribute('aria-invalid');
        };
        var ready = function () {
            var b = compose();
            if (!b.ok) {
                say('Pick what you need or add a few words first.', true);
                details.focus();
                sfx.play('error');
                return null;
            }
            return b;
        };
        var drafted = function (via) {
            say('Brief drafted. It is sent when you press send in your ' + via + '. If nothing opened, use Copy it and send it to ' + EMAIL + '.');
            sfx.play('confirm');
            LONZ.quest('hello');
            store('lonz-brief', '');
        };

        // the draft survives a reload, in this browser only
        var save = function () {
            store('lonz-brief', JSON.stringify({
                need: $$('input[name="need"]:checked', brief).map(function (i) { return i.value; }),
                when: ($('input[name="when"]:checked', brief) || {}).value || '',
                name: brief.elements.name.value,
                budget: brief.elements.budget.value,
                details: details.value,
                ref: reference
            }));
        };
        try {
            var draft = JSON.parse(store('lonz-brief') || 'null');
            if (draft) {
                (draft.need || []).forEach(tick);
                var w = $('input[name="when"][value="' + draft.when + '"]', brief);
                if (w) w.checked = true;
                brief.elements.name.value = draft.name || '';
                brief.elements.budget.value = draft.budget || '';
                details.value = draft.details || '';
                setReference(draft.ref || '');
                if (compose().ok) say('Your draft from last time is still here. ' + noteStart);
            }
        } catch (e) { /* a broken draft is simply ignored */ }

        brief.addEventListener('input', function () {
            if (note.classList.contains('is-error')) say(noteStart);
            save();
        });
        brief.addEventListener('change', save);
        brief.addEventListener('submit', function (e) {
            e.preventDefault();
            var b = ready();
            if (!b) return;
            drafted('email app');
            window.location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(b.subject) + '&body=' + encodeURIComponent(b.body);
        });
        $('#brief-sms').addEventListener('click', function () {
            var b = ready();
            if (!b) return;
            drafted('messages app');
            window.location.href = 'sms:' + PHONE + '?&body=' + encodeURIComponent(b.body);
        });
        $('#brief-copy').addEventListener('click', function () {
            var b = ready();
            if (!b) return;
            copyText('To: ' + EMAIL + '\nSubject: ' + b.subject + '\n\n' + b.body, function () {
                say('Brief copied. Paste it into an email to ' + EMAIL + ' or a text to 0951 232 9712.');
                toast('Brief copied');
                LONZ.quest('hello');
            }, function () { say('Copy did not work in this browser. Use Email it instead.', true); });
        });
        var shareBtn = $('#brief-share');
        if (navigator.share) {
            shareBtn.hidden = false;
            shareBtn.addEventListener('click', function () {
                var b = ready();
                if (!b) return;
                navigator.share({ title: b.subject, text: b.body }).then(function () {
                    say('Shared. Send it to ' + EMAIL + ' or 0951 232 9712 in the app you picked.');
                    LONZ.quest('hello');
                }, function (err) {
                    // closing the share sheet is not an error; anything else is said out loud
                    if (!err || err.name !== 'AbortError') say('Sharing did not work here. Use Copy it or Email it instead.', true);
                });
            });
        }
        $('#brief-ref-clear').addEventListener('click', function () { setReference(''); save(); });

        // "Start a project" on a service, or "Want one like this?" on the console, fills in the brief
        LONZ.brief = function (need, ref) {
            if (need) tick(need);
            if (ref) setReference(ref);
            save();
        };
        $$('[data-need]').forEach(function (link) {
            link.addEventListener('click', function () { LONZ.brief(link.getAttribute('data-need'), ''); });
        });
    }

    /* ---------------------------------------------------------------
       15. CONTINUE? countdown: 9 to 0 once, only while visible
       --------------------------------------------------------------- */
    var countdown = $('#countdown');
    if (countdown && 'IntersectionObserver' in window) {
        var n = 9;
        var cdTimer = null;
        var cdVisible = false;
        var cdRun = function () {
            clearInterval(cdTimer);
            if (!cdVisible || motion.still || n <= 0) return;
            cdTimer = setInterval(function () {
                n -= 1;
                countdown.textContent = String(n);
                if (n <= 0) clearInterval(cdTimer);
            }, 1000);
        };
        new IntersectionObserver(function (entries) {
            cdVisible = entries[0].isIntersecting;
            cdRun();
        }).observe(countdown);
        motion.on(cdRun);
    }

    /* ---------------------------------------------------------------
       16. Debug stats: an Options switch (and the cheat code) shows a
           frame-counter style readout. Every number is measured live
           in the visitor's own browser; nothing is hard-coded.
       --------------------------------------------------------------- */
    var debugEl = $('#debug');
    var debugBtn = $('#debug-toggle');
    if (debugEl && window.performance && performance.getEntriesByType) {
        var debug = { on: false, timer: null, lcp: 0, frames: 0, fps: 0, raf: 0, mark: 0 };
        try {
            new PerformanceObserver(function (list) {
                var seenPaints = list.getEntries();
                if (seenPaints.length) debug.lcp = seenPaints[seenPaints.length - 1].startTime;
            }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (e) { /* not every browser reports it; the row then reads n/a */ }
        var put = function (id, text) {
            var cell = $(id);
            if (cell) cell.textContent = text;
        };
        var paintDebug = function () {
            var res = performance.getEntriesByType('resource');
            var nav = performance.getEntriesByType('navigation')[0];
            var bytes = nav ? (nav.encodedBodySize || 0) : 0;
            var other = 0;
            res.forEach(function (r) {
                bytes += r.encodedBodySize || r.transferSize || 0;
                if (/^https?:/.test(r.name) && r.name.indexOf(window.location.origin + '/') !== 0) other += 1;
            });
            put('#dbg-req', String(res.length + (nav ? 1 : 0)));
            put('#dbg-kb', bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB');
            put('#dbg-3p', String(other));
            put('#dbg-lcp', debug.lcp ? (debug.lcp / 1000).toFixed(2) + ' s' : 'n/a');
            put('#dbg-dom', String(document.getElementsByTagName('*').length));
            put('#dbg-fps', debug.fps ? String(debug.fps) : 'n/a');
        };
        var countFrame = function (now) {
            if (!debug.on) return;
            debug.frames += 1;
            if (now - debug.mark >= 1000) {
                debug.fps = Math.round(debug.frames * 1000 / (now - debug.mark));
                debug.frames = 0;
                debug.mark = now;
            }
            debug.raf = window.requestAnimationFrame(countFrame);
        };
        var setDebug = function (on, quiet) {
            debug.on = on;
            debugEl.hidden = !on;
            setSwitch(debugBtn, on);
            store('lonz-debug', on ? 'on' : 'off');
            clearInterval(debug.timer);
            window.cancelAnimationFrame(debug.raf);
            if (on) {
                debug.frames = 0;
                debug.fps = 0;
                debug.mark = performance.now();
                debug.raf = window.requestAnimationFrame(countFrame);
                paintDebug();
                debug.timer = setInterval(paintDebug, 1000);
            }
            if (!quiet) toast(on ? 'Debug stats on' : 'Debug stats off');
        };
        // returns the new state, so the cheat code can say what it did
        LONZ.debug = function (quiet) {
            setDebug(!debug.on, quiet);
            return debug.on;
        };
        if (debugBtn) debugBtn.addEventListener('click', function () { setDebug(!debug.on); });
        if (store('lonz-debug') === 'on') setDebug(true, true);
    } else if (debugBtn) {
        debugBtn.closest('li').hidden = true;
    }

    /* ---------------------------------------------------------------
       17. Cheat code: up up down down left right left right B A
           switches the debug stats on or off (and hides a coin).
       --------------------------------------------------------------- */
    var code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    var at = 0;
    document.addEventListener('keydown', function (e) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || !e.key) return;
        // inside the console the same keys change cartridges and volume, so the code is not read there
        if (e.target.closest && e.target.closest('#gb')) { at = 0; return; }
        if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
        var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === code[at]) at += 1;
        else if (key === 'ArrowUp') at = (at === 2 && code[1] === 'ArrowUp') ? 2 : 1;
        else at = 0;
        if (at < code.length) return;
        at = 0;
        var shown = LONZ.debug ? LONZ.debug(true) : false;
        if (!LONZ.quest('cheat')) {
            toast(shown ? 'Cheat on: debug stats' : 'Cheat off: debug stats hidden');
            sfx.play('coin');
        }
        if (motion.still) return;
        for (var i = 0; i < 24; i++) {
            var c = document.createElement('span');
            c.className = 'coin-rain';
            c.style.left = Math.round((i / 24) * 100) + 'vw';
            c.style.animationDelay = '0s, ' + ((i * 37) % 600) + 'ms';
            c.style.setProperty('--fall', (1.2 + ((i * 7) % 10) / 10) + 's');
            document.body.appendChild(c);
            setTimeout(function (el) { el.remove(); }, 3200, c);
        }
    });
})();
