const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

window.onerror = function (msg, url, line) {
    console.error("DEBUG ERROR: ", msg, " at ", line);
    if (!url.includes('google') && !url.includes('analytics')) {
        alert("SİSTEM HATASI: " + msg + "\nSatır: " + line);
    }
};

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
var infoBtn, pauseBtn, settingsBtn;
var player;
const dpr = window.devicePixelRatio || 1;

// --- CONSTANTS ---
const GRAVITY = 0.45;
const FRICTION = 0.8;
const JUMP_FORCE = -11;
const ACCELERATION = 0.55;
const MAX_SPEED = 5;
const TARGET_FPS = 60;
const TIME_STEP = 1000 / TARGET_FPS;

const THEME = {
    pcb: '#010803',
    glowCyan: '#00f7ff',
    glowGreen: '#2ea043',
    virusRed: '#f85149'
};

let groundY = window.innerHeight * 0.88;
let isGameOver = false;
let isPaused = false;
let pausedByOrientation = false;
let cameraX = 0;
let distanceTraveled = 0;
let bitsCollected = 0;
let platforms = [];
let enemies = [];
let collectibles = [];
let projectiles = [];
let animationId;
let lastTimestamp = 0;
let currentRankIndex = 0;

const RANKS = [
    { score: 0, title: 'STAJYER', color: '#8b949e' },
    { score: 500, title: 'JR. DEV', color: '#2ea043' },
    { score: 1500, title: 'MID DEV', color: '#58a6ff' },
    { score: 3000, title: 'SENIOR', color: '#a371f7' },
    { score: 6000, title: 'TECH LEAD', color: '#ff7b72' },
    { score: 10000, title: 'CODEMAN', color: '#f2cc60' }
];

let joystickActive = false;
let joystickX = 0;
let joystickY = 0;
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
    const moveX = (cameraX * 0.1);
    ctx.save();
    let xOffset = -(moveX % drawWidth);
    for (let i = -1; i < Math.ceil((canvas.width / dpr) / drawWidth) + 1; i++) {
        ctx.drawImage(bgImg, xOffset + (i * drawWidth), 0, drawWidth, drawHeight);
    }
    ctx.restore();
}

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

// Classes
class Player {
    constructor() { this.reset(); }
    reset() {
        this.w = 36; this.h = 54;
        this.x = 200; this.y = groundY - this.h - 100;
        this.vx = 0; this.vy = 0;
        this.onGround = false; this.doubleJumpAvailable = true;
        this.lives = 3; this.invul = 0; this.facing = 1; this.color = THEME.glowCyan;
    }
    hit() {
        if (this.invul > 0 || isGameOver) return;
        this.lives--; playSound('hit');
        if (this.lives <= 0) gameOver();
        else this.invul = 100;
    }
    draw() {
        ctx.save(); ctx.translate(this.x - cameraX, this.y);
        if (this.invul > 0 && Math.floor(Date.now() / 100) % 2 === 0) ctx.globalAlpha = 0.5;
        // Simple but high-res looking character
        ctx.fillStyle = '#161b22'; ctx.roundRect(5, 15, 26, 35, 5); ctx.fill();
        ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(18, 25, 4, 0, Math.PI * 2); ctx.fill();
        // Head
        ctx.fillStyle = '#444c56'; ctx.roundRect(2, 0, 32, 28, 6); ctx.fill();
        ctx.fillStyle = '#000'; ctx.roundRect(5, 3, 26, 22, 4); ctx.fill();
        ctx.fillStyle = this.color; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('^_^', 18, 18);
        ctx.restore();
    }
    update(dt) {
        if (this.invul > 0) this.invul--;
        let mx = keys['ArrowRight'] || keys['d'] ? 1 : (keys['ArrowLeft'] || keys['a'] ? -1 : (joystickActive ? joystickX : 0));
        if (Math.abs(mx) > 0.1) {
            this.vx += mx * ACCELERATION * dt;
            if (Math.abs(this.vx) > MAX_SPEED) this.vx *= 0.95;
            this.facing = mx > 0 ? 1 : -1;
        } else this.vx *= Math.pow(FRICTION, dt);
        this.vy += GRAVITY * dt; this.x += this.vx * dt; this.y += this.vy * dt;
        if (this.y + this.h >= groundY) { this.y = groundY - this.h; this.vy = 0; this.onGround = true; this.doubleJumpAvailable = true; }
        platforms.forEach(p => {
            if (this.x < p.x + p.w && this.x + this.w > p.x && this.y + this.h > p.y && this.y + this.h < p.y + p.h + this.vy) {
                if (this.vy > 0) { this.vy = 0; this.y = p.y - this.h; this.onGround = true; this.doubleJumpAvailable = true; }
            }
        });
        cameraX = Math.max(cameraX, this.x - (canvas.width / dpr) / 4);
        distanceTraveled = Math.max(distanceTraveled, Math.floor(this.x / 10));
    }
    jump() {
        if (this.onGround) { this.vy = JUMP_FORCE; this.onGround = false; playSound('jump'); }
        else if (this.doubleJumpAvailable) { this.vy = JUMP_FORCE * 0.85; this.doubleJumpAvailable = false; playSound('jump'); }
    }
    shoot() {
        projectiles.push({ x: this.x + (this.facing === 1 ? 30 : 0), y: this.y + 25, vx: this.facing * 15, life: 60, color: this.color });
        playSound('shoot');
    }
}

class Platform { constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; } draw() { ctx.fillStyle = '#2ea043'; ctx.fillRect(this.x - cameraX, this.y, this.w, this.h); } }
class Enemy { constructor(x, y) { this.x = x; this.y = y; this.w = 30; this.h = 30; this.vx = -3; } draw() { ctx.fillStyle = '#f85149'; ctx.fillRect(this.x - cameraX, this.y, this.w, this.h); } update(dt) { this.x += this.vx * dt; } }
class Collectible { constructor(x, y, t) { this.x = x; this.y = y; this.t = t; } draw() { ctx.fillStyle = '#fff'; ctx.font = '20px monospace'; ctx.fillText(this.t, this.x - cameraX, this.y); } }

function initLevel() {
    platforms = [new Platform(0, groundY, 3000, 100)];
    enemies = []; collectibles = []; projectiles = [];
    for (let i = 1; i < 20; i++) {
        platforms.push(new Platform(i * 400, groundY - 120 - Math.random() * 100, 150, 20));
        enemies.push(new Enemy(i * 600 + 400, groundY - 30));
        collectibles.push(new Collectible(i * 400 + 50, groundY - 200, Math.random() > 0.5 ? '1' : '0'));
    }
}

function gameLoop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const dt = Math.min((timestamp - lastTimestamp) / TIME_STEP, 3);
    lastTimestamp = timestamp;
    if (!isPaused && !isGameOver) {
        player.update(dt); enemies.forEach(e => e.update(dt));
        projectiles.forEach((p, i) => { p.x += p.vx * dt; p.life -= dt; if (p.life <= 0) projectiles.splice(i, 1); });
        // Collision
        enemies.forEach(e => { if (player.x < e.x + e.w && player.x + player.w > e.x && player.y < e.y + e.h && player.y + player.h > e.y) player.hit(); });
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

function updateUI() {
    if (scoreElement) scoreElement.innerText = distanceTraveled;
    if (livesContainer) livesContainer.innerText = '❤️'.repeat(player.lives);
    const newRank = RANKS.find(r => distanceTraveled < (RANKS[RANKS.indexOf(r) + 1]?.score || Infinity));
    if (rankBadge) { rankBadge.innerText = newRank.title; rankBadge.style.color = newRank.color; }
}

function gameOver() { isGameOver = true; cancelAnimationFrame(animationId); overlay.classList.remove('hidden'); if (finalScoreElement) finalScoreElement.innerText = distanceTraveled; }

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
}

function startGame() {
    initDOMElements(); resize(); player = new Player(); initLevel();
    lastTimestamp = 0; requestAnimationFrame(gameLoop);
}

const startJoystick = (e) => {
    if (!joystickBase) initDOMElements(); if (!joystickBase) return;
    const t = e.touches ? e.touches[0] : e;
    const rect = joystickBase.getBoundingClientRect();
    if (e.target === joystickBase || joystickBase.contains(e.target)) {
        joystickActive = true; joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    if (e.target === jumpBtn || jumpBtn.contains(e.target)) player.jump();
    if (e.target === shootBtn || shootBtn.contains(e.target)) player.shoot();
};
const updateJoystick = (e) => {
    if (!joystickActive) return;
    const t = e.touches ? e.touches[0] : e;
    let dx = t.clientX - joystickCenter.x, dy = t.clientY - joystickCenter.y;
    const d = Math.sqrt(dx * dx + dy * dy), max = 50;
    if (d > max) { dx *= max / d; dy *= max / d; }
    joystickX = dx / max; joystickY = dy / max;
    if (joystickStick) joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
};
const stopJoystick = () => { joystickActive = false; joystickX = 0; joystickY = 0; if (joystickStick) joystickStick.style.transform = `translate(-50%,-50%)`; };

window.addEventListener('touchstart', startJoystick, { passive: false });
window.addEventListener('touchmove', updateJoystick, { passive: false });
window.addEventListener('touchend', stopJoystick);
window.addEventListener('mousedown', startJoystick);
window.addEventListener('mousemove', updateJoystick);
window.addEventListener('mouseup', stopJoystick);

window.addEventListener('keydown', e => { keys[e.key] = true; if (e.key === ' ') player.jump(); if (e.key === 'f') player.shoot(); });
window.addEventListener('keyup', e => { keys[e.key] = false; });

if (restartBtn) restartBtn.onclick = () => { location.reload(); };
if (pauseBtn) pauseBtn.onclick = () => { isPaused = !isPaused; pauseBtn.innerText = isPaused ? '▶' : '⏸'; if (!isPaused) { lastTimestamp = 0; requestAnimationFrame(gameLoop); } };

function playSound(t) { }
function initAudio() { }

window.onload = startGame;
