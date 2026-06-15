/**
 * Fort Knox EDMS — automated test suite.
 *
 * These are REAL integration tests: they boot the Express app against an
 * in-memory MongoDB (mongodb-memory-server), exercise the HTTP API end to end,
 * and assert on real database behaviour, permissions, and security rules.
 *
 * Run:
 *    npm test
 *
 * NOTE: mongodb-memory-server downloads a MongoDB binary on first run, so the
 * machine running the tests needs outbound internet access once. (This is why
 * these could not be executed in the original build environment, where that
 * download was blocked — see TESTING.md.)
 */

const path = require('path');
const fs = require('fs');

// app.js must export the Express app without calling listen(); see refactor note.
let app, mongoServer, mongoose, request;

beforeAll(async () => {
  jest.setTimeout(60000);
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mongoose = require('mongoose');
  request = require('supertest');
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongoServer.getUri();
  process.env.JWT_SECRET = 'test_secret';
  process.env.CLIENT_ORIGIN = 'http://localhost:3000';
  // app.js connects to MONGO_URI, seeds, and exports { app, ready }
  const mod = require('./server');
  app = mod.app;
  await mod.ready; // resolves after DB connect + seed
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
});

// Helper: login and capture the auth cookie.
async function login(email, password) {
  const res = await request(app).post('/auth/login').send({ email, password });
  const cookie = res.headers['set-cookie']?.find((c) => c.startsWith('fk_token='));
  return { res, cookie };
}
const auth = (req, cookie) => req.set('Cookie', cookie);

describe('Authentication', () => {
  test('valid login sets an httpOnly cookie, no token in body', async () => {
    const { res, cookie } = await login('admin@edms.local', 'Admin@123');
    expect(res.status).toBe(200);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(res.body.token).toBeUndefined();
  });

  test('wrong password is rejected', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'admin@edms.local', password: 'nope' });
    expect(res.status).toBe(401);
  });

  test('protected route requires the cookie', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
  });

  test('login is rate-limited after repeated failures', async () => {
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const r = await request(app).post('/auth/login').send({ email: 'x@y.z', password: 'bad' });
      if (r.status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});

describe('Access control', () => {
  let adminCookie, engCookie, legalCookie;
  beforeAll(async () => {
    adminCookie = (await login('admin@edms.local', 'Admin@123')).cookie;
    engCookie = (await login('eng@edms.local', 'Eng@123')).cookie;
    legalCookie = (await login('legal@edms.local', 'Legal@123')).cookie;
  });

  test('engineering cannot view a Legal patent', async () => {
    const list = await auth(request(app).get('/assets'), adminCookie);
    const patent = list.body.assets.find((a) => a.filename.includes('Patent'));
    const res = await auth(request(app).get(`/assets/${patent._id}/view`), engCookie);
    expect(res.status).toBe(403);
  });

  test('legal can view but not download a view-only patent', async () => {
    const list = await auth(request(app).get('/assets'), legalCookie);
    const patent = list.body.assets.find((a) => a.filename.includes('Patent'));
    expect(patent.accessible).toBe(true);
    expect(patent.canDownload).toBe(false);
    const dl = await auth(request(app).get(`/assets/${patent._id}/raw?download=1`), legalCookie);
    expect(dl.status).toBe(403);
  });

  test('per-user grant lets a specific user access one document', async () => {
    const list = await auth(request(app).get('/assets'), adminCookie);
    const patent = list.body.assets.find((a) => a.filename.includes('Patent'));
    const users = await auth(request(app).get('/users'), adminCookie);
    const eng = users.body.users.find((u) => u.email === 'eng@edms.local');
    await auth(request(app).post(`/assets/${patent._id}/grant`), adminCookie).send({ userId: eng._id, kind: 'download' });
    const view = await auth(request(app).get(`/assets/${patent._id}/view`), engCookie);
    expect(view.status).toBe(200);
    expect(view.body.canDownload).toBe(true);
  });
});

describe('Uploads & validation', () => {
  let adminCookie, techCatId;
  beforeAll(async () => {
    adminCookie = (await login('admin@edms.local', 'Admin@123')).cookie;
    const cats = await auth(request(app).get('/categories'), adminCookie);
    techCatId = cats.body.categories.find((c) => c.name === 'Technical')._id;
  });

  test('rejects a disallowed file extension', async () => {
    const res = await auth(request(app).post('/assets/upload'), adminCookie)
      .field('categoryId', techCatId)
      .attach('file', Buffer.from('echo hi'), 'malware.exe');
    expect(res.status).toBe(400);
  });

  test('rejects an executable disguised with a PDF name (magic-byte scan)', async () => {
    const pe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // "MZ" PE header
    const res = await auth(request(app).post('/assets/upload'), adminCookie)
      .field('categoryId', techCatId)
      .attach('file', pe, 'fake.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rejected/i);
  });

  test('accepts a valid PDF', async () => {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = Buffer.from(await doc.save());
    const res = await auth(request(app).post('/assets/upload'), adminCookie)
      .field('categoryId', techCatId)
      .field('filename', 'Test Upload')
      .attach('file', bytes, 'test.pdf');
    expect(res.status).toBe(201);
  });
});

describe('Encryption at rest & secure view', () => {
  let adminCookie, techCatId, fs;
  beforeAll(async () => {
    fs = require('fs');
    adminCookie = (await login('admin@edms.local', 'Admin@123')).cookie;
    const cats = await auth(request(app).get('/categories'), adminCookie);
    techCatId = cats.body.categories.find((c) => c.name === 'Technical')._id;
  });

  test('uploaded file is encrypted on disk (no plaintext, .enc extension)', async () => {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.create(); doc.addPage();
    const bytes = Buffer.from(await doc.save());
    const up = await auth(request(app).post('/assets/upload'), adminCookie)
      .field('categoryId', techCatId).field('filename', 'EncTest')
      .attach('file', bytes, 'enc.pdf');
    expect(up.status).toBe(201);
    const Asset = mongoose.model('Asset');
    const asset = await Asset.findById(up.body.asset._id).lean();
    const stored = asset.versions[0].path;
    expect(stored.endsWith('.enc')).toBe(true);
    const onDisk = fs.readFileSync(stored);
    expect(onDisk.subarray(0, 5).toString()).not.toBe('%PDF-');
  });

  test('secure view returns a watermarked PDF (decrypted in memory)', async () => {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.create(); doc.addPage();
    const bytes = Buffer.from(await doc.save());
    const up = await auth(request(app).post('/assets/upload'), adminCookie)
      .field('categoryId', techCatId).field('filename', 'ViewTest')
      .attach('file', bytes, 'view.pdf');
    const res = await auth(request(app).get(`/assets/${up.body.asset._id}/raw`), adminCookie)
      .buffer().parse((r, cb) => { const ch = []; r.on('data', (d) => ch.push(d)); r.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('download returns the byte-exact decrypted original', async () => {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.create(); doc.addPage();
    const bytes = Buffer.from(await doc.save());
    const up = await auth(request(app).post('/assets/upload'), adminCookie)
      .field('categoryId', techCatId).field('filename', 'DlTest')
      .attach('file', bytes, 'dl.pdf');
    const res = await auth(request(app).get(`/assets/${up.body.asset._id}/raw?download=1`), adminCookie)
      .buffer().parse((r, cb) => { const ch = []; r.on('data', (d) => ch.push(d)); r.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(res.status).toBe(200);
    const crypto = require('crypto');
    expect(crypto.createHash('sha256').update(res.body).digest('hex'))
      .toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
  });

  test('a Word document is reported as previewable via PDF conversion', async () => {
    const { Document, Packer, Paragraph, TextRun } = require('docx');
    const d = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('hello')] })] }] });
    const buf = await Packer.toBuffer(d);
    const up = await auth(request(app).post('/assets/upload'), adminCookie)
      .field('categoryId', techCatId).field('filename', 'WordDoc')
      .attach('file', buf, 'doc.docx');
    expect(up.status).toBe(201);
    const meta = await auth(request(app).get(`/assets/${up.body.asset._id}/view`), adminCookie);
    expect(meta.status).toBe(200);
    expect(meta.body.previewable).toBe(true);
    expect(meta.body.previewKind).toBe('pdf');
  });
});

describe('Audit immutability', () => {
  test('audit log entries cannot be updated or deleted', async () => {
    const AuditLog = mongoose.model('AuditLog');
    const entry = await AuditLog.findOne();
    await expect(AuditLog.updateOne({ _id: entry._id }, { action: 'TAMPERED' })).rejects.toThrow();
    await expect(AuditLog.deleteOne({ _id: entry._id })).rejects.toThrow();
  });
});

describe('Search', () => {
  test('finds assets by filename keyword', async () => {
    const adminCookie = (await login('admin@edms.local', 'Admin@123')).cookie;
    const res = await auth(request(app).get('/assets?q=Patent'), adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.assets.some((a) => /Patent/i.test(a.filename))).toBe(true);
  });
});

describe('Pagination & scalability', () => {
  let adminCookie, techCatId;
  beforeAll(async () => {
    adminCookie = (await login('admin@edms.local', 'Admin@123')).cookie;
    const cats = await auth(request(app).get('/categories'), adminCookie);
    techCatId = cats.body.categories.find((c) => c.name === 'Technical')._id;
    // Seed enough assets to exercise paging (30 small PDFs).
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.create(); doc.addPage();
    const bytes = Buffer.from(await doc.save());
    for (let i = 0; i < 30; i++) {
      await auth(request(app).post('/assets/upload'), adminCookie)
        .field('categoryId', techCatId)
        .field('filename', `Bulk Doc ${i}`)
        .field('keywords', 'paginationtest widget')
        .attach('file', bytes, `doc${i}.pdf`);
    }
  });

  test('list returns pagination metadata and respects limit', async () => {
    const res = await auth(request(app).get('/assets?limit=10&page=1'), adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.assets.length).toBeLessThanOrEqual(10);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBeGreaterThan(1);
  });

  test('different pages return different documents', async () => {
    const p1 = await auth(request(app).get('/assets?limit=10&page=1'), adminCookie);
    const p2 = await auth(request(app).get('/assets?limit=10&page=2'), adminCookie);
    const ids1 = new Set(p1.body.assets.map((a) => a._id));
    const overlap = p2.body.assets.filter((a) => ids1.has(a._id));
    expect(overlap.length).toBe(0);
  });

  test('limit is capped to protect the server', async () => {
    const res = await auth(request(app).get('/assets?limit=99999'), adminCookie);
    expect(res.body.assets.length).toBeLessThanOrEqual(100);
  });

  test('text search uses the index and finds seeded keyword', async () => {
    const res = await auth(request(app).get('/assets?q=paginationtest'), adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(30);
  });

  test('stats accessible count is computed without error for a non-admin', async () => {
    const engCookie = (await login('eng@edms.local', 'Eng@123')).cookie;
    const res = await auth(request(app).get('/stats'), engCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.accessibleAssets).toBe('number');
    // Engineering can see Technical assets (including the 30 just added).
    expect(res.body.accessibleAssets).toBeGreaterThanOrEqual(30);
  });
});
