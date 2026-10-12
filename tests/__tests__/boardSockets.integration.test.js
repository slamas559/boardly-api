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
  const previews = [];
  const pointers = [];
  listener.on('board-op', (d) => received.push(d));
  listener.on('board-preview', (d) => previews.push(d));
  listener.on('pointer', (d) => pointers.push(d));

  // A listener tries to draw and clear the board: must be ignored
  listener.emit('board-op', { room: ROOM_ID, ops: [{ op: 'add', obj: { id: 'evil', type: 'stroke', page: 0, points: [] } }] });
  listener.emit('board-op', { room: ROOM_ID, ops: [{ op: 'clear' }] });
  await wait(100);
  expect(received).toHaveLength(0);

  // The host draws: listener sees it live
  host.emit('board-op', { room: ROOM_ID, ops: [{ op: 'add', obj: { id: 'good', type: 'stroke', page: 0, points: [[1, 2, 0.5]], color: '#000', width: 3 } }] });
  host.emit('board-op', { room: ROOM_ID, ops: [
    { op: 'add', obj: { id: 'graph1', type: 'graph', page: 0, expression: 'x^2', x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10, geometry: [{ id: 'p1', kind: 'point', label: 'A', x: 2, y: 4 }] } },
    { op: 'add', obj: { id: 'graph2', type: 'graph', page: 0, mode: 'implicit', expression: 'x^2 + y^2 = 25', x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10 } },
    { op: 'add', obj: { id: 'graph3', type: 'graph', page: 0, mode: 'parametric', expression: 'x(t), y(t)', xExpression: 'cos(t)', yExpression: 'sin(t)', tMin: 0, tMax: 6.28, x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10 } },
    { op: 'add', obj: { id: 'graph4', type: 'graph', page: 0, mode: 'polar', expression: '2 + cos(5t)', tMin: 0, tMax: 6.28, x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10 } },
    { op: 'add', obj: { id: 'graph5', type: 'graph', page: 0, mode: 'inequality', expression: 'y > 2x + 1\nx^2 + y^2 <= 16', x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10 } },
    { op: 'add', obj: { id: 'graph6', type: 'graph', page: 0, mode: 'surface3d', expression: 'x^2 - y^2', x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10, zMin: -10, zMax: 10, azimuth: 42, elevation: 32 } },
    { op: 'add', obj: { id: 'graph7', type: 'graph', page: 0, mode: 'curve3d', expression: 'x(t), y(t), z(t)', xExpression: 'cos(t)', yExpression: 'sin(t)', zExpression: 't', tMin: 0, tMax: 6.28, x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10, zMin: -10, zMax: 10, azimuth: 42, elevation: 32 } },
    { op: 'add', obj: { id: 'graph8', type: 'graph', page: 0, mode: 'parametricSurface3d', expression: 'x(u,v), y(u,v), z(u,v)', xExpression: 'cos(u)', yExpression: 'sin(u)', zExpression: 'v', uMin: 0, uMax: 6.28, vMin: -1, vMax: 1, x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10, zMin: -10, zMax: 10, azimuth: 42, elevation: 32 } },
    { op: 'add', obj: { id: 'table1', type: 'table', page: 0, x: 0, y: 0, rows: 1, cols: 2, cellWidth: 110, cellHeight: 40, cells: ['x', 'y'] } },
  ] });
  host.emit('board-preview', {
    room: ROOM_ID, id: 'graph6', page: 0, active: true,
    obj: { id: 'graph6', type: 'graph', page: 0, mode: 'surface3d', expression: 'x^2 - y^2', x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10, zMin: -10, zMax: 10, azimuth: 111, elevation: 44 },
  });
  host.emit('board-stroke', { room: ROOM_ID, id: 's2', page: 0, meta: { tool: 'pen', color: '#f00', width: 4, opacity: 1 }, points: [[0, 0, 0.5], [5, 5, 0.5]] });
  await wait(150);
  expect(received.flatMap((d) => d.ops).map((op) => op.obj.id)).toEqual(['good', 'graph1', 'graph2', 'graph3', 'graph4', 'graph5', 'graph6', 'graph7', 'graph8', 'table1']);
  expect(previews).toEqual([expect.objectContaining({ id: 'graph6', active: true, obj: expect.objectContaining({ azimuth: 111 }) })]);
  host.emit('board-op', { room: ROOM_ID, ops: [{ op: 'update', id: 'graph6', patch: { azimuth: 73, elevation: 41 } }] });
  host.emit('board-preview', { room: ROOM_ID, id: 'graph6', page: 0, active: false });
  await wait(100);
  expect(received.at(-1).ops).toEqual([{ op: 'update', id: 'graph6', patch: { azimuth: 73, elevation: 41 } }]);
  expect(previews.at(-1)).toEqual({ id: 'graph6', page: 0, obj: null, active: false });
  host.emit('pointer', { room: ROOM_ID, view: 'board', page: 0, x: 4, y: 8, active: true, tool: 'pen', angle: 0.7 });
  await wait(25);
  expect(pointers.at(-1)).toEqual({ view: 'board', page: 0, x: 4, y: 8, active: true, tool: 'pen', angle: 0.7 });

  // A brand new listener joins late and gets everything drawn so far
  const late = await connect(null);
  const lateState = await join(late, 'late');
  const ids = lateState.board.objects.map((o) => o.id).sort();
  expect(ids).toEqual(['good', 'graph1', 'graph2', 'graph3', 'graph4', 'graph5', 'graph6', 'graph7', 'graph8', 's2', 'table1']);
  expect(lateState.board.objects.find((o) => o.id === 's2').points).toHaveLength(2);
  expect(lateState.board.objects.find((o) => o.id === 'graph1').expression).toBe('x^2');
  expect(lateState.board.objects.find((o) => o.id === 'graph1').geometry).toEqual([{ id: 'p1', kind: 'point', label: 'A', x: 2, y: 4 }]);
  expect(lateState.board.objects.find((o) => o.id === 'graph2').expression).toBe('x^2 + y^2 = 25');
  expect(lateState.board.objects.find((o) => o.id === 'graph3').yExpression).toBe('sin(t)');
  expect(lateState.board.objects.find((o) => o.id === 'graph4').mode).toBe('polar');
  expect(lateState.board.objects.find((o) => o.id === 'graph5').expression).toBe('y > 2x + 1\nx^2 + y^2 <= 16');
  expect(lateState.board.objects.find((o) => o.id === 'graph6').mode).toBe('surface3d');
  expect(lateState.board.objects.find((o) => o.id === 'graph6').azimuth).toBe(73);
  expect(lateState.board.objects.find((o) => o.id === 'graph7').zExpression).toBe('t');
  expect(lateState.board.objects.find((o) => o.id === 'graph8').mode).toBe('parametricSurface3d');
  expect(lateState.board.objects.find((o) => o.id === 'table1').cells).toEqual(['x', 'y']);
});

test('only the host can change view and PDF annotations', async () => {
  const host = await connect(HOST_ID);
  const listener = await connect(null);
  await join(host, 'host2');
  await join(listener, 'listener2');

  const views = [];
  const pdfOps = [];
  const pdfPreviews = [];
  listener.on('change-view', (v) => views.push(v));
  listener.on('pdf-op', (d) => pdfOps.push(d));
  listener.on('pdf-preview', (d) => pdfPreviews.push(d));

  listener.emit('change-view', { roomId: ROOM_ID, view: 'pdf' });
  listener.emit('pdf-op', { room: ROOM_ID, ops: [{ op: 'add', obj: { id: 'h1', type: 'markup', page: 1, rects: [] } }] });
  listener.emit('pdf-preview', { room: ROOM_ID, id: 'text1', page: 1, obj: { id: 'text1', type: 'text', page: 1, text: 'forbidden' } });
  await wait(100);
  expect(views).toHaveLength(0);
  expect(pdfOps).toHaveLength(0);
  expect(pdfPreviews).toHaveLength(0);

  host.emit('change-view', { roomId: ROOM_ID, view: 'pdf' });
  host.emit('pdf-preview', { room: ROOM_ID, id: 'text1', page: 1, obj: { id: 'text1', type: 'text', page: 1, text: 'draft' } });
  await wait(50);
  expect(pdfPreviews).toEqual([{
    id: 'text1', page: 1, obj: { id: 'text1', type: 'text', page: 1, text: 'draft' }, active: true,
  }]);
  host.emit('pdf-preview', { room: ROOM_ID, id: 'text1', page: 1, active: false });
  host.emit('pdf-op', { room: ROOM_ID, ops: [{ op: 'add', obj: { id: 'h1', type: 'markup', page: 1, rects: [[0, 0, 10, 10]], kind: 'highlight', color: '#ff0' } }] });
  await wait(150);
  expect(views).toEqual(['pdf']);
  expect(pdfOps).toHaveLength(1);
  expect(pdfPreviews.at(-1)).toEqual({ id: 'text1', page: 1, obj: null, active: false });
});
