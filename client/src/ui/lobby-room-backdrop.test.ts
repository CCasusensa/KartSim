import assert from "node:assert/strict";
import test from "node:test";

import { setLobbyHomeBackdrop } from "./lobby-home-backdrop";
import { LOBBY_ROOM_BACKDROP_FILL, drawLobbyRoomBackdrop } from "./lobby-room-backdrop";

function recordingContext() {
  const calls: unknown[][] = [];
  const context = {
    fillStyle: "",
    fillRect(...args: number[]) { calls.push(["fill", this.fillStyle, ...args]); },
    drawImage(...args: unknown[]) { calls.push(["image", ...args]); },
  };
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

const area = { x: 0, y: 0, width: 1600, height: 900 };

// Runs before any frame is kept: the module state cannot be cleared again.
test("没有大厅画面时房间背景只铺深蓝底色", () => {
  const { context, calls } = recordingContext();
  drawLobbyRoomBackdrop(context, area);
  assert.deepEqual(calls, [["fill", LOBBY_ROOM_BACKDROP_FILL, 0, 0, 1600, 900]]);
});

test("房间背景把大厅最新一帧按覆盖裁切铺满设计区域，交给窗口自己的暗幕压暗", () => {
  const image = { tag: "lobby-frame" };
  // A 4:3 frame on the 16:9 stage: full width, the middle 450 rows.
  setLobbyHomeBackdrop({ image: image as unknown as CanvasImageSource, width: 800, height: 600 });
  const { context, calls } = recordingContext();
  drawLobbyRoomBackdrop(context, area);
  assert.deepEqual(calls, [
    ["fill", LOBBY_ROOM_BACKDROP_FILL, 0, 0, 1600, 900],
    ["image", image, 0, 75, 800, 450, 0, 0, 1600, 900],
  ]);
});

test("房间背景的区域位置也会被尊重", () => {
  const { context, calls } = recordingContext();
  drawLobbyRoomBackdrop(context, { x: 10, y: 20, width: 400, height: 300 });
  assert.deepEqual(calls, [
    ["fill", LOBBY_ROOM_BACKDROP_FILL, 10, 20, 400, 300],
    ["image", { tag: "lobby-frame" }, 0, 0, 800, 600, 10, 20, 400, 300],
  ]);
});
