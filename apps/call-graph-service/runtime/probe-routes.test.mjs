import assert from 'node:assert/strict';
import test from 'node:test';
import { createRouteMatcher, matchRouteRoot } from './probe-routes.mjs';

const route = (method, path, ...roots) => ({ id: method + ' ' + path, method, path, roots });

test('NestJS matches named wildcards, optional path groups and earlier parameter notation', () => {
  const find = createRouteMatcher(
    [
      route('GET', '/downloads{/*files}', 'download'),
      route('POST', '/user{/:id}', 'save'),
      route('GET', '/legacy/:id?', 'legacy'),
    ],
    'nestjs',
  );
  for (const path of ['/downloads', '/downloads/a/b'])
    assert.equal(find('GET', path)[0]?.id, 'GET /downloads{/*files}');
  for (const path of ['/user', '/user/42'])
    assert.equal(find('POST', path)[0]?.id, 'POST /user{/:id}');
  assert.equal(find('GET', '/legacy')[0]?.id, 'GET /legacy/:id?');
  assert.deepEqual(find('GET', '/user/42'), []);
});

test('matches parameters, overlapping declarations, HEAD, ALL and actual Koa layer roots', () => {
  const routes = [
    route('ALL', '/books/:path(.*)', 'common'),
    route('GET', '/books/:id', 'dynamic', 'common'),
    route('GET', '/books/all', 'all', 'common'),
    route('HEAD', '/books/:id', 'head'),
    route('POST', '/books/:id', 'post'),
    route('GET', '/health'),
  ];
  const find = createRouteMatcher(routes);
  const candidates = find('get', '/Books/All/');
  assert.deepEqual(
    candidates.map((r) => r.id),
    [routes[2].id, routes[1].id, routes[0].id],
  );
  assert.equal(matchRouteRoot(candidates, 'common').id, routes[2].id);
  assert.equal(matchRouteRoot(candidates, 'common', '/books/:id').id, routes[1].id);
  assert.equal(matchRouteRoot(candidates, 'dynamic').id, routes[1].id);
  assert.equal(matchRouteRoot(candidates, 'global'), undefined);
  assert.equal(matchRouteRoot(find('GET', '/health'), 'global'), undefined);
  assert.equal(find('head', '/books/42')[0].id, routes[3].id);
  assert.deepEqual(
    find('head', '/books/42').map((r) => r.method),
    ['HEAD', 'GET', 'ALL'],
  );
  assert.deepEqual(
    find('POST', '/books/42').map((r) => r.method),
    ['POST', 'ALL'],
  );
  assert.equal(find('PATCH', '/books/a/b')[0].id, routes[0].id);
  assert.deepEqual(find('POST', '/elsewhere'), []);
});
