// Verifies what the host can open up to listeners: drawing on the board and document, and speaking.
// socket.io, JWT cookie auth and the handlers are real; only the Room model is stubbed.
import http from 'http';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import Room from '../../models/Room.js';

process.env.DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || 'test-deepgram-key';
const { default: socketManager } = await import('../../sockets/index.js');
const { _resetRoomStates, getRoomState } = await import('../../sockets/roomState.js');

const HOST_ID = '64b7f0f0f0f0f0f0f0f0f0a1';
const ROOM = (n) => `64b7f0f0f0f0f0f0f0f0f0${String(n).padStart(2, '0')}`;

let server, io, port;
const clients = [];

const connect = (userId) => new Promise((resolve) => {
  const token = userId ? jwt.sign({ id: userId }, process.env.JWT_SECRET) : null;
  const c = Client(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders: token ? { cookie: `token=${token}` } : {} });
  clients.push(c);
  c.events = [];
  c.onAny((name, payload) => c.events.push([name, payload]));
  c.on('connect', () => resolve(c));
});

const join = (c, room, name, clientId) => new Promise((resolve) => {
  c.once('room-state', resolve);
  c.emit('join-room', { roomId: room, user: { id: name, name, clientId } });
});

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const last = (c, name) => [...c.events].reverse().find(([n]) => n === name)?.[1];
const count = (c, name) => c.events.filter(([n]) => n === name).length;

const box = (id, extra = {}) => ({ id, type: 'shape', kind: 'rect', page: 0, x1: 0, y1: 0, x2: 50, y2: 50, color: '#000', width: 2, ...extra });

beforeAll(async () => {
  Room.findById = () => ({
    lean: async () => ({
      _id: 'x', creator: HOST_ID, currentView: 'whiteboard',
      board: { objects: [], pageCount: 1 }, pdf: { url: null, currentPage: 1, annotations: [] },
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

async function setup(n) {
  const room = ROOM(n);
  const host = await connect(HOST_ID);
  const ana = await connect(null);
  const ben = await connect(null);
  const hostState = await join(host, room, 'Host');
  const anaState = await join(ana, room, 'Ana', 'client-ana-0001');
  await join(ben, room, 'Ben', 'client-ben-0001');
  await wait();
  return { room, host, ana, ben, hostState, anaState };
}

test('listeners cannot draw until the host allows it, and revoking stops them again', async () => {
  const { room, host, ana, ben, anaState } = await setup(1);
  expect(anaState.participantKey).toBe('client-ana-0001');

  ana.emit('board-op', { room, ops: [{ op: 'add', obj: box('a1') }] });
  await wait();
  expect((await getRoomState(room)).board.objects.has('a1')).toBe(false);

  host.emit('access-set', { room, kind: 'draw', key: 'client-ana-0001', allowed: true });
  await wait();
  expect(last(ana, 'access-me')).toEqual({ draw: true, speak: false });
  expect(last(ben, 'access-me')).toEqual({ draw: false, speak: false }); // only Ana was told
  expect(last(host, 'access-state').draw).toEqual(['client-ana-0001']);

  ana.emit('board-op', { room, ops: [{ op: 'add', obj: box('a2') }] });
  await wait();
  const state = await getRoomState(room);
  expect(state.board.objects.get('a2').by).toBe('client-ana-0001'); // stamped by the server
  expect(count(host, 'board-op')).toBe(1); // the host sees it live
  expect(count(ben, 'board-op')).toBe(1);

  ben.emit('board-op', { room, ops: [{ op: 'add', obj: box('b1') }] });
  await wait();
  expect(state.board.objects.has('b1')).toBe(false);

  host.emit('access-set', { room, kind: 'draw', key: 'client-ana-0001', allowed: false });
  await wait();
  expect(last(ana, 'access-me').draw).toBe(false);
  ana.emit('board-op', { room, ops: [{ op: 'add', obj: box('a3') }] });
  await wait();
  expect(state.board.objects.has('a3')).toBe(false);
});

test('a listener can only change their own objects and cannot clear the page', async () => {
  const { room, host, ana, ben } = await setup(2);
  host.emit('board-op', { room, ops: [{ op: 'add', obj: box('h1') }] });
  host.emit('access-set', { room, kind: 'draw', allowed: true }); // everyone
  await wait();
  expect(last(ben, 'access-flags')).toEqual({ drawAll: true, speakAll: false });

  ana.emit('board-op', { room, ops: [{ op: 'add', obj: box('a1') }] });
  await wait();
  ben.emit('board-op', { room, ops: [
    { op: 'update', id: 'h1', patch: { color: '#f00' } }, // the host's object
    { op: 'update', id: 'a1', patch: { color: '#f00' } }, // Ana's object
    { op: 'remove', id: 'h1' },
    { op: 'add', obj: box('b1') },
  ] });
  ana.emit('board-op', { room, ops: [{ op: 'clear', page: 0 }, { op: 'update', id: 'a1', patch: { color: '#0f0', by: 'someone-else' } }, { op: 'add', obj: { id: 'p1', type: 'paper', page: 0 } }] });
  await wait();

  const { objects } = (await getRoomState(room)).board;
  expect(objects.get('h1').color).toBe('#000');
  expect(objects.get('a1').color).toBe('#0f0');
  expect(objects.get('a1').by).toBe('client-ana-0001'); // the author cannot be rewritten
  expect(objects.has('b1')).toBe(true);
  expect(objects.has('p1')).toBe(false);
});

test('live strokes from a listener are stamped, relayed, and cannot hijack another stroke', async () => {
  const { room, host, ana, ben } = await setup(3);
  host.emit('board-stroke', { room, id: 'hs', page: 0, meta: { tool: 'pen', color: '#000', width: 3 }, points: [[0, 0, 0.5]] });
  host.emit('access-set', { room, kind: 'draw', key: 'client-ana-0001', allowed: true });
  await wait();

  ana.emit('board-stroke', { room, id: 'as', page: 0, meta: { tool: 'pen', color: '#000', width: 3, by: 'fake' }, points: [[1, 1, 0.5]] });
  ana.emit('board-stroke', { room, id: 'hs', page: 0, points: [[9, 9, 0.5]] }); // the host's stroke
  await wait();

  const { objects } = (await getRoomState(room)).board;
  expect(objects.get('as').by).toBe('client-ana-0001');
  expect(objects.get('hs').points).toHaveLength(1);
  const relayed = ben.events.filter(([n, p]) => n === 'board-stroke' && p.id === 'as');
  expect(relayed[0][1].meta.by).toBe('client-ana-0001');
  expect(host.events.some(([n, p]) => n === 'board-stroke' && p.id === 'as')).toBe(true);
});

test('document annotations follow the same rules; page and document control stay with the host', async () => {
  const { room, host, ana } = await setup(4);
  host.emit('access-set', { room, kind: 'draw', key: 'client-ana-0001', allowed: true });
  await wait();
  ana.emit('pdf-op', { room, ops: [{ op: 'add', obj: { id: 'n1', type: 'stroke', page: 1, tool: 'pen', color: '#000', width: 3, points: [[0, 0, 0.5]] } }] });
  ana.emit('pdf-page-change', { room, page: 3 });
  ana.emit('board-page', { room, page: 2 });
  ana.emit('pdf-updated', { room, url: 'https://example.com/x.pdf' });
  await wait();
  const state = await getRoomState(room);
  expect(state.pdf.annotations.get('n1').by).toBe('client-ana-0001');
  expect(state.pdf.currentPage).toBe(1);
  expect(state.board.page).toBe(0);
  expect(state.pdf.url).toBe(null);
});

test('only the host can change permissions, and late joiners are told what is open', async () => {
  const { room, host, ana } = await setup(5);
  ana.emit('access-set', { room, kind: 'draw', allowed: true });
  ana.emit('access-set', { room, kind: 'speak', key: 'client-ana-0001', allowed: true });
  await wait();
  expect(last(ana, 'access-flags')).toEqual({ drawAll: false, speakAll: false });

  host.emit('access-set', { room, kind: 'speak', key: 'client-ben-0001', allowed: true });
  host.emit('access-set', { room, kind: 'draw', allowed: true });
  host.emit('access-set', { room, kind: 'draw', key: 'bad key!', allowed: true }); // invalid key is ignored
  await wait();

  const late = await connect(null);
  await join(late, room, 'Late', 'client-late-0001');
  await wait();
  expect(last(late, 'access-flags')).toEqual({ drawAll: true, speakAll: false });
  expect(last(late, 'access-me')).toEqual({ draw: false, speak: false });
  expect(last(late, 'access-state')).toBeUndefined(); // the full list is for the host only
  expect(last(host, 'access-state').speak).toEqual(['client-ben-0001']);
});

test('the host receives the participant list with a key for each person', async () => {
  const { host } = await setup(6);
  await wait(600); // joins are batched into one update, sent a moment after the last join
  const roster = last(host, 'room-roster').userList;
  expect(roster.map((u) => u.key).sort()).toEqual(['client-ana-0001', 'client-ben-0001', HOST_ID].sort());
  expect(roster.find((u) => u.key === HOST_ID).isTutor).toBe(true);
});

test('voice passes: listeners can listen, only the host and allowed speakers can publish', async () => {
  const { room, host, ana, ben } = await setup(7);
  const ask = (c) => new Promise((resolve) => c.emit('voice-token', { roomId: room }, resolve));

  expect((await ask(host)).ok).toBe(false); // voice is not set up yet
  Object.assign(process.env, { LIVEKIT_URL: 'wss://example.livekit.cloud', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'x'.repeat(40) });
  try {
    expect((await ask(ana)).ok).toBe(false); // no session running yet
    host.emit('voice-broadcast-started', { roomId: room });
    await wait();
    expect(count(ana, 'voice-broadcast-started')).toBe(1);

    const hostPass = await ask(host);
    expect(hostPass.ok).toBe(true);
    expect(hostPass.url).toBe('wss://example.livekit.cloud');
    expect(jwt.decode(hostPass.token).video.canPublish).toBe(true);

    expect(jwt.decode((await ask(ana)).token).video.canPublish).toBe(false);

    host.emit('access-set', { room, kind: 'speak', key: 'client-ana-0001', allowed: true });
    await wait();
    const anaPass = await ask(ana);
    expect(anaPass.canSpeak).toBe(true);
    expect(jwt.decode(anaPass.token).video.canPublish).toBe(true);
    expect(jwt.decode((await ask(ben)).token).video.canPublish).toBe(false);

    host.emit('access-set', { room, kind: 'speak', allowed: true }); // everyone
    await wait();
    expect(jwt.decode((await ask(ben)).token).video.canPublish).toBe(true);

    // listeners cannot start or end the session
    ben.emit('voice-broadcast-ended', { roomId: room });
    await wait();
    expect(count(host, 'voice-broadcast-ended')).toBe(0);

    // a late joiner learns the session is running
    const late = await connect(null);
    await join(late, room, 'Late', 'client-late-0002');
    late.emit('request-broadcast-status', { roomId: room });
    await wait();
    expect(count(late, 'voice-broadcast-started')).toBe(1);

    host.emit('voice-broadcast-ended', { roomId: room });
    await wait();
    expect(count(ana, 'voice-broadcast-ended')).toBe(1);
  } finally {
    delete process.env.LIVEKIT_URL;
  }
});
