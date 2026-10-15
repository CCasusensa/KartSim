/**
 * 单人游戏 · 地图工坊：打开地图列表窗口（ui/custom-game-window.ts）；
 * 选一张地图“开始计时赛”时，把 Ready 的赛道换成它，再翻到计时赛页面
 * （与“练习计时赛”相同），玩家点开始即可。
 */
import { customTrackPath } from "../mapeditor/custom-tracks";
import { CustomGameWindow } from "../ui/custom-game-window";
import type { BmlLibrary } from "../ui/bml-kit";
import { closeReadyHome, type ReadyHomeController } from "./ready-home";

export async function openReadyCustomGame(controller: ReadyHomeController): Promise<void> {
  const host = controller.host as ReadyHomeController["host"] & { root: HTMLElement };
  const library = host.getLibrary() as unknown as BmlLibrary | undefined;
  if (!library || controller.disposed) return;
  try {
    await CustomGameWindow.open({
      library, root: host.root,
      onActivate: () => host.getInterfaceAudio()?.playClick(),
      onPlay: async trackId => {
        const selection = host.getSelection();
        if (!selection || controller.disposed) return;
        host.setSelection({ ...selection, trackId, mapPath: customTrackPath(trackId) });
        await host.enterTimeAttackReady();
        closeReadyHome(controller);
      },
    });
  } catch (error) {
    console.error("地图工坊窗口打开失败", error);
  }
}
