"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The temporary browser, drawn as pixels (ADR 0076).
 *
 * ## Why this is a canvas and not an iframe
 *
 * It replaces one, and the replacement is safer rather than merely different.
 * The iframe embedded a provider's DevTools frontend, which loaded and ran the
 * customer's own signed-in application inside a frame on this page — third-party
 * script, in a document, next to Vibe's session. It needed `allow-scripts` and
 * `allow-same-origin` together to work at all, which is the combination that
 * lets a frame reach out of its own sandbox.
 *
 * What arrives here is a JPEG. A canvas executes nothing, has no DOM to reach
 * into, and cannot navigate anything. The customer's page runs where it always
 * ran — inside a microVM that is destroyed with the session — and this end holds
 * a picture of it.
 *
 * ## What goes back
 *
 * Four message shapes, and the guard on the other side accepts no others:
 * mouse, key and wheel in, frames out. There is no navigate, no evaluate, no
 * screenshot-to-disk. A person can click and type in a browser that is showing
 * their own product, which is exactly what signing in requires and nothing more.
 *
 * ## Coordinates
 *
 * The canvas is laid out responsively and the frame is whatever size Chromium
 * rendered, so every pointer position is scaled from one to the other. Getting
 * this wrong does not throw — it puts the click somewhere else on the page,
 * which is the kind of bug a person blames themselves for.
 */

type Frame = { t: "frame"; data: string; w: number; h: number };

export type LiveBrowserCanvasProps = {
  /**
   * The view channel's URL, including its token.
   *
   * A capability, held for the lifetime of this component and never stored.
   * It comes only from the authorized server action.
   */
  viewUrl: string;
  /** Announced to the person when the socket has not come up. */
  onUnavailable?: () => void;
};

/** Printable single characters go to Chromium as text; everything else as a key. */
function isPrintable(key: string): boolean {
  return key.length === 1;
}

/**
 * A pointer position in the frame's coordinate space.
 *
 * Exported and pure because getting it wrong does not throw. It puts the click
 * somewhere else on the page — off by the ratio between the element's laid-out
 * size and the size Chromium rendered — which is the kind of bug a person
 * blames themselves for, and the kind no rendering test would catch.
 */
export function frameCoordinates(
  pointer: { clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
  frame: { w: number; h: number },
): { x: number; y: number } {
  // A zero-sized box is a canvas that has not been laid out yet. Dividing by it
  // would send NaN, and the guard coerces NaN to 0 — a click at the top-left
  // corner, which is a real place on a real page.
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return {
    x: Math.round(((pointer.clientX - box.left) / box.width) * frame.w),
    y: Math.round(((pointer.clientY - box.top) / box.height) * frame.h),
  };
}

/**
 * Modifier bits, in CDP's own order.
 *
 * Alt 1, Ctrl 2, Meta 4, Shift 8 — a capital letter needs the Shift bit or the
 * page sees an unmodified keypress, which is how a typed password silently
 * becomes lowercase.
 */
export function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

export function LiveBrowserCanvas({ viewUrl, onUnavailable }: LiveBrowserCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  /** The size of the last frame, which is the coordinate space the guard expects. */
  const frameSize = useRef({ w: 0, h: 0 });
  const [connected, setConnected] = useState(false);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(viewUrl);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);

    socket.onmessage = (event) => {
      let message: Frame;
      try {
        message = JSON.parse(String(event.data)) as Frame;
      } catch {
        return;
      }
      if (message.t !== "frame") return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const image = new Image();
      image.onload = () => {
        // The backing store matches the frame, so nothing is resampled twice:
        // CSS scales the element, the browser scales the pixels once.
        if (canvas.width !== message.w || canvas.height !== message.h) {
          canvas.width = message.w;
          canvas.height = message.h;
        }
        frameSize.current = { w: message.w, h: message.h };
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        setPainted(true);
      };
      image.src = `data:image/jpeg;base64,${message.data}`;
    };

    const lost = () => {
      setConnected(false);
      onUnavailable?.();
    };
    socket.onerror = lost;
    socket.onclose = lost;

    return () => {
      socketRef.current = null;
      // Closing here matters: the component unmounts when the dialog is
      // dismissed, and a socket left open would keep streaming frames of a
      // signed-in product into a page nobody is looking at.
      socket.close();
    };
  }, [viewUrl, onUnavailable]);

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  /** Client coordinates into frame coordinates. */
  const at = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return frameCoordinates(event, canvas.getBoundingClientRect(), frameSize.current);
  }, []);

  const button = (which: number) => (which === 2 ? "right" : which === 1 ? "middle" : "left");

  return (
    <canvas
      ref={canvasRef}
      // Focusable so a password can be typed into it at all. Without this the
      // key handlers below never fire and the field stays empty while the
      // person types, which reads as the browser being frozen.
      tabIndex={0}
      role="application"
      aria-label="Temporary browser for signing in to your product"
      className="block h-full w-full cursor-default focus:outline-none"
      onMouseDown={(event) => {
        event.currentTarget.focus();
        send({
          t: "mouse",
          type: "mousePressed",
          ...at(event),
          button: button(event.button),
          clickCount: 1,
          modifiers: modifiersOf(event),
        });
      }}
      onMouseUp={(event) =>
        send({
          t: "mouse",
          type: "mouseReleased",
          ...at(event),
          button: button(event.button),
          clickCount: 1,
          modifiers: modifiersOf(event),
        })
      }
      onMouseMove={(event) =>
        send({
          t: "mouse",
          type: "mouseMoved",
          ...at(event),
          button: "none",
          modifiers: modifiersOf(event),
        })
      }
      onWheel={(event) => send({ t: "wheel", ...at(event), dx: event.deltaX, dy: event.deltaY })}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        // Tab must reach the page, not walk out of the dialog — a login form
        // is two fields and a button, and Tab is how people move between them.
        if (event.key !== "Escape") event.preventDefault();
        send({
          t: "key",
          type: "keyDown",
          key: event.key,
          code: event.code,
          text: isPrintable(event.key) ? event.key : undefined,
          keyCode: event.keyCode,
          modifiers: modifiersOf(event),
        });
      }}
      onKeyUp={(event) => {
        if (event.key !== "Escape") event.preventDefault();
        send({
          t: "key",
          type: "keyUp",
          key: event.key,
          code: event.code,
          keyCode: event.keyCode,
          modifiers: modifiersOf(event),
        });
      }}
      // Two states worth telling apart: the socket is not up, and the socket is
      // up but Chromium has not painted yet. They need different patience.
      data-connected={connected ? "true" : "false"}
      data-painted={painted ? "true" : "false"}
    />
  );
}
