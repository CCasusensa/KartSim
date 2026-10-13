<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Plus } from '@element-plus/icons-vue'
import { api } from '../api/client'
import type { GameNodeRow, GameNodesResponse } from '../api/types'
import { formatAgo, formatTime } from '../utils/time'
import { confirmAction, copyText, showError } from '../utils/ui'

// 节点管理: the game nodes added here (GET/POST /api/admin/game-nodes,
// PATCH and DELETE /api/admin/game-nodes/{id}, POST …/{id}/key). Each node
// gets its own key, shown once: the node's configuration is only the data
// service address (this page's origin) and that key (NODE.md).

const props = defineProps<{ now?: number }>()

const rows = ref<GameNodeRow[]>([])
const loading = ref(false)
const loaded = ref(false)

async function load(silent = false) {
  if (silent && loading.value) return
  loading.value = true
  try {
    rows.value = (await api.get<GameNodesResponse>('/api/admin/game-nodes')).nodes
    loaded.value = true
  } catch (error) {
    if (!silent) showError(error)
  } finally {
    loading.value = false
  }
}
defineExpose({ load })

const statusTags: Record<string, { type: 'success' | 'danger' | 'info' | 'warning'; label: string }> = {
  online: { type: 'success', label: '在线' },
  offline: { type: 'danger', label: '离线' },
  never: { type: 'info', label: '未连接' },
  disabled: { type: 'warning', label: '已停用' },
}
const status = (row: GameNodeRow) => statusTags[row.status] ?? { type: 'info' as const, label: row.status }

// The node's data service address is the address this console is served from.
const dataUrl = computed(() => window.location.origin)

// —— add / edit ——
const editing = ref<GameNodeRow | null>(null)
const formOpen = ref(false)
const saving = ref(false)
const form = reactive({ id: '', name: '', origin: '', note: '' })

function openAdd() {
  editing.value = null
  Object.assign(form, { id: '', name: '', origin: '', note: '' })
  formOpen.value = true
}

function openEdit(row: GameNodeRow) {
  editing.value = row
  Object.assign(form, { id: row.id, name: row.name, origin: row.origin ?? '', note: row.note ?? '' })
  formOpen.value = true
}

async function save() {
  if (saving.value) return
  if (!form.name.trim()) {
    ElMessage.warning('请填写节点名称')
    return
  }
  saving.value = true
  try {
    const body = { name: form.name, origin: form.origin, note: form.note }
    if (editing.value) {
      await api.patch(`/api/admin/game-nodes/${encodeURIComponent(editing.value.id)}`, body)
      ElMessage.success('已保存，节点会在 5 秒内用上新名称与地址')
    } else {
      const created = await api.post<{ node: GameNodeRow; key: string }>('/api/admin/game-nodes',
        { ...body, id: form.id.trim() || undefined })
      showKey(created.node.id, created.node.name, created.key)
    }
    formOpen.value = false
    void load(true)
  } catch (error) {
    showError(error)
  } finally {
    saving.value = false
  }
}

// —— the key, shown once ——
const keyShown = ref<{ id: string; name: string; key: string } | null>(null)

function showKey(id: string, name: string, key: string) {
  keyShown.value = { id, name, key }
}

const config = computed(() => keyShown.value
  ? `KART_DATA_URL=${dataUrl.value}\nKART_NODE_KEY=${keyShown.value.key}`
  : '')
const initCommand = computed(() => keyShown.value
  ? `./kart-node init --data ${dataUrl.value} --key ${keyShown.value.key}`
  : '')

async function copy(value: string) {
  if (await copyText(value)) ElMessage.success('已复制')
  else ElMessage.warning('浏览器不允许自动复制，请手动选中复制')
}

async function rotate(row: GameNodeRow) {
  const sure = await confirmAction(`重置“${row.name}”的密钥后，旧密钥立即失效，节点会断开，要把新密钥填进节点的配置文件并重启节点。`,
    '重置节点密钥', { confirmText: '重置', danger: true })
  if (!sure) return
  try {
    const result = await api.post<{ key: string }>(`/api/admin/game-nodes/${encodeURIComponent(row.id)}/key`)
    showKey(row.id, row.name, result.key)
    void load(true)
  } catch (error) {
    showError(error)
  }
}

async function toggle(row: GameNodeRow) {
  const disabling = !row.disabled
  if (disabling) {
    const sure = await confirmAction(`停用后“${row.name}”立即从游戏服列表中消失，不能再接收玩家；随时可以重新启用。`,
      '停用节点', { confirmText: '停用', danger: true })
    if (!sure) return
  }
  try {
    await api.patch(`/api/admin/game-nodes/${encodeURIComponent(row.id)}`, { disabled: disabling })
    ElMessage.success(disabling ? '已停用' : '已启用，节点会自动重新连上')
    void load(true)
  } catch (error) {
    showError(error)
  }
}

async function remove(row: GameNodeRow) {
  const sure = await confirmAction(`删除“${row.name}”（${row.id}）后它的密钥作废，节点立即断开。确定删除吗？`,
    '删除节点', { confirmText: '删除', danger: true })
  if (!sure) return
  try {
    await api.del(`/api/admin/game-nodes/${encodeURIComponent(row.id)}`)
    ElMessage.success('已删除')
    void load(true)
  } catch (error) {
    showError(error)
  }
}

const nowMs = () => props.now ?? Date.now()
</script>

<template>
  <el-card shadow="never" class="page-card">
    <template #header>
      <div class="card-head">
        <span>节点管理（{{ rows.length }}）</span>
        <el-button type="primary" size="small" :icon="Plus" @click="openAdd">添加节点</el-button>
      </div>
    </template>
    <p class="page-note">
      在这里添加节点会生成一个节点密钥。节点服务器上只需要填两项：数据服务地址 <span class="mono">{{ dataUrl }}</span>
      和这个密钥，启动 kart-node 后自动连上（第一次运行会提示输入）。节点的名称与对外地址以这里为准。
    </p>
    <el-table v-loading="loading && !loaded" :data="rows" border stripe row-key="id" empty-text="还没有添加节点">
      <el-table-column label="节点" min-width="170">
        <template #default="{ row }">
          <div class="ellipsis" :title="row.name">{{ row.name }}</div>
          <div class="muted mono ellipsis" :title="row.id">{{ row.id }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="130">
        <template #default="{ row }">
          <el-tag :type="status(row).type" disable-transitions>{{ status(row).label }}</el-tag>
          <span v-if="row.status === 'online'" class="muted small"> {{ row.players }}/{{ row.capacity }} 人</span>
        </template>
      </el-table-column>
      <el-table-column label="对外地址" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.origin" class="mono">{{ row.origin }}</span>
          <span v-else-if="row.liveOrigin" class="mono">{{ row.liveOrigin }} <span class="muted">（节点上报）</span></span>
          <span v-else class="muted">由节点决定</span>
        </template>
      </el-table-column>
      <el-table-column label="最后注册" width="190">
        <template #default="{ row }">
          <template v-if="row.registeredAt">
            <div>{{ formatAgo(nowMs(), row.registeredAt) }}</div>
            <div class="muted small mono">{{ row.registeredIp || '—' }}</div>
          </template>
          <span v-else class="muted">从未连接</span>
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.note || '' }}</template>
      </el-table-column>
      <el-table-column label="添加" width="170">
        <template #default="{ row }">
          <div>{{ formatTime(row.createdAt) }}</div>
          <div class="muted small">{{ row.createdBy }}</div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="warning" @click="rotate(row)">重置密钥</el-button>
          <el-button link :type="row.disabled ? 'success' : 'warning'" @click="toggle(row)">{{ row.disabled ? '启用' : '停用' }}</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="formOpen" :title="editing ? '编辑节点' : '添加节点'" width="min(520px, 94vw)" :close-on-click-modal="false">
      <el-form label-width="96px" @submit.prevent="save">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="32" show-word-limit placeholder="选服列表里显示的名称，如 华东一区" />
        </el-form-item>
        <el-form-item label="节点 ID">
          <el-input v-model="form.id" :disabled="!!editing" maxlength="64" placeholder="留空自动生成；只能用字母、数字、- 和 _" />
        </el-form-item>
        <el-form-item label="对外地址">
          <el-input v-model="form.origin" maxlength="255" placeholder="可留空，如 https://game1.example.com" />
          <div class="muted small">玩家浏览器访问该节点的地址。留空时用节点自己设置的地址，再没有就用数据服务看到的节点 IP。</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" maxlength="200" placeholder="可选，如 机房、带宽" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ editing ? '保存' : '添加并生成密钥' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog :model-value="!!keyShown" title="节点密钥" width="min(640px, 94vw)" :close-on-click-modal="false"
      @update:model-value="(open: boolean) => { if (!open) keyShown = null }">
      <template v-if="keyShown">
        <el-alert type="warning" :closable="false" show-icon class="alert"
          :title="`“${keyShown.name}”（${keyShown.id}）的密钥只显示这一次，关闭后无法再查看；丢了可以重置。`" />
        <p class="label">节点配置文件 kart-node.conf 写这两行：</p>
        <div class="code-row">
          <pre class="code">{{ config }}</pre>
          <el-button :icon="CopyDocument" @click="copy(config)">复制</el-button>
        </div>
        <p class="label">或者在节点服务器上运行（Windows 用 .\kart-node.exe）：</p>
        <div class="code-row">
          <pre class="code">{{ initCommand }}</pre>
          <el-button :icon="CopyDocument" @click="copy(initCommand)">复制</el-button>
        </div>
        <p class="muted small">也可以直接运行 kart-node，按提示粘贴地址与密钥。节点只需放行自己的 TCP 与 UDP 端口（默认 8788），不需要访问数据库。</p>
      </template>
      <template #footer>
        <el-button type="primary" @click="keyShown = null">已保存密钥</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.alert {
  margin-bottom: 12px;
}
.label {
  margin: 12px 0 6px;
}
.code-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.code {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.small {
  font-size: 12px;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
