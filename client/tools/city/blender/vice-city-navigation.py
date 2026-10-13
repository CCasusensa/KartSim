"""Extract recovery lanes from audited Vice City asphalt, without inventing geometry.

Run with Python + NumPy after verify-vice-city.mjs. All output is staged.
"""
import argparse
import heapq
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--input', type=Path, default=ROOT / 'build/vice-city/source-road-surfaces.json')
parser.add_argument('--out', type=Path, default=ROOT / 'build/vice-city/out')
parser.add_argument('--exclusions', type=Path, default=ROOT.parent / 'design/open-world/vice-city/navigation-exclusions.json')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
STEP = 2
MIN_X, MIN_Z, MAX_X, MAX_Z = -2800, -2000, 400, 2700
WIDTH, HEIGHT = (MAX_X - MIN_X) // STEP + 1, (MAX_Z - MIN_Z) // STEP + 1
heights = np.full((HEIGHT, WIDTH), np.nan, dtype=np.float32)
source_roads=json.loads(args.input.read_text())
triangles = source_roads['triangles']
for t in triangles:
    if t['grade'] > .20 or not 1 < t['centroid'][1] < 45:
        continue
    a, b, c = np.array(t['points'])
    left = max(0, math.ceil((min(a[0], b[0], c[0])-MIN_X)/STEP))
    right = min(WIDTH-1, math.floor((max(a[0], b[0], c[0])-MIN_X)/STEP))
    top = max(0, math.ceil((min(a[2], b[2], c[2])-MIN_Z)/STEP))
    bottom = min(HEIGHT-1, math.floor((max(a[2], b[2], c[2])-MIN_Z)/STEP))
    if right < left or bottom < top:
        continue
    xx, zz = np.meshgrid(np.arange(left,right+1)*STEP+MIN_X, np.arange(top,bottom+1)*STEP+MIN_Z)
    den = (b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
    if abs(den) < 1e-8:
        continue
    u = ((b[2]-c[2])*(xx-c[0])+(c[0]-b[0])*(zz-c[2]))/den
    v = ((c[2]-a[2])*(xx-c[0])+(a[0]-c[0])*(zz-c[2]))/den
    inside = (u >= -1e-6) & (v >= -1e-6) & (u+v <= 1+1e-6)
    h = u*a[1]+v*b[1]+(1-u-v)*c[1]
    target = heights[top:bottom+1,left:right+1]
    # Prefer the lower accessible road at overpasses. Native physics later
    # checks every published spawn against the final collision mesh.
    target[inside] = np.fmin(target[inside], h[inside])
mask = np.isfinite(heights)
np.savez_compressed(args.out / 'road-raster.npz', heights=heights, step=STEP, origin=[MIN_X,MIN_Z])

def neighbours(a):
    return [np.roll(a, (dy,dx), (0,1)) for dy,dx in [(1,0),(1,-1),(0,-1),(-1,-1),(-1,0),(-1,1),(0,1),(1,1)]]

# Zhang–Suen thinning preserves road junctions and closed circuits. It never
# fills a gap across water or between two disconnected source meshes.
skeleton = mask.copy()
for iteration in range(600):
    removed = 0
    for phase in range(2):
        n = neighbours(skeleton)
        degree = sum(x.astype(np.uint8) for x in n)
        transitions = sum((~n[i] & n[(i+1)%8]).astype(np.uint8) for i in range(8))
        if phase == 0:
            guard = ~(n[0]&n[2]&n[4]) & ~(n[2]&n[4]&n[6])
        else:
            guard = ~(n[0]&n[2]&n[6]) & ~(n[0]&n[4]&n[6])
        delete = skeleton & (degree>=2) & (degree<=6) & (transitions==1) & guard
        removed += int(delete.sum())
        skeleton[delete] = False
    if not removed:
        break
ys,xs = np.nonzero(skeleton)
nodes = {(int(y),int(x)) for y,x in zip(ys,xs)}
graph = {}
for y,x in nodes:
    links=[]
    for dy,dx in [(-1,0),(0,-1),(0,1),(1,0),(-1,-1),(-1,1),(1,-1),(1,1)]:
        p=(y+dy,x+dx)
        if p not in nodes:
            continue
        if dx and dy and ((y,x+dx) in nodes or (y+dy,x) in nodes):
            continue
        if abs(float(heights[y,x])-float(heights[p])) <= 1.0:
            links.append(p)
    graph[(y,x)]=links

def world(p):
    y,x=p
    return [MIN_X+x*STEP, MIN_Z+y*STEP, round(float(heights[p]),3)]

def nearest(x,z):
    return min(nodes, key=lambda p:(MIN_X+p[1]*STEP-x)**2+(MIN_Z+p[0]*STEP-z)**2)

def simplify(points, tolerance=.3):
    if len(points)<=2:
        return points
    a,b=np.array(points[0]),np.array(points[-1])
    delta=b-a
    length=float(delta@delta)
    distances=[]
    for p in points[1:-1]:
        v=np.array(p)
        f=max(0,min(1,float((v-a)@delta)/length)) if length else 0
        distances.append(float(np.linalg.norm(v-a-delta*f)))
    i=int(np.argmax(distances))+1
    if distances[i-1] <= tolerance:
        return [points[0],points[-1]]
    return simplify(points[:i+1],tolerance)[:-1]+simplify(points[i:],tolerance)

used=set()
roads=[]
ends=sorted(p for p in nodes if len(graph[p])!=2)
for start in ends+sorted(nodes):
    for nxt in graph[start]:
        if tuple(sorted((start,nxt))) in used:
            continue
        chain=[start]
        prev,current=start,nxt
        while True:
            used.add(tuple(sorted((prev,current))))
            chain.append(current)
            candidates=[p for p in graph[current] if p!=prev]
            if current==start or len(graph[current])!=2 or not candidates:
                break
            after=candidates[0]
            if tuple(sorted((current,after))) in used:
                break
            prev,current=current,after
        length=sum(math.dist(a,b)*STEP for a,b in zip(chain,chain[1:]))
        if length < 24:
            continue
        points=simplify([world(p) for p in chain])
        closed=chain[0]==chain[-1]
        if closed:
            points=points[:-1]
        roads.append(dict(id=f'vc-road-{len(roads)+1:03}',name=f'城市街道 {len(roads)+1}',type='street',closed=closed,points=points))

def path_between(start,end):
    heap=[(0,start)]
    cost={start:0}
    previous={}
    while heap:
        distance,p=heapq.heappop(heap)
        if p==end:
            path=[p]
            while p!=start:
                p=previous[p]; path.append(p)
            return list(reversed(path))
        if distance!=cost[p]:
            continue
        for q in graph[p]:
            new=distance+math.dist(p,q)
            if new < cost.get(q,math.inf):
                cost[q]=new; previous[q]=p; heapq.heappush(heap,(new,q))
    raise RuntimeError(f'Road network disconnected at {world(start)} -> {world(end)}')

# A small real block in Ocean Beach provides a closed native recovery route;
# free driving remains available on the entire city's physical road network.
route_hints=[[-690,1195],[-667,1025],[-797,1002],[-807,1175]]
waypoints=[nearest(*p) for p in route_hints]
route=[]
for start,end in zip(waypoints,waypoints[1:]+waypoints[:1]):
    route+=path_between(start,end)[:-1]
# A waypoint can snap to a short skeleton spur at an intersection. Cancel
# opposite edge traversals so the native circuit never reverses up that spur.
clean=[]
for p in route+[route[0]]:
    if len(clean)>=2 and p==clean[-2]:
        clean.pop()
    elif not clean or p!=clean[-1]:
        clean.append(p)
if clean[0]==clean[-1]:
    clean.pop()
while len(clean)>3 and clean[-1]==clean[1]:
    clean=clean[1:-1]
route=clean
if len(set(route)) < 50:
    raise RuntimeError('Ocean Beach route is too small')
route_points=simplify([world(p) for p in route]+[world(route[0])])[:-1]
roads.insert(0,dict(id='ring',name='海滩街区环线',type='avenue',closed=True,route=True,points=route_points))

# Keep recovery locations clear of native collision obstacles. This list is
# produced by the independent native verifier and guarded by each input line's
# geometry hash, so a changed extraction cannot silently reuse stale indices.
filtered_segments=0
if args.exclusions.is_file():
    exclusions={r['road']:r for r in json.loads(args.exclusions.read_text())['roads']}
    safe_roads=[]
    for road in roads:
        exclusion=exclusions.get(road['id'])
        if not exclusion:
            safe_roads.append(road)
            continue
        signature=hashlib.sha256(json.dumps(road['points'],separators=(',',':')).encode()).hexdigest()
        if signature!=exclusion['pointsSha256']:
            raise RuntimeError(f"Re-audit changed recovery road {road['id']} before applying exclusions")
        bad={s['index'] for s in exclusion['segments']}
        filtered_segments+=len(bad)
        points=road['points']
        count=len(points) if road['closed'] else len(points)-1
        order=list(range(count))
        if road['closed']:
            start=(min(bad)+1)%count
            order=order[start:]+order[:start]
        runs=[];run=[]
        for i in order:
            if i in bad:
                if len(run)>1:runs.append(run)
                run=[]
            else:
                if not run:run=[points[i]]
                run.append(points[(i+1)%len(points)])
        if len(run)>1:runs.append(run)
        for j,run in enumerate(runs):
            if sum(math.dist(a[:2],b[:2]) for a,b in zip(run,run[1:]))>=8:
                safe_roads.append({**road,'id':f"{road['id']}-safe-{j+1}",'closed':False,'points':run})
    roads=safe_roads

districts=[]
def district(id,name,x0,z0,x1,z1,theme):
    districts.append(dict(id=id,name=name,theme=theme,polygon=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]))
district('ocean-beach','海洋海滩',-1100,580,400,1600,'beach')
district('washington-beach','华盛顿海滩',-1000,-450,400,580,'city')
district('vice-point','罪恶角',-1000,-1800,400,-450,'city')
district('airport','国际机场',-2800,0,-2000,1800,'factory')
district('little-havana','小哈瓦那',-2000,0,-1100,1450,'village')
district('little-haiti','小海地',-2150,-650,-1150,0,'village')
district('downtown','市中心',-2400,-1800,-1000,-650,'city')
district('starfish-island','海星岛',-1300,-350,-1000,600,'forest')
spawn_hints=[('main','海洋海滩',-660,1020),('washington','华盛顿海滩',-320,-420),('vice-point','罪恶角',-275,-950),('havana','小哈瓦那',-1620,450),('haiti','小海地',-1620,-120),('airport','机场道路',-2510,425)]
pois=[]
for i,(id,name,x,z) in enumerate(spawn_hints):
    p=nearest(x,z); point=world(p)
    links=graph[p]
    q=links[0] if links else p
    dx,dz=(q[1]-p[1]),(q[0]-p[0])
    heading=(math.degrees(math.atan2(dx,-dz))+360)%360
    if id=='washington':
        heading=0  # Native 20 m driving check: north is clear of the junction obstacle.
    pois.append(dict(id=f'spawn-{id}',name=f'{name}出生点',kind='spawn',at=point[:2],y=point[2],heading=heading,desc='根据原始路面高度设置，进入后由原生碰撞落地。',n=i+1))
design=dict(meta=dict(name='卡丁城 · 罪恶都市',version=6,extent=[[MIN_X,MIN_Z],[MAX_X,MAX_Z]],units='world meters',origin='Vice City source world origin, uniform scale 100',axes='x 东, z 南, y 上',builder='blender/vice_city_scene.py',cameraFar=2000,minimapGeometry=True,routeSampleSpacing=2,routeFrameStride=1,preview=dict(glb='/build/vice-city/out/kartcity.glb',track='/build/vice-city/native/track.1s')),
    roadTypes=dict(avenue=dict(label='海滨大道',width=12,lanes=2,speed='巡游',color='#f5d8a8'),street=dict(label='城市道路',width=8,lanes=2,speed='巡游',color='#e4ecee')),
    # Source bolum1 / 1GRASS / material "water" is a flat sea at this Y.
    roads=roads,districts=districts,pois=pois,world=dict(kind='ocean-plane',seaLevel=5.695964),
    rules=dict(instancePlayers=60,interestRadius=160,chatBubbleRadius=60,chatBubbleSeconds=6,districtChannel=True,cityChannel=True,afkMinutes=10,resetToRoad=True,dayNightMinutes=48))
design['meta']['drivableMaterials']=source_roads['laneMaterials']
(args.out/'kartcity-design.json').write_text(json.dumps(design,ensure_ascii=False,indent=2)+'\n')
pixels=np.zeros((HEIGHT,WIDTH,3),dtype=np.uint8)
pixels[:]=[26,67,85]; pixels[mask]=[150,171,174]; pixels[skeleton]=[255,242,200]
for p in route:
    pixels[p]=[255,120,115]
Image.fromarray(pixels).save(args.out/'navigation.png')
summary=dict(roads=len(roads),filteredRecoverySegments=filtered_segments,skeletonPixels=len(nodes),thinningIterations=iteration+1,routePoints=len(route_points),spawns=pois,sourceTriangles=len(triangles))
(args.out/'navigation-report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False))
