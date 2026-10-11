import assert from "node:assert/strict";
import test from "node:test";

import { LOBBY_ROOM_TASKBAR_SHARE, attachLobbyRoomTopBar } from "./lobby-room-top-bar";

interface FakeElement {
  tag: string;
  className: string;
  attributes: Map<string, string>;
  style: { [property: string]: unknown; setProperty(name: string, value: string): void };
  children: FakeElement[];
  parent?: FakeElement;
  ownerDocument: { createElement(tag: string): FakeElement };
  append(child: FakeElement): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
}

function fakeElement(tag: string): FakeElement {
  const element: FakeElement = {
    tag, className: "", attributes: new Map(), children: [],
    style: { setProperty(name: string, value: string) { element.style[name] = value; } },
    ownerDocument: { createElement: fakeElement },
    append(child) { child.parent = element; element.children.push(child); },
    remove() {
      if (!element.parent) return;
      element.parent.children = element.parent.children.filter(child => child !== element);
      element.parent = undefined;
    },
    setAttribute(name, value) { element.attributes.set(name, value); },
  };
  return element;
}

test("顶栏宿主覆盖任务栏以上的区域、本身不挡点击，释放时连同顶栏一起移除", () => {
  const room = fakeElement("div");
  const events: string[] = [];
  const handle = attachLobbyRoomTopBar(room as unknown as HTMLElement, host => {
    const bar = (host as unknown as FakeElement).ownerDocument.createElement("header");
    (host as unknown as FakeElement).append(bar);
    events.push("mounted");
    return { dispose() { events.push("disposed"); } };
  });
  assert.ok(handle);
  const host = room.children[0]!;
  assert.equal(host.className, "ks-room-topbar");
  assert.equal(host.style.position, "absolute");
  assert.equal(host.style.bottom, LOBBY_ROOM_TASKBAR_SHARE);
  assert.equal(host.style["container-type"], "size");
  assert.equal(host.style.pointerEvents, "none");
  assert.equal(host.children[0]!.style.pointerEvents, "auto");
  handle.dispose();
  handle.dispose();
  assert.deepEqual(events, ["mounted", "disposed"]);
  assert.deepEqual(room.children, []);
});

test("没有可挂的顶栏时不留下宿主", () => {
  const room = fakeElement("div");
  assert.equal(attachLobbyRoomTopBar(room as unknown as HTMLElement, () => undefined), undefined);
  assert.deepEqual(room.children, []);
});
