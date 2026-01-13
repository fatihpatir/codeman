const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- RETINA / DPR SETUP ---
const dpr = window.devicePixelRatio || 1;
function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);
    groundY = height * 0.88;

    const warning = document.getElementById('orientation-warning');
    if (height > width) {
        if (warning) warning.classList.remove('hidden');
        if (!isPaused && !isGameOver) { isPaused = true; pausedByOrientation = true; }
    } else {
        if (warning) warning.classList.add('hidden');
        if (isPaused && pausedByOrientation && !isGameOver) {
            isPaused = false; pausedByOrientation = false;
            lastTimestamp = 0; requestAnimationFrame(gameLoop);
        }
    }
}
window.addEventListener('resize', resize);

// --- POLYFILLS ---
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radius) {
        if (typeof radius === 'undefined') radius = 0;
        if (typeof radius === 'number') radius = { tl: radius, tr: radius, br: radius, bl: radius };
        else radius = { ...{ tl: 0, tr: 0, br: 0, bl: 0 }, ...radius };
        this.moveTo(x + radius.tl, y);
        this.lineTo(x + w - radius.tr, y);
        this.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
        this.lineTo(x + w, y + h - radius.br);
        this.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
        this.lineTo(x + radius.bl, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
        this.lineTo(x, y + radius.tl);
        this.quadraticCurveTo(x, y, x + radius.tl, y);
        return this;
    };
}

// --- GLOBALS ---
var scoreElement, bitsElement, rankBadge, livesContainer;
var overlay, finalScoreElement, restartBtn;
var joystickBase, joystickStick, shootBtn, jumpBtn;
var infoBtn, pauseBtn, settingsBtn, infoModal, customModal;
var player;

const GRAVITY = 0.45;
const FRICTION = 0.82;
const JUMP_FORCE = -11.5;
const ACCELERATION = 0.6;
const MAX_SPEED = 5.5;
const TARGET_FPS = 60;
const TIME_STEP = 1000 / TARGET_FPS;

const THEME = {
    pcb: '#010803',
    glowCyan: '#00f7ff',
    glowGreen: '#2ea043',
    virusRed: '#f85149',
    accentBlue: '#58a6ff'
};

let groundY = window.innerHeight * 0.88;
let isGameOver = false;
let isPaused = false;
let pausedByOrientation = false;
let cameraX = 0;
let distanceTraveled = 0;
let platforms = [];
let enemies = [];
let collectibles = [];
let projectiles = [];
let animationId;
let lastTimestamp = 0;
let lastGenX = 0;

const RANKS = [
    { score: 0, title: 'STAJYER', color: '#8b949e' },
    { score: 500, title: 'JR. DEV', color: '#2ea043' },
    { score: 1500, title: 'MID DEV', color: '#58a6ff' },
    { score: 3000, title: 'SENIOR', color: '#a371f7' },
    { score: 6000, title: 'TECH LEAD', color: '#ff7b72' },
    { score: 10000, title: 'CODEMAN', color: '#f2cc60' }
];

let joystickActive = false;
let joystickX = 0, joystickY = 0;
let joystickCenter = { x: 0, y: 0 };
const keys = {};

// Background
const bgImg = new Image();
bgImg.src = 'motherboard_bg.png';
let bgLoaded = false;
bgImg.onload = () => { bgLoaded = true; };

function drawParallaxBackground() {
    if (!bgLoaded) {
        ctx.fillStyle = THEME.pcb;
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        return;
    }
    const aspect = bgImg.width / bgImg.height;
    let drawHeight = canvas.height / dpr;
    let drawWidth = drawHeight * aspect;
    const moveX = (cameraX * 0.15); // Better depth
    ctx.save();
    let xOffset = -(moveX % drawWidth);
    for (let i = -1; i < Math.ceil((canvas.width / dpr) / drawWidth) + 2; i++) {
        ctx.drawImage(bgImg, xOffset + (i * drawWidth), 0, drawWidth, drawHeight);
    }
    ctx.restore();
}

// --- CLASSES ---
class Player {
    constructor() { this.reset(); }
    reset() {
        this.w = 34; this.h = 50;
        this.x = 200; this.y = groundY - this.h - 100;
        this.vx = 0; this.vy = 0;
        this.onGround = false; this.doubleJumpAvailable = true;
        this.lives = 3; this.invul = 0; this.facing = 1; this.color = THEME.glowCyan;
        this.ducking = false; this.lookingUp = false;
    }
    hit() {
        if (this.invul > 0 || isGameOver) return;
        this.lives--; playSound('hit');
        if (this.lives <= 0) gameOver();
        else this.invul = 90;
        updateUI();
    }
    draw() {
        ctx.save(); ctx.translate(this.x - cameraX, this.y);
        if (this.invul > 0 && Math.floor(Date.now() / 100) % 2 === 0) ctx.globalAlpha = 0.5;

        let sy = 1, oy = 0;
        if (this.ducking) { sy = 0.65; oy = 17; }
        else if (this.lookingUp) { sy = 1.1; oy = -5; }

        if (this.facing === -1) { ctx.scale(-1, 1); ctx.translate(-this.w, 0); }

        ctx.save(); ctx.translate(0, oy); ctx.scale(1, sy);
        // Body (3D Glassy)
        const grad = ctx.createLinearGradient(0, 0, this.w, 0);
        grad.addColorStop(0, '#161b22'); grad.addColorStop(0.5, '#2d333b'); grad.addColorStop(1, '#0d1117');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(5, 18, 24, 18, 4); ctx.fill();

        // Glow Core
        ctx.shadowBlur = 10; ctx.shadowColor = this.color;
        ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(17, 27, 4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Monitor Head
        ctx.fillStyle = '#444c56'; ctx.beginPath(); ctx.roundRect(2, 0, 30, 26, 6); ctx.fill();
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(5, 3, 24, 20, 3); ctx.fill();
        ctx.fillStyle = this.color; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
        let expr = (Math.abs(this.vx) > 0.5) ? '>.<' : '^_^';
        if (!this.onGround) expr = '^o^';
        if (this.ducking) expr = 'U_U';
        ctx.fillText(expr, 17, 17);
        ctx.restore(); ctx.restore();
    }
    update(dt) {
        if (this.invul > 0) this.invul--;
        let mx = keys['ArrowRight'] || keys['d'] ? 1 : (keys['ArrowLeft'] || keys['a'] ? -1 : (joystickActive ? joystickX : 0));
        let my = keys['ArrowDown'] || keys['s'] ? 1 : (keys['ArrowUp'] || keys['w'] ? -1 : (joystickActive ? joystickY : 0));

        this.ducking = my > 0.5;
        this.lookingUp = my < -0.5;

        if (Math.abs(mx) > 0.1) {
            this.vx += mx * ACCELERATION * dt;
            if (Math.abs(this.vx) > MAX_SPEED) this.vx = Math.sign(this.vx) * MAX_SPEED;
            this.facing = mx > 0 ? 1 : -1;
        } else {
            this.vx *= Math.pow(FRICTION, dt);
            if (Math.abs(this.vx) < 0.1) this.vx = 0;
        }

        this.vy += GRAVITY * dt; this.x += this.vx * dt; this.y += this.vy * dt;

        if (this.y + this.h >= groundY) { this.y = groundY - this.h; this.vy = 0; this.onGround = true; this.doubleJumpAvailable = true; }

        platforms.forEach(p => {
            if (this.x < p.x + p.w && this.x + this.w > p.x && this.y + this.h > p.y && this.y + this.h < p.y + p.h + this.vy) {
                if (this.vy > 0) { this.vy = 0; this.y = p.y - this.h; this.onGround = true; this.doubleJumpAvailable = true; }
            }
        });

        cameraX = Math.max(cameraX, this.x - (canvas.width / dpr) * 0.3);
        distanceTraveled = Math.max(distanceTraveled, Math.floor(this.x / 10));
    }
    jump() {
        if (this.onGround) { this.vy = JUMP_FORCE; this.onGround = false; playSound('jump'); }
        else if (this.doubleJumpAvailable) { this.vy = JUMP_FORCE * 0.88; this.doubleJumpAvailable = false; playSound('jump'); }
    }
    shoot() {
        projectiles.push({ x: this.x + (this.facing === 1 ? this.w : 0), y: this.y + (this.ducking ? 35 : 25), vx: this.facing * 15, life: 60, color: this.color });
        playSound('shoot');
    }
}

class Platform {
    constructor(x, y, w, h, type) { this.x = x; this.y = y; this.w = w; this.h = h; this.type = type; }
    draw() {
        if (this.x + this.w < cameraX || this.x > cameraX + canvas.width / dpr) return;
        ctx.fillStyle = (this.type === 'ram') ? '#2ea043' : '#d7ccc8';
        ctx.beginPath(); ctx.roundRect(this.x - cameraX, this.y, this.w, this.h, 4); ctx.fill();
        // Trace line effect
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.strokeRect(this.x - cameraX + 2, this.y + 2, this.w - 4, this.h - 4);
    }
}

class Enemy {
    constructor(x, y, type) { this.x = x; this.y = y; this.type = type; this.w = 34; this.h = 34; this.vx = -3.5 - Math.random() * 2.5; }
    update(dt) { this.x += this.vx * dt; }
    draw() {
        if (this.x + this.w < cameraX || this.x > cameraX + canvas.width / dpr) return;
        ctx.fillStyle = THEME.virusRed; ctx.shadowBlur = 10; ctx.shadowColor = THEME.virusRed;
        ctx.beginPath(); ctx.roundRect(this.x - cameraX, this.y, this.w, this.h, 6); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillText('VİRÜS', this.x - cameraX + 17, this.y + 22);
    }
}

class Collectible {
    constructor(x, y, val) { this.x = x; this.y = y; this.val = val; }
    draw() {
        if (this.x < cameraX || this.x > cameraX + canvas.width / dpr) return;
        ctx.fillStyle = '#fff'; ctx.shadowBlur = 5; ctx.shadowColor = '#fff';
        ctx.font = 'bold 18px monospace'; ctx.fillText(this.val, this.x - cameraX, this.y + Math.sin(Date.now() / 250) * 6);
        ctx.shadowBlur = 0;
    }
}

// --- LEVEL GENERATION ---
function generateChunk(x) {
    // Endless continuous Ground
    platforms.push(new Platform(x, groundY, 1500, 100, 'ram'));

    // Multiple platform layers
    for (let i = 0; i < 4; i++) {
        let px = x + Math.random() * 1200;
        let py = groundY - 140 - Math.random() * 180;
        platforms.push(new Platform(px, py, 160, 22, 'pcb'));
        if (Math.random() > 0.4) collectibles.push(new Collectible(px + 70, py - 45, Math.random() > 0.5 ? '1' : '0'));
        // Add enemy on platform occasionally
        if (Math.random() > 0.7) enemies.push(new Enemy(px + 100, py - 34, 'scout'));
    }

    // Ground Enemies
    for (let i = 0; i < 2; i++) {
        enemies.push(new Enemy(x + 1000 + Math.random() * 400, groundY - 34, 'crawler'));
    }
}

function initLevel() {
    platforms = []; enemies = []; collectibles = []; projectiles = [];
    lastGenX = 0;
    generateChunk(0);
    generateChunk(1500);
}

// --- MAIN LOOP ---
function gameLoop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const dt = Math.min((timestamp - lastTimestamp) / TIME_STEP, 3);
    lastTimestamp = timestamp;

    if (!isPaused && !isGameOver) {
        player.update(dt);

        // Update enemies & collision
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            e.update(dt);
            if (e.x + e.w < cameraX - 200) { enemies.splice(i, 1); continue; }
            if (player.x < e.x + e.w && player.x + player.w > e.x && player.y < e.y + e.h && player.y + player.h > e.y) {
                player.hit();
            }
        }

        // Update projectiles & projectile hits
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.x += p.vx * dt; p.life -= dt;
            let hit = false;
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                if (p.x < e.x + e.w && p.x + 10 > e.x && p.y < e.y + e.h && p.y + 4 > e.y) {
                    enemies.splice(j, 1);
                    projectiles.splice(i, 1);
                    playSound('kill');
                    hit = true; break;
                }
            }
            if (!hit && p.life <= 0) projectiles.splice(i, 1);
        }

        // Endless generation check
        if (cameraX + (canvas.width / dpr) > lastGenX) {
            lastGenX += 1500;
            generateChunk(lastGenX);
        }
    }

    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    drawParallaxBackground();
    platforms.forEach(p => p.draw());
    enemies.forEach(e => e.draw());
    collectibles.forEach(c => c.draw());
    projectiles.forEach(p => { ctx.fillStyle = p.color; ctx.fillRect(p.x - cameraX, p.y, 10, 4); });
    player.draw();
    updateUI();
    animationId = requestAnimationFrame(gameLoop);
}

// --- UI & CONTROLS ---
function updateUI() {
    if (scoreElement) scoreElement.innerText = distanceTraveled;
    if (livesContainer) livesContainer.innerText = '❤️'.repeat(Math.max(0, player.lives));
    const rank = RANKS.findLast(r => distanceTraveled >= r.score) || RANKS[0];
    if (rankBadge) { rankBadge.innerText = rank.title; rankBadge.style.color = rank.color; }
}

function gameOver() {
    isGameOver = true; cancelAnimationFrame(animationId);
    if (overlay) overlay.classList.remove('hidden');
    if (finalScoreElement) finalScoreElement.innerText = distanceTraveled;
}

function initDOMElements() {
    scoreElement = document.getElementById('score');
    rankBadge = document.getElementById('rank-badge');
    livesContainer = document.getElementById('lives-container');
    overlay = document.getElementById('overlay');
    finalScoreElement = document.getElementById('final-score');
    restartBtn = document.getElementById('btn-restart');
    joystickBase = document.getElementById('joystick-base');
    joystickStick = document.getElementById('joystick-stick');
    shootBtn = document.getElementById('btn-shoot');
    jumpBtn = document.getElementById('btn-jump');
    infoBtn = document.getElementById('btn-info');
    pauseBtn = document.getElementById('btn-pause');
    settingsBtn = document.getElementById('btn-settings-fixed');
    infoModal = document.getElementById('info-modal');
    customModal = document.getElementById('customizer');

    // Wired Events (Using both click and touchend for maximum reliability)
    const handleRestart = () => location.reload();
    if (restartBtn) { restartBtn.onclick = handleRestart; restartBtn.ontouchend = handleRestart; }

    const togglePause = (e) => {
        if (e) e.stopPropagation();
        isPaused = !isPaused;
        pauseBtn.innerText = isPaused ? '▶' : '⏸';
        if (!isPaused) { lastTimestamp = 0; requestAnimationFrame(gameLoop); }
    };
    if (pauseBtn) { pauseBtn.onclick = togglePause; pauseBtn.ontouchend = togglePause; }

    if (infoBtn) {
        infoBtn.onclick = () => { isPaused = true; infoModal.classList.remove('hidden'); };
        infoBtn.ontouchend = () => { isPaused = true; infoModal.classList.remove('hidden'); };
    }
    if (settingsBtn) {
        settingsBtn.onclick = () => { isPaused = true; customModal.classList.remove('hidden'); };
        settingsBtn.ontouchend = () => { isPaused = true; customModal.classList.remove('hidden'); };
    }

    document.getElementById('btn-close-info').onclick = () => { infoModal.classList.add('hidden'); isPaused = false; lastTimestamp = 0; requestAnimationFrame(gameLoop); };
    document.getElementById('btn-close-custom').onclick = () => { customModal.classList.add('hidden'); isPaused = false; lastTimestamp = 0; requestAnimationFrame(gameLoop); };
}

function startGame() {
    initDOMElements(); resize(); player = new Player(); initLevel();
    lastTimestamp = 0; requestAnimationFrame(gameLoop);
}

// TOUCH IO
const startIO = (e) => {
    initAudio();
    if (!joystickBase) initDOMElements();
    if (!joystickBase) return;

    // Do NOT swallow touches on buttons
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

    const t = e.touches ? e.touches[0] : e;
    const rect = joystickBase.getBoundingClientRect();

    // Check if within joystick base
    const dx = t.clientX - (rect.left + rect.width / 2);
    const dy = t.clientY - (rect.top + rect.height / 2);
    if (Math.sqrt(dx * dx + dy * dy) < rect.width * 1.5) {
        joystickActive = true;
        joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        updateIO(e);
        if (e.cancelable) e.preventDefault();
    }

    // Explicit jump/shoot check if not handled by click/touchend
    if (e.target === jumpBtn || jumpBtn.contains(e.target)) { player.jump(); if (e.cancelable) e.preventDefault(); }
    if (e.target === shootBtn || shootBtn.contains(e.target)) { player.shoot(); if (e.cancelable) e.preventDefault(); }
};

const updateIO = (e) => {
    if (!joystickActive) return;
    const t = e.touches ? e.touches[0] : e;
    let dx = t.clientX - joystickCenter.x, dy = t.clientY - joystickCenter.y;
    const max = 50; const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > max) { dx *= max / dist; dy *= max / dist; }
    joystickX = dx / max; joystickY = dy / max;
    if (joystickStick) joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (e.cancelable) e.preventDefault();
};

const stopIO = () => { joystickActive = false; joystickX = 0; joystickY = 0; if (joystickStick) joystickStick.style.transform = `translate(-50%,-50%)`; };

window.addEventListener('touchstart', startIO, { passive: false });
window.addEventListener('touchmove', updateIO, { passive: false });
window.addEventListener('touchend', stopIO);

window.addEventListener('mousedown', startIO);
window.addEventListener('mousemove', updateIO);
window.addEventListener('mouseup', stopIO);

window.addEventListener('keydown', e => { keys[e.key] = true; if (e.key === ' ') player.jump(); if (e.key === 'f') player.shoot(); });
window.addEventListener('keyup', e => { keys[e.key] = false; });

function playSound(t) { }
function initAudio() { }

window.onload = startGame;
