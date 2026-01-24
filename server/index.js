const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const speakeasy = require('speakeasy');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

function getAdminPasswordFromRequest(req) {
  const fromHeader =
    req.headers['x-admin-password'] ||
    req.headers['x-admin-pass'] ||
    req.headers['admin-password'];
  const fromBody = req.body?.adminPassword || req.body?.password;
  return (fromHeader || fromBody || '').toString();
}

function requireAdminPassword(req, res) {
  const configured = (process.env.ADMIN_PASSWORD || '').trim();
  // Default admin password (can be overridden via ADMIN_PASSWORD)
  const expected = configured || '2014';
  const provided = getAdminPasswordFromRequest(req);
  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'Admin password required' });
    return false;
  }
  return true;
}

function requireAddProductPassword(req, res) {
  // "Add product" password must be ONLY 2014 (not configurable)
  const expected = '2014';
  const provided = getAdminPasswordFromRequest(req);
  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'Add product password required' });
    return false;
  }
  return true;
}

function requireAddMemberPassword(req, res) {
  // "Add family member" password must be ONLY 2014 (not configurable)
  const expected = '2014';
  const provided = getAdminPasswordFromRequest(req);
  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'סיסמה שגויה' });
    return false;
  }
  return true;
}

// Per-member passwords (PINs). Stored as hash+salt in DB.
const DEFAULT_MEMBER_PINS_BY_NAME = {
  'אלעד': '2007',
  'תומר': '2014',
  'נועה': '2009',
  'לילך (אמא)': '1977',
  'יואב (אבא)': '1976'
};

async function ensureFamilyMemberPinColumns() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "family_members" ADD COLUMN "pinSalt" TEXT;`).catch(() => {});
    await prisma.$executeRawUnsafe(`ALTER TABLE "family_members" ADD COLUMN "pinHash" TEXT;`).catch(() => {});
  } catch (e) {
    console.error('Failed to ensure family_members pin columns:', e);
  }
}

async function ensureProductAllocationColumns() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "products" ADD COLUMN "extraOffset" INTEGER NOT NULL DEFAULT 0;`).catch(() => {});
  } catch (e) {
    console.error('Failed to ensure products extraOffset column:', e);
  }
}

// Specific members per product rule (ruleType === 'specific_members')
async function ensureProductRuleMembersTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS product_rule_members (
        productRuleId INTEGER NOT NULL,
        memberId INTEGER NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (productRuleId, memberId)
      );
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_product_rule_members_rule ON product_rule_members(productRuleId);`
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_product_rule_members_member ON product_rule_members(memberId);`
    ).catch(() => {});
  } catch (e) {
    console.error('Failed to ensure product_rule_members table:', e);
  }
}

function normalizeMemberIds(input) {
  const arr = Array.isArray(input) ? input : [];
  const uniq = [];
  const seen = new Set();
  for (const v of arr) {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n)) continue;
    const id = parseInt(n);
    if (!Number.isFinite(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  return uniq;
}

async function getSpecificMemberIdsForRule(ruleId) {
  await ensureProductRuleMembersTable();
  if (!ruleId) return [];
  try {
    const rows = await prisma.$queryRaw`
      SELECT memberId FROM product_rule_members WHERE productRuleId = ${parseInt(ruleId)}
    `;
    return (rows || []).map((r) => Number(r.memberId)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

async function setSpecificMemberIdsForRule(ruleId, memberIds) {
  await ensureProductRuleMembersTable();
  const rid = parseInt(ruleId);
  if (!Number.isFinite(rid)) return;
  const ids = normalizeMemberIds(memberIds);
  try {
    // Replace list atomically-ish: delete then insert
    await prisma.$executeRaw`
      DELETE FROM product_rule_members WHERE productRuleId = ${rid}
    `;
    for (const mid of ids) {
      await prisma.$executeRaw`
        INSERT OR IGNORE INTO product_rule_members (productRuleId, memberId) VALUES (${rid}, ${mid})
      `;
    }
  } catch (e) {
    console.error('Failed to set specific members for rule:', e);
  }
}

async function getEligibleMembersForProductRule(rule, allMembers) {
  if (!rule || !rule.ruleType || rule.ruleType === 'everyone') return allMembers;
  if (rule.ruleType === 'children_only') return allMembers.filter((m) => m.isChild);
  if (rule.ruleType === 'adults_only') return allMembers.filter((m) => !m.isChild);
  if (rule.ruleType === 'specific_members') {
    const ids = await getSpecificMemberIdsForRule(rule.id);
    const set = new Set(ids);
    return allMembers.filter((m) => set.has(m.id));
  }
  return allMembers;
}

async function getProductsExtraOffsetsMap() {
  await ensureProductAllocationColumns();
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, extraOffset FROM products
    `;
    const map = new Map();
    for (const r of rows || []) {
      map.set(r.id, Number(r.extraOffset || 0));
    }
    return map;
  } catch {
    return new Map();
  }
}

async function getProductExtraOffset(productId) {
  await ensureProductAllocationColumns();
  try {
    const rows = await prisma.$queryRaw`
      SELECT extraOffset FROM products WHERE id = ${parseInt(productId)} LIMIT 1
    `;
    const v = rows?.[0]?.extraOffset;
    const n = typeof v === 'number' ? v : parseInt(String(v ?? 0), 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function computeEntitlementForMember({ originalQuantity, eligibleMembers, memberId, extraOffset }) {
  const count = eligibleMembers.length;
  if (!count) return 0;
  const base = Math.floor(originalQuantity / count);
  const remainder = ((originalQuantity % count) + count) % count;
  if (remainder === 0) return base;

  const sorted = [...eligibleMembers].sort((a, b) => a.id - b.id);
  const idx = sorted.findIndex((m) => m.id === memberId);
  if (idx < 0) return 0;

  const offset = ((Number(extraOffset) || 0) % count + count) % count;
  const relative = (idx - offset + count) % count;
  const extra = relative < remainder ? 1 : 0;
  return base + extra;
}

function pbkdf2Hash(pin, salt) {
  // 100k iterations is fine for local admin PINs
  return crypto.pbkdf2Sync(String(pin), salt, 100000, 32, 'sha256').toString('hex');
}

function timingSafeEqualHex(a, b) {
  try {
    const ab = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

async function setMemberPinIfMissingByName(name, pin) {
  await ensureFamilyMemberPinColumns();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = pbkdf2Hash(pin, salt);
  // Only set when empty (so pins remain stable unless you intentionally reset via DB)
  await prisma.$executeRaw`
    UPDATE family_members
    SET pinSalt = ${salt}, pinHash = ${hash}
    WHERE name = ${String(name)} AND (pinHash IS NULL OR pinHash = '')
  `;
}

async function ensureDefaultPinsForKnownMembers() {
  try {
    await ensureFamilyMemberPinColumns();
    for (const [name, pin] of Object.entries(DEFAULT_MEMBER_PINS_BY_NAME)) {
      await setMemberPinIfMissingByName(name, pin);
    }
  } catch (e) {
    console.error('Failed ensuring default member pins:', e);
  }
}

async function getMemberRowByIdWithPin(id) {
  await ensureFamilyMemberPinColumns();
  const rows = await prisma.$queryRaw`
    SELECT id, name, pinSalt, pinHash
    FROM family_members
    WHERE id = ${parseInt(id)}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

async function requireMemberPassword(req, res, memberId, actionLabel) {
  await ensureDefaultPinsForKnownMembers();
  const provided = getAdminPasswordFromRequest(req); // reuse same header/body
  if (!provided) {
    res.status(401).json({ error: `Password required${actionLabel ? `: ${actionLabel}` : ''}` });
    return false;
  }

  const row = await getMemberRowByIdWithPin(memberId);
  if (!row) {
    res.status(404).json({ error: 'Member not found' });
    return false;
  }

  // If still missing pin (unknown name), don't allow the action.
  if (!row.pinSalt || !row.pinHash) {
    res.status(400).json({ error: 'Password is not set for this member' });
    return false;
  }

  const computed = pbkdf2Hash(provided, String(row.pinSalt));
  const ok = timingSafeEqualHex(computed, String(row.pinHash));
  if (!ok) {
    res.status(401).json({ error: 'Wrong password' });
    return false;
  }

  return true;
}

// Ensure auth/login columns exist in SQLite without requiring migrations
async function ensureFamilyMemberAuthColumns() {
  try {
    // Add columns (SQLite throws if column exists - we swallow)
    await prisma.$executeRawUnsafe(`ALTER TABLE "family_members" ADD COLUMN "clientCode" TEXT;`).catch(() => {});
    await prisma.$executeRawUnsafe(`ALTER TABLE "family_members" ADD COLUMN "totpSecret" TEXT;`).catch(() => {});
    await prisma.$executeRawUnsafe(`ALTER TABLE "family_members" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT 0;`).catch(() => {});

    // Unique index on clientCode (multiple NULLs are allowed in SQLite)
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "family_members_clientCode_key" ON "family_members"("clientCode");`
    ).catch(() => {});
  } catch (e) {
    console.error('Failed to ensure family_members auth columns:', e);
  }
}

function sanitizeMember(member) {
  if (!member) return null;
  return {
    id: member.id,
    name: member.name,
    isChild: !!member.isChild,
    gender: member.gender ?? null,
    clientCode: member.clientCode ?? null,
    totpEnabled: !!member.totpEnabled,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt
  };
}

async function getMemberRowById(id) {
  const rows = await prisma.$queryRaw`
    SELECT id, name, isChild, gender, clientCode, totpEnabled, createdAt, updatedAt
    FROM family_members
    WHERE id = ${parseInt(id)}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

async function getMemberRowByIdWithSecret(id) {
  const rows = await prisma.$queryRaw`
    SELECT id, name, isChild, gender, clientCode, totpEnabled, totpSecret, createdAt, updatedAt
    FROM family_members
    WHERE id = ${parseInt(id)}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

async function getMemberRowByClientCode(clientCode) {
  const rows = await prisma.$queryRaw`
    SELECT id, name, isChild, gender, clientCode, totpEnabled, totpSecret, createdAt, updatedAt
    FROM family_members
    WHERE clientCode = ${String(clientCode)}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

function buildTotpOtpauthUrl({ name, totpSecret }) {
  const appName = process.env.TOTP_ISSUER || 'TomerApp';
  if (!totpSecret) return null;
  // speakeasy expects secret as base32 (we store base32)
  return speakeasy.otpauthURL({
    secret: String(totpSecret),
    label: `${appName}:${name}`,
    issuer: appName,
    encoding: 'base32'
  });
}

async function fetchUrlText(url) {
  // Prefer fetch if available (handles gzip/br + redirects nicely)
  if (typeof fetch === 'function') {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TomerApp/1.0',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'he-IL,he;q=0.9,en-US;q=0.7,en;q=0.6'
      }
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return await res.text();
  }

  // Fallback: https + gzip/deflate support
  return await new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TomerApp/1.0',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'he-IL,he;q=0.9,en-US;q=0.7,en;q=0.6',
          'accept-encoding': 'gzip,deflate'
        }
      },
      (res) => {
        const chunks = [];
        const enc = String(res.headers['content-encoding'] || '');
        let stream = res;
        if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());

        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function decodeHtmlEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function extractShufersalProductNames(html, { limit = 200 } = {}) {
  const text = String(html || '');
  const candidates = [];

  // Common patterns seen in SPA payloads / product cards
  const patterns = [
    /"productName"\s*:\s*"([^"]{2,160})"/g,
    /"name"\s*:\s*"([^"]{2,160})"\s*,\s*"code"\s*:\s*"?[0-9A-Za-z_-]{3,}"/g,
    /data-testid="product-name"[^>]*>\s*([^<]{2,160})\s*</g,
    /class="[^"]*(?:product|item)[^"]*(?:name|title)[^"]*"[^>]*>\s*([^<]{2,160})\s*</g
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const raw = decodeHtmlEntities(m[1])
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw) continue;
      candidates.push(raw);
      if (candidates.length > limit * 8) break;
    }
    if (candidates.length > limit * 8) break;
  }

  const blacklist = [
    'שופרסל',
    'חיפוש',
    'התחבר',
    'סניף',
    'עגלת',
    'קטגור'
  ];

  const uniq = [];
  const seen = new Set();
  for (const name of candidates) {
    if (name.length < 2) continue;
    if (name.length > 120) continue;
    if (blacklist.some((b) => name.includes(b))) continue;
    // drop obvious UI strings
    if (/^(התחברות|הרשמה|המשך|סינון|מיון|הוספה)$/i.test(name)) continue;
    if (!seen.has(name)) {
      seen.add(name);
      uniq.push(name);
    }
    if (uniq.length >= limit) break;
  }
  return uniq;
}

async function fetchJson(url) {
  const txt = await fetchUrlText(url);
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error('Failed to parse JSON response');
  }
}

function extractChpProductNames(data, { limit = 200 } = {}) {
  const arr = Array.isArray(data) ? data : [];
  const names = [];
  const seen = new Set();

  for (const item of arr) {
    if (!item || item.id === 'next') continue;
    const name =
      (typeof item?.parts?.name_and_contents === 'string' && item.parts.name_and_contents.trim()) ||
      (typeof item?.label === 'string' && item.label.trim()) ||
      (typeof item?.value === 'string' && item.value.trim()) ||
      '';

    const cleaned = name.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (cleaned.length > 160) continue;
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      names.push(cleaned);
    }
    if (names.length >= limit) break;
  }

  return names;
}

function getChpNextFrom(data) {
  const arr = Array.isArray(data) ? data : [];
  const next = arr.find((x) => x && x.id === 'next');
  if (!next) return null;
  const v = next.value;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function buildChpProductExtendedUrl({ term, from = 0 }) {
  // Matches the curl the user provided
  return (
    `https://chp.co.il/autocompletion/product_extended` +
    `?term=${encodeURIComponent(String(term))}` +
    `&from=${encodeURIComponent(String(from))}` +
    `&u=${encodeURIComponent(String(Math.random()))}` +
    `&shopping_address=${encodeURIComponent('ראשון לציון ')}` +
    `&shopping_address_city_id=8300` +
    `&shopping_address_street_id=9000`
  );
}

// Family Members Routes
app.get('/api/family-members', async (req, res) => {
  try {
    await ensureFamilyMemberAuthColumns();
    const rows = await prisma.$queryRaw`
      SELECT id, name, isChild, gender, clientCode, totpEnabled, createdAt, updatedAt
      FROM family_members
      ORDER BY createdAt DESC
    `;
    res.json((rows || []).map(sanitizeMember));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/family-members', async (req, res) => {
  try {
    if (!requireAddMemberPassword(req, res)) return;
    const { name, isChild, gender } = req.body;
    await ensureFamilyMemberAuthColumns();
    await ensureDefaultPinsForKnownMembers();

    const clientCode = uuidv4();
    const appName = process.env.TOTP_ISSUER || 'TomerApp';
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `${appName}:${name}`,
      issuer: appName
    });

    const created = await prisma.familyMember.create({
      data: { 
        name, 
        isChild: isChild || false,
        gender: gender && gender !== '' ? gender : null
      }
    });
    // Write auth fields via raw SQL (works even if Prisma client isn't regenerated yet)
    await prisma.$executeRaw`
      UPDATE family_members
      SET clientCode = ${clientCode}, totpSecret = ${secret.base32}, totpEnabled = 1
      WHERE id = ${created.id}
    `;

    const row = await getMemberRowById(created.id);
    res.json({ ...sanitizeMember(row), totpOtpauthUrl: secret.otpauth_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/family-members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!await requireMemberPassword(req, res, id, 'edit')) return;
    const { name, isChild, gender } = req.body;
    await ensureFamilyMemberAuthColumns();
    const updated = await prisma.familyMember.update({
      where: { id: parseInt(id) },
      data: { 
        name, 
        isChild,
        gender: gender && gender !== '' ? gender : null
      }
    });
    const row = await getMemberRowById(updated.id);
    res.json(sanitizeMember(row));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/family-members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!await requireMemberPassword(req, res, id, 'delete')) return;
    await ensureFamilyMemberAuthColumns();
    await prisma.familyMember.delete({
      where: { id: parseInt(id) }
    });
    res.json({ message: 'Member deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get existing credentials (Admin) - DOES NOT rotate
app.post('/api/family-members/:id/credentials', async (req, res) => {
  try {
    const { id } = req.params;
    if (!await requireMemberPassword(req, res, id, 'credentials')) return;
    await ensureFamilyMemberAuthColumns();

    const existing = await getMemberRowByIdWithSecret(parseInt(id));
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    // If missing credentials (older users), create once
    if (!existing.clientCode || !existing.totpSecret) {
      const clientCode = uuidv4();
      const appName = process.env.TOTP_ISSUER || 'TomerApp';
      const secret = speakeasy.generateSecret({
        length: 20,
        name: `${appName}:${existing.name}`,
        issuer: appName
      });
      await prisma.$executeRaw`
        UPDATE family_members
        SET clientCode = ${clientCode}, totpSecret = ${secret.base32}, totpEnabled = 1
        WHERE id = ${parseInt(id)}
      `;
      const row = await getMemberRowByIdWithSecret(parseInt(id));
      return res.json({ ...sanitizeMember(row), totpOtpauthUrl: buildTotpOtpauthUrl(row) });
    }

    res.json({ ...sanitizeMember(existing), totpOtpauthUrl: buildTotpOtpauthUrl(existing) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset/rotate credentials explicitly (Admin)
app.post('/api/family-members/:id/credentials/reset', async (req, res) => {
  try {
    const { id } = req.params;
    if (!await requireMemberPassword(req, res, id, 'credentials_reset')) return;
    await ensureFamilyMemberAuthColumns();

    const existing = await getMemberRowById(parseInt(id));
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    const clientCode = uuidv4();
    const appName = process.env.TOTP_ISSUER || 'TomerApp';
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `${appName}:${existing.name}`,
      issuer: appName
    });

    await prisma.$executeRaw`
      UPDATE family_members
      SET clientCode = ${clientCode}, totpSecret = ${secret.base32}, totpEnabled = 1
      WHERE id = ${parseInt(id)}
    `;

    const row = await getMemberRowByIdWithSecret(parseInt(id));
    res.json({ ...sanitizeMember(row), totpOtpauthUrl: buildTotpOtpauthUrl(row) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify member password (no side effects)
app.post('/api/family-members/:id/verify-password', async (req, res) => {
  try {
    const { id } = req.params;
    if (!await requireMemberPassword(req, res, id, 'verify_password')) return;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth: verify TOTP (2nd step)
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { memberId, clientCode, totp } = req.body || {};
    await ensureFamilyMemberAuthColumns();

    if (!totp) return res.status(400).json({ error: 'totp is required' });

    let member = null; // will include totpSecret
    if (memberId) {
      const rows = await prisma.$queryRaw`
        SELECT id, name, isChild, gender, clientCode, totpEnabled, totpSecret, createdAt, updatedAt
        FROM family_members
        WHERE id = ${parseInt(memberId)}
        LIMIT 1
      `;
      member = rows?.[0] || null;
    } else if (clientCode) {
      member = await getMemberRowByClientCode(clientCode);
    } else {
      return res.status(400).json({ error: 'memberId or clientCode is required' });
    }

    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (!member.totpEnabled || !member.totpSecret) {
      return res.status(400).json({ error: 'TOTP is not enabled for this member' });
    }

    const token = String(totp).replace(/\s/g, '');
    const isValid = speakeasy.totp.verify({
      secret: member.totpSecret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!isValid) return res.status(401).json({ error: 'Invalid TOTP code' });

    res.json({ member: sanitizeMember(member) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Products Routes
app.get('/api/products', async (req, res) => {
  try {
    await ensureProductAllocationColumns();
    const products = await prisma.product.findMany({
      include: {
        rules: true
      },
      orderBy: { createdAt: 'desc' }
    });
    const offsets = await getProductsExtraOffsetsMap();

    // Attach specific member ids for ruleType === 'specific_members'
    await ensureProductRuleMembersTable();
    const ruleIds = [];
    for (const p of products || []) {
      const r = p?.rules?.[0];
      if (r?.id) ruleIds.push(r.id);
    }
    const ruleToMembers = new Map(); // ruleId -> number[]
    if (ruleIds.length > 0) {
      try {
        const safeIds = ruleIds
          .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
          .filter((n) => Number.isFinite(n))
          .map((n) => parseInt(n));

        if (safeIds.length > 0) {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT productRuleId, memberId FROM product_rule_members WHERE productRuleId IN (${safeIds.join(',')})`
          );
          for (const row of rows || []) {
            const rid = Number(row.productRuleId);
            const mid = Number(row.memberId);
            if (!Number.isFinite(rid) || !Number.isFinite(mid)) continue;
            if (!ruleToMembers.has(rid)) ruleToMembers.set(rid, []);
            ruleToMembers.get(rid).push(mid);
          }
        }
      } catch {
        // If Prisma.join isn't available (older client), fall back to per-rule query later
      }
    }

    const payload = [];
    for (const p of products || []) {
      const rule = p?.rules?.[0];
      let rules = p?.rules || [];
      if (rule?.id && rule?.ruleType === 'specific_members') {
        const ids = ruleToMembers.get(rule.id) || (await getSpecificMemberIdsForRule(rule.id));
        rules = [
          {
            ...rule,
            specificMemberIds: ids
          }
        ];
      }
      payload.push({
        ...p,
        rules,
        extraOffset: offsets.get(p.id) ?? 0
      });
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Allocation report for a product (admin)
app.get('/api/products/:id/allocation-report', async (req, res) => {
  try {
    if (!requireAdminPassword(req, res)) return;
    await ensureProductAllocationColumns();
    await ensureProductRuleMembersTable();

    const { id } = req.params;
    const productId = parseInt(id);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { rules: true }
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const allMembers = await prisma.familyMember.findMany();
    const rule = product.rules?.[0];
    let eligibleMembers = await getEligibleMembersForProductRule(rule, allMembers);

    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId },
      include: { member: true }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;

    const transfers = await prisma.shareTransfer.findMany({
      where: { productId },
      include: { fromMember: true, toMember: true }
    });

    const extraOffset = await getProductExtraOffset(productId);
    const count = eligibleMembers.length || 0;
    const base = count ? Math.floor(originalQuantity / count) : 0;
    const remainder = count ? ((originalQuantity % count) + count) % count : 0;
    const sortedEligible = [...eligibleMembers].sort((a, b) => a.id - b.id);

    const rows = sortedEligible.map((m) => {
      const entitlement = computeEntitlementForMember({
        originalQuantity,
        eligibleMembers: sortedEligible,
        memberId: m.id,
        extraOffset
      });
      const taken = allProductTransactions
        .filter((t) => t.memberId === m.id)
        .reduce((sum, t) => sum + t.quantity, 0);
      const transferredOut = transfers
        .filter((t) => t.fromMemberId === m.id)
        .reduce((sum, t) => sum + t.quantity, 0);
      const received = transfers
        .filter((t) => t.toMemberId === m.id)
        .reduce((sum, t) => sum + t.quantity, 0);
      const available = entitlement - taken - transferredOut + received;
      return {
        memberId: m.id,
        memberName: m.name,
        isChild: !!m.isChild,
        entitlement,
        extra: entitlement > base,
        taken,
        transferredOut,
        received,
        available
      };
    });

    res.json({
      product: { id: product.id, name: product.name, unit: product.unit, quantity: product.quantity },
      ruleType: rule?.ruleType || 'everyone',
      specificMemberIds: rule?.ruleType === 'specific_members' ? await getSpecificMemberIdsForRule(rule.id) : [],
      eligibleMembers: sortedEligible.map((m) => ({ id: m.id, name: m.name, isChild: !!m.isChild })),
      originalQuantity,
      base,
      remainder,
      extraOffset,
      rows
    });
  } catch (error) {
    console.error('Allocation report failed:', error);
    res.status(500).json({ error: error.message || 'Allocation report failed' });
  }
});

// Bulk delete ALL products (dangerous)
// body: { confirm: "DELETE_ALL_PRODUCTS" }
app.post('/api/products/bulk-delete', async (req, res) => {
  try {
    if (!requireAddProductPassword(req, res)) return;
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE_ALL_PRODUCTS') {
      return res.status(400).json({ error: 'Missing confirmation' });
    }

    const result = await prisma.product.deleteMany({});
    res.json({ deleted: result.count });
  } catch (error) {
    console.error('Bulk delete products failed:', error);
    res.status(500).json({ error: error.message || 'Bulk delete failed' });
  }
});

// Import products from CHP autocompletion/product_extended (JSON)
// body: { query: string, limit?: number }
app.post('/api/products/import/chp', async (req, res) => {
  try {
    if (!requireAdminPassword(req, res)) return;
    const { query, limit } = req.body || {};
    const q = String(query || '').trim();
    if (!q) return res.status(400).json({ error: 'query is required' });

    const desired = Math.min(parseInt(limit) || 80, 200);
    let from = 0;
    const names = [];
    const seen = new Set();
    let pages = 0;

    while (names.length < desired && pages < 30) {
      const url = buildChpProductExtendedUrl({ term: q, from });
      const data = await fetchJson(url);

      const pageNames = extractChpProductNames(data, { limit: desired });
      for (const n of pageNames) {
        if (!seen.has(n)) {
          seen.add(n);
          names.push(n);
        }
        if (names.length >= desired) break;
      }

      const nextFrom = getChpNextFrom(data);
      if (nextFrom == null) break;
      if (nextFrom === from) break;
      from = nextFrom;
      pages += 1;
    }

    if (names.length === 0) {
      return res.status(200).json({
        imported: 0,
        skipped: 0,
        names: [],
        warning: 'לא הוחזרו תוצאות מ-CHP או שלא הצלחתי לחלץ שמות מוצרים.'
      });
    }

    let imported = 0;
    let skipped = 0;

    for (const name of names) {
      const existing = await prisma.product.findFirst({ where: { name } });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.product.create({
        data: {
          name,
          quantity: 0,
          rules: { create: { ruleType: 'everyone' } }
        }
      });
      imported += 1;
    }

    res.json({ imported, skipped, names, source: 'chp' });
  } catch (error) {
    console.error('CHP import failed:', error);
    res.status(500).json({ error: error.message || 'Import failed' });
  }
});

// Import products from Shufersal search page
// body: { query: string, limit?: number }
app.post('/api/products/import/shufersal', async (req, res) => {
  try {
    if (!requireAdminPassword(req, res)) return;
    const { query, limit } = req.body || {};
    const q = String(query || '').trim();
    if (!q) return res.status(400).json({ error: 'query is required' });

    const url = `https://www.shufersal.co.il/online/he/search?text=${encodeURIComponent(q)}`;
    const html = await fetchUrlText(url);
    const names = extractShufersalProductNames(html, { limit: Math.min(parseInt(limit) || 80, 200) });

    if (names.length === 0) {
      return res.status(200).json({
        imported: 0,
        skipped: 0,
        names: [],
        warning: 'לא הצלחתי לחלץ שמות מוצרים מהעמוד (יתכן שהאתר שינה מבנה או חוסם בוטים).'
      });
    }

    let imported = 0;
    let skipped = 0;

    for (const name of names) {
      const existing = await prisma.product.findFirst({ where: { name } });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.product.create({
        data: {
          name,
          quantity: 0,
          rules: { create: { ruleType: 'everyone' } }
        }
      });
      imported += 1;
    }

    res.json({ imported, skipped, names });
  } catch (error) {
    console.error('Shufersal import failed:', error);
    res.status(500).json({ error: error.message || 'Import failed' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    if (!requireAddProductPassword(req, res)) return;
    const { name, quantity, unit, ruleType, specificMemberIds } = req.body;
    const productData = {
      name,
        quantity: parseInt(quantity) || 0,
      rules: {
        create: {
          ruleType: ruleType || 'everyone'
        }
      }
    };
    
    // Only include unit if it's not empty
    if (unit && unit.trim() !== '') {
      productData.unit = unit.trim();
    }
    
    const product = await prisma.product.create({
      data: productData,
      include: {
        rules: true
      }
    });

    // Save specific members list if needed
    const rule = product?.rules?.[0];
    if (rule?.ruleType === 'specific_members') {
      const ids = normalizeMemberIds(specificMemberIds);
      if (ids.length === 0) {
        // Keep product, but rule has no members => nobody eligible
      } else {
        await setSpecificMemberIdsForRule(rule.id, ids);
      }
      // Attach for response
      product.rules = [{ ...rule, specificMemberIds: ids }];
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    if (!requireAdminPassword(req, res)) return;
    const { id } = req.params;
    const { name, quantity, unit, ruleType, specificMemberIds } = req.body;
    
    await ensureProductAllocationColumns();
    await ensureProductRuleMembersTable();

    const currentProduct = await prisma.product.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, quantity: true }
    });
    if (!currentProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Update product
    const newQtyInt = parseInt(quantity) || 0;
    const updateData = { 
      name, 
      quantity: newQtyInt
    };
    
    // Only include unit if it's not empty, otherwise set to null explicitly
    if (unit && unit.trim() !== '') {
      updateData.unit = unit.trim();
    } else {
      updateData.unit = null;
    }
    
    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: updateData
    });

    // If quantity increased (restock), rotate who gets the +1 next time
    if (newQtyInt > (currentProduct.quantity || 0)) {
      await prisma.$executeRaw`
        UPDATE products
        SET extraOffset = COALESCE(extraOffset, 0) + 1
        WHERE id = ${parseInt(id)}
      `;
    }
    
    // Update or create rule
    if (ruleType) {
      const existingRule = await prisma.productRule.findFirst({
        where: { productId: parseInt(id) }
      });
      
      if (existingRule) {
        await prisma.productRule.update({
          where: { id: existingRule.id },
          data: { ruleType }
        });
        if (ruleType === 'specific_members') {
          await setSpecificMemberIdsForRule(existingRule.id, specificMemberIds);
        } else {
          // Clear any previous specific list
          await prisma.$executeRaw`
            DELETE FROM product_rule_members WHERE productRuleId = ${existingRule.id}
          `;
        }
      } else {
        const newRule = await prisma.productRule.create({
          data: { productId: parseInt(id), ruleType }
        });
        if (ruleType === 'specific_members') {
          await setSpecificMemberIdsForRule(newRule.id, specificMemberIds);
        }
      }
    }
    
    const updatedProduct = await prisma.product.findUnique({
      where: { id: parseInt(id) },
      include: { rules: true }
    });

    // Attach specific list for response
    if (updatedProduct?.rules?.[0]?.ruleType === 'specific_members') {
      const r = updatedProduct.rules[0];
      updatedProduct.rules = [{ ...r, specificMemberIds: await getSpecificMemberIdsForRule(r.id) }];
    }
    
    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    if (!requireAddProductPassword(req, res)) return;
    const { id } = req.params;
    await prisma.product.delete({
      where: { id: parseInt(id) }
    });
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Transactions Routes
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await prisma.transaction.findMany({
      include: {
        product: true,
        member: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { productId, memberId, quantity, notes } = req.body;
    
    // Get product and check availability
    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { rules: true }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const rule = product.rules[0];
    
    // Check quantity
    if (product.quantity < quantity) {
      return res.status(400).json({ error: 'Not enough quantity available' });
    }
    
    // Get member
    const member = await prisma.familyMember.findUnique({
      where: { id: parseInt(memberId) }
    });
    
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Require a deposit before taking a product (transactions only)
    if (!prisma.deposit) {
      return res.status(500).json({
        error: 'Deposit model not found. Please run: npx prisma generate and restart the server'
      });
    }

    const existingDeposit = await prisma.deposit.findFirst({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(memberId)
      }
    });

    if (!existingDeposit) {
      return res.status(403).json({ error: 'חובה להפקיד פיקדון לפני שאפשר לקחת מוצר' });
    }
    
    // Calculate original quantity (current quantity + all transactions for this product)
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: parseInt(productId) }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    
    // Calculate fair share
    const allMembers = await prisma.familyMember.findMany();
    const eligibleMembers = await getEligibleMembersForProductRule(rule, allMembers);
    
    if (eligibleMembers.length === 0) {
      return res.status(400).json({ error: 'No eligible members for this product' });
    }
    
    // Ensure member is eligible under the rule (redundant safety; rule already checked above)
    if (!eligibleMembers.some(m => m.id === member.id)) {
      return res.status(403).json({ error: 'המשתמש אינו זכאי לפי חוק החלוקה של המוצר' });
    }
    
    const extraOffset = await getProductExtraOffset(productId);
    const fairShare = computeEntitlementForMember({
      originalQuantity,
      eligibleMembers,
      memberId: member.id,
      extraOffset
    });
    
    // Calculate how much the member has already taken
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(memberId)
      }
    });
    
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much the member has already transferred
    const existingTransfersOut = await prisma.shareTransfer.findMany({
      where: {
        productId: parseInt(productId),
        fromMemberId: parseInt(memberId)
      }
    });
    
    const totalTransferred = existingTransfersOut.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much the member has received from transfers
    const existingTransfersIn = await prisma.shareTransfer.findMany({
      where: {
        productId: parseInt(productId),
        toMemberId: parseInt(memberId)
      }
    });
    
    const totalReceived = existingTransfersIn.reduce((sum, t) => sum + t.quantity, 0);
    
    // Total available = entitlement - taken - transferred + received
    const totalAvailable = fairShare - totalTaken - totalTransferred + totalReceived;
    
    // Check if trying to take more than total available
    if (parseInt(quantity) > totalAvailable) {
      return res.status(400).json({ 
        error: `אין אפשרות לקחת יותר מההקצבה שלך. ההקצבה שלך: ${fairShare}, כבר לקחת: ${totalTaken}, כבר העברת: ${totalTransferred}, קיבלת: ${totalReceived}, זמין לך: ${totalAvailable}` 
      });
    }
    
    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        productId: parseInt(productId),
        memberId: parseInt(memberId),
        quantity: parseInt(quantity),
        notes: notes || null
      },
      include: {
        product: true,
        member: true
      }
    });
    
    // Update product quantity
    await prisma.product.update({
      where: { id: parseInt(productId) },
      data: {
        quantity: product.quantity - parseInt(quantity)
      }
    });
    
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Share Transfer Routes
app.post('/api/share-transfers', async (req, res) => {
  try {
    const { productId, fromMemberId, toMemberId, quantity } = req.body;
    
    // Check if shareTransfer model exists
    if (!prisma.shareTransfer) {
      console.error('prisma.shareTransfer is undefined');
      return res.status(500).json({ 
        error: 'ShareTransfer model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    // Get product
    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { rules: true }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Get members
    const fromMember = await prisma.familyMember.findUnique({
      where: { id: parseInt(fromMemberId) }
    });
    const toMember = await prisma.familyMember.findUnique({
      where: { id: parseInt(toMemberId) }
    });
    
    if (!fromMember || !toMember) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    if (fromMemberId === toMemberId) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }
    
    // Calculate fair share for fromMember
    const allMembers = await prisma.familyMember.findMany();
    const productRule = product.rules[0];
    const eligibleMembers = await getEligibleMembersForProductRule(productRule, allMembers);
    
    if (eligibleMembers.length === 0) {
      return res.status(400).json({ error: 'No eligible members for this product' });
    }

    // Enforce rule eligibility for both members
    const fromEligible = eligibleMembers.some(m => m.id === fromMember.id);
    const toEligible = eligibleMembers.some(m => m.id === toMember.id);
    if (!fromEligible || !toEligible) {
      if (productRule?.ruleType === 'children_only') {
        return res.status(400).json({ error: 'מוצר זה מיועד לילדים בלבד — אי אפשר לבקש הקצבה ממבוגרים/עבור מבוגרים' });
      }
      if (productRule?.ruleType === 'adults_only') {
        return res.status(400).json({ error: 'מוצר זה מיועד למבוגרים בלבד — אי אפשר לבקש הקצבה מילדים/עבור ילדים' });
      }
      return res.status(400).json({ error: 'המשתמש שנבחר אינו זכאי לפי חוק החלוקה של המוצר' });
    }
    
    // Calculate original quantity
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: parseInt(productId) }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    
    const extraOffset = await getProductExtraOffset(productId);
    const fairShare = computeEntitlementForMember({
      originalQuantity,
      eligibleMembers,
      memberId: fromMember.id,
      extraOffset
    });
    
    // Calculate how much fromMember has already taken
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(fromMemberId)
      }
    });
    
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much fromMember has already transferred
    let existingTransfers = [];
    let totalTransferred = 0;
    
    try {
      existingTransfers = await prisma.shareTransfer.findMany({
        where: {
          productId: parseInt(productId),
          fromMemberId: parseInt(fromMemberId)
        }
      });
      totalTransferred = existingTransfers.reduce((sum, t) => sum + t.quantity, 0);
    } catch (transferError) {
      console.error('Error fetching transfers:', transferError);
      // If shareTransfer doesn't exist, assume no transfers yet
      totalTransferred = 0;
    }
    
    // Calculate remaining fair share
    const remainingFairShare = fairShare - totalTaken - totalTransferred;
    
    // Check if trying to transfer more than remaining fair share
    if (parseInt(quantity) > remainingFairShare) {
      return res.status(400).json({ 
        error: `אין אפשרות להעביר יותר מההקצבה שלך. ההקצבה שלך: ${fairShare}, כבר לקחת: ${totalTaken}, כבר העברת: ${totalTransferred}, נשאר לך: ${remainingFairShare}` 
      });
    }
    
    // Create transfer
    let transfer;
    try {
      transfer = await prisma.shareTransfer.create({
        data: {
          productId: parseInt(productId),
          fromMemberId: parseInt(fromMemberId),
          toMemberId: parseInt(toMemberId),
          quantity: parseInt(quantity)
        },
        include: {
          product: true,
          fromMember: true,
          toMember: true
        }
      });
    } catch (createError) {
      console.error('Error creating transfer:', createError);
      console.error('Error details:', {
        message: createError.message,
        code: createError.code,
        meta: createError.meta
      });
      
      if (createError.message && createError.message.includes('shareTransfer')) {
        return res.status(500).json({ 
          error: 'ShareTransfer model not found. Please run: npx prisma generate and restart the server',
          details: createError.message
        });
      }
      
      throw createError;
    }
    
    res.json(transfer);
  } catch (error) {
    console.error('Error in share transfer:', error);
    console.error('Full error:', JSON.stringify(error, null, 2));
    res.status(500).json({ 
      error: error.message || 'שגיאה בהעברת הקצבה',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/share-transfers', async (req, res) => {
  try {
    const { productId } = req.query;
    const where = productId ? { productId: parseInt(productId) } : {};
    
    // Check if shareTransfer model exists
    if (!prisma.shareTransfer) {
      return res.status(500).json({ 
        error: 'ShareTransfer model not found. Please run: npx prisma generate' 
      });
    }
    
    const transfers = await prisma.shareTransfer.findMany({
      where,
      include: {
        product: true,
        fromMember: true,
        toMember: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(transfers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Share Request Routes
app.post('/api/share-requests', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.status(500).json({ 
        error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { productId, fromMemberId, toMemberId, quantity } = req.body;
    
    // Get product
    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { rules: true }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Get members
    const fromMember = await prisma.familyMember.findUnique({
      where: { id: parseInt(fromMemberId) }
    });
    const toMember = await prisma.familyMember.findUnique({
      where: { id: parseInt(toMemberId) }
    });
    
    if (!fromMember || !toMember) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    if (fromMemberId === toMemberId) {
      return res.status(400).json({ error: 'Cannot request from yourself' });
    }
    
    // Check if toMember has available share
    const allMembers = await prisma.familyMember.findMany();
    const productRule = product.rules[0];
    const eligibleMembers = await getEligibleMembersForProductRule(productRule, allMembers);
    
    if (eligibleMembers.length === 0) {
      return res.status(400).json({ error: 'No eligible members for this product' });
    }
    
    // Calculate original quantity
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: parseInt(productId) }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    
    const extraOffset = await getProductExtraOffset(productId);
    const fairShare = computeEntitlementForMember({
      originalQuantity,
      eligibleMembers,
      memberId: toMember.id,
      extraOffset
    });
    
    // Calculate how much toMember has already taken
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(toMemberId)
      }
    });
    
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much toMember has already transferred
    const existingTransfers = await prisma.shareTransfer.findMany({
      where: {
        productId: parseInt(productId),
        fromMemberId: parseInt(toMemberId)
      }
    });
    
    const totalTransferred = existingTransfers.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate remaining fair share for toMember
    const remainingFairShare = fairShare - totalTaken - totalTransferred;
    
    // Check if toMember has available share
    if (remainingFairShare <= 0) {
      return res.status(400).json({ 
        error: 'למשתמש נגמר המלאי במוצר' 
      });
    }
    
    // Check if trying to request more than remaining fair share
    if (parseInt(quantity) > remainingFairShare) {
      return res.status(400).json({ 
        error: `אין אפשרות לבקש יותר מההקצבה הזמינה. ההקצבה הזמינה: ${remainingFairShare}` 
      });
    }
    
    // Check if there's already a pending request
    let existingRequest = null;
    try {
      existingRequest = await prisma.shareRequest.findFirst({
        where: {
          productId: parseInt(productId),
          fromMemberId: parseInt(fromMemberId),
          toMemberId: parseInt(toMemberId),
          status: 'pending'
        }
      });
    } catch (requestError) {
      console.error('Error checking existing request:', requestError);
      // If shareRequest doesn't exist, continue (no existing request)
    }
    
    if (existingRequest) {
      return res.status(400).json({ error: 'יש לך כבר בקשה ממתינה למשתמש הזה' });
    }
    
    // Create request
    let request;
    try {
      request = await prisma.shareRequest.create({
        data: {
          productId: parseInt(productId),
          fromMemberId: parseInt(fromMemberId),
          toMemberId: parseInt(toMemberId),
          quantity: parseInt(quantity),
          status: 'pending'
        },
        include: {
          product: true,
          fromMember: true,
          toMember: true
        }
      });
    } catch (createError) {
      console.error('Error creating request:', createError);
      if (createError.message && createError.message.includes('shareRequest')) {
        return res.status(500).json({ 
          error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server',
          details: createError.message
        });
      }
      throw createError;
    }
    
    res.json(request);
  } catch (error) {
    console.error('Error in share request:', error);
    res.status(500).json({ error: error.message || 'שגיאה בבקשת הקצבה' });
  }
});

app.get('/api/share-requests', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.json([]); // Return empty array if model doesn't exist
    }
    
    const { memberId, status } = req.query;
    const where = {};
    
    if (memberId) {
      where.OR = [
        { fromMemberId: parseInt(memberId) },
        { toMemberId: parseInt(memberId) }
      ];
    }
    
    if (status) {
      where.status = status;
    }
    
    const requests = await prisma.shareRequest.findMany({
      where,
      include: {
        product: true,
        fromMember: true,
        toMember: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(requests);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/share-requests/:id/approve', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.status(500).json({ 
        error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { id } = req.params;
    
    // Get request
    const request = await prisma.shareRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        product: true,
        fromMember: true,
        toMember: true
      }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is not pending' });
    }
    
    // Check if toMember still has available share
    const allMembers = await prisma.familyMember.findMany();
    const product = await prisma.product.findUnique({
      where: { id: request.productId },
      include: { rules: true }
    });
    
    const productRule = product.rules[0];
    const eligibleMembers = await getEligibleMembersForProductRule(productRule, allMembers);
    
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: request.productId }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    const extraOffset = await getProductExtraOffset(request.productId);
    const fairShare = computeEntitlementForMember({
      originalQuantity,
      eligibleMembers,
      memberId: request.toMemberId,
      extraOffset
    });
    
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: request.productId,
        memberId: request.toMemberId
      }
    });
    
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    const existingTransfers = await prisma.shareTransfer.findMany({
      where: {
        productId: request.productId,
        fromMemberId: request.toMemberId
      }
    });
    
    const totalTransferred = existingTransfers.reduce((sum, t) => sum + t.quantity, 0);
    const remainingFairShare = fairShare - totalTaken - totalTransferred;
    
    if (remainingFairShare < request.quantity) {
      return res.status(400).json({ 
        error: 'למשתמש נגמר המלאי במוצר' 
      });
    }
    
    // Update request status
    const updatedRequest = await prisma.shareRequest.update({
      where: { id: parseInt(id) },
      data: { status: 'approved' },
      include: {
        product: true,
        fromMember: true,
        toMember: true
      }
    });
    
    // Create transfer
    await prisma.shareTransfer.create({
      data: {
        productId: request.productId,
        fromMemberId: request.toMemberId,
        toMemberId: request.fromMemberId,
        quantity: request.quantity
      }
    });
    
    res.json(updatedRequest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/share-requests/:id/reject', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.status(500).json({ 
        error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { id } = req.params;
    
    const request = await prisma.shareRequest.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is not pending' });
    }
    
    const updatedRequest = await prisma.shareRequest.update({
      where: { id: parseInt(id) },
      data: { status: 'rejected' },
      include: {
        product: true,
        fromMember: true,
        toMember: true
      }
    });
    
    res.json(updatedRequest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/share-requests/:id', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.status(500).json({ 
        error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { id } = req.params;
    
    // Get request to check if it's pending
    const request = await prisma.shareRequest.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    // Only allow deletion of pending requests
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Can only cancel pending requests' });
    }
    
    await prisma.shareRequest.delete({
      where: { id: parseInt(id) }
    });
    
    res.json({ message: 'Request cancelled successfully' });
  } catch (error) {
    console.error('Error deleting request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete transaction (cancel taking product)
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get transaction
    const transaction = await prisma.transaction.findUnique({
      where: { id: parseInt(id) },
      include: {
        product: true
      }
    });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Delete transaction
    await prisma.transaction.delete({
      where: { id: parseInt(id) }
    });
    
    // Return quantity to product
    await prisma.product.update({
      where: { id: transaction.productId },
      data: {
        quantity: transaction.product.quantity + transaction.quantity
      }
    });
    
    res.json({ message: 'Transaction cancelled successfully' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: error.message });
  }
});

// Deposit Routes
app.post('/api/deposits', async (req, res) => {
  try {
    // Check if deposit model exists
    if (!prisma.deposit) {
      return res.status(500).json({ 
        error: 'Deposit model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { productId, memberId, amount, paymentMethod, cardNumber, cvv, expiryDate, idNumber } = req.body;
    
    // Get product
    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { rules: true }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Get member
    const member = await prisma.familyMember.findUnique({
      where: { id: parseInt(memberId) }
    });
    
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Deposits are locked: do not allow re-deposit for same product+member
    const existingDeposit = await prisma.deposit.findFirst({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(memberId)
      }
    });

    if (existingDeposit) {
      return res.status(400).json({ error: 'כבר הפקדת פיקדון למוצר הזה — אי אפשר לשנות את סכום הפיקדון' });
    }
    
    // Calculate fair share
    const allMembers = await prisma.familyMember.findMany();
    const productRule = product.rules[0];
    const eligibleMembers = await getEligibleMembersForProductRule(productRule, allMembers);
    
    if (eligibleMembers.length === 0) {
      return res.status(400).json({ error: 'No eligible members for this product' });
    }
    
    // Calculate original quantity
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: parseInt(productId) }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    const extraOffset = await getProductExtraOffset(productId);
    const fairShare = computeEntitlementForMember({
      originalQuantity,
      eligibleMembers,
      memberId: member.id,
      extraOffset
    });
    
    // Calculate how much the member has already taken
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(memberId)
      }
    });
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much the member has already transferred
    const existingTransfersOut = await prisma.shareTransfer.findMany({
      where: {
        productId: parseInt(productId),
        fromMemberId: parseInt(memberId)
      }
    });
    const totalTransferred = existingTransfersOut.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much the member has received from transfers
    const existingTransfersIn = await prisma.shareTransfer.findMany({
      where: {
        productId: parseInt(productId),
        toMemberId: parseInt(memberId)
      }
    });
    const totalReceived = existingTransfersIn.reduce((sum, t) => sum + t.quantity, 0);
    
    // Validate deposit amount (minimum 50, maximum 1000)
    const depositAmount = parseFloat(amount);
    
    if (isNaN(depositAmount) || depositAmount < 50) {
      return res.status(400).json({ 
        error: 'סכום הפיקדון המינימלי הוא 50 ₪' 
      });
    }
    
    if (depositAmount > 1000) {
      return res.status(400).json({ 
        error: 'סכום הפיקדון המקסימלי הוא 1000 ₪' 
      });
    }
    
    // Validate card details only if payment method is card
    if (paymentMethod === 'card') {
      if (!cardNumber || !cvv || !expiryDate || !idNumber) {
        return res.status(400).json({ 
          error: 'נדרשים כל פרטי כרטיס האשראי לתשלום בכרטיס' 
        });
      }
    }
    
    // Create deposit
    const deposit = await prisma.deposit.create({
      data: {
        productId: parseInt(productId),
        memberId: parseInt(memberId),
        amount: parseFloat(amount),
        paymentMethod: paymentMethod || 'card',
        cardNumber: paymentMethod === 'card' ? (cardNumber || null) : null,
        cvv: paymentMethod === 'card' ? (cvv || null) : null,
        expiryDate: paymentMethod === 'card' ? (expiryDate || null) : null,
        idNumber: paymentMethod === 'card' ? (idNumber || null) : null
      },
      include: {
        product: true,
        member: true
      }
    });
    
    res.json(deposit);
  } catch (error) {
    console.error('Error creating deposit:', error);
    res.status(500).json({ error: error.message || 'שגיאה ביצירת הפיקדון' });
  }
});

app.get('/api/deposits', async (req, res) => {
  try {
    // Check if deposit model exists
    if (!prisma.deposit) {
      return res.json([]);
    }
    
    const { memberId, productId } = req.query;
    const where = {};
    
    if (memberId) {
      where.memberId = parseInt(memberId);
    }
    
    if (productId) {
      where.productId = parseInt(productId);
    }
    
    const deposits = await prisma.deposit.findMany({
      where,
      include: {
        product: true,
        member: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(deposits);
  } catch (error) {
    console.error('Error fetching deposits:', error);
    res.status(500).json({ error: error.message });
  }
});

// Ensure refund events table exists (no Prisma migration required)
async function ensureRefundEventsTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS refund_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memberId INTEGER NOT NULL,
        productId INTEGER NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        shown INTEGER NOT NULL DEFAULT 0
      );
    `);
  } catch (e) {
    console.error('Failed to ensure refund_events table:', e);
  }
}

// Get refund notifications for a member (and mark as shown)
app.get('/api/refund-events', async (req, res) => {
  try {
    const { memberId } = req.query;
    if (!memberId) return res.status(400).json({ error: 'memberId is required' });

    await ensureRefundEventsTable();

    const events = await prisma.$queryRaw`
      SELECT re.id as id, re.productId as productId, p.name as productName, re.createdAt as createdAt
      FROM refund_events re
      JOIN products p ON p.id = re.productId
      WHERE re.memberId = ${parseInt(memberId)} AND re.shown = 0
      ORDER BY re.createdAt DESC
    `;

    // Mark as shown
    for (const ev of events) {
      await prisma.$executeRaw`
        UPDATE refund_events SET shown = 1 WHERE id = ${ev.id}
      `;
    }

    res.json(events);
  } catch (error) {
    console.error('Error fetching refund events:', error);
    res.status(500).json({ error: error.message || 'שגיאה בטעינת הודעות החזרת פיקדון' });
  }
});

// Refund deposit (admin)
app.post('/api/deposits/refund', async (req, res) => {
  try {
    if (!requireAdminPassword(req, res)) return;
    if (!prisma.deposit) {
      return res.status(500).json({
        error: 'Deposit model not found. Please run: npx prisma generate and restart the server'
      });
    }

    const { productId, memberId } = req.body;

    const deposit = await prisma.deposit.findFirst({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(memberId)
      },
      include: {
        product: true,
        member: true
      }
    });

    if (!deposit) {
      return res.status(404).json({ error: 'פיקדון לא נמצא' });
    }

    await ensureRefundEventsTable();
    await prisma.$executeRaw`
      INSERT INTO refund_events (memberId, productId, shown) VALUES (${deposit.memberId}, ${deposit.productId}, 0)
    `;

    // No DB schema changes: refund = admin deletes the deposit record
    await prisma.deposit.delete({
      where: { id: deposit.id }
    });

    res.json({ message: 'Deposit refunded', refundedMember: deposit.member, product: deposit.product });
  } catch (error) {
    console.error('Error refunding deposit:', error);
    res.status(500).json({ error: error.message || 'שגיאה בהחזרת הפיקדון' });
  }
});

app.delete('/api/deposits/:id', async (req, res) => {
  try {
    // Check if deposit model exists
    if (!prisma.deposit) {
      return res.status(500).json({ 
        error: 'Deposit model not found. Please run: npx prisma generate and restart the server' 
      });
    }

    // Deposits are locked: cannot cancel after creation
    return res.status(403).json({ error: 'לא ניתן לבטל פיקדון לאחר שהופקד' });
  } catch (error) {
    console.error('Error deleting deposit:', error);
    res.status(500).json({ error: error.message });
  }
});

// Dashboard data
app.get('/api/dashboard', async (req, res) => {
  try {
    const [members, products, transactions] = await Promise.all([
      prisma.familyMember.findMany(),
      prisma.product.findMany({
        include: { rules: true }
      }),
      prisma.transaction.findMany({
        include: {
          product: true,
          member: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      })
    ]);
    
    res.json({ members, products, transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
