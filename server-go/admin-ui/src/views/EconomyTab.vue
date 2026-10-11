<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, RefreshLeft } from '@element-plus/icons-vue'
import { api, errorMessage } from '../api/client'
import type { CurrencyGrant, EconomySettings } from '../api/types'
import { useNarrow } from '../composables/useNarrow'
import { useTab } from '../composables/useTabs'
import { formatTime } from '../utils/time'
import { showError } from '../utils/ui'

// 经济设置 (ECONOMY.md 2.3/2.4): GET /api/admin/economy, PUT
// /api/admin/economy {register{coupon,lucci,koin}, race{coupon,lucci,koin}}.
// The registration grant is credited when an account's wallet is created;
// the per-race grant goes to every racer who finishes an online race (game
// nodes show it with their next heartbeat, within about 10 seconds).

const MAX = 1_000_000_000
const CURRENCIES: { key: keyof CurrencyGrant; label: string }[] = [
  { key: 'coupon', label: '点券' },
  { key: 'lucci', label: '金币' },
  { key: 'koin', label: 'K币' },
]

const settings = ref<EconomySettings | null>(null)
const loading = ref(false)
const saving = ref(false)
const failure = ref('')
const narrow = useNarrow()
const form = reactive({
  register: { coupon: 0, lucci: 0, koin: 0 } as CurrencyGrant,
  race: { coupon: 0, lucci: 0, koin: 0 } as CurrencyGrant,
})

function fill(from: { register: CurrencyGrant; race: CurrencyGrant }) {
  for (const { key } of CURRENCIES) {
    form.register[key] = from.register[key]
    form.race[key] = from.race[key]
  }
}

async function load() {
  loading.value = true
  try {
    settings.value = await api.get<EconomySettings>('/api/admin/economy')
    fill(settings.value)
    failure.value = ''
  } catch (error) {
    failure.value = errorMessage(error)
    showError(error)
  } finally {
    loading.value = false
  }
}

useTab('economy', load)
onMounted(load)

const dirty = computed(() => {
  const saved = settings.value
  if (!saved) return false
  return CURRENCIES.some(({ key }) => form.register[key] !== saved.register[key] || form.race[key] !== saved.race[key])
})

function valid(grant: CurrencyGrant): boolean {
  return CURRENCIES.every(({ key }) => Number.isInteger(grant[key]) && grant[key] >= 0 && grant[key] <= MAX)
}

async function save() {
  if (saving.value) return
  if (!valid(form.register) || !valid(form.race)) {
    failure.value = `每项须为 0–${MAX.toLocaleString('zh-CN')} 的整数`
    return
  }
  saving.value = true
  try {
    settings.value = await api.put<EconomySettings>('/api/admin/economy', {
      register: { ...form.register },
      race: { ...form.race },
    })
    fill(settings.value)
    failure.value = ''
    ElMessage.success('已保存经济设置')
  } catch (error) {
    failure.value = errorMessage(error)
  } finally {
    saving.value = false
  }
}

function restoreDefaults() {
  if (settings.value) fill(settings.value.defaults)
}
</script>

<template>
  <el-card shadow="never" class="page-card">
    <p class="page-note">
      注册赠送在账号的钱包建立时入账（流水原因“新手礼包”）；比赛赠送发给每位跑完联机比赛的车手，不计每日上限（流水原因“比赛赠送”），游戏节点约 10 秒内随心跳更新显示。
    </p>
    <div class="toolbar">
      <el-button type="primary" :loading="saving" :disabled="loading || !settings || !dirty" @click="save">保存</el-button>
      <el-button :icon="RefreshLeft" :disabled="!settings" @click="restoreDefaults">填入默认值</el-button>
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      <span v-if="settings" class="meta">
        {{ settings.updatedAt ? `最后修改：${formatTime(settings.updatedAt)}（${settings.updatedBy || '—'}）` : '尚未修改过，使用默认值' }}
      </span>
    </div>
    <el-alert v-if="failure" :title="failure" type="error" show-icon :closable="false" class="failure" />
    <el-form v-loading="loading" label-width="120px" :label-position="narrow ? 'top' : 'right'" @submit.prevent="save">
      <el-divider content-position="left">注册赠送</el-divider>
      <el-form-item v-for="currency in CURRENCIES" :key="'register-' + currency.key" :label="currency.label">
        <el-input-number v-model="form.register[currency.key]" :min="0" :max="MAX" :step="1000" :precision="0" controls-position="right" class="amount" />
        <span v-if="settings" class="hint">默认 {{ settings.defaults.register[currency.key].toLocaleString('zh-CN') }}</span>
      </el-form-item>
      <el-divider content-position="left">每场比赛赠送（跑完一场）</el-divider>
      <el-form-item v-for="currency in CURRENCIES" :key="'race-' + currency.key" :label="currency.label">
        <el-input-number v-model="form.race[currency.key]" :min="0" :max="MAX" :step="10" :precision="0" controls-position="right" class="amount" />
        <span v-if="settings" class="hint">默认 {{ settings.defaults.race[currency.key].toLocaleString('zh-CN') }}</span>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.failure {
  margin-bottom: 16px;
}
.amount {
  width: 220px;
}
.hint {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
