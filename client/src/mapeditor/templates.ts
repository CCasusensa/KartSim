/**
 * 赛道形状模板：新建地图或在素材栏“赛道”里一键铺出一条闭合的比赛路线，
 * 之后再拖控制点改形状。坐标以原点为中心（生成赛道包时整体平移）。
 */
import { DEFAULT_ROAD_SURFACE, DEFAULT_WALL, type RoadDesign, type RoadPoint } from "./design";

export interface TrackTemplate {
  id: string;
  title: string;
  description: string;
  points(): RoadPoint[];
  width: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

function loop(count: number, shape: (angle: number) => [number, number, number?]): RoadPoint[] {
  const points: RoadPoint[] = [];
  for (let i = 0; i < count; i++) {
    // 从正南出发、逆时针（游戏里起点在第一个点附近）
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    const [x, y, z = 0] = shape(angle);
    points.push({ x: round(x), y: round(y), z: round(z) });
  }
  return points;
}

/** 多边形的每个角放两个点，Catmull-Rom 会把角磨圆。 */
function rounded(corners: Array<[number, number]>, cut: number): RoadPoint[] {
  const points: RoadPoint[] = [];
  corners.forEach((corner, i) => {
    const previous = corners[(i + corners.length - 1) % corners.length]!, next = corners[(i + 1) % corners.length]!;
    const toward = (target: [number, number]) => {
      const dx = target[0] - corner[0], dy = target[1] - corner[1];
      const length = Math.hypot(dx, dy) || 1;
      const step = Math.min(cut, length * 0.4);
      return { x: round(corner[0] + (dx / length) * step), y: round(corner[1] + (dy / length) * step), z: 0 };
    };
    points.push(toward(previous), toward(next));
  });
  return points;
}

export const TRACK_TEMPLATES: TrackTemplate[] = [
  {
    id: "oval", title: "椭圆赛道", description: "最简单的环形跑道，适合先试一试。", width: 24,
    points: () => loop(16, a => [Math.cos(a) * 280, Math.sin(a) * 160]),
  },
  {
    id: "rect", title: "城市方块", description: "四个直角弯，像绕着街区跑。", width: 22,
    points: () => rounded([[-260, -170], [260, -170], [260, 170], [-260, 170]], 70),
  },
  {
    id: "wave", title: "三叶草", description: "三个大弯连着三段反弯，考验漂移。", width: 22,
    points: () => loop(24, a => {
      const r = 250 * (1 + 0.22 * Math.sin(3 * a));
      return [Math.cos(a) * r, Math.sin(a) * r];
    }),
  },
  {
    id: "peanut", title: "回形针", description: "两头是发夹弯，中间收窄成两条反弯。", width: 22,
    points: () => loop(24, a => {
      const r = 270 * (1 + 0.7 * Math.cos(2 * a));
      return [Math.cos(a) * r, Math.sin(a) * r * 1.6];
    }),
  },
  {
    id: "triangle", title: "三角弯道", description: "三个急弯，直道很长。", width: 24,
    points: () => rounded([[0, 300], [-300, -200], [300, -200]], 90),
  },
  {
    id: "hills", title: "起伏山路", description: "椭圆赛道带上下坡，开起来有飞跃感。", width: 22,
    points: () => loop(20, a => [Math.cos(a) * 300, Math.sin(a) * 180, 14 + 14 * Math.sin(2 * a + Math.PI / 2)]),
  },
  {
    id: "eight", title: "8 字立交", description: "8 字形，中间一层从另一层上方飞过。", width: 20,
    // 双纽线：两条路在原点交叉，上层比下层高 24 米（检查门高 20 米，上下两层不会互相触发）
    points: () => {
      const points: RoadPoint[] = [];
      const count = 28;
      for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2;
        const scale = 1 / (1 + Math.sin(t) ** 2);
        points.push({ x: round(380 * Math.cos(t) * scale), y: round(380 * Math.sin(t) * Math.cos(t) * scale), z: round(12 + 12 * Math.sin(t)) });
      }
      return points;
    },
  },
];

export function trackTemplate(id: string): TrackTemplate | undefined {
  return TRACK_TEMPLATES.find(template => template.id === id);
}

/** 按模板生成一条比赛路线（闭合、带两侧护栏）。 */
export function templateRoad(template: TrackTemplate, id: string, surface = DEFAULT_ROAD_SURFACE, wall = DEFAULT_WALL.texture): RoadDesign {
  return {
    id, name: "主赛道", closed: true, route: true, points: template.points(), width: template.width,
    surface: structuredClone(surface), uvLength: 24, thickness: 1.5,
    walls: {
      left: { texture: structuredClone(wall), height: 1.2, visible: true },
      right: { texture: structuredClone(wall), height: 1.2, visible: true },
    },
  };
}
