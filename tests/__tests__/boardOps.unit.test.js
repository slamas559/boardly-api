import { applyOps, applyStrokeChunk, validateObject } from '../../sockets/boardOps.js';

const stroke = (id, extra = {}) => ({ id, type: 'stroke', page: 0, points: [[0, 0, 0.5]], color: '#000', width: 3, ...extra });

describe('boardOps', () => {
  test('add / update / remove roundtrip', () => {
    const objects = new Map();
    const applied = applyOps(objects, [
      { op: 'add', obj: stroke('a') },
      { op: 'update', id: 'a', patch: { color: '#f00' } },
    ]);
    expect(applied).toHaveLength(2);
    expect(objects.get('a').color).toBe('#f00');

    applyOps(objects, [{ op: 'remove', id: 'a' }]);
    expect(objects.size).toBe(0);
  });

  test('rejects invalid objects and unsafe patches', () => {
    const objects = new Map();
    expect(applyOps(objects, [{ op: 'add', obj: { id: 'x', type: 'script' } }])).toHaveLength(0);
    expect(applyOps(objects, [{ op: 'add', obj: { type: 'stroke' } }])).toHaveLength(0);
    applyOps(objects, [{ op: 'add', obj: stroke('a') }]);
    expect(applyOps(objects, [{ op: 'update', id: 'a', patch: { id: 'b' } }])).toHaveLength(0);
    expect(applyOps(objects, [{ op: 'update', id: 'a', patch: { type: 'text' } }])).toHaveLength(0);
    expect(applyOps(objects, [{ op: 'update', id: 'missing', patch: { color: '#fff' } }])).toHaveLength(0);
  });

  test('clear removes only the requested page', () => {
    const objects = new Map();
    applyOps(objects, [
      { op: 'add', obj: stroke('a', { page: 0 }) },
      { op: 'add', obj: stroke('b', { page: 1 }) },
    ]);
    applyOps(objects, [{ op: 'clear', page: 0 }]);
    expect([...objects.keys()]).toEqual(['b']);
  });

  test('stroke chunks build a stroke incrementally', () => {
    const objects = new Map();
    const meta = { tool: 'pen', color: '#123456', width: 4, opacity: 1 };
    applyStrokeChunk(objects, { id: 's1', page: 2, meta, points: [[0, 0, 0.5], [1, 1, 0.5]] });
    const s = applyStrokeChunk(objects, { id: 's1', page: 2, points: [[2, 2, 0.5]] });
    expect(s.points).toHaveLength(3);
    expect(s.page).toBe(2);
    expect(s.color).toBe('#123456');
  });

  test('stroke chunk without meta cannot create a stroke', () => {
    expect(applyStrokeChunk(new Map(), { id: 'nope', page: 0, points: [[0, 0]] })).toBeNull();
  });

  test('validateObject enforces limits', () => {
    expect(validateObject({ id: 't', type: 'text', page: 0, text: 'x'.repeat(5001) })).toBe(false);
    expect(validateObject({ id: 't', type: 'text', page: 0, text: 'hello' })).toBe(true);
    expect(validateObject({ id: 'm', type: 'markup', page: 1, rects: [] })).toBe(true);
  });
});
