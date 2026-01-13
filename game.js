const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

window.onerror = function (msg, url, line) {
    console.error("DEBUG ERROR: ", msg, " at ", line);
    // On mobile, sometimes console log is hidden, so alert for critical errors
    if (!url.includes('google') && !url.includes('analytics')) {
        alert("SİSTEM HATASI: " + msg + "\nSatır: " + line);
    }
};

// --- POLYFILLS ---
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height, radius) {
        if (typeof radius === 'undefined') radius = 0;
        if (typeof radius === 'number') radius = { tl: radius, tr: radius, br: radius, bl: radius };
        else radius = { ...{ tl: 0, tr: 0, br: 0, bl: 0 }, ...radius };

        // Non-destructive: DO NOT call beginPath() or closePath() here
        // as standard roundRect doesn't. It just adds to current path.
        this.moveTo(x + radius.tl, y);
        this.lineTo(x + width - radius.tr, y);
        this.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
        this.lineTo(x + width, y + height - radius.br);
        this.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
        this.lineTo(x + radius.bl, y + height);
        this.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
        this.lineTo(x, y + radius.tl);
        this.quadraticCurveTo(x, y, x + radius.tl, y);
        return this;
    };
}
// --- GLOBALS (Using var to avoid TDZ on legacy iOS) ---
var scoreElement, bitsElement, finalScoreElement, overlay, restartBtn;
var joystickBase, joystickStick, shootBtn, jumpBtn;
// island related globals removed
console.log("Sistem Versiyonu: 2.1.3 (UI Refinement)");

// updateIsland removed

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
let joystickActive = false;
let joystickX = 0;
let joystickY = 0;
let joystickCenter = { x: 0, y: 0 };
const keys = {};

// --- BACKGROUND IMAGE LOADING ---
const bgImg = new Image();
bgImg.src = 'motherboard_bg.png';
let bgLoaded = false;
bgImg.onload = () => { bgLoaded = true; console.log("Arka plan yüklendi."); };
bgImg.onerror = () => { console.error("Arka plan yüklenemedi: motherboard_bg.png"); bgLoaded = false; };

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
            console.log('LÜTFEN CİHAZI ÇEVİRİN');
        }
    } else {
        warning.classList.add('hidden');
        // Auto-resume only if it was paused by orientation
        if (isPaused && pausedByOrientation && !isGameOver) {
            isPaused = false;
            pausedByOrientation = false;
            document.getElementById('btn-pause').innerText = '⏸';
            console.log('SİSTEM HAZIR!');
            lastTimestamp = 0;
            requestAnimationFrame(gameLoop);
        }
    }
}
window.addEventListener('resize', resize);
// Initial resize will be called inside startGame or window.onload to ensure DOM and variables are ready

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
        if (!this.color) this.color = THEME.glowCyan;

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
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);
        ctx.scale(this.width / 30, this.height / 45); // Scale drawing to match hitbox

        // Flash when hurt
        if (this.invulnerable > 0) {
            if (Math.floor(Date.now() / 100) % 2 === 0) ctx.globalAlpha = 0.5;
        }

        const pulse = Math.sin(Date.now() / 200) * 0.15 + 0.85;
        const color = this.color;
        const isMoving = Math.abs(this.vx) > 0.5;

        // --- DYNAMIC SQUASH & STRETCH ---
        let scaleY = 1;
        let offsetY = 0;
        if (this.ducking) { scaleY = 0.6; offsetY = 15; }
        else if (this.lookingUp) { scaleY = 1.1; offsetY = -5; }

        // --- IMPACT SHADOW (Safe calculation) ---
        ctx.save();
        // Prevent negative scale which crashes some browsers
        const shadowScale = Math.max(0, (1 - (Math.abs(this.vy) / 20))) * (this.ducking ? 1.2 : 1);
        ctx.globalAlpha = (this.invulnerable > 0 ? 0.3 : 1) * 0.3 * shadowScale; // Combine alphas
        ctx.fillStyle = '#000';
        const shadowY = Math.max(0, groundY - this.y - this.height);
        ctx.beginPath();
        ctx.ellipse(this.width / 2, this.height + shadowY, Math.max(0, 20 * shadowScale), Math.max(0, 5 * shadowScale), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (this.facing === -1) { ctx.scale(-1, 1); ctx.translate(-this.width, 0); }

        ctx.save();
        ctx.translate(0, offsetY);
        ctx.scale(1, scaleY);

        // --- CYBER SUIT BODY (With Volume) ---
        const bodyGrad = ctx.createLinearGradient(0, 18, 25, 18);
        bodyGrad.addColorStop(0, '#2d333b');
        bodyGrad.addColorStop(0.5, '#1a1f28');
        bodyGrad.addColorStop(1, '#0d1117');

        ctx.fillStyle = bodyGrad;
        ctx.strokeStyle = '#444c56';
        ctx.lineWidth = 1;

        // Shoulder Pads (Adding Volume)
        ctx.beginPath();
        ctx.roundRect(0, 16, 10, 8, 2); // Left shoulder
        ctx.roundRect(20, 16, 10, 8, 2); // Right shoulder
        ctx.fill();
        ctx.stroke();

        // Main Torso
        ctx.beginPath();
        ctx.roundRect(5, 18, 20, 18, 4);
        ctx.fill();
        ctx.stroke();

        // Glow Core (Power indicator)
        ctx.save();
        ctx.globalAlpha = 0.6 * pulse;
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(15, 27, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // --- PROPULSION (HOVER THRUSTER - 3D Plate) ---
        const moveFact = Math.abs(this.vx) / MAX_SPEED;

        // Thruster Base (Metallic Rim)
        ctx.fillStyle = '#444c56';
        ctx.beginPath();
        ctx.roundRect(0, 34, 30, 8, 3);
        ctx.fill();

        // Bottom Plate
        ctx.fillStyle = '#161b22';
        ctx.beginPath();
        ctx.roundRect(4, 36, 22, 4, 1);
        ctx.fill();

        // Thruster Glow
        const thrusterPower = (this.vy < 0 || isMoving) ? 1 : 0.3;
        const beamHeight = 15 * thrusterPower * pulse;

        ctx.save();
        ctx.globalAlpha = 0.5 * thrusterPower;
        const beamGrad = ctx.createLinearGradient(0, 42, 0, 42 + beamHeight);
        beamGrad.addColorStop(0, color);
        beamGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = beamGrad;
        ctx.fillRect(8, 42, 14, beamHeight);
        ctx.restore();

        // --- MONITOR HEAD (3D Curved Monitor) ---
        ctx.save();
        const bob = Math.sin(Date.now() / 150) * 1.5;
        ctx.translate(15, 10 + bob);

        // Case Depth/Side
        ctx.fillStyle = '#0d1117';
        ctx.beginPath();
        ctx.roundRect(-15, -13, 30, 24, 5);
        ctx.fill();

        // Main Casing Grad
        const caseGrad = ctx.createLinearGradient(-14, -14, 14, 10);
        caseGrad.addColorStop(0, '#444c56');
        caseGrad.addColorStop(0.4, '#2d333b');
        caseGrad.addColorStop(1, '#161b22');

        ctx.fillStyle = caseGrad;
        ctx.beginPath();
        ctx.roundRect(-14, -14, 28, 24, 5);
        ctx.fill();

        // Bevel Highlight
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-13.5, -13.5, 27, 23);

        // Screen (CRT/Curved Effect)
        ctx.shadowBlur = 15 * pulse;
        ctx.shadowColor = color;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.roundRect(-11, -11, 22, 18, 3);
        ctx.fill();

        // Screen Content (Face/Expression)
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';

        let expression = '>_';
        if (!this.onGround) expression = '^o^';
        else if (this.ducking) expression = 'U_U';
        else if (this.lookingUp) expression = '0.0';
        else if (isMoving) expression = '>.<';
        else expression = '^_^';
        ctx.fillText(expression, 0, 2);

        // Glass Reflection (Clearer Gloss)
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(-9, -9);
        ctx.lineTo(0, -9);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-12, -2);
        ctx.fill();

        ctx.restore(); // Restore Head

        ctx.restore(); // Restore Squash/Stretch
        ctx.restore(); // Restore Main
    }
    update(dt) {
        if (this.invulnerable > 0) this.invulnerable--;
        if (this.shootCooldown > 0) this.shootCooldown--;

        // Analog movement input
        let moveX = 0;
        let moveY = 0;

        if (keys['ArrowRight'] || keys['d']) moveX = 1;
        else if (keys['ArrowLeft'] || keys['a']) moveX = -1;

        if (keys['ArrowDown'] || keys['s']) moveY = 1;
        else if (keys['ArrowUp'] || keys['w']) moveY = -1;

        if (joystickActive) {
            moveX = joystickX;
            moveY = joystickY;
        }

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
    if (onboarding) onboarding.classList.remove('hidden');
    console.log('UYGULAMAYI KUR');
});

installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        console.log('SİSTEME KURULUYOR...');
    }
    deferredPrompt = null;
    onboarding.classList.add('hidden');
});

skipBtn.addEventListener('click', () => {
    onboarding.classList.add('hidden');
    console.log('WEB MODUNDA BAŞLATILDI');
});

window.addEventListener('appinstalled', () => {
    console.log('SİSTEME EKLENDİ!');
    onboarding.classList.add('hidden');
});

// --- AUDIO & UI ---
let audioCtx;
let masterGainNode;
let bgmOscillator;
let bgmGainNode;
let isMuted = false;
let currentVolume = 0.5;
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
    if (!audioCtx || isBGMPlaying || isMuted) return;

    bgmGainNode = audioCtx.createGain();
    bgmGainNode.gain.value = 0.1;
    bgmGainNode.connect(masterGainNode);

    const playNote = (segments, startTime) => {
        if (!isBGMPlaying) return;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(segments[0], startTime);
        g.gain.setValueAtTime(0.05, startTime);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);
        osc.connect(g);
        g.connect(bgmGainNode);
        osc.start(startTime);
        osc.stop(startTime + 0.5);
    };

    let time = audioCtx.currentTime;
    const sequence = () => {
        if (!isBGMPlaying || isMuted) return;
        const notes = [110, 110, 123, 146, 110, 110, 164, 146]; // More melodic
        notes.forEach((n, i) => playNote([n], time + i * 0.4)); // Slightly slower
        time += notes.length * 0.4;
        setTimeout(sequence, notes.length * 400);
    };

    isBGMPlaying = true;
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

// gameOver defined later

// --- INPUT HANDLING ---

const updateJoystick = (e) => {
    if (!joystickActive) return;

    const touch = e.touches ? e.touches[0] : e;

    let diffX = touch.clientX - joystickCenter.x;
    let diffY = touch.clientY - joystickCenter.y;

    const dist = Math.sqrt(diffX * diffX + diffY * diffY);
    const maxDist = 60; // Updated for 120px base (120/2)

    if (dist > maxDist) {
        diffX *= maxDist / dist;
        diffY *= maxDist / dist;
    }

    // Visual stick movement
    joystickStick.style.transform = `translate(calc(-50% + ${diffX}px), calc(-50% + ${diffY}px))`;

    // Analog values
    joystickX = diffX / maxDist;
    joystickY = diffY / maxDist;

    if (e.cancelable) e.preventDefault();
};

const startJoystick = (e) => {
    initAudio(); // Unlock audio on first touch
    
    // Ensure elements are ready
    if (!joystickBase || !jumpBtn || !shootBtn) initDOMElements();
    if (!joystickBase) return;

    const touch = e.touches ? e.touches[0] : e;
    const rect = joystickBase.getBoundingClientRect();

    if (e.target === joystickBase || joystickBase.contains(e.target)) {
        joystickActive = true;
        joystickCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        updateJoystick(e);
        if (e.cancelable) e.preventDefault();
    }

    if (e.target === jumpBtn || jumpBtn.contains(e.target)) {
        player.jump();
        if (e.cancelable) e.preventDefault();
    }
    if (e.target === shootBtn || shootBtn.contains(e.target)) {
        player.shoot();
        if (e.cancelable) e.preventDefault();
    }
    initAudio();
};

const stopJoystick = () => {
    joystickActive = false;
    joystickX = 0;
    joystickY = 0;
    joystickStick.style.transform = `translate(-50%, -50%)`;
};

window.addEventListener('touchstart', startJoystick, { passive: false });
window.addEventListener('touchmove', updateJoystick, { passive: false });
window.addEventListener('touchend', stopJoystick);

window.addEventListener('mousedown', startJoystick);
window.addEventListener('mousemove', updateJoystick);
window.addEventListener('mouseup', stopJoystick);

window.addEventListener('keydown', e => {
    initAudio();
    keys[e.key] = true;

    // Jump Controls
    if (e.key === ' ' || e.key === 'w' || e.key === 'ArrowUp') {
        player.jump();
        if (e.key === ' ') e.preventDefault(); // Prevent scrolling/clicking focused buttons
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
        document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        player.color = opt.dataset.color;
    });
});


// Audio Settings Controls
const volSlider = document.getElementById('volume-slider');
const muteBtn = document.getElementById('btn-mute');

volSlider.addEventListener('input', (e) => {
    currentVolume = e.target.value / 100;
    if (masterGainNode && !isMuted) masterGainNode.gain.value = currentVolume;
    if (currentVolume > 0 && isMuted) {
        isMuted = false;
        muteBtn.classList.remove('muted');
        muteBtn.innerText = '🔊';
    }
});

muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
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

const infoBtn = document.getElementById('btn-info');
const infoModal = document.getElementById('info-modal');

infoBtn.addEventListener('click', () => {
    isPaused = true;
    infoModal.classList.remove('hidden');
});

document.getElementById('btn-close-info').addEventListener('click', () => {
    infoModal.classList.add('hidden');
    // Only unpause if game is not over and we were not paused from pause button
    if (!isGameOver) {
        overlay.classList.add('hidden');
        isPaused = false;
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

    document.getElementById('customizer').classList.remove('hidden');
    overlay.classList.remove('hidden');
});

document.getElementById('btn-restart').addEventListener('click', () => {
    initAudio();
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

function initDOMElements() {
    scoreElement = document.getElementById('score');
    bitsElement = document.getElementById('bits');
    finalScoreElement = document.getElementById('final-score');
    overlay = document.getElementById('overlay');
    restartBtn = document.getElementById('btn-restart');
    joystickBase = document.getElementById('joystick-base');
    joystickStick = document.getElementById('joystick-stick');
    shootBtn = document.getElementById('btn-shoot');
    jumpBtn = document.getElementById('btn-jump');
}

function startGame() {
    initDOMElements();
    resize();
    player = new Player();
    initLevel();
    if (typeof setFavicon === 'function') setFavicon();
    updateUI();

    setTimeout(() => {
        if (canvas) {
            canvas.style.filter = 'brightness(1.5) saturate(1.2)';
            setTimeout(() => canvas.style.filter = '', 500);
        }
    }, 500);

    lastTimestamp = 0;
    requestAnimationFrame(gameLoop);
}

if (document.readyState === 'complete') {
    startGame();
} else {
    window.addEventListener('load', startGame);
}
