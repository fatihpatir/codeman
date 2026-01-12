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

// --- CONSTANTS (Sharper Physics) ---
const GRAVITY = 0.8;
const FRICTION = 0.85;
const JUMP_FORCE = -15;
const ACCELERATION = 1.2;
const MAX_SPEED = 10;

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

let groundY = window.innerHeight * 0.75;

let isGameOver = false;
let isPaused = false;
let cameraX = 0;
let distanceTraveled = 0;
let bitsCollected = 0;
let platforms = [];
let enemies = [];
let collectibles = [];
let projectiles = [];
let animationId;

// --- INPUT HANDLING STATE ---
let joystickActive = false;
let joystickX = 0;
let joystickY = 0;
let joystickCenter = { x: 0, y: 0 };
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
    groundY = canvas.height * 0.75;
}
window.addEventListener('resize', resize);
resize();

// --- PLAYER ---
class Player {
    constructor() { this.reset(); }
    reset() {
        this.width = 30; this.height = 45;
        this.x = 200; this.y = canvas.height * 0.7;
        this.vx = 0; this.vy = 0;
        this.onGround = false; this.doubleJumpAvailable = true;
        this.facing = 1; this.shootCooldown = 0;
        this.ducking = false; this.lookingUp = false;
        // Keep current color if it exists, otherwise default
        if (!this.color) this.color = THEME.glowCyan;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);

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
        ctx.globalAlpha = 0.3 * shadowScale;
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
    update() {
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
            this.vx += moveX * ACCELERATION;
            const currentMaxSpeed = MAX_SPEED * Math.abs(moveX);
            if (Math.abs(this.vx) > currentMaxSpeed) this.vx *= 0.95;
            this.facing = moveX > 0 ? 1 : -1;
        } else {
            this.vx *= FRICTION;
        }

        // Vertical Movement (Ducking / Looking Up)
        this.ducking = moveY > 0.5;
        this.lookingUp = moveY < -0.5;

        this.vy += GRAVITY;
        this.x += this.vx;
        this.y += this.vy;

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
    }
    jump() {
        if (this.onGround) { this.vy = JUMP_FORCE; this.onGround = false; playSound('jump'); }
        else if (this.doubleJumpAvailable) { this.vy = JUMP_FORCE * 0.85; this.doubleJumpAvailable = false; playSound('jump'); }
    }
    shoot() {
        if (this.shootCooldown > 0) return;

        // Base shooting position (middle of torso)
        let spawnY = this.y + 20;
        let pvx = this.facing * 16;
        let pvy = 0;

        // Dynamic Aiming
        if (this.ducking) {
            spawnY = this.y + 32; // Lower spawn height
            pvy = 4;              // Shoot diagonally down
        } else if (this.lookingUp) {
            spawnY = this.y + 10; // Higher spawn height
            pvy = -4;             // Shoot diagonally up
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
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.l--;
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

    update() {
        this.x += this.vx;
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



function gameLoop() {
    if (isGameOver || isPaused) return;
    drawWorld();
    generate();

    platforms.forEach(p => p.draw());
    projectiles = projectiles.filter(p => { p.update(); p.draw(); return p.l > 0; });

    enemies = enemies.filter(en => {
        en.update();
        en.draw();

        // Improved Collision for all sizes
        const hitX = Math.abs((player.x + 15) - (en.x + en.w / 2)) < (en.w / 2 + 15);
        const hitY = Math.abs((player.y + 20) - (en.y + en.h / 2)) < (en.h / 2 + 20);

        if (!en.dead && hitX && hitY) {
            // Jump on head mechanic (only for non-flyers or based on vertical velocity)
            if (player.vy > 1 && player.y + player.height < en.y + 20) {
                player.vy = -12;
                en.dead = true;
                playSound('hit');
                return false;
            }
            gameOver();
        }

        projectiles.forEach(pr => {
            if (pr.l <= 0) return;
            const prHitX = Math.abs(pr.x - (en.x + en.w / 2)) < en.w / 2 + 10;
            const prHitY = Math.abs(pr.y - (en.y + en.h / 2)) < en.h / 2 + 10;
            if (prHitX && prHitY) {
                en.hp--;
                pr.l = 0; // Destroy projectile

                if (en.hp <= 0) {
                    en.dead = true;
                    playSound('kill'); // New kill sound
                } else {
                    playSound('hit'); // Damage sound
                    // Visual feedback for hit
                    en.x += 5;
                }
            }
        });

        return !en.dead && en.x > cameraX - 100;
    });

    collectibles = collectibles.filter(c => {
        c.draw();
        if (Math.abs(player.x - c.x) < 30 && Math.abs(player.y - c.y) < 40) {
            bitsCollected++;
            bitsElement.innerText = bitsCollected;
            playSound('collect');
            return false;
        }
        return c.x > cameraX - 100;
    });

    player.update(); player.draw();
    animationId = requestAnimationFrame(gameLoop);
}

// --- AUDIO & UI ---
let audioCtx;
const initAudio = () => { if (audioCtx) return; audioCtx = new (window.AudioContext || window.webkitAudioContext)(); };
const playSound = (t) => {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const n = audioCtx.currentTime;

    o.connect(g); g.connect(audioCtx.destination);

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

const updateJoystick = (e) => {
    if (!joystickActive) return;

    const touch = e.touches ? e.touches[0] : e;

    let diffX = touch.clientX - joystickCenter.x;
    let diffY = touch.clientY - joystickCenter.y;

    const dist = Math.sqrt(diffX * diffX + diffY * diffY);
    const maxDist = 70; // 140 / 2

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
    if (e.key === ' ' || e.key === 'w' || e.key === 'ArrowUp') player.jump();
    if (e.key === 'f' || e.key === 'e') player.shoot();
});
window.addEventListener('keyup', e => keys[e.key] = false);

const pauseBtn = document.getElementById('btn-pause');
pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.innerText = isPaused ? '▶' : '⏸';
    document.getElementById('status').innerText = isPaused ? 'STATUS: PAUSED' : 'STATUS: RUNNING...';
    if (!isPaused) gameLoop();
});

// Skin selection
document.querySelectorAll('.color-opt').forEach(opt => {
    opt.addEventListener('click', () => {
        document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        player.color = opt.dataset.color;
    });
});

document.getElementById('btn-close-custom').addEventListener('click', () => {
    document.getElementById('customizer').classList.add('hidden');
    // Only hide overlay if we are not in a game over state
    if (!isGameOver) {
        overlay.classList.add('hidden');
        isPaused = false;
        document.getElementById('status').innerText = 'STATUS: RUNNING...';
        gameLoop();
    } else {
        document.querySelector('.modal h1').parentElement.classList.remove('hidden');
    }
});

const settingsFixedBtn = document.getElementById('btn-settings-fixed');
settingsFixedBtn.addEventListener('click', () => {
    isPaused = true;
    document.getElementById('status').innerText = 'STATUS: SETTINGS';
    document.getElementById('customizer').classList.remove('hidden');
    overlay.classList.remove('hidden');
    // Hide game over stuff if it was open
    const gameOverContent = document.querySelector('.modal h1').parentElement;
    if (gameOverContent) gameOverContent.classList.add('hidden');
});

function initLevel() {
    isGameOver = false; isPaused = false; cameraX = 0; distanceTraveled = 0; bitsCollected = 0;
    platforms = [new Platform(0, canvas.height * 0.7, 600, 20, 'pipe')];
    player.reset(); gameLoop();
}

const player = new Player();
initLevel();
