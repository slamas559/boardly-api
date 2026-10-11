// Verifies host-only writes and late-join state sync without needing real MongoDB documents:
// Room model statics are stubbed, everything else (socket.io, JWT cookie auth, handlers) is real.
import http from 'http';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import Room from '../../models/Room.js';

// The audio socket module creates a Deepgram client at import time and needs a key to exist
process.env.DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || 'test-deepgram-key';
const { default: socketManager } = await import('../../sockets/index.js');
const { _resetRoomStates } = await import('../../sockets/roomState.js');

const ROOM_ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const HOST_ID = '64b7f0f0f0f0f0f0f0f0f0a1';

let server, io, port;
const clients = [];

const connect = (userId) =>
  new Promise((resolve) => {
    const token = userId ? jwt.sign({ id: userId }, process.env.JWT_SECRET) : null;
    const c = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      extraHeaders: token ? { cookie: `token=${token}` } : {},
    });
    clients.push(c);
    c.on('connect', () => resolve(c));
  });

const join = (c, name) =>
  new Promise((resolve) => {
    c.once('room-state', resolve);
    c.emit('join-room', { roomId: ROOM_ID, user: { id: name, name } });
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  Room.findById = () => ({
    lean: async () => ({
      _id: ROOM_ID,
      creator: HOST_ID,
      currentView: 'whiteboard',
      board: { objects: [], pageCount: 1 },
      pdf: { url: null, currentPage: 1, annotations: [] },
    }),
  });
  Room.updateOne = jest.fn(async () => ({}));

  server = http.createServer();
  io = new Server(server);
  socketManager(io);
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});

afterAll(async () => {
  clients.forEach((c) => c.close());
  _resetRoomStates();
  io.close();
  await new Promise((r) => server.close(r));
});

test('only the verified host can draw; late joiners receive the full board', async () => {
  const host = await connect(HOST_ID);
  const listener = await connect(null);

  const hostState = await join(host, 'host');
  const listenerState = await join(listener, 'listener');
  expect(hostState.isHost).toBe(true);
  expect(listenerState.isHost).toBe(false);

  const received = [];
  listener.on('board-op', (d) => received.push(d));

  // A listener tries to draw and clear the board: must be ignored
  listener.emit('board-op', { room: ROOM_ID, ops: [{ op: 'add', obj: { id: 'evil', type: 'stroke', page: 0, points: [] } }] });
  listener.emit('board-op', { room: ROOM_ID, ops: [{ op: 'clear' }] });
  await wait(100);
  expect(received).toHaveLength(0);

  // The host draws: listener sees it live
  host.emit('board-op', { room: ROOM_ID, ops: [{ op: 'add', obj: { id: 'good', type: 'stroke', page: 0, points: [[1, 2, 0.5]], color: '#000', width: 3 } }] });
  host.emit('board-stroke', { room: ROOM_ID, id: 's2', page: 0, meta: { tool: 'pen', color: '#f00', width: 4, opacity: 1 }, points: [[0, 0, 0.5], [5, 5, 0.5]] });
  await wait(150);
  expect(received.map((d) => d.ops[0].obj.id)).toEqual(['good']);

  // A brand new listener joins late and gets everything drawn so far
  const late = await connect(null);
  const lateState = await join(late, 'late');
  const ids = lateState.board.objects.map((o) => o.id).sort();
  expect(ids).toEqual(['good', 's2']);
  expect(lateState.board.objects.find((o) => o.id === 's2').points).toHaveLength(2);
});

test('only the host can change view and PDF annotations', async () => {
  const host = await connect(HOST_ID);
  const listener = await connect(null);
  await join(host, 'host2');
  await join(listener, 'listener2');

  const views = [];
  const pdfOps = [];
  listener.on('change-view', (v) => views.push(v));
  listener.on('pdf-op', (d) => pdfOps.push(d));

  listener.emit('change-view', { roomId: ROOM_ID, view: 'pdf' });
  listener.emit('pdf-op', { room: ROOM_ID, ops: [{ op: 'add', obj: { id: 'h1', type: 'markup', page: 1, rects: [] } }] });
  await wait(100);
  expect(views).toHaveLength(0);
  expect(pdfOps).toHaveLength(0);

  host.emit('change-view', { roomId: ROOM_ID, view: 'pdf' });
  host.emit('pdf-op', { room: ROOM_ID, ops: [{ op: 'add', obj: { id: 'h1', type: 'markup', page: 1, rects: [[0, 0, 10, 10]], kind: 'highlight', color: '#ff0' } }] });
  await wait(150);
  expect(views).toEqual(['pdf']);
  expect(pdfOps).toHaveLength(1);
});
