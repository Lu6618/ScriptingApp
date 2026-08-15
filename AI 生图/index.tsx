import {
  Button,
  Divider,
  HStack,
  Image,
  LazyVGrid,
  Navigation,
  NavigationStack,
  ProgressView,
  Rectangle,
  Script,
  ScrollView,
  Spacer,
  Tab,
  TabView,
  Text,
  TextField,
  Toolbar,
  ToolbarItem,
  VStack,
  ZStack,
  fetch,
  useEffect,
  useObservable,
  useState,
} from "scripting"

type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9"
type ResolutionOption = "1K" | "2K" | "4K" | "480p" | "720p"
type TaskStatus = "idle" | "submitting" | "queued" | "processing" | "completed" | "error"
type GenerationStage = "理解描述" | "构建画面" | "生成细节" | "即将完成"

type TaskResponse = {
  id?: string
  task_id?: string
  status?: string
  image_url?: string | null
  url?: string | null
  image?: string | null
  error?: string | null
  message?: string | null
  duration_sec?: number
}

type Artwork = {
  id: string
  imageUrl: string
  prompt: string
  style: string
  styleTitle: string
  aspectRatio: AspectRatio
  createdAt: number
  taskId?: string
  durationSec?: number
  resolution?: ResolutionOption
  favorite?: boolean
}

const apiBase = "https://imagefree.tingfengai.art"
const artworkKey = "ai-image-studio.artworks.v2"
const generationCountKey = "ai-image-studio.generation-count.v2"
const panelShape = { type: "rect" as const, cornerRadius: 22, style: "continuous" as const }
const smallShape = { type: "rect" as const, cornerRadius: 16, style: "continuous" as const }
const imageShape = { type: "rect" as const, cornerRadius: 20, style: "continuous" as const }
const accent = "#007AFF"
const pageBackground = "#EFEFF4"
const selectedBlueWash = "#E8F3FF"
const primaryText = "#1D1D1F"
const secondaryText = "#3C3C43"
const bodyText = "#636366"
const tertiaryText = "#8E8E93"
const placeholderText = "#AEAEB2"
const glassWhite = "rgba(255,255,255,0.82)"
const glassWhiteSoft = "rgba(255,255,255,0.70)"
const glassHighlight = "rgba(255,255,255,0.94)"
const silverSurface = "#FFFFFF"

const ratios: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"]
const resolutions: ResolutionOption[] = ["1K", "2K", "4K", "480p", "720p"]
const inspiration = [
  "一间清晨阳光穿过薄纱窗帘的极简画室，桌上有银色相机和白色郁金香",
  "雨后的东京街头，一位穿风衣的人站在蓝色霓虹下，电影海报构图",
  "漂浮在云层上的玻璃图书馆，柔和自然光，安静而宏大",
  "一只橘猫坐在现代厨房岛台上，浅景深，生活方式摄影",
]

function sleep(ms: number) { return new Promise<void>(resolve => setTimeout(resolve, ms)) }
function nowId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}` }
function safeArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : [] }
function loadArtworks(): Artwork[] { return safeArray<Artwork>(Storage.get<unknown>(artworkKey)).filter(item => !!item.imageUrl).sort((a, b) => b.createdAt - a.createdAt) }
function saveArtworks(items: Artwork[]) { Storage.set(artworkKey, items.slice(0, 120)) }
function addArtwork(item: Artwork) { saveArtworks([item, ...loadArtworks().filter(x => x.id !== item.id)]) }
function deleteArtwork(id: string) { saveArtworks(loadArtworks().filter(item => item.id !== id)) }
function toggleArtworkFavorite(id: string): Artwork[] { const next = loadArtworks().map(item => item.id === id ? { ...item, favorite: !item.favorite } : item); saveArtworks(next); return next }
function generationCount() { return Storage.get<number>(generationCountKey) || 0 }
function bumpGenerationCount() { Storage.set(generationCountKey, generationCount() + 1) }
function fileName() { const d = new Date(); const p = (n: number) => `${n}`.padStart(2, "0"); return `image-studio-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png` }
function formatDate(ms: number) { return new Date(ms).toLocaleString("zh-Hans-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }
function friendlyError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  if (/human verification/i.test(raw)) return "生成服务需要完成人机验证。请打开官网完成验证或稍后重试。"
  if (raw.includes("429")) return "生成请求太频繁，请稍后再试。"
  if (raw.includes("422")) return "提示词或参数暂时无法处理，换一种描述再试。"
  if (raw.includes("404")) return "没有找到生成任务，请重新生成。"
  if (raw.includes("timeout")) return "生成时间较长，请稍后再试。"
  return raw || "生成失败，请稍后再试。"
}
function normalizeTask(data: TaskResponse): Required<Pick<TaskResponse, "status">> & TaskResponse { return { ...data, status: data.status || "queued" } }
function taskIdOf(data: TaskResponse) { return data.id || data.task_id || "" }
function imageUrlOf(data: TaskResponse) { return data.image_url || data.url || data.image || "" }

async function requestJson<T>(path: string, init?: any): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init)
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`${response.status}${text ? ` ${text}` : ""}`)
  }
  return await response.json()
}

async function createGenerationTask(prompt: string, ratio: AspectRatio, resolution: ResolutionOption): Promise<TaskResponse> {
  return await requestJson<TaskResponse>("/v1/generate/async", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt.trim(), aspect_ratio: ratio, resolution, model: "imagefree/default", download: false }),
  })
}

async function getTask(taskId: string): Promise<TaskResponse> {
  return await requestJson<TaskResponse>(`/v1/tasks/${encodeURIComponent(taskId)}`)
}

async function pollTask(taskId: string, onUpdate: (task: TaskResponse, attempt: number) => void): Promise<TaskResponse> {
  for (let attempt = 1; attempt <= 60; attempt++) {
    await sleep(attempt <= 2 ? 1800 : 2800)
    const task = normalizeTask(await getTask(taskId))
    onUpdate(task, attempt)
    if (task.status === "completed" || task.status === "error" || task.status === "failed") return task
  }
  throw new Error("timeout")
}

async function downloadImageData(url: string): Promise<Data> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status}`)
  const data = Data.fromArrayBuffer(await response.arrayBuffer())
  if (!data) throw new Error("图片下载失败")
  return data
}

function PageBackground() {
  return <Rectangle fill={pageBackground} ignoresSafeArea />
}

function GlassPanel({ children, padding = 14 }: { children: any; padding?: number }) {
  return <VStack alignment="leading" spacing={10} padding={padding} background={{ style: glassHighlight, shape: panelShape }}>{children}</VStack>
}

function CapsuleControl({ title, systemImage, selected, action }: { title: string; systemImage?: string; selected?: boolean; action: () => void }) {
  return <Button action={action} buttonStyle="plain" padding={{ horizontal: 12, vertical: 8 }} background={{ style: selected ? selectedBlueWash : glassWhiteSoft, shape: "capsule" }}><HStack spacing={6}>{systemImage ? <Image systemName={systemImage} font="caption" foregroundStyle={selected ? accent : tertiaryText} /> : undefined}<Text font="footnote" fontWeight={selected ? "semibold" : "regular"} foregroundStyle={selected ? primaryText : bodyText}>{title}</Text></HStack></Button>
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="headline" fontWeight="semibold" foregroundStyle={primaryText}>{title}</Text>{subtitle ? <Text font="caption" foregroundStyle={tertiaryText}>{subtitle}</Text> : undefined}</VStack>
}

function OptionTitle({ title }: { title: string }) {
  return <Text font="headline" fontWeight="semibold" foregroundStyle={primaryText} frame={{ maxWidth: "infinity", alignment: "center" }} multilineTextAlignment="center">{title}</Text>
}

function EqualCapsuleControl({ title, selected, action }: { title: string; selected?: boolean; action: () => void }) {
  return <Button action={action} buttonStyle="plain" frame={{ maxWidth: "infinity", minHeight: 38 }} background={{ style: selected ? selectedBlueWash : glassWhiteSoft, shape: "capsule" }}><Text font="footnote" fontWeight={selected ? "semibold" : "regular"} foregroundStyle={selected ? primaryText : tertiaryText}>{title}</Text></Button>
}

function RatioSelector({ value, onChange }: { value: AspectRatio; onChange: (value: AspectRatio) => void }) {
  return <HStack spacing={7} frame={{ maxWidth: "infinity" }}>{ratios.map(ratio => <EqualCapsuleControl key={ratio} title={ratio} selected={value === ratio} action={() => onChange(ratio)} />)}</HStack>
}

function ResolutionSelector({ value, onChange }: { value: ResolutionOption; onChange: (value: ResolutionOption) => void }) {
  return <HStack spacing={7} frame={{ maxWidth: "infinity" }}>{resolutions.map(resolution => <EqualCapsuleControl key={resolution} title={resolution} selected={value === resolution} action={() => onChange(resolution)} />)}</HStack>
}

function GenerationStatusView({ status, stage, progress, message, taskId, onRetry }: { status: TaskStatus; stage: GenerationStage; progress: number; message: string; taskId: string; onRetry?: () => void }) {
  const active = status === "submitting" || status === "queued" || status === "processing"
  const icon = status === "completed" ? "checkmark.circle.fill" : status === "error" ? "exclamationmark.triangle.fill" : "sparkles"
  return <GlassPanel><HStack spacing={10}><ZStack frame={{ width: 36, height: 36 }} background={{ style: glassWhiteSoft, shape: "circle" }}><Image systemName={icon} font="headline" foregroundStyle={status === "error" ? bodyText : accent} /></ZStack><VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="subheadline" fontWeight="semibold" foregroundStyle={primaryText}>{active ? stage : status === "completed" ? "创作完成" : status === "error" ? "需要重试" : "准备创作"}</Text><Text font="caption" foregroundStyle={bodyText}>{message}</Text></VStack>{active ? <ProgressView /> : undefined}</HStack>{active ? <Rectangle fill={accent} frame={{ width: Math.max(32, Math.min(220, progress * 2.2)), height: 4 }} clipShape="capsule" /> : undefined}{taskId ? <Text font="caption2" monospaced foregroundStyle={tertiaryText} lineLimit={1}>任务 {taskId}</Text> : undefined}{status === "error" && onRetry ? <Button title="重试生成" systemImage="arrow.clockwise" tint={accent} frame={{ maxWidth: "infinity", minHeight: 42 }} action={onRetry} /> : undefined}</GlassPanel>
}

function ResultHero({ artwork, onSavedMessage }: { artwork: Artwork; onSavedMessage: (value: string) => void }) {
  const [saving, setSaving] = useState(false)
  const [copyingImage, setCopyingImage] = useState(false)
  async function save() { try { setSaving(true); const ok = await Photos.savePhoto(await downloadImageData(artwork.imageUrl), { fileName: fileName() }); onSavedMessage(ok ? "已保存。" : "相册保存未完成。") } catch (error) { onSavedMessage(friendlyError(error)) } finally { setSaving(false) } }
  async function copyLink() { await Pasteboard.setString(artwork.imageUrl); onSavedMessage("已复制图片链接。") }
  async function copyImage() { try { setCopyingImage(true); const image = await UIImage.fromURL(artwork.imageUrl); if (!image) throw new Error("图片复制失败"); await Pasteboard.setImage(image); onSavedMessage("已复制图片到剪切板。") } catch (error) { onSavedMessage(friendlyError(error)) } finally { setCopyingImage(false) } }
  return <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}><Image imageUrl={artwork.imageUrl} placeholder={<ProgressView />} resizable aspectRatio={{ value: artwork.aspectRatio === "9:16" ? 0.58 : artwork.aspectRatio === "16:9" ? 1.78 : artwork.aspectRatio === "3:4" ? 0.75 : artwork.aspectRatio === "4:3" ? 1.33 : 1, contentMode: "fit" }} frame={{ maxWidth: "infinity", minHeight: 226 }} clipShape={imageShape} /><HStack spacing={8} padding={7} background={{ style: glassWhite, shape: "capsule" }}><Button action={save} disabled={saving} buttonStyle="plain"><Image systemName={saving ? "clock" : "square.and.arrow.down"} font="headline" foregroundStyle={accent} frame={{ width: 38, height: 30 }} /></Button><Button action={copyLink} buttonStyle="plain"><Image systemName="link" font="headline" foregroundStyle={accent} frame={{ width: 38, height: 30 }} /></Button><Button action={copyImage} disabled={copyingImage} buttonStyle="plain"><Image systemName={copyingImage ? "clock" : "doc.on.clipboard"} font="headline" foregroundStyle={accent} frame={{ width: 38, height: 30 }} /></Button></HStack></VStack>
}

function CreationPage({ revision, onLibraryChanged }: { revision: number; onLibraryChanged: () => void }) {
  const [prompt, setPrompt] = useState("")
  const [ratio, setRatio] = useState<AspectRatio>("1:1")
  const [resolution, setResolution] = useState<ResolutionOption>("1K")
  const [status, setStatus] = useState<TaskStatus>("idle")
  const [message, setMessage] = useState("输入一句描述生成新图片。")
  const [stage, setStage] = useState<GenerationStage>("理解描述")
  const [progress, setProgress] = useState(0)
  const [taskId, setTaskId] = useState("")
  const [result, setResult] = useState<Artwork | null>(null)
  const busy = status === "submitting" || status === "queued" || status === "processing"

  async function generate() {
    const clean = prompt.trim()
    if (!clean) { setStatus("error"); setMessage("先写下你想创造的画面。"); return }
    try {
      setResult(null); setTaskId(""); setProgress(10); setStage("理解描述"); setStatus("submitting"); setMessage("正在提交文生图任务...")
      const created = normalizeTask(await createGenerationTask(clean, ratio, resolution))
      const id = taskIdOf(created)
      if (!id) throw new Error(created.error || created.message || "接口没有返回任务 ID。")
      setTaskId(id); setStatus(created.status === "processing" ? "processing" : "queued"); setMessage("任务已进入队列，正在等待出图。")
      const done = await pollTask(id, (task, attempt) => {
        const pct = Math.min(92, 18 + attempt * 7)
        setProgress(pct)
        setStage(pct > 78 ? "即将完成" : pct > 54 ? "生成细节" : pct > 30 ? "构建画面" : "理解描述")
        setStatus(task.status === "processing" ? "processing" : "queued")
        setMessage(task.status === "processing" ? "AI 正在绘制细节。" : "任务正在排队处理中。")
      })
      const imageUrl = imageUrlOf(done)
      if ((done.status === "completed" || imageUrl) && imageUrl) {
        const artwork: Artwork = { id: nowId(), imageUrl, prompt: clean, style: "default", styleTitle: "文生图", aspectRatio: ratio, createdAt: Date.now(), taskId: id, durationSec: done.duration_sec, resolution }
        addArtwork(artwork); bumpGenerationCount(); setResult(artwork); setProgress(100); setStage("即将完成"); setStatus("completed"); setMessage(done.duration_sec ? `出图完成，用时约 ${done.duration_sec} 秒。` : "出图完成。"); onLibraryChanged()
      } else {
        throw new Error(done.error || done.message || "生成失败，请稍后再试。")
      }
    } catch (error) { setStatus("error"); setMessage(friendlyError(error)) }
  }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="创作" navigationBarTitleDisplayMode="inline" scrollDismissesKeyboard="interactively"><VStack spacing={12} alignment="leading" padding={{ horizontal: 10, top: 6, bottom: 64 }}><GlassPanel padding={12}><TextField title="Prompt" prompt="描述一个画面、人物、空间或情绪" value={prompt} onChanged={setPrompt} axis="vertical" frame={{ maxWidth: "infinity", minHeight: 90 }} font="body" /><HStack spacing={7}><CapsuleControl title="增强" systemImage="wand.and.stars" action={() => setPrompt(prompt ? `${prompt}，精致构图，高级光影，细节丰富` : "精致构图，高级光影，细节丰富")} /><CapsuleControl title="灵感" systemImage="dice" action={() => setPrompt(inspiration[Math.floor(Math.random() * inspiration.length)])} /><CapsuleControl title="清除" systemImage="xmark" action={() => setPrompt("")} /></HStack></GlassPanel><GlassPanel padding={12}><VStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}><OptionTitle title="比例" /><RatioSelector value={ratio} onChange={setRatio} /></VStack><Divider /><VStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}><OptionTitle title="分辨率" /><ResolutionSelector value={resolution} onChange={setResolution} /></VStack></GlassPanel><Button action={generate} disabled={busy} buttonStyle="glassProminent" tint={accent} frame={{ maxWidth: "infinity", minHeight: 50 }}><HStack spacing={8}><Image systemName={busy ? "hourglass" : "sparkles"} font="headline" /><Text font="headline" fontWeight="semibold">{busy ? "正在创作..." : "生成图片"}</Text></HStack></Button><GenerationStatusView status={status} stage={stage} progress={progress} message={message} taskId={taskId} onRetry={generate} />{result ? <ResultHero key={`${result.id}-${revision}`} artwork={result} onSavedMessage={setMessage} /> : undefined}</VStack></ScrollView></ZStack>
}

function ArtworkTile({ item, onOpen }: { item: Artwork; onOpen: (item: Artwork) => void }) {
  const tall = item.aspectRatio === "9:16" || item.aspectRatio === "3:4"
  return <Button action={() => onOpen(item)} buttonStyle="plain" frame={{ maxWidth: "infinity" }}><VStack spacing={6} alignment="leading"><Image imageUrl={item.imageUrl} placeholder={<Rectangle fill={glassWhiteSoft} />} resizable aspectRatio={{ value: tall ? 0.72 : item.aspectRatio === "16:9" ? 1.55 : 1, contentMode: "fill" }} frame={{ maxWidth: "infinity", minHeight: tall ? 178 : 124 }} clipShape={imageShape} /><Text font="caption" fontWeight="semibold" foregroundStyle={primaryText} lineLimit={1}>{item.styleTitle} · {item.aspectRatio}</Text><Text font="caption2" foregroundStyle={tertiaryText} lineLimit={2}>{item.prompt}</Text></VStack></Button>
}

function ArtworkDetailPage({ artwork, onChanged }: { artwork: Artwork; onChanged: () => void }) {
  const [message, setMessage] = useState("")
  const dismiss = Navigation.useDismiss()
  function remove() { deleteArtwork(artwork.id); onChanged(); dismiss() }
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="作品" navigationBarTitleDisplayMode="inline"><VStack spacing={12} alignment="leading" padding={{ horizontal: 10, top: 6, bottom: 28 }}><ResultHero artwork={artwork} onSavedMessage={setMessage} />{message ? <Text font="footnote" foregroundStyle={bodyText}>{message}</Text> : undefined}<GlassPanel><SectionTitle title="Prompt" subtitle="文生图" /><Text font="body" foregroundStyle={primaryText}>{artwork.prompt}</Text><Divider /><HStack><Text foregroundStyle={bodyText}>比例</Text><Spacer /><Text fontWeight="semibold" foregroundStyle={primaryText}>{artwork.aspectRatio}</Text></HStack>{artwork.resolution ? <HStack><Text foregroundStyle={bodyText}>分辨率</Text><Spacer /><Text fontWeight="semibold" foregroundStyle={primaryText}>{artwork.resolution}</Text></HStack> : undefined}<HStack><Text foregroundStyle={bodyText}>时间</Text><Spacer /><Text fontWeight="semibold" foregroundStyle={primaryText}>{formatDate(artwork.createdAt)}</Text></HStack>{artwork.taskId ? <Text font="caption2" monospaced foregroundStyle={tertiaryText} lineLimit={1}>{artwork.taskId}</Text> : undefined}</GlassPanel><Button title="删除作品" systemImage="trash" role="destructive" tint={bodyText} frame={{ maxWidth: "infinity", minHeight: 42 }} action={remove} /></VStack></ScrollView></ZStack>
}

function LibraryPage({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [items, setItems] = useState<Artwork[]>(() => loadArtworks())
  const [selected, setSelected] = useState<Artwork | null>(null)
  const presented = useObservable(false)
  useEffect(() => { setItems(loadArtworks()) }, [revision])
  function open(item: Artwork) { setSelected(item); presented.setValue(true) }
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="我的" navigationBarTitleDisplayMode="inline" refreshable={async () => setItems(loadArtworks())} navigationDestination={{ isPresented: presented, content: selected ? <ArtworkDetailPage artwork={selected} onChanged={() => { onChanged(); setItems(loadArtworks()) }} /> : <VStack /> }}><VStack spacing={12} alignment="leading" padding={{ horizontal: 10, top: 6, bottom: 64 }}><SectionTitle title="我的作品" subtitle={`${items.length} 张作品 · ${generationCount()} 次生成`} />{items.length ? <LazyVGrid columns={[{ size: { type: "flexible" }, spacing: 8 }, { size: { type: "flexible" }, spacing: 8 }]} alignment="leading" spacing={12}>{items.map(item => <ArtworkTile key={item.id} item={item} onOpen={open} />)}</LazyVGrid> : <GlassPanel><VStack spacing={10} frame={{ maxWidth: "infinity", minHeight: 180 }}><Image systemName="photo.stack" font="title" foregroundStyle={accent} /><Text font="headline" foregroundStyle={primaryText}>还没有作品</Text><Text font="footnote" foregroundStyle={tertiaryText} multilineTextAlignment="center">在创作页生成第一张图片后，会自动出现在这里。</Text></VStack></GlassPanel>}</VStack></ScrollView></ZStack>
}

function App() {
  const dismiss = Navigation.useDismiss()
  const selection = useObservable(0)
  const revision = useObservable(0)
  const bump = () => revision.setValue(revision.value + 1)
  const toolbar = <Toolbar><ToolbarItem placement="topBarLeading" sharedBackgroundVisibility="visible"><Button action={() => dismiss()} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect"><Image systemName="xmark" font="headline" foregroundStyle={primaryText} /></Button></ToolbarItem><ToolbarItem placement="principal"><Text font="headline" fontWeight="semibold" foregroundStyle={primaryText}>{["创作", "我的"][selection.value] || "AI 画室"}</Text></ToolbarItem>{Script.supportsMinimization() ? <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible"><Button action={() => { if (!Script.isMinimized()) Script.minimize().catch(() => {}) }} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect"><Image systemName="arrow.down.right.and.arrow.up.left" font="headline" foregroundStyle={primaryText} /></Button></ToolbarItem> : undefined}</Toolbar>
  return <NavigationStack><TabView selection={selection} tint={accent} tabViewStyle="sidebarAdaptable" tabBarMinimizeBehavior="onScrollDown" toolbar={toolbar}><Tab title="创作" systemImage="sparkles" value={0}><CreationPage revision={revision.value} onLibraryChanged={bump} /></Tab><Tab title="我的" systemImage="photo.stack" value={1}><LibraryPage revision={revision.value} onChanged={bump} /></Tab></TabView></NavigationStack>
}

async function run() {
  await Navigation.present({ element: <App />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}

run()
