const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const bitsElement = document.getElementById('bits');
const finalScoreElement = document.getElementById('final-score');
const overlay = document.getElementById('overlay');
const restartBtn = document.getElementById('btn-restart');

const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');
const shootBtn = document.getElementById('btn-shoot');
const jumpBtn = document.getElementById('btn-jump');

// --- CONSTANTS (Unaltered Gameplay) ---
const GRAVITY = 0.5;
const FRICTION = 0.92;
const JUMP_FORCE = -12.5;
const ACCELERATION = 0.6;
const MAX_SPEED = 9;

// --- CINEMATIC THEME ---
const THEME = {
    pcb: '#010803',
    pcbSilk: '#041208',
    trace: 'rgba(46, 160, 67, 0.1)',
    glowCyan: '#00f7ff',
    glowGreen: '#2ea043',
    virusRed: '#f85149',
    metal: '#8b949e'
};

let isGameOver = false;
let cameraX = 0;
let distanceTraveled = 0;
let bitsCollected = 0;
let platforms = [];
let enemies = [];
let collectibles = [];
let projectiles = [];
let animationId;

let joystickActive = false;
const activeButtons = { left: false, right: false };
const keys = {};

// --- BACKGROUND IMAGE LOADING ---
const bgImg = new Image();
bgImg.src = 'backgroud.png';
let bgLoaded = false;
bgImg.onload = () => { bgLoaded = true; };

function drawParallaxBackground() {
    if (!bgLoaded) {
        ctx.fillStyle = THEME.pcb;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }

    // 1. Slow Parallax Movement (Moves at 5% of camera speed)
    const scale = canvas.height / bgImg.height;
    const drawWidth = bgImg.width * scale;

    ctx.save();
    // 2. Reduced Depth Blur for better visibility
    ctx.filter = 'blur(1.5px)';

    // Tiled horizontal draw
    let xOffset = -(cameraX * 0.05) % drawWidth;
    ctx.drawImage(bgImg, xOffset, 0, drawWidth, canvas.height);
    ctx.drawImage(bgImg, xOffset + drawWidth, 0, drawWidth, canvas.height);
    if (xOffset > 0) ctx.drawImage(bgImg, xOffset - drawWidth, 0, drawWidth, canvas.height);

    ctx.restore();

    // 3. Adjusted Dark Overlay for better contrast and visibility
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}



function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- PLAYER ---
class Player {
    constructor() { this.reset(); }
    reset() {
        this.width = 30; this.height = 45; // Slightly smaller to emphasize scale
        this.x = 200; this.y = canvas.height * 0.7;
        this.vx = 0; this.vy = 0;
        this.onGround = false; this.doubleJumpAvailable = true;
        this.facing = 1; this.shootCooldown = 0;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);

        // --- PLAYER SHADOW ---
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        const shadowY = (canvas.height * 0.75) - this.y - this.height;
        ctx.beginPath();
        ctx.ellipse(this.width / 2, this.height + shadowY, 20, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (this.facing === -1) { ctx.scale(-1, 1); ctx.translate(-this.width, 0); }

        // Sleek Industrial Robot
        ctx.fillStyle = '#161b22';
        ctx.beginPath(); ctx.roundRect(4, 15, 22, 25, 4); ctx.fill();
        ctx.fillStyle = '#0d1117';
        ctx.beginPath(); ctx.roundRect(0, 0, 30, 20, 4); ctx.fill();
        ctx.fillStyle = THEME.glowCyan;
        ctx.shadowBlur = 15; ctx.shadowColor = THEME.glowCyan;
        ctx.fillRect(4, 4, 22, 12);
        ctx.restore();
    }
    update() {
        if (this.shootCooldown > 0) this.shootCooldown--;
        if (keys['ArrowRight'] || keys['d'] || activeButtons.right) { if (this.vx < MAX_SPEED) this.vx += ACCELERATION; this.facing = 1; }
        else if (keys['ArrowLeft'] || keys['a'] || activeButtons.left) { if (this.vx > -MAX_SPEED) this.vx -= ACCELERATION; this.facing = -1; }
        else { this.vx *= FRICTION; }

        this.vy += GRAVITY; this.x += this.vx; this.y += this.vy;

        const groundLevel = canvas.height * 0.75; // 75% height = Ground occupies lower 25%
        if (this.y + this.height > groundLevel) { this.y = groundLevel - this.height; this.vy = 0; this.onGround = true; this.doubleJumpAvailable = true; }

        this.onGround = false;
        if (this.y + this.height >= groundLevel) { this.y = groundLevel - this.height; this.vy = 0; this.onGround = true; }

        platforms.forEach(p => {
            if (this.x < p.x + p.w && this.x + this.width > p.x && this.y + this.height > p.y && this.y + this.height < p.y + p.h + this.vy) {
                if (this.vy > 0) {
                    this.onGround = true; this.doubleJumpAvailable = true; this.vy = 0; this.y = p.y - this.height;
                }
            }
        });

        if (this.x < cameraX) { this.x = cameraX; this.vx = 0; }
        cameraX = Math.max(cameraX, this.x - canvas.width / 4);
        distanceTraveled = Math.max(distanceTraveled, Math.floor(this.x / 10));
        scoreElement.innerText = distanceTraveled;
    }
    jump() {
        if (this.onGround) { this.vy = JUMP_FORCE; this.onGround = false; playSound('jump'); }
        else if (this.doubleJumpAvailable) { this.vy = JUMP_FORCE * 0.85; this.doubleJumpAvailable = false; playSound('jump'); }
    }
    shoot() {
        if (this.shootCooldown > 0) return;
        projectiles.push(new Projectile(this.x + (this.facing === 1 ? 30 : 0), this.y + 10, this.facing));
        this.shootCooldown = 15; playSound('shoot');
    }
}

// --- PROJECTILE ---
class Projectile {
    constructor(x, y, d) { this.x = x; this.y = y; this.vx = d * 15; this.l = 60; }
    draw() {
        ctx.save(); ctx.translate(this.x - cameraX, this.y);
        ctx.fillStyle = THEME.glowCyan; ctx.shadowBlur = 10; ctx.shadowColor = THEME.glowCyan;
        ctx.fillRect(0, 0, 10, 2); ctx.restore();
    }
    update() { this.x += this.vx; this.l--; }
}

// --- VISUAL DECEPTION PLATFORMS ---
class Platform {
    constructor(x, y, w, h, type) {
        this.x = x; this.y = y; this.w = w; this.h = h; this.type = type; // cable, pipe, line
    }
    draw() {
        if (this.x + this.w < cameraX || this.x > cameraX + canvas.width) return;
        ctx.save(); ctx.translate(-cameraX, 0);

        switch (this.type) {
            case 'cable': // Suspended Power Cable
                const grad = ctx.createLinearGradient(this.x, this.y, this.x, this.y + this.h);
                grad.addColorStop(0, '#111'); grad.addColorStop(0.5, '#333'); grad.addColorStop(1, '#111');
                ctx.fillStyle = grad;
                ctx.fillRect(this.x, this.y, this.w, this.h);
                // Connectors
                ctx.fillStyle = '#b87333';
                ctx.fillRect(this.x - 5, this.y - 2, 10, this.h + 4);
                ctx.fillRect(this.x + this.w - 5, this.y - 2, 10, this.h + 4);
                break;
            case 'pipe': // Industrial Cooling Pipe
                const pGrad = ctx.createLinearGradient(this.x, this.y, this.x, this.y + this.h);
                pGrad.addColorStop(0, '#222'); pGrad.addColorStop(0.3, '#444'); pGrad.addColorStop(1, '#222');
                ctx.fillStyle = pGrad;
                ctx.fillRect(this.x, this.y, this.w, this.h);
                break;
            case 'line': // Data Highway Line
                ctx.fillStyle = '#1a3a2a';
                ctx.fillRect(this.x, this.y, this.w, this.h);
                ctx.fillStyle = THEME.glowGreen;
                ctx.globalAlpha = Math.abs(Math.sin(Date.now() / 500));
                ctx.fillRect(this.x + 10, this.y + 5, this.w - 20, 2);
                break;
        }
        ctx.restore();
    }
}

// --- ENEMIES & COLLECTIBLES ---
class Enemy {
    constructor(x, y) { this.x = x; this.y = y; this.w = 35; this.h = 35; this.vx = -4; this.dead = false; }
    draw() {
        ctx.save(); ctx.translate(this.x - cameraX, this.y);
        ctx.fillStyle = THEME.virusRed;
        // Glitch shape
        ctx.fillRect((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 5, this.w, this.h);
        ctx.restore();
    }
}

class Collectible {
    constructor(x, y) { this.x = x; this.y = y; this.v = Math.random() > 0.5 ? '1' : '0'; }
    draw() {
        ctx.save(); ctx.translate(this.x - cameraX, this.y);
        ctx.fillStyle = THEME.glowCyan;
        ctx.shadowBlur = 10; ctx.shadowColor = THEME.glowCyan;
        ctx.font = '24px monospace'; ctx.globalAlpha = 0.7;
        ctx.fillText(this.v, 0, 0);
        ctx.restore();
    }
}

// --- RENDERING ENGINE ---
function drawWorld() {
    // 1. HIGH-QUALITY IMAGE BACKGROUND (Visual Only)
    drawParallaxBackground();

    // 2. MID LAYER (Traces & Cables)
    ctx.strokeStyle = THEME.trace; ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width + 200; i += 100) {
        let x = i - (cameraX * 0.3 % 100);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }

    // 3. GROUND LAYER (Lower 25% - More visible for clarity)
    const groundY = canvas.height * 0.75;
    const gGrad = ctx.createLinearGradient(0, groundY, 0, canvas.height);
    gGrad.addColorStop(0, 'rgba(4, 18, 8, 0.75)'); // Increased opacity
    gGrad.addColorStop(1, 'rgba(1, 8, 3, 0.95)');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);

    // Traces on ground
    ctx.strokeStyle = 'rgba(46, 160, 67, 0.3)';
    for (let i = 0; i < canvas.width + 400; i += 200) {
        let gx = i - (cameraX * 1.0 % 200);
        ctx.beginPath(); ctx.moveTo(gx, groundY); ctx.lineTo(gx - 100, canvas.height); ctx.stroke();
    }

    // 4. FOREGROUND OVERLAY
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, 50);
    ctx.restore();
}

function generate() {
    const last = platforms[platforms.length - 1];
    if (last.x < cameraX + canvas.width + 1000) {
        const types = ['cable', 'pipe', 'line'];
        const t = types[Math.floor(Math.random() * types.length)];
        const nx = last.x + 350 + Math.random() * 250;
        const ny = Math.max(canvas.height * 0.3, Math.min(canvas.height * 0.65, last.y + (Math.random() - 0.5) * 400));
        platforms.push(new Platform(nx, ny, 180 + Math.random() * 150, 20, t));

        if (Math.random() > 0.3) collectibles.push(new Collectible(nx + 50, ny - 60));
        if (Math.random() > 0.8) enemies.push(new Enemy(nx + 400, groundY - 40));
    }
    if (platforms[0].x < cameraX - 1500) platforms.shift();
}

const groundY = canvas.height * 0.75;

function gameLoop() {
    if (isGameOver) return;
    drawWorld();
    generate();

    platforms.forEach(p => p.draw());
    projectiles = projectiles.filter(p => { p.update(); p.draw(); return p.l > 0; });

    enemies = enemies.filter(en => {
        en.x += en.vx; en.draw();
        projectiles.forEach(pr => { if (Math.abs(pr.x - en.x) < 40 && Math.abs(pr.y - en.y) < 40) { en.dead = true; pr.l = 0; } });
        if (!en.dead && Math.abs(player.x - en.x) < 35 && Math.abs(player.y - en.y) < 40) {
            if (player.vy > 0 && player.y + player.height < en.y + 20) { player.vy = -10; return false; }
            gameOver();
        }
        return !en.dead && en.x > cameraX - 100;
    });

    collectibles = collectibles.filter(c => {
        c.draw();
        if (Math.abs(player.x - c.x) < 30 && Math.abs(player.y - c.y) < 40) { bitsCollected++; bitsElement.innerText = bitsCollected; playSound('collect'); return false; }
        return c.x > cameraX - 100;
    });

    player.update(); player.draw();
    animationId = requestAnimationFrame(gameLoop);
}

// --- AUDIO & UI ---
let audioCtx;
const initAudio = () => { if (audioCtx) return; audioCtx = new (window.AudioContext || window.webkitAudioContext)(); };
const playSound = (t) => {
    if (!audioCtx) return; const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); const n = audioCtx.currentTime;
    if (t === 'jump') { o.frequency.setTargetAtTime(150, n, 0.1); o.frequency.exponentialRampToValueAtTime(600, n + 0.1); g.gain.setTargetAtTime(0.05, n, 0.01); }
    if (t === 'hit') { o.type = 'sawtooth'; o.frequency.value = 60; g.gain.setTargetAtTime(0.1, n, 0.01); }
    if (t === 'collect') { o.frequency.value = 1200; g.gain.setTargetAtTime(0.05, n, 0.01); }
    if (t === 'shoot') { o.frequency.value = 400; g.gain.setTargetAtTime(0.02, n, 0.01); }
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(n + 0.1);
};

function gameOver() { isGameOver = true; playSound('hit'); overlay.classList.remove('hidden'); }

// INPUTS
window.addEventListener('keydown', e => { initAudio(); keys[e.key] = true; if (e.key === ' ' || e.key === 'w') player.jump(); if (e.key === 'f') player.shoot(); });
window.addEventListener('keyup', e => keys[e.key] = false);

// Simplified Touch/Mouse 
const handleInput = (e) => {
    initAudio();
    const touch = e.touches ? e.touches[0] : e;
    const rect = joystickBase.getBoundingClientRect();
    if (e.target === jumpBtn || jumpBtn.contains(e.target)) player.jump();
    if (e.target === shootBtn || shootBtn.contains(e.target)) player.shoot();
    if (e.target === joystickBase || joystickBase.contains(e.target)) {
        joystickActive = true;
        const diffX = touch.clientX - (rect.left + rect.width / 2);
        activeButtons.left = diffX < -15; activeButtons.right = diffX > 15;
    }
};
window.addEventListener('touchstart', handleInput, { passive: false });
window.addEventListener('mousedown', handleInput);
window.addEventListener('touchend', () => { joystickActive = false; activeButtons.left = activeButtons.right = false; });
window.addEventListener('mouseup', () => { joystickActive = false; activeButtons.left = activeButtons.right = false; });

restartBtn.addEventListener('click', () => location.reload());

function initLevel() {
    isGameOver = false; cameraX = 0; distanceTraveled = 0; bitsCollected = 0;
    platforms = [new Platform(0, canvas.height * 0.7, 600, 20, 'pipe')];
    player.reset(); gameLoop();
}

const player = new Player();
initLevel();
