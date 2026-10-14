/** In-race chat overlay: room/race messages, input gates, drawing, and cleanup. */

import { brawlAiIds } from "./lobby-brawl-mode";

export interface RaceChatMessage {
  sequence: number;
  playerId: unknown;
  name: string;
  text: string;
  channel?: string;
}

export interface RaceChatChannel { id: string; label: string; description: string }

interface RaceChatRoom {
  roomId: unknown;
  phase: string;
  members: unknown[];
  chat?: RaceChatMessage[];
  race?: { raceId: unknown; loadedIds: unknown[]; chat?: RaceChatMessage[] };
}

interface RaceChatConnection {
  roomId: unknown;
  raceId: unknown;
  playerId: unknown;
  chatChannels?: readonly RaceChatChannel[];
  sendRaceChat?(text: string, channel?: string): Promise<unknown>;
  subscribeRaceChat?(listener: (message: RaceChatMessage) => void): () => void;
}

interface DecodedImage {
  width: number;
  height: number;
  pixels: ArrayLike<number>;
}

export interface RaceChatDependencies {
  loadFrame(library: unknown): Promise<DecodedImage>;
  loadEmotions(library: unknown): Promise<unknown[]>;
  loadFontBytes(library: unknown): Promise<Uint8Array>;
  registerFont(family: string, bytes: Uint8Array): Promise<unknown>;
  releaseFont(font: unknown): void;
  parseChat(text: string, emotions: unknown[]): { text: string };
  nowMs(): number;
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(timer: number): void;
}

const fontFamily = "KartSim Multiplayer Race Chat";
const messageLifetimeMs = 5000;
/** Local race notices (not chat messages), e.g. the item race Z key. */
const noticeColor = "#ffd200";
const maxNotices = 3;

function enterKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.code === "Enter";
}

function loadingLine(room: RaceChatRoom): string | undefined {
  return room.phase === "loading" && room.race
    ? `已加载 ${room.race.loadedIds.filter(id => !brawlAiIds(room.race).has(id as string)).length}/${room.members.length} 人，等待统一起跑`
    : undefined;
}

function messageText(message: RaceChatMessage, channelLabel?: string): string {
  return `${channelLabel ? `[${channelLabel}] ` : ""}${message.name} : ${message.text}`;
}

export class RaceChatOverlay {
  readonly element = document.createElement("section");
  readonly log = document.createElement("div");
  readonly canvas = document.createElement("canvas");
  readonly input = document.createElement("input");
  readonly connection: RaceChatConnection;
  readonly status: (message: string, error?: boolean) => void;
  readonly frame: HTMLCanvasElement;
  readonly font: unknown;
  readonly emotions: unknown[];
  readonly dependencies: RaceChatDependencies;
  off: () => void;
  allowed = false;
  shown = false;
  sending = false;
  disposed = false;
  messages = new Map<number, { message: RaceChatMessage; until: number }>();
  /** Not in the release: local one-line notices drawn under the chat lines. */
  notices: Array<{ text: string; until: number }> = [];
  hideTimer?: number;
  roomChannel = false;
  loadingLine?: string;
  readonly channelSelect?: HTMLSelectElement;

  constructor(root: HTMLElement, connection: RaceChatConnection,
    status: (message: string, error?: boolean) => void,
    frame: HTMLCanvasElement, font: unknown, emotions: unknown[],
    dependencies: RaceChatDependencies) {
    this.connection = connection;
    this.status = status;
    this.frame = frame;
    this.font = font;
    this.emotions = emotions;
    this.dependencies = dependencies;
    if (!connection.sendRaceChat || !connection.subscribeRaceChat) {
      throw new Error("本局连接缺少聊天通道。");
    }

    this.element.className = "multiplayer-race-chat";
    this.element.dataset.uiLayer = "dialog";
    this.element.setAttribute("aria-label", "比赛聊天");
    this.element.hidden = true;
    this.log.className = "multiplayer-race-chat-log";
    this.log.setAttribute("aria-live", "polite");
    this.canvas.className = "multiplayer-race-chat-canvas";
    this.canvas.width = 520;
    this.canvas.height = 156;
    this.input.className = "multiplayer-race-chat-input";
    this.input.type = "text";
    this.input.maxLength = 20;
    this.input.hidden = true;
    this.input.addEventListener("keydown", this.onInputKeyDown);
    this.element.append(this.canvas, this.log, this.input);
    if (connection.chatChannels?.length) {
      const select = document.createElement("select");
      this.channelSelect = select;
      select.className = "multiplayer-race-chat-channel";
      select.setAttribute("aria-label", "聊天频道");
      select.hidden = true;
      // A switch beside the input, like the chat box's own fields: a click or a
      // key steps to the next scope instead of opening the browser's option list.
      select.style.cssText = "position:absolute;left:15px;bottom:7%;width:88px;height:24px;box-sizing:border-box;pointer-events:auto;background:#173550;color:#fff2a8;border:1px solid #87a6bf;border-radius:3px;font:inherit;font-size:14px;cursor:pointer;appearance:none;-webkit-appearance:none;text-align:center;text-align-last:center;";
      for (const channel of connection.chatChannels) {
        const option = document.createElement("option");
        option.value = channel.id;
        option.textContent = channel.label;
        select.append(option);
      }
      select.value = connection.chatChannels[0]!.id;
      select.addEventListener("change", this.onChannelChange);
      select.addEventListener("keydown", this.onChannelKeyDown);
      select.addEventListener("mousedown", this.onChannelPointer);
      this.input.style.left = "112px";
      this.input.style.width = "calc(100% - 128px)";
      this.updateChannelHint();
      this.element.append(select);
    }
    root.append(this.element);
    window.addEventListener("keydown", this.onWindowKeyDown, true);
    this.off = connection.subscribeRaceChat(message => this.append(message));
    this.renderMessages();
  }

  static async load<T extends RaceChatOverlay>(
    this: new (root: HTMLElement, connection: RaceChatConnection,
      status: (message: string, error?: boolean) => void,
      frame: HTMLCanvasElement, font: unknown, emotions: unknown[],
      dependencies: RaceChatDependencies) => T,
    library: unknown, root: HTMLElement, connection: RaceChatConnection,
    status: (message: string, error?: boolean) => void,
    dependencies: RaceChatDependencies): Promise<T> {
    const [image, emotions, bytes] = await Promise.all([
      dependencies.loadFrame(library), dependencies.loadEmotions(library),
      dependencies.loadFontBytes(library),
    ]);
    const font = await dependencies.registerFont(fontFamily, bytes);
    try {
      const frame = document.createElement("canvas");
      frame.width = image.width;
      frame.height = image.height;
      frame.getContext("2d")!.putImageData(new ImageData(
        new Uint8ClampedArray(image.pixels), image.width, image.height,
      ), 0, 0);
      return new this(root, connection, status, frame, font, emotions,
        dependencies);
    } catch (error) {
      dependencies.releaseFont(font);
      throw error;
    }
  }

  show(): void {
    if (this.disposed) return;
    this.shown = true;
    this.element.hidden = false;
  }

  updateRoom(room: RaceChatRoom): void {
    if (this.disposed || room.roomId !== this.connection.roomId) return;
    const line = loadingLine(room);
    if (line !== this.loadingLine) {
      this.loadingLine = line;
      this.renderMessages();
    }
    const inRoom = room.phase === "open";
    if (inRoom !== this.roomChannel) {
      this.roomChannel = inRoom;
      this.renderMessages();
    }
    if (inRoom) {
      for (const message of room.chat ?? []) this.append(message);
      return;
    }
    if (room.race?.raceId === this.connection.raceId) {
      for (const message of room.race!.chat ?? []) this.append(message);
    }
  }

  setAllowed(allowed: boolean): void {
    if (this.disposed || this.allowed === allowed) return;
    this.allowed = allowed;
    if (!allowed) this.close();
  }

  append(message: RaceChatMessage): void {
    if (this.disposed || this.messages.has(message.sequence)) return;
    this.messages.set(message.sequence, {
      message, until: this.dependencies.nowMs() + messageLifetimeMs,
    });
    const sequences = [...this.messages.keys()].sort((a, b) => a - b);
    while (sequences.length > 32) this.messages.delete(sequences.shift()!);
    this.renderMessages();
  }

  /** Show a local notice line for the chat message lifetime; nothing is sent. */
  notice(text: string): void {
    if (this.disposed || !text) return;
    this.notices.push({ text, until: this.dependencies.nowMs() + messageLifetimeMs });
    while (this.notices.length > maxNotices) this.notices.shift();
    this.renderMessages();
  }

  renderMessages(): void {
    if (this.hideTimer !== undefined) {
      this.dependencies.clearTimer(this.hideTimer);
      this.hideTimer = undefined;
    }
    const nowMs = this.dependencies.nowMs();
    const current = [...this.messages.values()]
      .filter(entry => entry.until > nowMs)
      .sort((a, b) => a.message.sequence - b.message.sequence)
      .slice(-8);
    const canvas = this.canvas;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.input.hidden) context.drawImage(this.frame, 0, 0,
      canvas.width, canvas.height);
    context.font = `16px '${fontFamily}'`;
    context.textBaseline = "top";
    context.strokeStyle = "#000";
    context.lineWidth = 2;
    context.lineJoin = "round";
    if (this.loadingLine) {
      context.fillStyle = "#00e9ff";
      context.strokeText(this.loadingLine, 12, 10, canvas.width - 24);
      context.fillText(this.loadingLine, 12, 10, canvas.width - 24);
    }
    const notices = (this.notices ?? []).filter(entry => entry.until > nowMs);
    if (this.notices) this.notices = notices;
    const lines = [...current.map(({ message }) => ({
      message, text: this.dependencies.parseChat(message.text, this.emotions).text,
    })).filter(line => line.text).map(({ message, text }) => ({
      color: message.playerId === this.connection.playerId ? "#a3ff2a" : "#fff",
      line: messageText({ ...message, text }, this.connection.chatChannels?.find(channel => channel.id === message.channel)?.label),
    })), ...notices.map(entry => ({ color: noticeColor, line: entry.text }))]
      .slice(-(this.loadingLine ? 4 : 5));
    lines.forEach(({ color, line }, index) => {
      context.fillStyle = color;
      const y = canvas.height - 56 - (lines.length - 1 - index) * 19;
      context.strokeText(line, 12, y, canvas.width - 24);
      context.fillText(line, 12, y, canvas.width - 24);
    });
    this.log.textContent = [this.loadingLine, ...lines.map(({ line }) => line)]
      .filter(Boolean).join("\n");
    this.log.scrollTop = this.log.scrollHeight;
    const expiries = [...current, ...notices].map(entry => entry.until);
    if (expiries.length) {
      this.hideTimer = this.dependencies.setTimer(() => this.renderMessages(),
        Math.max(1, Math.ceil(Math.min(...expiries) - nowMs)));
    }
  }

  open(): void {
    if (!this.shown || !this.allowed || this.disposed) return;
    this.input.hidden = false;
    if (this.channelSelect) this.channelSelect.hidden = false;
    this.renderMessages();
    this.input.focus();
  }

  close(): void {
    if (this.input.hidden) return;
    this.input.hidden = true;
    if (this.channelSelect) {
      this.channelSelect.hidden = true;
      this.channelSelect.blur();
    }
    this.input.blur();
    this.renderMessages();
  }

  readonly onWindowKeyDown = (event: KeyboardEvent): void => {
    if (!this.shown || !this.allowed || this.disposed || !enterKey(event) ||
      event.repeat || event.isComposing || event.keyCode === 229 ||
      !this.input.hidden) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.open();
  };

  private updateChannelHint(): void {
    const channel = this.connection.chatChannels?.find(entry => entry.id === this.channelSelect?.value);
    if (!channel) return;
    this.input.placeholder = channel.description;
    this.input.setAttribute("aria-label", `${channel.label}聊天内容`);
    this.channelSelect!.title = channel.description;
  }

  readonly onChannelChange = (): void => {
    this.updateChannelHint();
    if (!this.input.hidden) this.input.focus();
  };

  readonly onChannelKeyDown = (event: KeyboardEvent): void => {
    // Choosing a scope must never steer/reset the kart or trigger city exit.
    event.stopPropagation();
    if (event.key === "Escape" || event.code === "Escape") {
      event.preventDefault();
      this.close();
    } else if ([" ", "Enter", "ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      this.stepChannel(event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  /** The scope switch never opens the browser's own option list. */
  readonly onChannelPointer = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    this.stepChannel(1);
  };

  private stepChannel(step: number): void {
    const select = this.channelSelect;
    const channels = this.connection.chatChannels ?? [];
    if (!select || channels.length < 2) return;
    const index = Math.max(0, channels.findIndex(channel => channel.id === select.value));
    select.value = channels[(index + step + channels.length) % channels.length]!.id;
    this.onChannelChange();
  }

  readonly onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
      return;
    }
    if (!enterKey(event) || event.repeat || event.isComposing ||
      event.keyCode === 229) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = this.input.value.trim();
    if (!text) {
      this.close();
      return;
    }
    if (this.sending || !this.allowed) return;
    const channel = this.channelSelect?.value;
    this.sending = true;
    this.input.value = "";
    this.close();
    // Keep the ordinary race call shape unchanged when it has no scope picker.
    void (channel === undefined ? this.connection.sendRaceChat!(text) : this.connection.sendRaceChat!(text, channel))
      .then(() => { void this.disposed; })
      .catch(error => {
        if (this.disposed) return;
        const reason = error instanceof Error ? error.message : String(error);
        if (reason === "RACE_CHAT_CLOSED") this.setAllowed(false);
        this.status(reason === "CHAT_RATE_LIMIT" || reason === "CHAT_MUTED"
          ? "发送过快，请稍后重试。"
          : reason === "RACE_CHAT_CLOSED"
            ? "当前阶段不能发送文字消息。"
            : `${this.channelSelect ? "卡丁城" : "比赛"}聊天发送失败：${reason}`, true);
      })
      .finally(() => { this.sending = false; });
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.hideTimer !== undefined) this.dependencies.clearTimer(this.hideTimer);
    this.off();
    window.removeEventListener("keydown", this.onWindowKeyDown, true);
    this.input.removeEventListener("keydown", this.onInputKeyDown);
    this.channelSelect?.removeEventListener("change", this.onChannelChange);
    this.channelSelect?.removeEventListener("keydown", this.onChannelKeyDown);
    this.channelSelect?.removeEventListener("mousedown", this.onChannelPointer);
    this.dependencies.releaseFont(this.font);
    this.element.remove();
  }
}
