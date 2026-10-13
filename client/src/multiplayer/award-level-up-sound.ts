/** 升级: sound_fx_etc levelup.flac, played when the award stand's first level-up effect starts. */
import { Q9, S9 } from "../generated/library.js";
import { loadRequiredInterfaceAudio, type InterfaceAudioLibrary } from "../timeattack/interface-audio";

export const LEVEL_UP_SOUND = "sound_/fx/etc/levelup.flac";

export async function loadLevelUpSound(library: unknown, context: AudioContext): Promise<() => void> {
  const buffer = await loadRequiredInterfaceAudio(library as InterfaceAudioLibrary, context,
    LEVEL_UP_SOUND, { decode: Q9, route: S9 } as never);
  return () => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    // The "fx" group: sound effect volume and mute.
    S9(context, source);
    source.onended = () => source.disconnect();
    source.start();
  };
}
