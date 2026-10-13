<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, ArrowUp, Delete, Picture, Plus, Refresh, Upload } from '@element-plus/icons-vue'
import { api, errorMessage, upload } from '../api/client'
import type { LobbyPromo, LobbyPromos, UploadedPromoImage } from '../api/types'
import { useNarrow } from '../composables/useNarrow'
import { useTab } from '../composables/useTabs'
import { formatTime } from '../utils/time'
import { showError } from '../utils/ui'

// 大厅宣传 (ADMIN.md 10): the lobby home's carousel and its blue and purple
// promotion boards. GET/PUT /api/admin/lobby-promos {interval, carousel[],
// boards[2]}, each {image, link, title}; pictures go up first with POST
// /api/admin/lobby-promos/images (the file as the body). Players see the
// change the next time their lobby home opens.

const MAX_SLIDES = 8
const MAX_BYTES = 4 << 20
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
/** The shown areas' shapes in the game (35 × 20.2 and 35 × 7.8 of the screen height). */
const CAROUSEL_RATIO = 35 / 20.2
const BOARD_RATIO = 35 / 7.8
const BOARDS = [
  { label: '蓝色宣传板', tone: 'blue' },
  { label: '紫色宣传板', tone: 'purple' },
] as const

const settings = ref<LobbyPromos | null>(null)
const loading = ref(false)
const saving = ref(false)
const uploading = ref('')
const failure = ref('')
const narrow = useNarrow()
const fileInput = ref<HTMLInputElement | null>(null)
const form = reactive({ interval: 5, carousel: [] as LobbyPromo[], boards: [] as LobbyPromo[] })
/** Where the picked file goes. */
let pickTarget: { key: string; apply: (image: UploadedPromoImage) => void } | null = null

const emptyPromo = (): LobbyPromo => ({ image: '', url: '', width: 0, height: 0, link: '', title: '' })

function fill(from: LobbyPromos) {
  form.interval = from.interval || 5
  form.carousel = from.carousel.map((slide) => ({ ...slide }))
  form.boards = [0, 1].map((index) => ({ ...emptyPromo(), ...from.boards[index] }))
}

async function load() {
  loading.value = true
  try {
    settings.value = await api.get<LobbyPromos>('/api/admin/lobby-promos')
    fill(settings.value)
    failure.value = ''
  } catch (error) {
    failure.value = errorMessage(error)
    showError(error)
  } finally {
    loading.value = false
  }
}

useTab('lobby-promos', load)
onMounted(load)

const request = (promo: LobbyPromo) => ({ image: promo.image, link: promo.link.trim(), title: promo.title.trim() })
const body = () => ({ interval: form.interval, carousel: form.carousel.map(request), boards: form.boards.map(request) })

const dirty = computed(() => {
  const saved = settings.value
  if (!saved) return false
  const before = { interval: saved.interval, carousel: saved.carousel.map(request),
    boards: [0, 1].map((index) => request({ ...emptyPromo(), ...saved.boards[index] })) }
  return JSON.stringify(before) !== JSON.stringify(body())
})

/** Mirrors the server's check; '' when the link is fine. */
function linkProblem(link: string): string {
  const value = link.trim()
  if (!value) return ''
  if (value.length > 500) return '链接最长 500 字符'
  if (/[\s\\<>"'`]/.test(value)) return '链接不能有空格、引号、尖括号或反斜杠'
  if (value.startsWith('/')) return value.startsWith('//') ? '站内路径不能以 // 开头' : ''
  try {
    const url = new URL(value)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.host && !url.username) return ''
  } catch {
    /* falls through */
  }
  return '须为 http:// 或 https:// 开头的网址，或以 / 开头的站内路径'
}

const problems = computed(() => {
  const list: string[] = []
  form.carousel.forEach((slide, index) => {
    if (!slide.image) list.push(`轮播图 ${index + 1} 还没有图片`)
    const link = linkProblem(slide.link)
    if (link) list.push(`轮播图 ${index + 1}：${link}`)
  })
  form.boards.forEach((board, index) => {
    const link = linkProblem(board.link)
    if (link) list.push(`${BOARDS[index]!.label}：${link}`)
  })
  return list
})

async function save() {
  if (saving.value) return
  if (problems.value.length) {
    failure.value = problems.value.join('；')
    return
  }
  saving.value = true
  try {
    settings.value = await api.put<LobbyPromos>('/api/admin/lobby-promos', body())
    fill(settings.value)
    failure.value = ''
    ElMessage.success('已保存大厅宣传，玩家下次打开大厅首页时生效')
  } catch (error) {
    failure.value = errorMessage(error)
  } finally {
    saving.value = false
  }
}

function pick(key: string, apply: (image: UploadedPromoImage) => void) {
  pickTarget = { key, apply }
  const input = fileInput.value
  if (!input) return
  input.value = ''
  input.click()
}

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  const target = pickTarget
  pickTarget = null
  if (!file || !target) return
  if (!TYPES.includes(file.type)) {
    ElMessage.error('只支持 PNG、JPEG、GIF、WebP 图片')
    return
  }
  if (file.size > MAX_BYTES) {
    ElMessage.error('图片过大（最大 4 MB）')
    return
  }
  uploading.value = target.key
  try {
    target.apply(await upload<UploadedPromoImage>('/api/admin/lobby-promos/images', file))
  } catch (error) {
    showError(error)
  } finally {
    uploading.value = ''
  }
}

function setImage(promo: LobbyPromo, image: UploadedPromoImage) {
  promo.image = image.image
  promo.url = image.url
  promo.width = image.width
  promo.height = image.height
}

function replaceImage(key: string, promo: LobbyPromo) {
  pick(key, (image) => setImage(promo, image))
}

function addSlide() {
  pick('new', (image) => {
    const slide = emptyPromo()
    setImage(slide, image)
    form.carousel.push(slide)
  })
}

function move(index: number, by: number) {
  const to = index + by
  if (to < 0 || to >= form.carousel.length) return
  const [slide] = form.carousel.splice(index, 1)
  form.carousel.splice(to, 0, slide!)
}

function clearImage(promo: LobbyPromo) {
  promo.image = ''
  promo.url = ''
  promo.width = 0
  promo.height = 0
}

/** Size, and a warning when the picture's shape differs much from the shown area. */
function sizeHint(promo: LobbyPromo, ratio: number): { text: string; warn: boolean } {
  if (!promo.url) return { text: '', warn: false }
  const shape = promo.width / promo.height
  const warn = Math.abs(shape - ratio) / ratio > 0.15
  return { text: `${promo.width}×${promo.height}${warn ? '，比例与显示区域相差较大，会被裁掉一部分' : ''}`, warn }
}
</script>

<template>
  <el-card shadow="never" class="page-card">
    <p class="page-note">
      大厅首页右侧的三个位置：上面的轮播图，下面的蓝色、紫色两块宣传板。每个位置可以上传图片（PNG/JPEG/GIF/WebP，最大 4 MB）、填点击后跳转的链接（http(s):// 网址或以 / 开头的游戏站内路径，在新标签页打开；不填则提示“敬请期待”）。
      图片会按显示区域等比裁切铺满，建议轮播图 1040×600、宣传板 1050×234。轮播图一张都不配置时显示原版的 4 张加载插画；宣传板不传图时保留原来的样子，文字可改。玩家下次打开大厅首页时生效。
    </p>
    <div class="toolbar">
      <el-button type="primary" :loading="saving" :disabled="loading || !settings || !dirty || !!uploading" @click="save">保存</el-button>
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      <span v-if="settings" class="meta">
        {{ settings.updatedAt ? `最后修改：${formatTime(settings.updatedAt)}（${settings.updatedBy || '—'}）` : '尚未配置，游戏显示原版内容' }}
      </span>
    </div>
    <el-alert v-if="failure" :title="failure" type="error" show-icon :closable="false" class="failure" />
    <input ref="fileInput" type="file" :accept="TYPES.join(',')" class="file-input" @change="onFile" />
    <div v-loading="loading">
      <el-divider content-position="left">轮播图（{{ form.carousel.length }}/{{ MAX_SLIDES }}）</el-divider>
      <div class="interval">
        <span>切换间隔</span>
        <el-input-number v-model="form.interval" :min="2" :max="60" :step="1" :precision="0" controls-position="right" />
        <span class="hint">秒；只有一张时不轮播</span>
      </div>
      <el-empty v-if="!form.carousel.length" :image-size="60" description="未配置，游戏里显示原版的 4 张加载插画" />
      <div v-for="(slide, index) in form.carousel" :key="index" class="promo" :class="{ narrow }">
        <div class="preview carousel">
          <img v-if="slide.url" :src="slide.url" alt="" />
          <span v-else class="missing"><el-icon><Picture /></el-icon>没有图片</span>
          <span class="badge">{{ index + 1 }}</span>
        </div>
        <el-form class="fields" label-width="56px" :label-position="narrow ? 'top' : 'right'" @submit.prevent>
          <el-form-item label="图片">
            <el-button :icon="Upload" :loading="uploading === 'slide-' + index"
              @click="replaceImage('slide-' + index, slide)">更换图片</el-button>
            <span class="hint" :class="{ warn: sizeHint(slide, CAROUSEL_RATIO).warn }">{{ sizeHint(slide, CAROUSEL_RATIO).text }}</span>
          </el-form-item>
          <el-form-item label="链接" :error="linkProblem(slide.link)">
            <el-input v-model="slide.link" clearable maxlength="500" placeholder="网址（https 开头）或 /editor.html；留空则不跳转" />
          </el-form-item>
          <el-form-item label="标题">
            <el-input v-model="slide.title" clearable maxlength="40" show-word-limit placeholder="鼠标停在图上时显示，可留空" />
          </el-form-item>
          <el-form-item label=" ">
            <el-button-group>
              <el-button :icon="ArrowUp" :disabled="index === 0" @click="move(index, -1)">上移</el-button>
              <el-button :icon="ArrowDown" :disabled="index === form.carousel.length - 1" @click="move(index, 1)">下移</el-button>
            </el-button-group>
            <el-button type="danger" plain :icon="Delete" class="remove" @click="form.carousel.splice(index, 1)">删除</el-button>
          </el-form-item>
        </el-form>
      </div>
      <el-button :icon="Plus" :disabled="form.carousel.length >= MAX_SLIDES || !settings" :loading="uploading === 'new'"
        @click="addSlide">添加轮播图（选择图片）</el-button>

      <el-divider content-position="left">宣传板</el-divider>
      <div v-for="(board, index) in form.boards" :key="'board-' + index" class="promo" :class="{ narrow }">
        <div class="preview board" :class="BOARDS[index]!.tone">
          <img v-if="board.url" :src="board.url" alt="" />
          <span v-else class="board-text">{{ board.title.trim() || 'COMING SOON' }}</span>
        </div>
        <el-form class="fields" label-width="56px" :label-position="narrow ? 'top' : 'right'" @submit.prevent>
          <el-form-item label="位置">
            <strong>{{ BOARDS[index]!.label }}</strong>
          </el-form-item>
          <el-form-item label="图片">
            <el-button :icon="Upload" :loading="uploading === 'board-' + index"
              @click="replaceImage('board-' + index, board)">{{ board.url ? '更换图片' : '上传图片' }}</el-button>
            <el-button v-if="board.url" :icon="Delete" @click="clearImage(board)">移除图片</el-button>
            <span class="hint" :class="{ warn: sizeHint(board, BOARD_RATIO).warn }">{{ board.url ? sizeHint(board, BOARD_RATIO).text : '不传图时显示原来的渐变底和角色' }}</span>
          </el-form-item>
          <el-form-item label="链接" :error="linkProblem(board.link)">
            <el-input v-model="board.link" clearable maxlength="500" placeholder="网址（https 开头）或 /editor.html；留空则提示“敬请期待”" />
          </el-form-item>
          <el-form-item label="文字">
            <el-input v-model="board.title" clearable maxlength="40" show-word-limit placeholder="没有图片时显示在宣传板上，留空为 COMING SOON" />
          </el-form-item>
        </el-form>
      </div>
    </div>
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
.file-input {
  display: none;
}
.interval {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.hint {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.hint.warn {
  color: var(--el-color-warning);
}
.promo {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  padding: 16px;
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.promo.narrow {
  flex-direction: column;
}
.fields {
  flex: 1;
  min-width: 0;
}
.fields :deep(.el-form-item) {
  margin-bottom: 14px;
}
.fields :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}
.remove {
  margin-left: 12px;
}
.preview {
  position: relative;
  flex: none;
  width: 300px;
  max-width: 100%;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.preview img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.preview.carousel {
  aspect-ratio: 35 / 20.2;
  background: #16305e;
}
.preview.board {
  aspect-ratio: 35 / 7.8;
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.preview.blue {
  background: linear-gradient(90deg, #1868e6, #1f94fb 55%, #56c8ff);
}
.preview.purple {
  background: linear-gradient(90deg, #7a35e8, #a45af2 55%, #e27bff);
}
.missing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.7);
}
.badge {
  position: absolute;
  left: 6px;
  top: 6px;
  min-width: 22px;
  padding: 0 6px;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  line-height: 22px;
  text-align: center;
}
.board-text {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #fff;
  font-family: 'Arial Black', 'Helvetica Neue', Arial, sans-serif;
  font-weight: 900;
  font-size: 22px;
  white-space: nowrap;
  text-shadow: 0 2px 3px rgba(0, 0, 0, 0.35);
}
</style>
