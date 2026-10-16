import { jest } from '@jest/globals';
import activityEvents, {
  ACTIVITY_LIMITS, _resetActivities, closeActivity, createActivity, hostView, isCorrect, parseAnswerNumber, participantKey, releaseActivity,
  revealActivity, sendActivityState, studentView, submitResponse, summarize, validImage,
} from '../../sockets/activity.js';
import { markHost } from '../../sockets/permissions.js';

// A just-big-enough PNG / JPEG data URL (the checks look at the signature, not at a decoded picture)
const PNG = `data:image/png;base64,iVBORw0KGgo${'A'.repeat(100)}`;
const JPG = `data:image/jpeg;base64,/9j/${'A'.repeat(100)}`;

/* A tiny stand-in for socket.io: sockets that remember what they were sent, in rooms */
function makeServer() {
  const rooms = new Map();
  const sockets = new Map();
  const io = { sockets: { adapter: { rooms }, sockets } };
  let nextId = 1;
  const connect = (roomId, { host = false, userId = null, clientId = null, name = 'Guest' } = {}) => {
    const handlers = {};
    const socket = {
      id: `s${nextId++}`,
      data: { userId, clientId, displayName: name },
      rooms: new Set([roomId]),
      sent: [],
      on: (event, handler) => { handlers[event] = handler; },
      emit: (event, payload) => socket.sent.push([event, payload]),
      trigger: (event, payload) => handlers[event]?.(payload),
      last: (event) => [...socket.sent].reverse().find(([name]) => name === event)?.[1],
      all: (event) => socket.sent.filter(([name]) => name === event).map(([, payload]) => payload),
    };
    if (host) markHost(socket, roomId);
    sockets.set(socket.id, socket);
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socket.id);
    activityEvents(socket, io);
    return socket;
  };
  return { io, connect };
}

describe('activity rules', () => {
  test('numbers are read from the ways students type them', () => {
    expect(parseAnswerNumber('12')).toBe(12);
    expect(parseAnswerNumber(' -3.5 ')).toBe(-3.5);
    expect(parseAnswerNumber('−4')).toBe(-4);
    expect(parseAnswerNumber('3,5')).toBe(3.5);
    expect(parseAnswerNumber('3/4')).toBe(0.75);
    expect(parseAnswerNumber('-1/2')).toBe(-0.5);
    expect(parseAnswerNumber('1e3')).toBe(1000);
    expect(parseAnswerNumber(7)).toBe(7);
    for (const bad of ['', 'abc', '1/0', '1,2,3', '12 apples', '--3', '1e400', '9'.repeat(40), null, undefined, NaN, Infinity, {}, [], '0x10']) {
      expect(parseAnswerNumber(bad)).toBeNull();
    }
    expect(parseAnswerNumber(1e10)).toBeNull();
  });

  test('only real PNG or JPEG data URLs of a sensible size count as drawings', () => {
    expect(validImage(PNG)).toBe(true);
    expect(validImage(JPG)).toBe(true);
    expect(validImage('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(validImage('data:image/png;base64,AAAA')).toBe(false); // not a PNG inside
    expect(validImage(`data:image/jpeg;base64,iVBORw0KGgo${'A'.repeat(50)}`)).toBe(false); // PNG bytes labelled JPEG
    expect(validImage('data:text/html;base64,PGgxPg==')).toBe(false);
    expect(validImage('https://example.com/a.png')).toBe(false);
    expect(validImage(`${PNG}<script>`)).toBe(false);
    expect(validImage(`data:image/png;base64,iVBORw0KGgo${'A'.repeat(ACTIVITY_LIMITS.image)}`)).toBe(false); // too big
    expect(validImage(42)).toBe(false);
  });

  test('a question needs a prompt and sensible choices', () => {
    expect(createActivity({ kind: 'choice', prompt: '  What is 2 + 2?  ', options: ['3', '4', '  5 '], correct: 1 }).activity.options).toEqual(['3', '4', '5']);
    expect(createActivity({ kind: 'choice', prompt: '', options: ['a', 'b'] }).ok).toBe(false);
    expect(createActivity({ kind: 'choice', prompt: 'q', options: ['only'] }).ok).toBe(false);
    expect(createActivity({ kind: 'choice', prompt: 'q', options: ['a', ' ', ''] }).ok).toBe(false); // blanks do not count
    expect(createActivity({ kind: 'choice', prompt: 'q', options: ['1', '2', '3', '4', '5', '6', '7'] }).ok).toBe(false);
    expect(createActivity({ kind: 'choice', prompt: 'q', options: ['a', 'b'], correct: 2 }).ok).toBe(false);
    expect(createActivity({ kind: 'choice', prompt: 'q', options: ['a', 'b'], correct: 1.5 }).ok).toBe(false);
    expect(createActivity({ kind: 'choice', prompt: 'q', options: ['a', 'b'] }).activity.correct).toBeUndefined(); // a poll with no right answer
    expect(createActivity({ kind: 'quiz', prompt: 'q' }).ok).toBe(false);
    expect(createActivity(null).ok).toBe(false);
    expect(createActivity({ kind: 'work', prompt: 'x'.repeat(500) }).activity.prompt).toHaveLength(ACTIVITY_LIMITS.prompt);
    const number = createActivity({ kind: 'number', prompt: 'q', answer: '3/4', tolerance: '0.01' }).activity;
    expect([number.answer, number.tolerance]).toEqual([0.75, 0.01]);
    expect(createActivity({ kind: 'number', prompt: 'q', answer: 'abc' }).ok).toBe(false);
    expect(createActivity({ kind: 'number', prompt: 'q', answer: 5, tolerance: -1 }).ok).toBe(false);
    expect(createActivity({ kind: 'number', prompt: 'q' }).ok).toBe(true);
  });

  test('answers are checked automatically', () => {
    const choice = createActivity({ kind: 'choice', prompt: 'q', options: ['a', 'b', 'c'], correct: 2 }).activity;
    expect([isCorrect(choice, 2), isCorrect(choice, 0)]).toEqual([true, false]);
    const number = createActivity({ kind: 'number', prompt: 'q', answer: 10, tolerance: 0.5 }).activity;
    expect([isCorrect(number, 10), isCorrect(number, 10.5), isCorrect(number, 9.5), isCorrect(number, 10.6), isCorrect(number, 9)]).toEqual([true, true, true, false, false]);
    const exact = createActivity({ kind: 'number', prompt: 'q', answer: 0.3 }).activity;
    expect(isCorrect(exact, 0.1 + 0.2)).toBe(true); // floating point noise does not mark a right answer wrong
    expect(isCorrect(createActivity({ kind: 'choice', prompt: 'q', options: ['a', 'b'] }).activity, 0)).toBeNull(); // no right answer set
    expect(isCorrect(createActivity({ kind: 'work', prompt: 'q' }).activity, PNG)).toBeNull();
  });

  test('students can answer, change their answer and are refused when closed or out of range', () => {
    const activity = createActivity({ kind: 'choice', prompt: 'q', options: ['a', 'b', 'c'], correct: 1 }).activity;
    expect(submitResponse(activity, 'u:1', 'Ada', 0).response.correct).toBe(false);
    expect(submitResponse(activity, 'u:1', 'Ada', 1).response.correct).toBe(true); // changed their mind
    expect(activity.responses.size).toBe(1); // still one answer per student
    expect(submitResponse(activity, 'u:2', 'Bola', 3).ok).toBe(false);
    expect(submitResponse(activity, 'u:2', 'Bola', -1).ok).toBe(false);
    expect(submitResponse(activity, 'u:2', 'Bola', '1').ok).toBe(false); // must be a real index
    expect(submitResponse(activity, 'u:2', 'Bola', null).ok).toBe(false);
    closeActivity(activity);
    expect(submitResponse(activity, 'u:3', 'Chi', 1)).toEqual({ ok: false, error: 'This question is closed.' });
    expect(activity.responses.size).toBe(1);
    expect(submitResponse(null, 'u:3', 'Chi', 1).ok).toBe(false);
  });

  test('number and drawing answers are validated', () => {
    const number = createActivity({ kind: 'number', prompt: 'q', answer: 4 }).activity;
    expect(submitResponse(number, 'a', 'A', '4').response.value).toBe(4);
    expect(submitResponse(number, 'b', 'B', 'four').ok).toBe(false);
    const work = createActivity({ kind: 'work', prompt: 'q' }).activity;
    expect(submitResponse(work, 'a', 'A', PNG).ok).toBe(true);
    expect(submitResponse(work, 'b', 'B', 'data:image/svg+xml;base64,AAAA').ok).toBe(false);
    expect(submitResponse(work, 'c', 'C', 5).ok).toBe(false);
  });

  test('the number of answers is capped, but existing students can still change theirs', () => {
    const activity = createActivity({ kind: 'number', prompt: 'q' }).activity;
    for (let i = 0; i < ACTIVITY_LIMITS.responses; i++) expect(submitResponse(activity, `k${i}`, 'S', i).ok).toBe(true);
    expect(submitResponse(activity, 'extra', 'S', 1).ok).toBe(false);
    expect(submitResponse(activity, 'k0', 'S', 99).ok).toBe(true);
  });

  test('names are cleaned and long ones cut', () => {
    const activity = createActivity({ kind: 'number', prompt: 'q' }).activity;
    expect(submitResponse(activity, 'a', '   Ada    Obi\n', 1).response.name).toBe('Ada Obi');
    expect(submitResponse(activity, 'b', 'x'.repeat(200), 1).response.name).toHaveLength(ACTIVITY_LIMITS.name);
    expect(submitResponse(activity, 'c', '', 1).response.name).toBe('Student');
    expect(submitResponse(activity, 'd', undefined, 1).response.name).toBe('Student');
  });

  test('a student never sees the right answer or anyone else\'s answer before the reveal', () => {
    const activity = createActivity({ kind: 'choice', prompt: 'q', options: ['a', 'b', 'c'], correct: 1 }).activity;
    submitResponse(activity, 'u:ada', 'Ada', 1);
    submitResponse(activity, 'u:bola', 'Bola', 2);
    const before = studentView(activity, 'u:bola');
    expect(before.mine.value).toBe(2);
    expect(JSON.stringify(before)).not.toMatch(/Ada|"correct"|results|mineCorrect/);
    expect(studentView(activity, 'u:nobody').mine).toBeNull();
    closeActivity(activity);
    expect(JSON.stringify(studentView(activity, 'u:bola'))).not.toMatch(/"correct"|results/); // closed is not revealed
    revealActivity(activity);
    const after = studentView(activity, 'u:bola');
    expect(after.correct).toBe(1);
    expect(after.mineCorrect).toBe(false);
    expect(after.results).toEqual({ total: 2, counts: [0, 1, 1], correctCount: 1 });
    expect(JSON.stringify(after)).not.toMatch(/Ada|Bola/); // results carry no names
    expect(hostView(activity).responses.map((r) => r.name)).toEqual(['Ada', 'Bola']); // the host sees who answered
    expect(hostView(activity).correct).toBe(1);
  });

  test('number results are summarised for the class', () => {
    const activity = createActivity({ kind: 'number', prompt: 'q', answer: 5 }).activity;
    [['a', 3], ['b', 5], ['c', 5], ['d', 9]].forEach(([key, value]) => submitResponse(activity, key, key, value));
    expect(summarize(activity)).toEqual({ total: 4, values: [3, 5, 5, 9], mean: 5.5, median: 5, correctCount: 2 });
    expect(summarize(createActivity({ kind: 'number', prompt: 'q' }).activity)).toEqual({ total: 0, values: [], mean: null, median: null, correctCount: 0 });
  });

  test('drawings are never part of the class results', () => {
    const activity = createActivity({ kind: 'work', prompt: 'q' }).activity;
    submitResponse(activity, 'u:1', 'Ada', PNG);
    revealActivity(activity);
    expect(JSON.stringify(studentView(activity, 'u:2'))).not.toContain('iVBORw0KGgo');
    expect(summarize(activity)).toEqual({ total: 1 });
  });

  test('who someone is stays the same after reconnecting', () => {
    expect(participantKey({ id: 's1', data: { userId: '42' } })).toBe('u:42');
    expect(participantKey({ id: 's1', data: { userId: null, clientId: 'abcd1234' } })).toBe('g:abcd1234');
    expect(participantKey({ id: 's9', data: {} })).toBe('s:s9');
  });
});

describe('activity over sockets', () => {
  beforeEach(() => _resetActivities());

  const ROOM = 'room1';
  const choiceSpec = { kind: 'choice', prompt: 'What is 2 + 2?', options: ['3', '4', '5'], correct: 1 };

  test('only the host can start, close, reveal or end a question', () => {
    const { io, connect } = makeServer();
    const host = connect(ROOM, { host: true });
    const student = connect(ROOM, { name: 'Ada' });
    student.trigger('activity-start', { roomId: ROOM, spec: choiceSpec });
    expect(host.last('activity-state')).toBeUndefined(); // nothing happened
    host.trigger('activity-start', { roomId: ROOM, spec: choiceSpec });
    expect(host.last('activity-state').activity.prompt).toBe('What is 2 + 2?');
    student.trigger('activity-close', { roomId: ROOM });
    student.trigger('activity-reveal', { roomId: ROOM });
    student.trigger('activity-end', { roomId: ROOM });
    expect(host.last('activity-state').activity.status).toBe('open');
    expect(student.last('activity-state').activity.status).toBe('open');
    host.trigger('activity-close', { roomId: ROOM });
    expect(student.last('activity-state').activity.status).toBe('closed');
    host.trigger('activity-end', { roomId: ROOM });
    expect(student.last('activity-state').activity).toBeNull();
    expect(io).toBeTruthy();
  });

  test('a signed-in student cannot pose as the host by sending host events from another room', () => {
    const { connect } = makeServer();
    const host = connect('other-room', { host: true });
    const student = connect(ROOM);
    student.rooms.add('other-room');
    student.trigger('activity-start', { roomId: 'other-room', spec: choiceSpec });
    expect(host.last('activity-state')).toBeUndefined();
  });

  test('the host sees each answer as it arrives and students only see their own', () => {
    const { connect } = makeServer();
    const host = connect(ROOM, { host: true });
    const ada = connect(ROOM, { userId: '1', name: 'Ada' });
    const bola = connect(ROOM, { userId: '2', name: 'Bola' });
    host.trigger('activity-start', { roomId: ROOM, spec: choiceSpec });
    const id = host.last('activity-state').activity.id;
    ada.trigger('activity-respond', { roomId: ROOM, activityId: id, value: 1 });
    bola.trigger('activity-respond', { roomId: ROOM, activityId: id, value: 0 });
    expect(ada.last('activity-ack').mine.value).toBe(1);
    expect(host.all('activity-response').map((m) => [m.response.name, m.response.value, m.response.correct])).toEqual([['Ada', 1, true], ['Bola', 0, false]]);
    expect(ada.all('activity-response')).toHaveLength(0);
    expect(bola.all('activity-response')).toHaveLength(0);
    // Reveal: each student learns whether they were right, with class counts
    host.trigger('activity-reveal', { roomId: ROOM });
    expect(ada.last('activity-state').activity.mineCorrect).toBe(true);
    expect(bola.last('activity-state').activity.mineCorrect).toBe(false);
    expect(bola.last('activity-state').activity.results.counts).toEqual([1, 1, 0]);
    // After that no more answers are accepted
    ada.trigger('activity-respond', { roomId: ROOM, activityId: id, value: 0 });
    expect(ada.last('activity-error').message).toBe('This question is closed.');
  });

  test('answers must be for the current question and from someone in the room', () => {
    const { connect } = makeServer();
    const host = connect(ROOM, { host: true });
    const ada = connect(ROOM, { userId: '1' });
    const outsider = connect('elsewhere', { userId: '9' });
    host.trigger('activity-start', { roomId: ROOM, spec: choiceSpec });
    const id = host.last('activity-state').activity.id;
    ada.trigger('activity-respond', { roomId: ROOM, activityId: 'old-question', value: 1 });
    expect(ada.last('activity-error').message).toBe('That question has ended.');
    outsider.trigger('activity-respond', { roomId: ROOM, activityId: id, value: 1 });
    expect(outsider.sent).toHaveLength(0);
    host.trigger('activity-respond', { roomId: ROOM, activityId: id, value: 1 }); // the host asks, they do not answer
    expect(host.all('activity-response')).toHaveLength(0);
    ada.trigger('activity-respond', { roomId: 42, activityId: id, value: 1 });
    ada.trigger('activity-respond', undefined);
    expect(host.all('activity-response')).toHaveLength(0);
  });

  test('a reconnecting guest keeps their answer and cannot vote twice', () => {
    const { connect } = makeServer();
    const host = connect(ROOM, { host: true });
    const first = connect(ROOM, { clientId: 'guest-abcd1234', name: 'Guest' });
    host.trigger('activity-start', { roomId: ROOM, spec: choiceSpec });
    const id = host.last('activity-state').activity.id;
    first.trigger('activity-respond', { roomId: ROOM, activityId: id, value: 2 });
    const again = connect(ROOM, { clientId: 'guest-abcd1234', name: 'Guest' }); // same browser, new socket
    sendActivityState(again, ROOM);
    expect(again.last('activity-state').activity.mine.value).toBe(2);
    again.trigger('activity-respond', { roomId: ROOM, activityId: id, value: 0 });
    expect(host.last('activity-response').response.value).toBe(0);
    host.trigger('activity-close', { roomId: ROOM });
    expect(host.last('activity-state').activity.responses).toHaveLength(1); // one student, one answer
  });

  test('someone who joins late gets the running question, and a new host session starts clean', () => {
    const { connect } = makeServer();
    const host = connect(ROOM, { host: true });
    host.trigger('activity-start', { roomId: ROOM, spec: choiceSpec });
    const late = connect(ROOM, { userId: '5' });
    sendActivityState(late, ROOM);
    expect(late.last('activity-state')).toMatchObject({ role: 'student', activity: { prompt: 'What is 2 + 2?', status: 'open', mine: null } });
    expect(JSON.stringify(late.last('activity-state'))).not.toContain('"correct"');
    releaseActivity(ROOM);
    sendActivityState(late, ROOM);
    expect(late.last('activity-state').activity).toBeNull();
  });

  test('an invalid question is refused with a reason the host can read', () => {
    const { connect } = makeServer();
    const host = connect(ROOM, { host: true });
    host.trigger('activity-start', { roomId: ROOM, spec: { kind: 'choice', prompt: 'q', options: ['only one'] } });
    expect(host.last('activity-error').message).toMatch(/between 2 and 6/);
    expect(host.last('activity-state')).toBeUndefined();
  });

  test('a student is slowed down if they flood answers', () => {
    const { connect } = makeServer();
    const host = connect(ROOM, { host: true });
    const spammer = connect(ROOM, { userId: '7' });
    host.trigger('activity-start', { roomId: ROOM, spec: { kind: 'number', prompt: 'q' } });
    const id = host.last('activity-state').activity.id;
    for (let i = 0; i < ACTIVITY_LIMITS.perMinute + 10; i++) spammer.trigger('activity-respond', { roomId: ROOM, activityId: id, value: i });
    expect(host.all('activity-response').length).toBe(ACTIVITY_LIMITS.perMinute);
    expect(spammer.last('activity-error').message).toMatch(/Slow down/);
  });

  test('the host can show one drawing to the class, with or without the name', () => {
    const { connect } = makeServer();
    const host = connect(ROOM, { host: true });
    const ada = connect(ROOM, { userId: '1', name: 'Ada' });
    const bola = connect(ROOM, { userId: '2', name: 'Bola' });
    host.trigger('activity-start', { roomId: ROOM, spec: { kind: 'work', prompt: 'Show your working' } });
    const id = host.last('activity-state').activity.id;
    ada.trigger('activity-respond', { roomId: ROOM, activityId: id, value: PNG });
    bola.trigger('activity-respond', { roomId: ROOM, activityId: id, value: JPG });
    expect(bola.last('activity-state').activity.spotlight).toBeNull();
    bola.trigger('activity-spotlight', { roomId: ROOM, key: 'u:1', showName: true }); // students cannot
    expect(bola.last('activity-state').activity.spotlight).toBeNull();
    host.trigger('activity-spotlight', { roomId: ROOM, key: 'u:1', showName: false });
    expect(bola.last('activity-state').activity.spotlight).toEqual({ image: PNG, name: null, key: 'u:1' });
    host.trigger('activity-spotlight', { roomId: ROOM, key: 'u:1', showName: true });
    expect(bola.last('activity-state').activity.spotlight.name).toBe('Ada');
    host.trigger('activity-spotlight', { roomId: ROOM, key: 'u:nobody', showName: true }); // unknown student: nothing changes
    expect(bola.last('activity-state').activity.spotlight.name).toBe('Ada');
    host.trigger('activity-spotlight-clear', { roomId: ROOM });
    expect(ada.last('activity-state').activity.spotlight).toBeNull();
    // Only drawing questions can spotlight
    host.trigger('activity-end', { roomId: ROOM });
    host.trigger('activity-start', { roomId: ROOM, spec: { kind: 'number', prompt: 'q' } });
    host.trigger('activity-spotlight', { roomId: ROOM, key: 'u:1' });
    expect(host.last('activity-state').activity.spotlight).toBeNull();
  });
});
