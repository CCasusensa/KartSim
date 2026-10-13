<script lang="ts">
import { fetchPicture } from '../api/client'

// Pictures by path (the path names the map's version, ?v=<sha256>), so
// paging back and forth does not fetch them again. Failures are dropped.
const cache = new Map<string, Promise<string>>()
const cacheLimit = 200

function picture(path: string): Promise<string> {
  let pending = cache.get(path)
  if (!pending) {
    pending = fetchPicture(path)
    pending.catch(() => cache.delete(path))
    cache.set(path, pending)
    if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!)
  }
  return pending
}
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Picture } from '@element-plus/icons-vue'

// A map's card or thumb from GET /api/admin/maps/{id}/{card|thumb}, which
// also serves hidden maps (the public file endpoint does not).

const props = defineProps<{ mapId: string; kind: 'card' | 'thumb'; version?: string; width: number; height: number; alt?: string }>()

const src = ref('')
const failed = ref(false)
let sequence = 0

watch(() => [props.mapId, props.kind, props.version] as const, async ([mapId, kind, version]) => {
  const id = ++sequence
  src.value = ''
  failed.value = false
  const path = `/api/admin/maps/${encodeURIComponent(mapId)}/${kind}` + (version ? `?v=${encodeURIComponent(version)}` : '')
  try {
    const url = await picture(path)
    if (id === sequence) src.value = url
  } catch {
    if (id === sequence) failed.value = true
  }
}, { immediate: true })
</script>

<template>
  <div class="map-picture" :style="{ width: `${width}px`, aspectRatio: `${width} / ${height}` }">
    <img v-if="src" :src="src" :alt="alt ?? ''" draggable="false" />
    <el-icon v-else-if="failed" class="missing" :size="20" title="图片加载失败"><Picture /></el-icon>
    <span v-else class="loading muted">加载中…</span>
  </div>
</template>

<style scoped>
.map-picture {
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  overflow: hidden;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}
.map-picture img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.missing {
  color: var(--el-text-color-placeholder);
}
.loading {
  font-size: 12px;
}
</style>
