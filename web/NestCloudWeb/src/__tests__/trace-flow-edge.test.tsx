import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceFlowEdge } from '../modules/system/components/TraceFlowEdge';
import {
  buildTraceCallTree,
  layoutTraceCallTree,
} from '../modules/system/utils/traceLogPresentation';

const response = { status: 304, method: 'GET', path: '/api/system/permissions' };
const service = {
  entryId: 'cached-response',
  timestampNs: '1000000001',
  service: 'system-service',
  instance: 'system-3201',
  instanceAddress: '127.0.0.1:3201',
  level: 'INFO',
  message: '[time] INFO [SystemRequestLog] ' + JSON.stringify(response),
};
const cachedEdge = layoutTraceCallTree(
  buildTraceCallTree([
    {
      ...service,
      entryId: 'ingress',
      timestampNs: '1000000000',
      service: 'gateway-service',
      instance: 'gateway-3100',
      instanceAddress: '127.0.0.1:3100',
      message:
        '[time] INFO [GatewayProxyService] ' +
        JSON.stringify({
          ...response,
          service: service.service,
          instance: service.instance,
        }),
    },
    service,
  ]),
).edges[0];

function mountEdge(edge = cachedEdge) {
  const { container } = render(
    <svg>
      <TraceFlowEdge edge={edge} />
    </svg>,
  );
  const rail = container.querySelector('path[id]')!;
  const particles = () => [...container.querySelectorAll('[data-trace-flow]')];
  function expectStaticGeometry() {
    expect(rail).toBeInTheDocument();
    expect(rail).toHaveAttribute('d', edge.path);
    for (const { x, y } of [edge.from, edge.to]) {
      expect(container.querySelector(`circle[cx="${x}"][cy="${y}"]`)).toBeInTheDocument();
    }
  }
  return { particles, rail, expectStaticGeometry };
}

describe('trace flow edge', () => {
  let media: EventTarget & { matches: boolean };

  beforeEach(() => {
    media = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal('matchMedia', () => media);
    vi.stubGlobal('IntersectionObserver', undefined);
  });

  it.each([
    [34, 1],
    [200, 2],
    [500, 3],
  ])(
    'renders the appropriate number of native motion paths for a %ipx horizontal span',
    (dx, count) => {
      expect(cachedEdge.failed).toBe(false);
      expect(Math.abs(cachedEdge.to.x - cachedEdge.from.x)).toBe(34);
      expect(cachedEdge.to.y - cachedEdge.from.y).toBe(100);
      const { from } = cachedEdge;
      const to = { x: from.x + dx, y: from.y + 100 };
      const path = `M ${from.x} ${from.y} C ${from.x} ${from.y + 50}, ${to.x} ${to.y - 50}, ${to.x} ${to.y}`;
      const scene = mountEdge(dx === 34 ? cachedEdge : { ...cachedEdge, to, path });
      expect(scene.particles()).toHaveLength(count);
      for (const particle of scene.particles()) {
        const pathReference = particle.querySelector('animateMotion mpath');
        expect(pathReference).toBeInTheDocument();
        expect(
          pathReference!.getAttribute('href') ?? pathReference!.getAttribute('xlink:href'),
        ).toBe('#' + scene.rail.id);
      }
      scene.expectStaticGeometry();
    },
  );

  it('responds to changes in the reduced motion preference', () => {
    media.matches = true;
    const scene = mountEdge();
    expect(scene.particles()).toHaveLength(0);
    scene.expectStaticGeometry();
    for (const reduced of [false, true]) {
      act(() => {
        media.matches = reduced;
        media.dispatchEvent(Object.assign(new Event('change'), { matches: reduced }));
      });
      expect(scene.particles()).toHaveLength(reduced ? 0 : 1);
      scene.expectStaticGeometry();
    }
  });

  it('removes offscreen motion and resumes when the edge returns', () => {
    let setVisible: (visible: boolean) => void;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(
          private notify: (entries: { target: Element; isIntersecting: boolean }[]) => void,
        ) {}
        observe(target: Element) {
          setVisible = (isIntersecting) => this.notify([{ target, isIntersecting }]);
        }
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const scene = mountEdge();
    for (const visible of [true, false, true]) {
      act(() => setVisible(visible));
      expect(scene.particles()).toHaveLength(visible ? 1 : 0);
      scene.expectStaticGeometry();
    }
  });
});
