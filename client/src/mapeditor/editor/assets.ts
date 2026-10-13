/**
 * 编辑器读取官方素材：赛道列表、模型、物件、贴图，以及用游戏自己的赛道
 * 场景装配（c5）把官方物件画进视口。
 */
import { Object3D, type Texture } from "three";
import { c5, ha, rn, y9, sn } from "../../generated/formats.js";
import { loadLegacyTexture } from "../../resources/legacy-texture-loader";
import { invisibleTrackGeometry } from "../../resources/moving-obstacle";
import { makeNode } from "../../resources/track-binary-writer";
import type { TrackMetadata } from "../../resources/track-catalog";
import {
  listPieces, listSurfaceTextures, listSourceTracks, nodeAtPath, sourceTrackPath,
  type PieceInfo, type SourceFormats, type SourceLibrary, type SourceTrack, type SurfaceTexture,
} from "../source-tracks";

export interface AssembledScene {
  object: Object3D;
  update(time: number, camera: unknown, width: number, height: number): void;
  reset?(time: number): void;
  playControllers?(time: number, duration?: number): void;
  dispose(): void;
}

export type EditorLibrary = SourceLibrary & {
  files: Array<{ virtualPath: string; canonicalPath?: string }>;
  canonicalCandidates(path: string): Array<{ bytes(): Promise<Uint8Array> }>;
};

export const formats: SourceFormats = { y9, sn } as unknown as SourceFormats;

const SAMPLER = { addressU: 1, addressV: 1, magFilter: 3, minFilter: 2, mipFilter: 2, maxAnisotropy: 1 };

export class EditorAssets {
  private trackList?: Promise<SourceTrack[]>;
  private readonly models = new Map<string, Promise<any>>();
  private readonly modelOrder: string[] = [];
  private readonly pieceLists = new Map<string, Promise<PieceInfo[]>>();
  private readonly textures = new Map<string, Promise<Texture | undefined>>();
  private environment?: Promise<unknown>;
  readonly stageBinding = new ha();
  readonly textureCache = new Map<string, unknown>();

  constructor(readonly library: EditorLibrary) {}

  tracks(): Promise<SourceTrack[]> {
    return this.trackList ??= listSourceTracks(this.library);
  }

  async track(folder: string): Promise<SourceTrack | undefined> {
    return (await this.tracks()).find(track => track.folder === folder);
  }

  metadata(folder: string): Promise<TrackMetadata | undefined> {
    return this.library.trackMetadata(folder);
  }

  /** 官方赛道模型（最近用过的 8 条留在内存）。 */
  model(folder: string): Promise<any> {
    let pending = this.models.get(folder);
    if (!pending) {
      pending = (async () => {
        const entry = this.library.get(sourceTrackPath(folder));
        if (!entry) throw new Error(`找不到官方赛道 ${folder}。`);
        return y9(await entry.bytes()).root;
      })();
      pending.catch(() => this.models.delete(folder));
      this.models.set(folder, pending);
    }
    const index = this.modelOrder.indexOf(folder);
    if (index >= 0) this.modelOrder.splice(index, 1);
    this.modelOrder.push(folder);
    while (this.modelOrder.length > 8) {
      const old = this.modelOrder.shift()!;
      this.models.delete(old);
      this.pieceLists.delete(old);
    }
    return pending;
  }

  pieces(folder: string): Promise<PieceInfo[]> {
    let pending = this.pieceLists.get(folder);
    if (!pending) {
      pending = this.model(folder).then(listPieces);
      this.pieceLists.set(folder, pending);
    }
    return pending;
  }

  async surfaces(folder: string): Promise<SurfaceTexture[]> {
    return listSurfaceTextures(await this.model(folder));
  }

  /** 按游戏规则解析一张官方贴图并解码成 three.js 贴图。 */
  texture(track: string, name: string): Promise<Texture | undefined> {
    const key = `${track}\n${name}`;
    let pending = this.textures.get(key);
    if (!pending) {
      pending = (async () => {
        const metadata = await this.metadata(track);
        const found = sn(this.library, sourceTrackPath(track), metadata ?? { id: track }, { name }) as
          { status: string; entry?: { extension: string; virtualPath: string; bytes(): Promise<Uint8Array> } };
        if (found.status !== "found" || !found.entry) return undefined;
        const texture = await loadLegacyTexture(found.entry, SAMPLER);
        texture.needsUpdate = true;
        return texture;
      })().catch(error => { console.warn("贴图载入失败", track, name, error); return undefined; });
      this.textures.set(key, pending);
    }
    return pending;
  }

  private env(): Promise<unknown> {
    return this.environment ??= (rn as unknown as { load(library: unknown): Promise<unknown> }).load(this.library);
  }

  /** 用游戏的装配把一棵（或几棵）官方节点子树画出来，坐标保持客户端坐标（z 向上）。 */
  async assemble(folder: string, scene: any, options: { hiddenFrom?: any; cameraCentered?: boolean; scale?: number } = {}): Promise<AssembledScene> {
    const metadata = await this.metadata(folder);
    const hidden = options.hiddenFrom ? invisibleTrackGeometry([options.hiddenFrom]) : undefined;
    return await c5({ root: { kind: "track", name: "", scene, trackObjects: [] } }, this.library,
      sourceTrackPath(folder), metadata ?? { id: folder }, {
        environment: await this.env(), stageBinding: this.stageBinding, textureCache: this.textureCache,
        convertClientCoordinates: options.cameraCentered ? undefined : false,
        advanceEnvironment: false, hiddenNodes: hidden, cameraCentered: options.cameraCentered,
        scale: options.scale,
      }) as AssembledScene;
  }

  /** 一个物件：祖先只保留变换，节点本身用原始解码对象。 */
  async assemblePiece(folder: string, path: number[]): Promise<AssembledScene> {
    const model = await this.model(folder);
    const scene = model.scene;
    const target = nodeAtPath(scene, path);
    if (!target) throw new Error(`${folder} 里找不到物件 ${path.join("/")}。`);
    const ancestors: any[] = [scene];
    let node = scene;
    for (const index of path.slice(0, -1)) { node = node.children[index]; ancestors.push(node); }
    let chain: any = target;
    for (let k = ancestors.length - 1; k >= 0; k--) {
      const source = ancestors[k];
      chain = makeNode("Relement", {
        name: `${source.name}~`, transform: source.transform, position: source.position, scale: source.scale,
        children: [chain],
      });
    }
    return this.assemble(folder, chain, { hiddenFrom: target });
  }

  /** 整条官方赛道（取件视图）。 */
  async assembleTrack(folder: string): Promise<{ scene: AssembledScene; model: any }> {
    const model = await this.model(folder);
    return { scene: await this.assemble(folder, model.scene, { hiddenFrom: model.scene }), model };
  }

  /** 天空盒（随相机移动）。 */
  async assembleSky(folder: string): Promise<AssembledScene | undefined> {
    const entry = this.library.findSibling(sourceTrackPath(folder), ["skydome.1s"]);
    if (!entry) return undefined;
    const sky = y9(await entry.bytes()).root;
    const scene = sky.kind === "track" ? sky.scene : sky;
    return this.assemble(folder, scene, { cameraCentered: true, scale: 0.01 });
  }

  /** 赛道设置（雾色、远裁剪）。 */
  async trackSettings(folder: string): Promise<{ fog?: [number, number, number]; far?: number }> {
    try {
      const model = await this.model(folder);
      const object = model.trackObjects?.find((o: any) => o.kind === "TrackObject" && o.name === "track");
      const child = (name: string) => object?.property?.children?.find((c: any) => c.name === name);
      const attr = (node: any, name: string) => Number(node?.attributes?.find((a: any) => a.name === name)?.value);
      const fog = child("fog");
      return {
        fog: fog ? [attr(fog, "r"), attr(fog, "g"), attr(fog, "b")] as [number, number, number] : undefined,
        far: attr(child("camera"), "far") || undefined,
      };
    } catch {
      return {};
    }
  }
}

/** 在 c5 装配出的对象树里找到某个源节点对应的对象（按子节点顺序配对）。 */
export function objectForPath(sceneObject: Object3D, scene: any, path: readonly number[]): Object3D | undefined {
  const culls = (object: Object3D) => object.children.filter(child => child.name.endsWith(":P3528Cull"));
  let cull = culls(sceneObject)[0];
  let node = scene;
  for (const index of path) {
    const nodeObject = cull?.children[0];
    if (!nodeObject) return undefined;
    cull = culls(nodeObject)[index];
    node = node?.children?.[index];
    if (!cull || !node) return undefined;
  }
  return cull?.children[0];
}
