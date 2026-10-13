"""Assemble the six supplied Vice City GLBs, preserving their common coordinates.

Run with Blender in background mode. By default source coordinates and scale are
preserved, exact duplicate materials/images/mesh instances are consolidated,
and an editable packed .blend plus one standard uncompressed .glb are exported.
Opaque solids receive the integration pipeline's collision tag; water, plants
and alpha details are classified separately in an auditable report. The source
PNG alpha is restored because the supplied GLBs declared all materials opaque.
Road routes and kartcity-design.json belong to the integration stage.

  blender -b --python-exit-code 1 --python vice_city_scene.py -- \
    --source client/build/vice-city/source --out client/build/vice-city/out

An explicit --scale can apply a single global scale after source inspection.
--no-dedupe-objects retains even exactly overlapping source mesh instances.
--inspect-only loads and reports the scene without exporting the blend or GLB.
"""
from __future__ import annotations

import argparse
from array import array
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import struct
import sys
import time

import bpy
from mathutils import Matrix, Vector


HERE = Path(__file__).resolve().parent
CLIENT = HERE.parents[2]
IMAGE_ALPHA = {}
COPYRIGHT = ('GTA Vice City original assets: Rockstar; third-party conversion: '
             'Father Of The Poor (FatherOfThepPoor), source labeled CC BY 4.0. '
             'See source.json for rights status.')


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=CLIENT / 'build/vice-city/source')
    parser.add_argument('--out', type=Path, default=CLIENT / 'build/vice-city/out')
    parser.add_argument('--scale', type=float, default=1.0)
    parser.add_argument('--no-dedupe-objects', action='store_true')
    parser.add_argument('--inspect-only', action='store_true')
    parser.add_argument('--resume-blend', type=Path,
                        help='Reopen this assembled blend to update diffuse PBR and exports without importing the six parts')
    opts = parser.parse_args(argv)
    if not math.isfinite(opts.scale) or opts.scale <= 0:
        parser.error('--scale must be a finite positive number')
    return opts


def log(message):
    print('vice-city: ' + message, flush=True)


def read_source_header(path):
    """Only the JSON chunk is needed for the source inventory."""
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise ValueError(f'Incomplete GLB header: {path}')
        magic, version, length = struct.unpack('<III', header)
        if magic != 0x46546C67 or version != 2 or length != path.stat().st_size:
            raise ValueError(f'Invalid glTF 2 binary: {path}')
        chunk_length, kind = struct.unpack('<II', stream.read(8))
        if kind != 0x4E4F534A:
            raise ValueError(f'First GLB chunk is not JSON: {path}')
        source = json.loads(stream.read(chunk_length))
        stream.seek(0)
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    primitives = [p for mesh in source.get('meshes', []) for p in mesh.get('primitives', [])]
    accessors = source.get('accessors', [])
    triangles = sum((accessors[p['indices']]['count'] if 'indices' in p else
                     accessors[p['attributes']['POSITION']]['count']) // 3
                    for p in primitives if p.get('mode', 4) == 4)
    return dict(file=path.name, bytes=length, sha256=digest.hexdigest(),
                generator=source.get('asset', {}).get('generator'),
                nodes=len(source.get('nodes', [])), meshes=len(source.get('meshes', [])),
                primitives=len(primitives), triangles=triangles,
                materials=len(source.get('materials', [])), images=len(source.get('images', [])),
                extensions=source.get('extensionsUsed', []))


def bounds_of(objects):
    low, high = [math.inf] * 3, [-math.inf] * 3
    found = False
    for obj in objects:
        if obj.type != 'MESH' or not len(obj.data.vertices):
            continue
        found = True
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                low[axis] = min(low[axis], p[axis])
                high[axis] = max(high[axis], p[axis])
    if not found:
        return None
    # Blender is Z-up. Its Y is the negative of exported glTF's Z.
    return dict(blenderMin=low, blenderMax=high,
                blenderSize=[high[i] - low[i] for i in range(3)],
                gltfMin=[low[0], low[2], -high[1]],
                gltfMax=[high[0], high[2], -low[1]])


def plain(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    try:
        return [plain(item) for item in value]
    except TypeError:
        return str(value)


def image_bytes(image):
    """Use original embedded PNG/JPEG bytes whenever available, without resize."""
    if image.packed_file:
        return bytes(image.packed_file.data)
    filepath = Path(bpy.path.abspath(image.filepath))
    if filepath.is_file():
        return filepath.read_bytes()
    return None


def prepare_images(out_dir):
    directory = out_dir / 'textures'
    directory.mkdir(parents=True, exist_ok=True)
    unique, aliases, records, alpha_cache = {}, {}, [], {}
    for image in list(bpy.data.images):
        if image.type != 'IMAGE':
            continue
        payload = image_bytes(image)
        if payload is None or not (payload.startswith(b'\x89PNG\r\n\x1a\n') or payload.startswith(b'\xff\xd8')):
            # Some sources can be procedural or in unsupported image formats.
            # Encode their full-resolution pixels using Blender's image writer.
            temporary = directory / f'conversion-{len(records):05d}.png'
            old_path, old_format = image.filepath_raw, image.file_format
            image.filepath_raw, image.file_format = str(temporary), 'PNG'
            image.save()
            payload = temporary.read_bytes()
            temporary.unlink()
            image.filepath_raw, image.file_format = old_path, old_format
        digest = hashlib.sha256(payload).hexdigest()
        if digest not in alpha_cache:
            pixels = array('f', [0]) * len(image.pixels)
            image.pixels.foreach_get(pixels)
            alphas = pixels[3::4]
            count = len(alphas)
            alpha_cache[digest] = dict(min=min(alphas, default=1.0), max=max(alphas, default=1.0),
                nonOpaqueFraction=sum(a < .995 for a in alphas) / max(1, count),
                cutoutFraction=sum(a < .5 for a in alphas) / max(1, count))
        extension = 'png' if payload.startswith(b'\x89PNG') else 'jpg'
        relative = f'textures/vc_{digest[:24]}.{extension}'
        target = out_dir / relative
        records.append(dict(name=image.name, sha256=digest, bytes=len(payload),
                            size=list(image.size), colorspace=image.colorspace_settings.name,
                            file=relative, alpha=alpha_cache[digest]))
        # The same PNG may legitimately be both an sRGB color map and a linear
        # data map. Preserve that distinction in Blender while sharing disk bytes.
        key = digest, image.colorspace_settings.name, image.alpha_mode
        if key in unique:
            aliases[image] = unique[key]
        else:
            target.write_bytes(payload)
            image.name = 'vc_' + digest[:24]
            image.filepath_raw = str(target)
            image.file_format = 'PNG' if extension == 'png' else 'JPEG'
            image.pack(data=payload, data_len=len(payload))
            unique[key] = image
            aliases[image] = image
        IMAGE_ALPHA[aliases[image].name] = alpha_cache[digest]
    for mat in bpy.data.materials:
        if mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image in aliases:
                    node.image = aliases[node.image]
    unused = [old for old, new in aliases.items() if old is not new and old.users == 0]
    removed = len(unused)
    if unused:
        bpy.data.batch_remove(ids=unused)
    log(f'{len(records)} image references -> {len(unique)} image datablocks ({removed} duplicates removed)')
    return records


def classify_materials():
    """Restore source alpha and classify explicit water/foliage versus solids."""
    records = []
    for material in bpy.data.materials:
        name = re.sub(r'\.\d{3}$', '', material.name.upper())
        texture_nodes = [n for n in material.node_tree.nodes
                         if n.type == 'TEX_IMAGE' and n.image] if material.use_nodes else []
        bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if material.use_nodes else None
        image = texture_nodes[0].image if texture_nodes else None
        alpha = IMAGE_ALPHA.get(image.name, {}) if image else {}
        has_alpha = alpha.get('nonOpaqueFraction', 0) > 0
        ground_name = bool(re.search(r'^(ROAD|GRASS|GRVL|SAND|TARMAC)|PAVE|CONCRETE|CONC_|DIRT|SIDEWALK', name))
        water = bool(re.search(r'WATERCLEAR|(?:^|_)WATER(?:_|\d|$)|STARWATER|SPAD_WATER', name))
        plant_structure = not has_alpha and bool(re.search(
            r'PLANTER|PALMBARK|TREE_RINGS|HEDGEWALL|^KBTREE3_TEST$', name))
        # These source textures have been inspected: hotel/hospital signs use
        # "Palms" in their business names, and KBTREE3_TEST is opaque tree bark.
        explicit_sign = name in {'DT_MOISTPALMS1', 'SHADYPALMS', 'DT_POSH_HOTEL_STREETNUMBER'}
        plant = not ground_name and not plant_structure and bool(
            re.search(r'LEAF|LEAV|PALM|(?<!S)TREE|BUSH|HEDGE|FERN|PLANT|WATERLILI', name))
        alpha_plane = bool(re.search(
            r'BILL|ADVERT|(?<!DE)SIGN|POSTER|ALFA|ALPHA|FENCE|GRILL|(?:^|_)NET(?:_|\d|$)', name))
        if water:
            category, reason = 'water', 'water texture name'
        elif explicit_sign:
            category, reason = 'decorative-plane', 'verified hotel/hospital/street-number sign texture'
        elif plant:
            category, reason = 'foliage', 'plant texture name'
        elif ground_name:
            category, reason = 'solid', 'explicit road/ground texture name'
        elif has_alpha:
            category, reason = 'alpha-detail', 'PNG contains transparent pixels'
        elif alpha_plane:
            category, reason = 'decorative-plane', 'sign/fence/alpha-detail texture name'
        else:
            category, reason = 'solid', 'opaque non-water, non-plant material'
        material['kr_road'] = '{}' if category == 'solid' else ''
        material['vc_surface_class'] = category
        material['vc_class_reason'] = reason
        restored_alpha = 'OPAQUE'
        if category == 'water' and has_alpha and bsdf and texture_nodes:
            material.node_tree.links.new(texture_nodes[0].outputs['Alpha'], bsdf.inputs['Alpha'])
            material.surface_render_method = 'BLENDED'
            material['kr_alpha'] = 'blend'
            image.alpha_mode = 'STRAIGHT'
            restored_alpha = 'BLEND'
        elif has_alpha and bsdf and texture_nodes:
            # Blender 5's glTF exporter recognizes ROUND(alpha) as MASK 0.5.
            # Author's files declared OPAQUE even for RGBA foliage and fences.
            node = next((n for n in material.node_tree.nodes
                         if n.type == 'MATH' and n.label == 'Restore source PNG alpha mask'), None)
            if node is None:
                node = material.node_tree.nodes.new('ShaderNodeMath')
            node.operation = 'ROUND'
            node.label = 'Restore source PNG alpha mask'
            node.location = (bsdf.location.x - 180, bsdf.location.y - 280)
            material.node_tree.links.new(texture_nodes[0].outputs['Alpha'], node.inputs[0])
            material.node_tree.links.new(node.outputs[0], bsdf.inputs['Alpha'])
            material.surface_render_method = 'DITHERED'
            material['kr_alpha'] = 'test'
            image.alpha_mode = 'STRAIGHT'
            restored_alpha = 'MASK'
        records.append(dict(name=material.name, category=category, reason=reason,
            collision=category == 'solid', image=image.name if image else None,
            alpha=alpha, restoredAlpha=restored_alpha))
    log('surface classes: ' + json.dumps(dict(Counter(r['category'] for r in records))))
    return records


def material_signature(material):
    props = dict(use_nodes=material.use_nodes, diffuse_color=plain(material.diffuse_color))
    for key in ['use_backface_culling', 'surface_render_method', 'blend_method', 'alpha_threshold']:
        if hasattr(material, key):
            props[key] = plain(getattr(material, key))
    props['extras'] = {k: plain(material[k]) for k in material.keys() if k != '_RNA_UI'}
    if material.use_nodes:
        nodes = list(material.node_tree.nodes)
        indices = {node: i for i, node in enumerate(nodes)}
        encoded = []
        for node in nodes:
            item = dict(type=node.bl_idname)
            for key in ['interpolation', 'projection', 'projection_blend', 'extension',
                        'attribute_name', 'uv_map', 'blend_type', 'data_type', 'operation',
                        'distribution', 'subsurface_method']:
                if hasattr(node, key):
                    item[key] = plain(getattr(node, key))
            if node.type == 'TEX_IMAGE' and node.image:
                item['image'] = node.image.name
            item['inputs'] = [(i, socket.identifier, plain(socket.default_value))
                              for i, socket in enumerate(node.inputs)
                              if not socket.is_linked and hasattr(socket, 'default_value')]
            encoded.append(item)
        props['nodes'] = encoded
        props['links'] = sorted((indices[link.from_node], list(link.from_node.outputs).index(link.from_socket),
                                 indices[link.to_node], list(link.to_node.inputs).index(link.to_socket))
                                for link in material.node_tree.links)
    return hashlib.sha256(json.dumps(props, sort_keys=True).encode()).hexdigest()


def prepare_materials():
    unique, replacements, records = {}, {}, []
    for material in list(bpy.data.materials):
        digest = material_signature(material)
        images = sorted({node.image.name for node in material.node_tree.nodes
                         if node.type == 'TEX_IMAGE' and node.image}) if material.use_nodes else []
        records.append(dict(name=material.name, signature=digest, images=images))
        canonical = unique.setdefault(digest, material)
        replacements[material] = canonical
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            for slot in obj.material_slots:
                if slot.material in replacements:
                    slot.material = replacements[slot.material]
    unused = [old for old, new in replacements.items() if old is not new and old.users == 0]
    if unused:
        bpy.data.batch_remove(ids=unused)
    log(f'{len(records)} materials -> {len(unique)} distinct graphs')
    return records


def hash_collection(digest, collection, property_name, components, kind='f'):
    values = array(kind, [0]) * (len(collection) * components)
    collection.foreach_get(property_name, values)
    digest.update(values.tobytes())


def mesh_signature(mesh):
    digest = hashlib.sha256()
    hash_collection(digest, mesh.vertices, 'co', 3)
    hash_collection(digest, mesh.loops, 'vertex_index', 1, 'I')
    hash_collection(digest, mesh.polygons, 'loop_total', 1, 'I')
    hash_collection(digest, mesh.polygons, 'material_index', 1, 'I')
    hash_collection(digest, mesh.polygons, 'use_smooth', 1, 'b')
    # Include split normals and every UV/color layer, not only positions. Two
    # overlapping objects with different appearance are therefore retained.
    hash_collection(digest, mesh.corner_normals, 'vector', 3)
    for layer in mesh.uv_layers:
        digest.update(layer.name.encode())
        hash_collection(digest, layer.data, 'uv', 2)
    for attribute in mesh.color_attributes:
        digest.update((attribute.name + attribute.domain + attribute.data_type).encode())
        hash_collection(digest, attribute.data, 'color', 4)
    return digest.digest()


def remove_exact_duplicates():
    meshes, seen, removed, duplicate_objects = {}, {}, [], []
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or obj.modifiers or obj.animation_data or obj.children:
            continue
        mesh = obj.data
        if mesh not in meshes:
            meshes[mesh] = mesh_signature(mesh)
        digest = hashlib.sha256(meshes[mesh])
        digest.update(struct.pack('<16d', *(v for row in obj.matrix_world for v in row)))
        digest.update(json.dumps([slot.material.name if slot.material else None
                                  for slot in obj.material_slots]).encode())
        digest.update(json.dumps({k: plain(obj[k]) for k in obj.keys()
                                  if k not in ['_RNA_UI', 'source_part']}, sort_keys=True).encode())
        key = digest.hexdigest()
        if key in seen:
            removed.append(dict(name=obj.name, source=obj.get('source_part'), kept=seen[key].name))
            duplicate_objects.append(obj)
        else:
            seen[key] = obj
    if duplicate_objects:
        bpy.data.batch_remove(ids=duplicate_objects)
    orphan_meshes = [mesh for mesh in bpy.data.meshes if mesh.users == 0]
    if orphan_meshes:
        bpy.data.batch_remove(ids=orphan_meshes)
    log(f'removed {len(removed)} exactly overlapping mesh instances')
    return removed


def render_overview(out_dir, report):
    """Render a metric plan view; the large source ocean cannot set its extent."""
    scene = bpy.context.scene
    land = [obj for obj in bpy.data.objects if obj.type == 'MESH' and
            any(slot.material and slot.material.get('vc_surface_class') != 'water'
                for slot in obj.material_slots)]
    bounds = bounds_of(land)
    if bounds is None:
        raise ValueError('No non-water geometry is available for overview bounds')
    low, high = bounds['blenderMin'], bounds['blenderMax']
    center_x, center_y = (low[0] + high[0]) / 2, (low[1] + high[1]) / 2
    span = max(high[0] - low[0], high[1] - low[1]) * 1.04
    old_preview = bpy.data.collections.get('Preview camera and daylight')
    if old_preview:
        for obj in list(old_preview.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(old_preview)
    preview = bpy.data.collections.new('Preview camera and daylight')
    scene.collection.children.link(preview)
    camera_data = bpy.data.cameras.new('Vice City plan camera')
    camera = bpy.data.objects.new(camera_data.name, camera_data)
    preview.objects.link(camera)
    camera.location = (center_x, center_y, high[2] + span)
    camera.rotation_euler = (0, 0, 0)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = span
    camera.data.clip_start, camera.data.clip_end = 1, span * 4
    scene.camera = camera
    sun_data = bpy.data.lights.new('Vice City daylight', 'SUN')
    sun = bpy.data.objects.new(sun_data.name, sun_data)
    preview.objects.link(sun)
    sun.rotation_euler = (.25, -.3, -.2)
    sun.data.energy, sun.data.angle = 2.0, .15
    if scene.world is None:
        scene.world = bpy.data.worlds.new('Vice City daylight environment')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.62, .72, .86, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .8
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 1536
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(out_dir / 'overview.png')
    overview = dict(file='overview.png', width=1536, height=1536,
        projection='orthographic; image left-to-right = +world X, top-to-bottom = +world Z',
        worldXZ=dict(minX=center_x - span / 2, maxX=center_x + span / 2,
                     minZ=-center_y - span / 2, maxZ=-center_y + span / 2),
        landBounds=bounds)
    report['overview'] = overview
    (out_dir / 'overview-bounds.json').write_text(json.dumps(overview, indent=2) + '\n')
    log('rendering overview; world X/Z extent: ' + json.dumps(overview['worldXZ']))
    bpy.ops.render.render(write_still=True)
    log('overview ready: ' + str(out_dir / 'overview.png'))


def diffuse_materials():
    """GTA source textures are diffuse maps, not metallic PBR surfaces."""
    for material in bpy.data.materials:
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == 'BSDF_PRINCIPLED':
                    node.inputs['Metallic'].default_value = 0
                    node.inputs['Roughness'].default_value = 1
                    node.inputs['Specular IOR Level'].default_value = 0
    log('set diffuse material response: Metallic=0, Roughness=1, Specular=0')


def save_exports(out_dir, report, started):
    scene = bpy.context.scene
    attribution = CLIENT.parent / 'design/open-world/vice-city/source.json'
    if attribution.is_file():
        shutil.copyfile(attribution, out_dir / 'source.json')
        report['sourceAttributionFile'] = 'source.json'
    report['materialResponse'] = dict(metallic=0, roughness=1, specular=0,
                                      reason='original diffuse texture workflow')
    # Render before the larger exports so integration can begin mapping routes.
    render_overview(out_dir, report)
    report['elapsedSeconds'] = round(time.time() - started, 2)
    report['processCpuSeconds'] = round(time.process_time(), 2)
    (out_dir / 'vice-city-source-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    # The GLB export explicitly excludes the editor's camera/light setup.
    scene.view_settings.view_transform = 'Standard'
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type == 'VIEW_3D':
            area.spaces.active.shading.type = 'MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(out_dir / 'kartcity.blend'))
    bpy.ops.export_scene.gltf(filepath=str(out_dir / 'kartcity.glb'), export_format='GLB',
        export_extras=True, export_apply=True, export_yup=True, export_image_format='AUTO',
        export_copyright=COPYRIGHT,
        export_materials='EXPORT', export_normals=True, export_texcoords=True,
        export_vertex_color='ACTIVE', use_visible=True, export_animations=False,
        export_skins=False, export_morph=False, export_lights=False, export_cameras=False)
    log('saved editable packed kartcity.blend and merged kartcity.glb')


def main():
    opts = arguments()
    source_dir, out_dir = opts.source.resolve(), opts.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    if opts.resume_blend:
        bpy.ops.wm.open_mainfile(filepath=str(opts.resume_blend.resolve()), load_ui=False, use_scripts=False)
        report = json.loads((out_dir / 'vice-city-source-report.json').read_text())
        for image in report['images']:
            IMAGE_ALPHA['vc_' + image['sha256'][:24]] = image['alpha']
        diffuse_materials()
        report['surfaceClasses'] = classify_materials()
        (out_dir / 'vice-city-surface-classes.json').write_text(
            json.dumps(report['surfaceClasses'], ensure_ascii=False, indent=2) + '\n')
        save_exports(out_dir, report, started)
        return
    sources = [source_dir / f'bolum{i}.glb' for i in range(1, 7)]
    missing = [str(p) for p in sources if not p.is_file()]
    if missing:
        raise FileNotFoundError('Missing source files: ' + ', '.join(missing))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    report = dict(sourceCoordinatePolicy='preserve; Blender Z-up / glTF Y-up conversion only',
                  requestedGlobalScale=opts.scale, sources=[], warnings=[],
                  collisions='solid materials use kr_road={}; water, foliage and alpha details excluded')
    for path in sources:
        info = read_source_header(path)
        before = set(bpy.data.objects)
        collection = bpy.data.collections.new(path.stem)
        scene.collection.children.link(collection)
        log(f'importing {path.name} ({info["bytes"] / 1e6:.1f} MB)')
        bpy.ops.import_scene.gltf(filepath=str(path), import_pack_images=True, merge_vertices=False)
        imported = [obj for obj in bpy.data.objects if obj not in before]
        for obj in imported:
            obj['source_part'] = path.name
            for old in list(obj.users_collection):
                old.objects.unlink(obj)
            collection.objects.link(obj)
        bpy.context.view_layer.update()
        info['importedObjects'] = len(imported)
        info['bounds'] = bounds_of(imported)
        report['sources'].append(info)
    report['sourceBounds'] = bounds_of(bpy.data.objects)
    if opts.scale != 1:
        scale = Matrix.Scale(opts.scale, 4)
        for obj in bpy.data.objects:
            if obj.parent is None:
                obj.matrix_world = scale @ obj.matrix_world
        bpy.context.view_layer.update()
    report['images'] = prepare_images(out_dir)
    diffuse_materials()
    report['surfaceClasses'] = classify_materials()
    (out_dir / 'vice-city-surface-classes.json').write_text(
        json.dumps(report['surfaceClasses'], ensure_ascii=False, indent=2) + '\n')
    report['materials'] = prepare_materials()
    report['removedDuplicateObjects'] = [] if opts.no_dedupe_objects else remove_exact_duplicates()
    bpy.context.view_layer.update()
    report['outputBounds'] = bounds_of(bpy.data.objects)
    report['outputCounts'] = dict(objects=len(bpy.data.objects),
        meshObjects=sum(obj.type == 'MESH' for obj in bpy.data.objects),
        materials=len(bpy.data.materials), images=len(bpy.data.images),
        meshTriangles=sum(sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons)
                          for obj in bpy.data.objects if obj.type == 'MESH'))
    report['elapsedSeconds'] = round(time.time() - started, 2)
    report_path = out_dir / 'vice-city-source-report.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    log('inventory: ' + json.dumps(report['outputCounts']))
    if opts.inspect_only:
        log('inspect-only complete: ' + str(report_path))
        return
    save_exports(out_dir, report, started)


if __name__ == '__main__':
    main()
