<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import type { AccountRow, MapRow } from '../api/types'
import AccountDrawer from '../components/AccountDrawer.vue'
import AccountName from '../components/AccountName.vue'
import DataTable from '../components/DataTable.vue'
import EditAccountDialog from '../components/EditAccountDialog.vue'
import GrantDialog from '../components/GrantDialog.vue'
import MapPicture from '../components/MapPicture.vue'
import TableToolbar from '../components/TableToolbar.vue'
import { useAfterKick } from '../composables/useAfterKick'
import { useNarrow } from '../composables/useNarrow'
import { usePagedTable } from '../composables/usePagedTable'
import { useTab } from '../composables/useTabs'
import { kickAccount } from '../utils/accounts'
import {
  accountLabel, difficultyStars, formatBytes, formatNumber, mapState, mapStateOptions, themeName,
} from '../utils/format'
import { formatTime } from '../utils/time'
import { confirmAction, showError } from '../utils/ui'

// 自制地图 (MAPS.md 3): GET /api/admin/maps lists every 地图工坊 map, hidden
// ones too (q: 地图名/作者账号与昵称/地图与作者 ID; state public|hidden;
// account: the author; from/to on the update time; sort updatedAt,
// createdAt, name, size, items). Pictures come from GET
// /api/admin/maps/{id}/{card|thumb}, which also serves hidden maps. POST
// /api/admin/maps/{id}/hidden {hidden} hides or restores a map; DELETE
// /api/admin/maps/{id} deletes it for good.

const table = usePagedTable<MapRow, { state: string; account: string }>('/api/admin/maps', {
  filters: { state: '', account: '' },
})
useTab('maps', () => table.load())
onMounted(() => table.load())
const narrow = useNarrow()

/* ---------- author's account ---------- */

const drawerOpen = ref(false)
const drawerId = ref<string | null>(null)
const drawer = ref<InstanceType<typeof AccountDrawer>>()
const editOpen = ref(false)
const editing = ref<AccountRow | null>(null)
const grantOpen = ref(false)
const grantTarget = ref<AccountRow | null>(null)

function showAccount(row: MapRow) {
  drawerId.value = row.ownerId
  drawerOpen.value = true
}

function edit(account: AccountRow) {
  editing.value = account
  editOpen.value = true
}

function grant(account: AccountRow) {
  grantTarget.value = account
  grantOpen.value = true
}

function afterChange() {
  if (drawerOpen.value) drawer.value?.reload()
}

const afterKick = useAfterKick(afterChange)

async function kick(account: AccountRow) {
  if (await kickAccount(account)) afterKick()
}

/* ---------- preview ---------- */

const previewOpen = ref(false)
const previewId = ref('')
const lastPreviewed = ref<MapRow | null>(null)
// The previewed row as the list now has it (a reload after hiding updates
// it), or as it was when opened once it left the page.
const previewing = computed(() => table.items.find((row) => row.id === previewId.value) ?? lastPreviewed.value)

function preview(row: MapRow) {
  previewId.value = row.id
  lastPreviewed.value = row
  previewOpen.value = true
}

/* ---------- hide, restore, delete ---------- */

const busy = ref('')

function mapLabel(row: MapRow): string {
  return `“${row.name}”（作者：${row.author || row.username}）`
}

async function setHidden(row: MapRow, hidden: boolean) {
  const message = hidden
    ? `隐藏地图${mapLabel(row)}？\n隐藏后玩家看不到也下载不了它：自定义游戏的地图列表、多人房间与道具房选图里都不再出现，已经选了它的房间开赛时无法载入。作者在“我的地图”里仍能看到。可以随时恢复。`
    : `恢复地图${mapLabel(row)}？\n它会重新出现在自定义游戏与多人选图里${row.items > 0 ? '，道具房也能选它' : ''}。`
  if (!await confirmAction(message, hidden ? '隐藏地图' : '恢复地图', { confirmText: hidden ? '隐藏' : '恢复' })) return
  busy.value = row.id
  try {
    await api.post(`/api/admin/maps/${encodeURIComponent(row.id)}/hidden`, { hidden })
    ElMessage.success(hidden ? `已隐藏：${row.name}` : `已恢复：${row.name}`)
    if (lastPreviewed.value?.id === row.id) lastPreviewed.value = { ...row, hidden }
    void table.load({ silent: true })
  } catch (error) {
    showError(error)
  } finally {
    busy.value = ''
  }
}

async function remove(row: MapRow) {
  if (!await confirmAction(
    `永久删除地图${mapLabel(row)}？\n赛道包、设计文件和图片会一起删除，无法恢复，作者也找不回来。只想暂时下架请用“隐藏”。`,
    '删除地图', { type: 'error', danger: true, confirmText: '永久删除' })) return
  busy.value = row.id
  try {
    await api.del(`/api/admin/maps/${encodeURIComponent(row.id)}`)
    ElMessage.success(`已删除：${row.name}`)
    if (previewId.value === row.id) previewOpen.value = false
    void table.load({ silent: true })
  } catch (error) {
    showError(error)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <el-card shadow="never" class="page-card">
    <p class="page-note">
      玩家在地图工坊里发布的地图：所有人都能在 单人游戏 → 自定义游戏 里玩，多人竞速房可以选，有道具箱的道具房也能选。
      “隐藏”只是对玩家下架，作者在“我的地图”里仍能看到，可以随时恢复；“删除”会连同赛道包一起永久删除。
    </p>
    <TableToolbar :table="table" keyword="地图名 / 作者 / 地图 ID" range="更新时间">
      <el-form-item label="状态">
        <el-select v-model="table.filters.state" clearable placeholder="全部" class="filter-select" @change="table.search()">
          <el-option v-for="option in mapStateOptions" :key="option.value" :value="option.value" :label="option.label" />
        </el-select>
      </el-form-item>
      <el-form-item label="作者">
        <el-input v-model="table.filters.account" maxlength="36" clearable placeholder="用户名" class="filter-input" @clear="table.search()" />
      </el-form-item>
    </TableToolbar>
    <DataTable :table="table" row-key="id" empty-text="还没有自制地图">
      <el-table-column label="缩略图" width="136">
        <template #default="{ row }">
          <button type="button" class="picture-button" title="预览" @click="preview(row)">
            <MapPicture :map-id="row.id" kind="thumb" :version="row.sha256" :width="111" :height="65" :alt="row.name" />
          </button>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" min-width="160" sortable="custom">
        <template #default="{ row }">
          <el-link type="primary" underline="never" @click="preview(row)">{{ row.name }}</el-link>
          <div class="muted mono">{{ row.id }}</div>
        </template>
      </el-table-column>
      <el-table-column label="作者" min-width="140">
        <template #default="{ row }">
          <el-link type="primary" underline="never" @click="showAccount(row)">
            <AccountName :nickname="row.author" :username="row.username" />
          </el-link>
        </template>
      </el-table-column>
      <el-table-column label="主题" width="100">
        <template #default="{ row }">
          {{ themeName(row.theme) }}
          <div v-if="themeName(row.theme) !== row.theme" class="muted mono">{{ row.theme }}</div>
        </template>
      </el-table-column>
      <el-table-column label="圈数" width="70" align="right">
        <template #default="{ row }">{{ row.laps }}</template>
      </el-table-column>
      <el-table-column label="难度" width="116">
        <template #default="{ row }"><span class="stars" :title="`难度 ${row.difficulty}`">{{ difficultyStars(row.difficulty) }}</span></template>
      </el-table-column>
      <el-table-column prop="items" label="道具箱" width="100" align="right" sortable="custom">
        <template #default="{ row }">
          <span v-if="row.items" class="num">{{ formatNumber(row.items) }}</span>
          <span v-else class="muted" title="没有道具箱，只能竞速">无</span>
        </template>
      </el-table-column>
      <el-table-column prop="size" label="大小" width="100" align="right" sortable="custom">
        <template #default="{ row }"><span class="num">{{ formatBytes(row.size) }}</span></template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="mapState(row.hidden).type" disable-transitions>{{ mapState(row.hidden).label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updatedAt" label="更新时间" width="175" sortable="custom">
        <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column prop="createdAt" label="发布时间" width="175" sortable="custom">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="preview(row)">预览</el-button>
          <el-button v-if="row.hidden" link type="success" :disabled="busy === row.id" @click="setHidden(row, false)">恢复</el-button>
          <el-button v-else link type="warning" :disabled="busy === row.id" @click="setHidden(row, true)">隐藏</el-button>
          <el-button link type="danger" :disabled="busy === row.id" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </DataTable>

    <el-dialog v-model="previewOpen" :title="previewing ? `地图预览：${previewing.name}` : '地图预览'" :width="narrow ? '94%' : '720px'" append-to-body>
      <div v-if="previewing" class="preview">
        <div class="preview-pictures">
          <figure>
            <MapPicture :map-id="previewing.id" kind="card" :version="previewing.sha256" :width="352" :height="206" :alt="previewing.name" />
            <figcaption class="muted">选图卡片 352×206</figcaption>
          </figure>
          <figure>
            <MapPicture :map-id="previewing.id" kind="thumb" :version="previewing.sha256" :width="222" :height="130" :alt="previewing.name" />
            <figcaption class="muted">缩略图 222×130</figcaption>
          </figure>
        </div>
        <el-descriptions :column="narrow ? 1 : 2" border size="small">
          <el-descriptions-item label="名称">{{ previewing.name }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="mapState(previewing.hidden).type" disable-transitions>{{ mapState(previewing.hidden).label }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="地图 ID"><span class="mono">{{ previewing.id }}</span></el-descriptions-item>
          <el-descriptions-item label="赛道 ID"><span class="mono">custom_{{ previewing.id }}</span></el-descriptions-item>
          <el-descriptions-item label="作者">{{ accountLabel(previewing.author, previewing.username) }}</el-descriptions-item>
          <el-descriptions-item label="主题">{{ themeName(previewing.theme) }} <span class="muted mono">{{ previewing.theme }}</span></el-descriptions-item>
          <el-descriptions-item label="圈数">{{ previewing.laps }}</el-descriptions-item>
          <el-descriptions-item label="难度"><span class="stars">{{ difficultyStars(previewing.difficulty) }}</span></el-descriptions-item>
          <el-descriptions-item label="道具箱">{{ previewing.items ? formatNumber(previewing.items) : '无（只能竞速）' }}</el-descriptions-item>
          <el-descriptions-item label="碰撞范围">{{ formatNumber(previewing.roadExtent) }}</el-descriptions-item>
          <el-descriptions-item label="赛道包" :span="narrow ? 1 : 2">{{ formatBytes(previewing.size) }}，{{ formatNumber(previewing.files) }} 个文件</el-descriptions-item>
          <el-descriptions-item label="发布时间">{{ formatTime(previewing.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatTime(previewing.updatedAt) }}</el-descriptions-item>
          <el-descriptions-item label="SHA-256" :span="narrow ? 1 : 2"><span class="mono sha">{{ previewing.sha256 }}</span></el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <template v-if="previewing">
          <el-button v-if="previewing.hidden" type="success" plain :loading="busy === previewing.id" @click="setHidden(previewing, false)">恢复</el-button>
          <el-button v-else type="warning" plain :loading="busy === previewing.id" @click="setHidden(previewing, true)">隐藏</el-button>
          <el-button type="danger" plain :disabled="busy === previewing.id" @click="remove(previewing)">删除</el-button>
        </template>
        <el-button @click="previewOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <AccountDrawer ref="drawer" v-model="drawerOpen" :account-id="drawerId" @edit="edit" @grant="grant" @kick="kick" />
    <EditAccountDialog v-model="editOpen" :account="editing" @saved="afterKick" />
    <GrantDialog v-model="grantOpen" :username="grantTarget?.username" :account="grantTarget" @done="afterChange" />
  </el-card>
</template>

<style scoped>
.picture-button {
  display: block;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
.stars {
  color: var(--el-color-warning);
  letter-spacing: 1px;
  white-space: nowrap;
}
.preview-pictures {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 16px;
}
.preview-pictures figure {
  margin: 0;
  max-width: 100%;
}
.preview-pictures figcaption {
  margin-top: 4px;
  font-size: 12px;
}
.preview :deep(.el-descriptions__label) {
  white-space: nowrap;
}
.sha {
  word-break: break-all;
}
</style>
