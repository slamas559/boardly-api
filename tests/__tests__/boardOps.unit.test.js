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

  test('grouping is just a groupId patch that can be set and cleared', () => {
    const objects = new Map();
    applyOps(objects, [{ op: 'add', obj: stroke('a') }, { op: 'add', obj: stroke('b') }]);
    const grouped = applyOps(objects, [
      { op: 'update', id: 'a', patch: { groupId: 'g1' } },
      { op: 'update', id: 'b', patch: { groupId: 'g1' } },
    ]);
    expect(grouped).toHaveLength(2);
    expect(objects.get('a').groupId).toBe('g1');
    expect(applyOps(objects, [{ op: 'update', id: 'a', patch: { groupId: null } }])).toHaveLength(1);
    expect(objects.get('a').groupId).toBeNull();
    expect(validateObject(stroke('c', { groupId: 'g2' }))).toBe(true);
  });

  test('rejects malformed group ids', () => {
    const objects = new Map();
    applyOps(objects, [{ op: 'add', obj: stroke('a') }]);
    for (const bad of [42, '', 'x'.repeat(49), {}, ['g']]) {
      expect(applyOps(objects, [{ op: 'update', id: 'a', patch: { groupId: bad } }])).toHaveLength(0);
      expect(validateObject(stroke('z', { groupId: bad }))).toBe(false);
    }
    expect(objects.get('a').groupId).toBeUndefined();
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
  test('graph slider letters, trace point and key points are validated', () => {
    const base = {
      id: 'graph', type: 'graph', page: 0, expression: 'a*x^2 + b', x: 0, y: 0, w: 520, h: 380,
      xMin: -10, xMax: 10, yMin: -10, yMax: 10,
    };
    const params = { a: { value: 2, min: -5, max: 5 }, b: { value: -1, min: -10, max: 10 } };
    expect(validateObject({ ...base, params }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...base, params: { A: params.a } }, BOARD_OBJECT_TYPES)).toBe(false); // letters only, lower case
    expect(validateObject({ ...base, params: { ab: params.a } }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...base, params: { a: { value: 2, min: 5, max: -5 } } }, BOARD_OBJECT_TYPES)).toBe(false); // min < max
    expect(validateObject({ ...base, params: { a: { value: Infinity, min: -5, max: 5 } } }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...base, params: { a: { value: 2e9, min: -5, max: 5 } } }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...base, params: [params.a] }, BOARD_OBJECT_TYPES)).toBe(false);
    const tooMany = Object.fromEntries('abcdefghijklmn'.split('').map((letter) => [letter, params.a]));
    expect(validateObject({ ...base, params: tooMany }, BOARD_OBJECT_TYPES)).toBe(false);

    expect(validateObject({ ...base, trace: { x: 3, tangent: true } }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...base, trace: null }, BOARD_OBJECT_TYPES)).toBe(true); // switched off
    expect(validateObject({ ...base, trace: { x: 'three' } }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...base, trace: { x: 1, tangent: 'yes' } }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...base, keyPoints: true }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...base, keyPoints: 'on' }, BOARD_OBJECT_TYPES)).toBe(false);
  });

  test('a slider drag arrives as a small update that is relayed and applied', () => {
    const objects = new Map();
    const graph = {
      id: 'g', type: 'graph', page: 0, expression: 'a*x', x: 0, y: 0, w: 520, h: 380,
      xMin: -10, xMax: 10, yMin: -10, yMax: 10,
    };
    applyOps(objects, [{ op: 'add', obj: graph }], { allowedTypes: BOARD_OBJECT_TYPES });
    const patch = { params: { a: { value: 3, min: -10, max: 10 } } };
    const applied = applyOps(objects, [{ op: 'update', id: 'g', patch }], { allowedTypes: BOARD_OBJECT_TYPES });
    expect(applied).toHaveLength(1);
    expect(objects.get('g').params.a.value).toBe(3);
    const bad = applyOps(objects, [{ op: 'update', id: 'g', patch: { params: { a: { value: 'x', min: 0, max: 1 } } } }], { allowedTypes: BOARD_OBJECT_TYPES });
    expect(bad).toHaveLength(0);
    expect(objects.get('g').params.a.value).toBe(3);
  });
  test('equation blocks are board-only objects with bounded LaTeX, size and colour', () => {
    const equation = {
      id: 'eq', type: 'equation', page: 0, x: 10, y: 20, w: 240.5, h: 68, latex: 'x = \\frac{-b}{2a}', fontSize: 44, color: '#2540D9',
    };
    expect(validateObject(equation, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(equation)).toBe(false); // PDF annotations do not take equations
    expect(validateObject({ ...equation, latex: '' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, latex: '   ' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, latex: 'x'.repeat(601) }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, latex: 'x'.repeat(600) }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...equation, latex: 42 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, w: 0 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, h: Infinity }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, w: 200000 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, fontSize: 2 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, fontSize: 5000 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, x: NaN }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...equation, color: 'red" onload="x' }, BOARD_OBJECT_TYPES)).toBe(false); // colours go into an image
    expect(validateObject({ ...equation, color: undefined }, BOARD_OBJECT_TYPES)).toBe(true);
  });

  test('editing a formula arrives as an update that is validated against the whole object', () => {
    const objects = new Map();
    const equation = { id: 'eq', type: 'equation', page: 0, x: 0, y: 0, w: 100, h: 50, latex: 'y = x^{2}', fontSize: 40, color: '#17181C' };
    expect(applyOps(objects, [{ op: 'add', obj: equation }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(1);
    const edit = { latex: 'y = x^{3}', w: 120, h: 52 };
    expect(applyOps(objects, [{ op: 'update', id: 'eq', patch: edit }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(1);
    expect(objects.get('eq').latex).toBe('y = x^{3}');
    expect(applyOps(objects, [{ op: 'update', id: 'eq', patch: { latex: '' } }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(0);
    expect(applyOps(objects, [{ op: 'update', id: 'eq', patch: { fontSize: 'big' } }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(0);
    expect(objects.get('eq').latex).toBe('y = x^{3}');
  });
  test('page paper is one small object per page that survives clearing the page', () => {
    const paper = { id: 'paper-2', type: 'paper', page: 2, kind: 'plane', scale: 1 };
    expect(validateObject(paper, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(paper)).toBe(false); // PDF annotations have no paper
    expect(validateObject({ ...paper, kind: 'confetti' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...paper, scale: 3 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...paper, id: 'paper-9' }, BOARD_OBJECT_TYPES)).toBe(false); // id must match the page
    expect(validateObject({ ...paper, page: undefined }, BOARD_OBJECT_TYPES)).toBe(false);

    const objects = new Map();
    const shape = { id: 's1', type: 'shape', kind: 'rect', page: 2, x: 0, y: 0, w: 10, h: 10 };
    applyOps(objects, [{ op: 'add', obj: paper }, { op: 'add', obj: shape }], { allowedTypes: BOARD_OBJECT_TYPES });
    const applied = applyOps(objects, [{ op: 'clear', page: 2 }], { allowedTypes: BOARD_OBJECT_TYPES });
    expect(applied).toHaveLength(1);
    expect(objects.has('paper-2')).toBe(true);
    expect(objects.has('s1')).toBe(false);
    expect(applyOps(objects, [{ op: 'update', id: 'paper-2', patch: { kind: 'grid', scale: 2 } }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(1);
    expect(objects.get('paper-2').kind).toBe('grid');
  });

  test('math aids validate their own settings and stay within bounds', () => {
    const box = { page: 0, x: 10, y: 10, w: 600, h: 300, color: '#2540D9' };
    const line = { id: 'n', type: 'aid', kind: 'numberline', ...box, min: -5, max: 5, step: 1, marks: [2], jumps: [{ from: 0, to: 3 }] };
    expect(validateObject(line, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(line)).toBe(false);
    expect(validateObject({ ...line, min: 5, max: -5 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...line, step: 0 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...line, step: 0.001 }, BOARD_OBJECT_TYPES)).toBe(false); // more than 200 ticks
    expect(validateObject({ ...line, marks: Array.from({ length: 13 }, (_, i) => i) }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...line, jumps: Array.from({ length: 9 }, () => ({ from: 0, to: 1 })) }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...line, jumps: [{ from: 'a', to: 1 }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...line, w: 5 }, BOARD_OBJECT_TYPES)).toBe(false);

    const circle = { id: 'u', type: 'aid', kind: 'unitcircle', ...box, angle: 45, snap: true, radians: false, showTriangle: true, showValues: true };
    expect(validateObject(circle, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...circle, angle: 5000 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...circle, angle: NaN }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...circle, snap: 'yes' }, BOARD_OBJECT_TYPES)).toBe(false);

    const bars = { id: 'f', type: 'aid', kind: 'fractions', ...box, shape: 'pie', bars: [{ parts: 4, shaded: 1 }, { parts: 8, shaded: 8 }] };
    expect(validateObject(bars, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...bars, bars: [] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...bars, bars: Array.from({ length: 5 }, () => ({ parts: 2, shaded: 1 })) }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...bars, bars: [{ parts: 4, shaded: 5 }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...bars, bars: [{ parts: 1000, shaded: 1 }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...bars, bars: [{ parts: 2.5, shaded: 1 }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...bars, shape: 'cube' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...bars, color: 'red" onload="x' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ id: 'z', type: 'aid', kind: 'mystery', ...box }, BOARD_OBJECT_TYPES)).toBe(false);
  });
  test('geometry instruments are board-only objects with bounded size and rotation', () => {
    const ruler = { id: 'r', type: 'instrument', kind: 'ruler', page: 0, x: 100, y: 120, w: 520, angle: 30 };
    expect(validateObject(ruler, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(ruler)).toBe(false); // not for PDF pages
    for (const kind of ['protractor', 'square45', 'square3060']) {
      expect(validateObject({ ...ruler, kind, w: 400 }, BOARD_OBJECT_TYPES)).toBe(true);
    }
    expect(validateObject({ ...ruler, kind: 'compass' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...ruler, w: 50 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...ruler, w: 5000 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...ruler, kind: 'square45', w: 1500 }, BOARD_OBJECT_TYPES)).toBe(false); // each kind has its own limits
    expect(validateObject({ ...ruler, angle: 9999 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...ruler, angle: NaN }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...ruler, x: Infinity }, BOARD_OBJECT_TYPES)).toBe(false);
    const objects = new Map();
    applyOps(objects, [{ op: 'add', obj: ruler }], { allowedTypes: BOARD_OBJECT_TYPES });
    expect(applyOps(objects, [{ op: 'update', id: 'r', patch: { angle: 45.5 } }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(1);
    expect(applyOps(objects, [{ op: 'update', id: 'r', patch: { w: 10 } }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(0);
    expect(objects.get('r').angle).toBe(45.5);
  });

  test('shapes can carry a measurement flag', () => {
    const shape = { id: 's', type: 'shape', kind: 'triangle', page: 0, x1: 0, y1: 0, x2: 100, y2: 80, color: '#2540D9', width: 4 };
    expect(validateObject({ ...shape, measure: true }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...shape, measure: 'yes' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...shape, measure: true })).toBe(true); // shapes also exist on PDF pages
  });
  test('statistics charts validate their data and settings and stay small enough to relay', () => {
    const chart = {
      id: 'c', type: 'stats', page: 0, chart: 'histogram', x: 0, y: 0, w: 760, h: 440, color: '#2540D9',
      columns: [{ name: 'Score', values: [45, 52, 58.5, null, 91] }], showStats: true, showMean: true, sd: 'sample',
    };
    expect(validateObject(chart, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(chart)).toBe(false); // board only
    for (const kind of ['box', 'scatter']) expect(validateObject({ ...chart, chart: kind }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...chart, chart: 'pie' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, columns: [] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, columns: Array.from({ length: 5 }, () => chart.columns[0]) }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, columns: [{ name: 'x', values: Array.from({ length: 301 }, (_, i) => i) }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, columns: [{ name: 'x', values: Array.from({ length: 300 }, (_, i) => i) }] }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...chart, columns: [{ name: 'x', values: [1, 'two'] }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, columns: [{ name: 'x', values: [1, NaN] }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, columns: [{ name: 'x', values: [1e12] }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, columns: [{ name: 'n'.repeat(41), values: [1] }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, columns: [{ values: [1] }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, binWidth: 5 }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...chart, binWidth: null }, BOARD_OBJECT_TYPES)).toBe(true); // back to automatic
    expect(validateObject({ ...chart, binWidth: 0 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, binWidth: -2 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, sd: 'both' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, title: 'Class 4B' }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...chart, title: 't'.repeat(81) }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, showMean: 'yes' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, w: 50 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...chart, color: 'blue" x="' }, BOARD_OBJECT_TYPES)).toBe(false);
    // A full chart (4 columns of 300 values) is far below the object size limits
    const full = { ...chart, columns: Array.from({ length: 4 }, (_, c) => ({ name: `Group ${c}`, values: Array.from({ length: 300 }, (_, i) => 1234.5678 + i) })) };
    expect(validateObject(full, BOARD_OBJECT_TYPES)).toBe(true);
    expect(JSON.stringify(full).length).toBeLessThan(32 * 1024);
  });

  test('pasting new data arrives as an update and is checked like a new chart', () => {
    const objects = new Map();
    const chart = { id: 'c', type: 'stats', page: 0, chart: 'scatter', x: 0, y: 0, w: 760, h: 460, columns: [{ name: 'x', values: [1, 2] }, { name: 'y', values: [2, 4] }] };
    applyOps(objects, [{ op: 'add', obj: chart }], { allowedTypes: BOARD_OBJECT_TYPES });
    const columns = [{ name: 'Hours', values: [1, 2, 3] }, { name: 'Score', values: [50, 60, null] }];
    expect(applyOps(objects, [{ op: 'update', id: 'c', patch: { columns } }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(1);
    expect(objects.get('c').columns[1].values[2]).toBeNull();
    expect(applyOps(objects, [{ op: 'update', id: 'c', patch: { columns: [{ name: 'bad', values: ['a'] }] } }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(0);
    expect(objects.get('c').columns[0].name).toBe('Hours');
  });
  test('covers that hide part of the board are bounded and board-only', () => {
    const cover = { id: 'cv', type: 'cover', page: 0, x: 100, y: 80, w: 300, h: 120, open: false, label: 'Answer', color: '#E2492B' };
    expect(validateObject(cover, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject(cover)).toBe(false);
    expect(validateObject({ ...cover, open: true }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...cover, open: 'yes' }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...cover, label: undefined, color: undefined }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...cover, label: 'L'.repeat(31) }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...cover, w: 10 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...cover, h: 99999 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...cover, x: NaN }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...cover, color: 'red" x="' }, BOARD_OBJECT_TYPES)).toBe(false);
    const objects = new Map();
    applyOps(objects, [{ op: 'add', obj: cover }], { allowedTypes: BOARD_OBJECT_TYPES });
    expect(applyOps(objects, [{ op: 'update', id: 'cv', patch: { open: true } }], { allowedTypes: BOARD_OBJECT_TYPES })).toHaveLength(1); // reveal
    expect(objects.get('cv').open).toBe(true);
  });

  test('poll results placed on the board are checked', () => {
    const box = { page: 0, x: 0, y: 0, w: 560, h: 300, color: '#2540D9' };
    const poll = { id: 'p', type: 'aid', kind: 'pollbars', ...box, title: 'What is 2 + 2?', bars: [{ label: '3', count: 2 }, { label: '4', count: 14 }, { label: '5', count: 1 }], correct: 1 };
    expect(validateObject(poll, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...poll, correct: undefined }, BOARD_OBJECT_TYPES)).toBe(true);
    expect(validateObject({ ...poll, correct: 3 }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...poll, bars: [] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...poll, bars: Array.from({ length: 7 }, () => ({ label: 'a', count: 1 })) }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...poll, bars: [{ label: 'a', count: -1 }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...poll, bars: [{ label: 'a', count: 1.5 }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...poll, bars: [{ label: 'a'.repeat(81), count: 1 }] }, BOARD_OBJECT_TYPES)).toBe(false);
    expect(validateObject({ ...poll, title: 't'.repeat(241) }, BOARD_OBJECT_TYPES)).toBe(false);
  });
  test('brush texture and pattern are kept for live strokes and checked on add and update', () => {
    const objects = new Map();
    const meta = { tool: 'pen', color: '#000', width: 4, opacity: 1, texture: 'chalk', pattern: 'dashed' };
    const s = applyStrokeChunk(objects, { id: 'b1', page: 0, meta, points: [[0, 0, 0.5], [3, 3, 0.5]] });
    expect(s.texture).toBe('chalk');
    expect(s.pattern).toBe('dashed');

    const odd = applyStrokeChunk(objects, { id: 'b2', page: 0, meta: { ...meta, texture: 'glitter', pattern: 'wavy' }, points: [[0, 0, 0.5]] });
    expect(odd.texture).toBe('smooth');
    expect(odd.pattern).toBe('solid');

    expect(validateObject(stroke('b3', { texture: 'pencil', pattern: 'dotted' }))).toBe(true);
    expect(validateObject(stroke('b4', { texture: 'glitter' }))).toBe(false);
    expect(validateObject(stroke('b5', { pattern: 'wavy' }))).toBe(false);

    applyOps(objects, [{ op: 'add', obj: stroke('b6') }]);
    expect(applyOps(objects, [{ op: 'update', id: 'b6', patch: { texture: 'brush' } }])).toHaveLength(1);
    expect(applyOps(objects, [{ op: 'update', id: 'b6', patch: { texture: 'glitter' } }])).toHaveLength(0);
    expect(objects.get('b6').texture).toBe('brush');
  });

  test('shapes accept none, tint and solid fills', () => {
    const shape = (id, fill) => ({ id, type: 'shape', kind: 'rect', page: 0, x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', width: 3, fill });
    for (const fill of [false, true, 'tint', 'solid']) expect(validateObject(shape('f', fill))).toBe(true);
    const objects = new Map();
    applyOps(objects, [{ op: 'add', obj: shape('f1', false) }, { op: 'update', id: 'f1', patch: { fill: 'solid' } }]);
    expect(objects.get('f1').fill).toBe('solid');
  });
  test('layer order (z) is validated, kept on live strokes and can be updated', () => {
    expect(validateObject(stroke('z1', { z: 7 }))).toBe(true);
    expect(validateObject(stroke('z2', { z: -3 }))).toBe(true);
    expect(validateObject(stroke('z3', { z: 'top' }))).toBe(false);
    expect(validateObject(stroke('z4', { z: Infinity }))).toBe(false);
    expect(validateObject(stroke('z5', { z: 5_000_000 }))).toBe(false);

    const objects = new Map();
    const live = applyStrokeChunk(objects, { id: 'z6', page: 0, meta: { tool: 'pen', color: '#000', width: 3, z: 12 }, points: [[0, 0, 0.5]] });
    expect(live.z).toBe(12);
    expect(applyStrokeChunk(objects, { id: 'z7', page: 0, meta: { tool: 'pen', color: '#000', width: 3 }, points: [[0, 0, 0.5]] }).z).toBeUndefined();

    applyOps(objects, [{ op: 'add', obj: stroke('z8') }]);
    expect(applyOps(objects, [{ op: 'update', id: 'z8', patch: { z: 4 } }])).toHaveLength(1);
    expect(objects.get('z8').z).toBe(4);
    expect(applyOps(objects, [{ op: 'update', id: 'z8', patch: { z: 'x' } }])).toHaveLength(0);
  });
});
