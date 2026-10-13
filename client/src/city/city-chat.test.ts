import assert from "node:assert/strict";
import test from "node:test";
import { GameplayInputQueue, isEditableTarget } from "../input/gameplay-input-queue";
import { RaceChatOverlay, type RaceChatDependencies, type RaceChatMessage } from "../multiplayer/race-chat-overlay";
import { installShopTestDom, TestElement, type TestEvent } from "../shop/shop-test-dom";
import { CityNetwork, createCityRaceConnection, type CityClient } from "./city-connection";
import type { CityEvent } from "./city-protocol";
import { CitySession } from "./city-session";

/** Exercise the session's real event adapter without loading a city or WebGL. */
interface SessionChatAdapter {
  chatListeners: Set<(message: RaceChatMessage) => void>;
  onEvent(event: CityEvent): void;
}

const raceId = "10000000-0000-4000-8000-000000000001";

function fixture(city = true) {
  const dom = installShopTestDom();
  const painted: string[] = [], requests: Record<string, unknown>[] = [];
  const ordinaryCalls: unknown[][] = [], statuses: string[] = [], releasedFonts: unknown[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const context = { clearRect() { painted.length = 0; }, drawImage() {}, strokeText() {},
    fillText(text: string) { painted.push(text); } };
  // The shared DOM provides event propagation; add only canvas and browser
  // focusin/matches behavior needed by the real chat and gameplay input queue.
  const decorate = (element: TestElement): TestElement => {
    const focus = element.focus.bind(element);
    Object.assign(element, {
      matches: (selector: string) => selector.split(",").some(part =>
        part.trim().toUpperCase() === element.tagName),
      getContext: () => context,
      focus() {
        const previous = dom.document.activeElement;
        focus();
        if (dom.document.activeElement === element && previous !== element) element.fire("focusin");
      },
    });
    return element;
  };
  const createElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = tag => decorate(createElement(tag));
  decorate(dom.document.body);
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const serverListeners = new Set<(event: Record<string, unknown>) => void>();
  const client: CityClient = {
    playerId: "local",
    async request(message) { requests.push(message); return { type: "ok" }; },
    subscribe(listener) { serverListeners.add(listener); return () => { serverListeners.delete(listener); }; },
    captureClock() { return undefined; },
  };
  const session = new CitySession({ client, playerId: "local", disposed: false, render() {},
    options: { library: {}, root, status(message) { statuses.push(message); } } });
  const adapter = session as unknown as SessionChatAdapter;
  const network = new CityNetwork(client, raceId, {
    onEvent: event => adapter.onEvent(event), onMotion() {}, onRadar() {},
  });
  const subscribe = (listener: (message: RaceChatMessage) => void) => {
    adapter.chatListeners.add(listener);
    return () => { adapter.chatListeners.delete(listener); };
  };
  const cityConnection = createCityRaceConnection(network, "local", "city:1", raceId, {
    leave: async () => undefined, onChat: subscribe,
  });
  const connection = city ? cityConnection : {
    playerId: "local", roomId: "race-room", raceId: "ordinary-race",
    sendRaceChat: async (...args: unknown[]) => { ordinaryCalls.push(args); }, subscribeRaceChat: subscribe,
  };
  const dependencies: RaceChatDependencies = {
    loadFrame: async () => ({ width: 1, height: 1, pixels: [255, 255, 255, 255] }),
    loadEmotions: async () => [], loadFontBytes: async () => new Uint8Array(),
    registerFont: async () => "font", releaseFont: font => { releasedFonts.push(font); },
    parseChat: text => ({ text }), nowMs: dom.now,
    setTimer(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); },
  };
  const overlay = new RaceChatOverlay(root as unknown as HTMLElement, connection,
    message => statuses.push(message), dom.document.createElement("canvas") as unknown as HTMLCanvasElement,
    "font", [], dependencies);
  overlay.show();
  overlay.setAllowed(true);
  const input = overlay.input as unknown as TestElement;
  const select = overlay.channelSelect as unknown as TestElement | undefined;
  return { dom, root, overlay, input, select, cityConnection, network, adapter,
    requests, ordinaryCalls, statuses, painted, releasedFonts, timers, serverListeners,
    receive(channel: "city" | "near", text: string, sequence = 1, playerId = "local", name = "车手") {
      for (const listener of serverListeners) listener({ type: "city-chat", instanceId: "city:1",
        id: playerId === "local" ? 1 : 2, sequence, playerId, name, text, channel });
    },
    dispose() { overlay.dispose(); network.dispose(); dom.restore(); },
  };
}

const settleSend = () => new Promise<void>(resolve => setImmediate(resolve));

test("city chat defaults to 全城 and sends the retained 附近 selection through the city connection", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.select!.children.map(option => [option.value, option.textContent]),
      [["city", "全城"], ["near", "附近"]]);
    assert.equal(f.select!.hidden, true);
    assert.equal(f.dom.key("keydown", "Enter").defaultPrevented, true);
    assert.equal(f.dom.document.activeElement, f.input);
    assert.equal(f.select!.hidden, false);
    assert.equal(f.select!.value, "city");
    assert.equal(f.input.getAttribute("aria-label"), "全城聊天内容");
    f.input.value = "  大家好  ";
    f.dom.key("keydown", "Enter");
    await settleSend();
    assert.deepEqual(f.requests, [{ type: "city-chat", text: "大家好", channel: "city" }]);
    assert.equal(f.overlay.messages.size, 0, "sending waits for the server echo instead of adding a duplicate locally");
    assert.equal(f.select!.hidden, true);
    assert.equal(f.input.hidden, true);

    f.dom.key("keydown", "Enter");
    f.select!.focus();
    f.select!.value = "near";
    f.select!.fire("change");
    assert.equal(f.dom.document.activeElement, f.input);
    assert.equal(f.input.getAttribute("aria-label"), "附近聊天内容");
    assert.match(f.input.placeholder, /周围/);
    f.input.value = "附近集合";
    f.dom.key("keydown", "Enter");
    await settleSend();
    assert.deepEqual(f.requests[1], { type: "city-chat", text: "附近集合", channel: "near" });
    f.dom.key("keydown", "Enter");
    assert.equal(f.select!.value, "near", "reopening does not reset the chosen speaking scope");
    await assert.rejects(f.cityConnection.sendRaceChat("bad", "district"), /无效的聊天频道/);
    assert.equal(f.requests.length, 2);
  } finally { f.dispose(); }
});

test("city event adapter preserves both channel labels and displays each server echo once", async () => {
  const f = fixture();
  try {
    await f.cityConnection.sendRaceChat("全城消息");
    assert.equal(f.overlay.messages.size, 0);
    f.receive("city", "全城消息", 17);
    f.receive("near", "附近消息", 18, "other", "邻居");
    const messages = [...f.overlay.messages.values()].map(entry => entry.message);
    assert.deepEqual(messages.map(message => [message.channel, message.text]),
      [["city", "全城消息"], ["near", "附近消息"]]);
    assert.equal(f.overlay.log.textContent, "[全城] 车手 : 全城消息\n[附近] 邻居 : 附近消息");
    assert.deepEqual(f.painted, ["[全城] 车手 : 全城消息", "[附近] 邻居 : 附近消息"]);
    f.overlay.append(messages[0]!);
    assert.equal(f.overlay.messages.size, 2, "the same delivered chat line is not drawn twice");
    f.overlay.open();
    f.select!.value = "near";
    f.select!.fire("change");
    assert.equal(f.overlay.log.textContent, "[全城] 车手 : 全城消息\n[附近] 邻居 : 附近消息",
      "selecting a speaking scope does not filter received messages");
  } finally { f.dispose(); }
});

test("Chinese composition and repeated Enter never send or clear the city chat draft", async () => {
  const f = fixture();
  try {
    f.overlay.open();
    f.input.value = "中文输入";
    for (const flags of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      f.dom.key("keydown", "Enter", flags);
      assert.equal(f.requests.length, 0);
      assert.equal(f.input.value, "中文输入");
      assert.equal(f.input.hidden, false);
    }
    f.dom.key("keydown", "Enter");
    await settleSend();
    assert.deepEqual(f.requests, [{ type: "city-chat", text: "中文输入", channel: "city" }]);
    assert.equal(f.input.value, "");
  } finally { f.dispose(); }
});

test("chat focus cancels held driving keys and channel navigation or Escape cannot reach city shortcuts", () => {
  const f = fixture();
  const actions: Record<string, number[]> = { KeyW: [1], KeyR: [2], ArrowRight: [3] };
  const queue = new GameplayInputQueue({ keyMap: {}, editableTarget: isEditableTarget,
    resolveActions: code => actions[code] ?? [] });
  let cityEscapes = 0;
  const onWindowKey = (event: TestEvent) => { if (event.code === "Escape") cityEscapes++; };
  f.dom.window.addEventListener("keydown", onWindowKey);
  try {
    f.dom.key("keydown", "w");
    assert.equal(queue.drain().transitions[0]?.down, true);
    f.dom.key("keydown", "Enter");
    assert.equal(queue.drain().cancelled, true, "input focus releases the previously held accelerator");
    f.dom.key("keydown", "r");
    assert.deepEqual(queue.drain().transitions, []);
    for (let attempt = 0; attempt < 2; attempt++) {
      f.overlay.open();
      f.select!.focus();
      assert.equal(queue.drain().cancelled, true);
      f.dom.key("keydown", "ArrowRight");
      f.dom.key("keydown", "r");
      f.dom.key("keyup", "r");
      assert.deepEqual(queue.drain().transitions, []);
      const escape = f.dom.key("keydown", "Escape");
      assert.equal(escape.defaultPrevented, true);
      assert.equal(cityEscapes, 0, "closing the selector does not advance the city's double-Escape exit");
      assert.equal(f.input.hidden, true);
      assert.equal(f.select!.hidden, true);
    }
    assert.equal(f.requests.length, 0);
  } finally {
    f.dom.window.removeEventListener("keydown", onWindowKey);
    queue.dispose();
    f.dispose();
  }
});

test("disposing city chat releases its subscription, keyboard handlers, font and expiry timer once", () => {
  const f = fixture();
  try {
    f.overlay.open();
    f.receive("city", "待清理消息");
    assert.equal(f.adapter.chatListeners.size, 1);
    assert.equal(f.timers.size, 1);
    assert.equal(f.dom.window.listenerCount("keydown"), 1);
    f.overlay.dispose();
    f.overlay.dispose();
    assert.equal(f.adapter.chatListeners.size, 0);
    assert.equal(f.dom.window.listenerCount("keydown"), 0);
    assert.equal(f.input.listenerCount("keydown"), 0);
    assert.equal(f.select!.listenerCount("keydown"), 0);
    assert.equal(f.select!.listenerCount("change"), 0);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.releasedFonts, ["font"]);
    assert.equal(f.root.childElementCount, 0);
    f.receive("near", "晚到消息", 2);
    assert.equal(f.overlay.messages.size, 1);
    f.network.dispose();
    assert.equal(f.serverListeners.size, 0);
  } finally { f.dispose(); }
});

test("ordinary races keep the original one-argument send and unprefixed message format", async () => {
  const f = fixture(false);
  try {
    assert.equal(f.overlay.channelSelect, undefined);
    assert.equal(f.root.querySelector("select"), null);
    f.dom.key("keydown", "Enter");
    f.input.value = "普通比赛";
    f.dom.key("keydown", "Enter");
    await settleSend();
    assert.deepEqual(f.ordinaryCalls, [["普通比赛"]]);
    const message = { sequence: 1, playerId: "other", name: "对手", text: "加油" };
    for (const listener of f.adapter.chatListeners) listener(message);
    assert.equal(f.overlay.log.textContent, "对手 : 加油");
    assert.deepEqual(f.painted, ["对手 : 加油"]);
    assert.equal(f.requests.length, 0);
  } finally { f.dispose(); }
});
