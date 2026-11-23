import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTraceDiagramCamera } from '../modules/system/hooks/useTraceDiagramCamera';

function Diagram() {
  const controls = useTraceDiagramCamera({ width: 200, height: 160 });
  return (
    <div
      data-testid="viewport"
      ref={controls.viewport}
      onPointerDown={controls.pointerDown}
      onPointerMove={controls.pointerMove}
      onPointerUp={controls.pointerEnd}
      onPointerCancel={controls.pointerEnd}
    >
      <output data-testid="camera">{JSON.stringify(controls.camera)}</output>
      <button
        data-testid="node"
        onClick={() => {
          if (!controls.suppressClick.current) controls.zoomFromCenter(1.5);
        }}
      >
        节点
      </button>
    </div>
  );
}

describe('trace diagram camera', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function scene() {
    const screen = render(<Diagram />);
    const viewport = screen.getByTestId('viewport');
    const node = screen.getByTestId('node');
    viewport.setPointerCapture = vi.fn();
    const read = () =>
      JSON.parse(screen.getByTestId('camera').textContent) as {
        x: number;
        y: number;
        zoom: number;
      };
    return { viewport, node, read };
  }

  it('keeps the scene point under the wheel stationary while scaling', () => {
    const { viewport, read } = scene();
    const initial = read();
    const wheel = new WheelEvent('wheel', {
      clientX: 180,
      clientY: 80,
      deltaY: -130,
      cancelable: true,
    });
    fireEvent(viewport, wheel);
    const result = read();
    expect(wheel.defaultPrevented).toBe(true);
    expect(result.zoom).toBeGreaterThan(initial.zoom);
    expect((180 - result.x) / result.zoom).toBeCloseTo(180 - initial.x);
    expect((80 - result.y) / result.zoom).toBeCloseTo(80 - initial.y);
  });

  it('pans from a node and suppresses the drag click while preserving a fresh tap', () => {
    const { viewport, node, read } = scene();
    fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 150, clientY: 60 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 170, clientY: 75 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    fireEvent.click(node);
    expect(read()).toEqual({ x: 120, y: 15, zoom: 1 });

    fireEvent.pointerDown(node, { pointerId: 2, button: 0, clientX: 160, clientY: 70 });
    fireEvent.pointerUp(node, { pointerId: 2 });
    fireEvent.click(node);
    expect(read().zoom).toBe(1.5);
  });

  it('scales around the two contacts and continues panning after one lifts', () => {
    const { viewport, read } = scene();
    fireEvent.pointerDown(viewport, {
      pointerId: 1,
      button: 0,
      pointerType: 'touch',
      clientX: 100,
      clientY: 60,
    });
    fireEvent.pointerDown(viewport, {
      pointerId: 2,
      button: 0,
      pointerType: 'touch',
      clientX: 200,
      clientY: 60,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 250,
      clientY: 60,
    });
    expect(read()).toEqual({ zoom: 1.5, x: 100, y: -30 });
    fireEvent.pointerUp(viewport, { pointerId: 2 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 115, clientY: 75 });
    expect(read()).toEqual({ zoom: 1.5, x: 115, y: -15 });
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    expect(viewport.dataset.panning).toBeUndefined();
  });
});
