import { applyOps, applyStrokeChunk, BOARD_OBJECT_TYPES, validateObject } from '../../sockets/boardOps.js';

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

  test('board graph and table objects are validated while PDF types remain restricted', () => {
    const graph = {
      id: 'g', type: 'graph', page: 0, expression: 'x^2',
      x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10,
    };
    const table = {
      id: 't', type: 'table', page: 0, x: 0, y: 0, rows: 2, cols: 2,
      cellWidth: 110, cellHeight: 40, cells: ['', '', '', ''],
    };
    expect(validateObject(graph, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(table, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(graph)).toBe(false);
    expect(validateObject(table)).toBe(false);
    expect(validateObject({ ...graph, xMin: 10 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...table, cells: ['too', 'few'] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...table, rows: 13, cells: Array(26).fill('') }, BOARD_OBJECT_TYPES)).toBe(false);
  });

  test('board media objects validate hosted assets, supported embeds, and dimensions', () => {
    const image = {
      id: 'media1', type: 'media', mediaType: 'image',
      src: 'https://res.cloudinary.com/demo/image/upload/photo.jpg',
      page: 0, x: 0, y: 0, w: 640, h: 480,
    };
    const video = {
      ...image, id: 'media2', mediaType: 'video',
      src: 'https://res.cloudinary.com/demo/video/upload/lesson.mp4', playing: false,
    };
    expect(validateObject(image, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(video, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...image, id: 'youtube1', mediaType: 'embed', provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...image, id: 'vimeo1', mediaType: 'embed', provider: 'vimeo',
      src: 'https://player.vimeo.com/video/123456789',
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...image, id: 'direct1', mediaType: 'embed', provider: 'direct',
      src: 'https://cdn.example.com/lesson.mp4?token=abc',
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...image, id: 'sync-embed', mediaType: 'embed', provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', playing: true, currentTime: 12.5,
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(image)).toBe(false);
    expect(validateObject({ ...image, src: 'https://example.com/photo.jpg' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({
      ...image, id: 'bad-embed', mediaType: 'embed', provider: 'youtube',
      src: 'https://youtube.com/embed/dQw4w9WgXcQ',
    }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({
      ...image, id: 'bad-direct', mediaType: 'embed', provider: 'direct',
      src: 'https://example.com/page',
    }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({
      ...image, id: 'bad-sync', mediaType: 'embed', provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', currentTime: -1,
    }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...image, w: Infinity }, BOARD_OBJECT_TYPES)).toBe(false);
  });

  test('board operations relay YouTube embed objects to listeners', () => {
    const objects = new Map();
    const embed = {
      id: 'youtube-embed', type: 'media', mediaType: 'embed', provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      page: 2, x: 0, y: 0, w: 640, h: 360, playing: false,
    };
    const ops = [{ op: 'add', obj: embed }];

    expect(applyOps(objects, ops, { allowedTypes: BOARD_OBJECT_TYPES })).toEqual(ops);
    expect(objects.get(embed.id)).toEqual(embed);
    const playbackUpdate = { op: 'update', id: embed.id, patch: { playing: true, currentTime: 12.5 } };
    expect(applyOps(objects, [playbackUpdate], { allowedTypes: BOARD_OBJECT_TYPES })).toEqual([playbackUpdate]);
    expect(objects.get(embed.id)).toMatchObject({ playing: true, currentTime: 12.5 });
  });

  test('board operations can relay graph and table objects and updates', () => {
    const objects = new Map();
    const graph = {
      id: 'g', type: 'graph', page: 0, expression: 'x^2',
      x: 0, y: 0, w: 520, h: 380, xMin: -10, xMax: 10, yMin: -10, yMax: 10,
    };
    const table = {
      id: 't', type: 'table', page: 0, x: 0, y: 0, rows: 1, cols: 2,
      cellWidth: 110, cellHeight: 40, cells: ['', ''],
    };
    const ops = [
      { op: 'add', obj: graph },
      { op: 'add', obj: table },
      { op: 'update', id: 't', patch: { cells: ['Header', 'Value'] } },
    ];
    expect(applyOps(objects, ops, { allowedTypes: BOARD_OBJECT_TYPES })).toEqual(ops);
    expect(objects.get('g')).toEqual(graph);
    expect(objects.get('t').cells).toEqual(['Header', 'Value']);
    expect(applyOps(new Map(), ops)).toHaveLength(0);
  });

  test('board graph validation accepts supported equation modes and rejects malformed modes', () => {
    const base = {
      id: 'graph', type: 'graph', page: 0, expression: 'x^2', x: 0, y: 0, w: 520, h: 380,
      xMin: -10, xMax: 10, yMin: -10, yMax: 10,
    };
    expect(validateObject({ ...base, mode: 'explicit' }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...base, mode: 'implicit', expression: 'x^2 + y^2 = 25' }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...base, mode: 'implicit', expression: 'x^2 + y^2' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...base, mode: 'inequality', expression: 'y > 2x + 1\nx^2 + y^2 <= 16' }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...base, mode: 'inequality', expression: 'y > x > 0' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({
      ...base, mode: 'explicit', geometry: [
        { id: 'p1', kind: 'point', label: 'A', x: 1, y: 2 },
        { id: 'v1', kind: 'vector', label: 'v', x: 0, y: 0, dx: 2, dy: 3 },
        { id: 'r1', kind: 'ray', label: 'r', x1: 0, y1: 0, x2: 1, y2: 1 },
      ],
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...base, geometry: [{ id: 'bad', kind: 'point', label: 'P', x: Infinity, y: 0 }],
    }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({
      ...base, mode: 'surface3d', expression: 'x^2 - y^2', zMin: -10, zMax: 10, azimuth: 42, elevation: 32,
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...base, mode: 'surface3d', expression: 'x^2 - y^2', zMin: 10, zMax: -10, azimuth: 42, elevation: 32,
    }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({
      ...base, mode: 'parametric', xExpression: 'cos(t)', yExpression: 'sin(t)', tMin: 0, tMax: 6.28,
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...base, mode: 'polar', expression: '2 + cos(5t)', tMin: 0, tMax: 6.28,
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...base, mode: 'curve3d', expression: 'x(t), y(t), z(t)', xExpression: 'cos(t)', yExpression: 'sin(t)', zExpression: 't',
      tMin: 0, tMax: 6.28, zMin: -10, zMax: 10, azimuth: 42, elevation: 32,
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...base, mode: 'parametricSurface3d', expression: 'x(u,v), y(u,v), z(u,v)',
      xExpression: 'cos(u)', yExpression: 'sin(u)', zExpression: 'v',
      uMin: 0, uMax: 6.28, vMin: -1, vMax: 1, zMin: -10, zMax: 10, azimuth: 42, elevation: 32,
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...base, mode: 'parametricSurface3d', expression: 'x(u,v), y(u,v), z(u,v)',
      xExpression: 'cos(u)', yExpression: 'sin(u)', zExpression: 'v',
      uMin: 6.28, uMax: 0, vMin: -1, vMax: 1, zMin: -10, zMax: 10, azimuth: 42, elevation: 32,
    }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({
      ...base, geometry: [
        { id: 'poly', kind: 'polygon', label: 'ABC', vertices: [[0, 0], [1, 0], [0, 1]], filled: true },
        { id: 'angle', kind: 'angle', label: 'A', ax: 1, ay: 0, vx: 0, vy: 0, cx: 0, cy: 1, angleUnit: 'degrees' },
        { id: 'measure', kind: 'segment', label: 'd', x1: 0, y1: 0, x2: 3, y2: 4, showMeasure: true },
      ],
    }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({
      ...base, geometry: [{ id: 'bad-poly', kind: 'polygon', label: 'bad', vertices: [[0, 0], [1, 0]] }],
    }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({
      ...base, geometry: [{ id: 'bad-angle', kind: 'angle', label: 'bad', ax: 0, ay: 0, vx: 0, vy: 0, cx: 0, cy: 1, angleUnit: 'degrees' }],
    }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...base, mode: 'other' }, BOARD_OBJECT_TYPES)).toBe(false);
  });
});
