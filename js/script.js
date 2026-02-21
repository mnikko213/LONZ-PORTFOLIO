// --- 1. SCROLL ANIMATION ---
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
        } else {
            entry.target.classList.remove('active');
        }
    });
}, { threshold: 0.15 }); 
document.querySelectorAll('.anim-element').forEach((el) => observer.observe(el));

// --- 2. CAROUSEL LOGIC ---
let currentSlide = 0;
const track = document.getElementById('track');
const totalSlides = 2;

function updateCarousel() {
    if (!track) return;
    track.style.transform = `translateX(-${currentSlide * 50}%)`;
    const indicators = document.querySelectorAll('.indicator');
    indicators.forEach((dot, index) => {
        if (index === currentSlide) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}

window.moveSlide = function(direction) {
    currentSlide += direction;
    if (currentSlide < 0) currentSlide = 0;
    if (currentSlide >= totalSlides) currentSlide = totalSlides - 1;
    updateCarousel();
};

window.goToSlide = function(index) {
    currentSlide = index;
    updateCarousel();
};

// --- 3. 3D PROXIMITY FLIP (SKILLS) ---
const letters = document.querySelectorAll('.letter-box');
const skillsSlide = document.querySelector('.slide-skills');

if (skillsSlide) {
    skillsSlide.addEventListener('mousemove', (e) => {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        letters.forEach(letter => {
            const rect = letter.getBoundingClientRect();
            const dist = Math.hypot(mouseX - (rect.left + rect.width/2), mouseY - (rect.top + rect.height/2));
            const maxDist = 300; 
            let angle = 0;
            if (dist < maxDist) {
                const progress = 1 - (dist / maxDist); 
                angle = progress * 180;
            }
            letter.style.transform = `rotateY(${angle}deg)`;
        });
    });

    skillsSlide.addEventListener('mouseleave', () => {
        letters.forEach(letter => {
            letter.style.transform = `rotateY(0deg)`;
        });
    });
}

// --- 4. MASH TEXT (ABOUT) ---
const aboutTitle = document.getElementById('about-text-target');
if (aboutTitle) {
    function wrapTextInSpans(element) {
        const originalContent = element.innerHTML;
        const parts = originalContent.split('<br>');
        const wrappedParts = parts.map(part => {
            return part.trim().split('').map(char => {
                if (char === ' ') return '&nbsp;';
                return `<span class="mash-letter">${char}</span>`;
            }).join('');
        });
        element.innerHTML = wrappedParts.join('<br>');
    }
    wrapTextInSpans(aboutTitle);
    
    const mashLetters = document.querySelectorAll('.mash-letter');
    aboutTitle.addEventListener('mousemove', (e) => {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        mashLetters.forEach(letter => {
            const rect = letter.getBoundingClientRect();
            const dist = Math.hypot(mouseX - (rect.left + rect.width/2), mouseY - (rect.top + rect.height/2));
            if (dist < 150) {
                const str = 1 - (dist / 150);
                letter.style.transform = `translate(${(mouseX - (rect.left + rect.width/2)) * 0.4 * str}px, ${(mouseY - (rect.top + rect.height/2)) * 0.4 * str}px) scale(${1 + str * 0.2})`;
                letter.style.fontWeight = '700'; 
            } else {
                letter.style.transform = 'translate(0,0) scale(1)';
                letter.style.fontWeight = '400';
            }
        });
    });
    
    aboutTitle.addEventListener('mouseleave', () => {
        mashLetters.forEach(l => { 
            l.style.transform = 'translate(0,0) scale(1)'; 
            l.style.fontWeight = '400'; 
        });
    });
}

// --- 5. CONTINUOUS SCROLLING VIDEO MARQUEE ---
const marqueeTrack = document.getElementById('marquee-track');
const marqueeWrapper = document.getElementById('marquee-wrapper');

if (marqueeTrack && marqueeWrapper) {
    marqueeTrack.innerHTML += marqueeTrack.innerHTML; 
    
    let marqueeX = 0;
    let baseSpeed = 90; 
    let scrollBoost = 0;
    let isPaused = false;
    
    marqueeTrack.addEventListener('mouseenter', () => { isPaused = true; });
    marqueeTrack.addEventListener('mouseleave', () => { isPaused = false; });

    let lastTime = 0;
    
    function animateMarquee(currentTime) {
        if (!lastTime) lastTime = currentTime;
        let deltaTime = (currentTime - lastTime) / 1000; 
        lastTime = currentTime;

        if (deltaTime > 0.1) deltaTime = 0.016; 

        scrollBoost *= Math.pow(0.001, deltaTime); 
        if (Math.abs(scrollBoost) < 1) scrollBoost = 0;

        let currentSpeed = scrollBoost;
        if (!isPaused) currentSpeed += baseSpeed;

        marqueeX -= (currentSpeed * deltaTime);
        
        const halfWidth = marqueeTrack.scrollWidth / 2;
        if (marqueeX <= -halfWidth) { marqueeX += halfWidth; } 
        else if (marqueeX > 0) { marqueeX -= halfWidth; }

        marqueeTrack.style.transform = `translateX(${marqueeX}px)`;
        requestAnimationFrame(animateMarquee);
    }
    
    requestAnimationFrame(animateMarquee);

    marqueeWrapper.addEventListener('wheel', (e) => {
        e.preventDefault(); 
        let primaryDelta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        let scrollDirection = Math.sign(primaryDelta);
        let scrollAmount = Math.min(Math.abs(primaryDelta), 20); 
        
        scrollBoost += (scrollDirection * scrollAmount * 40); 
        if (scrollBoost > 2000) scrollBoost = 2000;
        if (scrollBoost < -2000) scrollBoost = -2000;
    }, { passive: false });
}

// --- 6. EDITORIAL MODAL & LIGHTBOX LOGIC ---
const projectData = {
    "GRAPHICS": {
        driveLink: "https://drive.google.com/drive/folders/1bbLJtDv6jUpr_zYZG6JoOniDPYJIz0H6",
        files: [
            { 
                name: "BRANDING", 
                type: "APPAREL",
                media: [
                    { type: 'image', src: 'projects/Graphic Design/GP_s/1.png' },
                    { type: 'image', src: 'projects/Graphic Design/PONG SOLES/G-6.png' },
                    { type: 'image', src: 'projects/Graphic Design/GP_s/17.png' },
                    { type: 'image', src: 'projects/Graphic Design/PONG SOLES/G-7.png' }
                ]
            }
        ]
    },
    "VIDEO EDIT": {
        driveLink: "https://drive.google.com/drive/folders/1w-Wmo4a5DCPigBNBWmhoBQ1ErB0k4eBz",
        files: [
            { 
                name: "YOUTUBE VIDEOS", 
                type: "YOUTUBE",
                media: [
                    { type: 'video', src: 'projects/Video Editing/ANIMATED/1122(1).mp4' },
                    { type: 'video', src: 'projects/Video Editing/Long-form/Copy of 23 Minecraft 1.20 Build Hacks that Change EVERYTHING.mp4' }, 
                    { type: 'video', src: 'projects/Video Editing/BEST VIDEOS/MSHATI AD 2.mp4' },
                    { type: 'video', src: 'projects/Video Editing/BEST VIDEOS/SAMPLE 1 (2025).mp4' }  
                ]
            }
        ]
    },
    "ADS": {
        driveLink: "https://drive.google.com/drive/folders/1wjqWh4Dh1rD4mtH2ezxQghY8q4Tfizv1",
        files: [
            { 
                name: "Social Media", 
                type: "DIGITAL",
                media: [
                    { type: 'video', src: 'projects/FB Ads/VIZOYA ADS/BrightEyes+ 1-1.mp4' },
                    { type: 'video', src: 'projects/FB Ads/VIZOYA ADS/BrightEyes+ 1-2.mp4' },
                    { type: 'video', src: 'projects/FB Ads/VIZOYA ADS/BrightEyes+ 1-3.mp4' },
                    { type: 'video', src: 'projects/FB Ads/VIZOYA ADS/BrightEyes+ 2-1.mp4' }
                ]
            }
        ]
    },
    "WEB DEV": {
        driveLink: "https://drive.google.com/drive/folders/1UVKbv_6SSz9y1sMvlrBEamdFpCxJaiSG",
        files: [
            { 
                name: "ARCHITECTURE", 
                type: "WEB DESIGN",
                media: [
                    { type: 'video', src: 'pictures/WEBS.mp4' }, 
                    { type: 'image', src: 'projects/Web Dev/8BOX/8Box Solutions Inc. (1).png' }, 
                    { type: 'image', src: 'projects/Web Dev/8BOX/8Box Solutions Inc. (2).png' }, 
                    { type: 'image', src: 'projects/Web Dev/8BOX/8Box Solutions Inc. (3).png' }  
                ]
            }
        ]
    }
};

const modal = document.getElementById('drive-modal');
const driveGrid = document.getElementById('drive-grid');
const driveLinkBtn = document.getElementById('drive-link-btn');

const lightbox = document.getElementById('lightbox-modal');
const lightboxContent = document.getElementById('lightbox-content');

document.querySelectorAll('.vid-item').forEach(item => {
    item.addEventListener('click', () => {
        modal.classList.add('active');
        driveGrid.innerHTML = ''; 

        const category = item.querySelector('.vid-title').innerText.trim();
        const data = projectData[category];
        
        document.getElementById('modal-title-left').innerText = category + ":";
        
        if (data && data.files.length > 0) {
            document.getElementById('modal-title-center').innerText = data.files[0].name;
            driveLinkBtn.href = data.driveLink;
            
            const mediaToDisplay = data.files[0].media;
            
            mediaToDisplay.forEach(m => {
                let mediaElement;
                if (m.type === 'video') {
                    mediaElement = document.createElement('video');
                    mediaElement.src = m.src;
                    mediaElement.muted = true; 
                    mediaElement.preload = "metadata"; // Loads first frame
                } else {
                    mediaElement = document.createElement('img');
                    mediaElement.src = m.src;
                }
                mediaElement.classList.add('minimal-media-item');
                
                // Add click event to open lightbox
                mediaElement.addEventListener('click', () => openLightbox(m));

                driveGrid.appendChild(mediaElement);
            });
        }
    });
});

window.closeModal = function() {
    modal.classList.remove('active');
    closeLightbox(); 
};

modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

// --- LIGHTBOX FUNCTIONS ---
function openLightbox(mediaData) {
    lightbox.classList.add('active');
    lightboxContent.innerHTML = ''; 

    let largeMedia;
    if (mediaData.type === 'video') {
        largeMedia = document.createElement('video');
        largeMedia.src = mediaData.src;
        largeMedia.controls = true; 
        largeMedia.autoplay = true; 
    } else {
        largeMedia = document.createElement('img');
        largeMedia.src = mediaData.src;
    }
    
    lightboxContent.appendChild(largeMedia);
}

window.closeLightbox = function() {
    lightbox.classList.remove('active');
    lightboxContent.innerHTML = ''; 
};

lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxContent) closeLightbox();
});

// --- 7. CERTIFICATIONS HOVER LOGIC ---
const certItems = document.querySelectorAll('.cert-item');
const hoverImgContainer = document.getElementById('hover-img-container');
const hoverImg = document.getElementById('hover-img');

certItems.forEach(item => {
    item.addEventListener('mouseenter', () => {
        if (window.innerWidth > 900) {
            const imgSrc = item.getAttribute('data-img');
            if(imgSrc) {
                hoverImg.src = imgSrc;
                hoverImgContainer.classList.add('active');
            }
        }
    });

    item.addEventListener('mouseleave', () => {
        hoverImgContainer.classList.remove('active');
    });

    item.addEventListener('mousemove', (e) => {
        if (window.innerWidth > 900) {
            requestAnimationFrame(() => {
                hoverImgContainer.style.left = e.clientX + 'px';
                hoverImgContainer.style.top = e.clientY + 'px';
            });
        }
    });

    item.addEventListener('click', () => {
        const imgSrc = item.getAttribute('data-img');
        if(imgSrc) {
            openLightbox({ type: 'image', src: imgSrc });
        }
    });
});

// --- 8. SERVICES SECTION LOGIC (CLEAN BLUE) ---
const servicesData = [
    {
        title: "Advertisement",
        desc: "Designed high-converting video and image ads for social media campaigns.",
        img: "pictures/R3.png"
    },
    {
        title: "Graphic Design",
        desc: "Created striking visual identities, custom branding, and intricate digital illustrations.",
        img: "pictures/R1.png"
    },
    {
        title: "Web Development",
        desc: "Built responsive, interactive, and modern websites perfectly tailored for user experience.",
        img: "pictures/R4.png"
    },
    {
        title: "Video Editing",
        desc: "Crafted engaging narratives through dynamic and cinematic video edits for various platforms.",
        img: "pictures/R2.png"
    }
];

let currentSrvIndex = 0;
const srvTitle = document.getElementById('srv-title-display');
const srvDesc = document.getElementById('srv-desc-display');
const srvImg = document.getElementById('srv-img-display');
const srvDots = document.querySelectorAll('.srv-dot');

function updateServiceDisplay() {
    if (!srvTitle || !srvDesc || !srvImg) return;
    
    // Fade out elements
    srvImg.classList.add('srv-fade-out');
    srvDesc.classList.add('srv-fade-out-text');
    
    setTimeout(() => {
        const data = servicesData[currentSrvIndex];
        
        srvTitle.innerText = data.title;
        srvDesc.innerText = data.desc;
        srvImg.src = data.img;
        
        // Fade elements back in
        srvImg.classList.remove('srv-fade-out');
        srvDesc.classList.remove('srv-fade-out-text');
    }, 400);

    srvDots.forEach((dot, index) => {
        if (index === currentSrvIndex) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}

window.changeService = function(direction) {
    currentSrvIndex += direction;
    if (currentSrvIndex < 0) currentSrvIndex = servicesData.length - 1;
    if (currentSrvIndex >= servicesData.length) currentSrvIndex = 0;
    updateServiceDisplay();
};

window.goToService = function(index) {
    if (index === currentSrvIndex) return; 
    currentSrvIndex = index;
    updateServiceDisplay();
};

// --- 9. HEADER SCROLL LOGIC ---
const scroller = document.querySelector('.scroller');
const header = document.getElementById('main-header');
let lastScrollY = scroller ? scroller.scrollTop : 0;

if (scroller && header) {
    scroller.addEventListener('scroll', () => {
        const currentScrollY = scroller.scrollTop;
        if (currentScrollY > lastScrollY && currentScrollY > 50) {
            header.classList.add('hidden');
        } else {
            header.classList.remove('hidden');
        }
        lastScrollY = currentScrollY;
    });
}

// --- 10. MOBILE MENU LOGIC ---
const mobileMenu = document.getElementById('mobile-menu');
const navLinks = document.getElementById('nav-links');
const headerLinks = document.querySelectorAll('.header-right a');

if (mobileMenu && navLinks) {
    mobileMenu.addEventListener('click', () => {
        mobileMenu.classList.toggle('is-active');
        navLinks.classList.toggle('active');
    });

    headerLinks.forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.remove('is-active');
            navLinks.classList.remove('active');
        });
    });
}