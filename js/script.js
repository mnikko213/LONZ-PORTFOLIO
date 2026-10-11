/* LONZ PORTFOLIO: retro game edition. Vanilla JS, no dependencies. */
(function () {
    'use strict';

    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function store(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            localStorage.setItem(key, value);
        } catch (e) { return null; }
        return null;
    }

    /* ---------------------------------------------------------------
       0. Motion switch: the HUD pause button (or the OS reduced-motion
          setting) stops every looping animation, video and timer.
       --------------------------------------------------------------- */
    var motion = {
        still: reduceMotion.matches || store('lonz-motion') === 'off',
        fns: [],
        on: function (fn) { this.fns.push(fn); },
        set: function (still) {
            this.still = still;
            document.documentElement.classList.toggle('motion-off', still);
            this.fns.forEach(function (fn) { fn(still); });
        }
    };
    document.documentElement.classList.toggle('motion-off', motion.still);
    var motionBtn = document.getElementById('motion-toggle');
    if (motionBtn) {
        motionBtn.setAttribute('aria-pressed', String(motion.still));
        motionBtn.addEventListener('click', function () {
            var still = !motion.still;
            store('lonz-motion', still ? 'off' : 'on');
            motion.set(still);
            motionBtn.setAttribute('aria-pressed', String(still));
            toast(still ? 'Animations paused' : 'Animations on');
        });
    }

    /* ---------------------------------------------------------------
       1. Sound effects (off by default, tiny square-wave blips)
       --------------------------------------------------------------- */
    var sfx = {
        on: store('lonz-sfx') === 'on',
        ctx: null,
        play: function (kind) {
            if (!this.on) return;
            try {
                if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                var ctx = this.ctx;
                var notes = {
                    select: [[660, 0.05]],
                    confirm: [[523, 0.06], [784, 0.08]],
                    start: [[392, 0.07], [523, 0.07], [784, 0.12]],
                    coin: [[988, 0.06], [1319, 0.18]],
                    back: [[392, 0.06], [262, 0.08]]
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
    function renderSfx() {
        if (!sfxBtn) return;
        sfxBtn.setAttribute('aria-pressed', String(sfx.on));
        var icon = $('.i', sfxBtn);
        icon.classList.toggle('i-volume-x', !sfx.on);
        icon.classList.toggle('i-volume-2', sfx.on);
    }
    if (sfxBtn) {
        renderSfx();
        sfxBtn.addEventListener('click', function () {
            sfx.on = !sfx.on;
            store('lonz-sfx', sfx.on ? 'on' : 'off');
            renderSfx();
            sfx.play('confirm');
            toast(sfx.on ? 'Sound on' : 'Sound off');
        });
    }

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-sfx], .btn, .roster-btn, .inv-tab, .shop-opt, .cart, button.ach, .menu-link');
        if (!el || el === sfxBtn) return;
        sfx.play(el.getAttribute('data-sfx') || 'select');
    });

    /* ---------------------------------------------------------------
       2. Day / night theme
       --------------------------------------------------------------- */
    var root = document.documentElement;
    var themeBtn = $('#theme-toggle');
    var themeMeta = $('meta[name="theme-color"]');
    function renderTheme() {
        var night = root.getAttribute('data-theme') === 'night';
        if (!themeBtn) return;
        themeBtn.setAttribute('aria-pressed', String(night));
        var icon = $('.i', themeBtn);
        icon.classList.toggle('i-moon', !night);
        icon.classList.toggle('i-sun', night);
        if (themeMeta) themeMeta.setAttribute('content', '#16123a');
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

    /* ---------------------------------------------------------------
       4. HUD: mobile menu + current section
       --------------------------------------------------------------- */
    var hud = $('#hud');
    var menuBtn = $('#menu-btn');
    function closeMenu() {
        if (!hud || !hud.classList.contains('nav-open')) return;
        hud.classList.remove('nav-open');
        menuBtn.setAttribute('aria-expanded', 'false');
    }
    if (menuBtn) {
        menuBtn.addEventListener('click', function () {
            var open = !hud.classList.contains('nav-open');
            hud.classList.toggle('nav-open', open);
            menuBtn.setAttribute('aria-expanded', String(open));
            if (open) {
                var first = $('.nav-list a', hud);
                if (first) first.focus();
            }
        });
        $$('.nav-list a').forEach(function (a) { a.addEventListener('click', closeMenu); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && hud.classList.contains('nav-open')) {
                closeMenu();
                menuBtn.focus();
            }
        });
        document.addEventListener('click', function (e) {
            if (hud.classList.contains('nav-open') && !hud.contains(e.target)) closeMenu();
        });
    }

    var navLinks = $$('.nav-list a');
    if ('IntersectionObserver' in window && navLinks.length) {
        var byId = {};
        navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var id = entry.target.id === 'archive' ? 'work' : entry.target.id;
                navLinks.forEach(function (a) {
                    var on = a === byId[id];
                    a.classList.toggle('is-current', on);
                    if (on) a.setAttribute('aria-current', 'location');
                    else a.removeAttribute('aria-current');
                });
            });
        }, { rootMargin: '-45% 0px -50% 0px' });
        $$('main > section[id]').forEach(function (s) { spy.observe(s); });
    }

    /* ---------------------------------------------------------------
       5. Reveal: windows "open" as they scroll in. Content is visible
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
       6. CRT reel on the title screen
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
       7. Tabs: character select, inventory, services
          (WAI-ARIA tabs with arrow keys, Home and End)
       --------------------------------------------------------------- */
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
       8. Portrait: pixels or photo
       --------------------------------------------------------------- */
    var pBtn = $('#portrait-toggle');
    var portrait = $('#portrait');
    if (pBtn && portrait) {
        pBtn.addEventListener('click', function () {
            var photo = !portrait.classList.contains('is-photo');
            portrait.classList.toggle('is-photo', photo);
            $('.btn-label', pBtn).textContent = photo ? 'Show pixels' : 'Show photo';
        });
    }

    /* ---------------------------------------------------------------
       9. Cartridge previews play only while on screen
       --------------------------------------------------------------- */
    // Posters load when the shelf comes near (on every device; on phones the poster is the preview).
    var carts = $$('.cart-video');
    var setPoster = function (v) { if (v.dataset.poster) { v.poster = v.dataset.poster; v.removeAttribute('data-poster'); } };
    if ('IntersectionObserver' in window) {
        var posterObs = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) { setPoster(entry.target); posterObs.unobserve(entry.target); }
            });
        }, { rootMargin: '800px 0px' });
        carts.forEach(function (v) { posterObs.observe(v); });
    } else {
        carts.forEach(setPoster);
    }
    // Previews play only on devices with a mouse (saves phone data), and never while motion is paused.
    var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (carts.length && 'IntersectionObserver' in window && canHover) {
        var seen = new Set();
        var playCart = function (v) {
            if (motion.still) return;
            v.preload = 'auto';
            var p = v.play();
            if (p && p.catch) p.catch(function () {});
        };
        var cartObs = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                var v = entry.target;
                if (entry.isIntersecting) { seen.add(v); playCart(v); }
                else { seen.delete(v); v.pause(); }
            });
        }, { threshold: 0.25 });
        carts.forEach(function (v) { cartObs.observe(v); });
        motion.on(function (still) {
            carts.forEach(function (v) { if (still) v.pause(); else if (seen.has(v)) playCart(v); });
        });
    }

    /* ---------------------------------------------------------------
       10. Galleries + viewer dialog
       --------------------------------------------------------------- */
    var IMG = 'assets/img/';
    var VID = 'assets/video/full/';
    function img(src, alt, caption, thumb) { return { type: 'image', src: src, alt: alt, caption: caption || alt, thumb: thumb || src }; }
    function vid(name, caption) { return { type: 'video', src: VID + name + '.mp4', poster: VID + name + '.webp', caption: caption, thumb: VID + name + '.webp' }; }

    var GALLERIES = {
        oneup: {
            title: 'one-up.apk',
            label: 'ONE UP screenshots',
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
            title: 'coffee-realm.pos',
            label: 'The Coffee Realm pages and photos',
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
            title: 'jmi2.html',
            label: 'JMI2 Waterproofing pages',
            items: [
                img(IMG + 'work/jmi2/home.webp', 'JMI2 Waterproofing home page with a drone shot of a finished roof deck', 'Home: drone-video hero and a Request a Proposal call to action.', IMG + 'work/jmi2/home-sm.webp'),
                img(IMG + 'work/jmi2/services.webp', 'JMI2 services page: Comprehensive Waterproofing Solutions', 'Services page with an editorial layout and a video hero.', IMG + 'work/jmi2/services-sm.webp'),
                img(IMG + 'work/jmi2/projects.webp', 'JMI2 featured projects grid with location labels', 'Featured projects with city-level location tags.', IMG + 'work/jmi2/projects-sm.webp'),
                img(IMG + 'work/jmi2/service-cards.webp', 'JMI2 home page service cards for three waterproofing systems', 'Three service cards on the home page.', IMG + 'work/jmi2/service-cards-sm.webp')
            ]
        },
        art: {
            title: 'character-select',
            label: 'Illustrations',
            items: [
                img(IMG + 'art/pic4.webp', 'Digital illustration of a red-haired character in a black choker, lettered MICHEAL', 'Micheal'),
                img(IMG + 'art/pic5.webp', 'Digital illustration of a silver-haired character in a black coat, lettered DEMON', 'Demon'),
                img(IMG + 'art/pic1.webp', 'Digital illustration of a dark-haired character in a crop top and loose jacket', 'Crop top'),
                img(IMG + 'art/pic2.webp', 'Digital illustration of a blond character in an embroidered black jacket', 'Jacket'),
                img(IMG + 'art/pic3.webp', 'Digital illustration of a red-haired character in a grey hoodie', 'Hoodie')
            ]
        },
        graphics: {
            title: 'graphics.cart',
            label: 'Graphic design work',
            link: { href: 'https://drive.google.com/drive/folders/1bbLJtDv6jUpr_zYZG6JoOniDPYJIz0H6', label: 'Full folder' },
            items: [
                ['pong-buying-pairs', 'Pong Soles post: Buying Pairs, with a brown high-top sneaker'],
                ['pong-cash-for-kicks', 'Pong Soles post: Cash for Kicks, with a red and black sneaker'],
                ['pong-we-buy', 'Pong Soles post: Sell your sneakers, we buy'],
                ['pong-sell-your-heat', 'Pong Soles post: Sell your heat, on yellow'],
                ['pong-got-heat', 'Pong Soles post: Got heat? We buy'],
                ['pong-kicks-to-cash', 'Pong Soles post: Kicks to cash, on orange'],
                ['pong-sell-us', 'Pong Soles post: Sell us your soles, pink sneaker'],
                ['pong-sapatos', 'Pong Soles post: Sapatos mo, bilhin ko'],
                ['ano-toys-sale', 'Ano Toys 4.4 mega sale poster'],
                ['apparel-haddie', 'Apparel promo with two models in streetwear'],
                ['apparel-one-of-us', 'Apparel graphic: Be one of us'],
                ['comeback-kings', 'Comeback Kings esports poster'],
                ['gaia-garden', 'Gaia Garden school event poster with vegetables'],
                ['last-crows', 'Last Crows story-format poster'],
                ['social-keyboards', 'Social media grid for gaming keyboards and headsets'],
                ['social-audio', 'Social media grid for audio gear'],
                ['social-glowup', 'Social media grid for a skincare glow-up challenge']
            ].map(function (g) { return img(IMG + 'gallery/' + g[0] + '.webp', g[1], g[1], IMG + 'gallery/' + g[0] + '-sm.webp'); })
        },
        video: {
            title: 'video-edits.cart',
            label: 'Video edits',
            items: [
                vid('edit-reel', 'Short-form edit with motion graphics and captions.'),
                vid('edit-reel-2', 'Short-form edit, illustrated explainer style.'),
                vid('animated', 'Animated short with a cartoon character.'),
                vid('mshati-ad', 'Talking-head ad edit.'),
                vid('sample-2025', 'Before and after edit sample, 2025.'),
                vid('minecraft-longform', 'Long-form YouTube edit: 23 Minecraft 1.20 build hacks.')
            ]
        },
        ads: {
            title: 'ads.cart',
            label: 'Social media ads',
            items: [
                vid('brighteyes-1', 'BrightEyes+ video ad, version 1.'),
                vid('brighteyes-2', 'BrightEyes+ video ad, version 2.'),
                vid('brighteyes-3', 'BrightEyes+ video ad, version 3.'),
                vid('brighteyes-4', 'BrightEyes+ video ad, version 4.'),
                vid('ads-reel', 'Pet care video ad.'),
                vid('ads-reel-2', 'Pet food video ad.')
            ]
        },
        web: {
            title: 'web-builds.cart',
            label: 'Web builds',
            link: { href: 'https://drive.google.com/drive/folders/1UVKbv_6SSz9y1sMvlrBEamdFpCxJaiSG', label: 'Full folder' },
            items: [
                vid('web-reel', 'Web build reel.'),
                img(IMG + 'gallery/8box-1.webp', '8Box Solutions website, sign-in and dashboard screens', '8Box Solutions website.', IMG + 'gallery/8box-1-sm.webp'),
                img(IMG + 'gallery/8box-2.webp', '8Box Solutions website, product and service pages', '8Box Solutions website.', IMG + 'gallery/8box-2-sm.webp'),
                img(IMG + 'gallery/8box-3.webp', '8Box Solutions website, booking screens', '8Box Solutions website.', IMG + 'gallery/8box-3-sm.webp')
            ]
        },
        certs: {
            title: 'achievements',
            label: 'Certificates',
            items: [
                img(IMG + 'certs/aws-cloud-foundations.webp', 'AWS Academy Graduate, Cloud Foundations training badge certificate for Mark Nikko Lonzaga, 20 hours, issued May 27, 2026', 'AWS Academy Graduate: Cloud Foundations. May 27, 2026.'),
                img(IMG + 'certs/cyber-junior-analyst.webp', 'Cisco Networking Academy certificate for Mark Nikko Lonzaga, completed Feb 26, 2026', 'Junior Cybersecurity Analyst Career Path, Cisco Networking Academy. Feb 26, 2026.'),
                img(IMG + 'certs/ccna-ensa.webp', 'Cisco certificate: CCNA Enterprise Networking, Security, and Automation, completed Jul 21, 2025', 'CCNA: Enterprise Networking, Security, and Automation. Jul 21, 2025.'),
                img(IMG + 'certs/ccna-srwe.webp', 'Cisco certificate: CCNA Switching, Routing, and Wireless Essentials, completed Jul 21, 2025', 'CCNA: Switching, Routing, and Wireless Essentials. Jul 21, 2025.'),
                img(IMG + 'certs/ccna-itn.webp', 'Cisco certificate: CCNA Introduction to Networks, completed Feb 5, 2025', 'CCNA: Introduction to Networks. Feb 5, 2025.'),
                img(IMG + 'certs/nexus-winserver.webp', 'Nexus Cloud IT Solutions certificate of achievement: Windows Server 2019 System Administration and Automation, Aug 3, 2024', 'Windows Server 2019: System Administration and Automation, Nexus Cloud IT Solutions. Aug 3, 2024.')
            ],
            link: { href: 'https://www.credly.com/go/bT1y6PFj', label: 'Verify AWS badge' }
        }
    };

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
            var el;
            if (item.type === 'video') {
                el = document.createElement('video');
                el.src = item.src;
                el.poster = item.poster;
                el.controls = true;
                el.playsInline = true;
                el.preload = 'metadata';
                el.setAttribute('aria-label', item.caption);
            } else {
                el = document.createElement('img');
                el.src = item.src;
                el.alt = item.alt;
                el.decoding = 'async';
            }
            vMedia.appendChild(el);
            vCaption.textContent = item.caption;
            vCount.textContent = (pos + 1) + ' / ' + current.items.length;
            if (vStatus) vStatus.textContent = (item.type === 'video' ? 'Video ' : 'Image ') + (pos + 1) + ' of ' + current.items.length + ': ' + item.caption;
            $$('.viewer-thumb', vThumbs).forEach(function (t, i) {
                if (i === pos) {
                    t.setAttribute('aria-current', 'true');
                    t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                } else {
                    t.removeAttribute('aria-current');
                }
            });
            // warm the next image
            var next = current.items[(pos + 1) % current.items.length];
            if (next.type === 'image') { var pre = new Image(); pre.src = next.src; }
        };

        var step = function (d) {
            pos = (pos + d + current.items.length) % current.items.length;
            render();
            sfx.play('select');
        };

        var open = function (key, index, trigger) {
            current = GALLERIES[key];
            if (!current) return;
            pos = Math.max(0, Math.min(index || 0, current.items.length - 1));
            opener = trigger || null;
            vTitle.textContent = current.title;
            viewer.setAttribute('aria-label', current.label || current.title);
            vThumbs.textContent = '';
            current.items.forEach(function (item, i) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'viewer-thumb' + (item.type === 'video' ? ' viewer-play' : '');
                b.setAttribute('aria-label', 'Show item ' + (i + 1) + ': ' + item.caption);
                var t = document.createElement('img');
                t.src = item.thumb;
                t.alt = '';
                t.loading = 'lazy';
                b.appendChild(t);
                b.addEventListener('click', function () { pos = i; render(); });
                vThumbs.appendChild(b);
            });
            if (current.link) {
                vLink.hidden = false;
                vLink.href = current.link.href;
                vLinkLabel.textContent = current.link.label;
            } else {
                vLink.hidden = true;
            }
            viewer.showModal();
            document.body.style.overflow = 'hidden';
            render();
            $('[data-close]', viewer).focus();
        };

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
            if (e.target.tagName === 'VIDEO') return;
            if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        });
        // swipe on touch screens (not while scrubbing a video or pinching)
        var touchX = null;
        var touchY = null;
        vMedia.addEventListener('touchstart', function (e) {
            if (e.target.tagName === 'VIDEO' || e.touches.length > 1) { touchX = null; return; }
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
       11. Copy email
       --------------------------------------------------------------- */
    $$('[data-copy]').forEach(function (b) {
        b.addEventListener('click', function () {
            var text = b.getAttribute('data-copy');
            var done = function () { toast('Email copied'); sfx.play('coin'); };
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
                if (ok) done(); else toast('Copy failed: ' + text, 5000);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, legacy);
            } else {
                legacy();
            }
        });
    });

    /* ---------------------------------------------------------------
       12. CONTINUE? countdown (decorative, runs only while visible)
       --------------------------------------------------------------- */
    var countdown = $('#countdown');
    if (countdown && 'IntersectionObserver' in window) {
        var n = 9;
        var cdTimer = null;
        var cdVisible = false;
        var cdRun = function () {
            clearInterval(cdTimer);
            if (!cdVisible || motion.still) return;
            cdTimer = setInterval(function () {
                n = n <= 0 ? 9 : n - 1;
                countdown.textContent = String(n);
            }, 1000);
        };
        new IntersectionObserver(function (entries) {
            cdVisible = entries[0].isIntersecting;
            cdRun();
        }).observe(countdown);
        motion.on(cdRun);
    }

    /* ---------------------------------------------------------------
       13. Cheat code: up up down down left right left right B A
       --------------------------------------------------------------- */
    var code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    var at = 0;
    document.addEventListener('keydown', function (e) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || !e.key) return;
        if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
        var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === code[at]) at += 1;
        else if (key === 'ArrowUp') at = (at === 2 && code[1] === 'ArrowUp') ? 2 : 1;
        else at = 0;
        if (at < code.length) return;
        at = 0;
        toast('Cheat on: +30 lives');
        sfx.play('coin');
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
