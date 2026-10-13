import assert from "node:assert/strict";
import test from "node:test";
import {
  environmentBgmPath, myRoomBgmChoices, myRoomBgmPath, stageDefaultBgmPath,
  type MyRoomBgmSources,
} from "./my-room-bgm";

// zeta_/cn/content/bgmList.xml, trimmed (single quotes and tabs as in the release).
const BGM_LIST = `<customBgm>
  <bgmList>
    <bgm id='149'	priority='1'	theme='tomb2'	    name='tomb_04'/>
    <bgm id='150'	priority='1'	theme='tomb2'	    name='tomb_05'/>
    <bgm id='101'	priority='1'	theme='camelot'	  name='camelot_01'/>
  </bgmList>
  <defaultBgmList>
    <defaultBgm stage='MainMenuEx'              id='149' />
    <defaultBgm stage='MyRoomStage'             ref='MainMenuEx'/>
    <defaultBgm stage='GameReadyStage'          theme='main' name='multi'/>
    <defaultBgm stage='Loop'                    ref='Loop'/>
  </defaultBgmList>
</customBgm>`;

function sources(files: string[], themes: Record<string, string[]> = {}): MyRoomBgmSources {
  return {
    choices: [
      { id: 149, label: "tomb_04", path: "sound_/bgm/tomb2/tomb_04.ogg" },
      { id: 101, label: "亚瑟传说", path: "sound_/bgm/camelot/camelot_01.ogg" },
    ],
    stageDefault: stageDefaultBgmPath(BGM_LIST, "MyRoomStage"),
    exists: path => files.includes(path),
    themeTracks: theme => themes[theme] ?? [],
  };
}

test("defaultBgmList refs resolve to the stage's track", () => {
  assert.equal(stageDefaultBgmPath(BGM_LIST, "MyRoomStage"), "sound_/bgm/tomb2/tomb_04.ogg");
  assert.equal(stageDefaultBgmPath(BGM_LIST, "GameReadyStage"), "sound_/bgm/main/multi.ogg");
  assert.equal(stageDefaultBgmPath(BGM_LIST, "Loop"), undefined);
  assert.equal(stageDefaultBgmPath(BGM_LIST, "Missing"), undefined);
});

test("设置音乐 labels stay unique for the combo", () => {
  const choices = myRoomBgmChoices([
    { id: 1, label: "幻想舞会", path: "a" }, { id: 2, label: " 幻想舞会 ", path: "b" },
    { id: 3, label: "", path: "c" },
  ]);
  assert.deepEqual(choices.map(choice => choice.label), ["幻想舞会", "幻想舞会 (2)", "3"]);
});

test("an environment plays its own myRoomLocale music", () => {
  const files = ["sound_/bgm/olympos/olympos_01.ogg", "sound_/bgm/main/888마이룸.ogg",
    "sound_/bgm/camelot/camelot_01.ogg"];
  const all = sources(files, { xmas: ["sound_/bgm/xmas/xmas_01.ogg", "sound_/bgm/xmas/xmas_02.ogg"] });
  // 奥林匹斯: bgmTheme + bgm; 888小屋: sound_/bgm/main; 亚瑟传说: the table.
  assert.equal(environmentBgmPath({ bgm: "olympos_01", bgmTheme: "olympos" }, all),
    "sound_/bgm/olympos/olympos_01.ogg");
  assert.equal(environmentBgmPath({ bgm: "888마이룸" }, all), "sound_/bgm/main/888마이룸.ogg");
  assert.equal(environmentBgmPath({ bgm: "camelot_01" }, all), "sound_/bgm/camelot/camelot_01.ogg");
  // 圣诞小屋 only names a theme.
  assert.equal(environmentBgmPath({ bgmTheme: "xmas" }, all), "sound_/bgm/xmas/xmas_01.ogg");
  assert.equal(environmentBgmPath({}, all), undefined);
  assert.equal(environmentBgmPath({ bgm: "../x" }, all), undefined);
});

test("默认 follows the environment, then the main-menu music", () => {
  const files = ["sound_/bgm/main/888마이룸.ogg", "sound_/bgm/main/single.ogg",
    "sound_/bgm/tomb2/tomb_04.ogg", "sound_/bgm/camelot/camelot_01.ogg"];
  const all = sources(files);
  assert.equal(myRoomBgmPath(101, { bgm: "888마이룸" }, all), "sound_/bgm/camelot/camelot_01.ogg");
  assert.equal(myRoomBgmPath(0, { bgm: "888마이룸" }, all), "sound_/bgm/main/888마이룸.ogg");
  // A track this build lacks counts as 默认.
  assert.equal(myRoomBgmPath(999, { bgm: "888마이룸" }, all), "sound_/bgm/main/888마이룸.ogg");
  assert.equal(myRoomBgmPath(undefined, {}, all), "sound_/bgm/tomb2/tomb_04.ogg");
  assert.equal(myRoomBgmPath(0, {}, all, "sound_/bgm/main/single.ogg"), "sound_/bgm/main/single.ogg");
  assert.equal(myRoomBgmPath(0, {}, all, "sound_/bgm/main/gone.ogg"), "sound_/bgm/tomb2/tomb_04.ogg");
});
