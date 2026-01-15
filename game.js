const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const bitsElement = document.getElementById('bits');
const finalScoreElement = document.getElementById('final-score');
const overlay = document.getElementById('overlay');
const restartBtn = document.getElementById('btn-restart');

// D-Pad Buttons
const dpadUp = document.getElementById('dpad-up');
const dpadDown = document.getElementById('dpad-down');
const dpadLeft = document.getElementById('dpad-left');
const dpadRight = document.getElementById('dpad-right');
const shootBtn = document.getElementById('btn-shoot');
const jumpBtn = document.getElementById('btn-jump');

// --- CONSTANTS (Slower, Managed Physics) ---
const GRAVITY = 0.4;
const FRICTION = 0.8;
const JUMP_FORCE = -10;
const ACCELERATION = 0.5;
const MAX_SPEED = 4.5;
const TARGET_FPS = 60;
const TIME_STEP = 1000 / TARGET_FPS;

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

let groundY = window.innerHeight * 0.85; // Lower ground for better visibility

let isGameOver = false;
let isPaused = false;
let pausedByOrientation = false; // Track if we forced pause due to flip
let cameraX = 0;
let distanceTraveled = 0;
let bitsCollected = 0;
let platforms = [];
let enemies = [];
let collectibles = [];
let projectiles = [];
let particles = [];
let animationId;
let lastTimestamp = 0;
let currentRankIndex = 0;
const RANKS = [
    { score: 0, title: 'STAJYER', color: '#8b949e' },
    { score: 500, title: 'JR. DEV', color: '#2ea043' },
    { score: 1500, title: 'MID DEV', color: '#58a6ff' },
    { score: 3000, title: 'SENIOR', color: '#a371f7' },
    { score: 5000, title: 'LEAD', color: '#f2cc60' },
    { score: 10000, title: 'CODEMAN', color: '#ff0000' }
];

// --- INPUT HANDLING STATE ---
const dpadState = { up: false, down: false, left: false, right: false };
const keys = {};

// --- BACKGROUND IMAGE LOADING ---
const bgImg = new Image();
bgImg.src = 'motherboard_bg.png';
let bgLoaded = false;
bgImg.onload = () => { bgLoaded = true; };

function drawParallaxBackground() {
    if (!bgLoaded) {
        ctx.fillStyle = THEME.pcb;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }

    // 1. Better Scaling: Aspect-ratio aware fill
    const aspect = bgImg.width / bgImg.height;
    let drawHeight = canvas.height;
    let drawWidth = drawHeight * aspect;

    // Background moves much slower than the foreground
    const moveX = (cameraX * 0.15); // Adjust for desired depth

    ctx.save();

    // Tiled horizontal draw for seamless loop
    let xOffset = -(moveX % drawWidth);

    // Draw enough tiles to cover the entire screen + padding
    for (let i = -1; i < Math.ceil(canvas.width / drawWidth) + 1; i++) {
        ctx.drawImage(bgImg, xOffset + (i * drawWidth), 0, drawWidth, canvas.height);
    }

    ctx.restore();

    // 2. Cinematic Depth Overlay
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, 'rgba(13, 17, 23, 0.4)'); // Dark top
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');    // Clear middle
    grad.addColorStop(1, 'rgba(13, 17, 23, 0.8)'); // Dark bottom for ground blend
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}



function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    groundY = canvas.height * 0.85;

    // Check Orientation (Force Landscape)
    const warning = document.getElementById('orientation-warning');
    if (window.innerHeight > window.innerWidth) {
        warning.classList.remove('hidden');
        if (!isPaused && !isGameOver) {
            isPaused = true;
            pausedByOrientation = true;
            document.getElementById('btn-pause').innerText = '▶';

        }
    } else {
        warning.classList.add('hidden');
        // Auto-resume only if it was paused by orientation
        if (isPaused && pausedByOrientation && !isGameOver) {
            isPaused = false;
            pausedByOrientation = false;
            document.getElementById('btn-pause').innerText = '⏸';

            lastTimestamp = 0;
            requestAnimationFrame(gameLoop);
        }
    }
}
window.addEventListener('resize', resize);
resize();

// --- PLAYER ---
class Player {
    constructor() { this.reset(); }
    reset() {
        this.width = 36; this.height = 54; // Enlarged by 20% (from 30x45)
        this.x = 200; this.y = groundY - this.height - 100;
        this.vx = 0; this.vy = 0;
        this.onGround = false; this.doubleJumpAvailable = true;
        this.facing = 1; this.shootCooldown = 0;
        this.ducking = false; this.lookingUp = false;
        // Game Logic Stats
        this.lives = 3;
        this.invulnerable = 0;

        // Keep current color if it exists, otherwise default
        const savedColor = localStorage.getItem('codeman_player_color');
        if (!this.color) this.color = savedColor || THEME.glowCyan;

        // Safety: Only update UI if we're not in the middle of a constructor call
        if (typeof player !== 'undefined') updateUI();
    }

    hit() {
        if (this.invulnerable > 0 || isGameOver) return;

        this.lives--;
        playSound('hit');
        updateUI();

        if (this.lives <= 0) {
            gameOver();
        } else {
            // Temporary Invulnerability
            this.invulnerable = 120; // 2 seconds

            // Screen Shake Effect
            const originalX = cameraX;
            cameraX += Math.random() * 20 - 10;
            setTimeout(() => cameraX = originalX, 50);
        }
    }

    draw() {
        // --- PREMIUM CYBERNETIC COMMANDO LOOK ---
        const pulse = Math.sin(Date.now() / 200) * 0.15 + 0.85;
        const charColor = this.color;
        const glowColor = charColor + 'AA'; // 66% opacity for glow
        const accentColor = charColor;
        const baseHardware = '#111820'; // Deep space blue-black

        ctx.save();
        ctx.translate(this.x - cameraX, this.y);
        ctx.scale(this.width / 30, this.height / 45);

        // 1. DYNAMIC SHADOW (Ground Contact)
        ctx.save();
        const distFromGround = Math.max(0, groundY - (this.y + this.height));
        const shadowAlpha = Math.max(0, 0.4 - (distFromGround / 100));
        ctx.globalAlpha = shadowAlpha;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(15, 45, 15, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (this.invulnerable > 0 && Math.floor(Date.now() / 100) % 2 === 0) ctx.globalAlpha = 0.4;
        if (this.facing === -1) { ctx.scale(-1, 1); ctx.translate(-30, 0); }

        // 2. SQUASH & STRETCH
        let scaleY = 1, offsetY = 0;
        if (this.ducking) { scaleY = 0.65; offsetY = 15; }
        else if (this.lookingUp) { scaleY = 1.1; offsetY = -5; }

        ctx.translate(0, offsetY);
        ctx.scale(1, scaleY);

        // --- THE SUIT (Hard Surface Modeling) ---

        // Casing (Back layer for depth)
        ctx.fillStyle = '#080c10';
        ctx.beginPath();
        ctx.roundRect(5, 18, 20, 20, 4);
        ctx.fill();

        // Layered Body (Main Armor)
        const armorGrad = ctx.createLinearGradient(0, 18, 0, 38);
        armorGrad.addColorStop(0, '#1a222c');
        armorGrad.addColorStop(1, '#0d1117');
        ctx.fillStyle = armorGrad;
        ctx.beginPath();
        ctx.roundRect(6, 19, 18, 18, 3);
        ctx.fill();

        // --- ACCENT LIGHTING (CIRCUITRY) ---
        ctx.save();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8;
        ctx.shadowColor = accentColor;

        // Vertical Energy Strip on Chest
        ctx.beginPath();
        ctx.moveTo(15, 22);
        ctx.lineTo(15, 34);
        ctx.stroke();

        // Energy Nodes (Shoulders)
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.arc(8, 22, 1.5, 0, Math.PI * 2);
        ctx.arc(22, 22, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // --- THRUSTERS (Premium Feet) ---
        // Metallic Boots
        ctx.fillStyle = '#2d333b';
        ctx.beginPath();
        ctx.roundRect(4, 34, 9, 8, 2); // Left boot
        ctx.roundRect(17, 34, 9, 8, 2); // Right boot
        ctx.fill();

        // Propulsion Core
        const thrusterPower = (this.vy < 0 || Math.abs(this.vx) > 0.5) ? 1 : 0.4;
        const heat = Math.sin(Date.now() / 50) * 0.2 + 0.8;

        ctx.save();
        ctx.shadowBlur = 10 * thrusterPower;
        ctx.shadowColor = accentColor;
        ctx.fillStyle = accentColor;
        ctx.globalAlpha = 0.8 * thrusterPower * heat;
        ctx.fillRect(6, 40, 5, 4);
        ctx.fillRect(19, 40, 5, 4);

        // Energy Beam
        const beamH = (this.vy < 0 ? 25 : 10) * thrusterPower * heat;
        const beamGrad = ctx.createLinearGradient(0, 44, 0, 44 + beamH);
        beamGrad.addColorStop(0, accentColor);
        beamGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = beamGrad;
        ctx.fillRect(6, 44, 5, beamH);
        ctx.fillRect(19, 44, 5, beamH);
        ctx.restore();

        // --- THE MONITOR (Head) ---
        ctx.save();
        const bob = Math.sin(Date.now() / 180) * 1.2;
        ctx.translate(15, 10 + bob);

        // Case (High-End Carbon Fiber Look)
        ctx.fillStyle = '#0d1117';
        ctx.beginPath();
        ctx.roundRect(-15, -13, 30, 24, 6);
        ctx.fill();

        // Bevel Frame (Colored Accent)
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 5;
        ctx.shadowColor = accentColor;
        ctx.beginPath();
        ctx.roundRect(-14, -12, 28, 22, 5);
        ctx.stroke();

        // Screen (OLED Deep Black)
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.roundRect(-12, -10, 24, 18, 2);
        ctx.fill();

        // HUD / Expresssion (Vibrant Glowing)
        ctx.save();
        ctx.shadowBlur = 12 * pulse;
        ctx.shadowColor = accentColor;
        ctx.fillStyle = accentColor;
        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let expr = '>_';
        if (!this.onGround) expr = '^_^';
        else if (this.ducking) expr = 'U_U';
        else if (Math.abs(this.vx) > 2) expr = '>.<';
        else expr = '0_0';

        ctx.fillText(expr, 0, 0);
        ctx.restore();

        // Scanline Effect (Retro Tech)
        ctx.save();
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = '#fff';
        for (let i = -10; i < 8; i += 2) {
            ctx.fillRect(-12, i, 24, 0.5);
        }
        ctx.restore();

        // Lens Flare / Reflection
        ctx.save();
        ctx.globalAlpha = 0.2;
        const reflGrad = ctx.createLinearGradient(-10, -10, 10, 10);
        reflGrad.addColorStop(0, '#fff');
        reflGrad.addColorStop(0.5, 'transparent');
        ctx.fillStyle = reflGrad;
        ctx.beginPath();
        ctx.moveTo(-10, -10); ctx.lineTo(10, -10); ctx.lineTo(-10, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.restore(); // End Head

        ctx.restore(); // Total Restore
    }
    update(dt) {
        if (this.invulnerable > 0) this.invulnerable--;
        if (this.shootCooldown > 0) this.shootCooldown--;

        // Digital movement input (keyboard + D-Pad)
        let moveX = 0;
        let moveY = 0;

        if (keys['ArrowRight'] || keys['d'] || dpadState.right) moveX = 1;
        else if (keys['ArrowLeft'] || keys['a'] || dpadState.left) moveX = -1;

        if (keys['ArrowDown'] || keys['s'] || dpadState.down) moveY = 1;
        else if (keys['ArrowUp'] || keys['w'] || dpadState.up) moveY = -1;

        // Horizontal Movement logic
        if (Math.abs(moveX) > 0.1) {
            this.vx += moveX * ACCELERATION * dt;
            const currentMaxSpeed = MAX_SPEED * Math.abs(moveX);
            if (Math.abs(this.vx) > currentMaxSpeed) this.vx *= 0.95;
            this.facing = moveX > 0 ? 1 : -1;
        } else {
            this.vx *= Math.pow(FRICTION, dt);
        }

        // Vertical Movement (Ducking / Looking Up)
        this.ducking = moveY > 0.5;
        this.lookingUp = moveY < -0.5;

        this.vy += GRAVITY * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        this.onGround = false;

        // 1. Ground Collision
        if (this.y + this.height >= groundY) {
            this.y = groundY - this.height;
            this.vy = 0;
            this.onGround = true;
            this.doubleJumpAvailable = true;
        }

        // 2. Platform Collision
        platforms.forEach(p => {
            if (this.x < p.x + p.w && this.x + this.width > p.x &&
                this.y + this.height > p.y && this.y + this.height < p.y + p.h + this.vy) {
                if (this.vy > 0) {
                    this.onGround = true;
                    this.doubleJumpAvailable = true;
                    this.vy = 0;
                    this.y = p.y - this.height;
                }
            }
        });

        if (this.x < cameraX) { this.x = cameraX; this.vx = 0; }
        cameraX = Math.max(cameraX, this.x - canvas.width / 4);
        distanceTraveled = Math.max(distanceTraveled, Math.floor(this.x / 10));
        scoreElement.innerText = distanceTraveled;

        // Create Trail Particles
        if ((Math.abs(this.vx) > 2 || this.vy !== 0) && !isPaused && Math.random() > 0.4) {
            particles.push(new Particle(
                this.x + this.width / 2 + (Math.random() * 10 - 5),
                this.y + this.height - 5,
                this.color
            ));
        }
    }
    jump() {
        if (this.onGround) { this.vy = JUMP_FORCE; this.onGround = false; playSound('jump'); }
        else if (this.doubleJumpAvailable) { this.vy = JUMP_FORCE * 0.85; this.doubleJumpAvailable = false; playSound('jump'); }
    }
    shoot() {
        if (this.shootCooldown > 0) return;

        // Base shooting position (middle of torso)
        let spawnY = this.y + (20 * (this.height / 45));
        let pvx = this.facing * 16;
        let pvy = 0;

        // Dynamic Aiming
        if (this.ducking) {
            spawnY = this.y + (32 * (this.height / 45)); // Lower spawn height
            pvy = 4;                                     // Shoot diagonally down
        } else if (this.lookingUp) {
            spawnY = this.y + (10 * (this.height / 45)); // Higher spawn height
            pvy = -4;                                    // Shoot diagonally up
        }

        const spawnX = this.x + (this.facing === 1 ? 30 : 0);
        projectiles.push(new Projectile(spawnX, spawnY, pvx, pvy, this.color));
        this.shootCooldown = 15; playSound('shoot');
    }
}

// --- PROJECTILE ---
class Projectile {
    constructor(x, y, vx, vy, color) {
        this.x = x; this.y = y;
        this.vx = vx; this.vy = vy;
        this.l = 60;
        this.color = color;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);
        // Rotate projectile to match its flight path
        const angle = Math.atan2(this.vy, this.vx);
        ctx.rotate(angle);

        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fillRect(0, -1.5, 15, 3);
        ctx.restore();
    }
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.l -= dt;
    }
}

// --- VISUAL DECEPTION PLATFORMS ---
class Platform {
    constructor(x, y, w, h, type) {
        this.x = x; this.y = y; this.w = w; this.h = h; this.type = type;
        this.seed = Math.random() * 100;
    }
    draw() {
        if (this.x + this.w < cameraX || this.x > cameraX + canvas.width) return;
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);

        switch (this.type) {
            case 'ram': // RAM Slot/Stick
                this.drawRam();
                break;
            case 'resistor': // Electronic Resistor
                this.drawResistor();
                break;
            case 'capacitor': // Electrolytic Capacitor
                this.drawCapacitor();
                break;
        }
        ctx.restore();
    }

    drawRam() {
        // Main Board
        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        grad.addColorStop(0, '#041208'); grad.addColorStop(0.5, '#2ea043'); grad.addColorStop(1, '#041208');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        // RAM Chips
        ctx.fillStyle = '#111';
        for (let i = 10; i < this.w - 10; i += 30) {
            ctx.fillRect(i, -2, 20, this.h + 4);
            // Chip pins
            ctx.fillStyle = '#b87333';
            ctx.fillRect(i + 2, this.h, 16, 2);
            ctx.fillStyle = '#111';
        }
        // Slot Clips
        ctx.fillStyle = '#8b949e';
        ctx.fillRect(-5, -5, 10, this.h + 10);
        ctx.fillRect(this.w - 5, -5, 10, this.h + 10);

        // Large RAM Chips (very prominent)
        ctx.fillStyle = '#111';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;

        // Draw 6 large chips across the RAM stick
        for (let i = 0; i < 6; i++) {
            const x = 15 + i * 25;
            // Chip body
            ctx.fillRect(x, this.h / 2 - 8, 20, 16);
            ctx.strokeRect(x, this.h / 2 - 8, 20, 16);

            // Gold pins at bottom
            ctx.fillStyle = '#ffd700';
            for (let p = 0; p < 4; p++) {
                ctx.fillRect(x + 2 + p * 4, this.h / 2 + 8, 3, 3);
            }
            ctx.fillStyle = '#111';
        }

        // DDR Label (very visible)
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('DDR4', this.w / 2, this.h / 2 - 12);

        // RAM Capacity label
        const capacities = ['4GB', '8GB', '16GB', '32GB'];
        const capacity = capacities[Math.floor(this.seed * capacities.length) % capacities.length];
        ctx.fillStyle = '#2ea043';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(capacity, this.w / 2, this.h / 2 + 18);
    }

    drawResistor() {
        // Thinner cylindrical body
        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        grad.addColorStop(0, '#8d6e63');
        grad.addColorStop(0.5, '#d7ccc8');
        grad.addColorStop(1, '#8d6e63');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(15, 2, this.w - 30, this.h - 4, 8);
        ctx.fill();

        // Randomized Color Bands (based on seed for variety)
        const colorSets = [
            ['#4e342e', '#fbc02d', '#f44336'], // Brown-Yellow-Red
            ['#f44336', '#f44336', '#4e342e'], // Red-Red-Brown
            ['#ff9800', '#ff9800', '#4e342e'], // Orange-Orange-Brown
            ['#4e342e', '#000', '#f44336'],    // Brown-Black-Red
            ['#ffeb3b', '#9c27b0', '#ff9800']  // Yellow-Violet-Orange
        ];
        const bands = colorSets[Math.floor(this.seed * colorSets.length) % colorSets.length];

        bands.forEach((b, i) => {
            ctx.fillStyle = b;
            ctx.fillRect(30 + i * 20, 0, 6, this.h);
        });

        // Thinner wires
        ctx.strokeStyle = '#8b949e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, this.h / 2);
        ctx.lineTo(15, this.h / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(this.w - 15, this.h / 2);
        ctx.lineTo(this.w, this.h / 2);
        ctx.stroke();

        // Resistor value label (technical)
        const values = ['2.7K', '220Ω', '330Ω', '1KΩ', '47K'];
        const value = values[Math.floor(this.seed * values.length) % values.length];
        ctx.fillStyle = '#000';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(value, this.w / 2, this.h / 2 + 3);
    }

    drawCapacitor() {
        // Cylindrical capacitor body
        const colors = [
            { body: '#ff6b35', top: '#ff8c61' },  // Orange
            { body: '#1e88e5', top: '#42a5f5' },  // Blue
            { body: '#e53935', top: '#ef5350' },  // Red
            { body: '#fdd835', top: '#ffeb3b' }   // Yellow
        ];
        const colorSet = colors[Math.floor(this.seed * colors.length) % colors.length];

        // Main cylinder body
        const bodyGrad = ctx.createLinearGradient(0, 0, this.w, 0);
        bodyGrad.addColorStop(0, colorSet.body);
        bodyGrad.addColorStop(0.5, colorSet.top);
        bodyGrad.addColorStop(1, colorSet.body);
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(5, 5, this.w - 10, this.h - 10);

        // Top cap (metallic)
        ctx.fillStyle = '#8b949e';
        ctx.fillRect(5, 0, this.w - 10, 5);

        // Bottom cap
        ctx.fillRect(5, this.h - 5, this.w - 10, 5);

        // Leads (wires)
        ctx.strokeStyle = '#8b949e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.w / 2 - 8, this.h);
        ctx.lineTo(this.w / 2 - 8, this.h + 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(this.w / 2 + 8, this.h);
        ctx.lineTo(this.w / 2 + 8, this.h + 8);
        ctx.stroke();

        // Polarity marking (white stripe)
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(8, 8, 3, this.h - 16);

        // Value label
        const values = ['100µF', '220µF', '470µF', '1000µF', '2200µF'];
        const value = values[Math.floor(this.seed * values.length) % values.length];
        ctx.fillStyle = '#000';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.save();
        ctx.translate(this.w / 2, this.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(value, 0, 3);
        ctx.restore();
    }


}


// --- ENEMIES & COLLECTIBLES ---
class Enemy {
    constructor(x, y, type = 'crawler') {
        this.x = x; this.y = y; this.type = type;
        this.dead = false;
        this.seed = Math.random() * 100;
        this.baseY = y;

        switch (type) {
            case 'scout': // Small, fast
                this.w = 20; this.h = 20;
                this.vx = -7 - (Math.random() * 2);
                this.hp = 2; // Needs 2 hits
                break;
            case 'heavy': // Large, slow
                this.w = 50; this.h = 50;
                this.vx = -3;
                this.hp = 3; // Needs 3 hits
                break;
            case 'flyer': // Sine wave movement
                this.w = 30; this.h = 30;
                this.vx = -5;
                this.hp = 1;
                break;
            default: // Crawler
                this.w = 35; this.h = 35;
                this.vx = -4 - (Math.random() * 2);
                this.hp = 1;
        }
    }

    update(dt) {
        this.x += this.vx * dt;
        if (this.type === 'flyer') {
            this.y = this.baseY + Math.sin(Date.now() / 200 + this.seed) * 35;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x - cameraX + this.w / 2, this.y + this.h / 2);
        const time = Date.now() / 100;
        const pulse = Math.sin(time + this.seed) * 0.2 + 0.8;

        switch (this.type) {
            case 'scout': this.drawScout(pulse, time); break;
            case 'heavy': this.drawHeavy(pulse, time); break;
            case 'flyer': this.drawFlyer(pulse, time); break;
            default: this.drawCrawler(pulse, time);
        }
        ctx.restore();
    }

    drawScout(pulse, time) {
        // TROJAN: Spiky, aggressive shape
        ctx.fillStyle = '#ff0000';
        ctx.shadowBlur = 10 * pulse; ctx.shadowColor = '#ff0000';

        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2 + time * 2;
            const r = (i % 2 === 0) ? this.w / 2 : this.w / 4;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();

        // Menacing eye
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(1, -1, 1, 0, Math.PI * 2); ctx.fill();
    }

    drawHeavy(pulse, time) {
        // BAD SECTOR: Glitchy, heavy block
        ctx.fillStyle = '#21262d';
        ctx.strokeStyle = '#d0312d';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 5; ctx.shadowColor = '#d0312d';

        // Main block
        ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
        ctx.strokeRect(-this.w / 2, -this.h / 2, this.w, this.h);

        // Glitch lines (random static effect)
        ctx.fillStyle = '#d0312d';
        for (let i = 0; i < 3; i++) {
            const h = Math.random() * this.h;
            ctx.fillRect(-this.w / 2, -this.h / 2 + h, this.w, 2);
        }

        // "X" mark
        ctx.beginPath();
        ctx.moveTo(-10, -10); ctx.lineTo(10, 10);
        ctx.moveTo(10, -10); ctx.lineTo(-10, 10);
        ctx.stroke();
    }

    drawFlyer(pulse, time) {
        // BUG: Winged digital insect
        ctx.fillStyle = '#a371f7'; // Purple bug

        // Wings flapping
        const wingY = Math.sin(time * 20) * 10;

        // Right Wing
        ctx.beginPath();
        ctx.ellipse(10, -5, 12, 6, Math.PI / 4 + wingY * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(163, 113, 247, 0.6)';
        ctx.fill();

        // Left Wing
        ctx.beginPath();
        ctx.ellipse(-10, -5, 12, 6, -Math.PI / 4 - wingY * 0.05, 0, Math.PI * 2);
        ctx.fill();

        // Body
        ctx.fillStyle = '#a371f7';
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();

        // Eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-3, -2, 2, 0, Math.PI * 2);
        ctx.arc(3, -2, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    drawCrawler(pulse, time) {
        // WORM/SPYWARE: Segmented crawler
        ctx.fillStyle = '#2da44e'; // Green worm
        ctx.shadowBlur = 5; ctx.shadowColor = '#2da44e';

        // Draw segments wiggling
        for (let i = 0; i < 3; i++) {
            const offset = Math.sin(time * 5 + i) * 3;
            ctx.beginPath();
            ctx.arc(-10 + i * 10, offset, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // Head (last segment)
        ctx.fillStyle = '#1f6feb';
        ctx.beginPath(); ctx.arc(12, 0, 7, 0, Math.PI * 2); ctx.fill();
        // Eye
        ctx.fillStyle = '#fff';
        ctx.fillRect(12, -2, 4, 4);
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y;
        this.color = color;
        this.size = Math.random() * 4 + 2; // Slightly larger pixels
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2 - 1;
        this.life = 1.0;
        this.decay = Math.random() * 0.05 + 0.02;
    }
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= this.decay * dt;
        this.size *= Math.pow(0.95, dt); // Shrink over time
    }
    draw() {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        // Draw pixel or tiny '0'/'1'
        if (this.size > 2.5) {
            ctx.font = Math.floor(this.size * 3) + 'px monospace';
            ctx.fillText(Math.random() > 0.5 ? '1' : '0', this.x - cameraX, this.y);
        } else {
            ctx.fillRect(this.x - cameraX, this.y, this.size, this.size);
        }
        ctx.restore();
    }
}

class Collectible {
    constructor(x, y) {
        this.x = x; this.y = y;
        const rand = Math.random();

        // 2% Coffee (Life), 5% Semicolon (50pts), 46% 1, 47% 0
        if (rand > 0.98) this.type = '☕';
        else if (rand > 0.93) this.type = ';';
        else if (rand > 0.47) this.type = '1';
        else this.type = '0';

        this.floatOffset = Math.random() * Math.PI * 2;
        this.pulseOffset = Math.random() * 10;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);

        // Floating animation
        const floatY = Math.sin(Date.now() / 300 + this.floatOffset) * 5;
        ctx.translate(0, floatY);

        const time = Date.now() / 500;
        const glowIntensity = (Math.sin(time + this.pulseOffset) * 0.3) + 0.7; // 0.4 to 1.0

        // Colors based on type
        let mainColor, glowColor;

        if (this.type === '☕') {
            mainColor = '#f2cc60'; // Warm Coffee Color
            glowColor = 'rgba(242, 204, 96, ';
        } else if (this.type === ';') {
            mainColor = '#ffd700'; // Gold
            glowColor = 'rgba(255, 215, 0, ';
        } else if (this.type === '1') {
            mainColor = '#2ea043'; // Green
            glowColor = 'rgba(46, 160, 67, ';
        } else {
            mainColor = '#58a6ff'; // Blue
            glowColor = 'rgba(88, 166, 255, ';
        }

        // Outer Glow
        const radius = (this.type === ';' || this.type === '☕') ? 25 : 20;
        const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, radius);
        grad.addColorStop(0, glowColor + (0.8 * glowIntensity) + ')');
        grad.addColorStop(0.5, glowColor + (0.3 * glowIntensity) + ')');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner Core
        ctx.fillStyle = '#fff';
        ctx.shadowColor = mainColor;
        ctx.shadowBlur = 15 * glowIntensity;

        // Use a techy font for the number inside
        if (this.type === '☕') {
            ctx.font = '20px sans-serif';
        } else {
            ctx.font = this.type === ';' ? 'bold 22px "Fira Code", monospace' : 'bold 16px "Fira Code", monospace';
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.type, 0, 1);

        // Rotating ring
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(0, 0, radius - 6, time, time + Math.PI * 1.5);
        ctx.stroke();

        ctx.restore();
    }
}


// --- DYNAMIC ISLAND (iPhone 17+ Aesthetic) ---
const island = document.getElementById('dynamic-island');
const islandText = document.getElementById('island-text');
let islandTimeout;

function updateIsland(text, type = 'normal') {
    if (!island || !islandText) return;

    clearTimeout(islandTimeout);

    // Reset classes
    island.className = '';
    if (type === 'rank-up') island.classList.add('rank-up', 'expanding');
    else if (type === 'important') island.classList.add('expanding');

    islandText.innerText = text;

    // Pulse animation
    island.style.transform = 'scale(1.1)';
    setTimeout(() => {
        island.style.transform = 'scale(1)';
    }, 200);

    // Auto-shrink after 3 seconds if it was an important/rank-up message
    if (type !== 'normal') {
        islandTimeout = setTimeout(() => {
            island.className = '';
            islandText.innerText = isPaused ? 'SİSTEM DURAKLADI' : '';
        }, 3000);
    }
}

// --- UI & PROGRESSION ---
function updateUI() {
    // Score
    const score = Math.floor(distanceTraveled / 10);
    document.getElementById('score').innerText = score;
    document.getElementById('bits').innerText = bitsCollected;

    // Lives
    let hearts = '';
    const currentLives = (typeof player !== 'undefined') ? player.lives : 3;
    for (let i = 0; i < currentLives; i++) hearts += '❤️';
    const livesContainer = document.getElementById('lives-container');
    if (livesContainer) livesContainer.innerText = hearts;

    // Rank Update Logic
    let newRankIndex = currentRankIndex;
    for (let i = RANKS.length - 1; i >= 0; i--) {
        if (score >= RANKS[i].score) {
            newRankIndex = i;
            break;
        }
    }

    if (newRankIndex > currentRankIndex) {
        currentRankIndex = newRankIndex;
        updateIsland(`TERFİ: ${RANKS[currentRankIndex].title}!`, 'rank-up');
        showRankUp(RANKS[currentRankIndex]);
    }

    const rankBadge = document.getElementById('rank-badge');
    const rank = RANKS[currentRankIndex];
    rankBadge.innerText = rank.title;
    rankBadge.style.color = rank.color;
    rankBadge.style.borderColor = rank.color;
    rankBadge.style.boxShadow = `0 0 15px ${rank.color}40`; // 40 is hex opacity
}

function showRankUp(rank) {
    if (typeof audioCtx !== 'undefined' && audioCtx) {
        playSound('collect');
    }

    // Create floating text
    const div = document.createElement('div');
    div.innerText = `TERFİ: ${rank.title}!`;
    div.style.position = 'fixed';
    div.style.top = '20%';
    div.style.left = '50%';
    div.style.transform = 'translate(-50%, -50%) scale(0)';
    div.style.color = rank.color;
    div.style.fontFamily = '"Fira Code", monospace';
    div.style.fontSize = '3rem';
    div.style.fontWeight = 'bold';
    div.style.textShadow = `0 0 20px ${rank.color}`;
    div.style.zIndex = '1000';
    div.style.transition = 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    div.style.pointerEvents = 'none';

    document.body.appendChild(div);

    // Animate in
    setTimeout(() => div.style.transform = 'translate(-50%, -50%) scale(1)', 50);

    // Animate out
    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 500);
    }, 2000);
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

    // 3. GROUND LAYER
    const gGrad = ctx.createLinearGradient(0, groundY, 0, canvas.height);
    gGrad.addColorStop(0, 'rgba(13, 17, 23, 0.95)');
    gGrad.addColorStop(1, '#000');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);

    // Subtle Grid on ground
    ctx.strokeStyle = 'rgba(46, 160, 67, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width + 400; i += 100) {
        let gx = i - (cameraX * 1.0 % 100);
        ctx.beginPath();
        ctx.moveTo(gx, groundY);
        ctx.lineTo(gx - 150, canvas.height);
        ctx.stroke();
    }

    // 4. FOREGROUND OVERLAY
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, 50);
    ctx.restore();
}


// --- LEVEL INITIALIZATION ---
function initLevel() {
    isGameOver = false; isPaused = false; cameraX = 0; distanceTraveled = 0; bitsCollected = 0;
    platforms = [];
    enemies = [];
    collectibles = [];
    projectiles = [];
    particles = [];

    // Create initial platforms
    platforms.push(new Platform(0, groundY - 100, 400, 20, 'ram'));
    platforms.push(new Platform(500, groundY - 150, 250, 20, 'resistor'));
    platforms.push(new Platform(850, groundY - 200, 280, 20, 'capacitor'));

    player.reset();
    lastTimestamp = 0;
}

function generate() {
    const last = platforms[platforms.length - 1];
    if (last.x < cameraX + canvas.width + 1000) {
        const types = ['ram', 'resistor', 'capacitor'];
        const t = types[Math.floor(Math.random() * types.length)];
        const nx = last.x + 350 + Math.random() * 250;
        const ny = Math.max(canvas.height * 0.3, Math.min(canvas.height * 0.65, last.y + (Math.random() - 0.5) * 400));

        // Adjust size based on type
        let pw = 180 + Math.random() * 150;
        let ph = 20;
        if (t === 'capacitor') { pw = 70; ph = 80; }
        if (t === 'resistor') { pw = 120; ph = 30; }

        platforms.push(new Platform(nx, ny, pw, ph, t));

        if (Math.random() > 0.3) collectibles.push(new Collectible(nx + 50, ny - 60));

        // Variety Spawning
        const enemyRoll = Math.random();
        if (enemyRoll > 0.85) { // FLYER (In the air)
            enemies.push(new Enemy(nx + 400, ny - 100, 'flyer'));
        } else if (enemyRoll > 0.7) { // CRAWLER (On the ground)
            enemies.push(new Enemy(nx + 400, groundY - 40, 'crawler'));
        } else if (enemyRoll > 0.6) { // SCOUT (Fast on platforms)
            enemies.push(new Enemy(nx + 100, ny - 30, 'scout'));
        } else if (enemyRoll > 0.5) { // HEAVY (On ground)
            enemies.push(new Enemy(nx + 600, groundY - 55, 'heavy'));
        }
    }
    if (platforms[0].x < cameraX - 1500) platforms.shift();
}



function gameLoop(timestamp) {
    if (isPaused || isGameOver) return;

    if (!lastTimestamp) lastTimestamp = timestamp;
    const deltaTime = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // Cap deltaTime to avoid huge jumps
    const dt = Math.min(deltaTime, 32) / TIME_STEP;

    drawWorld();
    generate();

    particles = particles.filter(p => {
        p.update(dt);
        p.draw();
        return p.life > 0;
    });

    platforms.forEach(p => p.draw());
    projectiles = projectiles.filter(p => { p.update(dt); p.draw(); return p.l > 0; });

    enemies = enemies.filter(en => {
        en.update(dt);
        en.draw();

        if (!player) return true;

        const hitX = Math.abs((player.x + 15) - (en.x + en.w / 2)) < (en.w / 2 + 15);
        const hitY = Math.abs((player.y + 20) - (en.y + en.h / 2)) < (en.h / 2 + 20);

        if (!en.dead && hitX && hitY) {
            if (player.vy > 1 && player.y + player.height < en.y + 20) {
                player.vy = -12;
                en.dead = true;
                playSound('hit');
                return false;
            }
            player.hit();
        }

        projectiles.forEach(pr => {
            if (pr.l <= 0) return;
            const prHitX = Math.abs(pr.x - (en.x + en.w / 2)) < en.w / 2 + 10;
            const prHitY = Math.abs(pr.y - (en.y + en.h / 2)) < en.h / 2 + 10;
            if (prHitX && prHitY) {
                en.hp--;
                pr.l = 0;
                if (en.hp <= 0) {
                    en.dead = true;
                    playSound('kill');
                } else {
                    playSound('hit');
                    en.x += 5 * dt;
                }
            }
        });

        return !en.dead && en.x > cameraX - 100;
    });

    collectibles = collectibles.filter(c => {
        if (!player) return true;
        c.draw();
        if (Math.abs(player.x - c.x) < 30 && Math.abs(player.y - c.y) < 40) {
            let points = 0;
            if (c.type === '☕') {
                if (player.lives < 5) player.lives++;
                points = 20;
            } else if (c.type === ';') {
                points = 50;
            } else {
                points = 1;
            }
            bitsCollected += points;
            playSound('collect');
            return false;
        }
        return c.x > cameraX - 100;
    });

    if (player) {
        player.update(dt);
        player.draw();
    }
    updateUI();

    animationId = requestAnimationFrame(gameLoop);
}

// --- PWA INSTALLATION & ONBOARDING ---
let deferredPrompt;
const onboarding = document.getElementById('pwa-onboarding');
const installBtn = document.getElementById('btn-pwa-main');
const skipBtn = document.getElementById('btn-skip-pwa');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show splash only if app is not yet installed and we are at start
    onboarding.classList.remove('hidden');
    updateIsland('UYGULAMAYI KUR', 'important');
});

installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        updateIsland('SİSTEME KURULUYOR...');
    }
    deferredPrompt = null;
    onboarding.classList.add('hidden');
});

skipBtn.addEventListener('click', () => {
    onboarding.classList.add('hidden');
    updateIsland('WEB MODUNDA BAŞLATILDI');
});

window.addEventListener('appinstalled', () => {
    updateIsland('SİSTEME EKLENDİ!', 'rank-up');
    onboarding.classList.add('hidden');
});

// --- AUDIO & UI ---
let audioCtx;
let masterGainNode;
let bgmGainNode;
let isMuted = localStorage.getItem('codeman_muted') === 'true';
let isMusicMuted = localStorage.getItem('codeman_music_muted') === 'true';
let currentVolume = parseFloat(localStorage.getItem('codeman_vol')) || 0.5;
let musicVolume = parseFloat(localStorage.getItem('codeman_music_vol')) || 0.3;
let isBGMPlaying = false;

const initAudio = () => {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.value = currentVolume;
    masterGainNode.connect(audioCtx.destination);

    playBGM();
};

const playBGM = () => {
    if (!audioCtx || isBGMPlaying || isMusicMuted) return;

    bgmGainNode = audioCtx.createGain();
    bgmGainNode.gain.value = musicVolume;
    bgmGainNode.connect(audioCtx.destination);

    // 4-Bar Cyber Journey
    const melody = [
        261.63, 0, 329.63, 392.00, 523.25, 392.00, 329.63, 0,
        349.23, 0, 440.00, 523.25, 587.33, 523.25, 440.00, 0,
        392.00, 493.88, 587.33, 659.25, 783.99, 0, 659.25, 587.33,
        523.25, 0, 392.00, 0, 261.63, 261.63, 0, 0
    ];

    const bassline = [
        130.81, 130.81, 130.81, 130.81, 174.61, 174.61, 174.61, 174.61,
        196.00, 196.00, 196.00, 196.00, 130.81, 130.81, 130.81, 130.81
    ];

    let step = 0;
    const playSynth = (freq, startTime, type, vol, decay) => {
        if (!isBGMPlaying) return;
        try {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, startTime);
            g.gain.setValueAtTime(vol, startTime);
            g.gain.exponentialRampToValueAtTime(0.001, startTime + decay);
            osc.connect(g);
            g.connect(bgmGainNode);
            osc.start(startTime);
            osc.stop(startTime + decay);
        } catch (e) {
            console.error("Audio error:", e);
        }
    };

    let nextNoteTime = audioCtx.currentTime;
    isBGMPlaying = true;

    const sequence = () => {
        if (!isBGMPlaying || isMusicMuted) return;

        try {
            // Lead Melody (Square Wave)
            const freq = melody[step % melody.length];
            if (freq > 0) {
                playSynth(freq, nextNoteTime, 'square', 0.04, 0.2);
            }

            // Deep Bass (Triangle Wave every 2 steps)
            if (step % 2 === 0) {
                const bIdx = Math.floor(step / 2) % bassline.length;
                const bFreq = bassline[bIdx];
                playSynth(bFreq, nextNoteTime, 'triangle', 0.12, 0.35);
            }

            // Cyber Snare (White Noise-ish)
            if (step % 8 === 4) {
                playSynth(80, nextNoteTime, 'sawtooth', 0.03, 0.08);
            }

            step++;
            nextNoteTime += 0.15;

            // Scheduling catch-up logic
            let delay = (nextNoteTime - audioCtx.currentTime) * 1000;
            if (delay < 10) delay = 10; // Minimum delay

            // If fell too far behind, reset
            if (nextNoteTime < audioCtx.currentTime - 0.2) {
                nextNoteTime = audioCtx.currentTime + 0.1;
            }

            setTimeout(sequence, 150);
        } catch (e) {
            setTimeout(sequence, 150);
        }
    };

    sequence();
};

const stopBGM = () => {
    isBGMPlaying = false;
};

const playSound = (t) => {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const n = audioCtx.currentTime;

    // Connect to Master Gain instead of destination directly
    o.connect(g);
    g.connect(masterGainNode);

    if (t === 'jump') {
        o.type = 'sine';
        o.frequency.setValueAtTime(200, n);
        o.frequency.exponentialRampToValueAtTime(600, n + 0.1);
        g.gain.setValueAtTime(0.1, n);
        g.gain.exponentialRampToValueAtTime(0.01, n + 0.1);
        o.start(); o.stop(n + 0.1);
    }
    else if (t === 'shoot') {
        o.type = 'square';
        o.frequency.setValueAtTime(800, n);
        o.frequency.exponentialRampToValueAtTime(100, n + 0.15);
        g.gain.setValueAtTime(0.05, n);
        g.gain.exponentialRampToValueAtTime(0.01, n + 0.15);
        o.start(); o.stop(n + 0.15);
    }
    else if (t === 'hit') { // Damage but not dead
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(150, n);
        o.frequency.linearRampToValueAtTime(100, n + 0.05);
        g.gain.setValueAtTime(0.1, n);
        g.gain.exponentialRampToValueAtTime(0.01, n + 0.1);
        o.start(); o.stop(n + 0.1);
    }
    else if (t === 'kill') { // Enemy destroyed
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(100, n);
        o.frequency.exponentialRampToValueAtTime(10, n + 0.2);
        g.gain.setValueAtTime(0.15, n);
        g.gain.exponentialRampToValueAtTime(0.01, n + 0.2);
        o.start(); o.stop(n + 0.2);
    }
    else if (t === 'collect') {
        o.type = 'sine';
        o.frequency.setValueAtTime(1200, n);
        o.frequency.exponentialRampToValueAtTime(1800, n + 0.05);
        g.gain.setValueAtTime(0.05, n);
        g.gain.exponentialRampToValueAtTime(0.01, n + 0.1);
        o.start(); o.stop(n + 0.1);
    }
};

function gameOver() { isGameOver = true; playSound('hit'); overlay.classList.remove('hidden'); }

// --- INPUT HANDLING ---

// --- SMART MOBILE CONTROLS (Floating D-Pad & Action Regions) ---
const dpadContainer = document.getElementById('dpad-container');
const dpadButtons = dpadContainer.querySelectorAll('.dpad-btn');
// jumpBtn and shootBtn are already declared at the top

// We'll track which touch is doing what
let leftTouchId = null;
let rightTouchId = null;

const updateDpadState = (touchX, touchY, isInitial = false) => {
    if (touchX === null) {
        Object.keys(dpadState).forEach(k => dpadState[k] = false);
        dpadButtons.forEach(btn => btn.classList.remove('active'));
        dpadContainer.style.opacity = '0.15'; // Fade out even more when not in use
        return;
    }

    dpadContainer.style.opacity = '1';

    // 1. Dynamic Positioning: On initial touch, move the D-Pad to that spot
    if (isInitial) {
        const dpadWidth = dpadContainer.offsetWidth;
        const dpadHeight = dpadContainer.offsetHeight;
        dpadContainer.style.left = (touchX - dpadWidth / 2) + 'px';
        dpadContainer.style.bottom = (window.innerHeight - touchY - dpadHeight / 2) + 'px';
    }

    // 2. Relative Direction Detection
    Object.keys(dpadState).forEach(k => dpadState[k] = false);
    dpadButtons.forEach(btn => btn.classList.remove('active'));

    const rect = dpadContainer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = touchX - centerX;
    const dy = touchY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 15) { // Deadzone
        const angle = Math.atan2(dy, dx);
        const segment = (Math.round(angle / (Math.PI / 2)) + 4) % 4;

        // 0: Right, 1: Down, 2: Left, 3: Up (atan2 starts from right, goes clockwise in screen space)
        let dir = null;
        if (segment === 0) dir = 'right';
        else if (segment === 1) dir = 'down';
        else if (segment === 2) dir = 'left';
        else if (segment === 3) dir = 'up';

        if (dir) {
            if (!dpadState[dir] && "vibrate" in navigator) navigator.vibrate(10);
            dpadState[dir] = true;
            document.getElementById(`dpad-${dir}`).classList.add('active');
        }
    }
};

const createTouchFeedback = (x, y, label, color) => {
    const feedback = document.createElement('div');
    feedback.className = 'touch-feedback';
    feedback.style.left = x + 'px';
    feedback.style.top = y + 'px';
    feedback.style.color = color;
    feedback.innerHTML = `
        <div class="touch-ring"></div>
        <div class="touch-label">${label}</div>
    `;
    document.body.appendChild(feedback);
    setTimeout(() => feedback.remove(), 400);
};

const handleGlobalTouch = (e) => {
    const target = e.target;
    // CRITICAL FIX: Allow default behavior for UI elements (Buttons, Inputs, Modals)
    if (target.closest('button') || target.closest('.modal') || target.closest('input') || target.closest('.icon-btn') || target.closest('.close-btn')) {
        return;
    }

    initAudio();
    if (e.cancelable) e.preventDefault();
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
        const touch = touches[i];
        const tx = touch.clientX;
        const ty = touch.clientY;
        const isLeftHalf = tx < window.innerWidth / 2;

        if (e.type === 'touchstart') {
            if (isLeftHalf && leftTouchId === null) {
                leftTouchId = touch.identifier;
                updateDpadState(tx, ty, true);
            } else if (!isLeftHalf) {
                // Right Half: Action Zones
                if (ty > window.innerHeight * 0.4) {
                    player.jump();
                    createTouchFeedback(tx, ty, '[ JMP ]', '#3fb950');
                    document.querySelector('.jump-zone').style.opacity = '0.6';
                    if ("vibrate" in navigator) navigator.vibrate(15);
                } else {
                    player.shoot();
                    createTouchFeedback(tx, ty, '[ EXE ]', '#f85149');
                    document.querySelector('.shoot-zone').style.opacity = '0.6';
                    if ("vibrate" in navigator) navigator.vibrate(5);
                }
            }
        }
        else if (e.type === 'touchmove') {
            if (touch.identifier === leftTouchId) {
                updateDpadState(tx, ty);
            }
        }
        else if (e.type === 'touchend' || e.type === 'touchcancel') {
            if (touch.identifier === leftTouchId) {
                leftTouchId = null;
                updateDpadState(null, null);
            } else if (tx >= window.innerWidth / 2) {
                document.querySelector('.jump-zone').style.opacity = '0.15';
                document.querySelector('.shoot-zone').style.opacity = '0.15';
            }
        }
    }
};

window.addEventListener('touchstart', handleGlobalTouch, { passive: false });
window.addEventListener('touchmove', handleGlobalTouch, { passive: false });
window.addEventListener('touchend', handleGlobalTouch, { passive: false });
window.addEventListener('touchcancel', handleGlobalTouch, { passive: false });

// Mouse support for desktop testing (Simulate Left/Right halves)
window.addEventListener('mousedown', (e) => {
    // Ignore if clicking UI
    if (e.target.closest('.icon-btn') || e.target.closest('.modal') || e.target.closest('.close-btn') || e.target.closest('input')) {
        return;
    }

    initAudio();
    const isLeft = e.clientX < window.innerWidth / 2;
    if (isLeft) {
        updateDpadState(e.clientX, e.clientY, true);
        const mm = (me) => updateDpadState(me.clientX, me.clientY);
        const mu = () => {
            updateDpadState(null, null);
            window.removeEventListener('mousemove', mm);
            window.removeEventListener('mouseup', mu);
        };
        window.addEventListener('mousemove', mm);
        window.addEventListener('mouseup', mu);
    } else {
        if (e.clientY > window.innerHeight * 0.4) player.jump();
        else player.shoot();
    }
});

window.addEventListener('keydown', e => {
    initAudio();
    keys[e.key] = true;

    // Jump Controls
    if (e.key === ' ' || e.key === 'w' || e.key === 'ArrowUp') {
        player.jump();
        if (e.key === ' ') e.preventDefault();
    }

    // Shoot Controls
    if (e.key === 'f' || e.key === 'e') player.shoot();

    // Pause Control
    if (e.key === 'p' || e.key === 'P') {
        pauseBtn.click(); // Simulate click on pause button to reuse logic
    }
});
window.addEventListener('keyup', e => keys[e.key] = false);

const pauseBtn = document.getElementById('btn-pause');
pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.innerText = isPaused ? '▶' : '⏸';
    updateIsland(isPaused ? 'SİSTEM DURAKLADI' : '');

    if (!isPaused) {
        lastTimestamp = 0;
        animationId = requestAnimationFrame(gameLoop);
        playBGM();
    } else {
        cancelAnimationFrame(animationId);
        stopBGM();
    }
});

// Skin selection
document.querySelectorAll('.color-opt').forEach(opt => {
    opt.addEventListener('click', () => {
        const selectedColor = opt.dataset.color;

        // Update UI
        document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');

        // Update Player & Persist
        if (player) {
            player.color = selectedColor;
            // Force Redraw if paused
            if (isPaused) {
                drawWorld();
                platforms.forEach(p => p.draw());
                player.draw();
            }
        }
        localStorage.setItem('codeman_player_color', selectedColor);

        // Feedback
        if (typeof audioCtx !== 'undefined') playSound('collect');
    });
});


// Audio Settings Controls
const volSlider = document.getElementById('volume-slider');
const muteBtn = document.getElementById('btn-mute');
const musicSlider = document.getElementById('music-slider');
const musicMuteBtn = document.getElementById('btn-music-mute');

// Sync UI with stored values
volSlider.value = currentVolume * 100;
musicSlider.value = musicVolume * 100;
if (isMuted) { muteBtn.classList.add('muted'); muteBtn.innerText = '🔇'; }
if (isMusicMuted) { musicMuteBtn.classList.add('muted'); musicMuteBtn.innerText = '❌'; }

volSlider.addEventListener('input', (e) => {
    currentVolume = e.target.value / 100;
    if (masterGainNode && !isMuted) masterGainNode.gain.value = currentVolume;
    localStorage.setItem('codeman_vol', currentVolume);
    if (currentVolume > 0 && isMuted) {
        isMuted = false;
        muteBtn.classList.remove('muted');
        muteBtn.innerText = '🔊';
        localStorage.setItem('codeman_muted', false);
    }
});

muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    localStorage.setItem('codeman_muted', isMuted);
    if (isMuted) {
        muteBtn.classList.add('muted');
        muteBtn.innerText = '🔇';
        if (masterGainNode) masterGainNode.gain.value = 0;
    } else {
        muteBtn.classList.remove('muted');
        muteBtn.innerText = '🔊';
        if (masterGainNode) masterGainNode.gain.value = currentVolume;
    }
});

musicSlider.addEventListener('input', (e) => {
    musicVolume = e.target.value / 100;
    if (bgmGainNode) bgmGainNode.gain.value = musicVolume;
    localStorage.setItem('codeman_music_vol', musicVolume);
    if (musicVolume > 0 && isMusicMuted) {
        isMusicMuted = false;
        musicMuteBtn.classList.remove('muted');
        musicMuteBtn.innerText = '🎵';
        localStorage.setItem('codeman_music_muted', false);
        playBGM();
    }
});

musicMuteBtn.addEventListener('click', () => {
    isMusicMuted = !isMusicMuted;
    localStorage.setItem('codeman_music_muted', isMusicMuted);
    if (isMusicMuted) {
        musicMuteBtn.classList.add('muted');
        musicMuteBtn.innerText = '❌';
        stopBGM();
    } else {
        musicMuteBtn.classList.remove('muted');
        musicMuteBtn.innerText = '🎵';
        playBGM();
    }
});

const infoBtn = document.getElementById('btn-info');
const infoModal = document.getElementById('info-modal');

infoBtn.addEventListener('click', () => {
    isPaused = true;
    updateIsland('DURUM: BİLGİ');
    infoModal.classList.remove('hidden');
});

document.getElementById('btn-close-info').addEventListener('click', () => {
    infoModal.classList.add('hidden');
    // Only unpause if game is not over and we were not paused from pause button
    if (!isGameOver) {
        overlay.classList.add('hidden');
        isPaused = false;
        updateIsland('');
        lastTimestamp = 0;
        animationId = requestAnimationFrame(gameLoop);
        playBGM();
    }
});

document.getElementById('btn-close-custom').addEventListener('click', () => {
    document.getElementById('customizer').classList.add('hidden');
    overlay.classList.add('hidden');

    if (!isGameOver) {
        isPaused = false;
        updateIsland('');
        lastTimestamp = 0;
        animationId = requestAnimationFrame(gameLoop);
        playBGM();
    }
});

const settingsFixedBtn = document.getElementById('btn-settings-fixed');
settingsFixedBtn.addEventListener('click', () => {
    if (isGameOver) return;

    isPaused = true;
    cancelAnimationFrame(animationId);
    stopBGM();

    updateIsland('SİSTEM AYARLARI', 'important');

    // Set active color in UI based on player's current color
    const currentColor = (player && player.color) ? player.color : localStorage.getItem('codeman_player_color') || THEME.glowCyan;
    document.querySelectorAll('.color-opt').forEach(opt => {
        if (opt.dataset.color === currentColor) {
            opt.classList.add('active');
        } else {
            opt.classList.remove('active');
        }
    });

    document.getElementById('customizer').classList.remove('hidden');
    overlay.classList.remove('hidden');
});

document.getElementById('btn-restart').addEventListener('click', () => {
    overlay.classList.add('hidden');
    initLevel();
    animationId = requestAnimationFrame(gameLoop);
});

function gameOver() {
    isGameOver = true;
    cancelAnimationFrame(animationId); // Stop the loop immediately
    playSound('hit');

    const overlay = document.getElementById('overlay');
    const modal = document.querySelector('#overlay .modal');

    overlay.classList.remove('hidden');
    modal.classList.remove('hidden'); // Ensure content is visible

    document.querySelector('.modal h1').innerText = 'KRİTİK HATA';
    document.getElementById('final-score').innerText = 'Toplam Satır: ' + Math.floor(distanceTraveled / 10);

    // Ensure Game Over specific buttons are shown if they were hidden by settings
    const gameOverButtons = document.querySelector('.menu-btns');
    if (gameOverButtons) gameOverButtons.classList.remove('hidden');
}

// --- DYNAMIC FAVICON ---
function setFavicon() {
    const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
    link.type = 'image/x-icon';
    link.rel = 'shortcut icon';

    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');

    // Draw Background Circle
    x.fillStyle = '#161b22';
    x.beginPath(); x.arc(32, 32, 32, 0, Math.PI * 2); x.fill();

    // Draw Monitor Head
    x.translate(32, 32);
    x.scale(1.5, 1.5);

    // Case
    x.fillStyle = '#0d1117';
    x.beginPath(); x.roundRect(-15, -13, 30, 24, 5); x.fill();

    // Gradient
    const g = x.createLinearGradient(-14, -14, 14, 10);
    g.addColorStop(0, '#444c56'); g.addColorStop(1, '#161b22');
    x.fillStyle = g;
    x.beginPath(); x.roundRect(-14, -14, 28, 24, 5); x.fill();

    // Screen (Green)
    x.fillStyle = '#000';
    x.beginPath(); x.roundRect(-11, -11, 22, 18, 3); x.fill();

    // Face
    x.fillStyle = '#2ea043'; // Green
    x.font = 'bold 12px monospace';
    x.textAlign = 'center';
    x.fillText('^_^', 0, 2);

    link.href = c.toDataURL();
    document.getElementsByTagName('head')[0].appendChild(link);
}

// Initialize Everything
let player;

function startGame() {
    player = new Player();
    initLevel();
    if (typeof setFavicon === 'function') setFavicon();
    updateUI();
    // iPhone-style Game Mode Activation
    setTimeout(() => {
        updateIsland('OYUN MODU: AKTİF', 'important');
        // Visual 'Game Mode' feedback: Brief Flash
        const canvas = document.getElementById('gameCanvas');
        canvas.style.filter = 'brightness(1.5) saturate(1.2)';
        setTimeout(() => canvas.style.filter = '', 500);
    }, 500);
    // Start game loop
    lastTimestamp = 0;
    requestAnimationFrame(gameLoop);
}

// Start everything when the window loads
window.onload = startGame;
