<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { api, errorMessage } from '../api/client'
import type { FeaturedReplay, TimeAttackReplayRow } from '../api/types'
import AccountName from '../components/AccountName.vue'
import DataTable from '../components/DataTable.vue'
import TableToolbar from '../components/TableToolbar.vue'
import { useNarrow } from '../composables/useNarrow'
import { usePagedTable } from '../composables/usePagedTable'
import { useTab } from '../composables/useTabs'
import { formatNumber, text } from '../utils/format'
import { formatTime } from '../utils/time'
import { confirmAction, showError } from '../utils/ui'

// 联赛回放 (TIMEATTACK.md 4): GET /api/admin/featured-replays lists what the
// game's 回放 → 联赛回放 page shows; POST /api/admin/featured-replays
// {trackId, speed, booster, accountId, title, note?} copies a ranked replay
// into it; DELETE /api/admin/featured-replays/{id}. Below, GET
// /api/admin/timeattack-replays is the pool of stored ranked replays (the
// top 10 of each track and setting).

const featured = ref<FeaturedReplay[]>([])
const loading = ref(false)
const failure = ref('')
const loaded = ref(false)
const narrow = useNarrow()

async function load() {
  loading.value = true
  try {
    featured.value = (await api.get<{ replays: FeaturedReplay[] | null }>('/api/admin/featured-replays')).replays ?? []
    failure.value = ''
  } catch (error) {
    failure.value = errorMessage(error)
    showError(error)
  } finally {
    loading.value = false
    loaded.value = true
  }
}

const pool = usePagedTable<TimeAttackReplayRow, { track: string; account: string }>('/api/admin/timeattack-replays', {
  filters: { track: '', account: '' },
})

useTab('replays', () => { void load(); void pool.load() })
onMounted(() => { void load(); void pool.load() })

/** "01:35:00" as the game shows records. */
function recordText(ms: number): string {
  if (!ms) return '—'
  const pad = (value: number) => Math.floor(Math.max(0, value)).toString().padStart(2, '0')
  return `${pad(ms / 60_000)}:${pad((ms / 1_000) % 60)}:${pad((ms / 10) % 100)}`
}

function settingText(row: { speed: number; booster: number }): string {
  return `${row.speed === 7 ? '标准速度' : row.speed === 4 ? '无限' : `S${row.speed}`} / ${row.booster ? '组队赛' : '个人赛'}`
}

/* ---------- publish ---------- */

const publishOpen = ref(false)
const publishing = ref(false)
const publishFailure = ref('')
const form = reactive({ title: '', note: '' })
const chosen = ref<TimeAttackReplayRow | null>(null)

function publish(row: TimeAttackReplayRow) {
  chosen.value = row
  form.title = `${row.trackName || row.trackId} ${row.nickname} ${recordText(row.bestMs)}`
  form.note = ''
  publishFailure.value = ''
  publishOpen.value = true
}

async function confirmPublish() {
  const row = chosen.value
  if (!row || publishing.value) return
  const title = form.title.trim()
  if (!title) {
    publishFailure.value = '请填写标题'
    return
  }
  publishing.value = true
  try {
    await api.post<{ replay: FeaturedReplay }>('/api/admin/featured-replays', {
      trackId: row.trackId, speed: row.speed, booster: row.booster, accountId: row.accountId, title, note: form.note.trim(),
    })
    ElMessage.success(`已发布：${title}`)
    publishOpen.value = false
    void load()
    void pool.load({ silent: true })
  } catch (error) {
    publishFailure.value = errorMessage(error)
  } finally {
    publishing.value = false
  }
}

async function remove(replay: FeaturedReplay) {
  if (!await confirmAction(`删除联赛回放“${replay.title}”？游戏里的列表会立刻去掉它。`, '删除联赛回放',
    { danger: true, confirmText: '删除' })) return
  try {
    await api.del(`/api/admin/featured-replays/${replay.id}`)
    ElMessage.success(`已删除：${replay.title}`)
    void load()
    void pool.load({ silent: true })
  } catch (error) {
    showError(error)
  }
}
</script>

<template>
  <el-card shadow="never" class="page-card">
    <p class="page-note">
      联赛回放显示在游戏 单人游戏 → 回放 → 联赛回放 里，玩家可用 OB 视角观看。从下方的排位录像（各赛道、设置的前 10 名）里挑一条“发布”，录像文件会复制一份，之后掉出榜单或账号删除都不影响。
    </p>
    <div class="toolbar">
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-table v-loading="loading" :data="featured" border stripe row-key="id">
      <el-table-column label="标题" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.title }}
          <div v-if="row.note" class="muted">{{ row.note }}</div>
        </template>
      </el-table-column>
      <el-table-column label="赛道" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.trackName || text(row.trackId) }}
          <span v-if="row.trackName" class="muted mono">{{ row.trackId }}</span>
        </template>
      </el-table-column>
      <el-table-column label="设置" width="150">
        <template #default="{ row }">{{ settingText(row) }}</template>
      </el-table-column>
      <el-table-column label="车手" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.nickname }}</template>
      </el-table-column>
      <el-table-column label="卡丁车" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ text(row.kartName) }}</template>
      </el-table-column>
      <el-table-column label="成绩" width="100">
        <template #default="{ row }">{{ recordText(row.bestMs) }}</template>
      </el-table-column>
      <el-table-column label="大小" width="90" align="right">
        <template #default="{ row }">{{ formatNumber(Math.ceil(row.byteSize / 1024)) }} KB</template>
      </el-table-column>
      <el-table-column label="发布" min-width="170">
        <template #default="{ row }">{{ row.createdBy || '—' }} <span class="muted">{{ formatTime(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-result v-if="failure" icon="error" title="加载失败" :sub-title="failure">
          <template #extra><el-button type="primary" @click="load">重试</el-button></template>
        </el-result>
        <el-empty v-else :description="loaded ? '还没有联赛回放，从下方的排位录像里发布一条' : '加载中…'" :image-size="72" />
      </template>
    </el-table>

    <h3 class="pool-title">排位录像</h3>
    <TableToolbar :table="pool" keyword="账号 / 昵称 / 赛道" range="时间">
      <el-form-item label="赛道">
        <el-input v-model="pool.filters.track" maxlength="64" clearable placeholder="赛道编号，如 village_R01" class="filter-input" @clear="pool.search()" />
      </el-form-item>
    </TableToolbar>
    <DataTable :table="pool" empty-text="暂无排位录像">
      <el-table-column prop="updatedAt" label="时间" width="175" sortable="custom">
        <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column prop="track" label="赛道" min-width="150" sortable="custom" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.trackName || text(row.trackId) }}
          <span v-if="row.trackName" class="muted mono">{{ row.trackId }}</span>
        </template>
      </el-table-column>
      <el-table-column label="设置" width="150">
        <template #default="{ row }">{{ settingText(row) }}</template>
      </el-table-column>
      <el-table-column label="车手" min-width="150">
        <template #default="{ row }"><AccountName :nickname="row.nickname" :username="row.username" /></template>
      </el-table-column>
      <el-table-column label="卡丁车" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ text(row.kartName) }}</template>
      </el-table-column>
      <el-table-column prop="bestMs" label="成绩" width="110" sortable="custom">
        <template #default="{ row }">{{ recordText(row.bestMs) }}</template>
      </el-table-column>
      <el-table-column label="已发布" width="80" align="center">
        <template #default="{ row }"><el-tag v-if="row.featured" type="success" disable-transitions>{{ row.featured }}</el-tag><span v-else class="muted">—</span></template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="publish(row)">发布为联赛回放</el-button>
        </template>
      </el-table-column>
    </DataTable>

    <el-dialog v-model="publishOpen" title="发布联赛回放" :width="narrow ? '94%' : '560px'" :close-on-click-modal="false" append-to-body>
      <el-form label-width="80px" :label-position="narrow ? 'top' : 'right'" @submit.prevent="confirmPublish">
        <el-form-item label="录像">
          <span v-if="chosen">{{ chosen.trackName || chosen.trackId }} · {{ settingText(chosen) }} · {{ chosen.nickname }} · {{ recordText(chosen.bestMs) }}</span>
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="60" show-word-limit />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.note" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="可留空" />
        </el-form-item>
        <el-alert v-if="publishFailure" type="error" :title="publishFailure" :closable="false" show-icon />
        <button type="submit" hidden :disabled="publishing" />
      </el-form>
      <template #footer>
        <el-button @click="publishOpen = false">取消</el-button>
        <el-button type="primary" :loading="publishing" @click="confirmPublish">发布</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.pool-title {
  margin: 20px 0 12px;
  font-size: 15px;
}
</style>
