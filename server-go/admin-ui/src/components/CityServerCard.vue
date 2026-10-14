<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import type { CityServer, NodeRow } from '../api/types'
import { cityExcludedLabels, cityRuleLabels } from '../utils/format'
import { formatTime } from '../utils/time'
import { showError } from '../utils/ui'

// 卡丁城服务器: every player entering the 卡丁城 goes to one game node
// (GLOBAL_LOBBY.md 卡丁城). Automatic follows the city's crowd; a node chosen
// here takes everyone while it is online with room, the automatic rule
// standing in otherwise. PUT /api/admin/city-server {nodeId}. The setting
// and the next pick come with GET /api/admin/nodes (the page's refresh).

const props = defineProps<{ city?: CityServer | null; nodes: NodeRow[] }>()
const emit = defineEmits<{ saved: [] }>()

const saved = computed(() => props.city?.nodeId ?? '')
const draft = ref('')
const saving = ref(false)
// The refresh moves the choice along unless it is being changed.
watch(saved, (value, old) => {
  if (draft.value === (old ?? '')) draft.value = value
}, { immediate: true })
const changed = computed(() => draft.value !== saved.value)

interface Option {
  value: string
  label: string
  detail: string
}

const options = computed<Option[]>(() => {
  const list: Option[] = props.nodes.map((row) => ({
    value: row.nodeId,
    label: row.name || row.nodeId,
    detail: row.status === 'offline'
      ? '离线'
      : `城里 ${row.cityPlayers ?? 0} 人 · 玩家 ${row.players}/${row.capacity}`,
  }))
  if (saved.value && !list.some((option) => option.value === saved.value)) {
    list.push({ value: saved.value, label: saved.value, detail: '不在线' })
  }
  return list
})

function nodeLabel(nodeId: string) {
  return options.value.find((option) => option.value === nodeId)?.label || nodeId
}

const excluded = computed(() => {
  const reason = props.city?.next.settingExcluded
  return reason ? cityExcludedLabels[reason] ?? reason : ''
})

async function save() {
  if (saving.value || !changed.value) return
  saving.value = true
  try {
    const result = await api.put<CityServer>('/api/admin/city-server', { nodeId: draft.value })
    ElMessage.success(result.nodeId
      ? `已设为「${nodeLabel(result.nodeId)}」，之后进卡丁城的玩家都会分到这台节点`
      : '已改为自动，之后进卡丁城的玩家都跟着城里人最多的节点走')
    emit('saved')
  } catch (error) {
    showError(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-card shadow="never" class="page-card">
    <template #header>
      <div class="card-head">
        <span>卡丁城服务器</span>
        <span class="muted small">所有进卡丁城的玩家都分到同一台节点，大家在同一座城里</span>
      </div>
    </template>
    <el-skeleton v-if="city === undefined" :rows="2" animated />
    <el-alert v-else-if="city === null" type="error" title="读取卡丁城服务器设置失败（数据库不可用）" :closable="false" show-icon />
    <template v-else>
      <div class="picker-row">
        <!-- "" is 自动, a value of its own (not an empty select). -->
        <el-select v-model="draft" class="picker" :disabled="saving" :empty-values="[null, undefined]">
          <el-option value="" label="自动（跟着城里人最多的节点走）" />
          <el-option v-for="option in options" :key="option.value" :value="option.value" :label="option.label">
            <span>{{ option.label }}</span>
            <span class="muted option-detail">{{ option.detail }}</span>
          </el-option>
        </el-select>
        <el-button type="primary" :disabled="!changed" :loading="saving" @click="save">保存</el-button>
        <el-button v-if="changed" :disabled="saving" @click="draft = saved">取消</el-button>
      </div>
      <el-alert
        v-if="excluded"
        type="warning"
        :closable="false"
        show-icon
        class="alert"
        :title="`指定的节点「${nodeLabel(saved)}」${excluded}，现在按自动规则分配；它恢复后，新进城的玩家会回到它上面`"
      />
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="当前设置">
          {{ saved ? nodeLabel(saved) : '自动' }}
          <span v-if="city.updatedBy" class="muted">（{{ city.updatedBy }} 于 {{ formatTime(city.updatedAt) }} 修改）</span>
        </el-descriptions-item>
        <el-descriptions-item label="现在进城会分到">
          <template v-if="city.next.nodeId">
            {{ city.next.nodeName || city.next.nodeId }}
            <span class="muted">（{{ cityRuleLabels[city.next.rule] ?? city.next.rule }}）</span>
          </template>
          <span v-else class="error-text">没有可用节点</span>
        </el-descriptions-item>
      </el-descriptions>
      <div class="muted small hint">
        自动：去城里人最多的节点；城里还没人时，第一位进城的玩家按延迟选，之后的人跟着去同一台。
        改动只影响之后进城的玩家，已经在城里的玩家留在原来的节点，离开卡丁城再进来时才换过去。
        指定的节点离线、满员或协议版本不同时，按自动规则分配。
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.small {
  font-size: 12px;
}
.picker-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.picker {
  width: 360px;
  max-width: 100%;
}
.option-detail {
  float: right;
  margin-left: 16px;
  font-size: 12px;
}
.alert {
  margin-bottom: 12px;
}
.error-text {
  color: var(--el-color-danger);
}
.hint {
  margin-top: 8px;
  line-height: 1.6;
}
</style>
