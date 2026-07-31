import request from 'supertest';
import { app } from '../../src/server';
import prisma from '../../src/config/database';
import { generateAccessToken } from '../../src/services/authService';

// Mock the document processor so uploads don't call OpenAI/embeddings
jest.mock('../../src/services/documentProcessor', () => ({
  processDocument: jest.fn().mockResolvedValue(undefined),
}));

const TEST_EMAIL = 'doc-test@example.com';
let authToken: string;
let userId: string;
let threadId: string;

beforeAll(async () => {
  // Create a test user
  const user = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      passwordHash: 'not-a-real-hash',
      preferences: { create: {} },
    },
  });
  userId = user.id;
  authToken = generateAccessToken(user.id, user.email);

  // Create a test thread
  const thread = await prisma.thread.create({
    data: {
      userId: user.id,
      model: 'gpt-4o',
      title: 'Document test thread',
    },
  });
  threadId = thread.id;
});

afterAll(async () => {
  // Clean up test data in dependency order
  await prisma.documentChunk.deleteMany({ where: { document: { threadId } } });
  await prisma.document.deleteMany({ where: { threadId } });
  await prisma.thread.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.userPreferences.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

function authGet(path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${authToken}`);
}

function authPost(path: string) {
  return request(app).post(path).set('Authorization', `Bearer ${authToken}`);
}

function authDelete(path: string) {
  return request(app).delete(path).set('Authorization', `Bearer ${authToken}`);
}

const basePath = () => `/api/v1/threads/${threadId}/documents`;

// ---------------------------------------------------------------------------
// POST /api/v1/threads/:threadId/documents  (file upload)
// ---------------------------------------------------------------------------
describe('POST /documents (upload)', () => {
  it('uploads a valid text file and returns 201 with document metadata', async () => {
    const res = await request(app)
      .post(basePath())
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from('hello world'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      threadId,
      title: 'test.txt',
      sourceType: 'file',
      mimeType: 'text/plain',
      status: 'processing',
      contentFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('rejects an unsupported file format with 400 UNSUPPORTED_FORMAT', async () => {
    const res = await request(app)
      .post(basePath())
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from('PK\x03\x04fake-zip-content'), {
        filename: 'archive.zip',
        contentType: 'application/zip',
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/threads/:threadId/documents
// ---------------------------------------------------------------------------
describe('GET /documents (list)', () => {
  it('returns 200 with a documents array', async () => {
    const res = await authGet(basePath());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('documents');
    expect(Array.isArray(res.body.documents)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/threads/:threadId/documents/:documentId
// ---------------------------------------------------------------------------
describe('GET /documents/:documentId', () => {
  let docId: string;

  beforeAll(async () => {
    // Seed a document directly via Prisma
    const doc = await prisma.document.create({
      data: {
        threadId,
        userId,
        title: 'get-test.txt',
        sourceType: 'file',
        mimeType: 'text/plain',
        fileSize: 42,
        contentFingerprint: 'a'.repeat(64),
        status: 'ready',
      },
    });
    docId = doc.id;
  });

  it('returns 200 for an existing document', async () => {
    const res = await authGet(`${basePath()}/${docId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: docId,
      title: 'get-test.txt',
    });
  });

  it('returns 404 for a non-existent document', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await authGet(`${basePath()}/${fakeId}`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/threads/:threadId/documents/:documentId
// ---------------------------------------------------------------------------
describe('DELETE /documents/:documentId', () => {
  let docId: string;

  beforeAll(async () => {
    const doc = await prisma.document.create({
      data: {
        threadId,
        userId,
        title: 'delete-test.txt',
        sourceType: 'file',
        mimeType: 'text/plain',
        fileSize: 10,
        contentFingerprint: 'b'.repeat(64),
        status: 'ready',
      },
    });
    docId = doc.id;
  });

  it('deletes an existing document and returns 204', async () => {
    const res = await authDelete(`${basePath()}/${docId}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 when deleting a non-existent document', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await authDelete(`${basePath()}/${fakeId}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/threads/:threadId/documents/:documentId/cancel
// ---------------------------------------------------------------------------
describe('POST /documents/:documentId/cancel', () => {
  let processingDocId: string;

  beforeAll(async () => {
    const doc = await prisma.document.create({
      data: {
        threadId,
        userId,
        title: 'cancel-test.txt',
        sourceType: 'file',
        mimeType: 'text/plain',
        fileSize: 10,
        contentFingerprint: 'c'.repeat(64),
        status: 'processing',
      },
    });
    processingDocId = doc.id;
  });

  it('cancels a processing document and returns 200', async () => {
    const res = await authPost(`${basePath()}/${processingDocId}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: processingDocId,
      status: 'cancelled',
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/threads/:threadId/documents/check-duplicate
// ---------------------------------------------------------------------------
describe('GET /documents/check-duplicate', () => {
  beforeAll(async () => {
    // Seed a document whose title we can match against
    await prisma.document.create({
      data: {
        threadId,
        userId,
        title: 'existing-file.txt',
        sourceType: 'file',
        mimeType: 'text/plain',
        fileSize: 5,
        contentFingerprint: 'd'.repeat(64),
        status: 'ready',
      },
    });
  });

  it('reports exists:true for a filename that already exists', async () => {
    const res = await authGet(
      `${basePath()}/check-duplicate?filename=existing-file.txt`,
    );

    expect(res.status).toBe(200);
    expect(res.body.filenameMatch.exists).toBe(true);
    expect(res.body.filenameMatch).toHaveProperty('existingDocumentId');
  });

  it('reports exists:false for a filename that does not exist', async () => {
    const res = await authGet(
      `${basePath()}/check-duplicate?filename=nonexistent.txt`,
    );

    expect(res.status).toBe(200);
    expect(res.body.filenameMatch.exists).toBe(false);
  });
});
